"""Pure functions for product naming, website detection, and image specs.

No I/O. No globals mutated. Every function is unit-tested.
"""
from __future__ import annotations

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
