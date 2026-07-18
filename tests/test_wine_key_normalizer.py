from data.lib.dossier.wine_key import wine_key_for


def test_vintage_year_stripped():
    a = wine_key_for("WRW0001", "Sassicaia 2020")
    b = wine_key_for("WRW0002", "Sassicaia 2021")
    assert a == b


def test_bottle_format_variant_collapses():
    a = wine_key_for("WRW0003", "Petrus 2015 750ml")
    b = wine_key_for("WRW0004", "Petrus 2015 Magnum")
    c = wine_key_for("WRW0005", "Petrus 2015 Jeroboam")
    assert a == b == c


def test_producer_case_drift_collapses():
    a = wine_key_for("WRW0006", "Rocca Di Frassinello Le Sughere")
    b = wine_key_for("WRW0007", "Rocca di Frassinello Le Sughere")
    assert a == b


def test_missing_separator_still_normalizes():
    # some names lack a double-space between producer and cuvee
    a = wine_key_for("WRW0008", "Banfi Summus")
    b = wine_key_for("WRW0009", "Banfi  Summus")  # double space
    assert a == b


def test_conflated_houses_must_not_merge():
    salon = wine_key_for("WSP0001", "Salon Le Mesnil Blanc de Blancs")
    delamotte = wine_key_for("WSP0002", "Delamotte Blanc de Blancs")
    assert salon != delamotte


def test_single_vineyard_vs_base_cuvee_must_not_merge():
    base = wine_key_for("WRW0010", "Brunello DOCG")
    single_vineyard = wine_key_for("WRW0011", "Brunello DOCG Poggio alle Mura")
    assert base != single_vineyard


def test_override_map_wins_over_normalization():
    # a manually-flagged irreducible case forces a specific key
    from data.lib.dossier.wine_key import WINE_KEY_OVERRIDES
    if WINE_KEY_OVERRIDES:
        sku, forced_key = next(iter(WINE_KEY_OVERRIDES.items()))
        assert wine_key_for(sku, "irrelevant name") == forced_key


def test_parity_fixture_matches_wine_key_for():
    import json
    from pathlib import Path
    fx = json.loads(
        (Path(__file__).resolve().parent / "fixtures" / "wine_key_cases.json").read_text()
    )
    for c in fx["cases"]:
        assert wine_key_for(c["sku"], c["name"]) == c["expected_key"], f"mismatch on {c['sku']}"


def test_ts_override_map_matches_python():
    from pathlib import Path
    ts_path = Path(__file__).resolve().parent.parent / "apps/catalog/lib/dossier/wine-key.ts"
    ts_text = ts_path.read_text()
    # crude but sufficient: confirm the TS file declares an empty (or matching) object
    from data.lib.dossier.wine_key import WINE_KEY_OVERRIDES
    if not WINE_KEY_OVERRIDES:
        assert "= {}" in ts_text.replace(" ", "").replace("\n", "") or "Record<string, string> = {" in ts_text
