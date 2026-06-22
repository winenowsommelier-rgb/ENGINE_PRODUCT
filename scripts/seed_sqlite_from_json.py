#!/usr/bin/env python3
"""Bootstrap data/db/products.db from products.json.

Idempotent: re-runs UPSERT by sku. Schema columns are introspected from the
SQLite database; JSON keys not in the schema are silently ignored. List values
(e.g. production_style) are JSON-encoded.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_PRODUCTS_JSON = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_SCHEMA = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


def _ensure_schema(conn: sqlite3.Connection, schema_sql: Path) -> None:
    conn.executescript(schema_sql.read_text())


def _product_columns(conn: sqlite3.Connection) -> list[str]:
    return [r[1] for r in conn.execute("PRAGMA table_info(products)").fetchall()]


def _normalize(value):
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return value


def seed_products_db(
    db_path: Path,
    products_json: Path,
    schema_sql: Path = DEFAULT_SCHEMA,
) -> int:
    """Bootstrap the products table from products.json via UPSERT by sku.

    The ON CONFLICT(sku) DO UPDATE SET clause only lists columns that are
    present in the source JSON record. Columns absent from the source (e.g.
    body or full_description written by a downstream enrichment step)
    are NOT included in the SET clause and are therefore preserved on re-seed.

    Safe to re-run after enrichment has populated enrichment-only columns,
    provided those columns are not also present in products.json. Catalog
    fields that ARE in products.json will be refreshed to source-of-truth
    values; see test_seed_overwrites_existing_columns_on_re_seed.

    Returns the count of products inserted or updated.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn, schema_sql)
        cols = _product_columns(conn)
        records = json.loads(products_json.read_text())
        if isinstance(records, dict):
            records = records.get("records", [])

        count = 0
        for rec in records:
            row = {k: _normalize(rec[k]) for k in cols if k in rec}
            if "sku" not in row:
                continue
            names = list(row.keys())
            placeholders = ",".join("?" for _ in names)
            updates = ",".join(f"{n}=excluded.{n}" for n in names if n not in ("id", "sku"))
            sql = (
                f"INSERT INTO products ({','.join(names)}) VALUES ({placeholders}) "
                f"ON CONFLICT(sku) DO UPDATE SET {updates}"
            )
            conn.execute(sql, [row[n] for n in names])
            count += 1
        conn.commit()
        return count
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Seed local SQLite from products.json.")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--products-json", type=Path, default=DEFAULT_PRODUCTS_JSON)
    p.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    args = p.parse_args(argv)

    if not args.products_json.exists():
        print(f"ERROR: {args.products_json} not found.", file=sys.stderr)
        return 1
    if not args.schema.exists():
        print(f"ERROR: {args.schema} not found.", file=sys.stderr)
        return 1
    n = seed_products_db(args.db, args.products_json, args.schema)
    print(f"Seeded {n} products → {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
