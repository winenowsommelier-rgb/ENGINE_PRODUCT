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
    # --- Wine (existing 6) ---
    {
        "slug": "bordeaux-reds",
        "name": "Bordeaux Reds",
        "group": "Wine",
        "sort_order": 10,
        "description": "Structured red blends from Bordeaux, France.",
        "filter": {"country": "France", "region": "Bordeaux", "class": "Red Wine"},
    },
    {
        "slug": "barolo-barbaresco",
        "name": "Barolo & Barbaresco",
        "group": "Wine",
        "sort_order": 11,
        "description": "Nebbiolo-driven reds from Piedmont, Italy.",
        "filter": {"country": "Italy", "region": "Piedmont", "class": "Red Wine"},
    },
    {
        "slug": "tuscan-reds",
        "name": "Tuscan Reds",
        "group": "Wine",
        "sort_order": 12,
        "description": "Sangiovese-led reds from Tuscany, Italy.",
        "filter": {"country": "Italy", "region": "Tuscany", "class": "Red Wine"},
    },
    {
        "slug": "full-bodied-reds",
        "name": "Full-Bodied Reds",
        "group": "Wine",
        "sort_order": 13,
        "description": "Bold, full-bodied red wines.",
        "filter": {"class": "Red Wine", "body": "Full"},
    },
    {
        "slug": "high-acid-whites",
        "name": "High-Acid White Wines",
        "group": "Wine",
        "sort_order": 14,
        "description": "Crisp, high-acidity white wines.",
        "filter": {"class": "White Wine", "acidity": "High"},
    },
    {
        "slug": "champagne",
        "name": "Champagne",
        "group": "Wine",
        "sort_order": 15,
        "description": "Sparkling wines from the Champagne region of France.",
        "filter": {"country": "France", "region": "Champagne"},
    },
    # --- Wine (new) ---
    {
        "slug": "rose-wine",
        "name": "Rosé Wine",
        "group": "Wine",
        "sort_order": 20,
        "description": "Dry and fruit-forward rosé from around the world.",
        "filter": {"class": "Rosé Wine"},
    },
    {
        "slug": "sparkling-champagne",
        "name": "Sparkling & Champagne",
        "group": "Wine",
        "sort_order": 21,
        "description": "Champagne, prosecco, cava and sparkling wines.",
        "filter": {"class": "Sparkling & Champagne"},
    },
    # --- Whisky ---
    {
        "slug": "islay-single-malts",
        "name": "Islay Single Malts",
        "group": "Whisky",
        "sort_order": 30,
        "description": "Peaty, maritime single malts from Islay, Scotland.",
        "filter": {"class": "Whisky", "region": "Islay"},
    },
    {
        "slug": "japanese-whisky",
        "name": "Japanese Whisky",
        "group": "Whisky",
        "sort_order": 31,
        "description": "Refined single malts and blends from Japan.",
        "filter": {"class": "Whisky", "country": "Japan"},
    },
    {
        "slug": "speyside-whisky",
        "name": "Speyside Whisky",
        "group": "Whisky",
        "sort_order": 32,
        "description": "Elegant, fruit-driven malts from Speyside, Scotland.",
        "filter": {"class": "Whisky", "region": "Speyside"},
    },
    {
        "slug": "american-whiskey",
        "name": "American Whiskey",
        "group": "Whisky",
        "sort_order": 33,
        "description": "Bourbon and rye from the United States.",
        # country string in the catalog is "USA" (exact-match by the shop engine),
        # NOT "United States" — verified via the real applyShopQuery resolver.
        "filter": {"class": "Whisky", "country": "USA"},
    },
    # --- Sake & Asian ---
    {
        "slug": "sake-shochu",
        "name": "Sake & Shochu",
        "group": "Sake & Asian",
        "sort_order": 40,
        "description": "Premium Japanese sake and shochu.",
        "filter": {"class": "Sake / Shochu"},
    },
    {
        "slug": "umeshu",
        "name": "Umeshu",
        "group": "Sake & Asian",
        "sort_order": 41,
        "description": "Japanese plum liqueurs, sweet and aromatic.",
        "filter": {"class": "Umeshu"},
    },
    # --- Spirits ---
    {
        "slug": "craft-gin",
        "name": "Craft Gin",
        "group": "Spirits",
        "sort_order": 50,
        "description": "Botanical-led gins from craft distillers.",
        "filter": {"class": "Gin"},
    },
    {
        "slug": "aged-rum",
        "name": "Aged Rum",
        "group": "Spirits",
        "sort_order": 51,
        "description": "Sipping and mixing rums from across the tropics.",
        "filter": {"class": "Rum"},
    },
    {
        "slug": "tequila",
        "name": "Tequila",
        "group": "Spirits",
        "sort_order": 52,
        "description": "Blanco, reposado and añejo agave spirits.",
        "filter": {"class": "Tequila"},
    },
    {
        "slug": "cognac-brandy",
        "name": "Cognac & Brandy",
        "group": "Spirits",
        "sort_order": 53,
        "description": "Grape brandies for after dinner.",
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
    """Upsert every collection in COLLECTIONS. Idempotent (keyed on slug).

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
    conn.commit()
