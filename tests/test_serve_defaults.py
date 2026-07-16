from data.lib.dossier.serve_defaults import default_serve_guidance


def test_full_bodied_red_gets_wide_glass_and_decant():
    g = default_serve_guidance(category_type="Red Wine", body="full", tannin="high")
    assert g["temp_c_min"] >= 15
    assert g["decant"]["type"] in ("aerate", "sediment")


def test_light_white_gets_cold_serve_no_decant():
    g = default_serve_guidance(category_type="White Wine", body="light", tannin=None)
    assert g["temp_c_max"] <= 12
    assert g["decant"]["type"] == "none"


def test_nv_brut_sparkling_keys_on_designation_not_body():
    g = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                designation="Brut")
    assert 6 <= g["temp_c_min"] <= 8
    assert "flute" in g["glass_code"]


def test_prestige_cuvee_sparkling_differs_from_nv_brut():
    nv = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                 designation="Brut")
    prestige = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                       designation="Prestige Cuvée")
    assert nv["temp_c_max"] < prestige["temp_c_max"]
    assert nv["glass_code"] != prestige["glass_code"]


def test_tawny_port_no_decant_vintage_port_sediment_decant():
    tawny = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                    designation="Tawny")
    vintage = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                      designation="Vintage Port")
    assert tawny["decant"]["type"] == "none"
    assert vintage["decant"]["type"] == "sediment"
