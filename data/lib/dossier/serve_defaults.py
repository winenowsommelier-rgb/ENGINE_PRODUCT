"""Default serve_guidance_json derivation. Dossier generation only stores
EXCEPTIONS to these code-derived defaults -- most wines never need an LLM
call for serve temperature/glass/decant.

WSP (sparkling) and WDW (sweet/fortified) key on designation/dosage tokens,
NOT body/tannin -- for these two categories body/tannin derive nothing
useful.
"""
from __future__ import annotations


def _decant(type_: str, minutes_min: int = 0, minutes_max: int = 0) -> dict:
    return {"type": type_, "minutes_min": minutes_min, "minutes_max": minutes_max}


def default_serve_guidance(
    category_type: str,
    body: str | None,
    tannin: str | None,
    designation: str | None = None,
) -> dict:
    if category_type == "Sparkling":
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

    if category_type == "Fortified":
        d = (designation or "").lower()
        if "vintage port" in d or "vintage" in d:
            return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "port-glass",
                    "decant": _decant("sediment", 30, 120), "notes": "Vintage Port -- decant off sediment"}
        if "tawny" in d:
            return {"temp_c_min": 14, "temp_c_max": 16, "glass_code": "port-glass",
                    "decant": _decant("none"), "notes": "Tawny -- no sediment, no decant needed"}
        # generic sweet/fortified default
        return {"temp_c_min": 10, "temp_c_max": 12, "glass_code": "dessert-glass",
                "decant": _decant("none"), "notes": None}

    # Standard still-wine path: body/tannin derive the default.
    body = (body or "medium").lower()
    tannin = (tannin or "").lower()
    if category_type == "White Wine":
        if body == "light":
            return {"temp_c_min": 8, "temp_c_max": 10, "glass_code": "white-standard",
                    "decant": _decant("none"), "notes": None}
        return {"temp_c_min": 10, "temp_c_max": 13, "glass_code": "white-standard",
                "decant": _decant("none"), "notes": None}

    # Red Wine (default category)
    if body == "full" or tannin in ("high", "firm"):
        return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "bordeaux",
                "decant": _decant("aerate", 30, 60), "notes": "Full-bodied -- benefits from aeration"}
    if body == "light":
        return {"temp_c_min": 13, "temp_c_max": 15, "glass_code": "burgundy",
                "decant": _decant("none"), "notes": None}
    return {"temp_c_min": 15, "temp_c_max": 17, "glass_code": "bordeaux",
            "decant": _decant("none"), "notes": None}
