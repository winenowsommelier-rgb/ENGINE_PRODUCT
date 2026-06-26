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
DEFAULT_OUT = REPO_ROOT / "data" / "live_products_export.json"

# Must stay in sync with scripts/refresh_live_export.py EXPORT_COLS.
# consign is intentionally excluded — internal only, must never reach the browser.
EXPORT_COLS = [
    "id", "sku", "name", "brand", "classification", "wine_classification", "designation",
    "variety", "vintage", "alcohol",
    "country", "region", "subregion", "appellation",
    "body", "acidity", "tannin",
    "blend_type", "production_style",
    "sweetness", "intensity", "smokiness", "finish",
    "food_matching", "food_matching_detail", "flavor_tags",
    "bottle_size", "price", "currency",
    "special_price", "sp_discount_pct",
    "desc_en_short", "full_description",
    "taste_profile",
    "color", "image_url",
    "validation_status", "enrichment_confidence", "enrichment_quality_grade",
    "enrichment_source", "enrichment_note", "enriched_at", "enriched_by",
    "popularity_score", "popularity_orders_window", "popularity_revenue_window",
    "popularity_qty_window", "popularity_window_days", "popularity_synced_at",
    "created_at", "updated_at",
    "pairing_rationale",
    "is_in_stock", "wn_stock", "quantity_in_stock", "custom_stock_status",
    "margin_pct", "b2b_margin_pct",
    "score_max", "score_summary",
]

# JSON-encoded text columns — decode so the export contains real objects.
JSON_COLS = {"flavor_tags", "taste_profile", "production_style"}

PAGE_SIZE = 1000


def fetch_all_products() -> list[dict]:
    select = ",".join(EXPORT_COLS)
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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args(argv)

    print("Fetching products from Supabase...", flush=True)
    rows = fetch_all_products()
    rows = decode_json_cols(rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8")
    size_mb = args.out.stat().st_size / 1_048_576
    print(f"  Written: {args.out} ({len(rows)} products, {size_mb:.1f} MB)")

    # Verification
    none_price = sum(1 for r in rows if not r.get("price"))
    print(f"  products with price > 0: {len(rows) - none_price}/{len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
