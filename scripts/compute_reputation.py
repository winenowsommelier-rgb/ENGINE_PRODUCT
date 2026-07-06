#!/usr/bin/env python3
"""Compute per-SKU reputation signals and write to products.db.

Phases:
  0 — Backup DB + run DDL
  1 — Per-axis scores → reputation_signals table
  2 — Rollup composite + tier + summary → products table
  3 — Verify output + run refresh_live_export.py
"""
from __future__ import annotations

import logging
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve as _resolve

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_PATH  = REPO_ROOT / "data" / "db" / "products.db"
SCRIPT   = REPO_ROOT / "scripts" / "refresh_live_export.py"

BEVERAGE_GROUPS = {"Wine", "Spirits", "Beer & Cider"}
STILL_WINE_TYPES = {"Red Wine", "White Wine", "Rosé"}

VALID_TIERS = {"iconic", "premium", "established", "everyday", "unrated"}

# Designation base scores.
# Keys are exact values as they appear in the products.designation column.
# Gran Reserva is NOT listed here — handled separately via _gran_reserva_base().
# Brut / Extra Brut deliberately excluded — dosage level, not prestige designation.
DESIGNATION_TABLE: dict[str, int] = {
    "Grand Cru":        95,
    "Premier Cru":      88,
    "1er Cru":          88,
    "Cru Classé":       82,
    "DOCG":             82,
    "Reserva Especial": 74,
    "Reserva Privada":  74,
    "XO":               75,
    "DOC":              70,
    "Reserva":          70,
    "Single Malt":      68,
    "VSOP":             62,
    "Blanc de Blancs":  60,
    "Blanc de Noirs":   58,
    "Villages":         52,
}

PRICE_BONUS_TABLE = [
    (50_000, 52),
    (10_000, 38),
    (2_000,  22),
    (500,     8),
    (0,       0),
]

AXIS_WEIGHTS = {
    "acclaim":    0.35,
    "prestige":   0.35,
    "popularity": 0.20,
    "producer":   0.10,
}


# ---------------------------------------------------------------------------
# Prestige helpers
# ---------------------------------------------------------------------------

def _price_bonus(price: float | None) -> int:
    if not price:
        return 0
    for threshold, bonus in PRICE_BONUS_TABLE:
        if price >= threshold:
            return bonus
    return 0


def _gran_reserva_base(sku: str, country: str | None) -> int:
    """Return 82 for Spain/Argentina still wine, 75 for everything else."""
    tax = _resolve({"sku": sku})
    is_regulated = (
        tax["group"] == "Wine"
        and tax.get("type") in STILL_WINE_TYPES
        and country in ("Spain", "Argentina")
    )
    return 82 if is_regulated else 75


def _designation_base(designation: str | None, sku: str, country: str | None) -> int:
    if not designation:
        return 20
    if designation == "Gran Reserva":
        return _gran_reserva_base(sku, country)
    return DESIGNATION_TABLE.get(designation, 20)


def prestige_score(
    designation: str | None,
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
) -> int:
    base = _designation_base(designation, sku, country)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_score_multi(
    designations: list[str],
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
) -> int:
    """Take the MAX base score across multiple designations, then add bonuses once."""
    if not designations:
        base = 20
    else:
        base = max(_designation_base(d, sku, country) for d in designations)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_confidence(designation: str | None, appellation: str | None) -> float:
    if designation:
        return 0.9
    if appellation:
        return 0.6
    return 0.4


# ---------------------------------------------------------------------------
# Acclaim helpers
# ---------------------------------------------------------------------------

def acclaim_score_for_sku(
    sku: str,
    critic_rows: list[dict],
) -> tuple[float | None, float, str]:
    """
    Returns (score, confidence, source_note).

    critic_rows must be pre-filtered to this SKU and must include keys:
      critic, score, pct  (where pct is within-critic percentile 0–100).

    Aggregates per (sku, critic) with MAX(score) — uses the pct of the
    max-score row — before averaging across critics.
    """
    if not critic_rows:
        return None, 0.0, ""

    # Deduplicate per critic: keep row with max score
    best_per_critic: dict[str, dict] = {}
    for row in critic_rows:
        critic = row["critic"]
        if critic not in best_per_critic or row["score"] > best_per_critic[critic]["score"]:
            best_per_critic[critic] = row

    num_critics = len(best_per_critic)
    avg_pct = sum(r["pct"] for r in best_per_critic.values()) / num_critics
    confidence = min(1.0, num_critics / 3)

    # Build source note from highest-pct critic
    best = max(best_per_critic.values(), key=lambda r: r["pct"])
    pct_display = max(1, round(100 - best["pct"]))  # "top X%" = 100 - percentile; floor at 1
    source_note = (
        f"Rated {int(best['score'])}/100 by {best['critic']} "
        f"(top {pct_display}% of their reviews)."
    )
    return avg_pct, confidence, source_note


