"""Rule-12-correct file router for the Drive export bundle.

Groups a product record to exactly ONE output filename stem using
category_group / category_type (derived from the SKU prefix), NEVER the raw
`classification` free-text field (spec sec 3, project Rule 12). Every record
resolves to a stem; unmapped groups fall through to 'unknown' so no SKU is
ever dropped.

The exact category_group / category_type string values were verified against
data/live_products_export.json (see plan Task 3 Step 1). If the taxonomy adds a
new group, it lands in 'unknown' until added here — the zero-drop invariant
test will still pass (unknown is a real file), and the row-count warning will
flag the surprise.
"""
from __future__ import annotations

# --- category_type sets within the Wine group (verified real strings) ---
RED_WINE_TYPES = {'Red Wine'}
WHITE_WINE_TYPES = {'White Wine'}
# Canonical value is the SINGLE string 'Sparkling & Champagne' (verified).
SPARKLING_TYPES = {'Sparkling & Champagne'}
# Everything else under Wine ('Rosé Wine', 'Sweet/Dessert', 'Fortified',
# 'Orange Wine', 'Wine Set') falls through to 'wine_other' — no explicit set.

# --- non-Wine category_group -> single file stem (verified real strings) ---
GROUP_TO_STEM = {
    'Whisky': 'whisky',
    'Spirits': 'spirits',
    'Liqueur': 'liqueur',
    'Sake & Asian': 'sake_asian',
    'Beer & RTD': 'beer_rtd',
    'Non-Alcoholic': 'non_alcoholic',
    'Accessories': 'accessories',
    'Cigars': 'cigars',
}

# Closed set of every stem the router can emit — the manifest & prune logic
# trust this. Keep in sync with the logic below.
ALL_FILE_STEMS = {
    'wine_red_france', 'wine_red_italy', 'wine_red_world',
    'wine_white_france', 'wine_white_world',
    'wine_sparkling', 'wine_other',
    *GROUP_TO_STEM.values(),
    'unknown',
}


def file_for(record: dict) -> str:
    """Return the bare filename stem (no prefix/extension) for one record."""
    group = str(record.get('category_group') or '').strip()
    if not group:
        return 'unknown'

    if group == 'Wine':
        ctype = str(record.get('category_type') or '').strip()
        country = str(record.get('country') or '').strip()
        if ctype in RED_WINE_TYPES:
            if country == 'France':
                return 'wine_red_france'
            if country == 'Italy':
                return 'wine_red_italy'
            return 'wine_red_world'
        if ctype in WHITE_WINE_TYPES:
            return 'wine_white_france' if country == 'France' else 'wine_white_world'
        if ctype in SPARKLING_TYPES:
            return 'wine_sparkling'
        return 'wine_other'

    return GROUP_TO_STEM.get(group, 'unknown')


def group_records(items: list[dict]) -> dict[str, list[dict]]:
    """Bucket records by file stem. Empty stems are omitted (a file with zero
    rows is not written); callers needing the closed set use ALL_FILE_STEMS."""
    out: dict[str, list[dict]] = {}
    for rec in items:
        out.setdefault(file_for(rec), []).append(rec)
    return out
