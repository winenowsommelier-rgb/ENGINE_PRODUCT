#!/usr/bin/env python3
"""Regenerate data/b2b_catalog_export.json from data/db/products.db.

Feeds the /catalogs/b2b printable trade price list (apps/catalog). This is a
SEPARATE export from live_products_export.json on purpose: b2b_price and
b2b_discount_pct must never enter PUBLIC_FIELDS / PublicProduct (the
storefront's margin-leak allowlist — see apps/catalog/lib/catalog-data.ts).
This file is read ONLY by the key-gated /catalogs/b2b route.

The output path is gitignored (.gitignore: data/b2b_catalog_export.json) —
trade pricing must never land in the repo. Run this after any bulk price
sync, then redeploy so the B2B catalog route picks it up at build time.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "b2b_catalog_export.json"

try:
    from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_category
    _CATEGORY_AVAILABLE = True
except Exception:  # noqa: BLE001 — never let an optional import block a refresh
    _CATEGORY_AVAILABLE = False

EXPORT_COLS = [
    "sku", "name", "brand", "variety", "vintage", "bottle_size",
    "country", "region", "subregion",
    "price", "currency", "special_price", "sp_discount_pct",
    "b2b_price", "b2b_discount_pct",
    "image_url", "score_max", "score_summary",
    "is_in_stock", "custom_stock_status", "wn_stock",
]


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

    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    cols = [c for c in EXPORT_COLS if c in existing_cols]
    missing = set(EXPORT_COLS) - existing_cols
    if missing:
        print(f"WARN: skipping columns not in products table: {sorted(missing)}", file=sys.stderr)

    rows = conn.execute(
        f"SELECT {', '.join(cols)} FROM products "
        f"WHERE b2b_price IS NOT NULL AND b2b_price > 0 "
        f"AND (is_in_stock='1' OR custom_stock_status='1')"
    ).fetchall()

    records: list[dict] = []
    for r in rows:
        rec = {c: r[c] for c in cols}
        if _CATEGORY_AVAILABLE:
            cat = _resolve_category(rec)
            rec["category_group"] = cat["group"]
            rec["category_type"] = cat["type"]
        records.append(rec)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False))
    print(f"Wrote {len(records)} B2B rows → {args.out}  ({args.out.stat().st_size // 1024} KB)")

    has_price = sum(1 for r in records if r.get("price"))
    has_score = sum(1 for r in records if r.get("score_summary"))
    has_img = sum(1 for r in records if r.get("image_url"))
    print(f"  retail price populated: {has_price}")
    print(f"  score_summary populated: {has_score}")
    print(f"  image_url populated: {has_img}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
