#!/usr/bin/env python3
"""
Add magento_item_url and websites columns to the products table.

magento_item_url: the live storefront product-page URL (from the
"winenow-base-images" CSV's item_url column).
websites: raw string of which storefront(s) a SKU is listed on (e.g.
"Wine-now & Liq9, Wine-now.asia") — stored as-is, not parsed/structured.

Safe to run multiple times: before each ALTER TABLE, a Python-side
`PRAGMA table_info(products)` check confirms the column doesn't already
exist (SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS clause) —
columns already present are skipped and reported as "Already exists".

NOTE: Always pass --db explicitly when running from a git worktree; the
default path resolves relative to the script and can point at the wrong
DB (e.g. a stray 0-byte auto-created file in a worktree checkout).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLS = [
    ('magento_item_url', 'TEXT'),
    ('websites',         'TEXT'),
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Guard against the worktree/stray-empty-DB trap: sqlite3.connect() will
    # silently auto-create an empty SQLite file if the path doesn't already
    # exist as a real DB, and a 0-byte file would pass the .exists() check
    # above. Refuse to migrate unless the products table actually exists AND
    # has rows. (CLAUDE.md Rule 1.)
    probe = sqlite3.connect(args.db)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()[0]
        row_count = probe.execute("SELECT count(*) FROM products").fetchone()[0] if has_table else 0
    finally:
        probe.close()
    if not has_table or row_count == 0:
        print(
            f"ERROR: {args.db} has no populated products table "
            f"(has_table={bool(has_table)}, rows={row_count}). Refusing to migrate "
            f"— pass --db with the real database path. This guards the worktree/"
            f"empty-DB trap (CLAUDE.md Rule 1).",
            file=sys.stderr,
        )
        return 1

    print(f"Target DB: {args.db} ({row_count} products)")

    con = sqlite3.connect(args.db)
    try:
        existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        for col, coltype in NEW_COLS:
            if col in existing:
                print(f"  {col}: already exists, skipping")
                continue
            con.execute(f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            print(f"  {col}: added ({coltype})")
        con.commit()
    finally:
        con.close()

    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
