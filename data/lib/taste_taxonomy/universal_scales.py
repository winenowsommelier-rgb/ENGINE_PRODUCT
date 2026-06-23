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

# Run-2 gauge scales. acidity & tannin share one 4-step ladder; sweetness uses the
# product-page GAUGE scale (Dry..Sweet), which is INTENTIONALLY NOT the sake
# sweetness ladder — see spec §4.0. Off-scale values are dropped, never coerced.
ACIDITY_TANNIN_SCALE = ["Low", "Medium", "Medium-High", "High"]
SWEETNESS_SCALE = ["Dry", "Off-Dry", "Medium-Sweet", "Sweet"]  # product-page GAUGE scale (NOT the sake ladder)

# Wine grape/style allowlist (group == "Wine"). Wine is NOT in VARIETY_VOCAB
# (that dict is non-wine groups only); variety_vocab_for() routes Wine here.
WINE_GRAPE_VOCAB = [
    "Cabernet Sauvignon", "Pinot Noir", "Syrah", "Shiraz", "Sangiovese", "Tempranillo",
    "Merlot", "Grenache", "Chardonnay", "Sauvignon Blanc", "Riesling", "Pinot Grigio",
    "Viognier", "Semillon", "Glera",
    "Malbec", "Zinfandel", "Primitivo", "Nebbiolo", "Barbera", "Nero d'Avola",
    "Montepulciano", "Carmenere", "Cabernet Franc", "Petit Verdot", "Chenin Blanc",
    "Gewurztraminer", "Gruner Veltliner", "Albarino", "Verdejo", "Torrontes",
    "Moscato", "Muscat", "Malvasia", "Garganega", "Vermentino", "Gamay",
    "Bordeaux Blend", "GSM", "Rhone Blend", "Field Blend",
]


def validate_body(value):
    """Return value if it's an exact 4-step scale member, else None (drop, never coerce)."""
    return value if value in BODY_SCALE else None


def variety_vocab_for(group):
    """Return the variety allowlist for a GROUP (Rule 12). Wine -> grape vocab;
    other groups -> VARIETY_VOCAB; unknown group -> [] (no vocab)."""
    if group == "Wine":
        return WINE_GRAPE_VOCAB
    return VARIETY_VOCAB.get(group) or []


def validate_variety(group, value):
    """Return value if it's in the group's allowlist, else None (unknown group -> None)."""
    return value if value in variety_vocab_for(group) else None


def _scale_validator(scale):
    def _v(value):
        return value if value in scale else None
    return _v


validate_acidity   = _scale_validator(ACIDITY_TANNIN_SCALE)
validate_tannin    = _scale_validator(ACIDITY_TANNIN_SCALE)
validate_sweetness = _scale_validator(SWEETNESS_SCALE)

# Field config the enrich pipeline iterates over (parameterized field set, Task 0).
# "variety"'s validator takes (group, value); the gauge-field validators take (value).
FIELD_SPECS = {
    "variety":   {"validate": validate_variety},   # validator takes (group, value)
    "body":      {"scale": BODY_SCALE,            "validate": validate_body},
    "acidity":   {"scale": ACIDITY_TANNIN_SCALE,  "validate": validate_acidity},
    "tannin":    {"scale": ACIDITY_TANNIN_SCALE,  "validate": validate_tannin},
    "sweetness": {"scale": SWEETNESS_SCALE,        "validate": validate_sweetness},
}

# §4.0 per-category applicability matrix. Wine types are SKU-taxonomy `type`
# literals (Red Wine, White Wine, ...). Reds/Orange get tannin; the sweeter/
# white/sparkling/fortified/dessert wines get a sweetness gauge; Liqueur gets
# body+acidity+sweetness. Everything drinkable gets variety.
_RED_TYPES = {"Red Wine", "Orange Wine"}
_SWEETNESS_WINE_TYPES = {"Sweet/Dessert", "Fortified", "White Wine", "Sparkling & Champagne"}


def applies(group, wine_type=None):
    """Return the set of fields that apply to (group, wine_type) per spec §4.0."""
    s = {"variety"}
    if group in ("Wine", "Sake & Asian", "Liqueur"):
        s.add("body")
    if group in ("Wine", "Liqueur"):
        s.add("acidity")
    if group == "Wine" and wine_type in _RED_TYPES:
        s.add("tannin")
    if group == "Wine" and wine_type in _SWEETNESS_WINE_TYPES:
        s.add("sweetness")
    if group == "Liqueur":
        s.add("sweetness")
    return s

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
