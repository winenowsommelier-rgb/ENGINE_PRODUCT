"""Unit tests for data.lib.product_naming."""
from __future__ import annotations

from data.lib import product_naming as pn


class TestDetectWebsite:
    def test_wine_prefix_returns_wine_now(self):
        assert pn.detect_website("WDW0001AA") == "wine-now"
        assert pn.detect_website("WRW9999ZZ") == "wine-now"

    def test_spirit_prefix_returns_liq9(self):
        assert pn.detect_website("LWH0001AA") == "liq9"
        assert pn.detect_website("LGN0003AD") == "liq9"

    def test_cigars_return_liq9(self):
        assert pn.detect_website("CIG0149BT") == "liq9"

    def test_mixers_return_liq9(self):
        # User-requested reassignment: NNA + MNA -> Liq9
        assert pn.detect_website("NNA0008AA") == "liq9"
        assert pn.detect_website("MNA0041AE") == "liq9"

    def test_wine_personalization_returns_wine_now(self):
        # User-requested reassignment: AWN -> Wine-Now
        assert pn.detect_website("AWN0001AD") == "wine-now"

    def test_system_products_return_none(self):
        # Shipping, coupons, gift cards -> no SEO suffix
        assert pn.detect_website("DELIVERY1") is None
        assert pn.detect_website("ECP10") is None
        assert pn.detect_website("GIF0001") is None

    def test_unknown_prefix_returns_none(self):
        assert pn.detect_website("ZZZ0001") is None

    def test_blank_sku_returns_none(self):
        assert pn.detect_website("") is None
        assert pn.detect_website("AB") is None  # under 3 chars


class TestNormalizeVintage:
    def test_current_vintage_returns_none(self):
        assert pn.normalize_vintage("Current vintage") is None

    def test_nv_returns_nv(self):
        assert pn.normalize_vintage("NV") == "NV"

    def test_year_returns_year(self):
        assert pn.normalize_vintage("2018") == "2018"

    def test_blank_returns_none(self):
        assert pn.normalize_vintage("") is None
        assert pn.normalize_vintage("   ") is None


class TestNormalizeBottleSize:
    def test_ml_strips_space(self):
        assert pn.normalize_bottle_size("750 ml") == "750ml"

    def test_liter_converts_to_ml(self):
        assert pn.normalize_bottle_size("1.5 L") == "1500ml"
        assert pn.normalize_bottle_size("1 L") == "1000ml"

    def test_blank_returns_none(self):
        assert pn.normalize_bottle_size("") is None
        assert pn.normalize_bottle_size("   ") is None


class TestCleanName:
    def test_collapses_double_spaces(self):
        assert pn.clean_name("Batasiolo  Moscato  Spumante Dolce") \
            == "Batasiolo Moscato Spumante Dolce"

    def test_trims_leading_trailing(self):
        assert pn.clean_name("  Batasiolo  ") == "Batasiolo"

    def test_preserves_diacritics(self):
        assert pn.clean_name("Château Pétale Rosé") == "Château Pétale Rosé"


class TestToSlug:
    def test_basic_slug(self):
        assert pn.to_slug("Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml") \
            == "batasiolo-moscato-spumante-dolce-nv-750ml"

    def test_strips_diacritics(self):
        assert pn.to_slug(
            "Château la Tour de l'évêque",
            "Pétale de Rose Rosé",
            "2020",
            "750 ml",
        ) == "chateau-la-tour-de-l-eveque-petale-de-rose-rose-2020-750ml"

    def test_drops_current_vintage(self):
        assert pn.to_slug("Coastal Ridge", "Cabernet Sauvignon", "Current vintage", "750 ml") \
            == "coastal-ridge-cabernet-sauvignon-750ml"

    def test_drops_blank_vintage_and_size(self):
        assert pn.to_slug("Vinturi", "Deluxe Red Wine Aerator Set", "", "") \
            == "vinturi-deluxe-red-wine-aerator-set"

    def test_collapses_double_spaces_in_raw_name(self):
        assert pn.to_slug("Batasiolo", "Moscato  Spumante   Dolce", "NV", "750 ml") \
            == "batasiolo-moscato-spumante-dolce-nv-750ml"

    def test_strips_special_chars(self):
        assert pn.to_slug("Moët & Chandon", "Brut Impérial", "NV", "750 ml") \
            == "moet-chandon-brut-imperial-nv-750ml"

    def test_no_leading_trailing_hyphens(self):
        # Even if inputs start/end with punctuation, slug has no leading/trailing dash
        result = pn.to_slug("  -Brand-  ", "!Name!", "NV", "750 ml")
        assert not result.startswith("-")
        assert not result.endswith("-")


