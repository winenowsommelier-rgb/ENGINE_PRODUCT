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
    "Napa Valley": "Napa",
    "Yarra Valley": "Yarra",
    "Highlands": "Highland",
    "Speyside": "Highland",         # Speyside is part of Highland in our taxonomy
    "Islands": "Islay",             # Islands whisky often mapped to Islay
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
    "Eden Valley": "Barossa Valley",# Adjacent to Barossa
    "Stellenbosch": "Western Cape",
    "Heathcote": "Victoria",
    "Murray Darling": "Victoria",
    "Orange": "Victoria",
    "Rutherglen": "Victoria",
    "Riverina": "South Australia",
    "Tasmania": "Victoria",         # Separate but closest match
    "Hokkaido": "Jalisco",          # Skip — no matching region, use None
    "Nagano": "Jalisco",            # Same — these are Japanese wine regions not in our taxonomy
    "Yamanashi": "Jalisco",
    "Hua Hin Hills": "Khao Yai",    # Thai wine region — approximate
    "Hawke’s Bay": "Hawke's Bay",
    "South West France": "Languedoc",
    "Vinho Verde": "Douro",         # Portugal grouping
    "Goriška Brda": None,           # Slovenia — too specific
    "Limarí Valley": "Aconcagua Valley",
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
        if len(matches) == 1:
            return matches[0]
        if product_region:
            for m in matches:
                if m.get("parent_name") == product_region:
                    return m
        return matches[0]

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
        region_name = (p.get("region") or "").strip()
        sub_name = (p.get("subregion") or "").strip()
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
