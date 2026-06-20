#!/usr/bin/env python3
"""Regenerate data/live_products_export.json from data/db/products.db.

Why this exists
---------------
The /api/explore/products endpoint (commit c151653) reads its "local-first"
data from data/live_products_export.json, NOT from SQLite. That JSON file
hasn't been refreshed since 2026-04-24, so backfilled / Phase-5 enrichment
sitting in SQLite never surfaces in the UI.

This script dumps the products table to JSON in the shape the endpoint
expects. Run after any bulk enrichment / backfill.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "live_products_export.json"
DEFAULT_VOCAB = REPO_ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"

# P4: regenerate flavor_tags_canonical on every refresh so the field can never
# drift stale. Import is guarded — a refresh must still succeed even if the
# taste vocab is temporarily unavailable (the field is an enhancement, not a
# load-bearing column). See scripts/apply_flavor_canonical.py.
try:
    from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    _CANON_AVAILABLE = True
except Exception:  # noqa: BLE001 — never let an optional import block a refresh
    _CANON_AVAILABLE = False

# Taxonomy: re-derive category_group / category_type from the SKU prefix on
# every refresh so these fields can never drift stale (same drift-proofing as
# flavor_tags_canonical above). Import is guarded — a refresh must still
# succeed even if the taxonomy module is temporarily unavailable.
try:
    from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_category
    _CATEGORY_AVAILABLE = True
except Exception:  # noqa: BLE001 — never let an optional import block a refresh
    _CATEGORY_AVAILABLE = False

# Columns the explore endpoint reads (see ExploreProduct in lib/explore/types.ts).
EXPORT_COLS = [
    "id", "sku", "name", "brand", "classification", "wine_classification",
    "grape_variety", "vintage", "alcohol",
    "country", "region", "subregion", "appellation",
    "wine_body", "wine_acidity", "wine_tannin",
    "food_matching", "flavor_tags",
    "bottle_size", "price", "currency",
    "desc_en_short", "full_description",
    "taste_profile",
    "wine_color", "image_url",
    "validation_status", "enrichment_confidence", "enrichment_quality_grade",
    "enrichment_source", "enrichment_note", "enriched_at", "enriched_by",
    "popularity_score", "popularity_orders_90d", "popularity_revenue_90d",
    "popularity_qty_90d", "popularity_window_days", "popularity_synced_at",
    "created_at", "updated_at",
    "pairing_rationale",
    # Stock and margin — required by curation hard_filter and scoring engine
    "is_in_stock", "wn_stock", "quantity_in_stock",
    "margin_pct", "b2b_margin_pct",
    # Critic scores — required by score_threshold filter in curation
    "score_max", "score_summary",
]

# Columns that contain JSON-encoded text and should be decoded for export.
JSON_COLS = {"flavor_tags", "taste_profile", "wine_production_style"}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    # Build SELECT — keep only columns the products table actually has
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    cols = [c for c in EXPORT_COLS if c in existing_cols]
    missing = set(EXPORT_COLS) - existing_cols
    if missing:
        print(f"WARN: skipping columns not in products table: {sorted(missing)}", file=sys.stderr)

    # P4: load the taste vocab once if available, so we can (re)derive
    # flavor_tags_canonical for every record below.
    vocab = None
    if _CANON_AVAILABLE and DEFAULT_VOCAB.exists():
        try:
            vocab = VocabLoader.from_path(DEFAULT_VOCAB)
        except Exception as e:  # noqa: BLE001
            print(f"WARN: taste vocab failed to load, skipping "
                  f"flavor_tags_canonical: {e}", file=sys.stderr)

    rows = conn.execute(f"SELECT {', '.join(cols)} FROM products").fetchall()
    records: list[dict] = []
    for r in rows:
        rec = {c: r[c] for c in cols}
        # Decode JSON-encoded columns so the API doesn't have to re-parse them
        for jc in JSON_COLS:
            v = rec.get(jc)
            if isinstance(v, str) and v:
                try:
                    rec[jc] = json.loads(v)
                except (ValueError, TypeError):
                    pass  # leave as-is if not valid JSON
        # P4: derive canonical flavor notes from the (now-decoded) flavor_tags.
        # Always present (empty list if no/unmappable tags) so it can't drift.
        if vocab is not None:
            canonical: list[str] = []
            for raw in (rec.get("flavor_tags") or []):
                for note in canonicalize_tag(raw, vocab):
                    if note not in canonical:
                        canonical.append(note)
            rec["flavor_tags_canonical"] = canonical
        # Taxonomy: SKU prefix is the source of truth for category. Always
        # present so a future refresh can't drop these (drift-proof).
        if _CATEGORY_AVAILABLE:
            _cat = _resolve_category(rec)
            rec["category_group"] = _cat["group"]
            rec["category_type"] = _cat["type"]
        records.append(rec)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False))
    print(f"Wrote {len(records)} products → {args.out}  ({args.out.stat().st_size // 1024} KB)")

    # Tally key fields populated, for sanity (Rule 1 — verify data shipped)
    has_desc = sum(1 for r in records if r.get("desc_en_short"))
    has_full = sum(1 for r in records if r.get("full_description"))
    has_taste = sum(1 for r in records if r.get("taste_profile"))
    has_flavors = sum(1 for r in records if r.get("flavor_tags"))
    has_canon = sum(1 for r in records if r.get("flavor_tags_canonical"))
    has_stock = sum(1 for r in records if str(r.get("is_in_stock", "")) == "1")
    has_margin = sum(1 for r in records if r.get("b2b_margin_pct") or r.get("margin_pct"))
    print(f"  desc_en_short:    {has_desc}")
    print(f"  full_description: {has_full}")
    print(f"  flavor_tags:      {has_flavors}")
    print(f"  flavor_tags_canonical: {has_canon}  ← P4 (re-derived each refresh)")
    has_category = sum(1 for r in records if r.get("category_group"))
    print(f"  category_group set: {has_category}  ← taxonomy (re-derived each refresh)")
    print(f"  taste_profile:    {has_taste}")
    print(f"  is_in_stock=1:    {has_stock}  ← curation hard_filter uses this")
    print(f"  margin populated: {has_margin}  ← curation scoring uses this")
    return 0


if __name__ == "__main__":
    sys.exit(main())
