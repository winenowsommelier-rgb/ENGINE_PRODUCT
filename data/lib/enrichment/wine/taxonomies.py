"""Wine enrichment taxonomies — enums, heuristics, fuzzy-repair table.

Pure constants + pure functions. No I/O.
"""
from __future__ import annotations

BODY_VALUES: tuple[str, ...] = ("Light", "Medium", "Medium-Full", "Full")
ACIDITY_VALUES: tuple[str, ...] = ("Low", "Medium", "Medium-High", "High")
TANNIN_VALUES: tuple[str, ...] = ("Low", "Medium", "Medium-High", "High")

BLEND_TYPES: tuple[str, ...] = (
    "Single Varietal",
    "Bordeaux Red Blend",
    "Bordeaux White Blend",
    "Rhône North Blend",
    "Rhône South Blend (GSM)",
    "Champagne Blend",
    "Super Tuscan",
    "Port-Style Blend",
    "Sherry-Style Blend",
    "Field Blend",
    "Proprietary Blend",
    "Unknown Blend",
)

PRODUCTION_STYLES: tuple[str, ...] = (
    "Conventional", "Natural", "Biodynamic", "Organic", "Orange", "Pet-Nat", "Vegan",
)

# Fuzzy-repair table for common AI variants.
_BODY_REPAIR: dict[str, str] = {
    "Medium-Heavy": "Medium-Full",
    "Light-Medium": "Medium",
    "Heavy": "Full",
    "Light Body": "Light",
    "Medium Body": "Medium",
    "Full Body": "Full",
    "Full-Bodied": "Full",
    "Light-Bodied": "Light",
}

_BLEND_REPAIR: dict[str, str] = {
    "GSM": "Rhône South Blend (GSM)",
    "Rhone Blend": "Rhône South Blend (GSM)",
    "Rhône Blend": "Rhône South Blend (GSM)",
    "Bordeaux Blend": "Bordeaux Red Blend",
    "Bordeaux-Style Blend": "Bordeaux Red Blend",
}


def repair_body(value: str) -> str | None:
    """Return canonical body value, or None if not recoverable."""
    if value in BODY_VALUES:
        return value
    return _BODY_REPAIR.get(value)


def repair_acidity(value: str) -> str | None:
    if value in ACIDITY_VALUES:
        return value
    mapping = {"Medium-Heavy": "Medium-High", "Crisp": "High", "Soft": "Low"}
    return mapping.get(value)


def repair_tannin(value: str) -> str | None:
    if value in TANNIN_VALUES:
        return value
    mapping = {"Soft": "Low", "Firm": "Medium-High", "Grippy": "High"}
    return mapping.get(value)


def repair_blend_type(value: str) -> str | None:
    if value in BLEND_TYPES:
        return value
    return _BLEND_REPAIR.get(value)


