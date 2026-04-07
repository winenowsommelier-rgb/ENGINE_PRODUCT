#!/usr/bin/env python3
"""
extract_fields_pass2.py — Second-pass field extraction with smarter strategies.

Fills gaps left by pass 1 using:
  1. Classification+region-based grape defaults
  2. Description mining for grapes and regions
  3. Spirits style extraction
  4. Description mining for brands

Usage:
  python3 scripts/extract_fields_pass2.py --dry-run
  python3 scripts/extract_fields_pass2.py --dry-run --tier=1
  python3 scripts/extract_fields_pass2.py --tier=0          # all tiers, live write
"""

from __future__ import annotations
import argparse
import json
import re
import sys
import urllib.parse
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

SPIRITS_CLASSIFICATIONS = {
    "whisky", "whiskey", "scotch", "bourbon",
    "gin", "vodka", "rum", "tequila", "mezcal",
    "brandy", "cognac", "armagnac",
    "liqueur", "liquor", "spirit", "spirits",
}

# ---------------------------------------------------------------------------
# Grape Variety Dictionary (from pass 1)
# ---------------------------------------------------------------------------
_GRAPE_RAW = {
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
    "Counoise": ["counoise"],
    "Vaccarèse": ["vaccarèse", "vaccarese"],
    "Fer Servadou": ["fer servadou"],
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
    "Pinot Meunier": ["pinot meunier", "meunier"],
}

GRAPE_LOOKUP: dict[str, str] = {}
for canonical, aliases in _GRAPE_RAW.items():
    for alias in aliases:
        GRAPE_LOOKUP[alias.lower()] = canonical
    GRAPE_LOOKUP[canonical.lower()] = canonical

GRAPE_PATTERNS: list[tuple[re.Pattern, str]] = []
for alias in sorted(GRAPE_LOOKUP.keys(), key=len, reverse=True):
    canonical = GRAPE_LOOKUP[alias]
    pat = re.compile(r'\b' + re.escape(alias) + r'\b', re.IGNORECASE)
    GRAPE_PATTERNS.append((pat, canonical))


# ---------------------------------------------------------------------------
# Classification-Based Grape Defaults (the core of pass 2)
# ---------------------------------------------------------------------------
# Each rule: (classification_contains, region_or_name_match, grape_default)
# Rules are checked in order; first match wins.

