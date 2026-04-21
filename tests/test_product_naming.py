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
