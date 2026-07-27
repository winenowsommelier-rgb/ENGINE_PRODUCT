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
    """Every curated fixture case must resolve exactly.

    REGRESSION-GUARD HISTORY: this previously also asserted
    `len(fx["cases"]) == 47`, which broke the moment a 48th case was added to
    the fixture — a test failing because someone IMPROVED coverage. The count
    was never the point; the per-case parity below is. We assert a floor
    instead, so cases can be added freely but never silently deleted.
    """
    import json as _j
    from pathlib import Path as _P
    fx = _j.loads((_P(__file__).resolve().parent / "fixtures" / "sku_taxonomy_cases.json").read_text())
    assert len(fx["cases"]) >= 47, "parity fixture shrank — cases were deleted"
    for c in fx["cases"]:
        assert resolve({"sku": c["sku"], "name": c["name"]}) == c["expected"], f"mismatch on {c['sku']}"


import json as _json
from pathlib import Path as _Path

EXPORT = _Path(__file__).resolve().parent.parent / "data" / "live_products_export.json"

# The ten canonical groups. This SET is the real contract — a new key appearing
# here means the taxonomy grew a group and needs a deliberate decision.
EXPECTED_GROUPS = {
    "Wine", "Spirits", "Accessories", "Whisky", "Sake & Asian",
    "Liqueur", "Beer & RTD", "Non-Alcoholic", "Cigars", "Events",
}
DIVERGENT = ["LBE","LKS","LLQ","LOT","LRD","LSJ","LSK","LWF","LWH","WEV","WNA"]


def test_every_product_resolves_to_a_known_group():
    """No product may fall outside the ten canonical groups.

    REGRESSION-GUARD HISTORY: this test used to assert an exact frozen count
    per group (Wine: 6983, ...). Those numbers went stale the moment the
    catalogue grew — the 498-SKU onboarding took it from 11,436 to 11,934 rows
    and the test began failing on healthy data, with the resolver provably
    correct (0/48 fixture mismatches). A test that fails when you ADD products
    is an alarm that has to be silenced routinely, which is worse than no
    alarm. We now assert the invariants that actually matter: the group SET is
    closed, and nothing is unclassified.
    """
    prods = _json.loads(EXPORT.read_text())
    import collections
    counts = collections.Counter(resolve(p)["group"] for p in prods)

    unexpected = set(counts) - EXPECTED_GROUPS
    assert not unexpected, f"products resolved to unknown group(s): {unexpected}"
    assert sum(counts.values()) == len(prods), "some products failed to resolve"
    # Every canonical group should still be represented; an empty one means a
    # prefix mapping was dropped.
    missing = {g for g in EXPECTED_GROUPS if counts.get(g, 0) == 0}
    assert not missing, f"canonical group(s) became empty: {missing}"


def test_wine_remains_the_dominant_group():
    """Shape check: Wine is a wine merchant's largest group by a wide margin.

    Catches a catastrophic mis-mapping (e.g. a prefix change dumping Wine into
    Spirits) without pinning an exact number that drifts with the catalogue.
    """
    prods = _json.loads(EXPORT.read_text())
    import collections
    counts = collections.Counter(resolve(p)["group"] for p in prods)
    assert counts["Wine"] > 0.4 * len(prods), (
        f"Wine collapsed to {counts['Wine']}/{len(prods)} — check prefix mappings")

def test_no_unmapped_prefixes_in_live_data():
    prods = _json.loads(EXPORT.read_text())
    assert unmapped_prefixes(prods) == []

def test_divergent_prefixes_have_explicit_entries():
    data = _json.loads((_Path(__file__).resolve().parent.parent / "data" / "taxonomy" / "sku_prefix_map.json").read_text())
    for pre in DIVERGENT:
        assert pre in data["prefixes"], f"{pre} missing — would misroute via letter-fallback"
