"""Pure functions for product naming, website detection, and image specs.

No I/O. No globals mutated. Every function is unit-tested.
"""
from __future__ import annotations

import re

WINE_NOW_PREFIXES: frozenset[str] = frozenset({
    # Wines
    "WRW", "WWW", "WSP", "WRS", "WDW", "WOW", "WEV", "WBS", "WNA", "WTK",
    # Wine personalization
    "AWN",
    # Wine-side accessories / glassware
    "ABA", "GWN", "GLQ", "GDC", "GBE", "GWA", "AWC",
})

LIQ9_PREFIXES: frozenset[str] = frozenset({
    # Spirits / liquor
    "LWH", "LSK", "LLQ", "LGN", "LBE", "LTQ", "LVK", "LRM", "LBD",
    "LOT", "LSJ", "LGP", "LWF", "LAB", "LCC", "LWS", "LSN", "LKS",
    "LRD", "LBS", "LWL", "LAQ",
    # Cigars
    "CIG",
    # Mixers / non-alc (user-decided routing)
    "NNA", "MNA",
})

# System products: shipping, coupons, gift cards, shipping fees. No SEO suffix.
NO_SUFFIX_PREFIXES: frozenset[str] = frozenset({
    "DEL", "ECP", "GIF", "ANG", "FYC", "NJV",
})


def detect_website(sku: str) -> str | None:
    """Return 'wine-now', 'liq9', or None (system / unknown).

    None is intentional for system products (shipping, coupons, gift cards) —
    those records will have no '| Website' suffix in their SEO title.
    """
    if not sku or len(sku) < 3:
        return None
    prefix = sku[:3]
    if prefix in WINE_NOW_PREFIXES:
        return "wine-now"
    if prefix in LIQ9_PREFIXES:
        return "liq9"
    return None


def normalize_vintage(raw: str) -> str | None:
    """'Current vintage' -> None, 'NV' -> 'NV', year kept, blank -> None."""
    if not raw:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    if cleaned.lower() == "current vintage":
        return None
    return cleaned


def normalize_bottle_size(raw: str) -> str | None:
    """'750 ml' -> '750ml', '1.5 L' -> '1500ml', blank -> None.

    Handles integer + decimal L values. Falls back to the stripped original
    string if parsing fails (so unexpected formats like '3x750ml' pass through).
    """
    if not raw:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    # L / l / Liter / liter -> ml
    match = re.fullmatch(r"([\d.]+)\s*[Ll]", cleaned)
    if match:
        value_l = float(match.group(1))
        return f"{int(round(value_l * 1000))}ml"
    # ml / mL / ML with optional space
    match = re.fullmatch(r"([\d.]+)\s*[mM][lL]", cleaned)
    if match:
        value_ml = float(match.group(1))
        return f"{int(round(value_ml))}ml"
    # Unknown format -> slug-safe pass-through (strip internal spaces only)
    return cleaned.replace(" ", "")


def clean_name(raw: str) -> str:
    """Collapse internal whitespace runs to single spaces, trim ends."""
    if not raw:
        return ""
    return re.sub(r"\s+", " ", raw).strip()
