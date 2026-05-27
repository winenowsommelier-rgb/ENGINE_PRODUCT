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


def test_pairing_rationale_accepted_when_under_500_chars():
    """Optional pairing_rationale field passes through when present + sized OK."""
    r = _good_response()
    r["pairing_rationale"] = "The blackcurrant primary calls for lamb; cedar secondary suggests rosemary."
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome in ("passed", "repaired")
    assert result.repaired_json["pairing_rationale"].startswith("The blackcurrant primary")


def test_pairing_rationale_truncated_when_over_500_chars():
    """500+ char rationale is truncated (non-fatal repair, not rejection)."""
    r = _good_response()
    long_text = "The blackcurrant primary calls for lamb. " * 20  # ~820 chars
    r["pairing_rationale"] = long_text
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome in ("passed", "repaired")
    assert len(result.repaired_json["pairing_rationale"]) <= 500
    assert "truncated" in " ".join(result.issues)


def test_pairing_rationale_absent_passes():
    """No pairing_rationale field is fine — it's optional."""
    r = _good_response()
    r.pop("pairing_rationale", None)
    result = v.validate(r, _empty_evidence(), FOOD_TAX)
    assert result.outcome in ("passed", "repaired")


def _beer_evidence() -> Evidence:
    return Evidence(
        sku="BEER-1",
        facts={"classification": "Beer"},
        winesensed_matches=(),
        brand_description=None,
        heuristic_profile="",
        critic_scores=(),
        quality_tier="C",
        evidence_hash="",
    )


def _beer_response() -> dict:
    """Minimal valid response for a Beer SKU — non-wine family, null structural axes."""
    return {
        "wine_body": None,
        "wine_acidity": None,
        "wine_tannin": None,
        "grape_variety": [],
        "grape_blend_type": None,
        "wine_production_style": [],
        "flavor_tags": ["Hop", "Citrus", "Bitter", "Crisp", "Floral"],
        "food_matching": ["Pizza & flatbreads", "Tapas & small plates", "Pork dishes"],
        "desc_en_short": "Refreshing IPA with hop-forward citrus and floral aroma.",
        "full_description": "<p>" + ("Bright pale ale with assertive hop bitterness and a clean malt backbone. " * 4) + "</p>",
        "confidence": 0.85,
        "confidence_notes": "Standard IPA profile.",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None, "grape_source": "", "critic_scores": []},
    }


class TestNonWineFamilyNullAxes:
    """Phase-5 retros: 240+ rejections were caused by demanding wine_body/etc
    on Beer/Liqueur/RTD. Non-wine families should accept null (or 'N/A'-shaped
    strings) instead of forcing a doomed retry."""

    def test_beer_with_null_body_passes(self):
        result = v.validate(_beer_response(), _beer_evidence(), FOOD_TAX)
        assert result.outcome in ("passed", "repaired"), result.issues

    def test_beer_with_na_strings_accepted_as_null(self):
        r = _beer_response()
        r["wine_body"] = "N/A"
        r["wine_acidity"] = "None"
        r["wine_tannin"] = ""
        result = v.validate(r, _beer_evidence(), FOOD_TAX)
        assert result.outcome in ("passed", "repaired"), result.issues
        assert result.repaired_json["wine_body"] is None
        assert result.repaired_json["wine_acidity"] is None
        assert result.repaired_json["wine_tannin"] is None

    def test_beer_with_real_body_value_still_validated(self):
        """If model DOES provide a value for a non-wine family, validate it
        normally — don't silently null it out."""
        r = _beer_response()
        r["wine_body"] = "Light"  # valid BODY_VALUES entry
        result = v.validate(r, _beer_evidence(), FOOD_TAX)
        assert result.outcome in ("passed", "repaired")
        assert result.repaired_json["wine_body"] == "Light"

    def test_beer_with_invalid_body_still_rejects(self):
        """Non-null garbage still fails — only N/A-shaped null gets a pass."""
        r = _beer_response()
        r["wine_body"] = "Effervescent"
        result = v.validate(r, _beer_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"


class TestFoodMatchingFuzzy:
    """Phase-5 retros: ~50 retries on food labels like 'Foie gras & pâté' that
    have an unambiguous taxonomy correspondence. Conservative subset-superset
    fuzzy match salvages safe cases."""

    def test_seafood_resolves_to_oysters_and_raw_seafood(self):
        # 'Seafood' tokens ⊂ 'Oysters & raw seafood' tokens, unique → match
        r = _good_response()
        r["food_matching"] = ["Grilled red meat", "Lamb dishes", "Seafood"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert "Oysters & raw seafood" in result.repaired_json["food_matching"]
        assert any("fuzzy" in i for i in result.issues)

    def test_ambiguous_desserts_not_salvaged(self):
        # 'Desserts' is ⊂ Fruit desserts AND ⊂ Creamy desserts & pastries → ambiguous → drop
        r = _good_response()
        r["food_matching"] = ["Grilled red meat", "Lamb dishes", "Aged hard cheese", "Desserts"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert "Fruit desserts" not in result.repaired_json["food_matching"]
        assert "Creamy desserts & pastries" not in result.repaired_json["food_matching"]

    def test_greedy_gloss_strip_for_label_with_internal_punctuation(self):
        # Prompt-gloss with internal `;` and `,` — lazy regex bails, greedy salvages
        r = _good_response()
        r["food_matching"] = [
            "Grilled red meat (e.g. steak, ribeye; pairs with Full red / Medium-Full)",
            "Lamb dishes",
            "Aged hard cheese",
        ]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert "Grilled red meat" in result.repaired_json["food_matching"]
