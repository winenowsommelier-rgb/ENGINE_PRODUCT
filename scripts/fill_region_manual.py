#!/usr/bin/env python3
"""Manual region fill for remaining 60 T1 products — from web research."""
import json, argparse
from urllib import request

BASE = "https://xfcvliyxxguhihehqwkg.supabase.co"
KEY = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

def patch(sku, data):
    url = f"{BASE}/rest/v1/products?sku=eq.{sku}"
    body = json.dumps(data).encode()
    req = request.Request(url, data=body, headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"}, method="PATCH")
    with request.urlopen(req) as r: pass

# ============================================================================
# SKU → region (and optional extra fields) from manual web research
# ============================================================================
MANUAL = {
    # Reserve St Martin — Languedoc, IGP Pays d'Oc
    "WRW5907FJ": {"region": "Languedoc"},
    "WRW5908FJ": {"region": "Languedoc"},
    "WWW5252FJ": {"region": "Languedoc"},
    # Cantina Terlano — Alto Adige
    "WWW1255AE": {"region": "Alto Adige"},
    "WWW1261AE": {"region": "Alto Adige"},
    "WWW1262AE": {"region": "Alto Adige"},
    # Wairau River — Marlborough, NZ
    "WRW3425BN": {"region": "Marlborough"},
    "WWW5921BN": {"region": "Marlborough"},
    # Tavernello — Emilia-Romagna (Italy table wine)
    "WRW6523GC": {"region": "Emilia-Romagna"},
    "WWW5906GC": {"region": "Emilia-Romagna"},
    # Moet & Chandon — Champagne
    "WSP1112BU": {"region": "Champagne"},
    "WSP1271BU": {"region": "Champagne"},
    # Expresion — Western Cape, SA
    "WSP5681DD": {"region": "Western Cape"},
    "WSP5682DD": {"region": "Western Cape"},
    # Greywacke — Marlborough (Kevin Judd, ex Cloudy Bay)
    "WWW2244BN": {"region": "Marlborough"},
    "WWW2248BN": {"region": "Marlborough"},
    # Joseph Mellot — Loire (Sancerre)
    "WWW5897GT": {"region": "Loire"},
    "WWW5898GT": {"region": "Loire"},
    # WDW0059FX — GranMonte, Khao Yai (wrong country=England, should be Thailand)
    "WDW0059FX": {"region": "Khao Yai", "country": "Thailand"},
    # Carpineto Dogajolo — Tuscany
    "WRW0305AD": {"region": "Tuscany"},
    # Beringer Founders Estate — California
    "WRW1045AD": {"region": "California"},
    # Two Oceans — Western Cape, SA
    "WRW1049AD": {"region": "Western Cape"},
    # Masseria Li Veli — Puglia
    "WRW3413BS": {"region": "Puglia"},
    # Kendall Jackson — California (Sonoma)
    "WRW3444AD": {"region": "California"},
    # Gallo Family — California
    "WRW4542CH": {"region": "California"},
    # Beringer Main & Vine — California
    "WRW4696AD": {"region": "California"},
    # Chateau Mouton Rothschild — Bordeaux (Pauillac)
    "WRW4706AF": {"region": "Bordeaux"},
    # Chateau Clerc Milon — Bordeaux (Pauillac)
    "WRW4874FS": {"region": "Bordeaux"},
    # Alois Lageder — Alto Adige
    "WRW4912AA": {"region": "Alto Adige"},
    # Cuvaison — Napa/Carneros
    "WRW5018AD": {"region": "Napa"},
    # Cantine Leonardo Da Vinci — Tuscany (Romagna)
    "WRW5284AA": {"region": "Tuscany"},
    # Messenez Family Chateau M — Languedoc
    "WRW5463FJ": {"region": "Languedoc"},
    # CUNE Gran Reserva — Rioja
    "WRW5763FJ": {"region": "Rioja"},
    # Noble Hill — Simonsberg-Paarl
    "WRW5774DD": {"region": "Paarl"},
    # La Cour Des Dames — Languedoc (Pays d'Oc)
    "WRW5783DD": {"region": "Languedoc"},
    # The Blind Pig — California
    "WRW5930GE": {"region": "California"},
    # Pingorote — Castilla-La Mancha
    "WRW6202GF": {"region": "Castilla-La Mancha"},
    # Fantini Edizione — Abruzzo
    "WRW6507AD": {"region": "Abruzzo"},
    # Riporta — Puglia
    "WRW6572GX": {"region": "Puglia"},
    # Alexander Valley (District Series) — Alexander Valley, Sonoma
    "WRW6590GX": {"region": "Sonoma"},
    # Krug — Champagne
    "WSP1093AD": {"region": "Champagne"},
    # Juvé & Camps — Penedès (Cava)
    "WSP2519FC": {"region": "Penedès"},
    # Veuve du Vernay — Loire/Burgundy (French sparkling)
    "WSP2522AD": {"region": "Loire"},
    # San Maurizio — Piedmont (Moscato)
    "WSP2649DD": {"region": "Piedmont"},
    # Follador — Veneto (Prosecco)
    "WSP5713AE": {"region": "Veneto"},
    # French Bloom — Languedoc
    "WSP5750EI": {"region": "Languedoc"},
    # Louis Roederer — Champagne
    "WSP5753BN": {"region": "Champagne"},
    "WSP5782BN": {"region": "Champagne"},
    "WSP5786BN": {"region": "Champagne"},
    # Prinz Von Hessen — Rheingau
    "WWW0436AD": {"region": "Rheingau"},
    # Laurenz V. — Kamptal (Austria)
    "WWW1020AD": {"region": "Kamptal"},
    # Nederburg — Western Cape
    "WWW1096AD": {"region": "Western Cape"},
    # Laurent Miquel — Languedoc
    "WWW1314AC": {"region": "Languedoc"},
    # Peter Michael — Sonoma (Knights Valley)
    "WWW1438BN": {"region": "Sonoma"},
    # Castello del Poggio — Piedmont (Moscato di Pavia → Lombardy actually)
    "WWW1735AD": {"region": "Lombardy"},
    # St. Paul's Justina Gewurztraminer — Alto Adige
    "WWW2020BS": {"region": "Alto Adige"},
    # Blue Nun — Rheinhessen
    "WWW2027AF": {"region": "Rheinhessen"},
    # Villa Maria — Marlborough
    "WWW2032AD": {"region": "Marlborough"},
    # Brancott Estate — Marlborough
    "WWW2217BU": {"region": "Marlborough"},
    # Dr Loosen — Mosel
    "WWW5919AD": {"region": "Mosel"},
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"=== Manual Region Fill — {len(MANUAL)} products ===", flush=True)

    if args.dry_run:
        for sku, data in MANUAL.items():
            print(f"  {sku:20s} -> {data}", flush=True)
        print(f"\n[DRY RUN] {len(MANUAL)} updates planned", flush=True)
        return

    patched = 0
    failed = 0
    for sku, data in MANUAL.items():
        try:
            patch(sku, data)
            patched += 1
            print(f"  {sku} -> {data.get('region', '?')}", flush=True)
        except Exception as e:
            print(f"  FAIL {sku}: {e}", flush=True)
            failed += 1

    print(f"\nDone: {patched} patched, {failed} failed", flush=True)

if __name__ == "__main__":
    main()
