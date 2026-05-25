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
    sync_product_taste_notes,
    enqueue_similarity_dirty,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"
TASTE_SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-25_taste_taxonomy_sqlite.sql"


@pytest.fixture
def db_with_updates(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.executescript(TASTE_SCHEMA_SQL.read_text())
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


# ---------------------------------------------------------------------------
# Taste-taxonomy tests (Task 1.4)
# ---------------------------------------------------------------------------

@pytest.fixture
def db_with_taste(tmp_path):
    """DB with taste schema + one product that has a taste_profile + 3 note rows."""
    db = tmp_path / "taste.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.executescript(TASTE_SCHEMA_SQL.read_text())
    taste = json.dumps({"schema_version": "2.0", "primary": ["cherry", "oak", "vanilla"]})
    conn.execute(
        "INSERT INTO products (id, sku, classification, wine_body, enrichment_confidence, "
        "enriched_at, updated_at, taste_profile) "
        "VALUES ('p1','SKU1','Red Wine','Full-Bodied',0.9,'2026-05-25T10:00:00Z','2026-05-25T10:00:00Z',?)",
        (taste,),
    )
    for note, tier, intensity, family in [
        ("cherry", "primary", 3, "fruit"),
        ("oak", "secondary", 2, "wood"),
        ("vanilla", "tertiary", 1, "spice"),
    ]:
        conn.execute(
            "INSERT INTO product_taste_notes (product_id, note, tier, intensity, note_family) "
            "VALUES ('p1',?,?,?,?)",
            (note, tier, intensity, family),
        )
    conn.commit()
    conn.close()
    return db


def _make_ctx_mgr():
    """Return a MagicMock that behaves as a context manager (urllib response)."""
    m = MagicMock()
    m.__enter__ = lambda self: self
    m.__exit__ = lambda self, *a: None
    return m


def test_product_taste_notes_synced_after_products(db_with_taste):
    """PATCH products → DELETE notes → POST notes → POST similar_dirty, in order."""
    calls = []

    def fake_urlopen(req, timeout=30):
        calls.append((req.method, req.full_url))
        return _make_ctx_mgr()

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        n = sync_products(db_with_taste, supabase_url="https://sb", api_key="k", dry_run=False)

    assert n == 1
    methods_urls = [(m, u) for m, u in calls]
    # 1st call: PATCH products
    assert methods_urls[0][0] == "PATCH"
    assert "/rest/v1/products" in methods_urls[0][1]
    # 2nd call: DELETE product_taste_notes
    assert methods_urls[1][0] == "DELETE"
    assert "/rest/v1/product_taste_notes" in methods_urls[1][1]
    # 3rd call: POST (bulk insert) product_taste_notes
    assert methods_urls[2][0] == "POST"
    assert "/rest/v1/product_taste_notes" in methods_urls[2][1]
    # 4th call: POST product_similar_dirty
    assert methods_urls[3][0] == "POST"
    assert "/rest/v1/product_similar_dirty" in methods_urls[3][1]


def test_taste_profile_decoded_from_json_string_before_patch(db_with_taste):
    """taste_profile stored as a JSON string in SQLite must arrive as a dict in the PATCH body."""
    received_body = {}

    def fake_urlopen(req, timeout=30):
        if req.method == "PATCH" and "/rest/v1/products" in req.full_url:
            received_body.update(json.loads(req.data.decode("utf-8")))
        return _make_ctx_mgr()

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        sync_products(db_with_taste, supabase_url="https://sb", api_key="k", dry_run=False)

    assert "taste_profile" in received_body, "taste_profile must be in PATCH body"
    assert isinstance(received_body["taste_profile"], dict), (
        f"Expected dict, got {type(received_body['taste_profile'])}"
    )
    assert received_body["taste_profile"]["schema_version"] == "2.0"


def test_skip_taste_notes_flag(db_with_taste):
    """--skip-taste-notes: no calls to /product_taste_notes or /product_similar_dirty."""
    called_urls = []

    def fake_urlopen(req, timeout=30):
        called_urls.append(req.full_url)
        return _make_ctx_mgr()

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        sync_products(db_with_taste, supabase_url="https://sb", api_key="k",
                      dry_run=False, skip_taste_notes=True)

    assert all("/product_taste_notes" not in u for u in called_urls), (
        "No taste note calls expected with skip_taste_notes=True"
    )
    assert all("/product_similar_dirty" not in u for u in called_urls), (
        "No similar-dirty calls expected with skip_taste_notes=True"
    )


def test_no_taste_profile_skips_notes_sync_for_that_product(tmp_path):
    """A product with NULL taste_profile must not trigger taste-notes or dirty-queue calls."""
    db = tmp_path / "no_taste.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.executescript(TASTE_SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, classification, enrichment_confidence, "
        "enriched_at, updated_at) "
        "VALUES ('p2','SKU2','White Wine',0.8,'2026-05-25T11:00:00Z','2026-05-25T11:00:00Z')"
    )
    conn.commit()
    conn.close()

    called_urls = []

    def fake_urlopen(req, timeout=30):
        called_urls.append(req.full_url)
        return _make_ctx_mgr()

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        n = sync_products(db, supabase_url="https://sb", api_key="k", dry_run=False)

    assert n == 1
    assert all("/product_taste_notes" not in u for u in called_urls)
    assert all("/product_similar_dirty" not in u for u in called_urls)