def _grape_from_classification(classification: str, region: str, country: str,
                               name: str) -> str | None:
    """Infer grape variety from classification + region + country + name combos."""
    cl = classification.lower()
    rg = (region or "").lower()
    ct = (country or "").lower()
    nm = name.lower()

    # Champagne
    if "champagne" in cl or ("sparkling" in cl and "champagne" in rg):
        return "Chardonnay, Pinot Noir, Pinot Meunier"

    # Prosecco
    if "sparkling" in cl and ("italy" in ct or "italia" in ct) and "prosecco" in nm:
        return "Glera"

    # Cava
    if "sparkling" in cl and ("spain" in ct or "españa" in ct) and "cava" in nm:
        return "Macabeo, Xarel·lo, Parellada"

    # Port Wine
    if "port" in cl:
        return "Touriga Nacional, Touriga Franca, Tinta Roriz"

    is_red = "red" in cl
    is_white = "white" in cl

    # Burgundy
    if is_red and any(x in rg for x in ["burgundy", "bourgogne"]):
        return "Pinot Noir"
    if is_white and any(x in rg for x in ["burgundy", "bourgogne"]):
        return "Chardonnay"

    # Chablis
    if is_white and ("chablis" in rg or "chablis" in nm):
        return "Chardonnay"

    # Beaujolais
    if is_red and ("beaujolais" in rg or "beaujolais" in nm):
        return "Gamay"

    # Piedmont — Barolo / Barbaresco
    if is_red and any(x in rg for x in ["piedmont", "piemonte", "barolo", "barbaresco"]):
        if any(x in nm for x in ["barolo", "barbaresco"]):
            return "Nebbiolo"

    # Tuscany — Chianti / Brunello
    if is_red and any(x in rg for x in ["tuscany", "toscana", "chianti", "brunello"]):
        if any(x in nm for x in ["chianti", "brunello"]):
            return "Sangiovese"

    # Rioja
    if is_red and ("rioja" in rg or "rioja" in nm):
        return "Tempranillo"

    # Bordeaux Left Bank
    left_bank = ["médoc", "medoc", "pauillac", "margaux", "saint-julien",
                 "saint-estèphe", "saint-estephe", "haut-médoc", "haut-medoc",
                 "pessac-léognan", "pessac-leognan", "graves"]
    if is_red and ("bordeaux" in rg or "bordeaux" in nm):
        if any(x in nm for x in left_bank) or any(x in rg for x in left_bank):
            return "Cabernet Sauvignon, Merlot"

    # Bordeaux Right Bank
    right_bank = ["saint-émilion", "saint-emilion", "pomerol"]
    if is_red and ("bordeaux" in rg or "bordeaux" in nm):
        if any(x in nm for x in right_bank) or any(x in rg for x in right_bank):
            return "Merlot, Cabernet Franc"

    # Generic Bordeaux red (no specific bank identified)
    if is_red and ("bordeaux" in rg or "bordeaux" in nm):
        return "Cabernet Sauvignon, Merlot"

    # Sancerre / Pouilly-Fumé
    if is_white and any(x in rg or x in nm for x in ["sancerre", "pouilly-fumé", "pouilly-fume", "pouilly fume"]):
        return "Sauvignon Blanc"

    # Muscadet
    if is_white and ("muscadet" in rg or "muscadet" in nm):
        return "Melon de Bourgogne"

    # Côtes du Rhône / Châteauneuf
    if is_red and any(x in rg or x in nm for x in ["côtes du rhône", "cotes du rhone",
                                                     "châteauneuf", "chateauneuf",
                                                     "rhône valley", "rhone valley"]):
        return "Grenache, Syrah, Mourvèdre"

    # Alsace — check name for specific grapes
    if "alsace" in rg or "alsace" in nm:
        if "riesling" in nm:
            return "Riesling"
        if "gewurztraminer" in nm or "gewürztraminer" in nm:
            return "Gewürztraminer"
        if "pinot gris" in nm or "pinot grigio" in nm:
            return "Pinot Grigio"
        if "muscat" in nm or "moscato" in nm:
            return "Muscat"
        if is_white:
            return "Riesling"  # most common Alsace white default

    # Mendoza red
    if is_red and ("mendoza" in rg or "mendoza" in nm):
        return "Malbec"

    # Napa red
    if is_red and ("napa" in rg or "napa" in nm):
        return "Cabernet Sauvignon"

    return None


# ---------------------------------------------------------------------------
# Description-based grape extraction
# ---------------------------------------------------------------------------
def extract_grapes_from_text(text: str) -> str | None:
    """Scan a text block for grape variety mentions."""
    if not text:
        return None
    found: dict[str, int] = {}
    for pat, canonical in GRAPE_PATTERNS:
        m = pat.search(text)
        if m and canonical not in found:
            found[canonical] = m.start()
    if not found:
        return None
    sorted_grapes = sorted(found.items(), key=lambda x: x[1])
    return ", ".join(g[0] for g in sorted_grapes)


