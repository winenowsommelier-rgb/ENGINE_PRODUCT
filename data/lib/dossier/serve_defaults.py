"""Default serve_guidance_json derivation. Dossier generation only stores
EXCEPTIONS to these code-derived defaults -- most wines never need an LLM
call for serve temperature/glass/decant.

WSP (sparkling) and WDW (sweet/fortified) key on designation/dosage tokens,
NOT body/tannin -- for these two categories body/tannin derive nothing
useful.

category_type values below MUST match the real strings produced by the
SKU taxonomy resolver (data/lib/taxonomy/sku_taxonomy.py), NOT generic
labels -- verified against data/live_products_export.json 2026-07-16:
  - Sparkling & Champagne (896 SKUs) -- NOT bare "Sparkling"
  - Rosé Wine (182 SKUs) -- distinct from Red/White, must not fall through
  - Fortified (32 SKUs) + Sweet/Dessert (53 SKUs) -- WDW splits across BOTH
    real taxonomy strings, not a single "Fortified" value
An earlier version of this module used placeholder strings ("Sparkling",
"Fortified") copied from a plan doc's sample code -- those values never
occur in production, so every real Sparkling/Sweet-Dessert wine silently
fell through to Red Wine decant/aerate advice. Fixed 2026-07-16; see
tests/test_serve_defaults.py for regression coverage using the real strings.
"""
from __future__ import annotations

_SPARKLING = "Sparkling & Champagne"
_ROSE = "Rosé Wine"
_FORTIFIED_TYPES = ("Fortified", "Sweet/Dessert")


def _decant(type_: str, minutes_min: int = 0, minutes_max: int = 0) -> dict:
    return {"type": type_, "minutes_min": minutes_min, "minutes_max": minutes_max}


def default_serve_guidance(
    category_type: str,
    body: str | None,
    tannin: str | None,
    designation: str | None = None,
) -> dict:
    if category_type == _SPARKLING:
        d = (designation or "").lower()
        if "prestige" in d:
            return {"temp_c_min": 10, "temp_c_max": 12, "glass_code": "wide-tulip",
                    "decant": _decant("none"), "notes": "Prestige cuvee -- wider glass to open aromatics"}
        if "demi-sec" in d or "demi sec" in d:
            return {"temp_c_min": 8, "temp_c_max": 10, "glass_code": "flute",
                    "decant": _decant("none"), "notes": "Demi-sec"}
        # default: NV Brut
        return {"temp_c_min": 6, "temp_c_max": 8, "glass_code": "flute",
                "decant": _decant("none"), "notes": "NV Brut -- serve well chilled"}

    if category_type in _FORTIFIED_TYPES:
        d = (designation or "").lower()
        # "tawny" checked before "vintage" so a hypothetical "Vintage Tawny"
        # designation still gets no-decant tawny guidance, not sediment
        # decant meant for true Vintage Port.
        if "tawny" in d:
            return {"temp_c_min": 14, "temp_c_max": 16, "glass_code": "port-glass",
                    "decant": _decant("none"), "notes": "Tawny -- no sediment, no decant needed"}
        if "vintage port" in d or d == "vintage" or "vintage" in d:
            return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "port-glass",
                    "decant": _decant("sediment", 30, 120), "notes": "Vintage Port -- decant off sediment"}
        # generic sweet/fortified default (covers Sherry, Madeira, Sauternes-
        # style Sweet/Dessert rows with no specific designation token)
        return {"temp_c_min": 10, "temp_c_max": 12, "glass_code": "dessert-glass",
                "decant": _decant("none"), "notes": None}

    if category_type == _ROSE:
        # Rosé is its own style -- chilled like a light white, no tannin-
        # driven decant logic. Must NOT reuse Red Wine branch.
        return {"temp_c_min": 8, "temp_c_max": 11, "glass_code": "white-standard",
                "decant": _decant("none"), "notes": "Rosé -- serve chilled, no decant"}

    # Standard still-wine path: body/tannin derive the default.
    body = (body or "medium").lower()
    tannin = (tannin or "").lower()
    if category_type == "White Wine":
        if body == "light":
            return {"temp_c_min": 8, "temp_c_max": 10, "glass_code": "white-standard",
                    "decant": _decant("none"), "notes": None}
        return {"temp_c_min": 10, "temp_c_max": 13, "glass_code": "white-standard",
                "decant": _decant("none"), "notes": None}

    if category_type == "Red Wine":
        if body == "full" or tannin in ("high", "firm"):
            return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "bordeaux",
                    "decant": _decant("aerate", 30, 60), "notes": "Full-bodied -- benefits from aeration"}
        if body == "light":
            return {"temp_c_min": 13, "temp_c_max": 15, "glass_code": "burgundy",
                    "decant": _decant("none"), "notes": None}
        return {"temp_c_min": 15, "temp_c_max": 17, "glass_code": "bordeaux",
                "decant": _decant("none"), "notes": None}

    # Unrecognized category_type: fail loud rather than silently applying
    # Red Wine defaults. If the taxonomy adds a new category, this must
    # surface immediately instead of misapplying decant/glass advice.
    raise ValueError(f"no serve-guidance rule for category_type={category_type!r}")
