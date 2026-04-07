#!/usr/bin/env python3
"""
extract_product_fields.py — Zero-API field extraction from product names.

Extracts: grape_variety, vintage (cleanup), brand, region
Patches back to Supabase.

Usage:
  python3 scripts/extract_product_fields.py --dry-run --tier=1
  python3 scripts/extract_product_fields.py --tier=0          # all tiers, write
"""

from __future__ import annotations
import argparse
import json
import re
import sys
from urllib import request, error as urlerror

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "https://xfcvliyxxguhihehqwkg.supabase.co"
API_KEY  = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
HEADERS  = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}

WINE_CLASSIFICATIONS = {
    "red wine", "white wine", "rose wine", "rosé wine",
    "sparkling wine", "champagne", "orange wine",
    "dessert wine", "port wine", "fruit wine",
}

# ---------------------------------------------------------------------------
# Grape Variety Dictionary (150+)
# ---------------------------------------------------------------------------
# Canonical name → list of aliases (including self, lowercase)
_GRAPE_RAW = {
    # --- RED ---
    "Cabernet Sauvignon": ["cabernet sauvignon"],
    "Merlot": ["merlot"],
    "Pinot Noir": ["pinot noir", "spätburgunder", "spatburgunder", "blauburgunder"],
    "Syrah": ["syrah", "shiraz"],
    "Grenache": ["grenache", "garnacha", "cannonau"],
    "Tempranillo": ["tempranillo", "tinta de toro", "cencibel", "tinto fino"],
    "Sangiovese": ["sangiovese", "brunello", "prugnolo gentile"],
    "Nebbiolo": ["nebbiolo", "chiavennasca", "spanna"],
    "Malbec": ["malbec", "côt", "cot", "auxerrois"],
    "Zinfandel": ["zinfandel", "primitivo"],
    "Cabernet Franc": ["cabernet franc"],
    "Petit Verdot": ["petit verdot"],
    "Mourvèdre": ["mourvèdre", "mourvedre", "monastrell", "mataro"],
    "Carmenère": ["carmenère", "carmenere"],
    "Barbera": ["barbera"],
    "Corvina": ["corvina"],
    "Nero d'Avola": ["nero d'avola", "nero d avola"],
    "Pinotage": ["pinotage"],
    "Gamay": ["gamay"],
    "Tannat": ["tannat"],
    "Touriga Nacional": ["touriga nacional"],
    "Touriga Franca": ["touriga franca"],
    "Aglianico": ["aglianico"],
    "Blaufränkisch": ["blaufränkisch", "blaufrankisch", "lemberger", "kékfrankos"],
    "Zweigelt": ["zweigelt"],
    "Dolcetto": ["dolcetto"],
    "Lagrein": ["lagrein"],
    "Montepulciano": ["montepulciano"],
    "Negroamaro": ["negroamaro", "negro amaro"],
    "Petite Sirah": ["petite sirah", "petite syrah", "durif"],
    "Bonarda": ["bonarda"],
    "Carignan": ["carignan", "cariñena", "carignane", "mazuelo"],
    "Cinsault": ["cinsault", "cinsaut"],
    "Mencia": ["mencía", "mencia"],
    "Graciano": ["graciano"],
    "Tinta Roriz": ["tinta roriz"],
    "Sousão": ["sousão", "sousao"],
    "Dornfelder": ["dornfelder"],
    "St. Laurent": ["st. laurent", "saint laurent"],
    "Frappato": ["frappato"],
    "Nerello Mascalese": ["nerello mascalese"],
    "Nerello Cappuccio": ["nerello cappuccio"],
    "Sagrantino": ["sagrantino"],
    "Teroldego": ["teroldego"],
    "Schioppettino": ["schioppettino"],
    "Refosco": ["refosco"],
    "Plavac Mali": ["plavac mali"],
    "Xinomavro": ["xinomavro"],
    "Agiorgitiko": ["agiorgitiko"],
    "Mavrud": ["mavrud"],
    "Kadarka": ["kadarka"],
    "Feteasca Neagra": ["feteasca neagra"],
    "Saperavi": ["saperavi"],
    "Norton": ["norton"],
    "Chambourcin": ["chambourcin"],
    "Baco Noir": ["baco noir"],
    "Trollinger": ["trollinger"],
    "Lemberger": [],  # already alias of Blaufränkisch
    "Counoise": ["counoise"],
    "Vaccarèse": ["vaccarèse", "vaccarese"],
    "Fer Servadou": ["fer servadou", "fer"],
    "Pais": ["pais", "país", "listán prieto"],
    "Criolla": ["criolla"],
    "Bobal": ["bobal"],
    "Tinta Barroca": ["tinta barroca"],
    "Schiava": ["schiava", "vernatsch"],
    "Cesanese": ["cesanese"],
    "Gaglioppo": ["gaglioppo"],
    "Canaiolo": ["canaiolo"],
    "Colorino": ["colorino"],
    "Alicante Bouschet": ["alicante bouschet"],
    "Petit Manseng": ["petit manseng"],

    # --- WHITE ---
    "Chardonnay": ["chardonnay"],
    "Sauvignon Blanc": ["sauvignon blanc", "fumé blanc", "fume blanc"],
    "Riesling": ["riesling"],
    "Pinot Grigio": ["pinot grigio", "pinot gris", "grauburgunder", "ruländer", "rulander"],
    "Gewürztraminer": ["gewürztraminer", "gewurztraminer", "traminer"],
    "Viognier": ["viognier"],
    "Chenin Blanc": ["chenin blanc", "steen"],
    "Sémillon": ["sémillon", "semillon"],
    "Albariño": ["albariño", "albarino", "alvarinho"],
    "Grüner Veltliner": ["grüner veltliner", "gruner veltliner"],
    "Torrontés": ["torrontés", "torrontes"],
    "Verdejo": ["verdejo"],
    "Vermentino": ["vermentino", "rolle"],
    "Trebbiano": ["trebbiano", "ugni blanc"],
    "Garganega": ["garganega"],
    "Muscat": ["muscat", "moscato", "moscatel", "muskateller", "muscat blanc"],
    "Müller-Thurgau": ["müller-thurgau", "muller-thurgau", "müller thurgau", "muller thurgau", "rivaner"],
    "Cortese": ["cortese"],
    "Arneis": ["arneis"],
    "Marsanne": ["marsanne"],
    "Roussanne": ["roussanne"],
    "Fiano": ["fiano"],
    "Greco": ["greco"],
    "Godello": ["godello"],
    "Verdelho": ["verdelho"],
    "Malvasia": ["malvasia", "malmsey"],
    "Assyrtiko": ["assyrtiko"],
    "Falanghina": ["falanghina"],
    "Pecorino": ["pecorino"],
    "Verdicchio": ["verdicchio"],
    "Ribolla Gialla": ["ribolla gialla", "ribolla"],
    "Friulano": ["friulano", "tocai friulano", "sauvignonasse"],
    "Sylvaner": ["sylvaner", "silvaner"],
    "Scheurebe": ["scheurebe"],
    "Kerner": ["kerner"],
    "Welschriesling": ["welschriesling"],
    "Furmint": ["furmint"],
    "Hárslevelű": ["hárslevelű", "harslevelu"],
    "Macabeo": ["macabeo", "viura"],
    "Xarel·lo": ["xarel·lo", "xarello", "xarel-lo"],
    "Parellada": ["parellada"],
    "Loureiro": ["loureiro"],
    "Arinto": ["arinto"],
    "Encruzado": ["encruzado"],
    "Melon de Bourgogne": ["melon de bourgogne", "muscadet"],
    "Picpoul": ["picpoul", "piquepoul"],
    "Clairette": ["clairette"],
    "Bourboulenc": ["bourboulenc"],
    "Colombard": ["colombard"],
    "Ugni Blanc": [],  # alias of Trebbiano
    "Insolia": ["insolia", "inzolia"],
    "Catarratto": ["catarratto"],
    "Grillo": ["grillo"],
    "Carricante": ["carricante"],
    "Savagnin": ["savagnin"],
    "Rkatsiteli": ["rkatsiteli"],
    "Mtsvane": ["mtsvane"],
    "Zierfandler": ["zierfandler"],
    "Rotgipfler": ["rotgipfler"],
    "Gros Manseng": ["gros manseng"],
    "Mauzac": ["mauzac"],
    "Len de l'El": ["len de l'el"],
    "Seyval Blanc": ["seyval blanc"],
    "Vidal": ["vidal"],
    "Glera": ["glera", "prosecco"],
    "Manzoni Bianco": ["manzoni bianco"],
    "Nascetta": ["nascetta"],
    "Timorasso": ["timorasso"],
    "Pigato": ["pigato"],
    "Favorita": ["favorita"],
    "Blanc de Morgex": ["blanc de morgex"],
    "Hondarrabi Zuri": ["hondarrabi zuri"],
    "Txakoli": ["txakoli"],
}