# ---------------------------------------------------------------------------
# Region Mapping — expanded for pass 2
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
    ("France", "Pouilly Fume", "Loire Valley"),
    ("France", "Pouilly-Fuisse", "Burgundy"),
    ("France", "Pouilly-Fuissé", "Burgundy"),
    ("France", "Saint-Émilion", "Bordeaux"),
    ("France", "Saint-Emilion", "Bordeaux"),
    ("France", "Saint Emilion", "Bordeaux"),
    ("France", "Pauillac", "Bordeaux"),
    ("France", "Margaux", "Bordeaux"),
    ("France", "Médoc", "Bordeaux"),
    ("France", "Medoc", "Bordeaux"),
    ("France", "Haut-Médoc", "Bordeaux"),
    ("France", "Haut-Medoc", "Bordeaux"),
    ("France", "Saint-Julien", "Bordeaux"),
    ("France", "Saint-Estèphe", "Bordeaux"),
    ("France", "Saint-Estephe", "Bordeaux"),
    ("France", "Pomerol", "Bordeaux"),
    ("France", "Graves", "Bordeaux"),
    ("France", "Pessac-Léognan", "Bordeaux"),
    ("France", "Pessac-Leognan", "Bordeaux"),
    ("France", "Sauternes", "Bordeaux"),
    ("France", "Châteauneuf-du-Pape", "Rhône Valley"),
    ("France", "Chateauneuf-du-Pape", "Rhône Valley"),
    ("France", "Gigondas", "Rhône Valley"),
    ("France", "Hermitage", "Rhône Valley"),
    ("France", "Cornas", "Rhône Valley"),
    ("France", "Condrieu", "Rhône Valley"),
    ("France", "Crozes-Hermitage", "Rhône Valley"),
    ("France", "Côte-Rôtie", "Rhône Valley"),
    ("France", "Cote-Rotie", "Rhône Valley"),
    ("France", "Cahors", "South West France"),
    ("France", "Madiran", "South West France"),
    ("France", "Jurançon", "South West France"),
    ("France", "Jurancon", "South West France"),
    ("France", "Bandol", "Provence"),
    ("France", "Côtes de Provence", "Provence"),
    ("France", "Cotes de Provence", "Provence"),
    ("France", "Jura", "Jura"),
    ("France", "Corsica", "Corsica"),
    ("France", "Corse", "Corsica"),
    ("France", "Minervois", "Languedoc-Roussillon"),
    ("France", "Corbières", "Languedoc-Roussillon"),
    ("France", "Corbieres", "Languedoc-Roussillon"),
    ("France", "Fitou", "Languedoc-Roussillon"),
    ("France", "Pic Saint-Loup", "Languedoc-Roussillon"),
    ("France", "Chinon", "Loire Valley"),
    ("France", "Bourgueil", "Loire Valley"),
    ("France", "Anjou", "Loire Valley"),
    ("France", "Savennières", "Loire Valley"),
    ("France", "Savennieres", "Loire Valley"),
    ("France", "Touraine", "Loire Valley"),
    ("France", "Meursault", "Burgundy"),
    ("France", "Puligny-Montrachet", "Burgundy"),
    ("France", "Chassagne-Montrachet", "Burgundy"),
    ("France", "Gevrey-Chambertin", "Burgundy"),
    ("France", "Nuits-Saint-Georges", "Burgundy"),
    ("France", "Nuits Saint Georges", "Burgundy"),
    ("France", "Pommard", "Burgundy"),
    ("France", "Volnay", "Burgundy"),
    ("France", "Vosne-Romanée", "Burgundy"),
    ("France", "Vosne-Romanee", "Burgundy"),
    ("France", "Côte de Beaune", "Burgundy"),
    ("France", "Côte de Nuits", "Burgundy"),
    ("France", "Mâcon", "Burgundy"),
    ("France", "Macon", "Burgundy"),

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
    ("Italy", "Südtirol", "Alto Adige"),
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
    ("Italy", "Lombardy", "Lombardy"),
    ("Italy", "Lombardia", "Lombardy"),
    ("Italy", "Lambrusco", "Emilia-Romagna"),
    ("Italy", "Emilia-Romagna", "Emilia-Romagna"),
    ("Italy", "Emilia Romagna", "Emilia-Romagna"),
    ("Italy", "Gavi", "Piedmont"),
    ("Italy", "Asti", "Piedmont"),
    ("Italy", "Etna", "Sicily"),
    ("Italy", "Bolgheri", "Tuscany"),
    ("Italy", "Maremma", "Tuscany"),
    ("Italy", "Marche", "Marche"),
    ("Italy", "Umbria", "Umbria"),
    ("Italy", "Basilicata", "Basilicata"),

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
    ("Spain", "Jerez", "Jerez"),
    ("Spain", "Sherry", "Jerez"),

    # USA
    ("United States", "Napa Valley", "Napa Valley"),
    ("United States", "Napa", "Napa Valley"),
    ("United States", "Sonoma", "Sonoma"),
    ("United States", "Sonoma Coast", "Sonoma Coast"),
    ("United States", "Paso Robles", "Paso Robles"),
    ("United States", "Willamette", "Willamette Valley"),
    ("United States", "Willamette Valley", "Willamette Valley"),
    ("United States", "Russian River Valley", "Russian River Valley"),
    ("United States", "Russian River", "Russian River Valley"),
    ("United States", "Santa Barbara", "Santa Barbara"),
    ("United States", "Central Coast", "Central Coast"),
    ("United States", "Monterey", "Monterey"),
    ("United States", "Lodi", "Lodi"),
    ("United States", "Walla Walla", "Walla Walla Valley"),
    ("United States", "Columbia Valley", "Columbia Valley"),
    ("United States", "Alexander Valley", "Alexander Valley"),
    ("United States", "Dry Creek Valley", "Dry Creek Valley"),
    ("United States", "Dry Creek", "Dry Creek Valley"),
    ("United States", "Finger Lakes", "Finger Lakes"),
    ("USA", "Napa Valley", "Napa Valley"),
    ("USA", "Napa", "Napa Valley"),
    ("USA", "Sonoma", "Sonoma"),
    ("USA", "Willamette", "Willamette Valley"),
    ("USA", "Paso Robles", "Paso Robles"),

    # Argentina
    ("Argentina", "Mendoza", "Mendoza"),
    ("Argentina", "Uco Valley", "Uco Valley"),
    ("Argentina", "Valle de Uco", "Uco Valley"),
    ("Argentina", "Salta", "Salta"),
    ("Argentina", "Cafayate", "Salta"),
    ("Argentina", "Patagonia", "Patagonia"),

    # Chile
    ("Chile", "Maipo", "Maipo Valley"),
    ("Chile", "Maipo Valley", "Maipo Valley"),
    ("Chile", "Colchagua", "Colchagua Valley"),
    ("Chile", "Casablanca", "Casablanca Valley"),
    ("Chile", "Rapel", "Rapel Valley"),
    ("Chile", "Leyda", "Leyda Valley"),

    # Australia
    ("Australia", "Barossa", "Barossa Valley"),
    ("Australia", "Barossa Valley", "Barossa Valley"),
    ("Australia", "McLaren Vale", "McLaren Vale"),
    ("Australia", "Margaret River", "Margaret River"),
    ("Australia", "Yarra Valley", "Yarra Valley"),
    ("Australia", "Hunter Valley", "Hunter Valley"),
    ("Australia", "Coonawarra", "Coonawarra"),
    ("Australia", "Adelaide Hills", "Adelaide Hills"),
    ("Australia", "Clare Valley", "Clare Valley"),
    ("Australia", "Eden Valley", "Eden Valley"),
    ("Australia", "Mornington Peninsula", "Mornington Peninsula"),
    ("Australia", "Tasmania", "Tasmania"),

    # New Zealand
    ("New Zealand", "Marlborough", "Marlborough"),
    ("New Zealand", "Central Otago", "Central Otago"),
    ("New Zealand", "Hawke's Bay", "Hawke's Bay"),
    ("New Zealand", "Hawkes Bay", "Hawke's Bay"),
    ("New Zealand", "Martinborough", "Martinborough"),
    ("New Zealand", "Waipara", "Waipara"),

    # South Africa
    ("South Africa", "Stellenbosch", "Stellenbosch"),
    ("South Africa", "Swartland", "Swartland"),
    ("South Africa", "Franschhoek", "Franschhoek"),
    ("South Africa", "Paarl", "Paarl"),
    ("South Africa", "Constantia", "Constantia"),
    ("South Africa", "Walker Bay", "Walker Bay"),
    ("South Africa", "Elgin", "Elgin"),

    # Portugal
    ("Portugal", "Douro", "Douro"),
    ("Portugal", "Alentejo", "Alentejo"),
    ("Portugal", "Dão", "Dão"),
    ("Portugal", "Dao", "Dão"),
    ("Portugal", "Vinho Verde", "Vinho Verde"),
    ("Portugal", "Bairrada", "Bairrada"),
    ("Portugal", "Madeira", "Madeira"),

    # Germany
    ("Germany", "Mosel", "Mosel"),
    ("Germany", "Rheingau", "Rheingau"),
    ("Germany", "Pfalz", "Pfalz"),
    ("Germany", "Baden", "Baden"),
    ("Germany", "Rheinhessen", "Rheinhessen"),
    ("Germany", "Franken", "Franken"),
    ("Germany", "Nahe", "Nahe"),
    ("Germany", "Württemberg", "Württemberg"),
    ("Germany", "Wurttemberg", "Württemberg"),
    ("Germany", "Ahr", "Ahr"),

    # Austria
    ("Austria", "Wachau", "Wachau"),
    ("Austria", "Kamptal", "Kamptal"),
    ("Austria", "Kremstal", "Kremstal"),
    ("Austria", "Burgenland", "Burgenland"),

    # Any-country fallback
    (None, "Champagne", "Champagne"),
    (None, "Bordeaux", "Bordeaux"),
    (None, "Burgundy", "Burgundy"),
    (None, "Barossa", "Barossa Valley"),
    (None, "Napa Valley", "Napa Valley"),
    (None, "Marlborough", "Marlborough"),
    (None, "Rioja", "Rioja"),
    (None, "Mendoza", "Mendoza"),
    (None, "Chianti", "Tuscany"),
    (None, "Barolo", "Piedmont"),
    (None, "Prosecco", "Veneto"),
    (None, "Chablis", "Burgundy"),
    (None, "Sancerre", "Loire Valley"),
]

