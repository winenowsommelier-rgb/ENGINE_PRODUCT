"""Pure functions for product naming, website detection, and image specs.

No I/O. No globals mutated. Every function is unit-tested.
"""
from __future__ import annotations

import re
import unicodedata

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


def _slugify(text: str) -> str:
    """Lower-case, ASCII-only, hyphen-separated. Used for both slugs + filenames."""
    # Normalize unicode + strip combining marks (diacritics)
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    # Lowercase
    lowered = ascii_only.lower()
    # Replace any run of non-[a-z0-9] with a single hyphen
    hyphenated = re.sub(r"[^a-z0-9]+", "-", lowered)
    # Collapse repeated hyphens, strip leading/trailing
    return hyphenated.strip("-")


def to_slug(brand: str, name: str, vintage: str, size: str) -> str:
    """Produce a URL-safe slug from brand + name + vintage + size.

    Examples:
        to_slug('Batasiolo', 'Moscato Spumante Dolce', 'NV', '750 ml')
            -> 'batasiolo-moscato-spumante-dolce-nv-750ml'

    'Current vintage' and blank values are dropped entirely from the slug.
    """
    tokens = [clean_name(brand), clean_name(name)]
    v = normalize_vintage(vintage)
    if v:
        tokens.append(v)
    s = normalize_bottle_size(size)
    if s:
        tokens.append(s)
    joined = " ".join(t for t in tokens if t)
    return _slugify(joined)


_WEBSITE_DISPLAY = {"wine-now": "Wine-Now", "liq9": "Liq9"}


def to_seo_title(
    brand: str, name: str, vintage: str, size: str, website: str | None
) -> str:
    """Produce an SEO-ready display title.

    Example:
        'Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now'

    When website is None, the ' | Website' suffix is omitted (system products).
    """
    tokens = [clean_name(brand), clean_name(name)]
    v = normalize_vintage(vintage)
    if v:
        tokens.append(v)
    s = normalize_bottle_size(size)
    if s:
        tokens.append(s)
    core = " ".join(t for t in tokens if t)
    if website and website in _WEBSITE_DISPLAY:
        return f"{core} | {_WEBSITE_DISPLAY[website]}"
    return core


def to_image_filename_base(
    brand: str, name: str, vintage: str, size: str, sku: str
) -> str:
    """Slug-shaped filename stem including the SKU (no extension)."""
    slug = to_slug(brand, name, vintage, size)
    sku_part = sku.strip().lower()
    return f"{slug}-{sku_part}" if slug else sku_part
