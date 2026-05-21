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
