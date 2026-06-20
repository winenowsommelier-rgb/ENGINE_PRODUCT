from data.lib.taxonomy.sku_taxonomy import resolve, group_for, type_for, unmapped_prefixes

def _p(sku, name=""): return {"sku": sku, "name": name}

def test_red_wine_resolves():
    assert resolve(_p("WRW0001")) == {"group": "Wine", "type": "Red Wine"}

def test_longest_prefix_first_wev_beats_w():
    assert group_for("WEV0001") == "Events"

def test_liqueur_own_group():
    assert resolve(_p("LLQ0001")) == {"group": "Liqueur", "type": "Liqueur"}

def test_wdw_fortified_by_name():
    assert resolve(_p("WDW0001", "Cantine Pellegrino Marsala Superiore"))["type"] == "Fortified"

def test_wdw_sweet_default():
    assert resolve(_p("WDW0002", "Massolino Moscato D'Asti"))["type"] == "Sweet/Dessert"

def test_lbd_cognac_by_name():
    assert resolve(_p("LBD0001", "Courvoisier VSOP Cognac"))["type"] == "Cognac"

def test_lws_thai_rice_spirit():
    assert type_for("LWS0001") == "Thai Rice Spirit"

def test_unknown_L_prefix_falls_back_to_spirits():
    assert group_for("LXX0001") == "Spirits"

def test_unknown_N_prefix_is_unknown_not_nonalcoholic():
    assert group_for("NXX0001") == "Unknown"

def test_blank_sku_is_unknown():
    assert resolve(_p(""))["group"] == "Unknown"

def test_non_string_sku_is_unknown_not_crash():
    assert resolve({"sku": 12345})["group"] == "Unknown"

def test_lowercase_sku_normalizes():
    assert group_for("wrw0001") == "Wine"

def test_lbd_brandy_default():
    assert resolve({"sku": "LBD0001", "name": "Vecchia Romagna Brandy"})["type"] == "Brandy"

def test_parity_fixture_matches_resolve():
    import json as _j
    from pathlib import Path as _P
    fx = _j.loads((_P(__file__).resolve().parent / "fixtures" / "sku_taxonomy_cases.json").read_text())
    assert len(fx["cases"]) == 47
    for c in fx["cases"]:
        assert resolve({"sku": c["sku"], "name": c["name"]}) == c["expected"], f"mismatch on {c['sku']}"


import json as _json
from pathlib import Path as _Path

EXPORT = _Path(__file__).resolve().parent.parent / "data" / "live_products_export.json"
EXPECTED_GROUP_COUNTS = {
    "Wine": 6983, "Spirits": 1177, "Accessories": 893, "Whisky": 847,
    "Sake & Asian": 663, "Liqueur": 378, "Beer & RTD": 232,
    "Non-Alcoholic": 151, "Cigars": 102, "Events": 10,
}
DIVERGENT = ["LBE","LKS","LLQ","LOT","LRD","LSJ","LSK","LWF","LWH","WEV","WNA"]

def test_group_counts_match_spec_exactly():
    prods = _json.loads(EXPORT.read_text())
    import collections
    counts = collections.Counter(resolve(p)["group"] for p in prods)
    assert dict(counts) == EXPECTED_GROUP_COUNTS

def test_no_unmapped_prefixes_in_live_data():
    prods = _json.loads(EXPORT.read_text())
    assert unmapped_prefixes(prods) == []

def test_divergent_prefixes_have_explicit_entries():
    data = _json.loads((_Path(__file__).resolve().parent.parent / "data" / "taxonomy" / "sku_prefix_map.json").read_text())
    for pre in DIVERGENT:
        assert pre in data["prefixes"], f"{pre} missing — would misroute via letter-fallback"
