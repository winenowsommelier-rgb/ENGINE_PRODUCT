#!/usr/bin/env python3
"""
Regenerate data/live_products_export.json from Supabase products table.

Used by the nightly GitHub Actions job after price sync.
Mirrors the shape produced by refresh_live_export.py (which reads SQLite),
so the catalog can consume it identically.

Usage:
    python scripts/refresh_live_export_supabase.py
    python scripts/refresh_live_export_supabase.py --out /tmp/test_export.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
DEFAULT_OUT = REPO_ROOT / "data" / "live_products_export.json"

# category_group / category_type are NOT Supabase columns — they're derived
# server-side from the SKU prefix (see data/lib/taxonomy/sku_taxonomy.py) and
# backfilled on every refresh, same as refresh_live_export.py (SQLite path).
# This import is NOT guarded: category_group is a load-bearing field the
# catalog's /catalogs/retail picker depends on (CLAUDE.md Rule 3 — inherited
# thresholds/gaps must not be silently tolerated). If this import fails, the
# nightly sync should fail loudly rather than silently ship an export with no
# category_group on any row — which is exactly what happened on 2026-07-09
# when this import was missing entirely: every row shipped with
# category_group absent, breaking the retail catalog's category picker.
from data.lib.taxonomy.sku_taxonomy import resolve as resolve_category

# P4: regenerate flavor_tags_canonical on every refresh, same as
# refresh_live_export.py (SQLite path) — see that script's P4 comment.
# Guarded: unlike category_group above, flavor_tags_canonical is an
# enhancement, not load-bearing, so a temporarily-unavailable vocab must not
# block the nightly sync. (This is what actually broke 2026-07-17: this
# script never had the derivation step at all, so every nightly run since
# shipped flavor_tags_canonical empty on all rows — silent for 3+ days
# because, unlike category_group, there was no verification check below to
# catch it. Fixed by porting the derivation AND adding that check.)
try:
    from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    _CANON_AVAILABLE = True
except Exception:  # noqa: BLE001 — never let an optional import block a refresh
    _CANON_AVAILABLE = False

DEFAULT_VOCAB = REPO_ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"

# Must stay in sync with scripts/refresh_live_export.py EXPORT_COLS.
# consign is intentionally excluded — internal only, must never reach the browser.
EXPORT_COLS = [
    # Identity
    "id", "sku", "name", "brand", "vintage", "bottle_size", "alcohol", "color",
    # Taxonomy
    "classification", "wine_classification", "designation", "variety", "blend_type",
    "production_style", "country", "region", "subregion", "appellation",
    # Parsed vintage: `vintage` is free text ("2015 [**VINTAGE MAY CHANGE]"), so
    # vintage_year is the machine-usable year and vintage_is_provisional preserves
    # the supplier "may change" caveat.
    "vintage_year", "vintage_is_provisional",
    # Taste
    "body", "acidity", "tannin", "sweetness", "intensity", "smokiness", "finish",
    "bitterness",
    "food_matching", "food_matching_detail", "flavor_tags", "taste_profile",
    # Phase 2 — spirits classification fields.
    "gin_style", "agave_aging", "rum_style", "peat_level", "production_method",
    # Pricing — cost/margin_pct/b2b_margin_pct deliberately EXCLUDED. This
    # file is committed directly to the (public) repo by nightly-price-sync.yml
    # and read by apps/catalog's PUBLIC_FIELDS allowlist — the allowlist would
    # have filtered these before they reached the browser, but the raw
    # committed JSON itself must never carry margin/cost data. See
    # bug_intelligence_system_cost_margin_leak memory (2026-08-24) — same
    # class of exposure as the auth-bypass leak fixed in PR #112.
    "price", "currency", "special_price", "sp_discount_pct",
    # Stock
    "is_in_stock", "wn_stock", "quantity_in_stock", "custom_stock_status",
    # Content
    "desc_en_short", "full_description", "image_url",
    # Attribute provenance: lets the UI distinguish a producer-sourced attribute
    # from an AI-generated one.
    "attr_sources", "attr_evidence_tier", "attr_verified_at",
    # Enrichment metadata
    "validation_status", "enrichment_confidence", "enrichment_quality_grade",
    "enrichment_source", "enrichment_note", "enriched_at", "enriched_by",
    # Popularity — Supabase's real column names are the *_90d ones (see
    # supabase/migrations/003_product_popularity.sql); aliased to *_window on
    # output below to match refresh_live_export.py's (SQLite) key names, which
    # is what tests/test_popularity_export_invariant.py and the DB itself use
    # (the popularity window is configurable, not fixed at 90 days).
    "popularity_score", "popularity_qty_90d", "popularity_orders_90d",
    "popularity_revenue_90d", "popularity_window_days", "popularity_synced_at",
    # Critic scores
    "score_max", "score_summary",
    # Timestamps
    "created_at", "updated_at",
    "pairing_rationale",
    # Refiner attributes — certification body, accessory sub-type.
    "origin_system", "accessory_type",
    # Reputation signals — tier, composite score, confidence, and template copy.
    "reputation_tier", "reputation_composite", "reputation_confidence",
    "reputation_summary",
    # Curation dossier — expert-reference content.
    "curation_dossier",
    # Live storefront product-page URL and per-SKU site placement — sourced
    # from data/data mastefile WNLQ9/winenow-base-images-20260724.csv via
    # scripts/reconcile_image_urls.py. websites is a raw string, not parsed.
    "magento_item_url", "websites",
]

# Supabase source column name -> output JSON key, for names that differ
# between the two (see the popularity comment above).
_COLUMN_ALIASES = {
    "popularity_qty_90d": "popularity_qty_window",
    "popularity_orders_90d": "popularity_orders_window",
    "popularity_revenue_90d": "popularity_revenue_window",
}

# JSON-encoded text columns — decode so the export contains real objects.
JSON_COLS = {"flavor_tags", "taste_profile", "production_style", "curation_dossier"}

PAGE_SIZE = 1000


def fetch_all_products() -> list[dict]:
    # PostgREST supports `alias:column` in `select=` — rename the *_90d source
    # columns to their *_window output keys directly in the query, so the rest
    # of the pipeline never has to know the two names differ.
    select = ",".join(
        f"{_COLUMN_ALIASES[c]}:{c}" if c in _COLUMN_ALIASES else c
        for c in EXPORT_COLS
    )
    rows: list[dict] = []
    offset = 0

    while True:
        url = (
            f"{SUPABASE_URL}/rest/v1/products"
            f"?select={select}"
            f"&limit={PAGE_SIZE}&offset={offset}"
        )
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            page = json.loads(resp.read())
        if not page:
            break
        rows.extend(page)
        offset += len(page)
        print(f"  Fetched {len(rows)} rows...", end="\r", flush=True)
        if len(page) < PAGE_SIZE:
            break

    print(f"  Fetched {len(rows)} rows total.      ")
    return rows


def decode_json_cols(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        r = dict(row)
        for col in JSON_COLS:
            val = r.get(col)
            if isinstance(val, str):
                try:
                    r[col] = json.loads(val)
                except (json.JSONDecodeError, ValueError):
                    pass
        out.append(r)
    return out


def add_category_taxonomy(rows: list[dict]) -> list[dict]:
    """Backfill category_group/category_type from the SKU prefix, always —
    drift-proof, same as refresh_live_export.py (SQLite path)."""
    for r in rows:
        cat = resolve_category(r)
        r["category_group"] = cat["group"]
        r["category_type"] = cat["type"]
    return rows


def add_flavor_canonical(rows: list[dict]) -> list[dict]:
    """Derive flavor_tags_canonical from (already-decoded) flavor_tags on
    every refresh, same as refresh_live_export.py (SQLite path, P4). Always
    sets the field (empty list if no/unmappable tags or vocab unavailable)
    so it can't silently drift stale or silently disappear."""
    vocab = None
    if _CANON_AVAILABLE and DEFAULT_VOCAB.exists():
        try:
            vocab = VocabLoader.from_path(DEFAULT_VOCAB)
        except Exception as e:  # noqa: BLE001
            print(f"WARN: taste vocab failed to load, skipping "
                  f"flavor_tags_canonical: {e}", file=sys.stderr)
    for r in rows:
        canonical: list[str] = []
        if vocab is not None:
            for raw in (r.get("flavor_tags") or []):
                for note in canonicalize_tag(raw, vocab):
                    if note not in canonical:
                        canonical.append(note)
        r["flavor_tags_canonical"] = canonical
    return rows


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args(argv)

    print("Fetching products from Supabase...", flush=True)
    rows = fetch_all_products()
    rows = decode_json_cols(rows)
    rows = add_category_taxonomy(rows)
    rows = add_flavor_canonical(rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8")
    size_mb = args.out.stat().st_size / 1_048_576
    print(f"  Written: {args.out} ({len(rows)} products, {size_mb:.1f} MB)")

    # Verification
    none_price = sum(1 for r in rows if not r.get("price"))
    print(f"  products with price > 0: {len(rows) - none_price}/{len(rows)}")
    has_category = sum(1 for r in rows if r.get("category_group"))
    print(f"  category_group set: {has_category}/{len(rows)}  ← required by /catalogs/retail")
    if has_category == 0 and rows:
        print("ERROR: no row has category_group set — taxonomy backfill failed silently", file=sys.stderr)
        return 1
    has_flavors = sum(1 for r in rows if r.get("flavor_tags"))
    has_canon = sum(1 for r in rows if r.get("flavor_tags_canonical"))
    print(f"  flavor_tags_canonical set: {has_canon}/{len(rows)}  ← required by finder flavor chips")
    if has_flavors > 0 and has_canon == 0:
        print("ERROR: rows have flavor_tags but 0 have flavor_tags_canonical — "
              "canonicalization failed silently (taste vocab missing/broken?)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
