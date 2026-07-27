#!/usr/bin/env python3
"""
Build explore-taxonomy.json — the single combined data file for the interactive map.

Reads:
  - data/taxonomy_for_map.json (cleaned taxonomy with coordinates)
  - data/db/products.json (product catalog)
  - data/taxonomy/classification_master.json (for scope validation)

Outputs:
  - data/taxonomy/explore-taxonomy.json

Features:
  - Product counts per location × category (wine/spirits/beer/sake)
  - Price ranges per location
  - Non-geographic entry flagging
  - Region name normalization (handles alias mismatches between products and taxonomy)
  - Full parent hierarchy slugs for URL building
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).parent.parent
DATA = ROOT / "data"
CHAMPAGNE_RULES_PATH = DATA / "taxonomy" / "champagne-subregion-rules.json"
CHAMPAGNE_COUNTRY = "France"
CHAMPAGNE_REGION = "Champagne"

COUNTRY_ALIASES = {
    "Netherland": "Netherlands",
    "Trinidad & Tobago": "Trinidad",
    "Siberia": "Russia",
}

INJECTED_COUNTRIES = [
    {"name": "Korea", "slug": "korea", "latitude": 36.5, "longitude": 127.9},
    {"name": "Denmark", "slug": "denmark", "latitude": 56.0, "longitude": 10.0},
    {"name": "Iceland", "slug": "iceland", "latitude": 64.9, "longitude": -18.6},
    {"name": "India", "slug": "india", "latitude": 22.6, "longitude": 79.0},
    {"name": "Finland", "slug": "finland", "latitude": 64.5, "longitude": 26.0},
    {"name": "Latvia", "slug": "latvia", "latitude": 56.9, "longitude": 24.6},
    {"name": "Slovakia", "slug": "slovakia", "latitude": 48.7, "longitude": 19.7},
    {"name": "Panama", "slug": "panama", "latitude": 8.6, "longitude": -80.0},
    {"name": "Guyana", "slug": "guyana", "latitude": 5.0, "longitude": -58.9},
    {"name": "Cambodia", "slug": "cambodia", "latitude": 12.6, "longitude": 104.9},
    {"name": "Philippines", "slug": "philippines", "latitude": 12.8, "longitude": 121.8},
    {"name": "Fiji", "slug": "fiji", "latitude": -17.8, "longitude": 178.1},
    {"name": "Lebanon", "slug": "lebanon", "latitude": 33.9, "longitude": 35.8},
    {"name": "Anguilla", "slug": "anguilla", "latitude": 18.2, "longitude": -63.1},
    {"name": "Grenada", "slug": "grenada", "latitude": 12.1, "longitude": -61.7},
    {"name": "Monaco", "slug": "monaco", "latitude": 43.7, "longitude": 7.4},
]

INJECTED_REGIONS = [
    {"country": "Thailand", "name": "Khao Yai", "slug": "khao-yai", "latitude": 14.55, "longitude": 101.37},
    {"country": "Uruguay", "name": "Canelones", "slug": "canelones", "latitude": -34.6, "longitude": -56.3},
    {"country": "England", "name": "Sussex", "slug": "sussex", "latitude": 50.9, "longitude": -0.2},
    {"country": "Peru", "name": "Ica", "slug": "ica", "latitude": -14.1, "longitude": -75.7},
    {"country": "Germany", "name": "Baden", "slug": "baden", "latitude": 48.5, "longitude": 8.9},
    {"country": "Germany", "name": "Franken", "slug": "franken", "latitude": 49.8, "longitude": 10.2},
    {"country": "Greece", "name": "Macedonia", "slug": "macedonia", "latitude": 40.7, "longitude": 22.9},
]

# ============================================================
# SKU → scope mapping (matches app/api/products/route.ts logic)
# ============================================================
def sku_to_scope(sku: str) -> str | None:
    """Map product SKU prefix to category scope."""
    if not sku:
        return None
    if sku.startswith("LSK"):
        return "sake"
    if sku.startswith("LBE"):
        return "beer"
    if sku.startswith("L"):
        return "spirits"
    if sku[0] == "W":
        return "wine"
    # Accessories (A*, G*, N*) — no geographic meaning, excluded from map
    return None


def slugify(name: str) -> str:
    """Generate URL-safe slug from name."""
    s = name.lower()
    # Common transliterations
    s = s.replace("é", "e").replace("è", "e").replace("ê", "e")
    s = s.replace("ô", "o").replace("ö", "o")
    s = s.replace("ü", "u").replace("û", "u")
    s = s.replace("â", "a").replace("à", "a").replace("ä", "a")
    s = s.replace("î", "i").replace("ï", "i")
    s = s.replace("ç", "c").replace("ñ", "n")
    s = s.replace("ã", "a").replace("í", "i").replace("ó", "o").replace("ú", "u")
    s = s.replace("\u2019", "").replace("'", "").replace("'", "")  # smart quotes
    s = s.replace(".", "").replace(",", "")
    # Replace non-alphanumeric with hyphens
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


# ============================================================
# NON-GEOGRAPHIC entries (from spec Section 7.6)
# ============================================================
NON_GEOGRAPHIC = {
    "Multi-Regional",
    "Others region",
    "Multi-Appellation California",
    "South Eastern Australia",
}


# ============================================================
# REGION NAME ALIASES
# Products may use variant names — map them to canonical taxonomy names
# ============================================================
REGION_ALIASES = {
    # Product data → Taxonomy canonical name
    # ── Duplicate pairs (products use short name, taxonomy uses full) ──
    "Barossa": "Barossa Valley",
    "Clare": "Clare Valley",
    "Casablanca": "Casablanca Valley",
    "Colchagua": "Colchagua Valley",
    "Maipo": "Maipo Valley",
    "Sonoma": "Sonoma County",
    "Rhône": "Rhône Valley",
    "Rhone": "Rhône Valley",
    "Loire": "Loire Valley",
    "Loire valley": "Loire Valley",
    "Friuli": "Friuli-Venezia Giulia",
    # ── Name variants ──
    # NOTE: "Napa Valley" is deliberately NOT aliased to "Napa". Napa is a fake
    # region (see FAKE_REGION_PARENTS) that normalize_taxonomy_hierarchy
    # collapses into California; Napa Valley is the real AVA and stays a
    # SUBREGION. Re-adding the alias would recreate the duplicate-pin bug.
    "Yarra Valley": "Yarra",
    "Highlands": "Highland",
            "Hunter Valley": "Hunter",
    "Languedoc-Roussillon": "Languedoc",
    "Jerez (Sherry)": "Jerez",
    "Rapel Valley": "Colchagua Valley",  # Rapel contains Colchagua
    "Maule Valley": "Maule",
    "Curicó Valley": "Curico Valley",
    "Uco Valley": "Mendoza",        # Uco Valley is within Mendoza
    "Penedès": "Catalunya",
    "Somontano": "Catalunya",       # Somontano is in Aragon, near Catalunya
    "Castilla-La Mancha": "La Mancha",
    "Alicante": "Valencia",
    "Malaga": "Jerez",              # Andalusia grouping
        "Stellenbosch": "Western Cape",
            "Orange": "Victoria",
    "Rutherglen": "Victoria",
        "Tasmania": "Victoria",         # Separate but closest match
    "Hokkaido": "Jalisco",          # Skip — no matching region, use None
    "Nagano": "Jalisco",            # Same — these are Japanese wine regions not in our taxonomy
    "Yamanashi": "Jalisco",
    "Hua Hin Hills": "Khao Yai",    # Thai wine region — approximate
    "Hawke’s Bay": "Hawke's Bay",
    "South West France": "Languedoc",
    "Vinho Verde": "Douro",         # Portugal grouping
    "Goriška Brda": None,           # Slovenia — too specific
        "Loncomilla Valley": "Central Valley",
    "South Island": "Central Otago", # NZ South Island → Central Otago
    "Sussex": "Sussex",
    "Corsica": "Provence",          # Close enough geographically
    "Willamette": "Willamette Valley",
    # ── Subregions that appear as regions in product data ──
    "Beaujolais": None,             # Subregion of Burgundy
    "Chianti": None,                # Subregion of Tuscany
    "Basilicata": None,             # Italian region, not in our taxonomy
    "Calabria": None,               # Same
    "Liguria": None,                # Same
    "Galicia": None,                # Spanish — Rías Baixas is the region
    "Macedonia": "Macedonia",
    "Franken": "Franken",
    "Baden": "Baden",
    "Trentino": "Trentino-Alto Adige",
    "Alto Adige": "Trentino-Alto Adige",
    "Burgenland": "Kamptal",        # Austrian grouping
    # ── Countries appearing as regions ──
    "Japan": None,                  # Country, not a region
    "Barbados": None,               # Country
    "Jamaica": None,                # Country
    "Martinique": None,             # Country
    "Caribbean": None,              # Not a country
    "Guyana": None,                 # Country
    "Demerara": None,               # In Guyana
    "Canelones": "Canelones",
    "Colonia": None,                # Uruguay
    "Ica": "Ica",
    "Baja California": None,        # Mexico — not in taxonomy
    "Khao Yai": "Khao Yai",
}

# Fix Japanese regions — map to None since they're not wine regions in our taxonomy
for r in ["Hokkaido", "Nagano", "Yamanashi"]:
    REGION_ALIASES[r] = None

# Subregion aliases for product matching
SUBREGION_ALIASES = {
    "Saint-Emilion": "Saint-Émilion",
    "Chianti Classico": "Chianti",
    "Côte de Beaune": "Côte de Beaune",
    "Côte de Nuits": "Côte de Nuits",
    "Barossa Valley": "Barossa Valley",  # Products have this as subregion sometimes
    "Napa Valley": "Napa Valley",
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_text(value: str) -> str:
    """Lowercase and normalize punctuation/accents for loose product matching."""
    if not value:
        return ""

    replacements = str.maketrans({
        "é": "e",
        "è": "e",
        "ê": "e",
        "ë": "e",
        "ô": "o",
        "ö": "o",
        "ü": "u",
        "û": "u",
        "â": "a",
        "à": "a",
        "ä": "a",
        "î": "i",
        "ï": "i",
        "ç": "c",
        "ñ": "n",
        "ã": "a",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "\u2019": "'",
        "\u2018": "'",
        "\u2013": "-",
        "\u2014": "-",
    })
    normalized = value.lower().translate(replacements)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def load_champagne_rules():
    raw = load_json(CHAMPAGNE_RULES_PATH)
    subregions = raw.get("subregions", [])
    canonical_names = {item["name"] for item in subregions}
    brand_prefix_map = {
        normalize_text(prefix): subregion
        for prefix, subregion in raw.get("brand_prefix_map", {}).items()
        if subregion in canonical_names
    }
    blocked_prefixes = {
        normalize_text(prefix)
        for prefix in raw.get("blocked_brand_prefixes", [])
        if prefix
    }
    return {
        "subregions": subregions,
        "canonical_names": canonical_names,
        "brand_prefix_map": brand_prefix_map,
        "blocked_prefixes": blocked_prefixes,
    }


def normalize_country_name(country_name: str) -> str:
    if not country_name:
        return ""
    return COUNTRY_ALIASES.get(country_name, country_name)


def inject_missing_countries(tax):
    existing_names = {country["name"] for country in tax["countries"]}
    next_id = max((item["id"] for item in tax["countries"]), default=0) + 1

    for country in INJECTED_COUNTRIES:
        if country["name"] in existing_names:
            continue
        tax["countries"].append({
            "id": next_id,
            "name": country["name"],
            "slug": country["slug"],
            "latitude": country["latitude"],
            "longitude": country["longitude"],
            "scopes": ["wine", "spirits", "beer", "sake"],
        })
        existing_names.add(country["name"])
        next_id += 1


def inject_missing_regions(tax):
    country_by_name = {country["name"]: country for country in tax["countries"]}
    existing_keys = {(region["parent_name"], region["name"]) for region in tax["regions"]}
    next_id = max((item["id"] for item in tax["regions"]), default=0) + 1

    for region in INJECTED_REGIONS:
        key = (region["country"], region["name"])
        if key in existing_keys:
            continue
        parent = country_by_name.get(region["country"])
        if not parent:
            continue
        tax["regions"].append({
            "id": next_id,
            "name": region["name"],
            "slug": region["slug"],
            "latitude": region["latitude"],
            "longitude": region["longitude"],
            "parent_id": parent["id"],
            "parent_name": parent["name"],
            "scopes": ["wine", "spirits", "beer", "sake"],
        })
        existing_keys.add(key)
        next_id += 1


def inject_champagne_subregions(tax, champagne_rules):
    """Ensure canonical Champagne subregions exist even if source taxonomy is incomplete."""
    france = next((c for c in tax["countries"] if c["name"] == CHAMPAGNE_COUNTRY), None)
    champagne_region = next(
        (
            r for r in tax["regions"]
            if r["name"] == CHAMPAGNE_REGION and r.get("parent_name") == CHAMPAGNE_COUNTRY
        ),
        None,
    )
    if not france or not champagne_region:
        return

    existing_names = {
        sr["name"]
        for sr in tax["subregions"]
        if sr.get("parent_name") == CHAMPAGNE_REGION and sr.get("grandparent_name") == CHAMPAGNE_COUNTRY
    }
    next_id = max((item["id"] for item in tax["subregions"]), default=0) + 1

    for subregion in champagne_rules["subregions"]:
        if subregion["name"] in existing_names:
            continue
        tax["subregions"].append({
            "id": next_id,
            "name": subregion["name"],
            "slug": subregion.get("slug", slugify(subregion["name"])),
            "latitude": subregion["latitude"],
            "longitude": subregion["longitude"],
            "parent_id": champagne_region["id"],
            "parent_name": CHAMPAGNE_REGION,
            "grandparent_name": CHAMPAGNE_COUNTRY,
            "scopes": ["wine"],
        })
        existing_names.add(subregion["name"])
        next_id += 1


def infer_champagne_subregion(product, champagne_rules):
    """Infer Champagne subregion from product fields using curated producer rules."""
    brand = normalize_text((product.get("brand") or "").strip())
    name = normalize_text((product.get("name") or "").strip())
    raw_subregion = (product.get("subregion") or "").strip()

    if raw_subregion in champagne_rules["canonical_names"]:
        return raw_subregion

    for prefix in champagne_rules["blocked_prefixes"]:
        if brand.startswith(prefix) or name.startswith(prefix):
            return None

    for source in (brand, name):
        for prefix, subregion in champagne_rules["brand_prefix_map"].items():
            if source.startswith(prefix):
                return subregion

    return None


def should_handle_as_champagne(product, scope):
    return (
        scope == "wine"
        and (product.get("country") or "").strip() == CHAMPAGNE_COUNTRY
        and (product.get("region") or "").strip() == CHAMPAGNE_REGION
    )


def is_champagne_taxonomy_region(region_entry):
    return (
        region_entry
        and region_entry.get("name") == CHAMPAGNE_REGION
        and region_entry.get("parent_name") == CHAMPAGNE_COUNTRY
    )


def empty_counts():
    return {"wine": 0, "spirits": 0, "beer": 0, "sake": 0, "total": 0}


def empty_price_range():
    return {"min": None, "max": None}


def update_price_range(pr, price):
    if price and price > 0:
        if pr["min"] is None or price < pr["min"]:
            pr["min"] = price
        if pr["max"] is None or price > pr["max"]:
            pr["max"] = price


# ---------------------------------------------------------------------------
# Hierarchy normalisation
#
# Some entries in the taxonomy are "fake regions": a name that is really a
# SUBREGION (an AVA, a commune) but was promoted to region level, sitting as a
# sibling of the true region that contains it. The canonical case is USA:
#
#     region  California
#     region  Napa            <-- fake; Napa is inside California
#       sub     Napa Valley   <-- the real AVA, parented to the fake region
#       sub     Rutherford
#
# This produces two pins for one place, splits the SKU counts between them, and
# means the true region's drill-down is missing its own sub-appellations.
#
# FAKE_REGION_PARENTS declares those collapses explicitly rather than inferring
# them. Inference is unsafe here: "Rioja" legitimately contains the subregions
# "Rioja Alta" and "Rioja Alavesa", and a name-prefix heuristic would wrongly
# dissolve the real Rioja region. Every entry below is a hand-verified case
# where the region is NOT a real region in its own right.
# ---------------------------------------------------------------------------
FAKE_REGION_PARENTS = {
    # fake region name -> the real region that should absorb it
    "Napa": "California",
}

# Product data often carries a SUBREGION name in its `region` field (a bottle
# labelled "Napa Valley" is a California wine from the Napa Valley AVA). After
# a fake region is collapsed there is no region entry by that name any more, so
# resolve_region must climb to the containing region instead of returning None
# and dropping the product off the map entirely.
#
# This is populated from the taxonomy itself at normalisation time rather than
# hand-listed, so it stays correct as subregions move.
SUBREGION_TO_REGION: dict[str, str] = {}


def normalize_taxonomy_hierarchy(tax):
    """Collapse fake regions into their true parent region, IN PLACE.

    For each entry in FAKE_REGION_PARENTS whose target region exists:
      * every subregion of the fake region is re-parented to the true region
      * the fake region entry is removed from tax["regions"]

    Returns the set of removed (fake) region ids so callers can drop stale
    references. Safe to call more than once — a second call is a no-op because
    the fake region is already gone.
    """
    regions = tax.get("regions", [])
    by_name = {r["name"]: r for r in regions}

    removed_ids = set()
    for fake_name, real_name in FAKE_REGION_PARENTS.items():
        fake = by_name.get(fake_name)
        real = by_name.get(real_name)
        # Only collapse when BOTH exist; never invent the destination region.
        if not fake or not real or fake["id"] == real["id"]:
            continue

        for sub in tax.get("subregions", []):
            if sub.get("parent_id") == fake["id"]:
                sub["parent_id"] = real["id"]
                sub["parent_name"] = real["name"]
                if "parent_slug" in sub or "parentSlug" in sub:
                    sub["parent_slug"] = real.get("slug", slugify(real["name"]))
                # Remember that this subregion was orphaned by a collapse, so
                # resolve_region can still map product rows that carry its name
                # in their `region` field.
                sub["_collapsed_from"] = fake["name"]
        removed_ids.add(fake["id"])

    if removed_ids:
        tax["regions"] = [r for r in regions if r["id"] not in removed_ids]

    # Rebuild the name -> containing-region index used by resolve_region.
    #
    # TWO kinds of name must be redirected, and missing the first one silently
    # drops products off the map:
    #
    #   1. The COLLAPSED REGION'S OWN NAME. Product rows overwhelmingly carry
    #      region="Napa" (not "Napa Valley"), because that is how the source
    #      data spells it. Once the Napa region entry is deleted those rows
    #      resolve to nothing. They must fall through to California.
    #   2. Subregion names orphaned by the collapse (region="Napa Valley"),
    #      which likewise no longer match any region entry.
    #
    # Only names touched by a collapse are indexed — indexing every subregion
    # would let any commune name silently stand in for its region.
    live_regions = {r["id"]: r for r in tax["regions"]}
    SUBREGION_TO_REGION.clear()
    for fake_name, real_name in FAKE_REGION_PARENTS.items():
        if fake_name in {r["name"] for r in regions} and real_name in by_name:
            SUBREGION_TO_REGION[fake_name] = real_name
    for sub in tax.get("subregions", []):
        parent = live_regions.get(sub.get("parent_id"))
        if parent and sub.get("_collapsed_from") is not None:
            SUBREGION_TO_REGION[sub["name"]] = parent["name"]
    return removed_ids


def normalize_product_geography(product):
    """Return (region_name, subregion_name) for a product, de-duplicated.

    When a product carries the SAME place in both its region and subregion
    fields (e.g. region="Napa Valley", subregion="Napa Valley"), emitting both
    would draw two pins for one place and double-count the SKU. The region wins
    and the subregion is blanked.
    """
    region = (product.get("region") or "").strip()
    sub = (product.get("subregion") or "").strip()
    if sub and region and sub.casefold() == region.casefold():
        return region, ""
    return region, sub


def included_region_ids(tax, region_counts, sub_counts):
    """Region ids that should be emitted to the explore map.

    A region is included when it has products of its own, OR when it is the
    parent of a subregion that does — a zero-count region must still be drawn
    if its children hang off it, otherwise the drill-down loses its root.
    Regions with no products and no populated children are dropped so the map
    is not littered with empty pins.
    """
    included = {rid for rid, c in region_counts.items() if c.get("total", 0) > 0}

    populated_subs = {sid for sid, c in sub_counts.items() if c.get("total", 0) > 0}
    for sub in tax.get("subregions", []):
        if sub["id"] in populated_subs and sub.get("parent_id") is not None:
            included.add(sub["parent_id"])

    live_region_ids = {r["id"] for r in tax.get("regions", [])}
    return included & live_region_ids


def build_lookups(tax):
    """Build name→entry lookups for matching products to taxonomy."""
    country_by_name = {}
    for c in tax["countries"]:
        country_by_name[c["name"]] = c
        country_by_name[c["name"].lower()] = c

    region_by_name = {}  # key: (country_name, region_name)
    region_by_name_only = defaultdict(list)  # key: region_name → list of entries
    for r in tax["regions"]:
        parent = r.get("parent_name", "")
        region_by_name[(parent, r["name"])] = r
        region_by_name_only[r["name"]].append(r)
        # Also index by slug
        region_by_name_only[r.get("slug", slugify(r["name"]))].append(r)

    sub_by_name = {}  # key: (region_name, sub_name)
    sub_by_name_only = defaultdict(list)
    for sr in tax["subregions"]:
        parent = sr.get("parent_name", "")
        sub_by_name[(parent, sr["name"])] = sr
        sub_by_name_only[sr["name"]].append(sr)

    return country_by_name, region_by_name, region_by_name_only, sub_by_name, sub_by_name_only


def resolve_region(product_region, product_country, region_by_name, region_by_name_only):
    """Resolve a product's region field to a taxonomy region entry."""
    if not product_region:
        return None

    # Apply alias
    if product_region in REGION_ALIASES:
        mapped = REGION_ALIASES[product_region]
        if mapped is None:
            return None  # It's a subregion, not a region
        product_region = mapped

    # A product may name a SUBREGION that was orphaned when its fake parent
    # region was collapsed (e.g. region="Napa Valley" after Napa folded into
    # California). Climb to the containing region so the row still lands on the
    # map instead of being dropped.
    if product_region not in region_by_name_only:
        climbed = SUBREGION_TO_REGION.get(product_region)
        if climbed:
            product_region = climbed

    # Try exact match with country context
    if product_country:
        key = (product_country, product_region)
        if key in region_by_name:
            return region_by_name[key]

    # Try name-only match
    if product_region in region_by_name_only:
        matches = region_by_name_only[product_region]
        if len(matches) == 1:
            return matches[0]
        # Multiple matches — filter by country if possible
        if product_country:
            for m in matches:
                if m.get("parent_name") == product_country:
                    return m
        return matches[0]  # Fallback to first

    return None


