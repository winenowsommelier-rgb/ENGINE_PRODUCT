"""Tests for the local SQLite → Supabase sync script.

Uses a mocked Supabase HTTP client (urllib.request.urlopen monkeypatch) so
no network call leaves the test.
"""
import json
import sqlite3
import urllib.error
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from scripts.sync_to_supabase import (
    plan_product_deltas,
    plan_cache_deltas,
    sync_products,
    sync_cache,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def db_with_updates(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, classification, wine_body, enrichment_confidence, enriched_at, updated_at) "
        "VALUES ('row-1','WRW1','Red Wine','Full-Bodied',0.9,'2026-05-21T10:00:00Z','2026-05-21T10:00:00Z')"
    )
    conn.execute(
        "INSERT INTO enrichment_cache (id, sku, category, prompt_hash, evidence_hash, prompt_text, "
        "response_json, model, tokens_in, tokens_out, cost_thb, confidence, validation_status, validation_issues, created_at) "
        "VALUES ('uuid-1','WRW1','wine','ph','eh','p','{}','m',1,1,0.1,0.9,'passed','[]','2026-05-21T10:00:00Z')"
    )
    conn.commit()
    conn.close()
    return db


def test_plan_product_deltas_finds_new_enriched_rows(db_with_updates):
    deltas = plan_product_deltas(db_with_updates, since=None)
    assert len(deltas) == 1
    assert deltas[0]["sku"] == "WRW1"


def test_plan_cache_deltas_finds_new_rows(db_with_updates):
    deltas = plan_cache_deltas(db_with_updates, since=None)
    assert len(deltas) == 1


def test_sync_products_idempotent(db_with_updates):
    """Second sync run should find 0 deltas."""
    mock_resp = MagicMock()
    mock_resp.__enter__.return_value.read.return_value = b'[]'
    with patch("urllib.request.urlopen", return_value=mock_resp) as m:
        n1 = sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=False)
        n2 = sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=False)
    assert n1 == 1
    assert n2 == 0


def test_dry_run_does_not_call_supabase(db_with_updates):
    with patch("urllib.request.urlopen") as m:
        sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=True)
    m.assert_not_called()


def test_sync_products_does_not_advance_watermark_past_failed_row(db_with_updates, monkeypatch):
    """Regression: if row B fails between successful A and C, watermark must
    NOT advance to C's timestamp — otherwise B is permanently skipped."""
    # Add two more products at later timestamps so we have A(T1), B(T2), C(T3)
    conn = sqlite3.connect(db_with_updates)
    conn.execute(
        "INSERT INTO products (id, sku, classification, enrichment_confidence, updated_at) "
        "VALUES ('row-2','WRW2','Red Wine',0.9,'2026-05-22T10:00:00Z')"
    )
    conn.execute(
        "INSERT INTO products (id, sku, classification, enrichment_confidence, updated_at) "
        "VALUES ('row-3','WRW3','Red Wine',0.9,'2026-05-23T10:00:00Z')"
    )
    conn.commit()
    conn.close()

    # Mock urlopen to fail for row-2 only (WRW2)
    call_count = {"n": 0}
    def fake_urlopen(req, timeout=30):
        call_count["n"] += 1
        if "WRW2" in req.full_url or call_count["n"] == 2:
            raise urllib.error.HTTPError(req.full_url, 500, "boom", {}, None)
        resp = MagicMock()
        resp.__enter__ = lambda self: self
        resp.__exit__ = lambda self, *a: None
        return resp

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=False)

    # Watermark should be at T1 (row-1's timestamp), NOT T3 — because row-2 failed
    conn = sqlite3.connect(db_with_updates)
    ts = conn.execute("SELECT last_synced_at FROM sync_state WHERE table_name='products'").fetchone()
    conn.close()
    assert ts is not None
    assert ts[0] == "2026-05-21T10:00:00Z", (
        f"Watermark should freeze at row-1's timestamp after row-2 failed; got {ts[0]}"
    )
