#!/usr/bin/env python3
"""Onboard in-stock mf-only beverages as sellable products. See spec 2026-06-25."""
from __future__ import annotations
import re


def parse_money(v) -> float | None:
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v))          # strip ฿, commas, spaces
    if s in ("", "-", ".", "--"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f


def pct_str(ratio: float | None) -> str | None:
    """Format a ratio as production's pct column does.

    VERIFIED 2026-06-25 against data/db/products.db (11,298 non-null margin_pct
    rows, 3000-row sample): production stores margin_pct / b2b_margin_pct /
    sp_discount_pct as a BARE 2-decimal percent NUMBER stored as TEXT — e.g.
    '31.43', '30.0', '20.4' — NOT an integer 'NN%' string and NOT a '0.31' float.
    `str(round(ratio*100, 2))` reproduced all 3000 sampled rows exactly (0
    mismatches). Only 36/11,298 rows carry a literal '%' and are legacy junk.

    The original task-spec format ('27%') disagreed with the live DB; this
    helper writes a payment-path field, so production format wins (CLAUDE.md
    Rule 1 verify-don't-infer, Rule 5 don't-lock-in-a-bug). The
    test_recompute_matches_existing_db_row invariant guards this.

    Rounding mode = round() (banker's / half-to-even); it matched production
    exactly, so no ROUND_HALF_UP override was needed.
    """
    if ratio is None:
        return None
    return str(round(ratio * 100, 2))


def recompute_margins(cost, price, special_price, b2b_price) -> dict:
    """All derived from INPUT cost/price/b2b. File's own margin cells are ignored."""
    out = {"margin_thb": None, "margin_pct": None, "sp_discount_pct": None,
           "b2b_margin_thb": None, "b2b_margin_pct": None, "b2b_discount_pct": None}
    if cost is not None and price:
        out["margin_thb"] = round(price - cost, 2)
        out["margin_pct"] = pct_str((price - cost) / price) if price > 0 else None
    if special_price and price and price > 0:
        out["sp_discount_pct"] = pct_str((price - special_price) / price)
    if b2b_price and cost is not None:
        out["b2b_margin_thb"] = round(b2b_price - cost, 2)
        out["b2b_margin_pct"] = pct_str((b2b_price - cost) / b2b_price) if b2b_price > 0 else None
    return out
