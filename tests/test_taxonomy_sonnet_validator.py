"""Unit tests for sonnet_validator — pure function tests, no API calls."""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.sonnet_validator import (
    get_brand_tier,
    should_validate,
    parse_validation_response,
    build_validation_prompt,
)


def test_brand_tier_s1(tmp_path):
    csv_content = "entity_name,product_count\nPenfolds,50\nSmall Brand,2\n"
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text(csv_content)
    assert get_brand_tier("Penfolds", str(csv_file)) == "S1"


def test_brand_tier_s3(tmp_path):
    csv_content = "entity_name,product_count\nPenfolds,50\nSmall Brand,2\n"
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text(csv_content)
    assert get_brand_tier("Small Brand", str(csv_file)) == "S3"


def test_brand_tier_s2(tmp_path):
    csv_content = "entity_name,product_count\nMid Brand,5\n"
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text(csv_content)
    assert get_brand_tier("Mid Brand", str(csv_file)) == "S2"


def test_brand_tier_unknown(tmp_path):
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text("entity_name,product_count\n")
    assert get_brand_tier("Unknown Brand", str(csv_file)) == "unknown"


def test_should_validate_s1_low_confidence():
    assert should_validate("S1", 0.70) is True


def test_should_validate_s1_high_confidence():
    assert should_validate("S1", 0.90) is False


def test_should_validate_s2_low_confidence():
    assert should_validate("S2", 0.80) is True


def test_should_validate_s3_never():
    assert should_validate("S3", 0.50) is False


def test_should_validate_unknown_never():
    assert should_validate("unknown", 0.50) is False


def test_parse_valid_response():
    raw = '{"region": "Burgundy", "subregion": "Gevrey-Chambertin", "grape_variety": "Pinot Noir", "confidence": 0.95, "citations": ["https://example.com"]}'
    result = parse_validation_response(raw, ["region", "subregion", "grape_variety"])
    assert result["region"] == "Burgundy"
    assert result["subregion"] == "Gevrey-Chambertin"
    assert result["confidence"] == 0.95
    assert result["valid"] is True
    assert "https://example.com" in result["citations"]


def test_parse_invalid_json():
    result = parse_validation_response("not json at all", ["region"])
    assert result["valid"] is False
    assert result["confidence"] == 0.0


def test_parse_empty_input():
    result = parse_validation_response("", ["region"])
    assert result["valid"] is False


def test_parse_confidence_clamped():
    raw = '{"region": "Bordeaux", "confidence": 1.5}'
    result = parse_validation_response(raw, ["region"])
    assert 0.0 <= result["confidence"] <= 1.0


def test_build_prompt_contains_product_name():
    sku_data = {"name": "Chateau Margaux 2015", "country": "France", "classification": "Red Wine",
                "region": "Bordeaux", "subregion": "", "grape_variety": ""}
    system, user = build_validation_prompt(sku_data, ["subregion", "grape_variety"])
    assert "Chateau Margaux 2015" in user
    assert "subregion" in user.lower()
