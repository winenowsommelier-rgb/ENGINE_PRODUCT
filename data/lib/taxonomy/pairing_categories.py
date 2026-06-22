"""Classify free-text food-pairing values into curated DISPLAY categories.

The enrichment historically wrote `food_matching` as a mix of broad categories
("Grilled red meat") and 6,000+ hyper-specific dish names ("Foie gras torchon
with brioche and Sauternes gelée"), with inconsistent casing/diacritics and
broken grammar ("Beef stew & braised"). This module maps every value onto a
small, sommelier-approved, customer-facing vocabulary defined in
`data/lib/pairing_knowledge/food_taxonomy/pairing_categories.json`.

The JSON is the source of truth (human-editable by the sommelier team); this
module only loads it and applies first-match-wins substring classification.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_KB = (
    Path(__file__).resolve().parents[1]
    / "pairing_knowledge"
    / "food_taxonomy"
    / "pairing_categories.json"
)


@lru_cache(maxsize=1)
def _categories() -> list[tuple[str, tuple[str, ...]]]:
    """(label, keywords) in declared order. Order = classification priority."""
    data = json.loads(_KB.read_text(encoding="utf-8"))
    return [
        (c["label"], tuple(k.lower() for k in c["keywords"]))
        for c in data["categories"]
    ]


def all_labels() -> list[str]:
    """The full controlled vocabulary, in declared order."""
    return [label for label, _ in _categories()]


def classify(value: str) -> str | None:
    """Map one free-text pairing value to a category label, or None if unmatched.

    First-match-wins: returns the first category whose any keyword is a
    case-insensitive substring of `value`.
    """
    if not value:
        return None
    v = value.lower()
    for label, keywords in _categories():
        for kw in keywords:
            if kw in v:
                return label
    return None


def remap_items(items: list[str]) -> list[str]:
    """Map a list of raw pairing values to deduped category labels.

    Preserves first-seen order, drops values that don't map to any category
    (long-tail noise like 'chawanmushi with lily bulb').
    """
    out: list[str] = []
    for raw in items:
        label = classify(raw)
        if label and label not in out:
            out.append(label)
    return out
