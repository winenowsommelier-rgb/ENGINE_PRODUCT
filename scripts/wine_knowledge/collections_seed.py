"""Seed definitions for shop-filter collections (§7).

A collection is a saved set of shop filter params consumed by the catalog's
`matchesFilters` engine (apps/catalog/lib/shop-query.ts). That engine keys off
`class` (the category_type string), NOT `category`. Spec §7 boundary (HARD):
collections filter clean-join fields only — grape/variety filters are BLOCKED,
so no seed may use `grape` or `variety`.
"""
from __future__ import annotations
import json
import sqlite3

# slug, name, description, filter — filter keys are shop-query keys; use `class`
# (category_type string), never `category`. `champagne` filters on region only
# because its category_type is "Sparkling & Champagne" (not a class we filter on).
COLLECTIONS = [
    {
        "slug": "bordeaux-reds",
        "name": "Bordeaux Reds",
        "description": "Structured red blends from Bordeaux, France.",
        "filter": {"country": "France", "region": "Bordeaux", "class": "Red Wine"},
    },
    {
        "slug": "barolo-barbaresco",
        "name": "Barolo & Barbaresco",
        "description": "Nebbiolo-driven reds from Piedmont, Italy.",
        "filter": {"country": "Italy", "region": "Piedmont", "class": "Red Wine"},
    },
    {
        "slug": "champagne",
        "name": "Champagne",
        "description": "Sparkling wines from the Champagne region of France.",
        "filter": {"country": "France", "region": "Champagne"},
    },
    {
        "slug": "high-acid-whites",
        "name": "High-Acid White Wines",
        "description": "Crisp, high-acidity white wines.",
        "filter": {"class": "White Wine", "acidity": "High"},
    },
    {
        "slug": "full-bodied-reds",
        "name": "Full-Bodied Reds",
        "description": "Bold, full-bodied red wines.",
        "filter": {"class": "Red Wine", "body": "Full"},
    },
    {
        "slug": "tuscan-reds",
        "name": "Tuscan Reds",
        "description": "Sangiovese-led reds from Tuscany, Italy.",
        "filter": {"country": "Italy", "region": "Tuscany", "class": "Red Wine"},
    },
]

_UPSERT = (
    "INSERT INTO collections(slug, name, filter_definition, description) "
    "VALUES(?, ?, ?, ?) "
    "ON CONFLICT(slug) DO UPDATE SET "
    "name=excluded.name, "
    "filter_definition=excluded.filter_definition, "
    "description=excluded.description"
)


def seed(conn: sqlite3.Connection) -> None:
    """Upsert every collection in COLLECTIONS. Idempotent (keyed on slug)."""
    for c in COLLECTIONS:
        conn.execute(
            _UPSERT,
            (c["slug"], c["name"], json.dumps(c["filter"]), c["description"]),
        )
    conn.commit()
