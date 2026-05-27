"""Unit tests for Wikidata appellation lookup."""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import data.lib.enrichment.taxonomy.wikidata_lookup as wl

_FIXTURE = [
    {"name": "Pauillac", "country": "France", "region": "Bordeaux", "subregion": "Pauillac", "wikidata_id": "Q83481"},
    {"name": "Marlborough", "country": "New Zealand", "region": "Marlborough", "subregion": "", "wikidata_id": "Q1234"},
    {"name": "Barossa Valley", "country": "Australia", "region": "South Australia", "subregion": "Barossa Valley", "wikidata_id": "Q5678"},
]


def setup_function(fn):
    wl._APPELLATIONS = _FIXTURE
    wl._build_index()


def test_exact_appellation_match():
    result = wl.lookup("Chateau Latour Pauillac 2018", "Red Wine")
    assert result["region"] == "Bordeaux"
    assert result["subregion"] == "Pauillac"
    assert result["confidence"] >= 0.85
    assert result["wikidata_id"] == "Q83481"


def test_marlborough_match():
    result = wl.lookup("Cloudy Bay Marlborough Sauvignon Blanc", "White Wine")
    assert result["region"] == "Marlborough"
    assert result["confidence"] >= 0.85


def test_no_match_returns_empty():
    result = wl.lookup("Mystery Brand XYZ 2022", "Red Wine")
    assert result["region"] == ""
    assert result["confidence"] == 0.0


def test_non_wine_not_blocked():
    result = wl.lookup("Glenfiddich Speyside Scotch", "Whisky")
    assert "region" in result


def test_source_label():
    result = wl.lookup("Chateau Latour Pauillac 2018", "Red Wine")
    if result["region"]:
        assert result["source"] == "wikidata"
