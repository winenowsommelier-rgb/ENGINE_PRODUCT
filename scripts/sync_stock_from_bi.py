"""Refresh stock columns in data/db/products.db from the BI DuckDB.

Why
---
Local SQLite's `is_in_stock`, `custom_stock_status`, `wn_stock` were synced
on 2026-03-24 (60+ days stale). Enriching from stale stock signals wastes
money on items that are inactive. BI DuckDB has fresh masterfile data.

This script pulls fresh values + a derived `is_active` flag (in-stock OR
sales in last 9 months) and updates the local rows. It also stamps
`bi_synced_at` so we know how fresh the data is.

Usage
-----
    .venv/bin/python scripts/sync_stock_from_bi.py
    .venv/bin/python scripts/sync_stock_from_bi.py --dry-run
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb  # type: ignore

REPO = Path(__file__).resolve().parent.parent
PRODUCTS_DB = REPO / "data" / "db" / "products.db"
DEFAULT_BI_DB = Path("/Users/admin/Desktop/CLAUDE DATA_WNLQ9 M REPORT ALL/data/processed/ecommerce_bi.duckdb")
RECENT_SALES_FLOOR_MONTH = "2025-09-01"  # ~9 months window


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--bi-db", type=Path, default=DEFAULT_BI_DB)
    p.add_argument("--products-db", type=Path, default=PRODUCTS_DB)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    if not args.bi_db.exists():
        print(f"ERROR: BI DuckDB not found at {args.bi_db}", file=sys.stderr)
        return 1

    print(f"Reading BI from {args.bi_db}")
    con = duckdb.connect(str(args.bi_db), read_only=True)

    # Fresh stock signals from BI masterfile
    bi_rows = con.execute("""
        SELECT
          m.sku,
          m.is_in_stock,
          m.custom_stock_status,
          m.wn_stock_qty,
          CASE WHEN s.sku IS NOT NULL THEN TRUE ELSE FALSE END AS has_recent_sales
        FROM staging.stg_masterfile m
        LEFT JOIN (
            SELECT DISTINCT sku
            FROM marts.mart_product_performance_monthly
            WHERE month_start >= ?
        ) s ON m.sku = s.sku
    """, (RECENT_SALES_FLOOR_MONTH,)).fetchall()
    print(f"BI rows pulled: {len(bi_rows)}")

    # Stats
    n_instock = sum(1 for r in bi_rows if r[1] is True)
    n_oos = sum(1 for r in bi_rows if r[1] is False)
    n_recent = sum(1 for r in bi_rows if r[4])
    n_active = sum(1 for r in bi_rows if (r[1] is True) or r[4])
    print(f"  is_in_stock=True: {n_instock}")
    print(f"  is_in_stock=False: {n_oos}")
    print(f"  has_recent_sales (since {RECENT_SALES_FLOOR_MONTH}): {n_recent}")
    print(f"  ACTIVE (in_stock OR recent_sales): {n_active}")

    if args.dry_run:
        print("\nDry-run: not writing.")
        return 0

    # Add bi_synced_at + is_active columns if missing
    pcon = sqlite3.connect(args.products_db)
    pcon.execute("CREATE INDEX IF NOT EXISTS ix_products_sku ON products(sku)")
    existing = {r[1] for r in pcon.execute("PRAGMA table_info(products)")}
    for col, ddl in (
        ("bi_synced_at", "TEXT"),
        ("is_active", "INTEGER"),
        ("has_recent_sales", "INTEGER"),
    ):
        if col not in existing:
            pcon.execute(f"ALTER TABLE products ADD COLUMN {col} {ddl}")
            print(f"Added column products.{col}")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    updates = 0
    for sku, is_in_stock, custom_status, wn_qty, has_recent in bi_rows:
        active = 1 if (is_in_stock is True) or has_recent else 0
        is_in_stock_str = "1" if is_in_stock is True else ("0" if is_in_stock is False else None)
        wn_qty_val = int(wn_qty) if wn_qty is not None else None
        cur = pcon.execute("""
            UPDATE products SET
                is_in_stock = COALESCE(?, is_in_stock),
                custom_stock_status = ?,
                wn_stock = COALESCE(?, wn_stock),
                is_active = ?,
                has_recent_sales = ?,
                bi_synced_at = ?
            WHERE sku = ?
        """, (is_in_stock_str, custom_status, wn_qty_val, active, 1 if has_recent else 0, now, sku))
        if cur.rowcount:
            updates += 1
    pcon.commit()

    # How many local rows have BI match
    matched = pcon.execute("SELECT COUNT(*) FROM products WHERE bi_synced_at = ?", (now,)).fetchone()[0]
    total = pcon.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    print(f"\nUpdated {updates} of {total} local rows with fresh BI data.")
    print(f"  matched bi_synced_at={now}: {matched}")
    print(f"  unmatched (no BI row): {total - matched}")

    # Final active counts in local
    r = pcon.execute("""SELECT
        SUM(is_active) AS active_skus,
        SUM(CASE WHEN is_active=0 THEN 1 ELSE 0 END) AS inactive_skus
        FROM products""").fetchone()
    print(f"\nLocal is_active now:")
    print(f"  active:   {r[0]}")
    print(f"  inactive: {r[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
