"""Integration test for phase2_rollup's updated_at bump.

Regression guard for the PR #134 review finding: phase2_rollup writes
reputation_tier/composite/etc. for every SKU with a signal on every run,
but scripts/sync_to_supabase.py's incremental path only picks up rows
where updated_at > last_synced_at. Without bumping updated_at when a
tier actually changes, a nightly recompute that flips a SKU's tier
never reaches Supabase via the normal incremental sync path -- same
failure family as bug_dossier_sync_never_bumped_updated_at (never
bumping). The opposite mistake (bumping unconditionally for every SKU
every run) is equally wrong: it would defeat --products-only's
incremental filter for the entire catalog nightly. This test asserts
the middle ground: bump ONLY for SKUs whose tier actually changed.
"""
from __future__ import annotations

import sqlite3

from scripts.compute_reputation import DDL_SIGNALS, DDL_PRODUCTS_COLS, phase2_rollup


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE products (sku TEXT PRIMARY KEY, updated_at TEXT, "
        "reputation_tier TEXT, reputation_override TEXT)"
    )
    conn.executescript(DDL_SIGNALS)
    for stmt in DDL_PRODUCTS_COLS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass  # already added by the inline CREATE TABLE above
    return conn


def _insert_product(conn: sqlite3.Connection, sku: str, tier: str | None, updated_at: str) -> None:
    conn.execute(
        "INSERT INTO products (sku, updated_at, reputation_tier) VALUES (?, ?, ?)",
        (sku, updated_at, tier),
    )


def _insert_signal(conn: sqlite3.Connection, sku: str, axis: str, score: float, confidence: float) -> None:
    conn.execute(
        "INSERT INTO reputation_signals (sku, axis, score, confidence, method) "
        "VALUES (?, ?, ?, ?, 'test')",
        (sku, axis, score, confidence),
    )


def test_tier_change_bumps_updated_at():
    conn = _make_conn()
    stale = "2020-01-01T00:00:00+00:00"
    # SKU-A: currently 'everyday' (no signals -> stays everyday/null after rollup
    # would be ambiguous; instead seed it with a strong prestige signal so it
    # actually computes to a DIFFERENT, higher tier this run).
    _insert_product(conn, "SKU-A", "everyday", stale)
    _insert_signal(conn, "SKU-A", "prestige", 95.0, 0.9)
    _insert_signal(conn, "SKU-A", "acclaim", 90.0, 0.9)
    conn.commit()

    phase2_rollup(conn)

    row = conn.execute("SELECT updated_at, reputation_tier FROM products WHERE sku = 'SKU-A'").fetchone()
    assert row["reputation_tier"] != "everyday"
    assert row["updated_at"] != stale, "tier changed this run, updated_at must bump"


def test_unchanged_tier_does_not_bump_updated_at():
    conn = _make_conn()
    stale = "2020-01-01T00:00:00+00:00"
    # Seed the row's CURRENT tier as 'unrated' up front -- matching what a
    # weak signal (score=5.0, confidence=0.2) actually resolves to via
    # tier_for_composite, confirmed empirically below rather than assumed.
    _insert_product(conn, "SKU-B", "unrated", stale)
    _insert_signal(conn, "SKU-B", "prestige", 5.0, 0.2)
    conn.commit()

    phase2_rollup(conn)

    row = conn.execute("SELECT updated_at, reputation_tier FROM products WHERE sku = 'SKU-B'").fetchone()
    assert row["reputation_tier"] == "unrated", (
        "test fixture assumption broken: this weak signal no longer resolves "
        "to the pre-seeded 'unrated' tier -- update the seed above to match"
    )
    assert row["updated_at"] == stale, "tier unchanged, updated_at must NOT bump"


def test_only_changed_skus_bump_not_the_whole_catalog():
    """The core assertion the review finding is about: a mixed batch bumps
    exactly the changed rows, not every row phase2_rollup wrote to."""
    conn = _make_conn()
    stale = "2020-01-01T00:00:00+00:00"
    _insert_product(conn, "CHANGED", "everyday", stale)
    _insert_signal(conn, "CHANGED", "prestige", 95.0, 0.9)
    _insert_signal(conn, "CHANGED", "acclaim", 90.0, 0.9)
    _insert_product(conn, "UNCHANGED", "unrated", stale)
    _insert_signal(conn, "UNCHANGED", "prestige", 5.0, 0.2)
    conn.commit()

    phase2_rollup(conn)

    changed = conn.execute("SELECT updated_at FROM products WHERE sku = 'CHANGED'").fetchone()
    unchanged = conn.execute("SELECT updated_at FROM products WHERE sku = 'UNCHANGED'").fetchone()
    assert changed["updated_at"] != stale
    assert unchanged["updated_at"] == stale