def resolve_subregion(product_sub, product_region, sub_by_name, sub_by_name_only):
    """Resolve a product's subregion field to a taxonomy subregion entry."""
    if not product_sub:
        return None

    # Apply alias
    if product_sub in SUBREGION_ALIASES:
        product_sub = SUBREGION_ALIASES[product_sub]

    # Try exact match with region context
    if product_region:
        key = (product_region, product_sub)
        if key in sub_by_name:
            return sub_by_name[key]

    # Try name-only match
    if product_sub in sub_by_name_only:
        matches = sub_by_name_only[product_sub]
        if product_region:
            # A region was supplied, so the subregion MUST belong to it. Never
            # fall back to an arbitrary match: returning a subregion parented
            # to a different region silently files the product under the wrong
            # place (e.g. Rutherford resolving under California when it hangs
            # off Napa). No parent match => no subregion.
            for m in matches:
                if m.get("parent_name") == product_region:
                    return m
            return None
        if len(matches) == 1:
            return matches[0]
        # Ambiguous name with no region context — refuse to guess.
        return None

    return None


def load_masterfile_csv(path):
    """Load products from the masterfile CSV (full catalog, not just products.json subset)."""
    import csv
    products = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            products.append(row)
    return products


def main():
    print("Loading source data...")
    tax = load_json(DATA / "taxonomy_for_map.json")
    champagne_rules = load_champagne_rules()
    inject_missing_countries(tax)
    inject_missing_regions(tax)
    inject_champagne_subregions(tax, champagne_rules)
    # Collapse fake regions (e.g. "Napa", which is really an AVA inside
    # California) AFTER the injections so anything they added is normalised
    # too. Must run before build_lookups, which indexes by parent name.
    collapsed = normalize_taxonomy_hierarchy(tax)
    if collapsed:
        print(f"  Normalized hierarchy: collapsed {len(collapsed)} fake region(s) "
              f"-> {sorted(FAKE_REGION_PARENTS)}")

    # Use masterfile CSV (19K+ products) instead of products.json (4K subset)
    masterfile = DATA / "masterfile_all_tiers.csv"
    if masterfile.exists():
        products = load_masterfile_csv(masterfile)
        print(f"  Source: masterfile_all_tiers.csv")
    else:
        products = load_json(DATA / "db" / "products.json")
        print(f"  Source: products.json (fallback)")

    print(f"  Taxonomy: {sum(len(tax[k]) for k in ['countries','regions','subregions','appellations'])} entities")
    print(f"  Products: {len(products)}")

    # Build lookups
    country_by_name, region_by_name, region_by_name_only, sub_by_name, sub_by_name_only = build_lookups(tax)

    # ----------------------------------------------------------------
    # Initialize accumulators
    # ----------------------------------------------------------------
    country_counts = defaultdict(empty_counts)
    country_prices = defaultdict(empty_price_range)

    region_counts = defaultdict(empty_counts)
    region_prices = defaultdict(empty_price_range)

    sub_counts = defaultdict(empty_counts)
    sub_prices = defaultdict(empty_price_range)

    # Track stats
    stats = {
        "total": 0,
        "mapped_country": 0,
        "mapped_region": 0,
        "mapped_subregion": 0,
        "excluded_accessories": 0,
        "excluded_no_scope": 0,
        "unmatched_countries": defaultdict(int),
        "unmatched_regions": defaultdict(int),
    }

    # ----------------------------------------------------------------
    # Process each product
    # ----------------------------------------------------------------
    for p in products:
        sku = p.get("sku", "")
        scope = sku_to_scope(sku)
        raw_price = p.get("price")
        try:
            price = float(raw_price) if raw_price else None
        except (ValueError, TypeError):
            price = None
        country_name = normalize_country_name((p.get("country") or "").strip())
        # Drop a subregion that merely repeats the region, so one place does not
        # get two pins and double-counted SKUs.
        region_name, sub_name = normalize_product_geography(p)
        if should_handle_as_champagne(p, scope):
            inferred_subregion = infer_champagne_subregion(p, champagne_rules)
            if inferred_subregion:
                sub_name = inferred_subregion

        stats["total"] += 1

        if scope is None:
            stats["excluded_accessories"] += 1
            continue

        # --- Country ---
        country_entry = country_by_name.get(country_name)
        if not country_entry:
            if country_name:
                stats["unmatched_countries"][country_name] += 1
            continue

        cid = country_entry["id"]
        country_counts[cid][scope] += 1
        country_counts[cid]["total"] += 1
        update_price_range(country_prices[cid], price)
        stats["mapped_country"] += 1

        # --- Region ---
        region_entry = resolve_region(region_name, country_name, region_by_name, region_by_name_only)
        if is_champagne_taxonomy_region(region_entry) and not should_handle_as_champagne(p, scope):
            region_entry = None
        if region_entry:
            rid = region_entry["id"]
            region_counts[rid][scope] += 1
            region_counts[rid]["total"] += 1
            update_price_range(region_prices[rid], price)
            stats["mapped_region"] += 1

            # Use resolved region name for subregion lookup
            resolved_region_name = region_entry["name"]
        else:
            if region_name:
                stats["unmatched_regions"][f"{country_name}/{region_name}"] += 1
            resolved_region_name = region_name
            rid = None

        # --- Subregion ---
        sub_entry = resolve_subregion(sub_name, resolved_region_name, sub_by_name, sub_by_name_only)
        if sub_entry:
            sid = sub_entry["id"]
            sub_counts[sid][scope] += 1
            sub_counts[sid]["total"] += 1
            update_price_range(sub_prices[sid], price)
            stats["mapped_subregion"] += 1

    # ----------------------------------------------------------------
    # Build output structure (matches spec Section 7.2)
    # ----------------------------------------------------------------
    print("\nBuilding explore-taxonomy.json...")

    # Helper to build slug for parent lookups
    country_id_map = {c["id"]: c for c in tax["countries"]}
    region_id_map = {r["id"]: r for r in tax["regions"]}
    sub_id_map = {s["id"]: s for s in tax["subregions"]}

    # --- Countries ---
    out_countries = []
    for c in sorted(tax["countries"], key=lambda x: x["name"]):
        cid = c["id"]
        out_countries.append({
            "id": cid,
            "name": c["name"],
            "slug": c.get("slug", slugify(c["name"])),
            "latitude": c["latitude"],
            "longitude": c["longitude"],
            "scopes": c.get("scopes", []),
            "counts": dict(country_counts.get(cid, empty_counts())),
            "priceRange": dict(country_prices.get(cid, empty_price_range())),
        })

    # --- Regions ---
    # NOTE: `included_region_ids(tax, region_counts, sub_counts)` is implemented
    # and unit-tested but deliberately NOT applied here yet. On current data it
    # would drop 200 of 300 regions (zero products AND no populated children),
    # which is a much larger, separately-verifiable change than the fake-region
    # collapse this pass is about — and it feeds both the explore map and the
    # /shop region links. Enable it as its own change, with its own browser
    # verification of the country drill-downs.
    out_regions = []
    for r in sorted(tax["regions"], key=lambda x: x["name"]):
        rid = r["id"]
        parent_id = r.get("parent_id")
        parent = country_id_map.get(parent_id, {})
        is_non_geo = r["name"] in NON_GEOGRAPHIC

        entry = {
            "id": rid,
            "name": r["name"],
            "slug": r.get("slug", slugify(r["name"])),
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "parentId": parent_id,
            "parentSlug": parent.get("slug", slugify(parent.get("name", ""))),
            "scopes": r.get("scopes", []),
            "counts": dict(region_counts.get(rid, empty_counts())),
            "priceRange": dict(region_prices.get(rid, empty_price_range())),
        }
        if is_non_geo:
            entry["nonGeographic"] = True

        out_regions.append(entry)

    # --- Subregions ---
    out_subregions = []
    for sr in sorted(tax["subregions"], key=lambda x: x["name"]):
        sid = sr["id"]
        parent_id = sr.get("parent_id")
        parent_region = region_id_map.get(parent_id, {})
        grandparent_name = sr.get("grandparent_name", "")
        # Find grandparent country entry
        grandparent = None
        for c in tax["countries"]:
            if c["name"] == grandparent_name:
                grandparent = c
                break

        entry = {
            "id": sid,
            "name": sr["name"],
            "slug": sr.get("slug", slugify(sr["name"])),
            "latitude": sr["latitude"],
            "longitude": sr["longitude"],
            "parentId": parent_id,
            "parentSlug": parent_region.get("slug", slugify(parent_region.get("name", ""))),
            "grandparentId": grandparent["id"] if grandparent else None,
            "grandparentSlug": grandparent.get("slug", slugify(grandparent.get("name", ""))) if grandparent else None,
            "scopes": sr.get("scopes", []),
            "counts": dict(sub_counts.get(sid, empty_counts())),
            "priceRange": dict(sub_prices.get(sid, empty_price_range())),
        }
        out_subregions.append(entry)

    # --- Appellations ---
    # Appellations currently have no product mapping (origin field is empty)
    # Include with zero counts — will populate when products get appellation enrichment
    out_appellations = []
    for a in sorted(tax["appellations"], key=lambda x: x["name"]):
        aid = a["id"]
        is_non_geo = a["name"] in NON_GEOGRAPHIC

        entry = {
            "id": aid,
            "name": a["name"],
            "slug": a.get("slug", slugify(a["name"])),
            "latitude": a["latitude"],
            "longitude": a["longitude"],
            "scopes": a.get("scopes", []),
            "counts": empty_counts(),
            "priceRange": empty_price_range(),
        }
        if is_non_geo:
            entry["nonGeographic"] = True

        out_appellations.append(entry)

    # ----------------------------------------------------------------
    # Assemble final output
    # ----------------------------------------------------------------
    output = {
        "_meta": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "description": "Explore taxonomy for interactive map — countries, regions, subregions, appellations with product counts and price ranges",
            "counts": {
                "countries": len(out_countries),
                "regions": len(out_regions),
                "subregions": len(out_subregions),
                "appellations": len(out_appellations),
            },
            "productStats": {
                "total": stats["total"],
                "mappedToCountry": stats["mapped_country"],
                "mappedToRegion": stats["mapped_region"],
                "mappedToSubregion": stats["mapped_subregion"],
                "excludedAccessories": stats["excluded_accessories"],
            },
            "nonGeographicEntries": sorted(NON_GEOGRAPHIC),
        },
        "countries": out_countries,
        "regions": out_regions,
        "subregions": out_subregions,
        "appellations": out_appellations,
    }

    # Save
    out_path = DATA / "taxonomy" / "explore-taxonomy.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"  Saved: {out_path}")

    # File size
    size_kb = out_path.stat().st_size / 1024
    print(f"  Size: {size_kb:.0f} KB")

    # ----------------------------------------------------------------
    # Report
    # ----------------------------------------------------------------
    print(f"\n{'='*60}")
    print(f"PRODUCT MAPPING REPORT")
    print(f"{'='*60}")
    print(f"Total products:        {stats['total']}")
    print(f"Excluded (accessories): {stats['excluded_accessories']}")
    print(f"Mapped to country:     {stats['mapped_country']}")
    print(f"Mapped to region:      {stats['mapped_region']}")
    print(f"Mapped to subregion:   {stats['mapped_subregion']}")

    if stats["unmatched_countries"]:
        print(f"\nUnmatched countries ({len(stats['unmatched_countries'])}):")
        for name, count in sorted(stats["unmatched_countries"].items(), key=lambda x: -x[1]):
            print(f"  {name}: {count} products")

    if stats["unmatched_regions"]:
        print(f"\nUnmatched regions ({len(stats['unmatched_regions'])}):")
        for name, count in sorted(stats["unmatched_regions"].items(), key=lambda x: -x[1]):
            print(f"  {name}: {count} products")

    # Top countries by product count
    print(f"\nTop 15 countries by product count:")
    top_countries = sorted(out_countries, key=lambda x: x["counts"]["total"], reverse=True)
    for c in top_countries[:15]:
        ct = c["counts"]
        print(f"  {c['name']:<20} total={ct['total']:>4}  wine={ct['wine']:>4}  spirits={ct['spirits']:>3}  beer={ct['beer']:>2}  sake={ct['sake']:>2}")

    # Top regions
    print(f"\nTop 15 regions by product count:")
    top_regions = sorted(out_regions, key=lambda x: x["counts"]["total"], reverse=True)
    for r in top_regions[:15]:
        ct = r["counts"]
        pr = r["priceRange"]
        price_str = f"฿{pr['min']:,.0f}–{pr['max']:,.0f}" if pr["min"] else "no prices"
        print(f"  {r['name']:<25} total={ct['total']:>3}  {price_str}")

    print(f"\n{'='*60}")
    print("Done!")


if __name__ == "__main__":
    main()
