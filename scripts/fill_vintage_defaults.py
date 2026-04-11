#!/usr/bin/env python3
"""
Fill missing vintage for wine products using:
1. Brand-specific current vintages (from web research)
2. Country-level typical current vintage (from existing data median)
3. "NV" for products that are genuinely non-vintage (fortified, some sparkling)
"""
import json, re, sys, argparse
from urllib import request, error as urlerror
from collections import Counter, defaultdict

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
    with request.urlopen(req) as r:
        pass

def safe(v):
    if v is None: return ""
    if isinstance(v, (int, float)): return str(v)
    return v.strip()

# ============================================================================
# BRAND → CURRENT VINTAGE MAPPING (from web research April 2026)
# ============================================================================
BRAND_VINTAGE = {
    # Australia
    "Penfolds": "2022",
    "Wolf Blass": "2024",
    "Yellow Tail": "2024",
    "19 Crimes": "2023",
    "Angove": "2024",
    "De Bortoli": "2023",
    "Rawson's Retreat": "2023",
    "Torbreck": "2021",
    "Yalumba": "2022",
    "Jacob's Creek": "2023",
    "Lindeman's": "2023",
    "McGuigan": "2023",
    "Hardy's": "2023",
    "Grant Burge": "2022",
    "Taylors": "2023",
    "Peter Lehmann": "2022",
    "Jim Barry": "2022",
    "d'Arenberg": "2021",
    "Henschke": "2021",
    # Chile
    "Concha y Toro": "2024",
    "Concha Y Toro": "2024",
    "Santa Carolina": "2023",
    "Echeverria": "2024",
    "Santa Helena": "2023",
    "Viu Manent": "2022",
    "Montes": "2022",
    "Errazuriz": "2022",
    "Undurraga": "2023",
    "Cono Sur": "2023",
    "Carmen": "2023",
    "Casas del Bosque": "2023",
    "Lapostolle": "2021",
    "Emiliana": "2023",
    # France
    "Baron Philippe de Rothschild": "2024",
    "Michel Lynch": "2022",
    "Louis Latour": "2022",
    "Joseph Drouhin": "2022",
    "Albert Bichot": "2022",
    "Domaine Georges Noellat": "2021",
    "Domaines Ott": "2023",
    "Château Paradis": "2022",
    "Domaine L'Ostal Cazes": "2023",
    "Chateau Musar": "2018",
    "Guigal": "2021",
    "Chapoutier": "2022",
    "Bouchard Pere & Fils": "2022",
    "Hugel": "2022",
    "Trimbach": "2021",
    # Italy
    "Antinori": "2022",
    "Cantine Pellegrino": "2023",
    "Massolino": "2021",
    "Fontanafredda": "2022",
    "Marchesi Di Barolo": "2022",
    "Marchesi di Barolo": "2022",
    "Batasiolo": "2022",
    "Vigneti Del Salento": "2022",
    "Masseria Tagaro": "2022",
    "Reguta": "2022",
    "Velenosi": "2022",
    "Bottega": "NV",
    "Masi": "2021",
    "Ruffino": "2022",
    "Frescobaldi": "2022",
    "Zenato": "2021",
    "Allegrini": "2021",
    # New Zealand
    "Villa Maria": "2023",
    "Cloudy Bay": "2023",
    "Oyster Bay": "2023",
    "Kim Crawford": "2024",
    "Matua": "2023",
    "Mud House": "2023",
    "Babich": "2023",
    # Spain
    "Torres": "2022",
    "Marqués de Riscal": "2021",
    "CVNE": "2021",
    "Bodegas Muga": "2021",
    "La Rioja Alta": "2019",
    "Bodegas Codorniu Raventos": "NV",
    "Freixenet": "NV",
    # Argentina
    "Catena Zapata": "2022",
    "Bodega Norton": "2023",
    "Trapiche": "2023",
    "Alamos": "2023",
    "Kaiken": "2022",
    # USA
    "Caymus": "2022",
    "Duckhorn": "2022",
    "Robert Mondavi": "2022",
    "Josh Cellars": "2023",
    "Meiomi": "2022",
    "Decoy": "2022",
    # South Africa
    "Kanonkop": "2021",
    "Rustenberg": "2022",
    "Meerlust": "2021",
    "Boschendal": "2023",
    # Thailand
    "Granmonte": "2022",
    "GranMonte": "2022",
    "Monsoon Valley": "2022",
    # Germany
    "Dr. Loosen": "2023",
    "Markus Molitor": "2023",
    "Joh. Jos. Prüm": "2023",
    # Portugal
    "Dow's": "NV",
    "Graham's": "NV",
    "Taylor's": "NV",
    "Ferreira Porto": "NV",
}

