"""Tests for the curated food-pairing display-category classifier.

Guards the sommelier vocabulary that powers the storefront 'Pairs well with'
chips: no broken grammar, specific dishes fold into the right broad category,
and the controlled vocab stays internally consistent.
"""
from data.lib.taxonomy.pairing_categories import (
    all_labels,
    classify,
    remap_items,
)


def test_vocabulary_is_clean():
    labels = all_labels()
    assert len(labels) == len(set(labels)), "duplicate category labels"
    for label in labels:
        # No broken/dangling grammar like "Beef stew & braised".
        assert not label.endswith("&"), label
        assert not label.endswith(" and"), label
        assert "(" not in label and ")" not in label, label


def test_specific_dishes_fold_into_broad_categories():
    cases = {
        "Foie gras torchon with brioche and Sauternes gelée": "Cured meats & charcuterie",
        "Bistecca alla Fiorentina with rosemary-salted crust": "Grilled red meat & steak",
        "Miso-glazed black cod": "Grilled & roasted fish",
        "Aged Comté with honeycomb": "Hard & aged cheese",
        "Roasted rack of lamb with rosemary jus": "Lamb dishes",
        "Peking duck with hoisin and scallion crêpes": "Chinese & dim sum",
        "Mango sticky rice": "Thai & Southeast Asian",
        "Dark chocolate fondant with sea salt": "Dark chocolate & cocoa",
        "Sticky toffee pudding with salted caramel sauce": "Creamy desserts & pastries",
        "Comfort food (pasta bakes, casseroles, roasts)": "Comfort food & bakes",
    }
    for raw, expected in cases.items():
        assert classify(raw) == expected, f"{raw!r} -> {classify(raw)!r}, want {expected!r}"


def test_classify_is_case_and_diacritic_tolerant():
    # The historical data had casing/diacritic dupes; these must all land together.
    for v in ["Aged Comté with honeycomb", "aged comté with honeycomb",
              "Aged comte with honeycomb", "AGED COMTÉ WITH HONEYCOMB"]:
        assert classify(v) == "Hard & aged cheese"


def test_remap_dedupes_and_preserves_order():
    raw = [
        "Tomato-based pasta",
        "Pizza & flatbreads",
        "Grilled red meat",
        "Beef stew & braised",                       # -> Grilled red meat & steak (dup)
        "Comfort food (pasta bakes, casseroles, roasts)",
    ]
    assert remap_items(raw) == [
        "Tomato-based pasta",
        "Pizza & flatbreads",
        "Grilled red meat & steak",
        "Comfort food & bakes",
    ]


def test_unmatched_value_returns_none_and_is_dropped():
    assert classify("quenelle de brochet") is None
    assert remap_items(["quenelle de brochet", "Grilled red meat"]) == [
        "Grilled red meat & steak"
    ]


def test_classify_empty():
    assert classify("") is None
    assert remap_items([]) == []
