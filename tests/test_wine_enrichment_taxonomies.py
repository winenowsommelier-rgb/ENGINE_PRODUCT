"""Unit tests for data/lib/enrichment/wine/taxonomies.py."""
from __future__ import annotations

from data.lib.enrichment.wine import taxonomies as tax


class TestEnums:
    def test_body_values(self):
        assert tax.BODY_VALUES == ("Light", "Medium", "Medium-Full", "Full")

    def test_acidity_values(self):
        assert tax.ACIDITY_VALUES == ("Low", "Medium", "Medium-High", "High")

    def test_tannin_values(self):
        assert tax.TANNIN_VALUES == ("Low", "Medium", "Medium-High", "High")

    def test_blend_types_count(self):
        assert len(tax.BLEND_TYPES) == 12
        assert "Single Varietal" in tax.BLEND_TYPES
        assert "Bordeaux Red Blend" in tax.BLEND_TYPES
        assert "Bordeaux White Blend" in tax.BLEND_TYPES
        assert "Rhône South Blend (GSM)" in tax.BLEND_TYPES
        assert "Super Tuscan" in tax.BLEND_TYPES
        assert "Unknown Blend" in tax.BLEND_TYPES

    def test_production_styles_count(self):
        assert len(tax.PRODUCTION_STYLES) == 7
        assert {"Conventional", "Natural", "Biodynamic", "Organic", "Orange", "Pet-Nat", "Vegan"} == set(tax.PRODUCTION_STYLES)


class TestHeuristics:
    def test_known_grape_region_combo(self):
        result = tax.heuristic_for("Shiraz", "Barossa Valley", "Red Wine")
        assert "Full body" in result or "full body" in result.lower()
        assert "tannin" in result.lower()

    def test_known_pinot_burgundy(self):
        result = tax.heuristic_for("Pinot Noir", "Burgundy", "Red Wine")
        assert "Pinot" in result or "pinot" in result.lower() or "cherry" in result.lower()

    def test_unknown_grape_falls_back_to_classification(self):
        result = tax.heuristic_for("Obscure Grape", "Unknown Region", "Red Wine")
        assert result
        assert "Red Wine" in result or "red wine" in result.lower() or "tannin" in result.lower()

    def test_blank_classification_returns_neutral(self):
        result = tax.heuristic_for("", "", "")
        assert isinstance(result, str)


class TestFuzzyVocabRepair:
    def test_medium_heavy_repairs_to_medium_full(self):
        assert tax.repair_body("Medium-Heavy") == "Medium-Full"

    def test_light_medium_repairs_to_medium(self):
        assert tax.repair_body("Light-Medium") == "Medium"

    def test_known_value_passes_through(self):
        assert tax.repair_body("Full") == "Full"

    def test_unknown_returns_none(self):
        assert tax.repair_body("Sparkling") is None

    def test_blend_type_gsm_repairs(self):
        assert tax.repair_blend_type("GSM") == "Rhône South Blend (GSM)"
        assert tax.repair_blend_type("Rhone Blend") == "Rhône South Blend (GSM)"


def test_food_taxonomy_prompt_block_wraps_label_in_quotes():
    """The rendered prompt block must visually distinguish the bare label
    from the descriptive gloss so Haiku doesn't copy the whole line.
    Labels are wrapped in double quotes; glosses use [brackets] (not parens)."""
    from data.lib.enrichment.shared.taxonomies.food_pairing import load_default

    block = load_default().prompt_block()
    # Spot-check the 'Grilled red meat' entry
    assert '"Grilled red meat"' in block
    # Old (e.g. ...; pairs with ...) form should be GONE
    assert "Grilled red meat (e.g." not in block
    # New bracketed form should be present
    assert "[examples:" in block
    assert "pairs with" in block  # still mentions the wine-style hint
