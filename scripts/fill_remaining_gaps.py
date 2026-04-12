#!/usr/bin/env python3
"""
fill_remaining_gaps.py — Fill remaining P2 gaps across ALL tiers.

Targets:
  - bottle_size   (~4,310 missing) — parse from name + classification defaults
  - style         (~4,358 missing) — spirit/beer/sake/wine style inference
  - region        (~3,667 missing) — brand→most_common_region from existing data
  - grape_variety (~5,219 missing) — region/appellation/country defaults

Usage:
  python3 scripts/fill_remaining_gaps.py --dry-run
  python3 scripts/fill_remaining_gaps.py               # live write
"""

from __future__ import annotations
import argparse
import json
import re
import sys
import urllib.parse
from collections import Counter, defaultdict
from urllib import request, error as urlerror

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "https://xfcvliyxxguhihehqwkg.supabase.co"
API_KEY  = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
HEADERS  = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}

WINE_TYPES = {
    "Red Wine", "White Wine", "Rose Wine", "Sparkling Wine",
    "Champagne", "Dessert Wine", "Orange Wine", "Port Wine", "Fruit Wine",
}

SPIRIT_TYPES = {
    "Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Mezcal",
    "Brandy", "Cognac", "Liqueur", "Aperitif", "Vermouth", "Absinthe",
    "Spirits", "Baijiu", "Shochu", "Soju", "Grappa", "Pisco",
    "Bitters", "Amaro",
}

BEER_TYPES = {"Beer", "Cider", "Hard Seltzer", "Ready to Drink", "RTD"}

