"""Smoke tests for taste schema module."""
from data.lib.enrichment.wine.schemas import (
    TasteProfile,
    CATEGORY_TO_STRUCTURE,
    CATEGORY_TO_FAMILY,
)


def test_structure_lookup_strong_fits_tiered():
    assert CATEGORY_TO_STRUCTURE["Red Wine"] == "tiered"
    assert CATEGORY_TO_STRUCTURE["Brandy"] == "tiered"
    assert CATEGORY_TO_STRUCTURE["Gin"] == "tiered"


def test_structure_lookup_weak_fits_flat():
    assert CATEGORY_TO_STRUCTURE["Beer"] == "flat"
    assert CATEGORY_TO_STRUCTURE["Liqueur"] == "flat"
    assert CATEGORY_TO_STRUCTURE["Ready to Drink"] == "flat"


def test_structure_lookup_skip_categories_missing():
    # Skip categories not in dict — caller must handle KeyError / None lookup
    assert "Cigar" not in CATEGORY_TO_STRUCTURE
    assert "Mineral Water" not in CATEGORY_TO_STRUCTURE
    assert "Accessories" not in CATEGORY_TO_STRUCTURE


def test_family_lookup():
    assert CATEGORY_TO_FAMILY["Red Wine"] == "wine"
    assert CATEGORY_TO_FAMILY["Brandy"] == "brown_spirit"
    assert CATEGORY_TO_FAMILY["Gin"] == "white_spirit"
    assert CATEGORY_TO_FAMILY["Beer"] == "beer"
