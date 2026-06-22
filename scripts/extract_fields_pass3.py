#!/usr/bin/env python3
"""
extract_fields_pass3.py — Third-pass field extraction targeting 90+ quality score.

Fills remaining gaps using zero-API strategies:
  1. Flavor tags — extracted from product descriptions
  2. Food matching — derived from classification + style + body
  3. Region — deeper description mining with 300+ regions
  4. Brand — name pattern extraction
  5. Vintage — NV defaults for non-vintage categories

Usage:
  python3 scripts/extract_fields_pass3.py --dry-run
  python3 scripts/extract_fields_pass3.py --dry-run --tier=1
  python3 scripts/extract_fields_pass3.py --tier=1          # T1 live write
  python3 scripts/extract_fields_pass3.py --tier=0          # all tiers, live write
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

# ---------------------------------------------------------------------------
# 1. FLAVOR DICTIONARY (200+ terms, grouped by category)
# ---------------------------------------------------------------------------
FLAVOR_TERMS: list[str] = [
    # Red fruits
    "cherry", "raspberry", "strawberry", "cranberry", "redcurrant", "red currant",
    "pomegranate", "red berry", "red fruit",
    # Dark fruits
    "blackberry", "blueberry", "blackcurrant", "black currant", "cassis", "plum",
    "boysenberry", "mulberry", "black cherry", "dark fruit", "dark berry",
    # Stone fruits
    "peach", "apricot", "nectarine", "plum", "prune",
    # Tropical fruits
    "mango", "pineapple", "passion fruit", "passionfruit", "guava", "lychee",
    "papaya", "banana", "coconut", "tropical fruit",
    # Citrus
    "citrus", "lemon", "lime", "grapefruit", "orange", "tangerine", "bergamot",
    "yuzu", "mandarin", "orange peel", "lemon zest", "citrus peel",
    # Tree / orchard fruits
    "apple", "pear", "quince", "green apple", "baked apple",
    # Melon
    "melon", "watermelon", "honeydew", "cantaloupe",
    # Dried fruits
    "fig", "date", "raisin", "dried fruit", "dried cherry", "dried apricot",
    "sultana", "currant",
    # Floral
    "rose", "violet", "jasmine", "lavender", "hibiscus", "elderflower",
    "chamomile", "geranium", "honeysuckle", "orange blossom", "acacia",
    "blossom", "floral", "peony", "iris", "lily",
    # Sweet spice
    "vanilla", "cinnamon", "clove", "nutmeg", "cardamom", "anise", "star anise",
    "licorice", "liquorice", "ginger", "allspice", "mace",
    # Savory spice / pepper
    "pepper", "black pepper", "white pepper", "pink pepper", "peppercorn",
    "saffron", "cumin", "coriander",
    # Oak / wood
    "oak", "cedar", "sandalwood", "pine", "toast", "toasty", "charred", "char",
    "smoky", "smoke", "woody", "wood",
    # Roasted / caramel
    "caramel", "toffee", "butterscotch", "honey", "maple", "brown sugar",
    "molasses", "treacle",
    # Chocolate / coffee
    "chocolate", "dark chocolate", "milk chocolate", "cocoa", "cacao",
    "coffee", "espresso", "mocha",
    # Nuts
    "almond", "hazelnut", "walnut", "chestnut", "pistachio", "pecan",
    "cashew", "marzipan",
    # Dairy / baking
    "butter", "cream", "creamy", "brioche", "biscuit", "pastry", "dough",
    "bread", "yeast", "croissant",
    # Herbal / green
    "mint", "thyme", "rosemary", "basil", "sage", "oregano", "dill",
    "eucalyptus", "menthol", "bay leaf", "fennel", "tarragon",
    "herbal", "herbaceous",
    # Vegetal / green
    "hay", "grass", "grassy", "green bell pepper", "bell pepper", "olive",
    "artichoke", "asparagus", "green tea", "tea", "tobacco leaf",
    # Earth / mineral
    "earth", "earthy", "mushroom", "truffle", "forest floor", "underbrush",
    "mineral", "minerality", "slate", "flint", "chalk", "chalky",
    "graphite", "wet stone", "wet rock", "gravel", "limestone",
    "saline", "salty", "brine", "iodine",
    # Leather / animal
    "leather", "tobacco", "cigar box", "game", "gamey", "meaty",
    # Misc
    "petrol", "kerosene", "tar", "asphalt", "rubber",
    "beeswax", "lanolin",
    "dried herbs", "garrigue", "maquis", "scrubland",
    "potpourri", "incense", "resin",
    "camphor", "turpentine",
    "cream soda", "cola",
    "lemongrass", "ginger beer",
    # Spirits-specific
    "peat", "peaty", "smoky", "iodine", "seaweed", "maritime",
    "grain", "malt", "malted barley", "barley", "corn", "rye",
    "agave", "cooked agave", "roasted agave",
    "juniper", "botanicals", "tonic",
    "sugarcane", "molasses", "rum",
    "oak barrel", "sherry cask", "bourbon cask", "port cask",
]

# Deduplicate while preserving order
_seen_flavors: set[str] = set()
FLAVOR_TERMS_UNIQUE: list[str] = []
for _f in FLAVOR_TERMS:
    fl = _f.lower()
    if fl not in _seen_flavors:
        _seen_flavors.add(fl)
        FLAVOR_TERMS_UNIQUE.append(_f)

# Pre-compile patterns — sort longest first to match multi-word terms first
FLAVOR_PATTERNS: list[tuple[re.Pattern, str]] = []
for term in sorted(FLAVOR_TERMS_UNIQUE, key=len, reverse=True):
    pat = re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE)
    FLAVOR_PATTERNS.append((pat, term.lower()))


# ---------------------------------------------------------------------------
# 2. FOOD MATCHING RULES
# ---------------------------------------------------------------------------
FOOD_MAP_WINE: dict[str, str] = {
    # Red wine by body
    "red_full":    "Red Meat, Grilled Steak, Lamb, Hard Cheese, BBQ",
    "red_medium":  "Pasta, Pizza, Roasted Chicken, Pork, Medium Cheese",
    "red_light":   "Charcuterie, Salmon, Mushroom Dishes, Soft Cheese",
    "red_default": "Red Meat, Pasta, Grilled Vegetables, Cheese",
    # White wine by body
    "white_full":   "Lobster, Creamy Pasta, Roasted Chicken, Rich Fish",
    "white_light":  "Seafood, Oysters, Salad, Light Fish, Goat Cheese",
    "white_default": "Seafood, Poultry, Salad, Light Pasta",
    # Rose
    "rose":        "Mediterranean, Grilled Vegetables, Light Salads, Sushi",
    # Sparkling / Champagne
    "sparkling":   "Oysters, Caviar, Fried Foods, Appetizers, Celebration",
    # Dessert
    "dessert":     "Foie Gras, Blue Cheese, Fruit Tarts, Cr\u00e8me Br\u00fbl\u00e9e",
    # Orange wine
    "orange":      "Rich Seafood, Spiced Dishes, Asian Cuisine, Aged Cheese",
    # Fortified
    "port":        "Blue Cheese, Chocolate, Dried Fruits, Nuts",
}

FOOD_MAP_SPIRITS: dict[str, str] = {
    "whisky":  "Dark Chocolate, Smoked Meats, Aged Cheese, Nuts",
    "gin":     "Tonic, Seafood Cocktails, Light Appetizers, Citrus Dishes",
    "rum":     "Tropical Fruit, BBQ, Spiced Desserts, Chocolate",
    "tequila": "Mexican Cuisine, Ceviche, Grilled Fish, Citrus",
    "brandy":  "Chocolate, Dried Fruits, Cheese, After Dinner",
    "vodka":   "Caviar, Smoked Fish, Raw Oysters, Neutral Pairings",
    "sake":    "Sushi, Sashimi, Tempura, Japanese Cuisine, Light Seafood",
    "beer":    "Pizza, Burgers, Fried Food, Spicy Cuisine",
    "liqueur": "Desserts, Coffee, Cocktails",
}

# Classification keywords that map to wine body categories
WINE_CLASSIFICATIONS = {
    "red wine", "white wine", "rose wine", "rosé wine",
    "sparkling wine", "champagne", "orange wine",
    "dessert wine", "port wine", "fruit wine",
}

SPIRITS_KEYWORDS = [
    "whisky", "whiskey", "scotch", "bourbon",
    "gin", "vodka", "rum", "rhum", "tequila", "mezcal",
    "brandy", "cognac", "armagnac",
    "liqueur", "liquor", "sake",
    "beer", "ale", "lager", "stout",
]


def _classify_spirit(classification: str) -> str | None:
    cl = classification.lower()
    if any(x in cl for x in ["whisky", "whiskey", "scotch", "bourbon"]):
        return "whisky"
    if "gin" in cl.split():
        return "gin"
    if "vodka" in cl:
        return "vodka"
    if any(x in cl for x in ["rum", "rhum"]):
        return "rum"
    if any(x in cl for x in ["tequila", "mezcal"]):
        return "tequila"
    if any(x in cl for x in ["brandy", "cognac", "armagnac"]):
        return "brandy"
    if "sake" in cl:
        return "sake"
    if any(x in cl for x in ["beer", "ale", "lager", "stout"]):
        return "beer"
    if "liqueur" in cl:
        return "liqueur"
    return None


# ---------------------------------------------------------------------------
# 3. REGION MAP — 300+ regions, expanded beyond pass 2
# ---------------------------------------------------------------------------
REGION_MAP: list[tuple[str | None, str, str]] = [
    # === France ===
    ("France", "Bordeaux", "Bordeaux"),
    ("France", "Burgundy", "Burgundy"),
    ("France", "Bourgogne", "Burgundy"),
    ("France", "Champagne", "Champagne"),
    ("France", "Rh\u00f4ne", "Rh\u00f4ne Valley"),
    ("France", "Rhone", "Rh\u00f4ne Valley"),
    ("France", "Loire", "Loire Valley"),
    ("France", "Alsace", "Alsace"),
    ("France", "Languedoc", "Languedoc-Roussillon"),
    ("France", "Roussillon", "Languedoc-Roussillon"),
    ("France", "Provence", "Provence"),
    ("France", "C\u00f4tes du Rh\u00f4ne", "Rh\u00f4ne Valley"),
    ("France", "Cotes du Rhone", "Rh\u00f4ne Valley"),
    ("France", "Beaujolais", "Beaujolais"),
    ("France", "Chablis", "Burgundy"),
    ("France", "Sancerre", "Loire Valley"),
    ("France", "Vouvray", "Loire Valley"),
    ("France", "Muscadet", "Loire Valley"),
    ("France", "Pouilly-Fum\u00e9", "Loire Valley"),
    ("France", "Pouilly Fume", "Loire Valley"),
    ("France", "Pouilly-Fuiss\u00e9", "Burgundy"),
    ("France", "Pouilly-Fuisse", "Burgundy"),
    ("France", "Saint-\u00c9milion", "Bordeaux"),
    ("France", "Saint-Emilion", "Bordeaux"),
    ("France", "Saint Emilion", "Bordeaux"),
    ("France", "Pauillac", "Bordeaux"),
    ("France", "Margaux", "Bordeaux"),
    ("France", "M\u00e9doc", "Bordeaux"),
    ("France", "Medoc", "Bordeaux"),
    ("France", "Haut-M\u00e9doc", "Bordeaux"),
    ("France", "Haut-Medoc", "Bordeaux"),
    ("France", "Saint-Julien", "Bordeaux"),
    ("France", "Saint-Est\u00e8phe", "Bordeaux"),
    ("France", "Saint-Estephe", "Bordeaux"),
    ("France", "Pomerol", "Bordeaux"),
    ("France", "Graves", "Bordeaux"),
    ("France", "Pessac-L\u00e9ognan", "Bordeaux"),
    ("France", "Pessac-Leognan", "Bordeaux"),
    ("France", "Sauternes", "Bordeaux"),
    ("France", "Ch\u00e2teauneuf-du-Pape", "Rh\u00f4ne Valley"),
    ("France", "Chateauneuf-du-Pape", "Rh\u00f4ne Valley"),
    ("France", "Gigondas", "Rh\u00f4ne Valley"),
    ("France", "Hermitage", "Rh\u00f4ne Valley"),
    ("France", "Cornas", "Rh\u00f4ne Valley"),
    ("France", "Condrieu", "Rh\u00f4ne Valley"),
    ("France", "Crozes-Hermitage", "Rh\u00f4ne Valley"),
    ("France", "C\u00f4te-R\u00f4tie", "Rh\u00f4ne Valley"),
    ("France", "Cote-Rotie", "Rh\u00f4ne Valley"),
    ("France", "Cahors", "South West France"),
    ("France", "Madiran", "South West France"),
    ("France", "Juran\u00e7on", "South West France"),
    ("France", "Jurancon", "South West France"),
    ("France", "Bandol", "Provence"),
    ("France", "C\u00f4tes de Provence", "Provence"),
    ("France", "Cotes de Provence", "Provence"),
    ("France", "Jura", "Jura"),
    ("France", "Corsica", "Corsica"),
    ("France", "Corse", "Corsica"),
    ("France", "Minervois", "Languedoc-Roussillon"),
    ("France", "Corbi\u00e8res", "Languedoc-Roussillon"),
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
    ("France", "Vosne-Roman\u00e9e", "Burgundy"),
    ("France", "Vosne-Romanee", "Burgundy"),
    ("France", "C\u00f4te de Beaune", "Burgundy"),
    ("France", "C\u00f4te de Nuits", "Burgundy"),
    ("France", "M\u00e2con", "Burgundy"),
    ("France", "Macon", "Burgundy"),
    ("France", "Saint-V\u00e9ran", "Burgundy"),
    ("France", "Saint-Veran", "Burgundy"),
    ("France", "Mercurey", "Burgundy"),
    ("France", "Rully", "Burgundy"),
    ("France", "Givry", "Burgundy"),
    ("France", "Montagny", "Burgundy"),
    ("France", "Irancy", "Burgundy"),
    ("France", "Santenay", "Burgundy"),
    ("France", "Fixin", "Burgundy"),
    ("France", "Marsannay", "Burgundy"),
    ("France", "Savigny-l\u00e8s-Beaune", "Burgundy"),
    ("France", "Savigny-les-Beaune", "Burgundy"),
    ("France", "Aloxe-Corton", "Burgundy"),
    ("France", "Corton", "Burgundy"),
    ("France", "Ladoix", "Burgundy"),
    ("France", "Pernand-Vergelesses", "Burgundy"),
    ("France", "Auxey-Duresses", "Burgundy"),
    ("France", "Saint-Romain", "Burgundy"),
    ("France", "Saint-Aubin", "Burgundy"),
    ("France", "Morey-Saint-Denis", "Burgundy"),
    ("France", "Chambolle-Musigny", "Burgundy"),
    ("France", "Vougeot", "Burgundy"),
    ("France", "Flagey-Ech\u00e9zeaux", "Burgundy"),
    ("France", "Banyuls", "Languedoc-Roussillon"),
    ("France", "Maury", "Languedoc-Roussillon"),
    ("France", "Rivesaltes", "Languedoc-Roussillon"),
    ("France", "Limoux", "Languedoc-Roussillon"),
    ("France", "Faugères", "Languedoc-Roussillon"),
    ("France", "Faugeres", "Languedoc-Roussillon"),
    ("France", "Saint-Chinian", "Languedoc-Roussillon"),
    ("France", "Costières de N\u00eemes", "Rh\u00f4ne Valley"),
    ("France", "Costieres de Nimes", "Rh\u00f4ne Valley"),
    ("France", "Vacqueyras", "Rh\u00f4ne Valley"),
    ("France", "Rasteau", "Rh\u00f4ne Valley"),
    ("France", "Ventoux", "Rh\u00f4ne Valley"),
    ("France", "Luberon", "Rh\u00f4ne Valley"),
    ("France", "Li\u00e9bault", "Rh\u00f4ne Valley"),
    ("France", "Tavel", "Rh\u00f4ne Valley"),
    ("France", "Saint-Joseph", "Rh\u00f4ne Valley"),
    ("France", "Cr\u00e9py", "Savoie"),
    ("France", "Savoie", "Savoie"),
    ("France", "Bergerac", "South West France"),
    ("France", "Monbazillac", "South West France"),
    ("France", "Gaillac", "South West France"),
    ("France", "Iroul\u00e9guy", "South West France"),
    ("France", "Irouleguy", "South West France"),
    ("France", "Fr\u00e9jus", "Provence"),
    ("France", "Cassis", "Provence"),
    ("France", "Bellet", "Provence"),
    ("France", "Patrimonio", "Corsica"),
    ("France", "Ajaccio", "Corsica"),

    # === Italy ===
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
    ("Italy", "S\u00fcdtirol", "Alto Adige"),
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
    ("Italy", "Gavi", "Piedmont"),
    ("Italy", "Asti", "Piedmont"),
    ("Italy", "Etna", "Sicily"),
    ("Italy", "Bolgheri", "Tuscany"),
    ("Italy", "Maremma", "Tuscany"),
    ("Italy", "Marche", "Marche"),
    ("Italy", "Umbria", "Umbria"),
    ("Italy", "Basilicata", "Basilicata"),
    ("Italy", "Calabria", "Calabria"),
    ("Italy", "Liguria", "Liguria"),
    ("Italy", "Collio", "Friuli-Venezia Giulia"),
    ("Italy", "Colli Orientali", "Friuli-Venezia Giulia"),
    ("Italy", "Taurasi", "Campania"),
    ("Italy", "Fiano di Avellino", "Campania"),
    ("Italy", "Greco di Tufo", "Campania"),
    ("Italy", "Lacryma Christi", "Campania"),
    ("Italy", "Verdicchio dei Castelli di Jesi", "Marche"),
    ("Italy", "Montepulciano d'Abruzzo", "Abruzzo"),
    ("Italy", "Primitivo di Manduria", "Puglia"),
    ("Italy", "Salice Salentino", "Puglia"),
    ("Italy", "Dolcetto d'Alba", "Piedmont"),
    ("Italy", "Langhe", "Piedmont"),
    ("Italy", "Roero", "Piedmont"),
    ("Italy", "Gattinara", "Piedmont"),
    ("Italy", "Ghemme", "Piedmont"),
    ("Italy", "Nizza", "Piedmont"),
    ("Italy", "Monferrato", "Piedmont"),
    ("Italy", "Vino Nobile di Montepulciano", "Tuscany"),
    ("Italy", "Vernaccia di San Gimignano", "Tuscany"),
    ("Italy", "Morellino di Scansano", "Tuscany"),
    ("Italy", "Carmignano", "Tuscany"),
    ("Italy", "Orvieto", "Umbria"),
    ("Italy", "Sagrantino di Montefalco", "Umbria"),
    ("Italy", "Montefalco", "Umbria"),
    ("Italy", "Bardolino", "Veneto"),
    ("Italy", "Custoza", "Veneto"),
    ("Italy", "Lugana", "Lombardy"),
    ("Italy", "Oltrepò Pavese", "Lombardy"),
    ("Italy", "Oltrep\u00f2 Pavese", "Lombardy"),
    ("Italy", "Trentodoc", "Trentino"),
    ("Italy", "Teroldego Rotaliano", "Trentino"),
    ("Italy", "Cerasuolo d'Abruzzo", "Abruzzo"),
    ("Italy", "Pantelleria", "Sicily"),
    ("Italy", "Marsala", "Sicily"),
    ("Italy", "Nero d'Avola", "Sicily"),
    ("Italy", "Nerello Mascalese", "Sicily"),
    ("Italy", "Cannonau di Sardegna", "Sardinia"),
    ("Italy", "Vermentino di Gallura", "Sardinia"),
    ("Italy", "Aglianico del Vulture", "Basilicata"),

    # === Spain ===
    ("Spain", "Rioja", "Rioja"),
    ("Spain", "Ribera del Duero", "Ribera del Duero"),
    ("Spain", "Priorat", "Priorat"),
    ("Spain", "Pened\u00e8s", "Pened\u00e8s"),
    ("Spain", "Penedes", "Pened\u00e8s"),
    ("Spain", "R\u00edas Baixas", "R\u00edas Baixas"),
    ("Spain", "Rias Baixas", "R\u00edas Baixas"),
    ("Spain", "Rueda", "Rueda"),
    ("Spain", "Toro", "Toro"),
    ("Spain", "Navarra", "Navarra"),
    ("Spain", "Jumilla", "Jumilla"),
    ("Spain", "Galicia", "Galicia"),
    ("Spain", "Jerez", "Jerez"),
    ("Spain", "Sherry", "Jerez"),
    ("Spain", "Somontano", "Somontano"),
    ("Spain", "Montsant", "Montsant"),
    ("Spain", "Bierzo", "Bierzo"),
    ("Spain", "Valdepe\u00f1as", "Valdepe\u00f1as"),
    ("Spain", "Valdepenas", "Valdepe\u00f1as"),
    ("Spain", "C\u00f3rdoba", "Montilla-Moriles"),
    ("Spain", "Montilla-Moriles", "Montilla-Moriles"),
    ("Spain", "Manchuela", "Manchuela"),
    ("Spain", "La Mancha", "La Mancha"),
    ("Spain", "Cari\u00f1ena", "Cari\u00f1ena"),
    ("Spain", "Carinena", "Cari\u00f1ena"),
    ("Spain", "Yecla", "Yecla"),
    ("Spain", "Alicante", "Alicante"),
    ("Spain", "Utiel-Requena", "Utiel-Requena"),
    ("Spain", "Terra Alta", "Terra Alta"),
    ("Spain", "Conca de Barber\u00e0", "Conca de Barber\u00e0"),
    ("Spain", "Empord\u00e0", "Empord\u00e0"),
    ("Spain", "Txakoli", "Txakoli"),

    # === Portugal ===
    ("Portugal", "Douro", "Douro"),
    ("Portugal", "Alentejo", "Alentejo"),
    ("Portugal", "D\u00e3o", "D\u00e3o"),
    ("Portugal", "Dao", "D\u00e3o"),
    ("Portugal", "Vinho Verde", "Vinho Verde"),
    ("Portugal", "Bairrada", "Bairrada"),
    ("Portugal", "Madeira", "Madeira"),
    ("Portugal", "Lisboa", "Lisboa"),
    ("Portugal", "Tejo", "Tejo"),
    ("Portugal", "Setúbal", "Setúbal"),
    ("Portugal", "Setubal", "Setúbal"),
    ("Portugal", "Colares", "Colares"),
    ("Portugal", "Bucelas", "Bucelas"),

    # === Germany ===
    ("Germany", "Mosel", "Mosel"),
    ("Germany", "Rheingau", "Rheingau"),
    ("Germany", "Pfalz", "Pfalz"),
    ("Germany", "Baden", "Baden"),
    ("Germany", "Rheinhessen", "Rheinhessen"),
    ("Germany", "Franken", "Franken"),
    ("Germany", "Nahe", "Nahe"),
    ("Germany", "W\u00fcrttemberg", "W\u00fcrttemberg"),
    ("Germany", "Wurttemberg", "W\u00fcrttemberg"),
    ("Germany", "Ahr", "Ahr"),
    ("Germany", "Sachsen", "Sachsen"),
    ("Germany", "Saale-Unstrut", "Saale-Unstrut"),
    ("Germany", "Mittelrhein", "Mittelrhein"),

    # === Austria ===
    ("Austria", "Wachau", "Wachau"),
    ("Austria", "Kamptal", "Kamptal"),
    ("Austria", "Kremstal", "Kremstal"),
    ("Austria", "Burgenland", "Burgenland"),
    ("Austria", "Weinviertel", "Weinviertel"),
    ("Austria", "Neusiedlersee", "Burgenland"),
    ("Austria", "Thermenregion", "Thermenregion"),
    ("Austria", "Steiermark", "Steiermark"),
    ("Austria", "Styria", "Steiermark"),
    ("Austria", "Carnuntum", "Carnuntum"),
    ("Austria", "Traisental", "Traisental"),

    # === USA ===
    ("United States", "Napa Valley", "Napa Valley"),
    ("United States", "Napa", "Napa Valley"),
    ("United States", "Sonoma", "Sonoma"),
    ("United States", "Sonoma Coast", "Sonoma Coast"),
    ("United States", "Paso Robles", "Paso Robles"),
    ("United States", "Willamette Valley", "Willamette Valley"),
    ("United States", "Willamette", "Willamette Valley"),
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
    ("United States", "Finger Lakes", "Finger Lakes"),
    ("United States", "Santa Cruz Mountains", "Santa Cruz Mountains"),
    ("United States", "Sta. Rita Hills", "Sta. Rita Hills"),
    ("United States", "Santa Rita Hills", "Sta. Rita Hills"),
    ("United States", "Carneros", "Carneros"),
    ("United States", "Los Carneros", "Carneros"),
    ("United States", "Stags Leap", "Stags Leap District"),
    ("United States", "Oakville", "Oakville"),
    ("United States", "Rutherford", "Rutherford"),
    ("United States", "Howell Mountain", "Howell Mountain"),
    ("United States", "Diamond Mountain", "Diamond Mountain"),
    ("United States", "Spring Mountain", "Spring Mountain"),
    ("United States", "Mount Veeder", "Mount Veeder"),
    ("United States", "Atlas Peak", "Atlas Peak"),
    ("United States", "Edna Valley", "Edna Valley"),
    ("United States", "Anderson Valley", "Anderson Valley"),
    ("United States", "Mendocino", "Mendocino"),
    ("United States", "Livermore Valley", "Livermore Valley"),
    ("United States", "Temecula", "Temecula Valley"),
    ("United States", "Red Mountain", "Red Mountain"),
    ("United States", "Yakima Valley", "Yakima Valley"),
    ("USA", "Napa Valley", "Napa Valley"),
    ("USA", "Napa", "Napa Valley"),
    ("USA", "Sonoma", "Sonoma"),
    ("USA", "Willamette", "Willamette Valley"),
    ("USA", "Paso Robles", "Paso Robles"),

    # === Argentina ===
    ("Argentina", "Mendoza", "Mendoza"),
    ("Argentina", "Uco Valley", "Uco Valley"),
    ("Argentina", "Valle de Uco", "Uco Valley"),
    ("Argentina", "Salta", "Salta"),
    ("Argentina", "Cafayate", "Salta"),
    ("Argentina", "Patagonia", "Patagonia"),
    ("Argentina", "Luján de Cuyo", "Luján de Cuyo"),
    ("Argentina", "Lujan de Cuyo", "Luján de Cuyo"),
    ("Argentina", "Tupungato", "Uco Valley"),
    ("Argentina", "San Juan", "San Juan"),

    # === Chile ===
    ("Chile", "Maipo", "Maipo Valley"),
    ("Chile", "Maipo Valley", "Maipo Valley"),
    ("Chile", "Colchagua", "Colchagua Valley"),
    ("Chile", "Casablanca", "Casablanca Valley"),
    ("Chile", "Rapel", "Rapel Valley"),
    ("Chile", "Leyda", "Leyda Valley"),
    ("Chile", "Aconcagua", "Aconcagua Valley"),
    ("Chile", "Bio Bio", "Bio Bio Valley"),
    ("Chile", "Cachapoal", "Cachapoal Valley"),
    ("Chile", "Limarí", "Limarí Valley"),
    ("Chile", "Limari", "Limarí Valley"),
    ("Chile", "San Antonio", "San Antonio Valley"),
    ("Chile", "Itata", "Itata Valley"),
    ("Chile", "Maule", "Maule Valley"),
    ("Chile", "Central Valley", "Central Valley"),

    # === Australia ===
    ("Australia", "Barossa Valley", "Barossa Valley"),
    ("Australia", "Barossa", "Barossa Valley"),
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
    ("Australia", "Heathcote", "Heathcote"),
    ("Australia", "Beechworth", "Beechworth"),
    ("Australia", "Rutherglen", "Rutherglen"),
    ("Australia", "Grampians", "Grampians"),
    ("Australia", "Great Southern", "Great Southern"),
    ("Australia", "Frankland River", "Great Southern"),
    ("Australia", "Riverina", "Riverina"),
    ("Australia", "Mudgee", "Mudgee"),
    ("Australia", "Orange", "Orange"),
    ("Australia", "Langhorne Creek", "Langhorne Creek"),
    ("Australia", "Padthaway", "Padthaway"),
    ("Australia", "Wrattonbully", "Wrattonbully"),
    ("Australia", "King Valley", "King Valley"),

    # === New Zealand ===
    ("New Zealand", "Marlborough", "Marlborough"),
    ("New Zealand", "Central Otago", "Central Otago"),
    ("New Zealand", "Hawke's Bay", "Hawke's Bay"),
    ("New Zealand", "Hawkes Bay", "Hawke's Bay"),
    ("New Zealand", "Martinborough", "Martinborough"),
    ("New Zealand", "Waipara", "Waipara"),
    ("New Zealand", "Wairarapa", "Wairarapa"),
    ("New Zealand", "Nelson", "Nelson"),
    ("New Zealand", "Gisborne", "Gisborne"),
    ("New Zealand", "Canterbury", "Canterbury"),

    # === South Africa ===
    ("South Africa", "Stellenbosch", "Stellenbosch"),
    ("South Africa", "Swartland", "Swartland"),
    ("South Africa", "Franschhoek", "Franschhoek"),
    ("South Africa", "Paarl", "Paarl"),
    ("South Africa", "Constantia", "Constantia"),
    ("South Africa", "Walker Bay", "Walker Bay"),
    ("South Africa", "Elgin", "Elgin"),
    ("South Africa", "Robertson", "Robertson"),
    ("South Africa", "Tulbagh", "Tulbagh"),
    ("South Africa", "Hemel-en-Aarde", "Walker Bay"),
    ("South Africa", "Darling", "Darling"),
    ("South Africa", "Durbanville", "Durbanville"),

    # === Greece ===
    ("Greece", "Santorini", "Santorini"),
    ("Greece", "Naoussa", "Naoussa"),
    ("Greece", "Nemea", "Nemea"),
    ("Greece", "Crete", "Crete"),
    ("Greece", "Cephalonia", "Cephalonia"),
    ("Greece", "Samos", "Samos"),
    ("Greece", "Peloponnese", "Peloponnese"),

    # === Hungary ===
    ("Hungary", "Tokaj", "Tokaj"),
    ("Hungary", "Tokaji", "Tokaj"),
    ("Hungary", "Eger", "Eger"),
    ("Hungary", "Villány", "Villány"),
    ("Hungary", "Villany", "Villány"),
    ("Hungary", "Szekszárd", "Szekszárd"),
    ("Hungary", "Szekszard", "Szekszárd"),
    ("Hungary", "Sopron", "Sopron"),

    # === Georgia ===
    ("Georgia", "Kakheti", "Kakheti"),
    ("Georgia", "Kartli", "Kartli"),
    ("Georgia", "Imereti", "Imereti"),

    # === Romania ===
    ("Romania", "Dealu Mare", "Dealu Mare"),
    ("Romania", "Murfatlar", "Murfatlar"),
    ("Romania", "Drăgășani", "Drăgășani"),
    ("Romania", "Dragasani", "Drăgășani"),

    # === Croatia ===
    ("Croatia", "Istria", "Istria"),
    ("Croatia", "Dalmatia", "Dalmatia"),
    ("Croatia", "Slavonia", "Slavonia"),

    # === Slovenia ===
    ("Slovenia", "Goriška Brda", "Goriška Brda"),
    ("Slovenia", "Goriska Brda", "Goriška Brda"),

    # === Lebanon ===
    ("Lebanon", "Bekaa Valley", "Bekaa Valley"),
    ("Lebanon", "Bekaa", "Bekaa Valley"),
    ("Lebanon", "Batroun", "Batroun"),

    # === Israel ===
    ("Israel", "Golan Heights", "Golan Heights"),
    ("Israel", "Galilee", "Galilee"),
    ("Israel", "Judean Hills", "Judean Hills"),

    # === Japan ===
    ("Japan", "Yamanashi", "Yamanashi"),
    ("Japan", "Hokkaido", "Hokkaido"),
    ("Japan", "Nagano", "Nagano"),

    # === China ===
    ("China", "Ningxia", "Ningxia"),
    ("China", "Yantai", "Yantai"),
    ("China", "Xinjiang", "Xinjiang"),

    # === Canada ===
    ("Canada", "Niagara", "Niagara Peninsula"),
    ("Canada", "Okanagan", "Okanagan Valley"),
    ("Canada", "Prince Edward County", "Prince Edward County"),

    # === Uruguay ===
    ("Uruguay", "Canelones", "Canelones"),
    ("Uruguay", "Montevideo", "Montevideo"),

    # === Brazil ===
    ("Brazil", "Serra Gaúcha", "Serra Gaúcha"),
    ("Brazil", "Serra Gaucha", "Serra Gaúcha"),
    ("Brazil", "Vale dos Vinhedos", "Vale dos Vinhedos"),

    # === England ===
    ("England", "Sussex", "Sussex"),
    ("England", "Kent", "Kent"),
    ("England", "Hampshire", "Hampshire"),
    ("United Kingdom", "Sussex", "Sussex"),
    ("United Kingdom", "Kent", "Kent"),
    ("United Kingdom", "Hampshire", "Hampshire"),

    # === Spirits Regions ===
    (None, "Speyside", "Speyside"),
    (None, "Islay", "Islay"),
    (None, "Highland", "Highland"),
    (None, "Highlands", "Highland"),
    (None, "Lowland", "Lowland"),
    (None, "Lowlands", "Lowland"),
    (None, "Campbeltown", "Campbeltown"),
    (None, "Island", "Islands"),
    ("Scotland", "Speyside", "Speyside"),
    ("Scotland", "Islay", "Islay"),
    ("Scotland", "Highland", "Highland"),
    ("Scotland", "Highlands", "Highland"),
    ("Scotland", "Lowland", "Lowland"),
    ("Scotland", "Campbeltown", "Campbeltown"),
    ("Japan", "Nikka", "Japan"),
    ("Japan", "Suntory", "Japan"),
    (None, "Kentucky", "Kentucky"),
    (None, "Tennessee", "Tennessee"),
    (None, "Cognac", "Cognac"),
    (None, "Armagnac", "Armagnac"),
    (None, "Jalisco", "Jalisco"),
    (None, "Oaxaca", "Oaxaca"),
    (None, "Caribbean", "Caribbean"),
    (None, "Martinique", "Martinique"),
    (None, "Barbados", "Barbados"),
    (None, "Jamaica", "Jamaica"),
    (None, "Guyana", "Guyana"),
    (None, "Demerara", "Demerara"),

    # === Any-country fallbacks (common terms found in names/descriptions) ===
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
    (None, "Stellenbosch", "Stellenbosch"),
    (None, "Central Otago", "Central Otago"),
    (None, "Douro", "Douro"),
    (None, "Mosel", "Mosel"),
    (None, "Wachau", "Wachau"),
    (None, "Tokaj", "Tokaj"),
    (None, "Tokaji", "Tokaj"),
    (None, "Bekaa", "Bekaa Valley"),
]

# Pre-compile region patterns, longest keyword first for greedy matching
REGION_PATTERNS: list[tuple[str | None, re.Pattern, str]] = []
_sorted_regions = sorted(REGION_MAP, key=lambda x: len(x[1]), reverse=True)
for country, keyword, region in _sorted_regions:
    pat = re.compile(r'\b' + re.escape(keyword) + r'\b', re.IGNORECASE)
    REGION_PATTERNS.append((country, pat, region))


# ---------------------------------------------------------------------------
# 4. GRAPE VARIETIES (for brand extraction — strip grapes from name)
# ---------------------------------------------------------------------------
GRAPE_NAMES: list[str] = [
    "Cabernet Sauvignon", "Merlot", "Pinot Noir", "Syrah", "Shiraz",
    "Grenache", "Tempranillo", "Sangiovese", "Nebbiolo", "Malbec",
    "Zinfandel", "Primitivo", "Cabernet Franc", "Petit Verdot",
    "Mourvèdre", "Monastrell", "Barbera", "Gamay", "Pinotage",
    "Chardonnay", "Sauvignon Blanc", "Riesling", "Pinot Grigio",
    "Pinot Gris", "Gewürztraminer", "Gewurztraminer", "Viognier",
    "Chenin Blanc", "Sémillon", "Semillon", "Albariño", "Albarino",
    "Grüner Veltliner", "Gruner Veltliner", "Torrontés", "Torrontes",
    "Verdejo", "Vermentino", "Trebbiano", "Garganega", "Muscat",
    "Moscato", "Glera", "Prosecco", "Cortese", "Arneis", "Marsanne",
    "Roussanne", "Fiano", "Greco", "Godello", "Assyrtiko",
    "Carmenère", "Carmenere", "Tannat", "Nero d'Avola",
]

GRAPE_PATTERNS_BRAND: list[re.Pattern] = [
    re.compile(r'\b' + re.escape(g) + r'\b', re.IGNORECASE)
    for g in sorted(GRAPE_NAMES, key=len, reverse=True)
]


# ---------------------------------------------------------------------------
# Supabase helpers (same as pass 2)
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
# Extraction Functions
# ---------------------------------------------------------------------------

def extract_flavor_tags(desc_short: str, desc_full: str, desc_text: str) -> str | None:
    """Scan descriptions for flavor words. Returns comma-separated list or None."""
    combined = f"{desc_short} {desc_full} {desc_text}".strip()
    if not combined or len(combined) < 20:
        return None

    found: list[str] = []
    seen: set[str] = set()
    for pat, term in FLAVOR_PATTERNS:
        if pat.search(combined) and term not in seen:
            seen.add(term)
            # Capitalize nicely
            found.append(term.title() if len(term) > 2 else term.upper())

    # Need at least 2 flavors to be useful
    if len(found) < 2:
        return None

    # Cap at 10 flavors to keep it clean
    return ", ".join(found[:10])


def derive_food_matching(classification: str, style: str, body: str,
                         tannin: str, acidity: str, grape: str) -> str | None:
    """Derive food pairing from classification, style, body, and other attributes."""
    cl = (classification or "").lower()
    st = (style or "").lower()
    bd = (body or "").lower()
    tn = (tannin or "").lower()
    ac = (acidity or "").lower()
    gr = (grape or "").lower()

    # --- Spirits ---
    spirit = _classify_spirit(classification)
    if spirit:
        return FOOD_MAP_SPIRITS.get(spirit)

    # --- Wine types ---
    is_red = "red" in cl
    is_white = "white" in cl
    is_rose = "rose" in cl or "rosé" in cl
    is_sparkling = "sparkling" in cl or "champagne" in cl
    is_dessert = "dessert" in cl or "sweet" in cl or "ice wine" in cl or "icewine" in cl
    is_port = "port" in cl or "fortified" in cl
    is_orange = "orange" in cl

    if is_port:
        return FOOD_MAP_WINE["port"]
    if is_dessert:
        return FOOD_MAP_WINE["dessert"]
    if is_sparkling:
        return FOOD_MAP_WINE["sparkling"]
    if is_orange:
        return FOOD_MAP_WINE["orange"]
    if is_rose:
        return FOOD_MAP_WINE["rose"]

    if is_red:
        # Check body
        if "full" in bd or "high" in tn:
            return FOOD_MAP_WINE["red_full"]
        if "light" in bd:
            return FOOD_MAP_WINE["red_light"]
        if "medium" in bd:
            return FOOD_MAP_WINE["red_medium"]
        # Infer from grape variety
        full_body_grapes = ["cabernet sauvignon", "syrah", "shiraz", "nebbiolo",
                            "malbec", "tannat", "mourvèdre", "monastrell",
                            "touriga nacional", "aglianico", "petite sirah"]
        light_body_grapes = ["pinot noir", "gamay", "schiava", "frappato",
                             "dolcetto", "zweigelt", "trollinger"]
        if any(g in gr for g in full_body_grapes):
            return FOOD_MAP_WINE["red_full"]
        if any(g in gr for g in light_body_grapes):
            return FOOD_MAP_WINE["red_light"]
        return FOOD_MAP_WINE["red_medium"]  # medium as default for red

    if is_white:
        if "full" in bd:
            return FOOD_MAP_WINE["white_full"]
        if "light" in bd or "crisp" in st:
            return FOOD_MAP_WINE["white_light"]
        # Infer from grape
        full_body_whites = ["chardonnay", "viognier", "marsanne", "roussanne",
                            "sémillon", "semillon"]
        light_body_whites = ["sauvignon blanc", "riesling", "pinot grigio",
                             "pinot gris", "albariño", "albarino", "verdejo",
                             "grüner veltliner", "gruner veltliner", "muscadet",
                             "melon de bourgogne", "vermentino", "assyrtiko"]
        if any(g in gr for g in full_body_whites):
            return FOOD_MAP_WINE["white_full"]
        if any(g in gr for g in light_body_whites):
            return FOOD_MAP_WINE["white_light"]
        return FOOD_MAP_WINE["white_default"]

    # Generic fallback for wine-like products
    if any(w in cl for w in ["wine", "fruit wine"]):
        return FOOD_MAP_WINE["red_default"]

    return None


def extract_region_pass3(name: str, country: str | None,
                         desc_short: str, desc_full: str,
                         desc_text: str) -> str | None:
    """Extract region from name and all description fields."""
    country_str = (country or "").strip()
    texts = [name, desc_short or "", desc_full or "", desc_text or ""]
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


def extract_brand_pass3(name: str, known_brands: set[str],
                        grape: str, region: str) -> str | None:
    """Extract brand from product name using multiple strategies."""
    if not name:
        return None

    # Strategy 1: Match against known brands in the catalog
    best_brand = None
    best_len = 0
    for kb in known_brands:
        if len(kb) < 3:
            continue
        try:
            if re.search(r'\b' + re.escape(kb) + r'\b', name, re.IGNORECASE) and len(kb) > best_len:
                best_brand = kb
                best_len = len(kb)
        except re.error:
            continue
    if best_brand:
        return best_brand

    # Strategy 2: Before double space
    if "  " in name:
        candidate = name.split("  ")[0].strip()
        if 2 < len(candidate) < 50:
            return candidate

    # Strategy 3: Strip known components from name to isolate brand
    working = name.strip()

    # Remove vintage year
    working = re.sub(r'\b(19[89]\d|20[0-2]\d)\b', '', working)

    # Remove grape variety names
    for gpat in GRAPE_PATTERNS_BRAND:
        working = gpat.sub('', working)

    # Remove region name if known
    if region:
        working = re.sub(r'\b' + re.escape(region) + r'\b', '', working, flags=re.IGNORECASE)

    # Remove common wine terms
    wine_terms = [
        r'\bReserva?\b', r'\bGran Reserva\b', r'\bRiserva\b',
        r'\bClassico\b', r'\bSuperiore\b', r'\bVigna\b',
        r'\bCru\b', r'\bGrand Cru\b', r'\bPremier Cru\b',
        r'\b1er Cru\b', r'\bCrianza\b', r'\bJoven\b',
        r'\bBarrel\b', r'\bSelection\b', r'\bS[eé]lection\b',
        r'\bCuvée?\b', r'\bCuvee\b', r'\bPrestige\b',
        r'\bLimited Edition\b', r'\bVintage\b', r'\bEstate\b',
        r'\bSingle Vineyard\b', r'\bOld Vine\b', r'\bOld Vines?\b',
        r'\bWinery\b', r'\bVineyards?\b', r'\bCellars?\b',
        r'\bCh[aâ]teau\b', r'\bDomaine\b', r'\bBodega\b',
        r'\bTenuta\b', r'\bAzienda\b', r'\bMas\b',
        r'\bQuinta\b', r'\bHerdade\b',
        r'\bred\b', r'\bwhite\b', r'\brose\b', r'\brosé\b',
        r'\bblanc\b', r'\bnoir\b', r'\brouge\b',
        r'\bdry\b', r'\bsweet\b', r'\bbrut\b',
        r'\b750ml\b', r'\b375ml\b', r'\b1\.5L\b', r'\b1L\b',
    ]
    for wt in wine_terms:
        working = re.sub(wt, '', working, flags=re.IGNORECASE)

    # Clean up multiple spaces and punctuation
    working = re.sub(r'[,\-–—/]+', ' ', working)
    working = re.sub(r'\s+', ' ', working).strip()

    # Strategy 4: First 1-3 capitalized words
    m = re.match(r'^([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+(?:de|di|del|la|le|les|du|da|von|van|der|den|dos|das|et)\s+)?(?:[A-ZÀ-ÿ][a-zà-ÿ]+)?(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+)?)', working)
    if m:
        candidate = m.group(1).strip()
        # Reject if too short or generic
        generic_words = {
            "the", "wine", "red", "white", "rose", "dry", "sweet",
            "brut", "extra", "grand", "petit", "vino", "vin",
        }
        if len(candidate) > 3 and candidate.lower() not in generic_words:
            return candidate

    return None


def should_set_nv(classification: str, name: str, style: str) -> bool:
    """Determine if a product should get vintage 'NV' (non-vintage)."""
    cl = (classification or "").lower()
    nm = (name or "").lower()
    st = (style or "").lower()

    # Champagne NV
    if "champagne" in cl and "nv" not in nm:
        # If there's no year in the name, it's NV
        if not re.search(r'\b(19[89]\d|20[0-2]\d)\b', nm):
            return True

    # Sparkling wine without year
    if "sparkling" in cl:
        if not re.search(r'\b(19[89]\d|20[0-2]\d)\b', nm):
            return True

    # Port wine (many are NV blends)
    if "port" in cl:
        # Vintage ports have years, others are NV
        if not re.search(r'\b(19[89]\d|20[0-2]\d)\b', nm):
            return True

    # Fortified wines (Sherry, Madeira, Vermouth)
    fortified_terms = ["sherry", "madeira", "vermouth", "fortified"]
    if any(ft in cl for ft in fortified_terms) or any(ft in nm for ft in fortified_terms):
        if not re.search(r'\b(19[89]\d|20[0-2]\d)\b', nm):
            return True

    # All spirits are NV
    spirit = _classify_spirit(classification)
    if spirit:
        if not re.search(r'\b(19[89]\d|20[0-2]\d)\b', nm):
            return True

    # Products explicitly marked NV in name
    if re.search(r'\bN\.?V\.?\b', nm):
        return True

    return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Pass 3: fill remaining gaps for 90+ quality score")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--tier", type=int, default=0, help="Tier to process (0=all)")
    args = parser.parse_args()

    print(f"=== Pass 3 — Gap-Fill Extraction (Target: 90+ Quality Score) ===", flush=True)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}", flush=True)
    print(f"Tier filter: {'all' if args.tier == 0 else args.tier}", flush=True)
    print(flush=True)

    # --- Fetch products ---
    select_fields = ",".join([
        "sku", "name", "classification", "variety", "vintage", "brand",
        "region", "country", "style", "desc_en_short", "desc_en_full",
        "short_description_en", "description_en_text",
        "flavor_tags", "food_matching", "body", "acidity", "tannin",
        "enrichment_priority",
    ])
    query = f"products?select={select_fields}&order=sku"
    if args.tier > 0:
        query += f"&enrichment_priority=eq.{args.tier}"

    print("Fetching products...", flush=True)
    products = sb_get_all(query)
    print(f"Total products fetched: {len(products)}", flush=True)
    print(flush=True)

    # --- Before counts ---
    total = len(products)
    TRACKED_FIELDS = ["flavor_tags", "food_matching", "region", "brand", "vintage"]
    before: dict[str, int] = {}
    for field in TRACKED_FIELDS:
        before[field] = sum(1 for p in products if (p.get(field) or "").strip())

    print(f"=== Before Counts (of {total} products) ===", flush=True)
    for field in TRACKED_FIELDS:
        count = before[field]
        missing = total - count
        pct = (count / total * 100) if total else 0
        print(f"  {field}: {count}/{total} ({pct:.1f}%) filled — {missing} missing", flush=True)
    print(flush=True)

    # --- Build known brand list ---
    print("Building known brand list from existing data...", flush=True)
    known_brands: set[str] = set()
    for p in products:
        b = (p.get("brand") or "").strip()
        if b and len(b) > 2:
            known_brands.add(b)
    print(f"Known brands: {len(known_brands)}", flush=True)
    print(flush=True)

    # --- Process ---
    updates: list[tuple[str, dict]] = []
    stats = {f: 0 for f in TRACKED_FIELDS}
    stats["products_with_updates"] = 0

    for i, p in enumerate(products):
        sku = p.get("sku", "")
        name = (p.get("name") or "").strip()
        classification = (p.get("classification") or "").strip()
        country = (p.get("country") or "").strip()
        region_current = (p.get("region") or "").strip()
        grape_current = (p.get("variety") or "").strip()
        style_current = (p.get("style") or "").strip()
        body = (p.get("body") or "").strip()
        tannin = (p.get("tannin") or "").strip()
        acidity = (p.get("acidity") or "").strip()
        desc_short = (p.get("desc_en_short") or p.get("short_description_en") or "").strip()
        desc_full = (p.get("desc_en_full") or "").strip()
        desc_text = (p.get("description_en_text") or "").strip()

        if not name or not sku:
            continue

        patch: dict = {}

        # ---- 1. Flavor Tags ----
        if not (p.get("flavor_tags") or "").strip():
            flavors = extract_flavor_tags(desc_short, desc_full, desc_text)
            if flavors:
                patch["flavor_tags"] = flavors
                stats["flavor_tags"] += 1

        # ---- 2. Food Matching ----
        if not (p.get("food_matching") or "").strip():
            food = derive_food_matching(classification, style_current, body,
                                        tannin, acidity, grape_current)
            if food:
                patch["food_matching"] = food
                stats["food_matching"] += 1

        # ---- 3. Region (deeper mining) ----
        if not region_current:
            region = extract_region_pass3(name, country, desc_short, desc_full, desc_text)
            if region:
                patch["region"] = region
                stats["region"] += 1

        # ---- 4. Brand ----
        if not (p.get("brand") or "").strip():
            brand = extract_brand_pass3(name, known_brands, grape_current, region_current)
            if brand:
                patch["brand"] = brand
                stats["brand"] += 1

        # ---- 5. Vintage — NV defaults ----
        if not (p.get("vintage") or "").strip():
            if should_set_nv(classification, name, style_current):
                patch["vintage"] = "NV"
                stats["vintage"] += 1

        if patch:
            updates.append((sku, patch))
            stats["products_with_updates"] += 1

        if (i + 1) % 500 == 0:
            print(f"Processed {i+1}/{len(products)} — "
                  f"flavors={stats['flavor_tags']}, food={stats['food_matching']}, "
                  f"regions={stats['region']}, brands={stats['brand']}, "
                  f"vintages={stats['vintage']}", flush=True)

    print(flush=True)
    print(f"=== Extraction Complete ===", flush=True)
    print(f"Products processed: {total}", flush=True)
    print(f"Products with updates: {stats['products_with_updates']}", flush=True)
    for field in TRACKED_FIELDS:
        print(f"  {field}: +{stats[field]}", flush=True)
    print(flush=True)

    # --- After projection ---
    print(f"=== Projected Coverage ===", flush=True)
    for field in TRACKED_FIELDS:
        b = before[field]
        a = b + stats[field]
        bp = (b / total * 100) if total else 0
        ap = (a / total * 100) if total else 0
        delta = stats[field]
        print(f"  {field}: {b} ({bp:.1f}%) -> {a} ({ap:.1f}%)  [+{delta}]", flush=True)
    print(flush=True)

    # --- Sample updates ---
    if updates:
        print("=== Sample Updates (first 20) ===", flush=True)
        for sku, patch in updates[:20]:
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
