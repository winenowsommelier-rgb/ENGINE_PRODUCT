"""Universal flat-attribute scales + per-category variety vocab for Phase B.

Rule-12 clean: keyed on the SKU-derived category GROUP/TYPE, NEVER the magento
product-type field. Used by scripts/enrich_phase_b.py to constrain LLM output.
"""
from __future__ import annotations

# 4-step body scale — the intersection the SHOP filter and FINDER ladder both accept.
# Medium-Light is OUT (shop remaps it to Medium -> silent collapse). See spec section 4.1.
BODY_SCALE = ["Light", "Medium", "Medium-Full", "Full"]

# Per-category (group) variety allowlists. Keys are SKU-taxonomy GROUP names.
VARIETY_VOCAB: dict[str, list[str]] = {
    "Whisky": ["Single Malt", "Blended Malt", "Blended", "Bourbon", "Rye",
               "Tennessee", "Single Pot Still", "Single Grain", "Corn"],
    "Spirits": ["Agave", "Cane/Molasses", "Grain", "Grape", "Potato",
                "Juniper-Botanical", "Other"],
    "Sake & Asian": ["Junmai", "Junmai Ginjo", "Junmai Daiginjo", "Honjozo",
                     "Ginjo", "Daiginjo", "Nigori", "Shochu", "Other"],
    "Liqueur": ["Herbal", "Fruit", "Cream", "Coffee", "Nut", "Anise",
                "Bitter/Amaro", "Other"],
    "Beer & RTD": ["Lager", "Ale/IPA", "Stout", "Wheat", "RTD-Cocktail",
                   "Hard-Seltzer", "Cider", "Other"],
}

def validate_body(value):
    """Return value if it's an exact 4-step scale member, else None (drop, never coerce)."""
    return value if value in BODY_SCALE else None

def validate_variety(group, value):
    """Return value if it's in the group's allowlist, else None."""
    return value if value in VARIETY_VOCAB.get(group, []) else None

def schema_for_type(category_type):
    """Rule-12 clean lookup keyed on SKU-derived group/type. Returns applicable
    fields + the variety vocab for that group. None if not a Phase-B group."""
    vocab = VARIETY_VOCAB.get(category_type)
    if vocab is None:
        return None
    return {"fields": ["variety", "body"], "variety_vocab": vocab,
            "body_scale": BODY_SCALE}
