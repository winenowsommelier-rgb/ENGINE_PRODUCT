"""Tests for P2 taste_profile backfill — pure, no-API logic.

parse_taste_profile(text, vocab) -> a schema-2.0 tiered taste_profile dict, or
raises. It validates:
  - JSON with primary/secondary/tertiary lists
  - each note is in the controlled vocab (canonical name substituted)
  - intensity coerced to int 1..3
  - off-vocab notes are DROPPED (not fatal); a tier with no valid notes is allowed
    empty, but the whole profile must have >=1 valid note total or it raises.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from data.lib.enrichment.shared.vocab_loader import VocabLoader
from scripts.backfill_taste_profile import (
    build_taste_facts,
    parse_taste_profile,
    TasteProfileError,
)

VOCAB_PATH = Path(__file__).resolve().parent.parent / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"


@pytest.fixture(scope="module")
def vocab() -> VocabLoader:
    return VocabLoader.from_path(VOCAB_PATH)


def test_build_facts_includes_flavor_tags_when_present():
    p = {"sku": "W1", "name": "X", "grape_variety": "Merlot", "region": "Bordeaux",
         "country": "France", "flavor_tags": ["Blackcurrant", "Cedar"], "margin_pct": 9}
    facts = build_taste_facts(p)
    assert facts["flavor_tags"] == ["Blackcurrant", "Cedar"]
    assert "margin_pct" not in facts  # no leak


def test_build_facts_empty_flavor_tags_when_absent():
    facts = build_taste_facts({"sku": "W1", "name": "X", "grape_variety": "Merlot"})
    assert facts["flavor_tags"] == []


def test_parse_valid_tiered_profile(vocab):
    text = '{"primary":[{"note":"Blackcurrant","intensity":3}],"secondary":[{"note":"Oak","intensity":2}],"tertiary":[{"note":"Leather","intensity":1}]}'
    out = parse_taste_profile(text, vocab)
    assert out["schema_version"] == "2.0"
    assert out["structure"] == "tiered"
    assert out["tiers"]["primary"] == [{"note": "Blackcurrant", "intensity": 3}]
    assert out["tiers"]["secondary"] == [{"note": "Oak", "intensity": 2}]
    assert out["tiers"]["tertiary"] == [{"note": "Leather", "intensity": 1}]


def test_parse_substitutes_canonical_note_name(vocab):
    # "cassis" is an alias of Blackcurrant -> canonical name substituted.
    text = '{"primary":[{"note":"cassis","intensity":2}],"secondary":[],"tertiary":[]}'
    out = parse_taste_profile(text, vocab)
    assert out["tiers"]["primary"] == [{"note": "Blackcurrant", "intensity": 2}]


def test_parse_drops_off_vocab_notes_but_keeps_valid(vocab):
    text = '{"primary":[{"note":"Oak","intensity":3},{"note":"Quux nonsense","intensity":2}],"secondary":[],"tertiary":[]}'
    out = parse_taste_profile(text, vocab)
    assert out["tiers"]["primary"] == [{"note": "Oak", "intensity": 3}]


def test_parse_coerces_intensity_into_range(vocab):
    text = '{"primary":[{"note":"Oak","intensity":5},{"note":"Cedar","intensity":0}],"secondary":[],"tertiary":[]}'
    out = parse_taste_profile(text, vocab)
    assert out["tiers"]["primary"] == [{"note": "Oak", "intensity": 3}, {"note": "Cedar", "intensity": 1}]


def test_parse_raises_when_no_valid_notes_anywhere(vocab):
    text = '{"primary":[{"note":"Quux","intensity":2}],"secondary":[],"tertiary":[]}'
    with pytest.raises(TasteProfileError):
        parse_taste_profile(text, vocab)


def test_parse_raises_on_non_json(vocab):
    with pytest.raises(TasteProfileError):
        parse_taste_profile("I don't know this wine.", vocab)
