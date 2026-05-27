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


def test_local_router_writes_below_threshold_with_low_conf_tier(db_with_product):
    """REGRESSION GUARD — DO NOT TIGHTEN THIS BACK.

    Before 2026-05-27, LocalRouter skipped the descriptive write when
    final_confidence < write_threshold (0.85). Phase 5 typically produced
    final_confidence 0.55-0.74, so ~3,807 paid Anthropic enrichments were
    silently discarded — products.desc_en_short / wine_body / flavor_tags /
    food_matching stayed NULL despite ~$56 spent on the API. The data only
    survived in enrichment_cache.response_json and a CSV export.

    Correct behavior: ALWAYS write the descriptive payload when a response
    is provided. write_threshold drives only the `enrichment_source` tier
    label so downstream consumers can still filter to high-conf rows.
    """
    from data.lib.enrichment.wine.local_router import LocalRouter
    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    wrote = router.update_product(
        products_id="row-1",
        response={
            "wine_body": "Full",
            "wine_acidity": "Medium",
            "wine_tannin": "Medium-High",
            "grape_variety": ["Cabernet Sauvignon"],
            "grape_blend_type": "Single-Variety",
            "wine_production_style": [],
            "flavor_tags": ["blackcurrant", "cedar"],
            "food_matching": ["Grilled red meat"],
            "desc_en_short": "Sub-threshold but real enrichment.",
            "full_description": "<p>Body of the description.</p>",
        },
        final_confidence=0.62,  # sub-threshold
        model="claude-haiku-4-5",
        enrichment_note="Haiku/B",
        enriched_at="2026-05-27T10:00:00Z",
    )
    assert wrote is True  # the write happened

    conn = sqlite3.connect(db_with_product)
    row = conn.execute(
        "SELECT wine_body, desc_en_short, full_description, flavor_tags, "
        "food_matching, enrichment_source, enrichment_confidence "
        "FROM products WHERE id='row-1'"
    ).fetchone()
    # CRITICAL: every descriptive field must be populated
    assert row[0] == "Full", "wine_body was dropped (Phase-5 bug regression)"
    assert row[1] == "Sub-threshold but real enrichment.", "desc_en_short was dropped"
    assert "<p>" in (row[2] or ""), "full_description was dropped"
    assert "blackcurrant" in (row[3] or ""), "flavor_tags was dropped"
    assert "Grilled red meat" in (row[4] or ""), "food_matching was dropped"
    # Tier label distinguishes confidence band without losing data
    assert row[5] == "ai_low_conf"
    assert row[6] == 0.62


def test_local_router_marks_high_conf_tier(db_with_product):
    """Above-threshold writes get the 'ai_high_conf' source label."""
    from data.lib.enrichment.wine.local_router import LocalRouter
    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    router.update_product(
        products_id="row-1",
        response={
            "wine_body": "Full",
            "wine_acidity": "Medium",
            "wine_tannin": "High",
            "grape_variety": ["Cabernet"],
            "grape_blend_type": "Single-Variety",
            "wine_production_style": [],
            "flavor_tags": ["dark fruit"],
            "food_matching": ["Grilled red meat"],
            "desc_en_short": "High-conf wine.",
            "full_description": "<p>High-conf body text here.</p>",
        },
        final_confidence=0.92,
        model="claude-haiku-4-5",
        enrichment_note="Haiku/A",
        enriched_at="2026-05-27T11:00:00Z",
    )
    conn = sqlite3.connect(db_with_product)
    source = conn.execute(
        "SELECT enrichment_source FROM products WHERE id='row-1'"
    ).fetchone()[0]
    assert source == "ai_high_conf"