REGION_PATTERNS: list[tuple[str | None, re.Pattern, str]] = []
for country, keyword, region in REGION_MAP:
    pat = re.compile(r'\b' + re.escape(keyword) + r'\b', re.IGNORECASE)
    REGION_PATTERNS.append((country, pat, region))


# ---------------------------------------------------------------------------
# Spirits Style Extraction
# ---------------------------------------------------------------------------
def _classify_spirit(classification: str) -> str | None:
    """Identify the spirit category from classification string."""
    cl = classification.lower()
    if any(x in cl for x in ["whisky", "whiskey", "scotch", "bourbon"]):
        return "whisky"
    if "gin" in cl.split():  # avoid "virgin" etc
        return "gin"
    if "vodka" in cl:
        return "vodka"
    if any(x in cl for x in ["rum", "rhum"]):
        return "rum"
    if any(x in cl for x in ["tequila", "mezcal"]):
        return "tequila"
    if any(x in cl for x in ["brandy", "cognac", "armagnac"]):
        return "brandy"
    if "liqueur" in cl:
        return "liqueur"
    return None


def extract_spirits_style(classification: str, name: str, country: str,
                          region: str) -> str | None:
    """Extract style for spirits products."""
    spirit = _classify_spirit(classification)
    if not spirit:
        return None

    nm = name.lower()
    ct = (country or "").lower()
    rg = (region or "").lower()

    if spirit == "whisky":
        # Check explicit style keywords in name
        if "single malt" in nm:
            if "scotland" in ct or "scotl" in ct:
                return "Single Malt Scotch Whisky"
            if "japan" in ct:
                return "Japanese Single Malt Whisky"
            if "ireland" in ct:
                return "Single Malt Irish Whiskey"
            return "Single Malt Whisky"
        if "blended malt" in nm:
            return "Blended Malt Scotch Whisky" if "scotland" in ct else "Blended Malt Whisky"
        if "single grain" in nm:
            return "Single Grain Whisky"
        if "bourbon" in nm:
            return "Bourbon"
        if re.search(r'\brye\b', nm) and ("usa" in ct or "united states" in ct or "america" in ct or "canada" in ct):
            return "Rye Whiskey"
        if "tennessee" in nm:
            return "Tennessee Whiskey"
        if "blended" in nm:
            if "scotland" in ct:
                return "Blended Scotch Whisky"
            return "Blended Whisky"
        # Age statement heuristic for scotch
        if "scotland" in ct:
            if re.search(r'\b\d{1,2}\s*(year|yr|yo)\b', nm, re.IGNORECASE):
                return "Single Malt Scotch Whisky"
            return "Blended Scotch Whisky"
        if "japan" in ct:
            return "Japanese Whisky"
        if "ireland" in ct:
            return "Irish Whiskey"
        if "usa" in ct or "united states" in ct or "america" in ct:
            return "Bourbon"
        return None

    if spirit == "gin":
        if "london dry" in nm:
            return "London Dry Gin"
        if "navy strength" in nm:
            return "Navy Strength Gin"
        if "old tom" in nm:
            return "Old Tom Gin"
        if "genever" in nm or "jenever" in nm:
            return "Genever"
        if "sloe" in nm:
            return "Sloe Gin"
        return "Dry Gin"

    if spirit == "rum":
        if any(x in nm for x in ["white rum", "silver rum", "light rum", "blanco"]):
            return "White Rum"
        if any(x in nm for x in ["gold rum", "amber rum", "oro"]):
            return "Gold Rum"
        if "dark" in nm:
            return "Dark Rum"
        if "spiced" in nm:
            return "Spiced Rum"
        if "agricole" in nm or "rhum agricole" in nm:
            return "Rhum Agricole"
        if any(x in nm for x in ["añejo", "anejo", "aged"]):
            return "Aged Rum"
        if re.search(r'\b\d{1,2}\s*(year|yr|yo|ans)\b', nm, re.IGNORECASE):
            return "Aged Rum"
        return None

    if spirit == "tequila":
        if "extra añejo" in nm or "extra anejo" in nm:
            return "Extra Añejo Tequila"
        if "cristalino" in nm:
            return "Cristalino Tequila"
        if "añejo" in nm or "anejo" in nm:
            return "Añejo Tequila"
        if "reposado" in nm:
            return "Reposado Tequila"
        if "blanco" in nm or "silver" in nm or "plata" in nm:
            return "Blanco Tequila"
        if "mezcal" in nm.lower():
            return "Mezcal"
        return None

    if spirit == "brandy":
        # Cognac special handling
        is_cognac = ("cognac" in nm or "cognac" in rg or "cognac" in classification.lower())
        if is_cognac:
            if "hors d'age" in nm or "hors d age" in nm:
                return "Cognac Hors d'Age"
            if re.search(r'\bxo\b', nm, re.IGNORECASE):
                return "Cognac XO"
            if "napoleon" in nm.lower():
                return "Cognac Napoleon"
            if re.search(r'\bvsop\b', nm, re.IGNORECASE):
                return "Cognac VSOP"
            if re.search(r'\bvs\b', nm, re.IGNORECASE):
                return "Cognac VS"
            return "Cognac"
        # Armagnac
        if "armagnac" in nm or "armagnac" in rg:
            if re.search(r'\bxo\b', nm, re.IGNORECASE):
                return "Armagnac XO"
            if re.search(r'\bvsop\b', nm, re.IGNORECASE):
                return "Armagnac VSOP"
            return "Armagnac"
        # Generic brandy
        if re.search(r'\bxo\b', nm, re.IGNORECASE):
            return "Brandy XO"
        if re.search(r'\bvsop\b', nm, re.IGNORECASE):
            return "Brandy VSOP"
        if re.search(r'\bvs\b', nm, re.IGNORECASE):
            return "Brandy VS"
        return None

    if spirit == "vodka":
        # Check for flavor words
        flavor_words = ["vanilla", "lemon", "lime", "orange", "cherry", "raspberry",
                        "strawberry", "peach", "mango", "apple", "pear", "grapefruit",
                        "cranberry", "blueberry", "watermelon", "coconut", "pineapple",
                        "pepper", "chili", "honey", "caramel", "espresso", "coffee",
                        "chocolate", "cucumber", "citrus", "berry", "mint"]
        for fw in flavor_words:
            if fw in nm:
                return "Flavored Vodka"
        return "Plain Vodka"

    if spirit == "liqueur":
        if any(x in nm for x in ["cream", "baileys", "irish cream"]):
            return "Cream Liqueur"
        if any(x in nm for x in ["coffee", "kahlua", "espresso"]):
            return "Coffee Liqueur"
        if any(x in nm for x in ["chocolate", "cacao", "creme de cacao"]):
            return "Chocolate Liqueur"
        herb_words = ["herbal", "herb", "bitter", "amaro", "chartreuse", "jägermeister",
                      "jagermeister", "bénédictine", "benedictine", "absinthe"]
        if any(x in nm for x in herb_words):
            return "Herbal Liqueur"
        nut_words = ["amaretto", "hazelnut", "walnut", "almond", "nocino", "frangelico"]
        if any(x in nm for x in nut_words):
            return "Nut Liqueur"
        fruit_words = ["cassis", "limoncello", "chambord", "cointreau", "triple sec",
                       "curaçao", "curacao", "grand marnier", "peach", "cherry",
                       "raspberry", "strawberry", "mango", "passion", "elderflower",
                       "fruit", "orange", "lemon", "apricot", "plum", "maraschino"]
        if any(x in nm for x in fruit_words):
            return "Fruit Liqueur"
        return None

    return None


