import pytest

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
    # Real taxonomy string is "Sparkling & Champagne" -- NOT bare "Sparkling".
    # This is the exact test that would have caught the original bug: the
    # plan's sample code branched on category_type == "Sparkling", which
    # never occurs in production, so every real sparkling wine silently fell
    # through to Red Wine decant/aerate advice.
    g = default_serve_guidance(category_type="Sparkling & Champagne", body="light",
                                tannin=None, designation="Brut")
    assert 6 <= g["temp_c_min"] <= 8
    assert "flute" in g["glass_code"]


def test_prestige_cuvee_sparkling_differs_from_nv_brut():
    nv = default_serve_guidance(category_type="Sparkling & Champagne", body="light",
                                 tannin=None, designation="Brut")
    prestige = default_serve_guidance(category_type="Sparkling & Champagne", body="light",
                                       tannin=None, designation="Prestige Cuvée")
    assert nv["temp_c_max"] < prestige["temp_c_max"]
    assert nv["glass_code"] != prestige["glass_code"]


def test_tawny_port_no_decant_vintage_port_sediment_decant():
    tawny = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                    designation="Tawny")
    vintage = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                      designation="Vintage Port")
    assert tawny["decant"]["type"] == "none"
    assert vintage["decant"]["type"] == "sediment"


def test_rose_gets_chilled_white_style_no_decant():
    # Rosé Wine (182 SKUs in live export) must not fall through to Red Wine
    # tannin/decant logic -- it is its own branch with white-style chilled
    # serve and no decant.
    g = default_serve_guidance(category_type="Rosé Wine", body="light", tannin=None)
    assert g["temp_c_max"] <= 12
    assert g["decant"]["type"] == "none"
    assert g["glass_code"] != "bordeaux"


def test_sweet_dessert_and_fortified_both_get_fortified_style_guidance():
    # WDW (24 in-scope SKUs per spec, 85 in full export) splits across TWO
    # real taxonomy strings: "Fortified" and "Sweet/Dessert". Both must
    # route to fortified-style guidance (chilled-to-cellar temps, no
    # tannin-driven aerate decant), though they need not be byte-identical.
    fortified = default_serve_guidance(category_type="Fortified", body="full",
                                        tannin="medium", designation=None)
    sweet_dessert = default_serve_guidance(category_type="Sweet/Dessert", body="full",
                                            tannin="medium", designation=None)
    for g in (fortified, sweet_dessert):
        assert g["decant"]["type"] == "none"
        assert g["glass_code"] != "bordeaux"
        assert g["temp_c_max"] <= 18


def test_unrecognized_category_type_raises_instead_of_silently_defaulting():
    # If the taxonomy ever adds a new category_type, this must surface
    # immediately instead of silently misapplying Red Wine decant/glass
    # advice to it.
    with pytest.raises(ValueError):
        default_serve_guidance(category_type="Whisky", body=None, tannin=None)
