"""Unit tests for data/lib/enrichment/wine/validator.py."""
from __future__ import annotations

from data.lib.enrichment.wine import validator as v
from data.lib.enrichment.wine.evidence import Evidence, WinesensedMatch
from data.lib.enrichment.shared.taxonomies import food_pairing


FOOD_TAX = food_pairing.load_default()


def _good_response() -> dict:
    return {
        "wine_body": "Medium-Full",
        "wine_acidity": "Medium",
        "wine_tannin": "Medium-High",
        "grape_variety": ["Cabernet Sauvignon", "Merlot"],
        "grape_blend_type": "Bordeaux Red Blend",
        "wine_production_style": ["Conventional"],
        "flavor_tags": ["Blackcurrant", "Cedar", "Tobacco", "Dark Cherry", "Vanilla"],
        "food_matching": ["Grilled red meat", "Aged hard cheese", "Lamb dishes"],
        "desc_en_short": "Classic Bordeaux blend with cedar and dark fruit.",
        "full_description": "<p>" + ("A polished, age-worthy red showing dark fruit, fine tannin, and cedar notes from oak. " * 4) + "</p>",
        "confidence": 0.9,
        "confidence_notes": "Strong evidence.",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None, "grape_source": "products.grape_variety", "critic_scores": []},
    }


def _empty_evidence() -> Evidence:
    return Evidence(
        sku="TEST-1",
        facts={},
        winesensed_matches=(),
        brand_description=None,
        heuristic_profile="",
        critic_scores=(),
        quality_tier="C",
        evidence_hash="",
    )


class TestHappyPath:
    def test_clean_response_passes(self):
        r = _good_response()
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "passed"


class TestVocabRepair:
    def test_medium_heavy_body_repairs(self):
        r = _good_response()
        r["wine_body"] = "Medium-Heavy"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["wine_body"] == "Medium-Full"

    def test_invalid_body_rejects(self):
        r = _good_response()
        r["wine_body"] = "Effervescent"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"

    def test_blend_gsm_repairs(self):
        r = _good_response()
        r["grape_blend_type"] = "GSM"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["grape_blend_type"] == "Rhône South Blend (GSM)"