# Build a lookup: lowercase alias → canonical name
GRAPE_LOOKUP: dict[str, str] = {}
for canonical, aliases in _GRAPE_RAW.items():
    for alias in aliases:
        GRAPE_LOOKUP[alias.lower()] = canonical
    # Always include canonical lowered
    GRAPE_LOOKUP[canonical.lower()] = canonical

# Sort by length descending so longer matches win (e.g. "Cabernet Sauvignon" before "Cabernet")
GRAPE_PATTERNS: list[tuple[re.Pattern, str]] = []
for alias in sorted(GRAPE_LOOKUP.keys(), key=len, reverse=True):
    canonical = GRAPE_LOOKUP[alias]
    # Word boundary matching, case-insensitive
    pat = re.compile(r'\b' + re.escape(alias) + r'\b', re.IGNORECASE)
    GRAPE_PATTERNS.append((pat, canonical))

# ---------------------------------------------------------------------------
# Region Mapping: (country, keyword_in_name) → region
# ---------------------------------------------------------------------------
REGION_MAP: list[tuple[str | None, str, str]] = [
    # France
    ("France", "Bordeaux", "Bordeaux"),
    ("France", "Burgundy", "Burgundy"),
    ("France", "Bourgogne", "Burgundy"),
    ("France", "Champagne", "Champagne"),
    ("France", "Rhône", "Rhône Valley"),
    ("France", "Rhone", "Rhône Valley"),
    ("France", "Loire", "Loire Valley"),
    ("France", "Alsace", "Alsace"),
    ("France", "Languedoc", "Languedoc-Roussillon"),
    ("France", "Roussillon", "Languedoc-Roussillon"),
    ("France", "Provence", "Provence"),
    ("France", "Côtes du Rhône", "Rhône Valley"),
    ("France", "Cotes du Rhone", "Rhône Valley"),
    ("France", "Beaujolais", "Beaujolais"),
    ("France", "Chablis", "Burgundy"),
    ("France", "Sancerre", "Loire Valley"),
    ("France", "Vouvray", "Loire Valley"),
    ("France", "Muscadet", "Loire Valley"),
    ("France", "Pouilly-Fumé", "Loire Valley"),
    ("France", "Pouilly-Fuisse", "Burgundy"),
    ("France", "Saint-Émilion", "Bordeaux"),
    ("France", "Saint-Emilion", "Bordeaux"),
    ("France", "Pauillac", "Bordeaux"),
    ("France", "Margaux", "Bordeaux"),
    ("France", "Médoc", "Bordeaux"),
    ("France", "Medoc", "Bordeaux"),
    ("France", "Pomerol", "Bordeaux"),
    ("France", "Graves", "Bordeaux"),
    ("France", "Sauternes", "Bordeaux"),
    ("France", "Châteauneuf-du-Pape", "Rhône Valley"),
    ("France", "Chateauneuf-du-Pape", "Rhône Valley"),
    ("France", "Gigondas", "Rhône Valley"),
    ("France", "Hermitage", "Rhône Valley"),
    ("France", "Cornas", "Rhône Valley"),
    ("France", "Condrieu", "Rhône Valley"),
    ("France", "Crozes-Hermitage", "Rhône Valley"),
    ("France", "Cahors", "South West France"),
    ("France", "Madiran", "South West France"),
    ("France", "Jurançon", "South West France"),
    ("France", "Bandol", "Provence"),
    ("France", "Côtes de Provence", "Provence"),

    # Italy
    ("Italy", "Tuscany", "Tuscany"),
    ("Italy", "Toscana", "Tuscany"),
    ("Italy", "Piedmont", "Piedmont"),
    ("Italy", "Piemonte", "Piedmont"),
    ("Italy", "Veneto", "Veneto"),
    ("Italy", "Sicily", "Sicily"),
    ("Italy", "Sicilia", "Sicily"),
    ("Italy", "Puglia", "Puglia"),
    ("Italy", "Sardinia", "Sardinia"),
    ("Italy", "Sardegna", "Sardinia"),
    ("Italy", "Alto Adige", "Alto Adige"),
    ("Italy", "Trentino", "Trentino"),
    ("Italy", "Friuli", "Friuli-Venezia Giulia"),
    ("Italy", "Abruzzo", "Abruzzo"),
    ("Italy", "Campania", "Campania"),
    ("Italy", "Chianti", "Tuscany"),
    ("Italy", "Barolo", "Piedmont"),
    ("Italy", "Barbaresco", "Piedmont"),
    ("Italy", "Brunello", "Tuscany"),
    ("Italy", "Montalcino", "Tuscany"),
    ("Italy", "Amarone", "Veneto"),
    ("Italy", "Valpolicella", "Veneto"),
    ("Italy", "Soave", "Veneto"),
    ("Italy", "Prosecco", "Veneto"),
    ("Italy", "Franciacorta", "Lombardy"),
    ("Italy", "Lambrusco", "Emilia-Romagna"),
    ("Italy", "Gavi", "Piedmont"),
    ("Italy", "Asti", "Piedmont"),
    ("Italy", "Etna", "Sicily"),
    ("Italy", "Bolgheri", "Tuscany"),
    ("Italy", "Maremma", "Tuscany"),

    # USA
    ("United States", "Napa Valley", "Napa Valley"),
    ("United States", "Napa", "Napa Valley"),
    ("United States", "Sonoma", "Sonoma"),
    ("United States", "Paso Robles", "Paso Robles"),
    ("United States", "Willamette", "Willamette Valley"),
    ("United States", "Russian River", "Sonoma"),
    ("United States", "Santa Barbara", "Santa Barbara"),
    ("United States", "Central Coast", "Central Coast"),
    ("United States", "Monterey", "Monterey"),
    ("United States", "Lodi", "Lodi"),
    ("United States", "Walla Walla", "Walla Walla Valley"),
    ("United States", "Columbia Valley", "Columbia Valley"),
    ("United States", "Alexander Valley", "Sonoma"),
    ("United States", "Dry Creek", "Sonoma"),
    ("USA", "Napa Valley", "Napa Valley"),
    ("USA", "Napa", "Napa Valley"),
    ("USA", "Sonoma", "Sonoma"),

    # Spain
    ("Spain", "Rioja", "Rioja"),
    ("Spain", "Ribera del Duero", "Ribera del Duero"),
    ("Spain", "Priorat", "Priorat"),
    ("Spain", "Penedès", "Penedès"),
    ("Spain", "Penedes", "Penedès"),
    ("Spain", "Rías Baixas", "Rías Baixas"),
    ("Spain", "Rias Baixas", "Rías Baixas"),
    ("Spain", "Rueda", "Rueda"),
    ("Spain", "Toro", "Toro"),
    ("Spain", "Navarra", "Navarra"),
    ("Spain", "Jumilla", "Jumilla"),
    ("Spain", "Galicia", "Galicia"),

    # Argentina
    ("Argentina", "Mendoza", "Mendoza"),
    ("Argentina", "Salta", "Salta"),
    ("Argentina", "Patagonia", "Patagonia"),
    ("Argentina", "Uco Valley", "Mendoza"),

    # Chile
    ("Chile", "Maipo", "Maipo Valley"),
    ("Chile", "Colchagua", "Colchagua Valley"),
    ("Chile", "Casablanca", "Casablanca Valley"),
    ("Chile", "Rapel", "Rapel Valley"),

    # Australia
    ("Australia", "Barossa", "Barossa Valley"),
    ("Australia", "McLaren Vale", "McLaren Vale"),
    ("Australia", "Margaret River", "Margaret River"),
    ("Australia", "Yarra Valley", "Yarra Valley"),
    ("Australia", "Hunter Valley", "Hunter Valley"),
    ("Australia", "Coonawarra", "Coonawarra"),
    ("Australia", "Adelaide Hills", "Adelaide Hills"),
    ("Australia", "Clare Valley", "Clare Valley"),
    ("Australia", "Eden Valley", "Eden Valley"),

    # New Zealand
    ("New Zealand", "Marlborough", "Marlborough"),
    ("New Zealand", "Central Otago", "Central Otago"),
    ("New Zealand", "Hawke's Bay", "Hawke's Bay"),
    ("New Zealand", "Hawkes Bay", "Hawke's Bay"),
    ("New Zealand", "Martinborough", "Martinborough"),

    # South Africa
    ("South Africa", "Stellenbosch", "Stellenbosch"),
    ("South Africa", "Swartland", "Swartland"),
    ("South Africa", "Franschhoek", "Franschhoek"),
    ("South Africa", "Paarl", "Paarl"),
    ("South Africa", "Constantia", "Constantia"),
    ("South Africa", "Walker Bay", "Walker Bay"),

    # Portugal
    ("Portugal", "Douro", "Douro"),
    ("Portugal", "Alentejo", "Alentejo"),
    ("Portugal", "Dão", "Dão"),
    ("Portugal", "Dao", "Dão"),
    ("Portugal", "Vinho Verde", "Vinho Verde"),
    ("Portugal", "Bairrada", "Bairrada"),

    # Germany
    ("Germany", "Mosel", "Mosel"),
    ("Germany", "Rheingau", "Rheingau"),
    ("Germany", "Pfalz", "Pfalz"),
    ("Germany", "Baden", "Baden"),
    ("Germany", "Rheinhessen", "Rheinhessen"),
    ("Germany", "Franken", "Franken"),
    ("Germany", "Nahe", "Nahe"),

    # Austria
    ("Austria", "Wachau", "Wachau"),
    ("Austria", "Kamptal", "Kamptal"),
    ("Austria", "Kremstal", "Kremstal"),
    ("Austria", "Burgenland", "Burgenland"),

    # Any-country fallback for very distinctive regions
    (None, "Champagne", "Champagne"),
    (None, "Bordeaux", "Bordeaux"),
    (None, "Burgundy", "Burgundy"),
    (None, "Barossa", "Barossa Valley"),
    (None, "Napa Valley", "Napa Valley"),
    (None, "Marlborough", "Marlborough"),
    (None, "Rioja", "Rioja"),
    (None, "Mendoza", "Mendoza"),
]

