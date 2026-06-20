"""Tests for P1 structural backfill — the pure, no-API logic.

The paid call is thin; all the correctness lives in:
  - build_facts(product)      -> the minimal fact dict the prompt needs
  - parse_structural(text)    -> {body,acidity,tannin} or raises, validating
                                 against the CANONICAL scales the catalog gauge
                                 renders (the silent-empty-gauge gotcha).

Canonical scales (from apps/catalog/lib/taste-adapter.ts):
  body:    Light, Medium, Medium-Full, Full
  acidity: Low, Medium, Medium-High, High
  tannin:  Low, Medium, Medium-High, High
"""
from __future__ import annotations

import pytest

from scripts.backfill_structural import (
    build_facts,
    parse_structural,
    StructuralError,
    merge_into_product,
)


def test_build_facts_extracts_signal():
    p = {"sku": "WRW1", "name": "Ch. X", "grape_variety": "Merlot",
         "region": "Bordeaux", "country": "France", "vintage": 2018, "price": 5}
    facts = build_facts(p)
    assert facts["name"] == "Ch. X"
    assert facts["grape_variety"] == "Merlot"
    assert facts["region"] == "Bordeaux"
    # margin/price must NOT leak into the prompt facts
    assert "price" not in facts and "margin_pct" not in facts


def test_parse_valid_json():
    out = parse_structural('{"body":"Full","acidity":"Medium-High","tannin":"High"}')
    assert out == {"wine_body": "Full", "wine_acidity": "Medium-High", "wine_tannin": "High"}


def test_parse_tolerates_surrounding_text():
    # Models sometimes wrap JSON in prose; we extract the object.
    out = parse_structural('Here it is:\n{"body":"Light","acidity":"High","tannin":"Low"}\nDone.')
    assert out["wine_body"] == "Light"


def test_parse_rejects_off_scale_body():
    # "Medium-Light" is NOT in the body gauge scale -> would render silent-empty.
    with pytest.raises(StructuralError):
        parse_structural('{"body":"Medium-Light","acidity":"High","tannin":"Low"}')


def test_parse_rejects_off_scale_acidity():
    # "Full" is valid for body but NOT for acidity (acidity is Low..High).
    with pytest.raises(StructuralError):
        parse_structural('{"body":"Full","acidity":"Full","tannin":"Low"}')


def test_parse_rejects_missing_field():
    with pytest.raises(StructuralError):
        parse_structural('{"body":"Full","acidity":"High"}')


def test_parse_rejects_non_json():
    with pytest.raises(StructuralError):
        parse_structural('I cannot determine this wine.')


def test_parse_normalizes_case_and_whitespace():
    out = parse_structural('{"body":" full ","acidity":"medium-high","tannin":"high"}')
    assert out == {"wine_body": "Full", "wine_acidity": "Medium-High", "wine_tannin": "High"}


# --- merge: flat-if-empty + _inferred mirror, never overwrite curated ---

INFERRED = {"wine_body": "Full", "wine_acidity": "High", "wine_tannin": "Medium-High"}


def test_merge_fills_empty_flat_fields():
    prod = {"sku": "W1", "wine_body": None, "wine_acidity": "", "wine_tannin": None}
    changed = merge_into_product(prod, INFERRED)
    assert changed is True
    assert prod["wine_body"] == "Full"
    assert prod["wine_acidity"] == "High"
    assert prod["wine_tannin"] == "Medium-High"


def test_merge_always_writes_inferred_mirror():
    prod = {"sku": "W1"}
    merge_into_product(prod, INFERRED)
    assert prod["wine_body_inferred"] == "Full"
    assert prod["wine_acidity_inferred"] == "High"
    assert prod["wine_tannin_inferred"] == "Medium-High"


def test_merge_never_overwrites_curated_flat_value():
    # Curated tannin already present -> flat stays, but the mirror still records the guess.
    prod = {"sku": "W1", "wine_body": None, "wine_acidity": None, "wine_tannin": "Low"}
    merge_into_product(prod, INFERRED)
    assert prod["wine_tannin"] == "Low"                 # curated preserved
    assert prod["wine_tannin_inferred"] == "Medium-High"  # guess still recorded
    assert prod["wine_body"] == "Full"                  # empty one filled


def test_merge_returns_false_when_no_flat_field_changed():
    prod = {"sku": "W1", "wine_body": "Light", "wine_acidity": "Low", "wine_tannin": "Low"}
    changed = merge_into_product(prod, INFERRED)
    assert changed is False  # all flat fields already curated
    # mirror still written for provenance
    assert prod["wine_body_inferred"] == "Full"