class TestFoodMatching:
    def test_unknown_food_label_drops(self):
        r = _good_response()
        r["food_matching"] = ["Grilled red meat", "Hovercraft eels"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        # 1 valid after drop → count < 3 → rejected
        assert result.outcome == "rejected"


class TestHallucinatedCitations:
    def test_winesensed_id_not_in_evidence_strips(self):
        r = _good_response()
        r["citations"]["winesensed_record_ids"] = ["fake-id-999"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["citations"]["winesensed_record_ids"] == []

    def test_real_winesensed_id_passes(self):
        evidence = Evidence(
            sku="TEST-1", facts={}, brand_description=None,
            winesensed_matches=(
                WinesensedMatch(record_id="ws-1", year=2020, region="Bordeaux", grape="Cab", rating=4.5, review_text="x", match_type="tight"),
            ),
            heuristic_profile="", critic_scores=(), quality_tier="B", evidence_hash="",
        )
        r = _good_response()
        r["citations"]["winesensed_record_ids"] = ["ws-1"]
        result = v.validate(r, evidence, FOOD_TAX)
        assert result.outcome == "passed"


class TestLengthChecks:
    def test_desc_short_too_long_rejects(self):
        r = _good_response()
        r["desc_en_short"] = "x" * 250
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome in ("repaired", "rejected")

    def test_full_description_too_short_rejects(self):
        r = _good_response()
        r["full_description"] = "<p>short</p>"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"


class TestConfidenceRange:
    def test_confidence_out_of_range_rejects(self):
        r = _good_response()
        r["confidence"] = 1.5
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"


def test_food_matching_strips_parenthetical_gloss():
    """Haiku returns glossed labels → validator strips the gloss and matches the bare label."""
    r = _good_response()
    r["food_matching"] = [
        "Grilled red meat (e.g. steak, ribeye; pairs with Full red)",
        "Lamb dishes (e.g. rack of lamb; pairs with Full red)",
        "Aged hard cheese (e.g. parmesan, manchego; pairs with Full red)",
    ]
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome != "rejected", f"validator rejected glossed labels: {result.issues}"
    assert result.repaired_json["food_matching"] == ["Grilled red meat", "Lamb dishes", "Aged hard cheese"]


def test_food_matching_strips_bracketed_gloss():
    """New renderer uses [examples: ...] — validator should also strip that."""
    r = _good_response()
    r["food_matching"] = [
        "Grilled red meat [examples: steak, ribeye; pairs with Full red]",
        "Lamb dishes [examples: rack of lamb]",
        "Aged hard cheese [examples: parmesan]",
    ]
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome != "rejected", f"validator rejected glossed labels: {result.issues}"
    assert result.repaired_json["food_matching"] == ["Grilled red meat", "Lamb dishes", "Aged hard cheese"]


def test_food_matching_exact_match_still_works():
    """Bare labels (no gloss) still match exactly — no regression."""
    r = _good_response()
    # _good_response already uses bare labels; just verify it still passes
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome == "passed"
    assert result.repaired_json["food_matching"] == ["Grilled red meat", "Aged hard cheese", "Lamb dishes"]


def test_food_matching_strips_surrounding_quotes():
    """If Haiku copies the prompt's quoted label format verbatim
    ('"Grilled red meat"'), the validator should strip the quotes and match."""
    r = _good_response()
    r["food_matching"] = ['"Grilled red meat"', '"Lamb dishes"', '"Aged hard cheese"']
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome != "rejected", f"validator rejected quoted labels: {result.issues}"
    assert result.repaired_json["food_matching"] == ["Grilled red meat", "Lamb dishes", "Aged hard cheese"]


def test_food_matching_strips_quotes_AND_gloss():
    """Worst case: Haiku emits both surrounding quotes AND the bracketed gloss.
    Validator should strip both and recover."""
    r = _good_response()
    r["food_matching"] = [
        '"Grilled red meat [examples: steak; pairs with Full red]"',
        '"Lamb dishes [examples: rack of lamb]"',
        '"Aged hard cheese [examples: parmesan]"',
    ]
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome != "rejected", f"validator rejected quote+gloss labels: {result.issues}"
    assert result.repaired_json["food_matching"] == ["Grilled red meat", "Lamb dishes", "Aged hard cheese"]


# ---------------------------------------------------------------------------
# Taste-profile unit tests (Task 1.2)
# ---------------------------------------------------------------------------

from pathlib import Path
from data.lib.enrichment.shared.vocab_loader import VocabLoader

VOCAB_FIXTURE = Path(__file__).parent / "fixtures" / "taste_vocab_min.yml"


def _load_fixture_vocab() -> VocabLoader:
    return VocabLoader.from_path(VOCAB_FIXTURE)


def _wine_payload(taste_profile: dict) -> dict:
    """Build a full v1-style payload with taste_profile attached for integration use."""
    payload = _good_response()
    payload["taste_profile"] = taste_profile
    return payload


def _tiered_tp(primary=None, secondary=None, tertiary=None) -> dict:
    return {
        "schema_version": "2.0",
        "structure": "tiered",
        "tiers": {
            "primary": primary or [],
            "secondary": secondary or [],
            "tertiary": tertiary or [],
        },
        "structural": {},
        "confidence": 0.9,
        "prompt_version": "v2.0",
        "enriched_at": "2026-05-25T00:00:00Z",
    }


class TestValidateTasteProfile:
    def test_taste_profile_canonical_notes_pass(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp(
            primary=[{"note": "Blackcurrant", "intensity": 3}],
            secondary=[{"note": "Cedar", "intensity": 2}],
            tertiary=[{"note": "Tobacco", "intensity": 1}],
        )
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is True
        assert result["unknown_notes"] == []

    def test_taste_profile_alias_is_repaired(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp(
            primary=[{"note": "cassis", "intensity": 3}],
        )
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is True
        assert tp["tiers"]["primary"][0]["note"] == "Blackcurrant"
        assert any("Blackcurrant" in r for r in result["repairs"])

    def test_taste_profile_unknown_note_rejected(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp(
            primary=[{"note": "Dragonfruit", "intensity": 2}],
        )
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is False
        assert "Dragonfruit" in result["unknown_notes"]

    def test_taste_profile_intensity_out_of_range_rejected(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp(
            primary=[{"note": "Blackcurrant", "intensity": 5}],
        )
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is False

    def test_taste_profile_minimum_content_enforced(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp()  # all tiers empty
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is False

    def test_taste_profile_auto_sorts_within_tier(self):
        vocab = _load_fixture_vocab()
        tp = _tiered_tp(
            primary=[
                {"note": "Blackcurrant", "intensity": 1},
                {"note": "Cedar", "intensity": 3},
            ],
        )
        result = v._validate_taste_profile(tp, vocab, classification="Red Wine")
        assert result["ok"] is True
        notes = tp["tiers"]["primary"]
        assert notes[0]["note"] == "Cedar"
        assert notes[1]["note"] == "Blackcurrant"
