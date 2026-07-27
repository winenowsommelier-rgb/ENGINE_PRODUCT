"""Idempotent ALTER migration: adds category_group + sort_order to the
`collections` table (created by pairing_schema.migrate). ALTER-only so it is
safe to run against the live taxonomy.db that already has the table + rows.
"""
from __future__ import annotations
import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def migrate(conn: sqlite3.Connection) -> None:
    if not _has_column(conn, "collections", "category_group"):
        conn.execute("ALTER TABLE collections ADD COLUMN category_group TEXT")
    if not _has_column(conn, "collections", "sort_order"):
        conn.execute("ALTER TABLE collections ADD COLUMN sort_order INTEGER")
    conn.commit()
