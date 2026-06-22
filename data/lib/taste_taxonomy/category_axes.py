"""Per-category taste-axis matrices for non-wine SKUs.

Wine continues to use the dedicated 3-column schema (body / acidity /
tannin). All other categories store their taste profile in the
`taste_profile` JSON column with this shape:

    {
      "structure": "flat",
      "category": "whisky",
      "axes": {
        "peat_smoke":    {"value": "Trace",      "scale": [...]},
        "sweetness":     {"value": "Balanced",   "scale": [...]},
        "oak_influence": {"value": "Pronounced", "scale": [...]}
      },
      "tags": ["herbal", "fruit"],     # OPTIONAL — multi-select chip tags (used by Liqueur)
      "style_tag": "Single Malt Speyside"  # OPTIONAL — short style descriptor
    }

This is the single source of truth. The enrichment prompt and the UI both
read from here so the axis names and scales never drift out of sync.

Two reusable scales:
- 5-point: None / Trace / Light / Medium / Heavy
- 4-point: Light / Medium / Pronounced / Bold
Each axis specifies its own scale explicitly to keep them obvious.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Axis:
    key: str           # canonical identifier (lowercase_underscore)
    label: str         # display label
    scale: list[str]   # ordered allowed values, low → high


@dataclass
class CategorySchema:
    category: str             # canonical category key
    axes: list[Axis]
    chip_tag_options: list[str] = field(default_factory=list)  # for multi-select chip categories
    style_tags: list[str] = field(default_factory=list)        # allowed style_tag values
    notes: str = ""


# ── Wine ────────────────────────────────────────────────────────────────────
# Wine keeps the legacy 3-column shape. Schema here for completeness so
# prompt/UI can iterate uniformly.
WINE = CategorySchema(
    category="wine",
    axes=[
        Axis("body",    "Body",    ["Light", "Medium-Light", "Medium", "Medium-Full", "Full"]),
        Axis("acidity", "Acidity", ["Light", "Medium-Light", "Medium", "Medium-Full", "Full"]),
        Axis("tannin",  "Tannin",  ["Light", "Medium-Light", "Medium", "Medium-Full", "Full"]),
    ],
    notes="Stored in body/acidity/tannin columns, NOT taste_profile.",
)

# ── Whisky / Whiskey / Bourbon / Scotch ─────────────────────────────────────
WHISKY = CategorySchema(
    category="whisky",
    axes=[
        Axis("peat_smoke",    "Peat / Smoke",    ["None", "Trace", "Light", "Medium", "Heavy"]),
        Axis("sweetness",     "Sweetness",       ["Dry", "Off-dry", "Balanced", "Sweet", "Lush"]),
        Axis("oak_influence", "Oak Influence",   ["Light", "Medium", "Pronounced", "Heavy", "Cask-dominant"]),
    ],
    style_tags=[
        "Single Malt Scotch — Speyside", "Single Malt Scotch — Highland",
        "Single Malt Scotch — Islay", "Single Malt Scotch — Lowland",
        "Single Malt Scotch — Campbeltown", "Blended Scotch",
        "Single Pot Still Irish", "Single Malt Irish", "Blended Irish",
        "Bourbon (Kentucky)", "Tennessee Whiskey", "Rye Whiskey",
        "Japanese Single Malt", "Japanese Blended", "World Whisky",
    ],
)

# ── Brandy / Cognac / Armagnac ──────────────────────────────────────────────
BRANDY = CategorySchema(
    category="brandy",
    axes=[
        Axis("sweetness",       "Sweetness",        ["Dry", "Off-dry", "Balanced", "Sweet"]),
        Axis("oak_rancio",      "Oak / Rancio",     ["Young", "Mature", "Aged-Mellow", "Rancio"]),
        Axis("fruit_intensity", "Fruit Intensity",  ["Restrained", "Balanced", "Pronounced", "Opulent"]),
    ],
    style_tags=["Cognac", "Armagnac", "Calvados", "Spanish Brandy", "Pisco", "Eau-de-Vie", "Grappa", "World Brandy"],
    notes="Rancio = the prized aged/oxidative character from long oak ageing.",
)

# ── Gin ─────────────────────────────────────────────────────────────────────
GIN = CategorySchema(
    category="gin",
    axes=[
        Axis("juniper_forward",      "Juniper-Forward",      ["Restrained", "Balanced", "Pronounced", "Bold"]),
        Axis("citrus",               "Citrus",               ["Light", "Medium", "Bright", "Zesty"]),
        Axis("botanical_complexity", "Botanical Complexity", ["Classic", "Modern", "Floral", "Spice-led"]),
    ],
    style_tags=["London Dry", "Contemporary", "Old Tom", "Plymouth", "Navy Strength", "Genever", "Aged Gin"],
)

# ── Vodka ───────────────────────────────────────────────────────────────────
VODKA = CategorySchema(
    category="vodka",
    axes=[
        Axis("body_texture",     "Body / Texture",    ["Crisp", "Smooth", "Velvety", "Creamy"]),
        Axis("sweetness",        "Sweetness",         ["Bone-Dry", "Slight", "Off-dry"]),
        Axis("flavor_character", "Flavor Character",  ["Neutral", "Grain-led", "Wheat-led", "Rye-Spice", "Potato"]),
    ],
)

# ── Rum ─────────────────────────────────────────────────────────────────────
RUM = CategorySchema(
    category="rum",
    axes=[
        Axis("sweetness",  "Sweetness",  ["Dry", "Off-dry", "Sweet", "Lush"]),
        Axis("funk_ester", "Funk / Ester", ["Clean", "Light Funk", "Medium Funk", "Hogo / Heavy Funk"]),
        Axis("oak_age",    "Oak / Age",  ["Unaged", "Lightly Aged", "Aged", "Extra-Aged"]),
    ],
    style_tags=["White / Silver", "Gold", "Dark", "Spiced", "Aged", "Agricole", "Cachaça", "Navy"],
    notes="Hogo = Jamaican-style ester complexity (heavy funk).",
)

# ── Tequila / Mezcal ────────────────────────────────────────────────────────
TEQUILA = CategorySchema(
    category="tequila",
    axes=[
        Axis("agave_intensity", "Agave Intensity", ["Restrained", "Balanced", "Pronounced", "Bold"]),
        Axis("smoke",           "Smoke",           ["None", "Trace", "Medium", "Heavy"]),
        Axis("oak_age",         "Oak / Age",       ["Blanco", "Reposado", "Añejo", "Extra-Añejo"]),
    ],
    style_tags=["Blanco / Plata", "Reposado", "Añejo", "Extra-Añejo", "Cristalino", "Mezcal", "Sotol", "Raicilla"],
    notes="Mezcal carries the Smoke axis; Tequila Blanco is Smoke=None by definition.",
)

# ── Liqueur (2 axes + chip tags) ────────────────────────────────────────────
LIQUEUR = CategorySchema(
    category="liqueur",
    axes=[
        Axis("sweetness",  "Sweetness",  ["Light", "Medium", "Sweet", "Very Sweet"]),
        Axis("bitterness", "Bitterness", ["None", "Trace", "Medium", "Pronounced"]),
    ],
    chip_tag_options=[
        "Herbal", "Citrus", "Stone Fruit", "Berry", "Floral",
        "Nut", "Cream", "Coffee", "Cocoa / Chocolate", "Anise / Licorice",
        "Spice", "Honey", "Vanilla", "Tropical", "Amaro",
    ],
    style_tags=["Amaro / Bitter", "Crème", "Fruit Liqueur", "Herbal Liqueur",
                "Cream Liqueur", "Coffee Liqueur", "Anise / Pastis", "Vermouth"],
    notes="Pronounced bitterness = amari. Multi-select chip tags replace a 3rd axis.",
)

# ── Sake / Shochu (4 axes — Polish Ratio added) ─────────────────────────────
SAKE = CategorySchema(
    category="sake",
    axes=[
        Axis("sweetness",    "Sweetness (SMV)", ["Very Dry", "Dry", "Off-dry", "Sweet"]),
        Axis("acidity",      "Acidity",         ["Low", "Medium", "High"]),
        Axis("body_umami",   "Body / Umami",    ["Light / Clean", "Medium", "Rich / Umami"]),
        Axis("polish_ratio", "Polish Ratio",    ["Junmai (≤70%)", "Ginjo (≤60%)", "Daiginjo (≤50%)", "Super-Daiginjo (≤35%)"]),
    ],
    style_tags=["Junmai", "Junmai Ginjo", "Junmai Daiginjo", "Honjozo",
                "Ginjo", "Daiginjo", "Nigori", "Koshu (Aged)", "Sparkling",
                "Shochu — Imo (sweet potato)", "Shochu — Mugi (barley)", "Shochu — Kome (rice)"],
    notes="SMV = Sake Meter Value (lower = sweeter). Polish ratio (seimaibuai) is the % of rice grain remaining after polishing.",
)

# ── Beer (4 axes — Alcohol/Strength added) ──────────────────────────────────
BEER = CategorySchema(
    category="beer",
    axes=[
        Axis("bitterness",     "Bitterness (IBU)",  ["Low", "Medium", "High", "Aggressive"]),
        Axis("sweetness_malt", "Sweetness / Malt",  ["Dry", "Balanced", "Malty", "Sweet"]),
        Axis("hop_character",  "Hop Character",     ["Subtle", "Floral", "Citrus", "Pine", "Tropical"]),
        Axis("alcohol",        "Strength",          ["Session", "Standard", "Strong", "Imperial"]),
    ],
    style_tags=["Lager", "Pilsner", "Pale Ale", "IPA", "Double IPA",
                "Stout", "Porter", "Wheat Beer", "Saison", "Sour / Wild",
                "Belgian Dubbel/Tripel/Quad", "Barleywine", "Fruit Beer", "Non-Alcoholic"],
)


# Map classification → CategorySchema. The keys are exactly the values seen
# in `products.classification` for the categories we want to enrich. Wines
# are intentionally NOT in this map — they're handled by legacy columns.
CATEGORY_BY_CLASSIFICATION: dict[str, CategorySchema] = {
    "Whisky": WHISKY,
    "Whiskey": WHISKY,
    "Bourbon": WHISKY,
    "Scotch": WHISKY,
    "Brandy": BRANDY,
    "Cognac": BRANDY,
    "Armagnac": BRANDY,
    "Gin": GIN,
    "Vodka": VODKA,
    "Rum": RUM,
    "Tequila": TEQUILA,
    "Mezcal": TEQUILA,
    "Liqueur": LIQUEUR,
    "Sake/Shochu": SAKE,
    "Sake": SAKE,
    "Shochu": SAKE,
    "Beer": BEER,
}

# Categories that don't get a taste matrix at all — skip the radar entirely.
NO_TASTE_MATRIX = {"Glassware", "Accessories", "Cigar", "Others", "Non-Alcoholic"}


def schema_for_classification(classification: str | None) -> CategorySchema | None:
    """Return the taste schema for a product classification, or None if
    the classification has no matrix (Glassware, Accessories, etc.).

    For Wine categories returns the WINE schema — callers should still
    know to read from body / acidity / tannin columns
    rather than from taste_profile JSON.
    """
    if not classification:
        return None
    if classification in NO_TASTE_MATRIX:
        return None
    if classification in CATEGORY_BY_CLASSIFICATION:
        return CATEGORY_BY_CLASSIFICATION[classification]
    # Wine fallback
    if "Wine" in classification or classification in ("Champagne", "Sparkling Wine"):
        return WINE
    return None


def serialise_for_prompt(schema: CategorySchema) -> str:
    """Render a schema as instruction text for the enrichment LLM prompt."""
    lines = [
        f"Category: {schema.category}",
        "Axes (USE THE EXACT KEY shown — not the label. Pick exactly one scale value per axis):",
    ]
    for ax in schema.axes:
        lines.append(f"  • key='{ax.key}'  ({ax.label}) — one of [{' | '.join(ax.scale)}]")
    lines.append(
        f'Required taste_axes shape: {{ ' +
        ', '.join(f'"{ax.key}": "<scale value>"' for ax in schema.axes) +
        " }"
    )
    if schema.chip_tag_options:
        lines.append(f"Chip tags (multi-select, 2-5 most fitting): [{', '.join(schema.chip_tag_options)}]")
    if schema.style_tags:
        lines.append(f"Style tag (pick ONE): [{', '.join(schema.style_tags)}]")
    if schema.notes:
        lines.append(f"Note: {schema.notes}")
    return "\n".join(lines)


if __name__ == "__main__":
    # Sanity demo
    for cls in ("Whisky", "Liqueur", "Sake/Shochu", "Beer", "Red Wine", "Glassware"):
        s = schema_for_classification(cls)
        print(f"\n=== {cls} ===")
        if s is None:
            print("  (no taste matrix)")
        else:
            print(serialise_for_prompt(s))
