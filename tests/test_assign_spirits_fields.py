"""Regression tests for scripts/assign_spirits_fields.py — peat_level
precedence + mis-taxonomied-SKU exclusion, plus GIN_RULES/AGAVE_RULES/
RUM_RULES fallback-fix coverage (2026-07-10).

Pure, rule-based, NO DB access needed: match_rules() and
resolve_column_and_rules() are pure functions over (name, rules) /
(category_type, sku). This file locks in real-data bugs that were each
found and fixed by hand, so a future edit to rule ordering can't silently
reintroduce them:

PEAT_RULES (Task 10 review):
  1. Explicit "Unpeated" in a name must override a brand-name fallback match
     (e.g. Bruichladdich sells both peated and explicitly unpeated bottlings).
  2. The broader Islay-region rule (added after brand-specific rules) must
     not downgrade brands that already have a more specific 'heavy' match
     (e.g. Ardbeg is on Islay AND heavily peated — must stay 'heavy').
  3. The Islay-region rule fires for brands with no specific match.
  4. LWF0018HC (a mis-taxonomied event listing, not a real whisky) must be
     excluded from spirits-field assignment entirely, regardless of its name
     containing "Islay" — see _KNOWN_MISTAXONOMIED_SKUS in the script.
  5. A genuinely unpeated, non-Islay whisky still falls through to 'none'.

GIN_RULES / AGAVE_RULES / RUM_RULES (2026-07-10 fallback-assertion fix):
  Before this fix, all three rule sets ended in a bare (<guessed-value>, None)
  fallback that WROTE A GUESSED VALUE AS FACT for any product with no keyword
  match — the same brand-inference failure class as the reverted
  country-from-brand incident (19/24 wrong, PR #48 -> #50). 266/318 (84%) gin
  rows, 121/195 (62%) rum rows, and a meaningful share of agave rows hit these
  bare fallbacks. Fixed by: brand-specific corrections for well-known products
  whose flavor/aging profile isn't stated in the name (Tanqueray No. TEN,
  Hendrick's, Don Julio 1942), a word-boundary fix for rum X.O, wider
  age-language keyword coverage, and changing the terminal fallback in all
  three rule sets to (None, None) — genuinely unmatched products now get NULL,
  which matchField() in category-scorer.ts treats as "no signal" (verified:
  it short-circuits on falsy field values before comparing).
"""
from __future__ import annotations

from scripts.assign_spirits_fields import (
    AGAVE_RULES,
    GIN_RULES,
    PEAT_RULES,
    RUM_RULES,
    match_rules,
    resolve_column_and_rules,
)


def test_explicit_unpeated_overrides_brand_match():
    # Bruichladdich is in the 'medium' brand list, but this bottling's own
    # name explicitly disclaims peat — the disclaimer must win.
    assert match_rules("Bruichladdich Classic Laddie Unpeated", PEAT_RULES) == "none"


def test_heavy_brand_not_downgraded_by_islay_rule():
    # Ardbeg is both a 'heavy' brand match AND on Islay. The brand-specific
    # 'heavy' rule (checked first) must win over the broader 'medium' Islay
    # region rule (checked later) — precedence must not regress.
    assert match_rules("Ardbeg 10 Year", PEAT_RULES) == "heavy"


def test_islay_region_rule_fires_for_unbranded_product():
    # No brand-specific rule matches "Macleod's" — the bare Islay region
    # signal should still resolve this to 'medium', not fall through to the
    # false 'none' fallback.
    assert match_rules("Macleod's 8 Year Old Islay Single Malt", PEAT_RULES) == "medium"


def test_known_mistaxonomied_sku_is_excluded():
    # LWF0018HC is an event listing that happens to resolve to
    # category_type='Whisky' via its SKU prefix and contains "Islay" in its
    # name — it must be excluded before any rule matching, not merely
    # protected by an incidental non-NULL DB value.
    col, rules = resolve_column_and_rules("Whisky", "LWF0018HC")
    assert col is None
    assert rules is None


def test_known_mistaxonomied_sku_name_would_otherwise_match():
    # Sanity check: prove the exclusion is load-bearing — without it, this
    # exact name DOES match the Islay rule and would resolve to 'medium'.
    assert match_rules("ISLAY FC @Blue Moon Siam Paragon", PEAT_RULES) == "medium"


