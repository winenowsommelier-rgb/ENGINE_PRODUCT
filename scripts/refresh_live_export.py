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
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "live_products_export.json"

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
        records.append(rec)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False))
    print(f"Wrote {len(records)} products → {args.out}  ({args.out.stat().st_size // 1024} KB)")

    # Tally enrichment fields populated, for sanity
    has_desc = sum(1 for r in records if r.get("desc_en_short"))
    has_full = sum(1 for r in records if r.get("full_description"))
    has_taste = sum(1 for r in records if r.get("taste_profile"))
    has_flavors = sum(1 for r in records if r.get("flavor_tags"))
    print(f"  desc_en_short:    {has_desc}")
    print(f"  full_description: {has_full}")
    print(f"  flavor_tags:      {has_flavors}")
    print(f"  taste_profile:    {has_taste}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