# Country → typical current vintage (from in-stock median analysis)
COUNTRY_VINTAGE_DEFAULT = {
    "France": "2022",
    "Italy": "2022",
    "USA": "2022",
    "Australia": "2023",
    "Spain": "2021",
    "Chile": "2023",
    "Argentina": "2022",
    "New Zealand": "2023",
    "Germany": "2023",
    "South Africa": "2022",
    "Portugal": "2021",
    "Austria": "2022",
    "Greece": "2022",
    "Hungary": "2022",
    "Lebanon": "2019",
    "Georgia": "2021",
    "England": "2022",
    "Thailand": "2022",
    "Mexico": "2022",
    "Uruguay": "2022",
    "Slovenia": "2022",
    "Peru": "2022",
    "China": "2022",
}

# NV categories — these genuinely don't have vintages
NV_KEYWORDS = [
    "ruby port", "tawny port", "fine port", "white port",
    "moscato spumante", "prosecco", "cava",
    "cream", "marsala", "vermouth", "madeira",
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--tier", type=int, default=0)
    args = parser.parse_args()

    print("=== Vintage Fill Script ===", flush=True)

    # Fetch products
    select = "sku,sku_base,name,classification,vintage,brand,country,region,enrichment_priority"
    query = f"products?is_primary_variant=eq.true&select={select}&order=sku.asc"
    if args.tier > 0:
        query += f"&enrichment_priority=eq.{args.tier}"

    print(f"Fetching products (tier={args.tier or 'all'})...", flush=True)
    products = fetch_all(query)
    print(f"  Total: {len(products)}", flush=True)

    wine_types = {"Red Wine", "White Wine", "Rose Wine", "Dessert Wine", "Orange Wine", "Port Wine", "Fruit Wine"}

    # Find wines missing vintage (empty string or null, NOT "NV")
    missing = [p for p in products if safe(p.get("classification")) in wine_types and not safe(p.get("vintage"))]
    print(f"  Wines missing vintage: {len(missing)}", flush=True)

    updates = []
    brand_hits = 0
    country_hits = 0
    nv_hits = 0

    for p in missing:
        sku = p["sku"]
        brand = safe(p.get("brand"))
        country = safe(p.get("country"))
        name = (p.get("name") or "").lower()
        cls = safe(p.get("classification"))

        vintage = None

        # 1. Check NV keywords
        if cls == "Port Wine" or any(kw in name for kw in NV_KEYWORDS):
            vintage = "NV"
            nv_hits += 1
        # 2. Brand-specific vintage
        elif brand and brand in BRAND_VINTAGE:
            vintage = BRAND_VINTAGE[brand]
            brand_hits += 1
        # 3. Country default
        elif country and country in COUNTRY_VINTAGE_DEFAULT:
            vintage = COUNTRY_VINTAGE_DEFAULT[country]
            country_hits += 1

        if vintage:
            updates.append((sku, vintage))

    print(f"\nUpdates planned: {len(updates)}", flush=True)
    print(f"  Brand-specific: {brand_hits}", flush=True)
    print(f"  Country default: {country_hits}", flush=True)
    print(f"  NV (non-vintage): {nv_hits}", flush=True)
    print(f"  Still missing: {len(missing) - len(updates)}", flush=True)

    if args.dry_run:
        print("\n[DRY RUN] Sample updates:", flush=True)
        for sku, v in updates[:20]:
            p = next(x for x in missing if x["sku"] == sku)
            print(f"  {sku:20s} -> {v:5s} | {safe(p.get('brand')):25s} {safe(p.get('country')):15s} {p['name'][:40]}", flush=True)
        print("\nDRY RUN — no changes written.", flush=True)
        return

    # Batch patch
    patched = 0
    failed = 0
    for i in range(0, len(updates), 50):
        batch = updates[i:i+50]
        for sku, vintage in batch:
            try:
                patch(sku, {"vintage": vintage})
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        pct = (i + len(batch)) / len(updates) * 100
        print(f"  Patched {patched}/{len(updates)} ({pct:.0f}%)", flush=True)

    print(f"\nDone: {patched} patched, {failed} failed", flush=True)

if __name__ == "__main__":
    main()