# Precompile region patterns
REGION_PATTERNS: list[tuple[str | None, re.Pattern, str]] = []
for country, keyword, region in REGION_MAP:
    pat = re.compile(r'\b' + re.escape(keyword) + r'\b', re.IGNORECASE)
    REGION_PATTERNS.append((country, pat, region))


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def sb_get(path: str) -> list[dict]:
    url = f"{BASE_URL}/rest/v1/{path}"
    req = request.Request(url, headers={**HEADERS, "Prefer": "count=none"})
    with request.urlopen(req) as r:
        return json.loads(r.read())


def sb_get_all(path: str, page_size: int = 1000) -> list[dict]:
    all_rows: list[dict] = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        page_path = f"{path}{sep}limit={page_size}&offset={offset}"
        rows = sb_get(page_path)
        all_rows.extend(rows)
        print(f"  Fetched {len(all_rows)} rows so far...", flush=True)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def sb_patch(sku: str, data: dict) -> bool:
    url = f"{BASE_URL}/rest/v1/products?sku=eq.{sku}"
    body = json.dumps(data).encode()
    req = request.Request(
        url, data=body, method="PATCH",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
    )
    try:
        with request.urlopen(req) as r:
            return r.status < 300
    except urlerror.HTTPError as e:
        print(f"  PATCH error for {sku}: {e.code} {e.read().decode()[:200]}", flush=True)
        return False


