#!/usr/bin/env python3
"""
Fill missing region for wine products using brand→region research + country defaults.
Sources: web research April 2026 + wine-searcher.com data.
"""
import json, argparse
from urllib import request

BASE = "https://xfcvliyxxguhihehqwkg.supabase.co"
KEY = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

def fetch_all(path):
    rows, offset = [], 0
    while True:
        url = f"{BASE}/rest/v1/{path}&limit=1000&offset={offset}"
        r = request.Request(url, headers=H)
        with request.urlopen(r) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000: break
            offset += 1000
    return rows

def patch(sku, data):
    url = f"{BASE}/rest/v1/products?sku=eq.{sku}"
    body = json.dumps(data).encode()
    req = request.Request(url, data=body, headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"}, method="PATCH")
    with request.urlopen(req) as r: pass

def safe(v):
    if v is None: return ""
    if isinstance(v, (int, float)): return str(v)
    return v.strip()

# ============================================================================
# BRAND → REGION MAPPING (from web research)
# ============================================================================
BRAND_REGION = {
    # Australia
    "Rawson's Retreat": "South Eastern Australia",
    "Penfolds": "South Australia",
    "Wolf Blass": "South Australia",
    "Yellow Tail": "South Eastern Australia",
    "19 Crimes": "South Eastern Australia",
    "Angove": "South Australia",
    "De Bortoli": "South Eastern Australia",
    "Sunnycliff": "Murray Darling",
    "Inspired Company": "South Eastern Australia",
    "McGuigan": "South Eastern Australia",
    "Lindeman's": "South Eastern Australia",
    "Jacob's Creek": "South Australia",
    "Hardy's": "South Eastern Australia",
    "Wyndham Estate": "South Eastern Australia",
    "Rosemount": "South Eastern Australia",
    "Yalumba": "South Australia",
    "Grant Burge": "Barossa",
    "Torbreck": "Barossa",
    "Peter Lehmann": "Barossa",
    "Jim Barry": "Clare Valley",
    "d'Arenberg": "McLaren Vale",
    "Taylors": "Clare Valley",
    "Henschke": "Eden Valley",
    "Wirra Wirra": "McLaren Vale",
    "Chapel Hill": "McLaren Vale",
    "Petaluma": "Adelaide Hills",
    "Shaw + Smith": "Adelaide Hills",
    "Vasse Felix": "Margaret River",
    "Leeuwin Estate": "Margaret River",
    "Cullen": "Margaret River",
    "Tyrrell's": "Hunter Valley",
    "Brokenwood": "Hunter Valley",
    # Chile
    "Carta Vieja": "Maule Valley",
    "Santa Helena": "Central Valley",
    "Concha y Toro": "Central Valley",
    "Concha Y Toro": "Central Valley",
    "Santa Carolina": "Central Valley",
    "Echeverria": "Curicó Valley",
    "Viu Manent": "Colchagua",
    "Montes": "Colchagua",
    "Errazuriz": "Aconcagua",
    "Undurraga": "Central Valley",
    "Carmen": "Central Valley",
    "Cono Sur": "Central Valley",
    "Emiliana": "Central Valley",
    "Casas del Bosque": "Casablanca",
    "Lapostolle": "Colchagua",
    "De Martino": "Maipo Valley",
    "Ventisquero": "Central Valley",
    "San Pedro": "Central Valley",
    "Tarapacá": "Maipo Valley",
    "Arboleda": "Aconcagua",
    "Almaviva": "Maipo Valley",
    # France
    "Baron Philippe de Rothschild": "Bordeaux",
    "Michel Lynch": "Bordeaux",
    "Domaines Ott": "Provence",
    "Chateau Paradis": "Provence",
    "Georges Duboeuf": "Beaujolais",
    "Louis Latour": "Burgundy",
    "Joseph Drouhin": "Burgundy",
    "Albert Bichot": "Burgundy",
    "Bouchard Pere & Fils": "Burgundy",
    "Domaine Georges Noellat": "Burgundy",
    "Maison Roche de Bellene": "Burgundy",
    "Dominique Lafon": "Burgundy",
    "Guigal": "Rhône Valley",
    "Chapoutier": "Rhône Valley",
    "Paul Jaboulet Ainé": "Rhône Valley",
    "Hugel": "Alsace",
    "Trimbach": "Alsace",
    "Zind-Humbrecht": "Alsace",
    "Maison de Grand Esprit": "Languedoc",
    "Domaine L'Ostal Cazes": "Languedoc",
    "Gerard Bertrand": "Languedoc",
    # Italy
    "Antinori": "Tuscany",
    "Cantine Pellegrino": "Sicily",
    "Batasiolo": "Piedmont",
    "Massolino": "Piedmont",
    "Fontanafredda": "Piedmont",
    "Marchesi Di Barolo": "Piedmont",
    "Marchesi di Barolo": "Piedmont",
    "Carpineto": "Tuscany",
    "Castello Banfi": "Tuscany",
    "Ruffino": "Tuscany",
    "Frescobaldi": "Tuscany",
    "Lungarotti": "Umbria",
    "Vigneti Del Salento": "Puglia",
    "Masseria Tagaro": "Puglia",
    "Velenosi": "Marche",
    "Reguta": "Veneto",
    "Masi": "Veneto",
    "Zenato": "Veneto",
    "Allegrini": "Veneto",
    "Bottega": "Veneto",
    "Bolla": "Veneto",
    "Don Luciano": "Veneto",
    "La Spinetta": "Piedmont",
    "Michele Chiarlo": "Piedmont",
    "Pio Cesare": "Piedmont",
    # Spain
    "Marqués de Riscal": "Rioja",
    "CVNE": "Rioja",
    "Bodegas Muga": "Rioja",
    "La Rioja Alta": "Rioja",
    "Torres": "Penedès",
    "Bodegas Codorniu Raventos": "Penedès",
    "Freixenet": "Penedès",
    "Opera Prima": "La Mancha",
    "Don Luciano": "La Mancha",
    # Argentina
    "Argento": "Mendoza",
    "Catena Zapata": "Mendoza",
    "Bodega Norton": "Mendoza",
    "Trapiche": "Mendoza",
    "Alamos": "Mendoza",
    "Kaiken": "Mendoza",
    "Zuccardi": "Mendoza",
    "Luigi Bosca": "Mendoza",
    "Familia Schroeder": "Patagonia",
    # USA
    "Caymus": "Napa",
    "Duckhorn": "Napa",
    "Robert Mondavi": "Napa",
    "Opus One": "Napa",
    "Wente Vineyards": "California",
    "Josh Cellars": "California",
    "Meiomi": "California",
    "Decoy": "California",
    "Ridge Vineyards": "California",
    "Au Bon Climat": "Santa Barbara",
    # New Zealand
    "Villa Maria": "Marlborough",
    "Cloudy Bay": "Marlborough",
    "Oyster Bay": "Marlborough",
    "Kim Crawford": "Marlborough",
    "Matua": "Marlborough",
    "Mud House": "Marlborough",
    "Babich": "Marlborough",
    "Craggy Range": "Hawke's Bay",
    "Te Mata": "Hawke's Bay",
    "Felton Road": "Central Otago",
    "Amisfield": "Central Otago",
    # South Africa
    "Kanonkop": "Stellenbosch",
    "Rustenberg": "Stellenbosch",
    "Meerlust": "Stellenbosch",
    "Boschendal": "Stellenbosch",
    "Fairview": "Paarl",
    "KWV": "Western Cape",
    # Thailand
    "Granmonte": "Khao Yai",
    "GranMonte": "Khao Yai",
    "Monsoon Valley": "Hua Hin Hills",
    "PB Valley": "Khao Yai",
    # Germany
    "Dr. Loosen": "Mosel",
    "Markus Molitor": "Mosel",
    "Joh. Jos. Prüm": "Mosel",
    # Portugal
    "Dow's": "Douro",
    "Graham's": "Douro",
    "Taylor's": "Douro",
    "Ferreira Porto": "Douro",
    "Joao Portugal": "Douro",
}

# Country → default region (for brands not in mapping)
COUNTRY_DEFAULT_REGION = {
    "Australia": "South Eastern Australia",
    "Chile": "Central Valley",
    "Argentina": "Mendoza",
    "Thailand": "Khao Yai",
    "Uruguay": "Canelones",
    "Mexico": "Baja California",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--tier", type=int, default=0)
    args = parser.parse_args()

    print("=== Region Fill Script ===", flush=True)

    select = "sku,name,classification,country,region,brand,enrichment_priority"
    query = f"products?is_primary_variant=eq.true&select={select}&order=sku.asc"
    if args.tier > 0:
        query += f"&enrichment_priority=eq.{args.tier}"

    print(f"Fetching products (tier={args.tier or 'all'})...", flush=True)
    products = fetch_all(query)
    print(f"  Total: {len(products)}", flush=True)

    wine_types = {"Red Wine","White Wine","Rose Wine","Sparkling Wine","Champagne","Dessert Wine","Orange Wine","Port Wine","Fruit Wine"}
    missing = [p for p in products if safe(p.get("classification")) in wine_types and not safe(p.get("region"))]
    print(f"  Wines missing region: {len(missing)}", flush=True)

    updates = []
    brand_hits = 0
    country_hits = 0

    for p in missing:
        brand = safe(p.get("brand"))
        country = safe(p.get("country"))
        region = None

        if brand and brand in BRAND_REGION:
            region = BRAND_REGION[brand]
            brand_hits += 1
        elif country in COUNTRY_DEFAULT_REGION:
            region = COUNTRY_DEFAULT_REGION[country]
            country_hits += 1

        if region:
            updates.append((p["sku"], region))

    print(f"\nUpdates planned: {len(updates)}", flush=True)
    print(f"  Brand-specific: {brand_hits}", flush=True)
    print(f"  Country default: {country_hits}", flush=True)
    print(f"  Still missing: {len(missing) - len(updates)}", flush=True)

    if args.dry_run:
        print("\n[DRY RUN] Sample:", flush=True)
        for sku, reg in updates[:20]:
            p = next(x for x in missing if x["sku"] == sku)
            print(f"  {sku:20s} -> {reg:25s} | {safe(p.get('brand')):25s} {p['name'][:40]}", flush=True)
        return

    patched = 0
    failed = 0
    for i in range(0, len(updates), 50):
        batch = updates[i:i+50]
        for sku, region in batch:
            try:
                patch(sku, {"region": region})
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        pct = (i + len(batch)) / len(updates) * 100
        print(f"  Patched {patched}/{len(updates)} ({pct:.0f}%)", flush=True)

    print(f"\nDone: {patched} patched, {failed} failed", flush=True)

if __name__ == "__main__":
    main()
