# data/lib/taxonomy/attribute_map.py
"""Single source of truth for the wine_*→universal attribute rename.
Scripts import this instead of hardcoding column names. Mirror: apps/catalog/lib/attribute-map.ts."""
ATTRIBUTE_MAP = {
    "grape_variety": "variety",
    "grape_blend_type": "blend_type",
    "wine_body": "body",
    "wine_acidity": "acidity",
    "wine_tannin": "tannin",
    "wine_color": "color",
    "wine_production_style": "production_style",
}
NEW_COLUMNS = ["sweetness", "intensity", "smokiness", "finish"]
DROPPED_COLUMNS = ["wine_type", "other_type"]

def rename_key(key: str) -> str:
    """Map an old column/field name to its new name (identity if not renamed)."""
    return ATTRIBUTE_MAP.get(key, key)
