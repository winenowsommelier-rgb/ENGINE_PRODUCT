"""Phase B row-selection tests (Task 3).

These exercise scripts/enrich_phase_b.py's FREE (zero-API) selection + prompt
layer. The selection MUST use the SKU-derived GROUP from the real resolve()
(Rule 12), never the magento classification field, and must pass the GROUP —
NOT the type — to schema_for_group (the Task-1 [Critical] fix: group "Spirits"
-> type "Rum"; passing type returns None and silently skips non-wine rows).

Real-ish SKU prefixes used (verified against data/taxonomy/sku_prefix_map.json):
  LWH* -> group Whisky, LRM* -> group Spirits (type Rum), WRW* -> group Wine.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from scripts.enrich_phase_b import select_rows, build_prompt, NONWINE  # noqa: E402
from data.lib.taste_taxonomy.universal_scales import schema_for_group  # noqa: E402


def _make_db(tmp_path):
    """Build a tmp products.db with products + critic_scores tables."""
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    # has_recent_sales is INTEGER in prod — keep the fixture faithful (Rule 3).
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, has_recent_sales INTEGER, sold_orders INTEGER)"
    )
    conn.execute("CREATE TABLE critic_scores (sku TEXT)")
    rows = [
        # (sku, name, is_in_stock, variety, body, has_recent_sales, sold_orders)
        # 1. in-stock whisky, integer-1 sales signal, empty body -> SELECTED
        ("LWH001", "Test Whisky A", "1", None, None, 1, 0),
        # 2. out-of-stock whisky with signal -> NOT selected (stock string "0")
        ("LWH002", "Test Whisky B", "0", None, None, 1, 0),
        # 3. in-stock whisky, NO signal (no sales, not in critic) -> NOT selected
        ("LWH003", "Test Whisky C", "1", None, None, 0, 0),
        # 4. in-stock WINE (group Wine) with signal -> NOT selected (wine excluded)
        ("WRW001", "Test Wine D", "1", None, None, 1, 5),
        # 5. in-stock spirit, signal, BOTH variety+body set -> NOT selected (nothing to fill)
        ("LRM001", "Test Rum E", "1", "Cane/Molasses", "Full", 1, 3),
    ]
    conn.executemany("INSERT INTO products VALUES (?,?,?,?,?,?,?)", rows)
    conn.commit()
    return conn


def test_select_rows_exact_set(tmp_path):
    conn = _make_db(tmp_path)
    selected = {r["sku"] for r in select_rows(conn)}
    assert selected == {"LWH001"}, f"unexpected selection: {selected}"


def test_selected_whisky_resolves_to_group(tmp_path):
    """The selected row carries the SKU-derived GROUP (Rule 12), not type."""
    conn = _make_db(tmp_path)
    rows = select_rows(conn)
    assert len(rows) == 1
    assert rows[0]["group"] == "Whisky"


def test_out_of_stock_string_zero_excluded(tmp_path):
    """is_in_stock '0' is a STRING; backwards-truthiness gotcha must be handled."""
    conn = _make_db(tmp_path)
    assert "LWH002" not in {r["sku"] for r in select_rows(conn)}


def test_no_signal_excluded(tmp_path):
    conn = _make_db(tmp_path)
    assert "LWH003" not in {r["sku"] for r in select_rows(conn)}


def test_wine_excluded(tmp_path):
    conn = _make_db(tmp_path)
    assert "WRW001" not in {r["sku"] for r in select_rows(conn)}


def test_already_filled_excluded(tmp_path):
    """Spirit with both variety+body set has nothing to enrich -> excluded."""
    conn = _make_db(tmp_path)
    assert "LRM001" not in {r["sku"] for r in select_rows(conn)}


def test_critic_signal_selects(tmp_path):
    """A row with no sales but present in critic_scores still qualifies (signal)."""
    conn = _make_db(tmp_path)
    # LWH003 has no sales; add it to critic_scores -> now has signal.
    conn.execute("INSERT INTO critic_scores VALUES ('LWH003')")
    conn.commit()
    assert "LWH003" in {r["sku"] for r in select_rows(conn)}


def test_sold_orders_signal_selects(tmp_path):
    """has_recent_sales '0' but sold_orders > 0 still qualifies as signal."""
    db = tmp_path / "s.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, has_recent_sales TEXT, sold_orders INTEGER)"
    )
    conn.execute("CREATE TABLE critic_scores (sku TEXT)")
    conn.execute(
        "INSERT INTO products VALUES "
        "('LRM009','Rum with orders','1',NULL,NULL,'0',7)"
    )
    conn.commit()
    assert "LRM009" in {r["sku"] for r in select_rows(conn)}


def test_non_numeric_sold_orders_does_not_crash_selection(tmp_path):
    """Rule 3: a single non-numeric sold_orders ('N/A') must NOT crash the whole
    selection. The row still has a critic-score signal, so it must be SELECTED."""
    db = tmp_path / "na.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, has_recent_sales INTEGER, sold_orders TEXT)"
    )
    conn.execute("CREATE TABLE critic_scores (sku TEXT)")
    # sold_orders='N/A' (non-numeric); has no sales flag; but IS in critic_scores.
    conn.execute(
        "INSERT INTO products VALUES "
        "('LRM050','Rum NA orders','1',NULL,NULL,0,'N/A')"
    )
    conn.execute("INSERT INTO critic_scores VALUES ('LRM050')")
    conn.commit()
    selected = {r["sku"] for r in select_rows(conn)}  # must not raise
    assert "LRM050" in selected


def test_missing_critic_scores_table_does_not_raise(tmp_path):
    """Rule 3: a stale/backup DB may lack the critic_scores table entirely.
    select_rows must degrade to sales-signal-only, not raise OperationalError."""
    db = tmp_path / "nocritic.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, has_recent_sales INTEGER, sold_orders INTEGER)"
    )
    # NO critic_scores table created on purpose.
    conn.execute(
        "INSERT INTO products VALUES "
        "('LWH060','Whisky sales only','1',NULL,NULL,1,0)"
    )
    conn.commit()
    selected = {r["sku"] for r in select_rows(conn)}  # must not raise
    assert "LWH060" in selected  # selected on the sales signal alone


@pytest.mark.parametrize("group", sorted(NONWINE))
def test_build_prompt_parity_all_nonwine_groups(group):
    """Rule-6 parity guard: every NONWINE group must have a non-None schema and
    its variety vocab must appear in the prompt. This locks the group-vs-type
    contract at the build_prompt call site — passing a *type* (e.g. 'Rum')
    instead of a *group* would make schema_for_group return None and crash here,
    catching the Task-1 [Critical] regression before any API spend.
    """
    schema = schema_for_group(group)
    assert schema is not None, f"NONWINE group {group!r} has no schema"
    fake_row = {"sku": "XXX000", "name": "Parity Probe", "group": group}
    prompt = build_prompt(fake_row)  # must not raise
    assert group in prompt
    # every variety vocab term should be present in the prompt's allowlist
    for term in schema["variety_vocab"]:
        assert term in prompt, f"vocab {term!r} missing from {group} prompt"
