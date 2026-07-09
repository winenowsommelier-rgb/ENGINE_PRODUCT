"""Regression tests for scripts/assign_spirits_fields.py — peat_level
precedence + mis-taxonomied-SKU exclusion.

Pure, rule-based, NO DB access needed: match_rules() and
resolve_column_and_rules() are pure functions over (name, rules) /
(category_type, sku). This file locks in two real-data bugs that were each
found and fixed by hand during Task 10 review, so a future edit to rule
ordering can't silently reintroduce them:

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
"""
from __future__ import annotations

from scripts.assign_spirits_fields import (
    PEAT_RULES,
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