def test_non_islay_non_branded_whisky_falls_back_to_none():
    assert match_rules("Glenfiddich 12 Year", PEAT_RULES) == "none"


def test_real_islay_skus_still_resolve_correctly():
    # The 3 real whisky products the Islay rule was added to fix must still
    # resolve to 'medium' — confirms the exclusion set only catches the one
    # junk SKU and doesn't collaterally affect real products.
    real_islay_products = [
        ("LWH0625BU", "Johnnie Walker Black Label Islay Origin"),
        ("LWH1162EQ", "Douglas Laing's Double Barrel Islay & Highland"),
        ("LWH0392AH", "Macleod's 8 Year Old Islay Single Malt"),
    ]
    for sku, name in real_islay_products:
        col, rules = resolve_column_and_rules("Whisky", sku)
        assert col == "peat_level"
        assert match_rules(name, rules) == "medium"


# ── GIN_RULES ────────────────────────────────────────────────────────────

def test_tanqueray_no_ten_resolves_citrus_not_juniper_fallback():
    # LGN0176BU — confirmed wrong before the fix: fell through the bare
    # fallback to 'juniper_forward', but No. TEN's stated signature
    # botanicals are grapefruit/lime/chamomile (citrus-forward).
    assert match_rules("Tanqueray  No. TEN Distilled Gin (700 ml)", GIN_RULES) == "contemporary_citrus"


def test_plain_tanqueray_still_resolves_juniper():
    # The brand correction must be scoped to "No. TEN" only — plain
    # Tanqueray Gin (classic London Dry) should still resolve juniper via
    # the 'london dry'/'classic' keyword rule, not the brand correction.
    assert match_rules("Tanqueray  Gin (750 ml)", GIN_RULES) == "juniper_forward"


def test_hendricks_core_range_resolves_floral_not_juniper_fallback():
    # LGN0006AA — confirmed wrong before the fix: fell through to
    # 'juniper_forward', but Hendrick's signature trait across its whole
    # range is rose + cucumber floral infusion.
    assert match_rules("Hendrick's Gin (700 ml)", GIN_RULES) == "contemporary_floral"


def test_hendricks_named_expressions_also_resolve_floral():
    for name in [
        "Hendrick's  Flora Gin (700 ml)",
        "Hendrick's  Neptunia Gin (700 ml)",
        "Hendrick's  Grand Cabaret Gin (700 ml)",
    ]:
        assert match_rules(name, GIN_RULES) == "contemporary_floral"


def test_non_hendricks_lookalike_does_not_get_brand_correction():
    # "Another Hendrick Gin" is a distinct product, not the Hendrick's
    # brand (missing the "'s") — must NOT get the floral brand correction.
    # With no other keyword match it falls through to None, not a guess.
    assert match_rules("Another Hendrick Gin (700 ml)", GIN_RULES) is None


def test_gin_keyword_match_still_wins_over_fallback():
    # A gin with real keyword signal must resolve via that keyword, not
    # fall through — regression guard against breaking existing matches
    # while fixing the fallback.
    assert match_rules("Beefeater  London Dry Gin (750 ml)", GIN_RULES) == "juniper_forward"
    assert match_rules("Bombay Sapphire  Bramble (700 ml)", GIN_RULES) == "contemporary_fruit"
    assert match_rules("Monkey 47  Sloe Gin (500 ml)", GIN_RULES) == "contemporary_fruit"


def test_gin_genuinely_unmatched_falls_to_none_not_juniper():
    # A gin with no brand correction and no keyword signal must now resolve
    # None — the entire point of the fix is stopping the false
    # juniper_forward default.
    assert match_rules("Boodles  Gin (700 ml)", GIN_RULES) is None


# ── AGAVE_RULES ──────────────────────────────────────────────────────────

def test_don_julio_1942_resolves_anejo_not_blanco_fallback():
    # LTQ0240BU / LTQ0203BU — confirmed wrong before the fix: fell through
    # to 'blanco', but 1942 is one of the most famous añejo tequilas in the
    # category (aged 2.5+ years).
    assert match_rules("Don Julio  1942 (750 ml)", AGAVE_RULES) == "anejo"
    assert match_rules("Don Julio  1942 (1.75 L)", AGAVE_RULES) == "anejo"


