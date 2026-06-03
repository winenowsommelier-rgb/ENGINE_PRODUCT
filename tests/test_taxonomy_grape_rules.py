"""Unit tests for grape inference rules."""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.grape_rules import infer_grape


def test_appellation_pauillac():
    result = infer_grape("Chateau Latour Pauillac 2018", "Red Wine")
    assert result["grapes"] == ["Cabernet Sauvignon"]
    assert result["confidence"] >= 0.85

def test_appellation_mosel():
    result = infer_grape("Dr Loosen Riesling Mosel 2020", "White Wine")
    assert "Riesling" in result["grapes"]
    assert result["confidence"] >= 0.85

def test_grape_in_name():
    # Use a name with no recognized appellation so keyword branch fires
    result = infer_grape("Margaret River Cabernet Sauvignon 2020", "Red Wine")
    assert "Cabernet Sauvignon" in result["grapes"]
    assert result["confidence"] >= 0.75
    assert result["source"] == "name_keyword"

def test_unknown_returns_empty():
    result = infer_grape("Some Mystery Label XYZ", "Red Wine")
    assert result["grapes"] == []
    assert result["confidence"] == 0.0

def test_non_wine_not_inferred():
    result = infer_grape("Jameson Irish Whiskey", "Whisky")
    assert result["grapes"] == []

def test_champagne_default_blend():
    # No "champagne" keyword in name → falls through to classification_default (confidence 0.60)
    result = infer_grape("Veuve Clicquot Yellow Label NV", "Champagne")
    assert len(result["grapes"]) > 0
    assert result["confidence"] >= 0.55
