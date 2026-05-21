"""Tests for the SQLite-backed product UPDATE half of the output router."""
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def db_with_product(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, name, classification) VALUES (?,?,?,?)",
        ("row-1", "WRW1", "Old name", "Red Wine"),
    )
    conn.commit()
    conn.close()
    return db


def test_local_router_updates_high_conf_row(db_with_product):
    from data.lib.enrichment.wine.local_router import LocalRouter

    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    wrote = router.update_product(
        products_id="row-1",
        response={
            "wine_body": "Full-Bodied",
            "wine_acidity": "Medium",
            "wine_tannin": "Firm",
            "grape_variety": ["Cabernet Sauvignon"],
            "grape_blend_type": "varietal",
            "wine_production_style": ["organic"],
            "flavor_tags": ["dark fruit", "cedar"],
            "food_matching": ["red meat", "aged cheese"],
            "desc_en_short": "Bold Napa Cab",
            "full_description": "<p>Long form.</p>",
        },
        final_confidence=0.9,
        model="claude-haiku-4-5",
        enrichment_note="Haiku/A",
        enriched_at="2026-05-21T10:00:00Z",
        score_max=92.0,
        score_summary="JS 92",
    )
    assert wrote is True

    import json as _json

    conn = sqlite3.connect(db_with_product)
    row = conn.execute(
        "SELECT wine_body, enrichment_confidence, enrichment_source, "
        "wine_production_style, flavor_tags, grape_variety, food_matching "
        "FROM products WHERE id='row-1'"
    ).fetchone()
    assert row[0] == "Full-Bodied"
    assert row[1] == pytest.approx(0.9)
    assert row[2] == "ai_high_conf"
    # Verify list-shaped fields are encoded per the spec
    assert _json.loads(row[3]) == ["organic"], "wine_production_style must be JSON-encoded list"
    assert _json.loads(row[4]) == ["dark fruit", "cedar"], "flavor_tags must be JSON-encoded list"
    assert row[5] == "Cabernet Sauvignon", "grape_variety must be comma-joined string"
    assert row[6] == "red meat, aged cheese", "food_matching must be comma-joined string"


def test_local_router_skips_below_threshold(db_with_product):
    from data.lib.enrichment.wine.local_router import LocalRouter
    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    wrote = router.update_product(
        products_id="row-1", response={"wine_body": "Full-Bodied"},
        final_confidence=0.7, model="m", enrichment_note="n",
        enriched_at="2026-05-21T10:00:00Z",
    )
    assert wrote is False

    conn = sqlite3.connect(db_with_product)
    body = conn.execute("SELECT wine_body FROM products WHERE id='row-1'").fetchone()[0]
    assert body is None  # unchanged
