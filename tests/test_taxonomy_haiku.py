"""Unit tests for Haiku taxonomy prompt builder + response parser."""
from __future__ import annotations
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.haiku_taxonomy import build_prompt, parse_response


def test_prompt_contains_product_name():
    system, user = build_prompt("Chateau Margaux 2015", "France", "Red Wine", needs=["region", "subregion"])
    assert "Chateau Margaux 2015" in user

def test_prompt_requests_only_needed_fields():
    system, user = build_prompt("Mystery Wine", "", "Red Wine", needs=["region"])
    assert "region" in user.lower()
    # When grape_variety not needed, prompt should not ask for it
    assert "grape_variety" not in user.lower()

def test_parse_valid_response():
    raw = '{"region": "Bordeaux", "subregion": "Margaux", "grape_variety": ["Cabernet Sauvignon"], "confidence": 0.9}'
    result = parse_response(raw, needs=["region", "subregion", "grape_variety"])
    assert result["region"] == "Bordeaux"
    assert result["subregion"] == "Margaux"
    assert result["grape_variety"] == ["Cabernet Sauvignon"]
    assert result["confidence"] == 0.9
    assert result["valid"] is True

def test_parse_partial_response():
    raw = '{"region": "Burgundy", "confidence": 0.7}'
    result = parse_response(raw, needs=["region", "subregion"])
    assert result["region"] == "Burgundy"
    assert result["subregion"] == ""
    assert result["valid"] is True

def test_parse_invalid_json():
    result = parse_response("not json at all", needs=["region"])
    assert result["valid"] is False

def test_parse_confidence_out_of_range():
    raw = '{"region": "Bordeaux", "confidence": 1.5}'
    result = parse_response(raw, needs=["region"])
    # Should clamp or reject
    assert 0.0 <= result["confidence"] <= 1.0