def test_plain_don_julio_blanco_still_resolves_blanco():
    assert match_rules("Don Julio  Blanco (750 ml)", AGAVE_RULES) == "blanco"


def test_clase_azul_gold_resolves_reposado_not_blanco_fallback():
    # LTQ0178CN — confirmed wrong before the fix: fell through to 'blanco',
    # but "Gold" tequilas are conventionally joven/reposado-tier, not unaged.
    assert match_rules("Clase Azul  Tequila Gold (750 ml)", AGAVE_RULES) == "reposado"


def test_agave_keyword_match_still_wins_over_fallback():
    # A plain "Silver" tequila must still resolve blanco via the keyword
    # match — regression guard against breaking existing correct matches.
    assert match_rules("Dos Companeros  Silver Tequila (700 ml)", AGAVE_RULES) == "blanco"
    assert match_rules("Código 1530  Tequila Resposado (750 ml)", AGAVE_RULES) == "reposado"
    assert match_rules("Herradura  Añejo (750 ml)", AGAVE_RULES) == "anejo"


def test_agave_genuinely_unmatched_falls_to_none_not_blanco():
    # A tequila/mezcal with no aging/color signal in its name at all must
    # resolve None, not the previous false blanco default.
    assert match_rules("Arquitecto  Tequila (700 ml)", AGAVE_RULES) is None


# ── RUM_RULES ────────────────────────────────────────────────────────────

def test_bumbu_xo_resolves_dark_aged_word_boundary_fix():
    # LRM0241BU — confirmed wrong before the fix: \bxo\b did not match
    # "X.O" (periods, no space), so it fell through to 'gold_light'. X.O
    # ("Extra Old") is an aging designation.
    assert match_rules("Bumbu  X.O Rum (700 ml)", RUM_RULES) == "dark_aged"


def test_bare_xo_still_matches():
    assert match_rules("Patron  XO Cafe Coffee Liqueur (750 ml)", RUM_RULES) == "dark_aged"


def test_aged_reserve_rums_resolve_dark_aged_not_gold_fallback():
    # All of these were confirmed in the fallback bucket before the fix —
    # each carries an explicit age/reserve statement.
    aged_examples = [
        "Appleton Estate  12 Years Old Rare Casks (750 ml)",
        "Appleton Estate  21 Years Old (750 ml)",
        "Appleton Estate  30 Years Old (750 ml)",
        "Diplomatico  Reserva Exclusiva (700 ml)",
        "Mount Gay  Rum Extra Old (700 ml)",
        "Havana Club  7 Years Rum (750 ml)",
        "Flor de Caña  18 years Centenario Rum (700 ml)",
        "Ron Matusalem  Gran Reserva 15 Year Rum (700 ml)",
        "Rum Sixty Six  12 YO Family Reserve (700 ml)",
    ]
    for name in aged_examples:
        assert match_rules(name, RUM_RULES) == "dark_aged", name


def test_gold_rum_resolves_gold_light_via_explicit_keyword():
    # "Gold Rum" / "Carta Oro" is a real named style (not a guess) —
    # explicit keyword match, checked after dark_aged so an age statement
    # still wins if both are present.
    assert match_rules("Phraya  Gold Rum (700 ml)", RUM_RULES) == "gold_light"
    assert match_rules("Bacardi  Carta Oro (Gold Rum) (750 ml)", RUM_RULES) == "gold_light"


def test_rum_keyword_match_still_wins_over_fallback():
    assert match_rules("Bacardi  Carta Negra (Black Rum) (750 ml)", RUM_RULES) == "dark_aged"
    assert match_rules("Malibu  Original Coconut Rum (700 ml)", RUM_RULES) is None


def test_rum_genuinely_unmatched_falls_to_none_not_gold_light():
    # A rum with no age/color signal at all in its name must resolve None,
    # not the previous false gold_light default.
    assert match_rules("Sailor Jerry  Rum (700 ml)", RUM_RULES) is None