# Grape+region heuristic profiles. Used when Winesensed + brand library both miss.
_HEURISTICS: dict[tuple[str, str], str] = {
    # Australia
    ("Shiraz", "Barossa Valley"): "Full body, high tannin, dark fruit (blackberry, blueberry), spice (clove, pepper), chocolate notes, oak-driven.",
    ("Shiraz", "McLaren Vale"): "Full body, ripe blackberry, plum, mocha, soft tannin.",
    ("Cabernet Sauvignon", "Coonawarra"): "Full body, high tannin, blackcurrant, mint, eucalyptus, structured.",
    ("Pinot Noir", "Yarra Valley"): "Light-medium body, medium tannin, red cherry, raspberry, earthy.",
    # France
    ("Pinot Noir", "Burgundy"): "Medium body, high acidity, medium tannin, red fruit (cherry, raspberry), earth, mushroom, silky texture.",
    ("Cabernet Sauvignon", "Bordeaux"): "Full body, high tannin, blackcurrant, cedar, tobacco, age-worthy.",
    ("Merlot", "Bordeaux"): "Medium-Full body, medium tannin, plum, chocolate, soft texture.",
    ("Syrah", "Northern Rhône"): "Full body, high tannin, blackberry, smoked meat, white pepper, olive.",
    ("Grenache", "Châteauneuf-du-Pape"): "Full body, medium tannin, raspberry, herbs (garrigue), warm spice.",
    ("Sauvignon Blanc", "Sancerre"): "Light-medium body, high acidity, citrus, gooseberry, flinty mineral.",
    ("Chardonnay", "Chablis"): "Medium body, high acidity, citrus, green apple, oyster-shell mineral.",
    ("Chardonnay", "Burgundy"): "Medium-Full body, medium-high acidity, lemon, apple, hazelnut, subtle oak.",
    # Italy
    ("Sangiovese", "Tuscany"): "Medium-Full body, high acidity, medium-high tannin, sour cherry, dried herbs, leather.",
    ("Nebbiolo", "Piedmont"): "Full body, high tannin, high acidity, rose, tar, dried cherry, age-worthy.",
    ("Corvina", "Veneto"): "Medium body, medium tannin, sour cherry, almond, herbal (Valpolicella style).",
    # Spain
    ("Tempranillo", "Rioja"): "Medium-Full body, medium tannin, red cherry, leather, vanilla oak, dried herbs.",
    ("Garnacha", "Priorat"): "Full body, high tannin, blackberry, licorice, slate mineral, concentrated.",
    ("Albariño", "Rías Baixas"): "Light body, high acidity, citrus, white peach, sea salt, mineral.",
    # USA
    ("Cabernet Sauvignon", "Napa Valley"): "Full body, high tannin, ripe blackcurrant, vanilla oak, cedar, tobacco, age-worthy.",
    ("Pinot Noir", "Sonoma County"): "Medium body, medium-high acidity, red cherry, raspberry, baking spice.",
    ("Chardonnay", "Napa Valley"): "Full body, medium acidity, ripe apple, vanilla oak, butter, tropical fruit.",
    ("Zinfandel", "Lodi"): "Full body, medium-high tannin, jammy blackberry, brambly, peppery.",
    # NZ
    ("Sauvignon Blanc", "Marlborough"): "Light body, high acidity, grapefruit, gooseberry, passionfruit, herbaceous.",
    ("Pinot Noir", "Central Otago"): "Medium body, medium tannin, dark cherry, spice, savoury herbs.",
    # Chile
    ("Carmenère", "Colchagua Valley"): "Full body, medium tannin, dark plum, green pepper, mocha.",
    # Germany
    ("Riesling", "Mosel"): "Light body, very high acidity, peach, apricot, lime, slate mineral, often off-dry.",
    # Argentina
    ("Malbec", "Mendoza"): "Full body, medium-high tannin, blackberry, plum, violet, cocoa, smooth.",
    # Champagne
    ("Pinot Noir", "Champagne"): "Sparkling — high acidity, red apple, brioche, citrus, fine mousse.",
    ("Chardonnay", "Champagne"): "Sparkling — high acidity, lemon, almond, brioche, chalky mineral.",
}

_GRAPE_FALLBACKS: dict[str, str] = {
    "Pinot Noir": "Light-Medium body, high acidity, medium tannin, red fruit, earthy, silky.",
    "Cabernet Sauvignon": "Full body, high tannin, blackcurrant, cedar, oak.",
    "Merlot": "Medium-Full body, medium tannin, plum, soft texture.",
    "Shiraz": "Full body, medium-high tannin, dark fruit, spice.",
    "Syrah": "Full body, medium-high tannin, blackberry, pepper.",
    "Chardonnay": "Medium-Full body, medium acidity, apple, citrus, oak-influenced.",
    "Sauvignon Blanc": "Light body, high acidity, citrus, herbaceous.",
    "Riesling": "Light-Medium body, high acidity, stone fruit, mineral.",
    "Sangiovese": "Medium-Full body, high acidity, sour cherry, savoury.",
    "Tempranillo": "Medium-Full body, medium tannin, red cherry, leather, oak.",
    "Malbec": "Full body, medium-high tannin, plum, violet.",
    "Nebbiolo": "Full body, high tannin, high acidity, rose, tar.",
}

_CLASSIFICATION_FALLBACK: dict[str, str] = {
    "Red Wine": "Red Wine: medium-full body, medium tannin, red-to-dark fruit, food-friendly.",
    "White Wine": "White Wine: medium body, medium-high acidity, citrus-to-stone fruit, refreshing.",
    "Sparkling Wine": "Sparkling Wine: high acidity, fine bubbles, apple/citrus, brioche or fruity.",
    "Rose Wine": "Rosé: light-medium body, medium acidity, red berry, fresh.",
    "Dessert Wine": "Dessert Wine: sweet, often high acidity, honeyed or tropical, rich texture.",
}


def heuristic_for(grape: str, region: str, classification: str = "") -> str:
    """Return a typical profile string for the given combo. Always returns a non-empty string."""
    grape_clean = (grape or "").strip()
    region_clean = (region or "").strip()
    cls_clean = (classification or "").strip()

    if grape_clean and region_clean:
        key = (grape_clean, region_clean)
        if key in _HEURISTICS:
            return _HEURISTICS[key]

    if grape_clean in _GRAPE_FALLBACKS:
        return _GRAPE_FALLBACKS[grape_clean]

    if cls_clean in _CLASSIFICATION_FALLBACK:
        return _CLASSIFICATION_FALLBACK[cls_clean]

    return "Wine: typical structure for category; no specific grape/region profile available."
