#!/usr/bin/env python3
"""Regenerate data/db/products.json from data/db/products.db.

Why this exists
----------------
data/enrich_wines.py selects which SKUs to enrich from data/db/products.json
(--products-file), NOT from products.db directly. That JSON file is a
git-tracked, manually-snapshotted dump that nobody regenerates on write —
found 2026-07-18 stale 8 days / 498 SKUs behind products.db (exactly the
new-product onboarding batch), meaning enrich_wines.py has been blind to
every one of those 498 SKUs since onboarding. This mirrors
refresh_live_export.py's DB-is-truth pattern for the *other* file the
pipeline reads from.

category_group / category_type are re-derived from the SKU-taxonomy loader
on every run (CLAUDE.md Rule 12: classification is NOT category — the stored
column can drift/be wrong, taxonomy from the SKU prefix cannot).

Run after any bulk DB write, before an enrich_wines.py selection run:
    python scripts/refresh_products_json.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve as resolve_category  # noqa: E402

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "db" / "products.json"

# DB column -> products.json key, for names that differ between the two shapes.
RENAME = {
    "variety": "grape_variety",
    "body": "wine_body",
    "acidity": "wine_acidity",
    "tannin": "wine_tannin",
    "sweetness": "wine_sweetness",
}

# DB columns to include (existing products.json key name, after RENAME).
# cost/margin_thb/margin_pct/b2b_margin_thb/b2b_margin_pct are deliberately
# EXCLUDED: this file is git-tracked in a public repo, and none of its
# consumers (enrich_wines.py, build_explore_taxonomy.py,
# reconcile_seed_image_urls.py) read those fields -- mirrors the EXPORT_COLS
# allowlist fix from PR #115 for the storefront export.
DB_COLS = [
    "id", "sku", "name", "brand", "vintage", "bottle_size", "alcohol",
    "country", "region", "subregion", "origin", "origin_source", "manufacturer",
    "classification", "classification_source", "variety",
    "price", "currency", "b2b_price", "b2b_discount_pct",
    "promotion_price", "promotion_tier_price", "price_group",
    "is_in_stock", "quantity_in_stock",
    "desc_en_short", "full_description", "flavor_tags",
    "image_url", "image_alt_text", "image_local_path", "image_scraped_url",
    "body", "acidity", "tannin", "sweetness",
    "popularity_score",
    "overall_confidence", "taxonomy_confidence", "description_confidence",
    "validation_status", "batch_id", "queue_priority", "source_file",
    "supplier_code", "synced_at", "created_at", "updated_at",
    "enrichment_note", "enrichment_source",
]

JSON_COLS = {"flavor_tags"}


def main(argv: list[str] | None = None) -> int:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    cols = [c for c in DB_COLS if c in existing_cols]
    missing = set(DB_COLS) - existing_cols
    if missing:
        print(f"WARN: skipping columns not in products table: {sorted(missing)}", file=sys.stderr)

    rows = conn.execute(f"SELECT {', '.join(cols)} FROM products").fetchall()
    records: list[dict] = []
    for r in rows:
        rec = {}
        for c in cols:
            key = RENAME.get(c, c)
            val = r[c]
            if c in JSON_COLS and val:
                try:
                    val = json.loads(val)
                except (TypeError, ValueError):
                    val = []
            rec[key] = val
        cat = resolve_category({"sku": rec.get("sku", "")})
        rec["category_group"] = cat["group"]
        rec["category_type"] = cat["type"]
        records.append(rec)

    conn.close()

    args.out.write_text(json.dumps(records, ensure_ascii=False))
    print(f"wrote {len(records)} records to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