BEVERAGE_TYPES = WINE_TYPES | SPIRIT_TYPES | BEER_TYPES | {"Sake"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def fetch_all(path: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        url = f"{BASE_URL}/rest/v1/{path}&limit=1000&offset={offset}"
        req = request.Request(url, headers=HEADERS)
        with request.urlopen(req) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000:
                break
            offset += 1000
    return rows


def patch(sku: str, data: dict):
    encoded_sku = urllib.parse.quote(sku, safe="")
    url = f"{BASE_URL}/rest/v1/products?sku=eq.{encoded_sku}"
    body = json.dumps(data).encode()
    req = request.Request(
        url, data=body,
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH",
    )
    with request.urlopen(req) as r:
        pass


def safe(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(v)
    return str(v).strip()


def name_lower(p: dict) -> str:
    return (p.get("name") or "").lower()

# ============================================================================
# 1. BOTTLE SIZE
# ============================================================================
# Regex patterns for size extraction from product name
SIZE_PATTERNS = [
    # Parenthesized: (750 ml), (1.5 L), (700ml)
    re.compile(r"\((\d+(?:\.\d+)?)\s*(ml|mL|l|L|cl|CL)\)", re.I),
    # Non-parenthesized trailing: 750ml, 700 ml, 1.5L, 1.5 L
    re.compile(r"(?:^|\s)(\d+(?:\.\d+)?)\s*(ml|mL|l|L|cl|CL)(?:\s|$|[,\)])", re.I),
]

def normalize_size(amount_str: str, unit: str) -> str:
    """Normalize to 'X ml' or 'X L' format."""
    amount = float(amount_str)
    unit_low = unit.lower()

    if unit_low == "cl":
        # Convert cl to ml
        amount = amount * 10
        unit_low = "ml"

    if unit_low == "l":
        # If it's a whole liter value >= 1, keep as L
        if amount >= 1:
            if amount == int(amount):
                return f"{int(amount)} L"
            return f"{amount} L"
        else:
            # Convert to ml
            amount = amount * 1000
            unit_low = "ml"

    # ml
    amount_int = int(amount)
    return f"{amount_int} ml"


def extract_bottle_size(p: dict) -> str | None:
    name = p.get("name") or ""
    for pat in SIZE_PATTERNS:
        m = pat.search(name)
        if m:
            return normalize_size(m.group(1), m.group(2))
    return None


def default_bottle_size(p: dict) -> str:
    """Default size by classification."""
    cls = safe(p.get("classification"))
    if cls in WINE_TYPES or "Wine" in cls:
        return "750 ml"
    if cls in ("Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Mezcal",
               "Brandy", "Cognac", "Liqueur", "Aperitif", "Vermouth", "Absinthe",
               "Spirits", "Baijiu", "Shochu", "Soju", "Grappa", "Pisco",
               "Bitters", "Amaro"):
        return "700 ml"
    if cls in ("Beer", "Cider", "Hard Seltzer", "Ready to Drink", "RTD"):
        return "330 ml"
    if cls in ("Sake",):
        return "720 ml"
    # For anything spirits-like in the name
    name_l = name_lower(p)
    if any(w in name_l for w in ("whisky", "whiskey", "gin", "vodka", "rum",
                                  "tequila", "brandy", "cognac", "liqueur")):
        return "700 ml"
    if any(w in name_l for w in ("beer", "lager", "ale", "stout", "ipa")):
        return "330 ml"
    if "sake" in name_l:
        return "720 ml"
    return "750 ml"  # fallback


# ============================================================================
# 2. STYLE INFERENCE
# ============================================================================
def infer_style(p: dict) -> str | None:
    cls = safe(p.get("classification"))
    name = (p.get("name") or "")
    nl = name.lower()
    brand = safe(p.get("brand")).lower()
    country = safe(p.get("country"))

    # --- WHISKY ---
    if cls in ("Whisky", "Whiskey") or "whisky" in nl or "whiskey" in nl:
        if "bourbon" in nl:
            return "Bourbon"
        if "rye whiskey" in nl or "rye whisky" in nl:
            return "Rye Whiskey"
        if "single malt" in nl:
            if country == "Japan":
                return "Japanese Single Malt Whisky"
            if country == "Scotland":
                return "Scotch Single Malt Whisky"
            return "Single Malt Whisky"
        if "blended malt" in nl:
            return "Blended Malt Whisky"
        if "blended" in nl and country == "Scotland":
            return "Blended Scotch Whisky"
        if "blended" in nl:
            return "Blended Whisky"
        # Country default
        if country == "Scotland":
            return "Scotch Whisky"
        if country == "Japan":
            return "Japanese Whisky"
        if country == "Ireland":
            return "Irish Whiskey"
        if country in ("USA", "United States"):
            return "American Whiskey"
        if country == "Taiwan":
            return "Taiwanese Whisky"
        if country == "India":
            return "Indian Whisky"
        if country == "Canada":
            return "Canadian Whisky"
        return "Whisky"

    # --- GIN ---
    if cls == "Gin" or ("gin" in nl.split() and cls not in WINE_TYPES):
        if "navy strength" in nl:
            return "Navy Strength Gin"
        if "old tom" in nl:
            return "Old Tom Gin"
        if "sloe" in nl:
            return "Sloe Gin"
        if "genever" in nl or "jenever" in nl:
            return "Genever"
        if any(w in nl for w in ("pink", "strawberry", "raspberry", "citrus",
                                   "cucumber", "elderflower", "botanical",
                                   "flavoured", "flavored")):
            return "Flavored Gin"
        return "Dry Gin"

    # --- VODKA ---
    if cls == "Vodka" or "vodka" in nl:
        flavor_words = ("vanilla", "citrus", "lemon", "lime", "orange",
                        "berry", "raspberry", "strawberry", "mango",
                        "peach", "apple", "grape", "cherry", "watermelon",
                        "coconut", "pineapple", "passion", "ginger",
                        "espresso", "coffee", "chocolate", "caramel",
                        "honey", "pepper", "chili", "cucumber",
                        "cranberry", "blueberry", "pomegranate")
        if any(w in nl for w in flavor_words):
            return "Flavored Vodka"
        return "Plain Vodka"

    # --- RUM ---
    if cls == "Rum" or "rum" in nl.split():
        if any(w in nl for w in ("white", "silver", "light", "blanco")):
            return "White Rum"
        if "dark" in nl:
            return "Dark Rum"
        if "spiced" in nl:
            return "Spiced Rum"
        if any(w in nl for w in ("aged", "añejo", "anejo", "reserva", "old",
                                   "year", "yr", "años")):
            return "Aged Rum"
        if "overproof" in nl:
            return "Overproof Rum"
        if "gold" in nl:
            return "Gold Rum"
        return "Rum"

    # --- TEQUILA ---
    if cls in ("Tequila", "Mezcal") or "tequila" in nl or "mezcal" in nl:
        if "mezcal" in nl and cls != "Tequila":
            if "reposado" in nl:
                return "Mezcal Reposado"
            if "añejo" in nl or "anejo" in nl:
                return "Mezcal Añejo"
            return "Mezcal Joven"
        if "extra añejo" in nl or "extra anejo" in nl:
            return "Tequila Extra Añejo"
        if "añejo" in nl or "anejo" in nl:
            return "Tequila Añejo"
        if "reposado" in nl:
            return "Tequila Reposado"
        if "blanco" in nl or "silver" in nl or "plata" in nl:
            return "Tequila Blanco"
        if "cristalino" in nl:
            return "Tequila Cristalino"
        return "Tequila Blanco"  # default for tequila

    # --- BRANDY / COGNAC ---
    if cls in ("Brandy", "Cognac") or "brandy" in nl or "cognac" in nl:
        if "cognac" in nl or cls == "Cognac":
            if "xo" in nl.split() or "x.o" in nl:
                return "Cognac XO"
            if "vsop" in nl or "v.s.o.p" in nl:
                return "Cognac VSOP"
            if "vs" in nl.split() or "v.s." in nl or "v.s " in nl:
                return "Cognac VS"
            if "napoleon" in nl:
                return "Cognac Napoleon"
            return "Cognac"
        if "armagnac" in nl:
            return "Armagnac"
        if "calvados" in nl:
            return "Calvados"
        if "pisco" in nl:
            return "Pisco"
        if "grappa" in nl:
            return "Grappa"
        return "Brandy"

    # --- ABSINTHE ---
    if cls == "Absinthe" or "absinthe" in nl or "absente" in nl:
        return "Absinthe"

    # --- LIQUEUR ---
    if cls == "Liqueur" or "liqueur" in nl:
        if any(w in nl for w in ("cream", "baileys", "amarula")):
            return "Cream Liqueur"
        if any(w in nl for w in ("coffee", "kahlua", "espresso", "tia maria")):
            return "Coffee Liqueur"
        if any(w in nl for w in ("chocolate", "cacao", "creme de cacao")):
            return "Chocolate Liqueur"
        if any(w in nl for w in ("orange", "triple sec", "cointreau", "curacao",
                                   "grand marnier", "limoncello", "lemon",
                                   "cherry", "peach", "raspberry", "strawberry",
                                   "mango", "passion fruit", "elderflower",
                                   "blackberry", "cassis", "apple", "pear",
                                   "melon", "banana", "coconut", "lychee",
                                   "midori", "fruit")):
            return "Fruit Liqueur"
        if any(w in nl for w in ("herbal", "chartreuse", "jagermeister",
                                   "jägermeister", "herb", "amaro",
                                   "fernet", "underberg", "becherovka")):
            return "Herbal Liqueur"
        if any(w in nl for w in ("nut", "amaretto", "hazelnut", "walnut",
                                   "frangelico", "nocino")):
            return "Nut Liqueur"
        if any(w in nl for w in ("anise", "sambuca", "ouzo", "pastis",
                                   "arak", "raki")):
            return "Anise Liqueur"
        return "Liqueur"

    # --- APERITIF / VERMOUTH / BITTERS ---
    if cls in ("Aperitif", "Vermouth", "Bitters", "Amaro"):
        if "vermouth" in nl:
            if any(w in nl for w in ("dry", "bianco", "blanc", "white")):
                return "Dry Vermouth"
            if any(w in nl for w in ("sweet", "rosso", "rouge", "red")):
                return "Sweet Vermouth"
            return "Vermouth"
        if "amaro" in nl or cls == "Amaro":
            return "Amaro"
        if "bitters" in nl or cls == "Bitters":
            return "Bitters"
        if any(w in nl for w in ("aperol", "campari", "spritz")):
            return "Aperitif"
        return "Aperitif"

    # --- BEER ---
    if cls == "Beer" or cls == "Cider":
        if "cider" in nl or cls == "Cider":
            return "Cider"
        if "ipa" in nl or "india pale ale" in nl:
            if "double" in nl or "imperial" in nl:
                return "Double IPA"
            if "session" in nl:
                return "Session IPA"
            if "hazy" in nl or "new england" in nl or "neipa" in nl:
                return "Hazy IPA"
            return "IPA"
        if "stout" in nl:
            if "imperial" in nl:
                return "Imperial Stout"
            if "milk" in nl or "sweet" in nl:
                return "Milk Stout"
            if "oatmeal" in nl:
                return "Oatmeal Stout"
            return "Stout"
        if "porter" in nl:
            return "Porter"
        if "pilsner" in nl or "pils" in nl:
            return "Pilsner"
        if "lager" in nl:
            return "Lager"
        if "wheat" in nl or "weizen" in nl or "hefeweizen" in nl or "wit" in nl:
            return "Wheat Beer"
        if "pale ale" in nl:
            return "Pale Ale"
        if "amber" in nl:
            return "Amber Ale"
        if "brown ale" in nl:
            return "Brown Ale"
        if "blonde" in nl or "golden" in nl:
            return "Blonde Ale"
        if "sour" in nl or "gose" in nl or "berliner" in nl:
            return "Sour Beer"
        if "saison" in nl or "farmhouse" in nl:
            return "Saison"
        if "ale" in nl.split():
            return "Ale"
        return "Lager"  # default for beer

    # --- SAKE ---
    if cls == "Sake" or "sake" in nl:
        if "daiginjo" in nl:
            if "junmai" in nl:
                return "Junmai Daiginjo"
            return "Daiginjo"
        if "ginjo" in nl:
            if "junmai" in nl:
                return "Junmai Ginjo"
            return "Ginjo"
        if "honjozo" in nl:
            return "Honjozo"
        if "junmai" in nl:
            return "Junmai"
        if "nigori" in nl:
            return "Nigori"
        if "sparkling" in nl:
            return "Sparkling Sake"
        if "nama" in nl:
            return "Nama Sake"
        return "Sake"

    # --- WINE styles (from body + color) ---
    if cls in WINE_TYPES:
        return infer_wine_style(p)

    # --- Catch-all for spirits-like things ---
    if cls == "Soju":
        return "Soju"
    if cls == "Shochu":
        return "Shochu"
    if cls == "Baijiu":
        return "Baijiu"

    return None


def infer_wine_style(p: dict) -> str | None:
    cls = safe(p.get("classification"))
    nl = name_lower(p)

    # Champagne
    if cls == "Champagne":
        if "brut nature" in nl or "zero dosage" in nl:
            return "Brut Nature Champagne"
        if "extra brut" in nl:
            return "Extra Brut Champagne"
        if "rosé" in nl or "rose" in nl:
            return "Rosé Champagne"
        if "blanc de blancs" in nl:
            return "Blanc de Blancs Champagne"
        if "blanc de noirs" in nl:
            return "Blanc de Noirs Champagne"
        return "Brut Champagne"

    # Sparkling
    if cls == "Sparkling Wine":
        if "prosecco" in nl:
            return "Prosecco"
        if "cava" in nl:
            return "Cava"
        if "crémant" in nl or "cremant" in nl:
            return "Crémant"
        if "asti" in nl or "moscato" in nl:
            return "Moscato d'Asti"
        if "brut" in nl:
            return "Brut Sparkling Wine"
        return "Sparkling Wine"

    # Dessert / Port
    if cls == "Dessert Wine":
        if "ice wine" in nl or "eiswein" in nl:
            return "Ice Wine"
        if "sauternes" in nl:
            return "Sauternes"
        if "tokaji" in nl:
            return "Tokaji"
        if "moscato" in nl or "muscat" in nl:
            return "Moscato"
        return "Dessert Wine"

    if cls == "Port Wine":
        if "tawny" in nl:
            return "Tawny Port"
        if "ruby" in nl:
            return "Ruby Port"
        if "vintage" in nl or "lbv" in nl:
            return "LBV Port"
        if "white" in nl:
            return "White Port"
        return "Port"

    # Rose
    if cls == "Rose Wine":
        return "Rosé"

    # Red / White — use wine_body if available
    body = p.get("wine_body")
    color = ""
    if cls == "Red Wine":
        color = "Red"
    elif cls == "White Wine":
        color = "White"
    elif cls == "Orange Wine":
        color = "Orange"

    if body is not None and body != "":
        try:
            body_val = int(body)
        except (ValueError, TypeError):
            body_val = None

        if body_val is not None:
            if body_val >= 4:
                weight = "Full-bodied"
            elif body_val == 3:
                weight = "Medium-bodied"
            else:
                weight = "Light-bodied"
            if color:
                return f"{weight} {color}"
            return weight

    # Fallback: medium-bodied
    if color:
        return f"Medium-bodied {color}"

    return None


# ============================================================================
# 3. REGION — Brand-based inference from existing data
# ============================================================================
def build_brand_region_map(all_products: list[dict]) -> dict[str, str]:
    """Build brand → most_common_region from products that have both."""
    brand_regions: dict[str, list[str]] = defaultdict(list)
    for p in all_products:
        brand = safe(p.get("brand"))
        region = safe(p.get("region"))
        if brand and region:
            brand_regions[brand].append(region)

    result = {}
    for brand, regions in brand_regions.items():
        counter = Counter(regions)
        most_common = counter.most_common(1)[0][0]
        result[brand] = most_common
    return result


# ============================================================================
# 4. GRAPE VARIETY — Extended region/appellation/country defaults
# ============================================================================

# Classification + Region → default grape (extended)
REGION_GRAPE = {
    # France
    ("Red Wine", "Burgundy"): "Pinot Noir",
    ("White Wine", "Burgundy"): "Chardonnay",
    ("Red Wine", "Beaujolais"): "Gamay",
    ("Red Wine", "Bordeaux"): "Cabernet Sauvignon, Merlot",
    ("White Wine", "Bordeaux"): "Sauvignon Blanc, Semillon",
    ("Red Wine", "Rhône Valley"): "Syrah, Grenache",
    ("Red Wine", "Rhone Valley"): "Syrah, Grenache",
    ("White Wine", "Rhône Valley"): "Viognier",
    ("White Wine", "Rhone Valley"): "Viognier",
    ("Red Wine", "Languedoc"): "Grenache, Syrah",
    ("White Wine", "Languedoc"): "Chardonnay, Viognier",
    ("Red Wine", "Loire"): "Cabernet Franc",
    ("White Wine", "Loire"): "Sauvignon Blanc",
    ("White Wine", "Alsace"): "Riesling",
    ("Red Wine", "Provence"): "Grenache, Syrah",
    ("Rose Wine", "Provence"): "Grenache, Cinsault",
    ("Red Wine", "Southwest France"): "Malbec, Tannat",
    ("Champagne", "Champagne"): "Chardonnay, Pinot Noir, Pinot Meunier",

    # Italy
    ("Red Wine", "Tuscany"): "Sangiovese",
    ("White Wine", "Tuscany"): "Vernaccia, Trebbiano",
    ("Red Wine", "Piedmont"): "Nebbiolo",
    ("White Wine", "Piedmont"): "Cortese",
    ("Red Wine", "Veneto"): "Corvina",
    ("White Wine", "Veneto"): "Garganega",
    ("Red Wine", "Puglia"): "Primitivo",
    ("White Wine", "Puglia"): "Fiano",
    ("Red Wine", "Sicily"): "Nero d'Avola",
    ("White Wine", "Sicily"): "Grillo",
    ("Red Wine", "Abruzzo"): "Montepulciano",
    ("White Wine", "Abruzzo"): "Trebbiano d'Abruzzo",
    ("Red Wine", "Campania"): "Aglianico",
    ("White Wine", "Campania"): "Falanghina",
    ("White Wine", "Alto Adige"): "Pinot Grigio",
    ("Red Wine", "Alto Adige"): "Lagrein",
    ("White Wine", "Friuli"): "Pinot Grigio",
    ("Red Wine", "Lombardy"): "Nebbiolo",
    ("Sparkling Wine", "Veneto"): "Glera",
    ("Sparkling Wine", "Lombardy"): "Chardonnay, Pinot Noir",
    ("Red Wine", "Sardinia"): "Cannonau",
    ("White Wine", "Sardinia"): "Vermentino",
    ("Red Wine", "Umbria"): "Sagrantino",
    ("White Wine", "Umbria"): "Grechetto",
    ("Red Wine", "Emilia-Romagna"): "Sangiovese",
    ("Sparkling Wine", "Emilia-Romagna"): "Lambrusco",

    # Spain
    ("Red Wine", "Rioja"): "Tempranillo",
    ("White Wine", "Rioja"): "Viura",
    ("Red Wine", "Ribera del Duero"): "Tempranillo",
    ("Red Wine", "Priorat"): "Garnacha, Cariñena",
    ("White Wine", "Rías Baixas"): "Albariño",
    ("White Wine", "Rueda"): "Verdejo",
    ("Red Wine", "Castilla-La Mancha"): "Tempranillo",
    ("Sparkling Wine", "Penedès"): "Macabeo, Xarel·lo, Parellada",
    ("Red Wine", "Navarra"): "Garnacha",
    ("Red Wine", "Jumilla"): "Monastrell",
    ("Red Wine", "Toro"): "Tinta de Toro",

    # Portugal
    ("Red Wine", "Douro"): "Touriga Nacional",
    ("Red Wine", "Alentejo"): "Aragonez, Trincadeira",
    ("White Wine", "Vinho Verde"): "Alvarinho, Loureiro",
    ("Dessert Wine", "Douro"): "Touriga Nacional, Touriga Franca",

    # Germany / Austria
    ("White Wine", "Mosel"): "Riesling",
    ("White Wine", "Rheingau"): "Riesling",
    ("White Wine", "Rheinhessen"): "Riesling",
    ("White Wine", "Pfalz"): "Riesling",
    ("White Wine", "Kamptal"): "Grüner Veltliner",
    ("White Wine", "Wachau"): "Grüner Veltliner",

    # Argentina
    ("Red Wine", "Mendoza"): "Malbec",
    ("Red Wine", "Salta"): "Malbec",
    ("White Wine", "Mendoza"): "Torrontés",

    # Chile
    ("Red Wine", "Central Valley"): "Cabernet Sauvignon",
    ("Red Wine", "Maipo Valley"): "Cabernet Sauvignon",
    ("Red Wine", "Colchagua"): "Cabernet Sauvignon",
    ("Red Wine", "Rapel Valley"): "Cabernet Sauvignon",
    ("White Wine", "Casablanca"): "Sauvignon Blanc",
    ("White Wine", "Central Valley"): "Sauvignon Blanc",
    ("Red Wine", "Aconcagua"): "Cabernet Sauvignon",

    # Australia
    ("Red Wine", "Barossa"): "Shiraz",
    ("Red Wine", "Barossa Valley"): "Shiraz",
    ("Red Wine", "McLaren Vale"): "Shiraz",
    ("Red Wine", "Coonawarra"): "Cabernet Sauvignon",
    ("White Wine", "Margaret River"): "Chardonnay",
    ("Red Wine", "Margaret River"): "Cabernet Sauvignon",
    ("Red Wine", "South Eastern Australia"): "Shiraz",
    ("White Wine", "South Eastern Australia"): "Chardonnay",
    ("Red Wine", "Hunter Valley"): "Shiraz",
    ("White Wine", "Hunter Valley"): "Semillon",
    ("White Wine", "Adelaide Hills"): "Sauvignon Blanc",
    ("White Wine", "Eden Valley"): "Riesling",
    ("White Wine", "Clare Valley"): "Riesling",

    # New Zealand
    ("White Wine", "Marlborough"): "Sauvignon Blanc",
    ("Red Wine", "Central Otago"): "Pinot Noir",
    ("Red Wine", "Hawke's Bay"): "Merlot, Cabernet Sauvignon",
    ("White Wine", "Hawke's Bay"): "Chardonnay",

    # South Africa
    ("Red Wine", "Stellenbosch"): "Cabernet Sauvignon",
    ("Red Wine", "Western Cape"): "Pinotage",
    ("White Wine", "Western Cape"): "Chenin Blanc",
    ("Red Wine", "Paarl"): "Shiraz",
    ("White Wine", "Constantia"): "Sauvignon Blanc",

    # USA
    ("Red Wine", "Napa"): "Cabernet Sauvignon",
    ("Red Wine", "Napa Valley"): "Cabernet Sauvignon",
    ("White Wine", "Napa"): "Chardonnay",
    ("Red Wine", "Sonoma"): "Pinot Noir",
    ("White Wine", "Sonoma"): "Chardonnay",
    ("Red Wine", "California"): "Cabernet Sauvignon",
    ("White Wine", "California"): "Chardonnay",
    ("Red Wine", "Willamette Valley"): "Pinot Noir",
    ("Red Wine", "Oregon"): "Pinot Noir",
    ("Red Wine", "Washington"): "Cabernet Sauvignon",

    # Other
    ("Red Wine", "Khao Yai"): "Shiraz",
    ("White Wine", "Khao Yai"): "Chenin Blanc",
    ("Red Wine", "Canelones"): "Tannat",
    ("Red Wine", "Baja California"): "Tempranillo, Cabernet Sauvignon",
    ("Red Wine", "Ica"): "Tannat",
    ("Red Wine", "Macedonia"): "Xinomavro",
    ("White Wine", "Macedonia"): "Assyrtiko",
}

# Country → default grape for wine (fallback)
COUNTRY_GRAPE = {
    ("Red Wine", "France"): "Cabernet Sauvignon, Merlot",
    ("White Wine", "France"): "Chardonnay",
    ("Red Wine", "Italy"): "Sangiovese",
    ("White Wine", "Italy"): "Pinot Grigio",
    ("Red Wine", "Spain"): "Tempranillo",
    ("White Wine", "Spain"): "Verdejo",
    ("Red Wine", "Argentina"): "Malbec",
    ("White Wine", "Argentina"): "Torrontés",
    ("Red Wine", "Chile"): "Cabernet Sauvignon",
    ("White Wine", "Chile"): "Sauvignon Blanc",
    ("Red Wine", "Australia"): "Shiraz",
    ("White Wine", "Australia"): "Chardonnay",
    ("Red Wine", "New Zealand"): "Pinot Noir",
    ("White Wine", "New Zealand"): "Sauvignon Blanc",
    ("Red Wine", "South Africa"): "Pinotage",
    ("White Wine", "South Africa"): "Chenin Blanc",
    ("Red Wine", "USA"): "Cabernet Sauvignon",
    ("White Wine", "USA"): "Chardonnay",
    ("Red Wine", "United States"): "Cabernet Sauvignon",
    ("White Wine", "United States"): "Chardonnay",
    ("Red Wine", "Portugal"): "Touriga Nacional",
    ("White Wine", "Portugal"): "Alvarinho",
    ("Red Wine", "Germany"): "Spätburgunder",
    ("White Wine", "Germany"): "Riesling",
    ("Red Wine", "Austria"): "Zweigelt",
    ("White Wine", "Austria"): "Grüner Veltliner",
    ("Red Wine", "Greece"): "Xinomavro",
    ("White Wine", "Greece"): "Assyrtiko",
    ("Red Wine", "Thailand"): "Shiraz",
    ("White Wine", "Thailand"): "Chenin Blanc",
    ("Red Wine", "Uruguay"): "Tannat",
    ("Red Wine", "Lebanon"): "Cinsault, Cabernet Sauvignon",
    ("White Wine", "Lebanon"): "Viognier, Chardonnay",
    ("Red Wine", "Mexico"): "Cabernet Sauvignon",
    ("Red Wine", "Peru"): "Tannat",
    ("Champagne", "France"): "Chardonnay, Pinot Noir, Pinot Meunier",
    ("Sparkling Wine", "France"): "Chardonnay, Pinot Noir",
    ("Sparkling Wine", "Italy"): "Glera",
    ("Sparkling Wine", "Spain"): "Macabeo, Xarel·lo, Parellada",
    ("Rose Wine", "France"): "Grenache, Cinsault",
    ("Rose Wine", "Italy"): "Sangiovese",
    ("Rose Wine", "Spain"): "Garnacha",
}


# ============================================================================
# MAIN
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description="Fill remaining P2 gaps across all tiers")
    parser.add_argument("--dry-run", action="store_true", help="Show counts without writing")
    args = parser.parse_args()

    # Fetch ALL products (all tiers)
    select = ("sku,name,classification,country,region,brand,grape_variety,style,"
              "bottle_size,wine_body,appellation,enrichment_priority")
    query = f"products?is_primary_variant=eq.true&select={select}&order=sku.asc"

    print("Fetching ALL products...", flush=True)
    products = fetch_all(query)
    print(f"  Total products: {len(products)}", flush=True)

    # Pre-compute missing counts
    missing = {
        "bottle_size": sum(1 for p in products if not safe(p.get("bottle_size"))),
        "style": sum(1 for p in products if not safe(p.get("style"))),
        "region": sum(1 for p in products if not safe(p.get("region"))),
        "grape_variety": sum(1 for p in products if not safe(p.get("grape_variety"))),
    }
    print(f"\nMissing BEFORE:", flush=True)
    for k, v in missing.items():
        print(f"  {k:20s}: {v:,}", flush=True)

    # Build brand→region map from all existing data
    print("\nBuilding brand→region map from existing data...", flush=True)
    brand_region_map = build_brand_region_map(products)
    print(f"  Mapped {len(brand_region_map)} brands to regions", flush=True)

    # Process each product
    updates: dict[str, dict] = {}  # sku → {field: value}
    counters = defaultdict(int)

    for p in products:
        sku = p["sku"]
        patch_data: dict[str, str] = {}

        cls = safe(p.get("classification"))
        brand = safe(p.get("brand"))
        country = safe(p.get("country"))
        region = safe(p.get("region"))
        grape = safe(p.get("grape_variety"))
        style = safe(p.get("style"))
        bottle_size = safe(p.get("bottle_size"))
        appellation = safe(p.get("appellation"))

        # --- 1. BOTTLE SIZE (beverages only) ---
        if not bottle_size and cls in BEVERAGE_TYPES:
            extracted = extract_bottle_size(p)
            if extracted:
                patch_data["bottle_size"] = extracted
                counters["bottle_size_extracted"] += 1
            else:
                patch_data["bottle_size"] = default_bottle_size(p)
                counters["bottle_size_defaulted"] += 1

        # --- 2. STYLE (beverages only) ---
        if not style and cls in BEVERAGE_TYPES:
            inferred = infer_style(p)
            if inferred:
                patch_data["style"] = inferred
                counters["style"] += 1

        # --- 3. REGION (brand-based, beverages only) ---
        if not region and cls in BEVERAGE_TYPES:
            if brand and brand in brand_region_map:
                patch_data["region"] = brand_region_map[brand]
                counters["region_brand"] += 1
                region = patch_data["region"]  # use for grape lookup

        # --- 4. GRAPE VARIETY ---
        if not grape and cls in WINE_TYPES:
            # Try region-based first
            effective_region = region or safe(patch_data.get("region", ""))
            key = (cls, effective_region)
            if key in REGION_GRAPE:
                patch_data["grape_variety"] = REGION_GRAPE[key]
                counters["grape_region"] += 1
            else:
                # Try country-based
                ckey = (cls, country)
                if ckey in COUNTRY_GRAPE:
                    patch_data["grape_variety"] = COUNTRY_GRAPE[ckey]
                    counters["grape_country"] += 1

        if patch_data:
            updates[sku] = patch_data

    # Summary
    total_fields = sum(len(v) for v in updates.values())
    print(f"\n--- FILL PLAN ---", flush=True)
    print(f"Products to update: {len(updates):,}", flush=True)
    print(f"Total field updates: {total_fields:,}", flush=True)
    print(f"\nBreakdown:", flush=True)
    print(f"  bottle_size (extracted):  {counters['bottle_size_extracted']:,}", flush=True)
    print(f"  bottle_size (defaulted):  {counters['bottle_size_defaulted']:,}", flush=True)
    print(f"  bottle_size TOTAL:        {counters['bottle_size_extracted'] + counters['bottle_size_defaulted']:,}", flush=True)
    print(f"  style:                    {counters['style']:,}", flush=True)
    print(f"  region (brand-based):     {counters['region_brand']:,}", flush=True)
    print(f"  grape_variety (region):   {counters['grape_region']:,}", flush=True)
    print(f"  grape_variety (country):  {counters['grape_country']:,}", flush=True)
    print(f"  grape_variety TOTAL:      {counters['grape_region'] + counters['grape_country']:,}", flush=True)

    if args.dry_run:
        # Show samples for each field
        samples = defaultdict(list)
        for sku, data in updates.items():
            for field in data:
                if len(samples[field]) < 5:
                    p = next((x for x in products if x["sku"] == sku), None)
                    name = (p["name"][:50] if p else "?")
                    samples[field].append(f"    {sku:25s} {name:52s} -> {data[field]}")

        for field, lines in sorted(samples.items()):
            print(f"\n  Samples — {field}:", flush=True)
            for line in lines:
                print(line, flush=True)

        print(f"\n[DRY RUN] No changes written.", flush=True)
        return

    # --- Live write ---
    patched = 0
    failed = 0
    items = list(updates.items())
    total = len(items)

    for i in range(0, total, 50):
        batch = items[i:i + 50]
        for sku, data in batch:
            try:
                patch(sku, data)
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        done = i + len(batch)
        pct = done / total * 100
        print(f"  Patched {patched:,}/{total:,} ({pct:.0f}%) [failed: {failed}]", flush=True)

    print(f"\nDone: {patched:,} patched, {failed} failed", flush=True)

    # --- Final coverage report ---
    print(f"\n{'='*60}", flush=True)
    print(f"FINAL COVERAGE REPORT", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"Re-fetching to verify...", flush=True)

    all_after = fetch_all(f"products?is_primary_variant=eq.true&select={select}&order=sku.asc")
    total_count = len(all_after)

    for field in ("bottle_size", "style", "region", "grape_variety"):
        filled = sum(1 for p in all_after if safe(p.get(field)))
        pct = filled / total_count * 100 if total_count else 0
        still_missing = total_count - filled
        print(f"  {field:20s}: {filled:,}/{total_count:,} ({pct:.1f}%)  — {still_missing:,} still missing", flush=True)


if __name__ == "__main__":
    main()
