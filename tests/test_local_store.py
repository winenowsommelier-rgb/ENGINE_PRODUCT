"""Tests for SQLite-backed enrichment store."""
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


def _bootstrap_db(tmp_path: Path) -> sqlite3.Connection:
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    return conn


def test_schema_creates_expected_tables(tmp_path):
    conn = _bootstrap_db(tmp_path)
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    names = {r[0] for r in rows}
    assert {"products", "enrichment_cache", "enrichment_failures", "critic_scores", "sync_state"} <= names


def test_products_has_enrichment_columns(tmp_path):
    conn = _bootstrap_db(tmp_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)").fetchall()}
    required = {
        "id", "sku", "name", "brand", "classification",
        "wine_body", "wine_acidity", "wine_tannin",
        "grape_variety", "grape_blend_type", "wine_production_style",
        "flavor_tags", "food_matching", "full_description", "desc_en_short",
        "score_max", "score_summary",
        "enrichment_confidence", "enriched_at", "enriched_by", "validation_status",
    }
    assert required <= cols, f"missing: {required - cols}"


def test_enrichment_failures_table_shape(tmp_path):
    conn = _bootstrap_db(tmp_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(enrichment_failures)").fetchall()}
    assert cols >= {"id", "sku", "failure_type", "raw_response", "validation_issues", "created_at"}


# ---------------------------------------------------------------------------
# Task 3 — LocalCache + FailureLogger tests
# ---------------------------------------------------------------------------
from data.lib.enrichment.shared.local_store import LocalCache


def _make_cache(tmp_path):
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.close()
    return LocalCache(db_path=db_path)


def test_local_cache_write_then_lookup_returns_row(tmp_path):
    cache = _make_cache(tmp_path)
    cache.write(
        sku="WRW1234", category="wine",
        prompt_hash="ph1", evidence_hash="eh1",
        prompt_text="prompt", response_json={"wine_body": "Medium-Bodied"},
        response_raw='{"wine_body":"Medium-Bodied"}',
        model="claude-haiku-4-5", tokens_in=100, tokens_out=50,
        cost_thb=0.15, confidence=0.82,
        validation_status="passed", validation_issues=[],
    )
    hit = cache.lookup(sku="WRW1234", prompt_hash="ph1", evidence_hash="eh1")
    assert hit is not None
    assert hit["response_json"]["wine_body"] == "Medium-Bodied"
    assert hit["validation_status"] == "passed"


def test_local_cache_write_supersedes_prior_active_row(tmp_path):
    cache = _make_cache(tmp_path)
    cache.write(sku="WRW1", category="wine", prompt_hash="p1", evidence_hash="e1",
                prompt_text="x", response_json={}, response_raw="",
                model="m", tokens_in=1, tokens_out=1, cost_thb=0.0,
                confidence=0.5, validation_status="passed", validation_issues=[])
    cache.write(sku="WRW1", category="wine", prompt_hash="p2", evidence_hash="e2",
                prompt_text="y", response_json={}, response_raw="",
                model="m", tokens_in=1, tokens_out=1, cost_thb=0.0,
                confidence=0.6, validation_status="passed", validation_issues=[])
    # Old row superseded
    import sqlite3
    conn = sqlite3.connect(cache.db_path)
    active = conn.execute(
        "SELECT prompt_hash FROM enrichment_cache WHERE sku='WRW1' AND superseded_at IS NULL"
    ).fetchall()
    assert len(active) == 1
    assert active[0][0] == "p2"


def test_local_cache_lookup_miss_returns_none(tmp_path):
    cache = _make_cache(tmp_path)
    assert cache.lookup(sku="NOPE", prompt_hash="x", evidence_hash="y") is None


def test_failure_logger_records_parse_failure(tmp_path):
    from data.lib.enrichment.shared.local_store import FailureLogger
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.close()

    logger = FailureLogger(db_path=db_path)
    logger.log(
        sku="WRW9999", failure_type="parse",
        raw_response="not json at all", validation_issues=[],
        prompt_hash="ph", evidence_hash="eh", model="m",
        tokens_in=10, tokens_out=20, cost_thb=0.05,
    )
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT failure_type, raw_response FROM enrichment_failures WHERE sku='WRW9999'"
    ).fetchone()
    assert row == ("parse", "not json at all")


def test_local_cache_many_lookups_does_not_leak_connections(tmp_path):
    """Regression test: lookup/write must close the SQLite connection.
    With Python 3.9's sqlite3 context manager, `with conn:` commits but does
    NOT close, so the implementation must close explicitly in a finally block.
    Without that fix, a 6k-SKU batch run would exhaust file handles."""
    cache = _make_cache(tmp_path)
    # Write one row
    cache.write(sku="WRW1", category="wine", prompt_hash="p", evidence_hash="e",
                prompt_text="x", response_json={}, response_raw="",
                model="m", tokens_in=1, tokens_out=1, cost_thb=0.0,
                confidence=0.5, validation_status="passed", validation_issues=[])
    # 200 lookups — well below file handle limits if connections are closed,
    # comfortably above the ~64-256 default limits if they're leaked.
    for _ in range(200):
        cache.lookup(sku="WRW1", prompt_hash="p", evidence_hash="e")
    # If we got here without OSError "too many open files", we're good.
