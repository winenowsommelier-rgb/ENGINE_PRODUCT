#!/usr/bin/env python3
"""Fill remaining T2/T3 gaps: region, variety, style — brand→region from web research."""
import json, re, argparse
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
# BRAND → REGION (extended from web research — T2/T3 brands)
# ============================================================================
BRAND_REGION = {
    # Italy
    "Corte Viola": "Veneto", "Notte Rossa": "Puglia", "Fantini Calalenta": "Abruzzo",
    "Conti Zecca": "Puglia", "Masseria Borgo Dei Trulli": "Puglia",
    "Eugenio Collavini": "Friuli", "Cusumano": "Sicily", "Planeta": "Sicily",
    "Tasca d'Almerita": "Sicily", "Donnafugata": "Sicily", "Feudi di San Gregorio": "Campania",
    "Mastroberardino": "Campania", "Rivera": "Puglia", "Tormaresca": "Puglia",
    "Cantina Terlano": "Alto Adige", "Alois Lageder": "Alto Adige",
    "Elena Walch": "Alto Adige", "Tiefenbrunner": "Alto Adige",
    "Cantine Leonardo Da Vinci": "Tuscany", "Carpineto": "Tuscany",
    "Frescobaldi": "Tuscany", "Col d'Orcia": "Tuscany", "Banfi": "Tuscany",
    "Castello Banfi": "Tuscany", "San Felice": "Tuscany", "Poggio Antico": "Tuscany",
    "Fontanafredda": "Piedmont", "Marchesi di Barolo": "Piedmont",
    "Michele Chiarlo": "Piedmont", "Pio Cesare": "Piedmont",
    "Ca' del Bosco": "Lombardy", "Berlucchi": "Lombardy",
    "Masi": "Veneto", "Zenato": "Veneto", "Allegrini": "Veneto", "Bolla": "Veneto",
    "Bertani": "Veneto", "Tedeschi": "Veneto", "San Maurizio": "Piedmont",
    "Follador": "Veneto",
    # France
    "Chateau Maris": "Languedoc", "La Belle Angele": "Languedoc",
    "Jeff Carrel": "Languedoc", "Moulin de Gassac": "Languedoc",
    "La Cour Des Dames": "Languedoc", "Reserve St Martin": "Languedoc",
    "Messenez Family": "Languedoc", "Gerard Bertrand": "Languedoc",
    "Louis Roederer": "Champagne", "Krug": "Champagne", "Moet & Chandon": "Champagne",
    "Veuve Clicquot": "Champagne", "Veuve du Vernay": "Loire",
    "French Bloom": "Languedoc", "Joseph Mellot": "Loire",
    "Laurent Miquel": "Languedoc", "Chateau Mouton Rothschild": "Bordeaux",
    "Chateau Clerc Milon": "Bordeaux",
    # Spain
    "Marques de Caceres": "Rioja", "Marqués de Cáceres": "Rioja",
    "CUNE": "Rioja", "Pingorote": "Castilla-La Mancha",
    "Juvé & Camps": "Penedès",
    # South Africa
    "Nederburg": "Western Cape", "Two Oceans": "Western Cape",
    "Delheim": "Stellenbosch", "Noble Hill": "Paarl", "Expresion": "Western Cape",
    # New Zealand
    "Wairau River": "Marlborough", "Greywacke": "Marlborough",
    "Brancott Estate": "Marlborough", "Villa Maria": "Marlborough",
    "Villa maria": "Marlborough",
    # USA
    "Kendall Jackson": "California", "Gallo Family Vineyards": "California",
    "Beringer": "California", "Coastal Ridge": "California",
    "Sterling": "Napa", "Cuvaison": "Napa", "Peter Michael": "Sonoma",
    "The Blind Pig": "California",
    # Germany
    "Prinz Von Hessen": "Rheingau", "Blue Nun": "Rheinhessen",
    "Dr Loosen": "Mosel", "Dr. Loosen": "Mosel",
    # Austria
    "Laurenz V.": "Kamptal",
    # Argentina
    "Argento": "Mendoza",
    # Peru
    "Tacama": "Ica",
    # Greece
    "Boutari": "Macedonia", "Ktima Gerovassiliou": "Macedonia",
    # England
    "Lyme Bay": "Devon",
}

# Country → default region for remaining
COUNTRY_DEFAULT = {
    "Australia": "South Eastern Australia",
    "Chile": "Central Valley",
    "Argentina": "Mendoza",
    "Thailand": "Khao Yai",
    "New Zealand": "Marlborough",
    "South Africa": "Western Cape",
    "Uruguay": "Canelones",
    "Mexico": "Baja California",
    "Peru": "Ica",
    "Greece": "Macedonia",
    "England": "Sussex",
}

