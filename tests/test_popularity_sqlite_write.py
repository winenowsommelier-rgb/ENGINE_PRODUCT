# tests/test_popularity_sqlite_write.py
"""SQLite reset-then-update write path for popularity.

The reset-then-update transaction is the whole point: a re-run must clear stale
ranks (a SKU that sold last run but not this one goes back to NULL), not leave
them dangling. See spec §'Re-run semantics'.
"""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "sync_pop", REPO / "data" / "sync_popularity_from_bi.py"
)
sync_pop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_pop)

POP_COLS = [
    "popularity_score", "popularity_qty_window", "popularity_orders_window",
    "popularity_revenue_window", "popularity_window_days", "popularity_synced_at",
]


@pytest.fixture
def temp_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    cols = ", ".join(f"{c}" for c in POP_COLS)
    conn.execute(f"CREATE TABLE products (sku TEXT PRIMARY KEY, {cols})")
    conn.executemany(
        "INSERT INTO products (sku) VALUES (?)",
        [("A1",), ("A2",), ("A3",)],
    )
    conn.commit()
    conn.close()
    return db


def _row(db, sku):
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    r = conn.execute("SELECT * FROM products WHERE sku=?", (sku,)).fetchone()
    conn.close()
    return r


def test_write_populates_matched_skus(temp_db):
    rows = [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}]
    n = sync_pop.write_sqlite(rows, temp_db, synced_at="2026-06-20T00:00:00Z", window_days=365)
    assert n == 1
    a1 = _row(temp_db, "A1")
    assert a1["popularity_orders_window"] == 5
    assert a1["popularity_window_days"] == 365
    assert a1["popularity_synced_at"] == "2026-06-20T00:00:00Z"


def test_unmatched_skus_are_null(temp_db):
    rows = [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}]
    sync_pop.write_sqlite(rows, temp_db, synced_at="x", window_days=365)
    a2 = _row(temp_db, "A2")
    assert a2["popularity_orders_window"] is None


def test_rerun_resets_stale_rank(temp_db):
    # Run 1: A1 and A2 both score.
    sync_pop.write_sqlite(
        [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0},
         {"sku": "A2", "score": 0.4, "qty": 2.0, "orders": 1, "revenue": 50.0}],
        temp_db, synced_at="run1", window_days=365)
    assert _row(temp_db, "A2")["popularity_orders_window"] == 1
    # Run 2: only A1 scores. A2 must be RESET to NULL, not keep its old rank.
    sync_pop.write_sqlite(
        [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}],
        temp_db, synced_at="run2", window_days=365)
    assert _row(temp_db, "A2")["popularity_orders_window"] is None, "stale rank not reset"
    assert _row(temp_db, "A1")["popularity_synced_at"] == "run2"


def test_never_inserts_orphans(temp_db):
    rows = [{"sku": "ZZZ", "score": 0.5, "qty": 1.0, "orders": 1, "revenue": 1.0}]
    sync_pop.write_sqlite(rows, temp_db, synced_at="x", window_days=365)
    conn = sqlite3.connect(temp_db)
    count = conn.execute("SELECT COUNT(*) FROM products WHERE sku='ZZZ'").fetchone()[0]
    conn.close()
    assert count == 0, "must UPDATE only; never INSERT new SKUs"


def test_empty_rows_resets_all(temp_db):
    """Empty rows list still resets all popularity_* to NULL (re-run with no matches)."""
    sync_pop.write_sqlite(
        [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}],
        temp_db, synced_at="run1", window_days=365)
    assert _row(temp_db, "A1")["popularity_score"] == 0.9
    n = sync_pop.write_sqlite([], temp_db, synced_at="run2", window_days=365)
    assert n == 0, "no rows matched"
    assert _row(temp_db, "A1")["popularity_score"] is None, "reset even with empty input"
    assert _row(temp_db, "A1")["popularity_synced_at"] is None
