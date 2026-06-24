import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.taste_taxonomy.universal_scales import (
    validate_body, validate_variety, schema_for_group, BODY_SCALE,
)

def test_body_scale_is_four_step_no_medium_light():
    assert BODY_SCALE == ["Light", "Medium", "Medium-Full", "Full"]
    assert validate_body("Full") == "Full"
    assert validate_body("Medium-Light") is None
    assert validate_body("bogus") is None
    assert validate_body(None) is None

def test_variety_validates_against_per_category_vocab():
    assert validate_variety("Whisky", "Single Malt") == "Single Malt"
    assert validate_variety("Whisky", "Chardonnay") is None
    assert validate_variety("Sake & Asian", "Junmai Ginjo") == "Junmai Ginjo"
    assert validate_variety("Accessories", "Single Malt") is None

def test_schema_for_group_is_rule12_clean():
    s = schema_for_group("Whisky")
    assert "variety" in s["fields"] and "body" in s["fields"]
    assert s["variety_vocab"]
    import inspect, data.lib.taste_taxonomy.universal_scales as m
    src = inspect.getsource(m)
    assert "classification" not in src.lower()

def test_field_specs_and_applies_baseline():
    from data.lib.taste_taxonomy.universal_scales import FIELD_SPECS, applies
    assert set(FIELD_SPECS) >= {"variety", "body", "acidity", "tannin", "sweetness"}
    ap = applies("Spirits", "Gin")
    assert "variety" in ap
    assert "body" not in ap and "acidity" not in ap and "tannin" not in ap and "sweetness" not in ap


def test_schema_for_group_works_for_all_phase_b_groups():
    # The vocab is GROUP-keyed; schema_for_group must accept the GROUP string
    # (NOT the divergent type). Regression guard for the group-vs-type bug.
    for group in ["Whisky", "Spirits", "Sake & Asian", "Liqueur", "Beer & RTD"]:
        s = schema_for_group(group)
        assert s is not None, f"{group} returned None"
        assert s["variety_vocab"], f"{group} has empty vocab"
    # a non-Phase-B group returns None
    assert schema_for_group("Accessories") is None


def test_wine_set_excluded_from_enrichment():
    """Wine Set = multi-bottle pack → no coherent taste profile → no fields requested
    (user decision 2026-06-23; guards against a misleading single body/acidity value)."""
    from data.lib.taste_taxonomy.universal_scales import applies
    assert applies("Wine", "Wine Set") == set()
    # sanity: a real wine type is unaffected
    assert "tannin" in applies("Wine", "Red Wine")


# ── Task 5: lock the §4.0 applicability gates + scale validators ──────────────
# These pin the exact field×category matrix so a future edit can't silently
# widen/narrow what we PAY to enrich. Wine-type literals are the strings
# sku_taxonomy.resolve()["type"] returns (verified 2026-06-23).

def test_tannin_gate_by_wine_type():
    from data.lib.taste_taxonomy.universal_scales import applies
    assert "tannin" in applies("Wine", "Red Wine")
    assert "tannin" in applies("Wine", "Orange Wine")
    for t in ("White Wine", "Sparkling & Champagne", "Rosé Wine"):
        assert "tannin" not in applies("Wine", t)


def test_sweetness_gate_by_wine_type():
    from data.lib.taste_taxonomy.universal_scales import applies
    for t in ("Sweet/Dessert", "Fortified", "White Wine", "Sparkling & Champagne"):
        assert "sweetness" in applies("Wine", t)
    assert "sweetness" not in applies("Wine", "Red Wine")
    assert "sweetness" not in applies("Wine", "Rosé Wine")


def test_body_acidity_gates():
    from data.lib.taste_taxonomy.universal_scales import applies
    assert "body" not in applies("Whisky")
    assert "body" not in applies("Spirits", "Gin")
    assert "acidity" not in applies("Sake & Asian")
    assert "body" in applies("Sake & Asian")
    assert "tannin" not in applies("Liqueur") and "sweetness" in applies("Liqueur")


def test_validate_sweetness_rejects_sake_ladder():
    # The product-page gauge scale is [Dry, Off-Dry, Medium-Sweet, Sweet]; the sake
    # SWEETNESS_LADDER (lowercase 'very dry'/'sweet') is a DIFFERENT scale and would
    # render an all-empty gauge. validate_sweetness must drop it (Rule 1 silent-empty trap).
    from data.lib.taste_taxonomy.universal_scales import validate_sweetness
    assert validate_sweetness("Off-Dry") == "Off-Dry"
    assert validate_sweetness("Medium-Sweet") == "Medium-Sweet"
    assert validate_sweetness("very dry") is None
    assert validate_sweetness("sweet") is None  # lowercase sake-ladder value -> dropped


def test_validate_acidity_tannin_scale():
    from data.lib.taste_taxonomy.universal_scales import validate_acidity, validate_tannin
    assert validate_acidity("Medium-High") == "Medium-High"
    assert validate_tannin("Low") == "Low"
    assert validate_tannin("Full") is None   # body-scale word, not the acidity/tannin scale
    assert validate_acidity("Medium-Full") is None
