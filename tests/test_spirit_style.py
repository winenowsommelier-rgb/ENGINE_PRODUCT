"""Tests for P3 spirit_style derivation — pure, rule-based, NO API.

derive_spirit_style(product) -> list[str] of style tags, category-specific:
  whisky: Single Malt / Blended / Peated / Sherried / Bourbon / Rye / Irish / cask finishes
  gin:    London Dry / Old Tom / Navy Strength / Flavoured
  rum:    White / Aged / Spiced / Dark / Overproof
  tequila: Blanco / Reposado / Añejo / Extra Añejo
  cognac: VS / VSOP / XO
Returns [] when no rule matches (honest absence — never guesses).
spirit_category(product) routes by SKU prefix + classification + name.
"""
from __future__ import annotations

from scripts.derive_spirit_style import spirit_category, derive_spirit_style


def _p(sku, name, classification="", region=""):
    return {"sku": sku, "name": name, "classification": classification, "region": region}


# --- category routing ---

def test_category_whisky_by_sku():
    assert spirit_category(_p("LWH0001", "Glenfiddich 12")) == "whisky"


def test_category_gin_by_classification():
    assert spirit_category(_p("LGN0001", "Tanqueray Gin", "Gin")) == "gin"


def test_category_rum_by_name():
    assert spirit_category(_p("LRM0001", "Captain Morgan White Rum", "Others")) == "rum"


def test_category_non_spirit_returns_none():
    assert spirit_category(_p("WRW0001", "Ch. Margaux", "Red Wine")) is None
    assert spirit_category(_p("LBE0001", "Fuller's IPA", "Beer")) is None


# --- whisky styles ---

def test_whisky_islay_is_peated():
    assert "Peated" in derive_spirit_style(_p("LWH1", "Lagavulin 16 Years", "Whisky", "Islay"))


def test_whisky_single_malt_and_sherried():
    out = derive_spirit_style(_p("LWH1", "Aberlour A'bunadh Sherry Cask Single Malt", "Whisky", "Speyside"))
    assert "Single Malt" in out and "Sherried" in out


def test_whisky_blended_johnnie_walker():
    assert "Blended" in derive_spirit_style(_p("LWH1", "Johnnie Walker Black Label", "Whisky", "Scotland"))


def test_whisky_bourbon():
    assert "Bourbon" in derive_spirit_style(_p("LWH1", "Maker's Mark Bourbon", "Whisky", "Kentucky"))


# --- gin / rum / tequila / cognac styles ---

def test_gin_london_dry():
    assert "London Dry" in derive_spirit_style(_p("LGN1", "Tanqueray London Dry Gin", "Gin"))


def test_rum_spiced():
    assert "Spiced" in derive_spirit_style(_p("LRM1", "Captain Morgan Spiced Rum", "Rum"))


def test_tequila_reposado():
    assert "Reposado" in derive_spirit_style(_p("LTQ1", "Milagro Tequila Reposado", "Tequila"))


def test_cognac_xo():
    assert "XO" in derive_spirit_style(_p("LBR1", "Camus XO Cognac", "Brandy"))


# --- honest absence ---

def test_no_rule_match_returns_empty():
    assert derive_spirit_style(_p("LRM1", "Mystery Spirit", "Others")) == []


def test_non_spirit_returns_empty():
    assert derive_spirit_style(_p("WRW1", "Ch. Margaux", "Red Wine")) == []


# --- LLM fallback parse/validate (pure, no API) ---

from scripts.derive_spirit_style import parse_style_array, VALID_STYLES


def test_parse_style_array_valid():
    assert parse_style_array('["London Dry"]') == ["London Dry"]


def test_parse_style_array_tolerates_prose():
    assert parse_style_array('Sure: ["Aged", "Dark"]') == ["Aged", "Dark"]


def test_parse_style_array_drops_unknown_style():
    # Only known styles survive; bogus ones dropped.
    assert parse_style_array('["London Dry", "Zorp"]') == ["London Dry"]


def test_parse_style_array_empty_is_ok():
    assert parse_style_array('[]') == []


def test_parse_style_array_non_array_returns_empty():
    assert parse_style_array('I cannot tell') == []


def test_valid_styles_nonempty():
    assert "London Dry" in VALID_STYLES and "XO" in VALID_STYLES
