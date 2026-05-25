"""Tests for LocalRouter.update_product taste_profile / product_taste_notes wiring."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"
TASTE_SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-25_taste_taxonomy_sqlite.sql"
VOCAB_MIN = REPO_ROOT / "tests" / "fixtures" / "taste_vocab_min.yml"

_SAMPLE_RESPONSE = {
    "wine_body": "Full-Bodied",
    "wine_acidity": "Medium",
    "wine_tannin": "Firm",
    "grape_variety": ["Cabernet Sauvignon"],
    "grape_blend_type": "Single Varietal",
    "wine_production_style": [],
    "flavor_tags": ["dark fruit", "cedar"],
    "food_matching": ["Grilled red meat"],
    "desc_en_short": "A bold Bordeaux.",
    "full_description": "<p>Rich and complex.</p>",
    "confidence": 0.92,
}

_SAMPLE_TASTE = {
    "schema_version": "2.0",
    "structure": "tiered",
    "tiers": {
        "primary": [{"note": "Blackcurrant", "intensity": 3}],
        "secondary": [{"note": "Cedar", "intensity": 2}],
        "tertiary": [{"note": "Tobacco", "intensity": 1}],
    },
    "structural": {"body": "Full", "acidity": "Medium", "tannin": "Firm"},
    "confidence": 0.88,
    "prompt_version": "2.0.0",
    "enriched_at": "2026-05-25T10:00:00Z",
}


@pytest.fixture
def db_with_v2_schema(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    # Apply taste taxonomy schema (ALTER TABLE + new tables)
    for stmt in TASTE_SCHEMA_SQL.read_text().split(";"):
        stmt = stmt.strip()
        if stmt:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # tolerate "duplicate column" on re-apply
    conn.execute(
        "INSERT INTO products (id, sku, name, classification) VALUES (?,?,?,?)",
        ("row-1", "WRW1", "Test Wine", "Red Wine"),
    )
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def vocab():
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    return VocabLoader.from_path(VOCAB_MIN)


def _make_router(db_path):
    from data.lib.enrichment.wine.local_router import LocalRouter
    return LocalRouter(db_path=db_path, write_threshold=0.85)


# ---------------------------------------------------------------------------
# Test 1 — happy path: taste_profile written, notes indexed, dirty queued
# ---------------------------------------------------------------------------

def test_update_product_writes_taste_profile(db_with_v2_schema, vocab):
    router = _make_router(db_with_v2_schema)
    wrote = router.update_product(
        products_id="row-1",
        response=_SAMPLE_RESPONSE,
        final_confidence=0.92,
        model="claude-haiku-4-5",
        enrichment_note="Haiku/A",
        enriched_at="2026-05-25T10:00:00Z",
        taste_profile=_SAMPLE_TASTE,
        vocab=vocab,
    )
    assert wrote is True

    conn = sqlite3.connect(db_with_v2_schema)

    # taste_profile column is populated
    tp_raw = conn.execute(
        "SELECT taste_profile FROM products WHERE id='row-1'"
    ).fetchone()[0]
    assert tp_raw is not None
    tp = json.loads(tp_raw)
    assert tp["structure"] == "tiered"
    assert tp["schema_version"] == "2.0"

    # product_taste_notes rows
    rows = conn.execute(
        "SELECT note, tier, intensity, note_family FROM product_taste_notes"
        " WHERE product_id='row-1' ORDER BY tier, note"
    ).fetchall()
    assert len(rows) == 3
    by_note = {r[0]: r for r in rows}

    assert by_note["Blackcurrant"][1] == "primary"
    assert by_note["Blackcurrant"][2] == 3
    assert by_note["Blackcurrant"][3] == "fruit.black"  # from vocab fixture

    assert by_note["Cedar"][1] == "secondary"
    assert by_note["Cedar"][3] == "wood"

    assert by_note["Tobacco"][1] == "tertiary"
    assert by_note["Tobacco"][3] == "earth.aged"

    # dirty queue
    dirty = conn.execute(
        "SELECT product_id FROM product_similar_dirty WHERE product_id='row-1'"
    ).fetchone()
    assert dirty is not None

    conn.close()


# ---------------------------------------------------------------------------
# Test 2 — no taste_profile: notes table and dirty queue untouched
# ---------------------------------------------------------------------------

def test_update_product_with_no_taste_profile_unchanged(db_with_v2_schema, vocab):
    router = _make_router(db_with_v2_schema)
    wrote = router.update_product(
        products_id="row-1",
        response=_SAMPLE_RESPONSE,
        final_confidence=0.92,
        model="claude-haiku-4-5",
        enrichment_note="Haiku/A",
        enriched_at="2026-05-25T10:00:00Z",
        # no taste_profile kwarg
    )
    assert wrote is True

    conn = sqlite3.connect(db_with_v2_schema)
    note_count = conn.execute(
        "SELECT COUNT(*) FROM product_taste_notes WHERE product_id='row-1'"
    ).fetchone()[0]
    assert note_count == 0

    dirty_count = conn.execute(
        "SELECT COUNT(*) FROM product_similar_dirty WHERE product_id='row-1'"
    ).fetchone()[0]
    assert dirty_count == 0

    tp_raw = conn.execute(
        "SELECT taste_profile FROM products WHERE id='row-1'"
    ).fetchone()[0]
    assert tp_raw is None

    conn.close()


# ---------------------------------------------------------------------------
# Test 3 — refresh replaces prior notes (DELETE-then-INSERT semantics)
# ---------------------------------------------------------------------------

def test_update_product_taste_profile_refresh_replaces_prior(db_with_v2_schema, vocab):
    router = _make_router(db_with_v2_schema)

    first_taste = {
        "schema_version": "2.0",
        "structure": "tiered",
        "tiers": {
            "primary": [{"note": "Blackcurrant", "intensity": 3}],
            "secondary": [{"note": "Cedar", "intensity": 2}],
            "tertiary": [],
        },
        "structural": {},
        "confidence": 0.85,
        "prompt_version": "2.0.0",
        "enriched_at": "2026-05-25T09:00:00Z",
    }
    second_taste = {
        "schema_version": "2.0",
        "structure": "tiered",
        "tiers": {
            "primary": [],
            "secondary": [{"note": "Cedar", "intensity": 2}],
            "tertiary": [{"note": "Tobacco", "intensity": 1}],
        },
        "structural": {},
        "confidence": 0.87,
        "prompt_version": "2.0.0",
        "enriched_at": "2026-05-25T10:30:00Z",
    }

    router.update_product(
        products_id="row-1", response=_SAMPLE_RESPONSE, final_confidence=0.92,
        model="m", enrichment_note="n", enriched_at="2026-05-25T09:00:00Z",
        taste_profile=first_taste, vocab=vocab,
    )
    router.update_product(
        products_id="row-1", response=_SAMPLE_RESPONSE, final_confidence=0.92,
        model="m", enrichment_note="n", enriched_at="2026-05-25T10:30:00Z",
        taste_profile=second_taste, vocab=vocab,
    )

    conn = sqlite3.connect(db_with_v2_schema)
    rows = conn.execute(
        "SELECT note FROM product_taste_notes WHERE product_id='row-1' ORDER BY note"
    ).fetchall()
    notes = {r[0] for r in rows}
    # Only Cedar + Tobacco should remain (Blackcurrant deleted on second call)
    assert notes == {"Cedar", "Tobacco"}
    conn.close()