# ---------------------------------------------------------------------------
# Extraction functions
# ---------------------------------------------------------------------------

def extract_grapes(name: str) -> str | None:
    """Extract grape varieties from product name."""
    found: dict[str, int] = {}  # canonical → position
    name_lower = name.lower()
    for pat, canonical in GRAPE_PATTERNS:
        m = pat.search(name)
        if m and canonical not in found:
            found[canonical] = m.start()
    if not found:
        return None
    # Sort by position in name
    sorted_grapes = sorted(found.items(), key=lambda x: x[1])
    return ", ".join(g[0] for g in sorted_grapes)


def extract_vintage(name: str, current_vintage: str | None) -> str | None:
    """Clean up vintage or extract from name."""
    cv = (current_vintage or "").strip()

    # Case 1: has vintage like "2022 [**VINTAGE MAY CHANGE]"
    if cv and "VINTAGE MAY CHANGE" in cv.upper():
        m = re.match(r'(\d{4})', cv)
        if m:
            year = int(m.group(1))
            if 1900 <= year <= 2026:
                return m.group(1)

    # Case 2: vintage is empty, try name
    if not cv:
        m = re.search(r'\b(19[89]\d|20[0-2]\d)\b', name)
        if m:
            return m.group(1)

    return None


def extract_region(name: str, country: str | None) -> str | None:
    """Extract region from product name based on country context."""
    country_str = (country or "").strip()
    for req_country, pat, region in REGION_PATTERNS:
        if req_country is not None and country_str and req_country.lower() != country_str.lower():
            continue
        if req_country is not None and not country_str:
            continue  # skip country-specific rules if no country set
        if pat.search(name):
            return region
    return None


