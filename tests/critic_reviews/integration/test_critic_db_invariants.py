"""Production-data invariants for the critic_scores schema migration.

Guards the §15 migration: the rich-schema migration must NOT break the
1,550 product badges already shipping, and must NOT lose any of the 3,144
curated rows. This is the Rule 6 end-to-end invariant (CLAUDE.md), the
single most load-bearing test for the migration given the project's
$56 Phase-5 history. DO NOT delete or skip without an equivalent replacement.

Run read-only against the live data/db/products.db:
    .venv/bin/python -m pytest tests/critic_reviews/integration -v
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

# DB-path resolution. The DB is gitignored and lives ONLY in the MAIN checkout.
# When this test runs from a git worktree (.worktrees/<name>/...), the worktree
# has NO data/db/products.db, so parents[3] alone would resolve to a missing
# file and the fixture would SKIP — proving nothing. Resolve robustly: try the
# local checkout root first, then fall back to the MAIN checkout above any
# .worktrees/ segment. This makes the test connect to the real DB whether run
# from the worktree OR later from main.
#
# Guard against a 0-byte stray: tooling can `touch` data/db/products.db inside
# the worktree, creating an EMPTY file that passes .exists() but has no tables.
# Selecting it would make this load-bearing test silently validate an empty DB
# (the exact "prove nothing" failure this file warns about). So the predicate is
# "exists AND non-empty" — an empty placeholder is skipped and resolution falls
# through to the real MAIN-checkout DB.
def _is_real_db(p: Path) -> bool:
    return p.exists() and p.stat().st_size > 0

_CANDIDATES = [Path(__file__).resolve().parents[3] / "data" / "db" / "products.db"]
_p = Path(__file__).resolve()
if ".worktrees" in _p.parts:
    _i = _p.parts.index(".worktrees")
    _CANDIDATES.append(Path(*_p.parts[:_i]) / "data" / "db" / "products.db")
DEFAULT_DB = next((p for p in _CANDIDATES if _is_real_db(p)), _CANDIDATES[0])

# Expected steady-state, asserted by the §19 pre-flight. If the catalog grows
# and the loader re-runs, update these together with a documented reason.
EXPECTED_ROWS = 3144
EXPECTED_BADGE_SKUS = 1550


@pytest.fixture(scope="module")
def conn():
    if not _is_real_db(DEFAULT_DB):
        pytest.skip(f"live db not present (or empty): {DEFAULT_DB}")
    c = sqlite3.connect(f"file:{DEFAULT_DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def _has_columns(conn) -> bool:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(critic_scores)")}
    return {"source", "signal_tier", "confidence"}.issubset(cols)


def test_curated_rows_preserved(conn):
    """INVARIANT: the 3,144 magento_csv rows are all still present after migration."""
    n = conn.execute(
        "SELECT count(*) FROM critic_scores WHERE added_by LIKE 'magento_csv%'"
    ).fetchone()[0]
    assert n == EXPECTED_ROWS, (
        f"expected {EXPECTED_ROWS} curated rows, found {n} — migration lost or "
        f"duplicated rows"
    )


def test_badge_set_unchanged(conn):
    """INVARIANT: exactly the same SKUs carry a product badge after migration."""
    n = conn.execute(
        "SELECT count(*) FROM products WHERE score_summary IS NOT NULL"
    ).fetchone()[0]
    assert n == EXPECTED_BADGE_SKUS, (
        f"expected {EXPECTED_BADGE_SKUS} badged SKUs, found {n} — migration "
        f"changed which products show critic scores"
    )


def test_curated_rows_have_provenance_after_migration(conn):
    """INVARIANT (post-migration only): once the rich columns exist, every
    curated row has source/signal_tier/confidence populated — no NULL gaps
    that would make a curated row indistinguishable from an un-migrated one.

    Skips cleanly BEFORE migration (columns absent), so this file can be the
    pre-migration baseline too.
    """
    if not _has_columns(conn):
        pytest.skip("rich columns not yet added (pre-migration) — nothing to assert")
    missing = conn.execute("""
        SELECT count(*) FROM critic_scores
        WHERE added_by LIKE 'magento_csv%'
          AND (source IS NULL OR signal_tier IS NULL OR confidence IS NULL
               OR score_native IS NULL OR score_scale IS NULL)
    """).fetchone()[0]
    assert missing == 0, (
        f"{missing} curated rows have NULL provenance after migration — the "
        f"backfill UPDATE did not cover every row"
    )


def test_score_native_not_corrupted(conn):
    """INVARIANT (post-migration only): score_native is the published value,
    never a corrupted re-CAST. For the all-integer current data, score_native
    must equal the integer string of score (e.g. 91.0 -> '91', not '91.0').
    """
    if not _has_columns(conn):
        pytest.skip("rich columns not yet added (pre-migration)")
    bad = conn.execute("""
        SELECT id, score, score_native FROM critic_scores
        WHERE added_by LIKE 'magento_csv%'
          AND score = CAST(score AS INTEGER)
          AND score_native <> CAST(CAST(score AS INTEGER) AS TEXT)
        LIMIT 5
    """).fetchall()
    assert not bad, (
        f"score_native mismatch on {len(bad)}+ rows, e.g. "
        f"{[(r['id'], r['score'], r['score_native']) for r in bad]}"
    )


def test_migration_has_run(conn):
    """HARD assertion: once the migration is applied, the rich columns MUST exist.
    Converts the post-migration tests from 'silently skip forever' to a hard
    failure if the migration is expected but absent. Activate (un-skip) this only
    after the live migration in Task 5 — see the skip guard below."""
    if not _has_columns(conn):
        pytest.skip("pre-migration baseline — migration not yet applied")
    assert _has_columns(conn), "rich columns missing — migration did not apply"