# ---------------------------------------------------------------------------
# Brand extraction from descriptions
# ---------------------------------------------------------------------------
def extract_brand_from_desc(desc: str) -> str | None:
    """Try to find a brand-like pattern at the start of a description.
    Looks for capitalized multi-word sequences at sentence start."""
    if not desc:
        return None
    desc = desc.strip()
    # Pattern: 2-4 capitalized words at start, before a comma, dash, 'is', etc.
    m = re.match(r'^([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+){0,3})\s*(?:is|was|has|,|-|–|—|:|\()', desc)
    if m:
        candidate = m.group(1).strip()
        # Filter out generic starts
        generic = {"the", "this", "our", "a", "an", "from", "with", "made", "produced",
                   "red wine", "white wine", "sparkling wine", "rose wine",
                   "what", "how", "when", "where", "who", "which", "that",
                   "new", "best", "great", "good", "fine", "pure", "fresh",
                   "one", "each", "every", "all", "some", "many", "most"}
        if candidate.lower() not in generic and len(candidate) > 3:
            return candidate
    return None


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
    encoded_sku = urllib.parse.quote(sku, safe="")
    url = f"{BASE_URL}/rest/v1/products?sku=eq.{encoded_sku}"
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
# Region extraction helper (searches both name and descriptions)
# ---------------------------------------------------------------------------
def extract_region_pass2(name: str, country: str | None,
                         desc_short: str | None, desc_full: str | None) -> str | None:
    """Extract region from name, then fall back to descriptions."""
    country_str = (country or "").strip()
    # Try name first, then descriptions
    texts = [name, desc_short or "", desc_full or ""]
    for text in texts:
        if not text.strip():
            continue
        for req_country, pat, region in REGION_PATTERNS:
            if req_country is not None and country_str and req_country.lower() != country_str.lower():
                continue
            if req_country is not None and not country_str:
                continue
            if pat.search(text):
                return region
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Pass 2: smarter field extraction")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--tier", type=int, default=0, help="Tier to process (0=all)")
    args = parser.parse_args()

    print(f"=== Pass 2 — Field Extraction ===", flush=True)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}", flush=True)
    print(f"Tier filter: {'all' if args.tier == 0 else args.tier}", flush=True)
    print(flush=True)

    # --- Fetch products ---
    select_fields = (
        "sku,name,classification,grape_variety,vintage,brand,region,country,"
        "style,desc_en_short,desc_en_full,short_description_en,description_en_text,"
        "enrichment_priority"
    )
    query = f"products?select={select_fields}&order=sku"
    if args.tier > 0:
        query += f"&enrichment_priority=eq.{args.tier}"

    print("Fetching products...", flush=True)
    products = sb_get_all(query)
    print(f"Total products fetched: {len(products)}", flush=True)
    print(flush=True)

    # --- Before counts ---
    total = len(products)
    before = {
        "grape_variety": sum(1 for p in products if (p.get("grape_variety") or "").strip()),
        "region": sum(1 for p in products if (p.get("region") or "").strip()),
        "brand": sum(1 for p in products if (p.get("brand") or "").strip()),
        "style": sum(1 for p in products if (p.get("style") or "").strip()),
        "vintage": sum(1 for p in products if (p.get("vintage") or "").strip()),
    }
    print(f"=== Before Counts (of {total} products) ===", flush=True)
    for field, count in before.items():
        pct = (count / total * 100) if total else 0
        print(f"  {field}: {count}/{total} ({pct:.1f}%)", flush=True)
    print(flush=True)

    # --- Build known brand list ---
    print("Building known brand list...", flush=True)
    known_brands: set[str] = set()
    for p in products:
        b = (p.get("brand") or "").strip()
        if b and len(b) > 1:
            known_brands.add(b)
    print(f"Known brands: {len(known_brands)}", flush=True)
    print(flush=True)

    # --- Process ---
    updates: list[tuple[str, dict]] = []
    stats = {"grape": 0, "region": 0, "brand": 0, "style": 0, "vintage": 0, "products_with_updates": 0}

    for i, p in enumerate(products):
        sku = p.get("sku", "")
        name = (p.get("name") or "").strip()
        classification = (p.get("classification") or "").strip()
        country = (p.get("country") or "").strip()
        region_current = (p.get("region") or "").strip()
        desc_short = (p.get("desc_en_short") or p.get("short_description_en") or "").strip()
        desc_full = (p.get("desc_en_full") or p.get("description_en_text") or "").strip()
        if not name or not sku:
            continue

        patch: dict = {}
        cl_lower = classification.lower()
        is_wine = cl_lower in WINE_CLASSIFICATIONS
        is_spirit = any(s in cl_lower for s in SPIRITS_CLASSIFICATIONS) or _classify_spirit(classification) is not None

        # ---- 1. Grape Variety ----
        if is_wine and not (p.get("grape_variety") or "").strip():
            # Strategy A: classification-based defaults
            grape = _grape_from_classification(classification, region_current, country, name)

            # Strategy B: scan descriptions for grape mentions
            if not grape:
                combined_desc = f"{desc_short} {desc_full}".strip()
                if combined_desc:
                    grape = extract_grapes_from_text(combined_desc)

            if grape:
                patch["grape_variety"] = grape
                stats["grape"] += 1

        # ---- 2. Region (wines and spirits only, not accessories/etc) ----
        if not region_current and (is_wine or is_spirit):
            region = extract_region_pass2(name, country, desc_short, desc_full)
            if region:
                patch["region"] = region
                stats["region"] += 1

        # ---- 3. Spirits Style ----
        if is_spirit and not (p.get("style") or "").strip():
            style = extract_spirits_style(classification, name, country, region_current)
            if style:
                patch["style"] = style
                stats["style"] += 1

        # ---- 4. Brand from descriptions (wines and spirits only) ----
        if not (p.get("brand") or "").strip() and (is_wine or is_spirit):
            # First try matching known brands in name (pass 1 might have missed some)
            brand = None
            best_len = 0
            for kb in known_brands:
                kbl = kb.lower()
                if len(kb) >= 3 and re.search(r'\b' + re.escape(kbl) + r'\b', name, re.IGNORECASE) and len(kb) > best_len:
                    brand = kb
                    best_len = len(kb)

            # Then try description mining
            if not brand:
                brand = extract_brand_from_desc(desc_short)
            if not brand:
                brand = extract_brand_from_desc(desc_full)

            if brand:
                patch["brand"] = brand
                stats["brand"] += 1

        # ---- 5. Vintage (second chance from descriptions) ----
        if not (p.get("vintage") or "").strip():
            # Already tried name in pass 1; now try descriptions
            for text in [desc_short, desc_full]:
                if text:
                    m = re.search(r'\b(vintage|harvest|vendange|millésime|millesime)\s+(19[89]\d|20[0-2]\d)\b', text, re.IGNORECASE)
                    if m:
                        patch["vintage"] = m.group(2)
                        stats["vintage"] += 1
                        break
                    m = re.search(r'\b(19[89]\d|20[0-2]\d)\s+(vintage|harvest)\b', text, re.IGNORECASE)
                    if m:
                        patch["vintage"] = m.group(1)
                        stats["vintage"] += 1
                        break

        if patch:
            updates.append((sku, patch))
            stats["products_with_updates"] += 1

        if (i + 1) % 500 == 0:
            print(f"Processed {i+1}/{len(products)} — "
                  f"grapes={stats['grape']}, regions={stats['region']}, "
                  f"brands={stats['brand']}, styles={stats['style']}, "
                  f"vintages={stats['vintage']}", flush=True)

    print(flush=True)
    print(f"=== Extraction Complete ===", flush=True)
    print(f"Products processed: {total}", flush=True)
    print(f"Products with updates: {stats['products_with_updates']}", flush=True)
    print(f"  Grape varieties inferred: {stats['grape']}", flush=True)
    print(f"  Regions filled: {stats['region']}", flush=True)
    print(f"  Brands filled: {stats['brand']}", flush=True)
    print(f"  Spirits styles set: {stats['style']}", flush=True)
    print(f"  Vintages found: {stats['vintage']}", flush=True)
    print(flush=True)

    # --- After projection ---
    after = {}
    for field in before:
        after[field] = before[field] + stats.get({
            "grape_variety": "grape", "region": "region",
            "brand": "brand", "style": "style", "vintage": "vintage"
        }[field], 0)

    print(f"=== Projected Coverage ===", flush=True)
    for field in before:
        b = before[field]
        a = after[field]
        bp = (b / total * 100) if total else 0
        ap = (a / total * 100) if total else 0
        delta = a - b
        print(f"  {field}: {b} ({bp:.1f}%) -> {a} ({ap:.1f}%)  [+{delta}]", flush=True)
    print(flush=True)

    # --- Sample updates ---
    if updates:
        print("=== Sample Updates (first 15) ===", flush=True)
        for sku, patch in updates[:15]:
            name_preview = next((p["name"] for p in products if p["sku"] == sku), "?")
            print(f"  {sku}: {patch}", flush=True)
            print(f"    name: {name_preview[:90]}", flush=True)
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
        done = min(i + 50, len(updates))
        print(f"  Patched {done}/{len(updates)} (success={success}, fail={fail})", flush=True)

    print(flush=True)
    print(f"=== DONE ===", flush=True)
    print(f"Successfully patched: {success}", flush=True)
    print(f"Failed: {fail}", flush=True)


if __name__ == "__main__":
    main()
