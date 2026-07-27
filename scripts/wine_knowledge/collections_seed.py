"""Seed definitions for shop-filter collections (§7).

A collection is a saved set of shop filter params consumed by the catalog's
`matchesFilters` engine (apps/catalog/lib/shop-query.ts). That engine keys off
`class` (the category_type string), NOT `category`. Spec §7 boundary (HARD):
collections filter clean-join fields only — grape/variety filters are BLOCKED,
so no seed may use `grape` or `variety`.

Each collection also carries a `group` (one of the 10 canonical CATEGORY_GROUPS —
apps/catalog/lib/category-constants.ts) and a `sort_order`. These are METADATA,
written to their own columns (collections_schema.migrate adds them); they are NOT
filter keys and never reach the shop engine. The catalog buckets the index by
`group` and orders by `sort_order`. Descriptions are curation labels (not tasting
or benchmark claims), so they need no source_citation.
"""
from __future__ import annotations
import json
import sqlite3

# slug, name, group, sort_order, description, filter.
# filter keys are shop-query keys; use `class` (category_type string), never
# `category`. `champagne` filters on region only because its category_type is
# "Sparkling & Champagne" (not a class we filter on). sort_order is globally
# monotonic across groups (Wine 10-29, Whisky 30-39, Sake & Asian 40-49,
# Spirits 50-59) so the exporter's (sort_order, slug) ordering yields the intended
# category sequence on the landing page.
COLLECTIONS = [
    # --- Icons & Classifications (cross-category classification tiers, sort FIRST) ---
    # Curated by the master-sommelier lens: evocative names that still keep the
    # classification visible for the knowledgeable buyer. Each filters on
    # `designation` — the derived product classification tier the shop engine
    # matches via designationForProduct (apps/catalog/lib/designation.ts), i.e. the
    # "Classification" control in the Taste & more menu. sort_order 0-7 so the
    # section renders ABOVE the category sections (Wine starts at 10). Every entry
    # re-verified >0 via the REAL applyShopQuery engine before commit.
    {
        "slug": "grand-cru",
        "name": "The Grand Crus",
        "group": "Icons & Classifications",
        "sort_order": 0,
        "description": "The summit of the vineyard hierarchy — the singular Grand Cru sites of Burgundy, Champagne and Alsace.",
        "filter": {"designation": "Grand Cru"},
    },
    {
        "slug": "premier-cru",
        "name": "Premier Cru — One Step from the Summit",
        "group": "Icons & Classifications",
        "sort_order": 1,
        "description": "The connoisseur's tier: Burgundy's celebrated 1er Cru vineyards — poise and pedigree without the Grand Cru price.",
        "filter": {"designation": "Premier Cru"},
    },
    {
        "slug": "italian-docg",
        "name": "DOCG — Italy's Guaranteed Greats",
        "group": "Icons & Classifications",
        "sort_order": 2,
        "description": "Italy's highest, guaranteed appellation — Barolo, Brunello, Chianti Classico and the rest of the elite.",
        "filter": {"designation": "DOCG", "country": "Italy"},
    },
    {
        "slug": "igt-super-tuscan",
        "name": "The Super Tuscan Spirit (IGT)",
        "group": "Icons & Classifications",
        "sort_order": 3,
        "description": "The rebels who broke the rules — Bordeaux blends and bold reds that outgrew the old appellations.",
        "filter": {"designation": "IGT", "country": "Italy"},
    },
    {
        "slug": "single-malt-scotch",
        "name": "Single Malt, Single Origin",
        "group": "Icons & Classifications",
        "sort_order": 4,
        "description": "One distillery, one malt — the purest expression of place in whisky.",
        "filter": {"designation": "Single Malt", "class": "Whisky"},
    },
    {
        "slug": "xo-cognac-brandy",
        "name": "XO & Beyond — The Old Souls",
        "group": "Icons & Classifications",
        "sort_order": 5,
        "description": "Extra-old cognac and brandy, patiently aged for depth, spice and silk.",
        "filter": {"designation": "XO"},
    },
    {
        "slug": "gran-reserva",
        "name": "Gran Reserva — Time in the Bottle",
        "group": "Icons & Classifications",
        "sort_order": 6,
        "description": "Spain's most patient reds — years in oak and bottle before release, led by Rioja.",
        "filter": {"designation": "Gran Reserva"},
    },
    {
        "slug": "brut-champagne-sparkling",
        "name": "The Fine Bubble — Brut Champagne & Sparkling",
        "group": "Icons & Classifications",
        "sort_order": 7,
        "description": "The benchmark dry style — crisp, celebratory and endlessly food-friendly.",
        "filter": {"designation": "Brut", "class": "Sparkling & Champagne"},
    },
    # --- Wine (curated by point-of-view, not single-filter labels) ---
    # Each collection is a CONSIDERED combination of criteria (region + class +
    # tier/body/acidity), so it means something a shopper would seek — not merely
    # "everything in a category". All combos re-verified >0 via the REAL
    # applyShopQuery engine before commit (body/acidity/designation are only
    # populated where enrichment ran, so combined counts are the real test).
    {
        "slug": "bordeaux-reds",
        "name": "Cellar-Worthy Bordeaux",
        "group": "Wine",
        "sort_order": 10,
        "description": "The structured, age-worthy Left Bank blends — full-bodied Cabernet and Merlot built to keep.",
        "filter": {"country": "France", "region": "Bordeaux", "class": "Red Wine", "body": "Full"},
    },
    {
        "slug": "burgundy-finest",
        "name": "Burgundy's Finest — Grand & Premier Cru",
        "group": "Wine",
        "sort_order": 11,
        "description": "The classified heart of Burgundy: Grand and Premier Cru Pinot Noir and Chardonnay from its greatest vineyards.",
        "filter": {"region": "Burgundy", "designation": "Grand Cru"},
    },
    {
        "slug": "barolo-barbaresco",
        "name": "Barolo & Barbaresco — The King of Nebbiolo",
        "group": "Wine",
        "sort_order": 12,
        "description": "Piedmont's noble reds — tar, roses and iron-willed structure from Italy's most age-worthy grape.",
        "filter": {"country": "Italy", "region": "Piedmont", "class": "Red Wine"},
    },
    {
        "slug": "tuscan-reds",
        "name": "Tuscan Icons — DOCG Sangiovese",
        "group": "Wine",
        "sort_order": 13,
        "description": "Brunello, Chianti Classico and the guaranteed greats — Tuscany's Sangiovese at its benchmark best.",
        "filter": {"country": "Italy", "region": "Tuscany", "class": "Red Wine", "designation": "DOCG"},
    },
    {
        "slug": "barossa-bold",
        "name": "Barossa Bold — Australian Reds",
        "group": "Wine",
        "sort_order": 14,
        "description": "Sun-soaked, full-throttle Shiraz and Cabernet — Australia's answer to power and plush fruit.",
        "filter": {"country": "Australia", "class": "Red Wine", "body": "Full"},
    },
    {
        "slug": "new-world-reds",
        "name": "New World Power — American Reds",
        "group": "Wine",
        "sort_order": 15,
        "description": "Napa and beyond — ripe, full-bodied Cabernet and Zinfandel with New World generosity.",
        "filter": {"country": "USA", "class": "Red Wine", "body": "Full"},
    },
    {
        "slug": "high-acid-whites",
        "name": "Crisp & Mineral — High-Acid Whites",
        "group": "Wine",
        "sort_order": 16,
        "description": "Zippy, cut-glass whites — the food-friendly, mineral-driven bottles that wake up the palate.",
        "filter": {"class": "White Wine", "acidity": "High"},
    },
    {
        "slug": "rose-wine",
        "name": "Rosé, All Day",
        "group": "Wine",
        "sort_order": 17,
        "description": "Dry, fruit-forward and endlessly easy — rosé for the terrace and the table.",
        "filter": {"class": "Rosé Wine"},
    },
    # --- Whisky ---
    {
        "slug": "islay-single-malts",
        "name": "Islay — The Peated Souls",
        "group": "Whisky",
        "sort_order": 30,
        "description": "Smoke, brine and sea-spray — the unmistakable peated whiskies of Islay.",
        "filter": {"class": "Whisky", "region": "Islay"},
    },
    {
        "slug": "speyside-whisky",
        "name": "Speyside — Elegant & Fruit-Driven",
        "group": "Whisky",
        "sort_order": 31,
        "description": "Honey, orchard fruit and sherried richness — the refined heartland of Scotch.",
        "filter": {"class": "Whisky", "region": "Speyside"},
    },
    {
        "slug": "highland-whisky",
        "name": "The Highland Range",
        "group": "Whisky",
        "sort_order": 32,
        "description": "From heather-honey softness to coastal heft — the sweeping style of the Highlands.",
        "filter": {"class": "Whisky", "region": "Highland"},
    },
    {
        "slug": "japanese-whisky",
        "name": "Japanese Whisky — Precision & Poise",
        "group": "Whisky",
        "sort_order": 33,
        "description": "Delicate, exacting and beautifully balanced — Japan's celebrated single malts and blends.",
        "filter": {"class": "Whisky", "country": "Japan"},
    },
    {
        "slug": "american-whiskey",
        "name": "Bourbon & American Whiskey",
        "group": "Whisky",
        "sort_order": 34,
        # country string in the catalog is "USA" (exact-match by the shop engine),
        # NOT "United States" — verified via the real applyShopQuery resolver.
        "description": "Sweet corn, char and vanilla — bourbon and rye with all-American swagger.",
        "filter": {"class": "Whisky", "country": "USA"},
    },
    {
        "slug": "world-whisky",
        "name": "Irish & the New Guard",
        "group": "Whisky",
        "sort_order": 35,
        "description": "Smooth, triple-distilled Irish whiskey — the approachable, easy-drinking style.",
        "filter": {"class": "Whisky", "country": "Ireland"},
    },
    # --- Sake & Asian ---
    # NOTE: a Daiginjo/Ginjo collection is NOT buildable — "Ginjo" is not one of
    # the recognised `designation` labels (designation.ts), so it would resolve to
    # zero. Sake polish grade lives only in the product name, which the shop engine
    # can't filter on. Kept to the three axes that DO resolve.
    {
        "slug": "sake-shochu",
        "name": "Junmai & Premium Sake",
        "group": "Sake & Asian",
        "sort_order": 40,
        "description": "Pure-rice sake and refined brews — the warm, rice-driven soul of Japan.",
        "filter": {"class": "Sake / Shochu"},
    },
    {
        "slug": "umeshu",
        "name": "Umeshu — Japan's Plum Liqueur",
        "group": "Sake & Asian",
        "sort_order": 41,
        "description": "Sweet, aromatic and utterly moreish — the Japanese plum liqueur to sip over ice.",
        "filter": {"class": "Umeshu"},
    },
    {
        "slug": "shochu",
        "name": "Shochu — The Everyday Spirit",
        "group": "Sake & Asian",
        "sort_order": 42,
        "description": "Japan's versatile distilled spirit — clean, earthy and endlessly mixable.",
        "filter": {"class": "Shochu"},
    },
    # --- Spirits ---
    {
        "slug": "craft-gin",
        "name": "The Botanical Garden — Craft Gin",
        "group": "Spirits",
        "sort_order": 50,
        "description": "Juniper, citrus and wild botanicals — expressive gins from craft distillers.",
        "filter": {"class": "Gin"},
    },
    {
        "slug": "aged-rum",
        "name": "Rum — Sun, Cane & Time",
        "group": "Spirits",
        "sort_order": 51,
        "description": "From bright mixers to barrel-aged sippers — the tropics in a glass.",
        "filter": {"class": "Rum"},
    },
    {
        "slug": "tequila",
        "name": "Agave Spirits — Tequila",
        "group": "Spirits",
        "sort_order": 52,
        "description": "Blanco, reposado and añejo — the smoke, pepper and sweetness of the agave.",
        "filter": {"class": "Tequila"},
    },
    {
        "slug": "vodka",
        "name": "Clean & Crystalline — Vodka",
        "group": "Spirits",
        "sort_order": 53,
        "description": "Silky, neutral and versatile — the backbone of the modern bar.",
        "filter": {"class": "Vodka"},
    },
    {
        "slug": "cognac-brandy",
        "name": "After Dinner — Cognac & Brandy",
        "group": "Spirits",
        "sort_order": 54,
        "description": "Grape brandies for the end of the night — warmth, spice and silk.",
        "filter": {"class": "Brandy"},
    },
]

