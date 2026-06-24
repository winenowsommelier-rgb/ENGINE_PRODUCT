"""Pure, DB-free, network-free helpers for the taste-data audit.

No sqlite, no anthropic, no filesystem side effects here — that lives in
scripts/audit_taste_data.py. Everything in this module is unit-testable in
isolation. See docs/superpowers/specs/2026-06-24-taste-data-quality-audit-design.md
"""
from __future__ import annotations

import math
import random
import re


def is_populated(value) -> bool:
    """A taste value counts as present iff it is a non-blank string.

    Guards the ~2,988 empty-string `variety` rows that `IS NOT NULL` miscounts.
    """
    return bool(value is not None and str(value).strip() != "")


def split_variety(value) -> list:
    """variety is comma-delimited multi-value; split + trim, drop blanks."""
    if not is_populated(value):
        return []
    return [tok.strip() for tok in str(value).split(",") if tok.strip()]


# --- Deterministic triage rules -------------------------------------------

# Peated distilleries whose core/this-expression is smoky even with NO "peat"
# token in the name. Extend as needed; this is the seed list from the spec.
PEATED_DISTILLERIES = {
    "talisker", "ledaig", "caol ila", "kilchoman", "lagavulin", "laphroaig",
    "ardbeg", "bowmore", "smokehead", "octomore", "port charlotte",
    "bunnahabhain", "springbank", "longrow", "kilkerran",
}
# Brand names containing a smoke word but NOT actually peated whisky.
SMOKY_BRAND_NOT_PEAT = {"ole smoky"}

_EXTRA_DRY = re.compile(r"\bextra\s*dry\b", re.I)
_SPARKLING_TYPES = {"Sparkling & Champagne"}
_NONBEVERAGE_GROUPS = {"Accessories", "Events", "Non-Alcoholic"}


def _finding(sku, column, value, expected, rule, reason):
    return {"sku": sku, "column": column, "current_value": value,
            "expected_value": expected, "rule": rule, "reason": reason}


def triage_sweetness(sku, name, value, group, type_):
    """Sparkling 'Extra Dry' tagged Dry is an inversion -> Off-Dry."""
    if type_ in _SPARKLING_TYPES and _EXTRA_DRY.search(name or "") and value == "Dry":
        return _finding(sku, "sweetness", value, "Off-Dry",
                        "sparkling_extra_dry_inversion",
                        "Extra Dry (12-17 g/L) is sweeter than Brut; 'Dry' label is inverted")
    return None


def triage_nonbeverage(sku, name, column, value, group, type_):
    """variety/body on a non-beverage (glassware, events) should be NULL."""
    if group in _NONBEVERAGE_GROUPS and column in ("variety", "body"):
        return _finding(sku, column, value, None, "nonbeverage_taste_leak",
                        f"{column} populated on non-beverage group {group}")
    return None


def _name_has(name, needles):
    nl = (name or "").lower()
    return any(k in nl for k in needles)


def triage_smokiness(sku, name, value, group, type_):
    """3-state smokiness checks: peated false-neg, brand-not-peat false-pos."""
    if _name_has(name, SMOKY_BRAND_NOT_PEAT) and value == "heavy":
        return _finding(sku, "smokiness", value, "none", "smoky_brand_false_positive",
                        "name carries a smoke BRAND, not an actual peated whisky")
    if _name_has(name, PEATED_DISTILLERIES) and value in ("none", "", None):
        return _finding(sku, "smokiness", value, "heavy", "peated_false_negative",
                        "distillery is on the peated lexicon but tagged not-smoky")
    return None


def triage_body_case(sku, name, value, group, type_):
    """Lowercase body case-dupes -> canonical BODY_SCALE token.

    Only the four canonical lowercase tokens are mapped; 'medium-light' is NOT a
    BODY_SCALE value (it silently collapses to Medium per universal_scales) so it
    is deliberately excluded here to avoid emitting an off-scale expected_value.
    """
    canon = {"light": "Light", "medium": "Medium",
             "medium-full": "Medium-Full", "full": "Full"}
    if value in canon:
        return _finding(sku, "body", value, canon[value],
                        "body_case_dup", "lowercase body token -> canonical BODY_SCALE")
    return None


def triage_inapplicable(sku, name, column, value, group, type_):
    """A populated value in a column that does not apply to the category."""
    from data.lib.taste_taxonomy import universal_scales
    if column not in universal_scales.applies(group, type_):
        return _finding(sku, column, value, None, "inapplicable_column",
                        f"{column} does not apply to {group}/{type_} per applies()")
    return None


# --- Sampling + statistics -------------------------------------------------

def wilson_lower_bound(failures: int, n: int, z: float = 1.96) -> float:
    """Wilson score lower bound for a proportion. n==0 -> 0.0."""
    if n == 0:
        return 0.0
    phat = failures / n
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)
    return max(0.0, (centre - margin) / denom)


def stratified_control(rows: list, key: str, per_type: int, seed: int) -> list:
    """Sample up to `per_type` rows from each stratum `row[key]`, deterministically."""
    rng = random.Random(seed)
    buckets: dict = {}
    for r in rows:
        buckets.setdefault(r.get(key), []).append(r)
    out = []
    for k in sorted(buckets, key=lambda x: (x is None, str(x))):
        group_rows = sorted(buckets[k], key=lambda r: r.get("sku", ""))
        if len(group_rows) <= per_type:
            out.extend(group_rows)
        else:
            out.extend(rng.sample(group_rows, per_type))
    return out