# ============================================================================
# GRAPE VARIETY — Region+Classification defaults for remaining gaps
# ============================================================================
REGION_GRAPE_DEFAULTS = {
    ("Red Wine", "Burgundy"): "Pinot Noir",
    ("White Wine", "Burgundy"): "Chardonnay",
    ("Red Wine", "Beaujolais"): "Gamay",
    ("Red Wine", "Bordeaux"): "Cabernet Sauvignon, Merlot",
    ("White Wine", "Bordeaux"): "Sauvignon Blanc, Semillon",
    ("Red Wine", "Rioja"): "Tempranillo",
    ("White Wine", "Rioja"): "Viura",
    ("Red Wine", "Mendoza"): "Malbec",
    ("Red Wine", "Puglia"): "Primitivo",
    ("White Wine", "Marlborough"): "Sauvignon Blanc",
    ("Red Wine", "Central Otago"): "Pinot Noir",
    ("Red Wine", "Tuscany"): "Sangiovese",
    ("White Wine", "Alto Adige"): "Pinot Grigio",
    ("Red Wine", "Piedmont"): "Nebbiolo",
    ("White Wine", "Piedmont"): "Cortese",
    ("Red Wine", "Veneto"): "Corvina",
    ("Red Wine", "Barossa"): "Shiraz",
    ("White Wine", "Mosel"): "Riesling",
    ("White Wine", "Alsace"): "Riesling",
    ("White Wine", "Loire"): "Sauvignon Blanc",
    ("Red Wine", "Loire"): "Cabernet Franc",
    ("Red Wine", "Rhône Valley"): "Syrah, Grenache",
    ("White Wine", "Rhône Valley"): "Viognier",
    ("Red Wine", "Languedoc"): "Grenache, Syrah",
    ("Red Wine", "Sicily"): "Nero d'Avola",
    ("White Wine", "Sicily"): "Grillo",
    ("Red Wine", "Abruzzo"): "Montepulciano",
    ("Red Wine", "Campania"): "Aglianico",
    ("Red Wine", "Stellenbosch"): "Cabernet Sauvignon",
    ("Red Wine", "Napa"): "Cabernet Sauvignon",
    ("Red Wine", "Sonoma"): "Pinot Noir",
    ("White Wine", "Sonoma"): "Chardonnay",
    ("Red Wine", "Willamette Valley"): "Pinot Noir",
    ("Red Wine", "Colchagua"): "Cabernet Sauvignon",
    ("White Wine", "Casablanca"): "Sauvignon Blanc",
    ("Red Wine", "Maipo Valley"): "Cabernet Sauvignon",
    ("Red Wine", "Douro"): "Touriga Nacional",
    ("Champagne", "Champagne"): "Chardonnay, Pinot Noir, Pinot Meunier",
    ("Sparkling Wine", "Veneto"): "Glera",
    ("Sparkling Wine", "Penedès"): "Macabeo, Xarel·lo, Parellada",
    ("Dessert Wine", "Douro"): "Touriga Nacional, Touriga Franca",
    ("Rose Wine", "Provence"): "Grenache, Cinsault",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--tier", type=int, default=0, help="0=T2+T3, 2=T2, 3=T3")
    args = parser.parse_args()

    wine_types = {"Red Wine","White Wine","Rose Wine","Sparkling Wine","Champagne","Dessert Wine","Orange Wine","Port Wine","Fruit Wine"}

    select = "sku,name,classification,country,region,brand,variety,style,vintage,enrichment_priority"
    tiers = "enrichment_priority=in.(2,3)" if args.tier == 0 else f"enrichment_priority=eq.{args.tier}"
    query = f"products?{tiers}&is_primary_variant=eq.true&select={select}&order=sku.asc"

    print(f"Fetching products...", flush=True)
    products = fetch_all(query)
    print(f"  Total: {len(products)}", flush=True)

    updates = {}  # sku -> {field: value}
    region_hits = grape_hits = vintage_hits = 0

    for p in products:
        sku = p["sku"]
        cls = safe(p.get("classification"))
        brand = safe(p.get("brand"))
        country = safe(p.get("country"))
        region = safe(p.get("region"))
        grape = safe(p.get("variety"))
        vintage = safe(p.get("vintage"))
        name = p.get("name", "")

        patch_data = {}

        # 1. Region fill
        if cls in wine_types and not region:
            if brand in BRAND_REGION:
                patch_data["region"] = BRAND_REGION[brand]
                region_hits += 1
            elif country in COUNTRY_DEFAULT:
                patch_data["region"] = COUNTRY_DEFAULT[country]
                region_hits += 1
            # Update local region for grape lookup
            if "region" in patch_data:
                region = patch_data["region"]

        # 2. Grape variety fill
        if cls in wine_types and not grape:
            key = (cls, region)
            if key in REGION_GRAPE_DEFAULTS:
                patch_data["variety"] = REGION_GRAPE_DEFAULTS[key]
                grape_hits += 1

        # 3. Vintage fill (remaining NV + brand defaults)
        if cls in wine_types and not vintage:
            if cls in ("Champagne", "Sparkling Wine", "Port Wine"):
                patch_data["vintage"] = "NV"
                vintage_hits += 1

        if patch_data:
            updates[sku] = patch_data

    print(f"\nUpdates planned: {len(updates)}", flush=True)
    print(f"  Regions: {region_hits}", flush=True)
    print(f"  Grapes: {grape_hits}", flush=True)
    print(f"  Vintages: {vintage_hits}", flush=True)

    if args.dry_run:
        for sku, data in list(updates.items())[:15]:
            print(f"  {sku:20s} -> {data}", flush=True)
        print(f"\n[DRY RUN]", flush=True)
        return

    patched = 0
    failed = 0
    items = list(updates.items())
    for i in range(0, len(items), 50):
        batch = items[i:i+50]
        for sku, data in batch:
            try:
                patch(sku, data)
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        pct = (i + len(batch)) / len(items) * 100
        print(f"  Patched {patched}/{len(items)} ({pct:.0f}%)", flush=True)

    print(f"\nDone: {patched} patched, {failed} failed", flush=True)

if __name__ == "__main__":
    main()
