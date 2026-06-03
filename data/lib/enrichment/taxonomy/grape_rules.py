"""Grape variety inference from product name + classification.

Layer 1 (zero API cost): appellation -> dominant grape mapping,
plus explicit grape name detection in the product name.

Returns: {"grapes": [...], "confidence": 0.0-1.0, "source": "appellation"|"name_keyword"|"classification_default"|""}
"""
from __future__ import annotations
import re
import unicodedata

# Classifications that don't have grape varieties
_NO_GRAPE_CLASSIFICATIONS = {
    "Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Brandy",
    "Sake/Shochu", "Beer", "Liqueur", "RTD", "Glassware", "Accessories",
    "Cigar", "Others", "Non-Alcoholic", "Mineral Water",
}

# Known grape variety keywords (canonical name -> regex pattern)
_GRAPE_KEYWORDS: list[tuple[str, str]] = [
    ("Cabernet Sauvignon", r"\bcabernet\s+sauvignon\b|\bcab\s+sauv\b"),
    ("Merlot",             r"\bmerlot\b"),
    ("Pinot Noir",         r"\bpinot\s+noir\b"),
    ("Chardonnay",         r"\bchardonnay\b"),
    ("Sauvignon Blanc",    r"\bsauvignon\s+blanc\b|\bsauv\s+blanc\b"),
    ("Riesling",           r"\briesling\b"),
    ("Shiraz",             r"\bshiraz\b"),
    ("Syrah",              r"\bsyrah\b"),
    ("Grenache",           r"\bgrenache\b|\bgarnacha\b"),
    ("Tempranillo",        r"\btempranillo\b"),
    ("Sangiovese",         r"\bsangiovese\b|\bchianti\b|\bbrunello\b"),
    ("Nebbiolo",           r"\bnebbiolo\b|\bbarolo\b|\bbarbaresco\b"),
    ("Malbec",             r"\bmalbec\b"),
    ("Pinot Gris",         r"\bpinot\s+gris\b|\bpinot\s+grigio\b"),
    ("Viognier",           r"\bviognier\b"),
    ("Albariño",           r"\balbari[nñ]o\b"),
    ("Gewurztraminer",     r"\bgewurztraminer\b|\bgewürztraminer\b"),
    ("Grüner Veltliner",   r"\bgr[uü]ner\s+veltliner\b"),
    ("Chenin Blanc",       r"\bchenin\s+blanc\b|\bchenin\b"),
    ("Muscat",             r"\bmuscat\b|\bmoscato\b"),
    ("Zinfandel",          r"\bzinfandel\b"),
    ("Touriga Nacional",   r"\btouriga\s+nacional\b"),
    ("Carménère",          r"\bcarmenere\b|carménère"),
    ("Petit Verdot",       r"\bpetit\s+verdot\b"),
    ("Cabernet Franc",     r"\bcabernet\s+franc\b"),
    ("Viura",              r"\bviura\b|\bmacabeo\b"),
    ("Torrontés",          r"\btorront[eé]s\b"),
    ("Montepulciano",      r"\bmontepulciano\b"),
    ("Trebbiano",          r"\btrebbiano\b"),
    ("Vermentino",         r"\bvermentino\b"),
    ("Pecorino",           r"\bpecorino\b"),
    ("Fiano",              r"\bfiano\b"),
    ("Greco",              r"\bgreco\b"),
    ("Aglianico",          r"\baglianico\b"),
    ("Nero d'Avola",       r"\bnero\s+d.avola\b"),
    ("Primitivo",          r"\bprimitivo\b"),
    ("Falanghina",         r"\bfalanghina\b"),
    ("Pinot Blanc",        r"\bpinot\s+blanc\b"),
    ("Marsanne",           r"\bmarsanne\b"),
    ("Roussanne",          r"\brousanne\b"),
]