# ---------------------------------------------------------------------------
# Brand extraction helpers
# ---------------------------------------------------------------------------

def build_brand_list(products: list[dict]) -> set[str]:
    """Collect known brands from products that already have brand filled."""
    brands: set[str] = set()
    for p in products:
        b = (p.get("brand") or "").strip()
        if b and len(b) > 1:
            brands.add(b)
    return brands


def extract_brand(name: str, known_brands: set[str]) -> str | None:
    """Try to find a known brand in the product name."""
    name_lower = name.lower()
    best: str | None = None
    best_len = 0
    for brand in known_brands:
        bl = brand.lower()
        # Word boundary match — prefer longest match
        pat = re.compile(r'\b' + re.escape(bl) + r'\b', re.IGNORECASE)
        if pat.search(name) and len(brand) > best_len:
            best = brand
            best_len = len(brand)
    return best


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Extract grape, vintage, brand, region from product names")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--tier", type=int, default=0, help="Tier to process (0=all)")
    args = parser.parse_args()

    print(f"=== Product Field Extraction ===", flush=True)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}", flush=True)
    print(f"Tier filter: {'all' if args.tier == 0 else args.tier}", flush=True)
    print(flush=True)

    # --- Fetch products ---
    select_fields = "sku,name,classification,grape_variety,vintage,brand,region,country,enrichment_priority"
    query = f"products?select={select_fields}&order=sku"
    if args.tier > 0:
        query += f"&enrichment_priority=eq.{args.tier}"

    print("Fetching products...", flush=True)
    products = sb_get_all(query)
    print(f"Total products fetched: {len(products)}", flush=True)
    print(flush=True)

    # --- Build known brand list from all products ---
    print("Building known brand list...", flush=True)
    if args.tier > 0:
        # Fetch all brands regardless of tier
        all_for_brands = sb_get_all("products?select=brand")
        known_brands = build_brand_list(all_for_brands)
    else:
        known_brands = build_brand_list(products)
    print(f"Known brands: {len(known_brands)}", flush=True)
    print(flush=True)

    # --- Process ---
    updates: list[tuple[str, dict]] = []  # (sku, patch_data)
    stats = {"grape": 0, "vintage": 0, "brand": 0, "region": 0, "products_with_updates": 0}

    for i, p in enumerate(products):
        sku = p.get("sku", "")
        name = (p.get("name") or "").strip()
        classification = (p.get("classification") or "").strip().lower()
        if not name or not sku:
            continue

        patch: dict = {}
        is_wine = classification in WINE_CLASSIFICATIONS

        # 1. Grape variety (wines only, empty field only)
        if is_wine and not (p.get("grape_variety") or "").strip():
            grape = extract_grapes(name)
            if grape:
                patch["grape_variety"] = grape
                stats["grape"] += 1

        # 2. Vintage cleanup
        vintage_result = extract_vintage(name, p.get("vintage"))
        if vintage_result:
            patch["vintage"] = vintage_result
            stats["vintage"] += 1

        # 3. Brand (empty only)
        if not (p.get("brand") or "").strip():
            brand = extract_brand(name, known_brands)
            if brand:
                patch["brand"] = brand
                stats["brand"] += 1

        # 4. Region (wines only, empty only)
        if is_wine and not (p.get("region") or "").strip():
            region = extract_region(name, p.get("country"))
            if region:
                patch["region"] = region
                stats["region"] += 1

        if patch:
            updates.append((sku, patch))
            stats["products_with_updates"] += 1

        if (i + 1) % 500 == 0:
            print(f"Processed {i+1}/{len(products)} products, "
                  f"found {stats['grape']} grapes, {stats['vintage']} vintages, "
                  f"{stats['brand']} brands, {stats['region']} regions", flush=True)

    print(flush=True)
    print(f"=== Extraction Complete ===", flush=True)
    print(f"Products processed: {len(products)}", flush=True)
    print(f"Products with updates: {stats['products_with_updates']}", flush=True)
    print(f"  Grape varieties found: {stats['grape']}", flush=True)
    print(f"  Vintages cleaned/found: {stats['vintage']}", flush=True)
    print(f"  Brands matched: {stats['brand']}", flush=True)
    print(f"  Regions filled: {stats['region']}", flush=True)
    print(flush=True)

    # --- Sample updates ---
    if updates:
        print("=== Sample Updates (first 10) ===", flush=True)
        for sku, patch in updates[:10]:
            name_preview = next((p["name"] for p in products if p["sku"] == sku), "?")
            print(f"  {sku}: {patch}", flush=True)
            print(f"    name: {name_preview[:80]}", flush=True)
        print(flush=True)

    if args.dry_run:
        print("DRY RUN — no changes written.", flush=True)
        return

    # --- PATCH to Supabase ---
    print(f"Writing {len(updates)} updates to Supabase in batches of 50...", flush=True)
    success = 0
    fail = 0
    for i in range(0, len(updates), 50):
        batch = updates[i:i+50]
        for sku, patch in batch:
            if sb_patch(sku, patch):
                success += 1
            else:
                fail += 1
        print(f"  Patched {min(i+50, len(updates))}/{len(updates)} "
              f"(success={success}, fail={fail})", flush=True)

    print(flush=True)
    print(f"=== DONE ===", flush=True)
    print(f"Successfully patched: {success}", flush=True)
    print(f"Failed: {fail}", flush=True)


if __name__ == "__main__":
    main()