# ---------------------------------------------------------------------------
# Popularity helpers
# ---------------------------------------------------------------------------

def _demand(sold_qty, sold_orders) -> int:
    return (sold_qty or 0) + ((sold_orders or 0) * 2)


def popularity_percentile(skus: list[dict]) -> dict[str, dict]:
    """
    Returns {sku: {score, confidence, source_note}} for all input SKUs.

    Groups by 3-char prefix; falls back to 1-char prefix family for groups < 3.
    """
    from collections import defaultdict

    # Group by 3-char prefix
    by_prefix3: dict[str, list[dict]] = defaultdict(list)
    for s in skus:
        by_prefix3[str(s["sku"]).upper()[:3]].append(s)

    # For thin groups (< 3), merge into 1-char family group
    by_letter: dict[str, list[dict]] = defaultdict(list)
    for prefix, members in by_prefix3.items():
        if len(members) < 3:
            letter = prefix[:1]
            by_letter[letter].extend(members)

    def _percentile_rank(items: list[dict]) -> dict[str, float]:
        n = len(items)
        if n == 1:
            return {items[0]["sku"]: 50.0}
        sorted_items = sorted(items, key=lambda s: _demand(s["sold_qty"], s["sold_orders"]))
        return {
            s["sku"]: (i / (n - 1)) * 100
            for i, s in enumerate(sorted_items)
        }

    result: dict[str, dict] = {}

    # Score thin-group SKUs using letter-family ranking
    for letter, members in by_letter.items():
        ranks = _percentile_rank(members)
        for s in members:
            sku = s["sku"]
            score = ranks[sku]
            conf = 0.8 if _demand(s["sold_qty"], s["sold_orders"]) > 0 else 0.3
            pct_display = max(1, round(100 - score))
            note = f"Top {pct_display}% by sales in its broader category." if conf == 0.8 else ""
            result[sku] = {"score": score, "confidence": conf, "source_note": note}

    # Score normal groups (≥ 3 members)
    for prefix, members in by_prefix3.items():
        if len(members) < 3:
            continue
        ranks = _percentile_rank(members)
        for s in members:
            sku = s["sku"]
            score = ranks[sku]
            conf = 0.8 if _demand(s["sold_qty"], s["sold_orders"]) > 0 else 0.3
            pct_display = max(1, round(100 - score))
            note = f"Top {pct_display}% by sales in its category." if conf == 0.8 else ""
            result[sku] = {"score": score, "confidence": conf, "source_note": note}

    return result


# ---------------------------------------------------------------------------
# Composite + tier + summary
# ---------------------------------------------------------------------------

def composite_score(axes: dict[str, dict]) -> float | None:
    """Weighted confidence composite. Returns None if denominator is 0."""
    numerator = 0.0
    denominator = 0.0
    for axis, weight in AXIS_WEIGHTS.items():
        ax = axes.get(axis, {})
        score = ax.get("score")
        conf  = ax.get("confidence", 0.0)
        if score is not None:
            numerator   += score * weight * conf
        denominator += weight * conf
    if denominator == 0:
        return None
    return numerator / denominator


def tier_for_composite(
    score: float | None,
    confidence: float,
    override: str | None = None,
) -> str:
    if override is not None:
        if override in VALID_TIERS:
            return override
        else:
            log.warning("Invalid reputation_override value %r — ignoring", override)
    if score is None or confidence < 0.3:
        return "unrated"
    if score >= 85:
        return "iconic"
    if score >= 65:
        return "premium"
    if score >= 40:
        return "established"
    return "everyday"


def _weighted_confidence(axes: dict[str, dict]) -> float:
    numerator = denominator = 0.0
    for axis, weight in AXIS_WEIGHTS.items():
        conf = axes.get(axis, {}).get("confidence", 0.0)
        numerator   += conf * weight
        denominator += weight
    return numerator / denominator if denominator else 0.0


def reputation_summary(axes: dict[str, dict]) -> str | None:
    """Template-based one-sentence copy. Returns None (not '') when no signal qualifies."""
    acclaim = axes.get("acclaim", {})
    prestige = axes.get("prestige", {})
    popularity = axes.get("popularity", {})
    producer = axes.get("producer", {})

    if (acclaim.get("score") or 0) >= 70 and (acclaim.get("confidence") or 0) >= 0.5:
        return acclaim.get("source_note") or None
    if prestige.get("source_note"):
        return prestige["source_note"]
    if (popularity.get("score") or 0) >= 70:
        return popularity.get("source_note") or None
    if (producer.get("confidence") or 0) >= 0.7:
        return producer.get("source_note") or None
    return None
