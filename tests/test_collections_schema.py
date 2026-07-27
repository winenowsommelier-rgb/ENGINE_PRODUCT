from __future__ import annotations
import sqlite3
from scripts.wine_knowledge import pairing_schema, collections_schema


def _cols(conn):
    return {r[1] for r in conn.execute("PRAGMA table_info(collections)")}


def test_migrate_adds_group_and_sort_columns():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)
    assert "category_group" not in _cols(c)  # base table lacks them
    collections_schema.migrate(c)
    cols = _cols(c)
    assert "category_group" in cols and "sort_order" in cols


def test_migrate_is_idempotent():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)
    collections_schema.migrate(c)
    collections_schema.migrate(c)  # must not raise "duplicate column"
    assert "category_group" in _cols(c)
