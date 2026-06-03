from lib.curation.pairing_resolver import resolve_pairing
from lib.curation.knowledge_base import load_knowledge_base
from lib.curation.models import StructuredQuery
import pathlib

KB = load_knowledge_base(pathlib.Path("data/lib/pairing_knowledge"))

WHISKY_PRODUCT = {
    "sku": "LWH001", "classification": "Whisky", "country": "Scotland",
    "flavor_tags": ["honey", "vanilla", "tropical fruit"],
    "taste_profile": {"axes": {"peat_smoke": {"value": "None"}, "sweetness": {"value": "Balanced"}, "oak_influence": {"value": "Light"}}}
}

RAW_FISH_RED = {
    "sku": "WRW001", "classification": "Red Wine", "country": "France",
    "wine_tannin": "Full", "flavor_tags": ["dark plum", "tannin"],
}

def test_pairing_boost_for_thai_whisky():
    q = StructuredQuery(raw_brief="whisky with thai food", pairing_context="Thai food")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.rule_matched is True
    assert score.pairing_boost > 0

def test_bridge_bonus_for_matching_ingredient():
    q = StructuredQuery(raw_brief="test", pairing_context="Thai food")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.bridge_bonus > 0

def test_contraindication_penalty_for_tannic_red_raw_fish():
    q = StructuredQuery(raw_brief="wine with sashimi", pairing_context="sashimi")
    score = resolve_pairing(q, RAW_FISH_RED, KB)
    assert score.contraindication_triggered is True
    assert score.contraindication_penalty <= -0.35

def test_no_pairing_context_returns_zero_bonus():
    q = StructuredQuery(raw_brief="best USA wine")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.pairing_boost == 0.0
    assert score.bridge_bonus == 0.0
