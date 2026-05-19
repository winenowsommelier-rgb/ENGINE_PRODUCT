#!/usr/bin/env python3
"""Push products.json (11,436 rows) to the new Supabase project.

Used once after the 2026-05-19 free-tier prune incident. Reads
data/db/products.json, normalises columns to match the schema in
data/migrations/2026-05-19_fresh_project_schema.sql, and POSTs in
chunks of 500 with upsert-on-sku.

Auth: uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = REPO / "data" / "db" / "products.json"
ENV_PATH = REPO / ".env.local"
CHUNK_SIZE = 500

# Keys present in products.json that MAP to schema columns.
# (Order doesn't matter — Supabase REST takes JSON.)
ALLOWED_COLUMNS = {
    "id", "sku", "sku_base", "name", "brand", "vintage", "bottle_size", "alcohol",
    "price", "cost", "currency", "special_price", "sp_discount_pct",
    "b2b_price", "b2b_margin_thb", "b2b_margin_pct", "b2b_discount_pct",
    "margin_thb", "margin_pct", "promotion_price", "promotion_tier_price", "price_group",
    "is_in_stock", "custom_stock_status", "wn_stock", "quantity_in_stock",
    "sold_orders", "sold_qty", "consign",
    "country", "region", "subregion", "appellation", "origin", "origin_source",
    "manufacturer",
    "classification", "classification_source", "wine_classification",
    "wine_type", "liquor_main_type", "other_type",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "wine_color", "wine_body", "wine_acidity", "wine_tannin",
    "flavor_profile", "flavor_tags", "food_matching",
    "character_traits", "full_description", "desc_en_short", "producer_notes",
    "image_url", "image_alt_text", "image_local_path", "image_scraped_url",
    "popularity_score", "popularity_qty_90d", "popularity_orders_90d",
    "popularity_revenue_90d", "popularity_window_days", "popularity_synced_at",
    "score_max", "score_summary",
    "enrichment_source", "enrichment_note", "enrichment_priority",
    "enrichment_confidence", "enriched_at", "enriched_by",
    "overall_confidence", "taxonomy_confidence", "description_confidence",
    "validation_status",
    "batch_id", "queue_priority", "source_file", "supplier_code", "synced_at",
    "created_at", "updated_at",
}


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


NUMERIC_FIELDS = {
    "price", "cost", "special_price", "b2b_price",
    "b2b_margin_thb", "margin_thb", "wn_stock", "quantity_in_stock",
    "sold_orders", "sold_qty", "queue_priority",
    "popularity_score", "popularity_qty_90d", "popularity_orders_90d",
    "popularity_revenue_90d", "popularity_window_days",
    "score_max", "enrichment_confidence",
    "overall_confidence", "taxonomy_confidence", "description_confidence",
}
TS_FIELDS = {
    "popularity_synced_at", "enriched_at", "synced_at", "created_at", "updated_at",
}


def normalize_row(row: dict) -> dict:
    """Return a row that has EVERY ALLOWED_COLUMNS key (None for missing).

    PostgREST bulk POST requires all rows in a chunk to have the same key set.
    """
    out: dict = {col: None for col in ALLOWED_COLUMNS}
    for k, v in row.items():
        if k not in ALLOWED_COLUMNS:
            continue
        if (k in NUMERIC_FIELDS or k in TS_FIELDS) and (v == "" or v is None):
            out[k] = None
        else:
            out[k] = v
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Skip the network calls.")
    p.add_argument("--limit", type=int, default=0, help="Send only first N rows (0 = all).")
    p.add_argument("--products-file", type=Path, default=PRODUCTS_PATH)
    args = p.parse_args()

    env = load_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("ERROR: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local", file=sys.stderr)
        return 1

    products_raw = json.loads(args.products_file.read_text())
    print(f"Loaded {len(products_raw)} products from {args.products_file.name}")

    rows = [normalize_row(r) for r in products_raw]
    if args.limit:
        rows = rows[: args.limit]
    print(f"Normalised to {len(rows)} rows ({len(ALLOWED_COLUMNS)} allowed columns)")

    if args.dry_run:
        print("[dry-run] sample row:")
        print(json.dumps(rows[0], indent=2, default=str)[:1500])
        print(f"[dry-run] would POST {len(rows)} rows in {(len(rows) + CHUNK_SIZE - 1) // CHUNK_SIZE} chunks")
        return 0

    sent = 0
    failed = 0
    started = time.time()
    total_chunks = (len(rows) + CHUNK_SIZE - 1) // CHUNK_SIZE

    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        idx = i // CHUNK_SIZE + 1
        body = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(
            f"{url}/rest/v1/products?on_conflict=sku",
            data=body,
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if 200 <= resp.status < 300:
                    sent += len(chunk)
                    print(f"  [{idx}/{total_chunks}] OK {resp.status} ({len(chunk)} rows, total {sent})")
                else:
                    failed += len(chunk)
                    print(f"  [{idx}/{total_chunks}] HTTP {resp.status}", file=sys.stderr)
        except urllib.error.HTTPError as e:
            failed += len(chunk)
            body_text = e.read().decode("utf-8", errors="replace")[:400]
            print(f"  [{idx}/{total_chunks}] FAIL {e.code}: {body_text}", file=sys.stderr)
            # If first chunk fails on schema, abort.
            if idx == 1 and ("does not exist" in body_text or "violates" in body_text or "schema cache" in body_text):
                print("Aborting — schema issue. Apply data/migrations/2026-05-19_fresh_project_schema.sql first.", file=sys.stderr)
                return 2
        except urllib.error.URLError as e:
            failed += len(chunk)
            print(f"  [{idx}/{total_chunks}] URLError: {e}", file=sys.stderr)

    elapsed = time.time() - started
    print(f"\nDone in {elapsed:.1f}s — sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