# Appellation -> (grapes, confidence)
_APPELLATION_GRAPES: list[tuple[str, list[str], float]] = [
    # Bordeaux reds
    ("pauillac",            ["Cabernet Sauvignon"], 0.92),
    ("saint.julien",        ["Cabernet Sauvignon"], 0.90),
    ("margaux",             ["Cabernet Sauvignon"], 0.90),
    ("saint.estephe",       ["Cabernet Sauvignon"], 0.90),
    ("st.emilion",          ["Merlot"],             0.88),
    ("saint.emilion",       ["Merlot"],             0.88),
    ("pomerol",             ["Merlot"],             0.92),
    ("haut.medoc",          ["Cabernet Sauvignon"], 0.85),
    # Burgundy
    ("gevrey.chambertin",   ["Pinot Noir"],         0.95),
    ("chambolle.musigny",   ["Pinot Noir"],         0.95),
    ("vosne.romanee",       ["Pinot Noir"],         0.97),
    ("nuits.saint.georges", ["Pinot Noir"],         0.95),
    ("pommard",             ["Pinot Noir"],         0.93),
    ("volnay",              ["Pinot Noir"],         0.93),
    ("meursault",           ["Chardonnay"],         0.95),
    ("puligny.montrachet",  ["Chardonnay"],         0.97),
    ("chassagne.montrachet",["Chardonnay"],         0.97),
    ("chablis",             ["Chardonnay"],         0.95),
    ("pouilly.fuisse",      ["Chardonnay"],         0.93),
    # Rhone
    ("chateauneuf.du.pape", ["Grenache", "Syrah"],  0.85),
    ("hermitage",           ["Syrah"],              0.90),
    ("cote.rotie",          ["Syrah"],              0.93),
    ("condrieu",            ["Viognier"],           0.95),
    # Champagne default
    ("champagne",           ["Pinot Noir", "Chardonnay", "Pinot Meunier"], 0.70),
    # Alsace
    ("alsace",              ["Riesling"],           0.65),
    # Germany
    ("mosel",               ["Riesling"],           0.90),
    ("rheingau",            ["Riesling"],           0.88),
    # Italy
    ("barolo",              ["Nebbiolo"],           0.97),
    ("barbaresco",          ["Nebbiolo"],           0.97),
    ("brunello",            ["Sangiovese"],         0.97),
    ("chianti",             ["Sangiovese"],         0.92),
    ("amarone",             ["Corvina", "Rondinella"], 0.95),
    ("valpolicella",        ["Corvina"],            0.90),
    # Spain
    ("rioja",               ["Tempranillo"],        0.85),
    ("ribera.del.duero",    ["Tempranillo"],        0.90),
    # Argentina
    ("mendoza",             ["Malbec"],             0.80),
    # New Zealand
    ("marlborough",         ["Sauvignon Blanc"],    0.85),
    # Australia
    ("barossa",             ["Shiraz"],             0.85),
    ("clare.valley",        ["Riesling"],           0.85),
    ("coonawarra",          ["Cabernet Sauvignon"], 0.85),
    ("hunter.valley",       ["Semillon"],           0.80),
]

_GRAPE_COMPILED = [
    (name, re.compile(pat, re.IGNORECASE))
    for name, pat in _GRAPE_KEYWORDS
]

_APPELLATION_COMPILED = [
    (
        re.compile(
            rf"\b{re.escape(kw)}\b".replace(r"\.", r"[\s\.\-]"),
            re.IGNORECASE,
        ),
        grapes,
        conf,
    )
    for kw, grapes, conf in _APPELLATION_GRAPES
]

_CHAMPAGNE_CLASSIFICATIONS = {"Champagne", "Sparkling Wine"}


def _norm(name: str) -> str:
    """Normalize to lowercase ASCII-folded string for matching."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def infer_grape(name: str, classification: str) -> dict:
    """Infer grape variety from product name and classification.

    Args:
        name: Product name string.
        classification: Product classification (e.g. "Red Wine", "Champagne").

    Returns:
        Dict with keys:
          - grapes: list of inferred grape variety names (canonical)
          - confidence: float 0.0-1.0
          - source: "appellation" | "name_keyword" | "classification_default" | ""
    """
    if classification in _NO_GRAPE_CLASSIFICATIONS:
        return {"grapes": [], "confidence": 0.0, "source": ""}

    normed = _norm(name)

    # 1. Appellation -> grape (highest priority, most specific)
    best_grapes: list[str] = []
    best_conf = 0.0
    best_source = ""
    for pat, grapes, conf in _APPELLATION_COMPILED:
        if pat.search(normed):
            if conf > best_conf:
                best_grapes = grapes
                best_conf = conf
                best_source = "appellation"

    # 2. Explicit grape keyword in name
    keyword_grapes: list[str] = []
    for grape_name, pat in _GRAPE_COMPILED:
        if pat.search(normed):
            keyword_grapes.append(grape_name)
    if keyword_grapes and (not best_grapes or 0.78 > best_conf):
        best_grapes = keyword_grapes
        best_conf = 0.78
        best_source = "name_keyword"

    # 3. Classification default for Champagne (when no other signal)
    if not best_grapes and classification in _CHAMPAGNE_CLASSIFICATIONS:
        best_grapes = ["Pinot Noir", "Chardonnay", "Pinot Meunier"]
        best_conf = 0.60
        best_source = "classification_default"

    return {"grapes": best_grapes, "confidence": round(best_conf, 2), "source": best_source}