_UPSERT = (
    "INSERT INTO collections(slug, name, filter_definition, description, "
    "category_group, sort_order) VALUES(?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(slug) DO UPDATE SET "
    "name=excluded.name, "
    "filter_definition=excluded.filter_definition, "
    "description=excluded.description, "
    "category_group=excluded.category_group, "
    "sort_order=excluded.sort_order"
)


def seed(conn: sqlite3.Connection) -> None:
    """Make the collections table AUTHORITATIVE from COLLECTIONS.

    Upserts every collection (idempotent, keyed on slug) AND prunes any row whose
    slug is no longer in COLLECTIONS — so removing/renaming a collection here
    removes it from the live DB (and therefore the export) instead of leaving a
    stale row that would silently reappear in the UI.

    Requires collections_schema.migrate() to have added the category_group /
    sort_order columns first.
    """
    for c in COLLECTIONS:
        conn.execute(
            _UPSERT,
            (
                c["slug"],
                c["name"],
                json.dumps(c["filter"]),
                c["description"],
                c["group"],
                c.get("sort_order", 999),
            ),
        )
    # Prune rows no longer in the source list (authoritative seed).
    keep = [c["slug"] for c in COLLECTIONS]
    placeholders = ",".join("?" for _ in keep)
    conn.execute(
        f"DELETE FROM collections WHERE slug NOT IN ({placeholders})", keep
    )
    conn.commit()
