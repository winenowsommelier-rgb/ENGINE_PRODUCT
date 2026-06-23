"""Universal flat-attribute scales + per-category variety vocab for Phase B.

Rule-12 clean: keyed on the SKU-derived category GROUP (the value from
sku_taxonomy.resolve(row)["group"]), NEVER the magento product field.
Used by scripts/enrich_phase_b.py to constrain LLM output.
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
    """Return value if it's in the group's allowlist, else None (unknown group -> None)."""
    return value if value in (VARIETY_VOCAB.get(group) or []) else None

def schema_for_group(group):
    """Rule-12 clean lookup keyed on the SKU-derived GROUP — i.e. the value from
    sku_taxonomy.resolve(row)["group"]. Returns the applicable fields + the
    variety vocab for that group, or None if it's not a Phase-B group.

    Callers MUST pass the GROUP, never the SKU-taxonomy product type: the two
    diverge for Spirits/Sake/Beer (e.g. group "Spirits" -> type "Gin"/"Rum"),
    and the vocab here is group-keyed, so passing the type would return None
    and silently skip those products after the LLM has already been paid."""
    vocab = VARIETY_VOCAB.get(group)
    if vocab is None:
        return None
    return {"fields": ["variety", "body"], "variety_vocab": vocab,
            "body_scale": BODY_SCALE}