class TestToSeoTitle:
    def test_wine_now_suffix(self):
        assert pn.to_seo_title(
            "Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml", "wine-now",
        ) == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"

    def test_liq9_suffix(self):
        assert pn.to_seo_title(
            "Glenfiddich", "12 Years Old", "", "700 ml", "liq9",
        ) == "Glenfiddich 12 Years Old 700ml | Liq9"

    def test_no_suffix_when_website_is_none(self):
        # System products: no '| Website' tail
        assert pn.to_seo_title(
            "Gift Card", "Gift Card 100 Baht", "", "", None,
        ) == "Gift Card Gift Card 100 Baht"

    def test_drops_current_vintage_and_blank_size(self):
        assert pn.to_seo_title(
            "Vinturi", "Deluxe Aerator", "Current vintage", "", "wine-now",
        ) == "Vinturi Deluxe Aerator | Wine-Now"

    def test_collapses_double_spaces(self):
        assert pn.to_seo_title(
            "Batasiolo", "Moscato  Spumante  Dolce", "NV", "750 ml", "wine-now",
        ) == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"


class TestToImageFilenameBase:
    def test_appends_sku_lowercase(self):
        assert pn.to_image_filename_base(
            "Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml", "WDW0001AA",
        ) == "batasiolo-moscato-spumante-dolce-nv-750ml-wdw0001aa"

    def test_no_extension_included(self):
        result = pn.to_image_filename_base(
            "Batasiolo", "Moscato", "NV", "750 ml", "WDW0001AA",
        )
        assert "." not in result
        assert result.endswith("-wdw0001aa")


class TestImageSpecs:
    def test_thumbnail_spec(self):
        s = pn.image_spec("thumbnail")
        assert s == {"width": 240, "height": 240, "format": "JPEG", "quality": 85, "max_kb": 20}

    def test_image_spec(self):
        s = pn.image_spec("image")
        assert s["width"] == 800 and s["height"] == 800 and s["format"] == "JPEG"

    def test_image_hd_spec(self):
        s = pn.image_spec("image_hd")
        assert s["width"] == 2000 and s["format"] == "WebP" and s["max_kb"] == 500

    def test_unknown_slot_raises(self):
        import pytest as _pytest
        with _pytest.raises(KeyError):
            pn.image_spec("xxl")


class TestPickBestUrl:
    def test_image_wins_over_others(self):
        assert pn.pick_best_url("a.jpg", "b.jpg", "c.jpg") == "b.jpg"

    def test_thumbnail_fallback(self):
        assert pn.pick_best_url("a.jpg", "", "c.jpg") == "a.jpg"

    def test_small_fallback_last(self):
        assert pn.pick_best_url("", "", "c.jpg") == "c.jpg"

    def test_all_empty_returns_none(self):
        assert pn.pick_best_url("", "", "") is None

    def test_whitespace_treated_as_empty(self):
        assert pn.pick_best_url("   ", "", "  ") is None


class TestBuildImageStruct:
    def test_url_populates_all_three_slots(self):
        images, status = pn.build_image_struct("https://example.com/x.jpg")
        assert status == "legacy"
        assert set(images.keys()) == {"thumbnail", "image", "image_hd"}
        for slot in ("thumbnail", "image", "image_hd"):
            assert images[slot]["url"] == "https://example.com/x.jpg"
            assert images[slot]["source"] == "magento-legacy"
            assert "spec" in images[slot]

    def test_none_returns_missing(self):
        images, status = pn.build_image_struct(None)
        assert images is None and status == "missing"
