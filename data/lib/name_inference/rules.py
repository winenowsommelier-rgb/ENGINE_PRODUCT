"""
Name-based geography inference.

Given a product name, return the most specific (country, region, subregion) triple
the name's keywords imply, plus a confidence score. Longest-match wins; rules fire
independently for each level so partial matches still contribute.

Rules are tuples: (pattern, country, region, subregion, confidence, kind)
  - pattern: case-insensitive regex matched against a normalized product name
  - confidence: 0-1, higher = more specific/reliable
  - kind: 'appellation' | 'region' | 'country' | 'producer_prefix'

Each level (country/region/subregion) takes the HIGHEST-confidence hit across all
matching rules. If a deeper level (subregion) fires, it back-fills region and country
from its own triple, overriding weaker upstream signals.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable


def _norm(name: str) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return f" {s.strip()} "  # pad for whole-word anchoring


# ---- Appellation → (country, region, subregion) ----
# Format: list of (keyword_or_pattern, country, region, subregion, confidence)
APPELLATIONS: list[tuple[str, str, str, str, float]] = [
    # France / Bordeaux
    ("pauillac",                    "France", "Bordeaux", "Pauillac",            0.95),
    ("margaux",                     "France", "Bordeaux", "Margaux",             0.92),
    ("saint julien",                "France", "Bordeaux", "Saint-Julien",        0.95),
    ("st julien",                   "France", "Bordeaux", "Saint-Julien",        0.92),
    ("saint estephe",               "France", "Bordeaux", "Saint-Estèphe",       0.95),
    ("st estephe",                  "France", "Bordeaux", "Saint-Estèphe",       0.92),
    ("saint emilion",               "France", "Bordeaux", "Saint-Émilion",       0.95),
    ("st emilion",                  "France", "Bordeaux", "Saint-Émilion",       0.92),
    ("pomerol",                     "France", "Bordeaux", "Pomerol",             0.95),
    ("haut medoc",                  "France", "Bordeaux", "Haut-Médoc",          0.95),
    ("medoc",                       "France", "Bordeaux", "Médoc",               0.88),
    ("pessac leognan",              "France", "Bordeaux", "Pessac-Léognan",      0.95),
    ("graves",                      "France", "Bordeaux", "Graves",              0.80),
    ("sauternes",                   "France", "Bordeaux", "Sauternes",           0.93),
    ("barsac",                      "France", "Bordeaux", "Barsac",              0.90),
    ("fronsac",                     "France", "Bordeaux", "Fronsac",             0.90),
    ("lussac saint emilion",        "France", "Bordeaux", "Lussac-Saint-Emilion",0.97),
    ("listrac medoc",               "France", "Bordeaux", "Listrac-Médoc",       0.95),
    ("moulis",                      "France", "Bordeaux", "Moulis-en-Médoc",     0.90),
    # France / Burgundy
    ("gevrey chambertin",           "France", "Burgundy", "Gevrey-Chambertin",   0.97),
    ("chambolle musigny",           "France", "Burgundy", "Chambolle-Musigny",   0.97),
    ("vosne romanee",               "France", "Burgundy", "Vosne-Romanée",       0.97),
    ("nuits saint georges",         "France", "Burgundy", "Nuits-Saint-Georges", 0.97),
    ("morey saint denis",           "France", "Burgundy", "Morey-Saint-Denis",   0.97),
    ("puligny montrachet",          "France", "Burgundy", "Puligny-Montrachet",  0.97),
    ("chassagne montrachet",        "France", "Burgundy", "Chassagne-Montrachet",0.97),
    ("aloxe corton",                "France", "Burgundy", "Aloxe-Corton",        0.95),
    ("corton charlemagne",          "France", "Burgundy", "Corton-Charlemagne",  0.97),
    ("chevalier montrachet",        "France", "Burgundy", "Chevalier-Montrachet",0.97),
    ("meursault",                   "France", "Burgundy", "Meursault",           0.95),
    ("pommard",                     "France", "Burgundy", "Pommard",             0.93),
    ("volnay",                      "France", "Burgundy", "Volnay",              0.93),
    ("santenay",                    "France", "Burgundy", "Santenay",            0.92),
    ("saint aubin",                 "France", "Burgundy", "Saint-Aubin",         0.92),
    ("vougeot",                     "France", "Burgundy", "Vougeot",             0.93),
    ("beaune",                      "France", "Burgundy", "",                    0.70),
    ("chablis",                     "France", "Burgundy", "",                    0.95),
    ("pouilly fuisse",              "France", "Burgundy", "",                    0.93),
    ("cote de nuits",               "France", "Burgundy", "Côte de Nuits",       0.93),
    ("cote de beaune",              "France", "Burgundy", "Côte de Beaune",      0.93),
    ("cote chalonnaise",            "France", "Burgundy", "Côte Chalonnaise",    0.93),
    ("maconnais",                   "France", "Burgundy", "Mâconnais",           0.92),
    ("beaujolais",                  "France", "Beaujolais", "",                  0.93),
    # France / Champagne
    ("champagne",                   "France", "Champagne", "",                   0.85),
    # France / Rhône
    ("chateauneuf du pape",         "France", "Rhône Valley", "",                0.97),
    ("hermitage",                   "France", "Rhône Valley", "",                0.90),
    ("cote rotie",                  "France", "Rhône Valley", "",                0.93),
    ("gigondas",                    "France", "Rhône Valley", "",                0.95),
    ("vacqueyras",                  "France", "Rhône Valley", "",                0.95),
    ("cornas",                      "France", "Rhône Valley", "",                0.93),
    ("cotes du rhone",              "France", "Rhône Valley", "",                0.92),
    # France / Loire
    ("sancerre",                    "France", "Loire Valley", "Sancerre",        0.95),
    ("pouilly fume",                "France", "Loire Valley", "Pouilly-Fumé",    0.95),
    ("vouvray",                     "France", "Loire Valley", "Vouvray",         0.93),
    ("muscadet",                    "France", "Loire Valley", "Muscadet",        0.93),
    ("chinon",                      "France", "Loire Valley", "Chinon",          0.92),
    ("bourgueil",                   "France", "Loire Valley", "",                0.93),
    # France / Provence
    ("bandol",                      "France", "Provence", "Bandol",              0.95),
    ("cassis",                      "France", "Provence", "Cassis",              0.80),
    ("les baux de provence",        "France", "Provence", "Les Baux-de-Provence",0.97),
    ("cotes de provence",           "France", "Provence", "Côtes de Provence",   0.93),
    # France / Alsace
    ("alsace",                      "France", "Alsace", "",                      0.90),
    # France / Languedoc / Southwest
    ("languedoc",                   "France", "Languedoc-Roussillon", "",        0.88),
    ("minervois",                   "France", "Languedoc-Roussillon", "",        0.92),
    ("corbieres",                   "France", "Languedoc-Roussillon", "",        0.92),
    ("cahors",                      "France", "Southwest France", "",            0.92),
    ("madiran",                     "France", "Southwest France", "",            0.92),
    ("bergerac",                    "France", "Southwest France", "",            0.90),
    # France / Cognac / Armagnac
    ("cognac",                      "France", "Cognac", "",                      0.92),
    ("armagnac",                    "France", "Armagnac", "",                    0.92),
    # France / Bordeaux (city-level)
    ("bordeaux",                    "France", "Bordeaux", "",                    0.75),
    ("burgundy",                    "France", "Burgundy", "",                    0.75),
    ("bourgogne",                   "France", "Burgundy", "",                    0.80),

    # Italy / Piedmont
    ("barolo",                      "Italy", "Piedmont", "Barolo",               0.95),
    ("barbaresco",                  "Italy", "Piedmont", "Barbaresco",           0.95),
    ("gattinara",                   "Italy", "Piedmont", "Gattinara",            0.93),
    ("gavi",                        "Italy", "Piedmont", "Gavi",                 0.90),
    ("barbera d alba",              "Italy", "Piedmont", "Barbera d'Alba",       0.95),
    ("barbera d asti",              "Italy", "Piedmont", "Barbera d'Asti",       0.95),
    ("dolcetto d alba",             "Italy", "Piedmont", "Dolcetto d'Alba",      0.95),
    ("nebbiolo d alba",             "Italy", "Piedmont", "",                     0.90),
    ("langhe",                      "Italy", "Piedmont", "Langhe",               0.88),
    ("roero",                       "Italy", "Piedmont", "Roero",                0.88),
    ("moscato d asti",              "Italy", "Piedmont", "",                     0.93),
    ("asti spumante",               "Italy", "Piedmont", "",                     0.93),
    # Italy / Tuscany
    ("brunello di montalcino",      "Italy", "Tuscany", "Brunello di Montalcino",0.97),
    ("rosso di montalcino",         "Italy", "Tuscany", "Rosso di Montalcino",   0.97),
    ("vino nobile di montepulciano","Italy", "Tuscany", "Vino Nobile di Montepulciano",0.97),
    ("chianti classico",            "Italy", "Tuscany", "Chianti Classico",      0.95),
    ("chianti riserva",             "Italy", "Tuscany", "Chianti",               0.90),
    ("chianti",                     "Italy", "Tuscany", "Chianti",               0.88),
    ("bolgheri",                    "Italy", "Tuscany", "Bolgheri",              0.95),
    ("maremma",                     "Italy", "Tuscany", "Maremma",               0.90),
    ("montalcino",                  "Italy", "Tuscany", "Montalcino",            0.85),
    ("montepulciano",               "Italy", "Tuscany", "Montepulciano",         0.75),  # ambiguous (d'Abruzzo)
    # Italy / Veneto
    ("amarone della valpolicella",  "Italy", "Veneto", "Amarone della Valpolicella",0.97),
    ("amarone",                     "Italy", "Veneto", "Amarone della Valpolicella",0.92),
    ("valpolicella ripasso",        "Italy", "Veneto", "Valpolicella Ripasso",   0.95),
    ("valpolicella",                "Italy", "Veneto", "Valpolicella",           0.90),
    ("ripasso",                     "Italy", "Veneto", "Valpolicella Ripasso",   0.82),
    ("soave",                       "Italy", "Veneto", "Soave",                  0.92),
    ("bardolino",                   "Italy", "Veneto", "Bardolino",              0.92),
    ("prosecco",                    "Italy", "Veneto", "Prosecco",               0.88),
    # Italy / Abruzzo
    ("montepulciano d abruzzo",     "Italy", "Abruzzo", "Montepulciano d’Abruzzo",0.97),
    ("trebbiano d abruzzo",         "Italy", "Abruzzo", "Trebbiano d'Abruzzo",   0.95),
    # Italy / Friuli
    ("friuli",                      "Italy", "Friuli-Venezia Giulia", "",        0.88),
    ("collio",                      "Italy", "Friuli-Venezia Giulia", "",        0.88),
    # Italy / Sicily
    ("etna",                        "Italy", "Sicily", "",                       0.85),
    ("nero d avola",                "Italy", "Sicily", "",                       0.85),
    # Italy / Others
    ("lambrusco",                   "Italy", "Emilia-Romagna", "",               0.88),
    ("franciacorta",                "Italy", "Lombardy", "",                     0.95),
    ("vermentino",                  "Italy", "Sardinia", "",                     0.55),  # ambiguous

    # Spain
    ("rioja",                       "Spain", "Rioja", "",                        0.92),
    ("ribera del duero",            "Spain", "Ribera del Duero", "",             0.95),
    ("rias baixas",                 "Spain", "Rías Baixas", "",                  0.95),
    ("priorat",                     "Spain", "Priorat", "",                      0.95),
    ("rueda",                       "Spain", "Rueda", "",                        0.92),
    ("toro",                        "Spain", "Toro", "",                         0.85),
    ("la mancha",                   "Spain", "La Mancha", "",                    0.90),
    ("penedes",                     "Spain", "Catalunya", "",                    0.88),
    ("jerez",                       "Spain", "Jerez", "",                        0.92),
    ("sherry",                      "Spain", "Jerez", "",                        0.90),
    ("cava",                        "Spain", "Catalunya", "",                    0.85),
    ("albarino",                    "Spain", "Rías Baixas", "",                  0.80),

    # Portugal
    ("douro",                       "Portugal", "", "",                          0.90),
    ("porto",                       "Portugal", "", "",                          0.85),
    ("vinho verde",                 "Portugal", "", "",                          0.92),
    ("alentejo",                    "Portugal", "", "",                          0.92),
    ("dao",                         "Portugal", "", "",                          0.70),

    # USA
    ("napa valley",                 "USA", "California", "Napa Valley",          0.95),
    ("napa ",                       "USA", "California", "Napa Valley",          0.85),
    ("sonoma coast",                "USA", "California", "Sonoma",               0.93),
    ("russian river",               "USA", "California", "Russian River Valley", 0.95),
    ("alexander valley",            "USA", "California", "Alexander Valley",     0.95),
    ("sonoma",                      "USA", "California", "Sonoma",               0.88),
    ("paso robles",                 "USA", "California", "Paso Robles",          0.95),
    ("santa barbara",               "USA", "California", "Santa Barbara",        0.90),
    ("willamette",                  "USA", "Oregon", "Willamette Valley",        0.95),
    ("columbia valley",             "USA", "Washington", "Columbia Valley",      0.95),
    ("finger lakes",                "USA", "New York", "Finger Lakes",           0.95),
    ("kentucky bourbon",            "USA", "Kentucky", "",                       0.95),
    ("tennessee whiskey",           "USA", "Tennessee", "",                      0.95),
    ("bourbon",                     "USA", "Kentucky", "",                       0.70),
    ("california",                  "USA", "California", "",                     0.80),
    ("oregon",                      "USA", "Oregon", "",                         0.80),
    ("washington state",            "USA", "Washington", "",                     0.85),

    # Australia
    ("barossa valley",              "Australia", "Barossa Valley", "",           0.95),
    ("barossa",                     "Australia", "Barossa Valley", "",           0.88),
    ("mclaren vale",                "Australia", "McLaren Vale", "",             0.95),
    ("clare valley",                "Australia", "Clare Valley", "",             0.95),
    ("eden valley",                 "Australia", "Eden Valley", "",              0.95),
    ("coonawarra",                  "Australia", "Coonawarra", "",               0.95),
    ("hunter valley",               "Australia", "Hunter Valley", "",            0.95),
    ("adelaide hills",              "Australia", "Adelaide Hills", "",           0.95),
    ("yarra valley",                "Australia", "Yarra Valley", "",             0.95),
    ("margaret river",              "Australia", "Margaret River", "",           0.95),
    ("mornington peninsula",        "Australia", "Mornington Peninsula", "",     0.95),
    ("tasmania",                    "Australia", "Tasmania", "",                 0.90),
    ("south eastern australia",     "Australia", "South Eastern Australia", "",  0.92),

    # New Zealand
    ("marlborough",                 "New Zealand", "", "",                       0.92),
    ("central otago",               "New Zealand", "", "",                       0.95),
    ("hawke s bay",                 "New Zealand", "Hawke's Bay", "",            0.95),
    ("martinborough",               "New Zealand", "Martinborough", "",          0.95),

    # Chile
    ("maipo valley",                "Chile", "Maipo Valley", "",                 0.95),
    ("casablanca valley",           "Chile", "Casablanca Valley", "",            0.95),
    ("colchagua valley",            "Chile", "Colchagua Valley", "",             0.95),
    ("colchagua",                   "Chile", "Colchagua Valley", "",             0.90),
    ("maule valley",                "Chile", "Maule Valley", "",                 0.95),
    ("rapel valley",                "Chile", "Rapel Valley", "",                 0.93),
    ("curico valley",               "Chile", "Curico Valley", "",                0.93),
    ("aconcagua",                   "Chile", "Aconcagua Valley", "",             0.90),
    ("leyda valley",                "Chile", "", "",                             0.90),

    # Argentina
    ("mendoza",                     "Argentina", "", "",                         0.92),
    ("uco valley",                  "Argentina", "", "",                         0.95),
    ("salta",                       "Argentina", "", "",                         0.85),
    ("patagonia",                   "Argentina", "", "",                         0.80),

    # South Africa
    ("stellenbosch",                "South Africa", "Stellenbosch", "",          0.95),
    ("paarl",                       "South Africa", "Paarl", "",                 0.92),
    ("swartland",                   "South Africa", "Swartland", "",             0.93),
    ("walker bay",                  "South Africa", "Walker Bay", "",            0.93),
    ("western cape",                "South Africa", "Western Cape", "",          0.92),
    ("constantia",                  "South Africa", "", "",                      0.88),

    # Germany
    ("mosel",                       "Germany", "", "",                           0.92),
    ("rheingau",                    "Germany", "", "",                           0.93),
    ("pfalz",                       "Germany", "", "",                           0.92),
    ("rheinhessen",                 "Germany", "Rheinhessen", "",                0.93),
    ("nahe",                        "Germany", "", "",                           0.85),
    ("baden",                       "Germany", "Baden", "",                      0.85),

    # Austria
    ("wachau",                      "Austria", "Wachau", "",                     0.95),
    ("kamptal",                     "Austria", "Kamptal", "",                    0.95),
    ("kremstal",                    "Austria", "Kremstal", "",                   0.95),
    ("gruner veltliner",            "Austria", "", "",                           0.75),

    # Greece
    ("santorini",                   "Greece", "Santorini", "",                   0.95),
    ("naoussa",                     "Greece", "Naoussa", "",                     0.92),
    ("assyrtiko",                   "Greece", "", "",                            0.80),

    # Hungary
    ("tokaji",                      "Hungary", "", "",                           0.95),
    ("tokay",                       "Hungary", "", "",                           0.90),

    # Japan
    ("yamanashi",                   "Japan", "", "",                             0.92),
    ("hokkaido",                    "Japan", "", "",                             0.85),
    ("nagano",                      "Japan", "", "",                             0.80),

    # UK
    ("english sparkling",           "England", "", "",                           0.92),
    ("sussex",                      "England", "", "",                           0.80),
    ("kent",                        "England", "", "",                           0.75),

    # Thailand
    ("khao yai",                    "Thailand", "Khao Yai", "",                  0.93),
    ("hua hin",                     "Thailand", "Hua Hin", "",                   0.90),

    # Spirits
    ("islay",                       "Scotland", "", "",                          0.95),
    ("speyside",                    "Scotland", "", "",                          0.93),
    ("highland",                    "Scotland", "", "",                          0.85),
    ("lowland",                     "Scotland", "", "",                          0.80),
    ("campbeltown",                 "Scotland", "", "",                          0.90),
    ("single malt scotch",          "Scotland", "", "",                          0.95),
    ("scotch whisky",               "Scotland", "", "",                          0.92),
    ("irish whiskey",               "Ireland", "", "",                           0.95),
    ("japanese whisky",             "Japan", "", "",                             0.95),
    ("tequila",                     "Mexico", "", "",                            0.92),
    ("mezcal",                      "Mexico", "", "",                            0.92),
    ("jamaican rum",                "Jamaica", "", "",                           0.95),
    ("barbados rum",                "Barbados", "", "",                          0.95),
    ("cuban rum",                   "Cuba", "", "",                              0.95),
    ("sake",                        "Japan", "", "",                             0.88),
    ("shochu",                      "Japan", "", "",                             0.90),
    ("soju",                        "South Korea", "", "",                       0.92),
    ("pisco",                       "Peru", "", "",                              0.60),  # also Chile
    ("grappa",                      "Italy", "", "",                             0.88),
    ("calvados",                    "France", "Calvados", "",                    0.95),
    ("absinthe",                    "France", "", "",                            0.55),
    ("chartreuse",                  "France", "", "",                            0.88),

    # Country-only last-resort
    ("french",                      "France", "", "",                            0.55),
    ("italian",                     "Italy", "", "",                             0.55),
    ("spanish",                     "Spain", "", "",                             0.55),
    ("german",                      "Germany", "", "",                           0.55),
    ("portuguese",                  "Portugal", "", "",                          0.55),
    ("australian",                  "Australia", "", "",                         0.55),
    ("chilean",                     "Chile", "", "",                             0.55),
    ("argentine",                   "Argentina", "", "",                         0.55),
]


# Producer prefixes — low-confidence country signals on their own
PRODUCER_PREFIXES: list[tuple[str, str, float]] = [
    (r"\bchateau\b",     "France",  0.70),
    (r"\bdomaine\b",     "France",  0.70),
    (r"\bmaison\b",      "France",  0.55),
    (r"\bbodega\b",      "Spain",   0.70),
    (r"\bbodegas\b",     "Spain",   0.70),
    (r"\btenuta\b",      "Italy",   0.70),
    (r"\bazienda\b",     "Italy",   0.70),
    (r"\bcantina\b",     "Italy",   0.65),
    (r"\bpoggio\b",      "Italy",   0.60),
    (r"\bcasa\b",        "",        0.30),  # too generic
    (r"\bweingut\b",     "Germany", 0.75),
    (r"\bquinta\b",      "Portugal",0.70),
    (r"\bkellerei\b",    "Germany", 0.75),
    (r"\bchampagne\b",   "France",  0.85),
]


def _compile() -> list[tuple[re.Pattern, str, str, str, float, str]]:
    out = []
    for kw, c, r, s, conf in APPELLATIONS:
        # Keyword is already space-normalized; wrap in word boundaries
        pat = re.compile(rf"\b{re.escape(kw)}\b")
        out.append((pat, c, r, s, conf, "appellation"))
    for pat, c, conf in PRODUCER_PREFIXES:
        out.append((re.compile(pat), c, "", "", conf, "producer_prefix"))
    return out


RULES = _compile()


# Keywords that mark a product as an accessory/container rather than a beverage.
# When any of these appear, we suppress origin inference — "Champagne Glass" is not French.
ACCESSORY_MARKERS = re.compile(
    r"\b("
    r"glass|glasses|decanter|cooler|bucket|stopper|opener|corkscrew|pump|sealer|"
    r"pourer|aerator|chiller|serving set|gift set|shelf|rack|holder|"
    r"carafe|coaster|tray|kit|charm|foil cutter|drip stop|preserver|"
    r"ice pick|mold|mould|shaker|strainer|tongs|tool set"
    r")\b"
)

_ACCESSORY_CLASSIFICATIONS = {"Wine product", "Bar accessory", "Glassware", "Accessories", ""}


def infer_from_name(name: str, classification: str = "") -> dict:
    """Return {country, region, subregion, confidence, matched_rules}.

    If `classification` marks the product as an accessory, or the name itself contains
    accessory markers (glass, decanter, cooler...), origin inference is suppressed —
    the rule text describes the accessory's intended use, not the product's origin.
    """
    n = _norm(name)
    if not n.strip():
        return {"country": "", "region": "", "subregion": "", "confidence": 0.0, "matched_rules": [], "suppressed": False}
    if classification in _ACCESSORY_CLASSIFICATIONS and ACCESSORY_MARKERS.search(n):
        return {"country": "", "region": "", "subregion": "", "confidence": 0.0, "matched_rules": [], "suppressed": True}

    best_country  = ("", 0.0, "")
    best_region   = ("", 0.0, "")
    best_sub      = ("", 0.0, "")
    matched: list[dict] = []

    for pat, c, r, s, conf, kind in RULES:
        m = pat.search(n)
        if not m:
            continue
        matched.append({"rule": m.group(0).strip(), "kind": kind, "conf": conf,
                        "country": c, "region": r, "subregion": s})
        # Deeper levels back-fill shallower levels implicitly
        if s and conf > best_sub[1]:
            best_sub = (s, conf, m.group(0))
            # Subregion match guarantees its own region/country
            if conf > best_region[1]: best_region = (r, conf, m.group(0))
            if conf > best_country[1]: best_country = (c, conf, m.group(0))
        elif r and conf > best_region[1]:
            best_region = (r, conf, m.group(0))
            if c and conf > best_country[1]: best_country = (c, conf, m.group(0))
        elif c and conf > best_country[1]:
            best_country = (c, conf, m.group(0))

    overall = max(best_country[1], best_region[1], best_sub[1])
    return {
        "country": best_country[0],
        "region":  best_region[0],
        "subregion": best_sub[0],
        "confidence": round(overall, 2),
        "matched_rules": matched,
        "suppressed": False,
    }
