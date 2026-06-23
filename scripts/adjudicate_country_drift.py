#!/usr/bin/env python3
"""Adjudicate country drift between masterfile and products.db using INDEPENDENT
evidence (appellation/region tokens in the DB region + product name), NOT by
trusting either source.

Background: audit found 243 SKUs where masterfile country != DB country and the
two are genuinely different countries. Neither source is reliable — masterfile
says Castello Banfi is "Scotland" (it's Tuscan/Italy), DB had Kai as Vietnam
(it's NZ). So we resolve each SKU from appellation/grape/producer evidence.

Verdict per SKU:
  db        -> DB country corroborated by region/appellation evidence
  masterfile-> masterfile country corroborated, DB wrong
  human     -> no decisive evidence; flag for manual review

This script is READ-ONLY. It writes a report; it does NOT touch the DB.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "db" / "products.db"
MASTERFILE = ROOT / "data" / "masterfile_all_tiers.json"

# Country-name aliases — same country, different spelling. NOT real disagreements.
_ALIAS_GROUPS = [
    {"uk", "united kingdom", "england", "scotland", "wales", "northern ireland", "great britain"},
    {"netherland", "netherlands", "holland"},
    {"korea", "south korea", "republic of korea"},
    {"trinidad", "trinidad & tobago", "trinidad and tobago"},
    {"usa", "united states", "united states of america", "us"},
]
# Vague regions (not a country) the masterfile sometimes puts in the country field.
_REGION_LABELS = {"caribbean", "scandinavia", "south america", "asia pacific",
                  "europe", "west indies", "british west indies"}


def _alias_group(c: str):
    cl = c.lower().strip()
    for g in _ALIAS_GROUPS:
        if cl in g:
            return frozenset(g)
    return None


def _same(a: str, b: str) -> bool:
    ga, gb = _alias_group(a), _alias_group(b)
    return ga is not None and ga == gb


def load_cases() -> list[dict]:
    """Build the [C] real-disagreement set fresh from DB + masterfile.
    [C] = masterfile has a country value AND it's a genuinely different country
    from the DB (not an alias, not a vague region). Self-contained / reproducible.
    """
    import sqlite3
    m = json.loads(MASTERFILE.read_text())
    rows = m if isinstance(m, list) else m.get("products")
    mf = {}
    for r in rows:
        if isinstance(r, dict) and r.get("sku"):
            mf[str(r["sku"]).upper()] = {"country": (r.get("country") or "").strip(),
                                         "region": r.get("region") or ""}
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    out = []
    for r in con.execute("SELECT sku,name,brand,country,region,subregion FROM products"):
        sku = str(r["sku"]).upper()
        dbc = (r["country"] or "").strip()
        MFr = mf.get(sku)
        if not MFr or MFr["country"] == "":
            continue
        mfc = MFr["country"]
        if dbc == mfc or _same(mfc, dbc) or mfc.lower() in _REGION_LABELS:
            continue
        out.append({"sku": sku, "name": r["name"], "brand": r["brand"],
                    "db_country": dbc, "db_region": r["region"] or "",
                    "db_sub": r["subregion"] or "", "mf_country": mfc,
                    "mf_region": MFr["region"]})
    con.close()
    return out


CASES = load_cases()

# Appellation / region / producer token -> definitive country.
# Lowercased substring match against DB region, DB subregion, and product name.
# Only include tokens that are UNAMBIGUOUS for a single country.
APPELLATION_COUNTRY = {
    # Italy
    "tuscany": "Italy", "toscana": "Italy", "montalcino": "Italy", "brunello": "Italy",
    "chianti": "Italy", "piedmont": "Italy", "piemonte": "Italy", "barolo": "Italy",
    "barbaresco": "Italy", "veneto": "Italy", "prosecco": "Italy", "bolgheri": "Italy",
    "primitivo": "Italy", "amarone": "Italy", "soave": "Italy", "moscato d'asti": "Italy",
    "valpolicella": "Italy", "docg": "Italy", "igt toscana": "Italy",
    # France
    "bordeaux": "France", "burgundy": "France", "bourgogne": "France", "champagne": "France",
    "rhone": "France", "rhône": "France", "loire": "France", "alsace": "France",
    "beaujolais": "France", "languedoc": "France", "provence": "France", "sauternes": "France",
    "medoc": "France", "médoc": "France", "saint-emilion": "France", "pauillac": "France",
    "margaux": "France", "pomerol": "France", "chablis": "France", "cognac": "France",
    "armagnac": "France",
    # Chile
    "maipo": "Chile", "colchagua": "Chile", "casablanca valley": "Chile", "rapel": "Chile",
    "aconcagua": "Chile", "curico": "Chile", "curicó": "Chile", "central valley": "Chile",
    "puente alto": "Chile", "leyda": "Chile", "limari": "Chile", "limarí": "Chile",
    # Argentina
    "mendoza": "Argentina", "uco valley": "Argentina", "salta": "Argentina",
    "patagonia": "Argentina", "lujan de cuyo": "Argentina", "luján de cuyo": "Argentina",
    "cafayate": "Argentina",
    # Spain
    "rioja": "Spain", "ribera del duero": "Spain", "priorat": "Spain", "rias baixas": "Spain",
    "rías baixas": "Spain", "jerez": "Spain", "cava": "Spain", "penedes": "Spain",
    "penedès": "Spain", "toro": "Spain", "rueda": "Spain",
    # USA
    "napa": "USA", "sonoma": "USA", "california": "USA", "oregon": "USA", "willamette": "USA",
    "washington state": "USA", "paso robles": "USA", "russian river": "USA",
    # NOTE: "kentucky"/"tennessee"/"bourbon" deliberately OMITTED — they appear
    # as whisky STYLE descriptors ("Bourbon Type", "Kentucky-style") on non-US
    # whiskies (e.g. Omar, a Taiwanese single malt), causing false USA flips.
    # Australia
    "barossa": "Australia", "mclaren vale": "Australia", "coonawarra": "Australia",
    "yarra valley": "Australia", "hunter valley": "Australia", "margaret river": "Australia",
    "clare valley": "Australia", "eden valley": "Australia", "adelaide": "Australia",
    # New Zealand
    "marlborough": "New Zealand", "central otago": "New Zealand", "hawke's bay": "New Zealand",
    "hawkes bay": "New Zealand",
    # Germany
    "mosel": "Germany", "rheingau": "Germany", "pfalz": "Germany", "nahe": "Germany",
    "rheinhessen": "Germany",
    # Austria
    "wachau": "Austria", "kamptal": "Austria", "burgenland": "Austria",
    # Lebanon
    "bekaa": "Lebanon",
    # Portugal
    "douro": "Portugal", "alentejo": "Portugal", "vinho verde": "Portugal", "dao": "Portugal",
    # South Africa
    "stellenbosch": "South Africa", "swartland": "South Africa", "western cape": "South Africa",
    "franschhoek": "South Africa",
    # Caribbean / spirits producers (rum origin by distillery name when in DB region)
}

# Brand/producer -> definitive country. Use when appellation is silent (spirits,
# accessories, beer). Only well-established single-country producers.
PRODUCER_COUNTRY = {
    "castello banfi": "Italy", "chateau musar": "Lebanon", "temptech": "Norway",
    "penfolds": "Australia",  # brand is AU; but Bin 149/600/704 are USA — handled by name override below
    "hendrick's": "Scotland", "bombay sapphire": "England", "bols": "Netherlands",
    "wenneker": "Netherlands", "bong spirit": "Netherlands", "bobby's": "Netherlands",
    "old duff": "Netherlands", "hiram walker": "Canada",
    # NOTE: "Gibson's" deliberately OMITTED — Gibson's Finest is Canadian whisky
    # but "Gibson's Gin" is a separate English gin brand; ambiguous → leave to human.
    "angostura": "Trinidad & Tobago", "plantation": "France",  # Plantation = Maison Ferrand, France-bottled; origin varies
    "chateau ste. michelle": "USA", "miguel torres": "Spain", "trimbach": "France",
    "grosset": "Australia", "omar": "Taiwan", "sikkim": "India", "buss": "England",
    "cotswolds": "England", "city of london": "England", "martin miller": "England",
    "haymans": "England", "portobello road": "England", "j.j.whitley": "England",
    "liverpool": "England", "fever-tree": "England", "bob's bitters": "England",
    "lambrini": "England", "brothers cider": "England", "chum churum": "South Korea",
    "kook soon dang": "South Korea", "ark": "South Korea",
}

# Per-SKU/name overrides where brand-default is wrong (e.g. Penfolds California range).
def name_override(name: str) -> str | None:
    nl = name.lower()
    if "penfolds" in nl and any(t in nl for t in ["napa", "california", "bin 600", "bin 704", "bin 149", "quantum"]):
        return "USA"
    return None


# SKU prefixes that are ACCESSORIES / glassware / bar tools, not beverages.
# For these, an appellation word in the name ("Champagne flute", "Burgundy
# glass") describes USE, not ORIGIN — appellation evidence is INVALID. The
# manufacturing country (DB) is the real signal; do NOT flip on appellation.
ACCESSORY_PREFIXES = ("ABA", "GWN", "GLQ", "GWA", "AWC", "GWS", "GSP")


def is_accessory(sku: str) -> bool:
    return sku.upper()[:3] in ACCESSORY_PREFIXES


def evidence_country(c: dict) -> tuple[str | None, str]:
    """Return (country, why) from independent evidence, or (None, '') if undecided."""
    name = (c["name"] or "")
    nl = name.lower()
    blob = " ".join([c["db_region"], c["db_sub"], name]).lower()
    accessory = is_accessory(c["sku"])

    ov = name_override(name)
    if ov:
        return ov, f"name-override({name!r})"

    # 1) appellation tokens (strongest — geography can't lie) — but NOT for
    # accessories, where "Champagne"/"Burgundy" means glass shape, not origin,
    # and NOT when the token is a CASK FINISH ("Cognac Cask", "Burgundy Cask
    # Finish") — that's maturation, not provenance (Glendalough is Irish, etc.).
    if not accessory:
        for tok, country in APPELLATION_COUNTRY.items():
            if tok in blob:
                # suppress "<tok> cask" cask-finish false positives
                if re.search(re.escape(tok) + r"\s+cask", blob):
                    continue
                return country, f"appellation:{tok!r}"

    # 2) producer
    for prod, country in PRODUCER_COUNTRY.items():
        if prod in nl:
            return country, f"producer:{prod!r}"

    return None, ""


def matches(country: str, target: str) -> bool:
    ALIAS = [{"uk", "england", "scotland", "wales", "great britain", "united kingdom"},
             {"netherland", "netherlands", "holland"},
             {"korea", "south korea"}, {"usa", "united states", "us"},
             {"trinidad", "trinidad & tobago"}]
    a, b = country.lower(), target.lower()
    if a == b:
        return True
    for g in ALIAS:
        if a in g and b in g:
            return True
    return False


def main():
    verdict = {"db": [], "masterfile": [], "human": []}
    for c in CASES:
        ev, why = evidence_country(c)
        if ev is None:
            c["evidence"] = ""
            verdict["human"].append(c)
        elif matches(ev, c["db_country"]):
            c["evidence"] = f"{ev} ({why})"
            verdict["db"].append(c)
        elif matches(ev, c["mf_country"]):
            c["evidence"] = f"{ev} ({why})"
            verdict["masterfile"].append(c)
        else:
            c["evidence"] = f"{ev} ({why}) — disagrees with BOTH sources!"
            verdict["human"].append(c)

    print(f"DB correct (DB stays):      {len(verdict['db'])}")
    print(f"Masterfile correct (fix DB):{len(verdict['masterfile'])}")
    print(f"Needs human review:         {len(verdict['human'])}")

    out = ROOT / "data" / "_country_drift_verdict.json"
    out.write_text(json.dumps(verdict, ensure_ascii=False, indent=1))
    print(f"\nWrote {out}")

    print("\n=== MASTERFILE correct → DB needs fixing ===")
    for c in verdict["masterfile"]:
        print(f"  {c['sku']:11} DB={c['db_country']:12} -> {c['mf_country']:12} | {c['evidence']:40} | {c['name'][:40]}")

    print("\n=== NEEDS HUMAN REVIEW ===")
    for c in verdict["human"]:
        flag = " ⚠BOTH" if "BOTH" in c["evidence"] else ""
        print(f"  {c['sku']:11} MF={c['mf_country']:12} DB={c['db_country']:12}{flag} | {c['name'][:45]}")


if __name__ == "__main__":
    main()
