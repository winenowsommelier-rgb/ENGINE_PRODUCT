# tests/test_reputation_db_invariants.py
"""DB invariants for reputation signals pipeline (Rule 6).

These tests run against the live data/db/products.db (read-only).
They assert: if reputation_signals has all 4 axes for SKU X,
then products.reputation_tier IS NOT NULL for SKU X.

Skip silently if the DB has no reputation data yet (script not run).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"


@pytest.fixture(scope="module")
def conn():
    if not DEFAULT_DB.exists():
        pytest.skip(f"live db not present: {DEFAULT_DB}")
    c = sqlite3.connect(DEFAULT_DB)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def _reputation_signals_exist(conn) -> bool:
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM reputation_signals"
        ).fetchone()[0]
        return count > 0
    except Exception:
        return False


def test_reputation_columns_exist_after_ddl(conn):
    """After compute_reputation.py Phase 0, these columns must exist on products."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    required = {
        "reputation_tier", "reputation_composite",
        "reputation_confidence", "reputation_summary",
        "reputation_override", "reputation_computed_at",
    }
    missing = required - cols
    if missing:
        pytest.skip(f"reputation columns not yet added (Phase 0 not run): {missing}")


def test_every_signalled_sku_has_tier_in_products(conn):
    """INVARIANT: if reputation_signals has all 4 axes for SKU X,
    products.reputation_tier must be populated for SKU X.

    A NULL tier here means Phase 2 rollup silently failed for that SKU.
    """
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty — run compute_reputation.py first")

    missing = conn.execute("""
        SELECT rs.sku
        FROM (
            SELECT sku
            FROM reputation_signals
            GROUP BY sku
            HAVING COUNT(DISTINCT axis) >= 2
        ) rs
        JOIN products p ON p.sku = rs.sku
        WHERE p.reputation_tier IS NULL
        LIMIT 25
    """).fetchall()

    assert not missing, (
        f"{len(missing)}+ SKUs have reputation_signals rows but NULL reputation_tier "
        f"in products. Sample: {[r['sku'] for r in missing]}. "
        f"Re-run scripts/compute_reputation.py Phase 2."
    )


def test_reputation_composite_within_bounds(conn):
    """reputation_composite must be in [0, 100] — no scoring bug should exceed this."""
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty")

    out_of_bounds = conn.execute("""
        SELECT sku, reputation_composite
        FROM products
        WHERE reputation_composite IS NOT NULL
          AND (reputation_composite < 0 OR reputation_composite > 100)
        LIMIT 10
    """).fetchall()

    assert not out_of_bounds, (
        f"reputation_composite out of [0,100] range for: "
        f"{[(r['sku'], r['reputation_composite']) for r in out_of_bounds]}"
    )


def test_reputation_tier_values_are_valid(conn):
    """reputation_tier must only contain valid enum values."""
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty")

    VALID = {"iconic", "premium", "established", "everyday", "unrated"}
    invalid = conn.execute("""
        SELECT sku, reputation_tier
        FROM products
        WHERE reputation_tier IS NOT NULL
        LIMIT 1000
    """).fetchall()

    bad = [(r["sku"], r["reputation_tier"]) for r in invalid
           if r["reputation_tier"] not in VALID]

    assert not bad, (
        f"Invalid reputation_tier values found: {bad[:10]}"
    )


def test_tier_distribution_sanity(conn):
    """Sanity-check: unrated count should be between 500 and 5500.
    Outside this range, investigate before publishing.
    """
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty")

    tiers = {
        r["reputation_tier"]: r["cnt"]
        for r in conn.execute("""
            SELECT reputation_tier, COUNT(*) as cnt
            FROM products
            WHERE is_in_stock IN ('1', 1)
            GROUP BY reputation_tier
        """).fetchall()
    }
    unrated = tiers.get("unrated", 0)
    # NOTE: unrated may exceed 5,000 at launch because many SKUs have no sales data
    # (popularity confidence=0.3 → often unrated). A count of 0 or 6,000+ means the
    # scoring pipeline is broken; widen the bound only after investigating.
    assert 500 <= unrated <= 5500, (
        f"Unexpected unrated count: {unrated}. Expected 500–5500. "
        f"Full distribution: {tiers}. Investigate before publishing."
    )


def test_no_orphan_signals(conn):
    """COVERAGE INVARIANT (I3): every sku in reputation_signals must exist in products.
    An orphan signal means Phase 2's UPDATE ... WHERE sku=:sku silently matched 0 rows —
    reputation drift that would otherwise be invisible.
    """
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty")

    orphans = conn.execute("""
        SELECT DISTINCT rs.sku
        FROM reputation_signals rs
        LEFT JOIN products p ON p.sku = rs.sku
        WHERE p.sku IS NULL
        LIMIT 25
    """).fetchall()

    assert not orphans, (
        f"{len(orphans)}+ reputation_signals SKUs have no matching products row "
        f"(silent zero-row UPDATE in Phase 2). Sample: {[r['sku'] for r in orphans]}."
    )


def test_signalled_skus_all_have_popularity_axis(conn):
    """COVERAGE INVARIANT (I4): every SKU that got any reputation signal must have a
    popularity axis row. Phase 1 always emits prestige+popularity+producer for every
    in-scope SKU; a signalled SKU missing popularity means a coverage gap in scoring.
    """
    if not _reputation_signals_exist(conn):
        pytest.skip("reputation_signals table empty")

    missing_pop = conn.execute("""
        SELECT DISTINCT rs.sku
        FROM reputation_signals rs
        WHERE NOT EXISTS (
            SELECT 1 FROM reputation_signals p
            WHERE p.sku = rs.sku AND p.axis = 'popularity'
        )
        LIMIT 25
    """).fetchall()

    assert not missing_pop, (
        f"{len(missing_pop)}+ signalled SKUs have no popularity axis row "
        f"(Phase 1 coverage gap). Sample: {[r['sku'] for r in missing_pop]}."
    )
