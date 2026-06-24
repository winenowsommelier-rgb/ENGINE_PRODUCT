import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import audit_taste_lib as L  # noqa: E402


def test_is_populated():
    assert L.is_populated("Dry")
    assert not L.is_populated("")
    assert not L.is_populated("   ")
    assert not L.is_populated(None)


def test_split_variety_multivalue():
    assert L.split_variety("Cabernet Sauvignon, Merlot") == ["Cabernet Sauvignon", "Merlot"]
    assert L.split_variety("Chardonnay") == ["Chardonnay"]
    assert L.split_variety("") == []
    assert L.split_variety(None) == []


def test_extra_dry_inversion_flagged():
    f = L.triage_sweetness(sku="WSP0009AA", name="7 Cascine Prosecco Extra Dry",
                           value="Dry", group="Wine", type_="Sparkling & Champagne")
    assert f and f["expected_value"] == "Off-Dry" and f["rule"] == "sparkling_extra_dry_inversion"


def test_plain_dry_sparkling_not_flagged_by_extradry_rule():
    f = L.triage_sweetness(sku="WSP9999ZZ", name="Champagne Brut",
                           value="Dry", group="Wine", type_="Sparkling & Champagne")
    assert f is None or f["rule"] != "sparkling_extra_dry_inversion"


def test_nonbeverage_taste_leak_flagged():
    f = L.triage_nonbeverage(sku="GWN0383BM", name="Final Touch Champagne Glasses",
                             column="variety", value="Pinot Noir, Chardonnay, Pinot Meunier",
                             group="Accessories", type_="Glassware")
    assert f and f["expected_value"] is None and f["rule"] == "nonbeverage_taste_leak"


def test_peated_false_negative_flagged():
    f = L.triage_smokiness(sku="LWH0155BU", name="Talisker 10 Year Old",
                           value="none", group="Whisky", type_="Single Malt")
    assert f and f["rule"] == "peated_false_negative"


def test_smoky_brand_not_a_real_peat_positive():
    f = L.triage_smokiness(sku="LWH0293DG", name="Ole Smoky Original Moonshine",
                           value="heavy", group="Whisky", type_="Moonshine")
    assert f and f["rule"] == "smoky_brand_false_positive"


def test_body_lowercase_casedup_flagged():
    f = L.triage_body_case(sku="X", name="n", value="light", group="Wine", type_="Red Wine")
    assert f and f["expected_value"] == "Light" and f["rule"] == "body_case_dup"


def test_body_case_only_emits_canonical_scale_tokens():
    from data.lib.taste_taxonomy.universal_scales import BODY_SCALE
    for low in ["full", "light", "medium", "medium-full"]:
        f = L.triage_body_case("X", "n", low, "Wine", "Red Wine")
        assert f and f["expected_value"] in BODY_SCALE


def test_inapplicable_column_leak():
    f = L.triage_inapplicable(sku="LGN0001AA", name="Some Gin", column="body",
                              value="Full", group="Spirits", type_="Gin")
    assert f and f["rule"] == "inapplicable_column"


def test_wilson_lower_bound_monotone():
    lb_clean = L.wilson_lower_bound(0, 30)
    lb_dirty = L.wilson_lower_bound(15, 30)
    assert lb_clean < lb_dirty
    assert 0.0 <= lb_clean <= lb_dirty <= 1.0


def test_stratified_control_respects_min_per_type_and_determinism():
    rows = [{"sku": f"S{i}", "type": "Red Wine"} for i in range(50)] + \
           [{"sku": f"T{i}", "type": "Gin"} for i in range(5)]
    s1 = L.stratified_control(rows, key="type", per_type=10, seed=42)
    s2 = L.stratified_control(rows, key="type", per_type=10, seed=42)
    assert s1 == s2
    red = [r for r in s1 if r["type"] == "Red Wine"]
    gin = [r for r in s1 if r["type"] == "Gin"]
    assert len(red) == 10
    assert len(gin) == 5
