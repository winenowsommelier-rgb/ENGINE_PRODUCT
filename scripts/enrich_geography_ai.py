#!/usr/bin/env python3
"""
AI-powered Geography Enrichment (Region, Sub-region, Appellation).

Builds on the Supabase fetching/patching logic from write_spirits_descriptions.py,
using the Google Gemini API to extract missing taxonomy from product names and descriptions.
"""
import json
import argparse
import os
from urllib import request, parse

try:
    import google.generativeai as genai
except ImportError:
    print("Error: google-generativeai library is required. Please run: pip install google-generativeai")
    exit(1)

BASE = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://xfcvliyxxguhihehqwkg.supabase.co")
KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

def fetch_missing_geography(tiers):
    rows, offset = [], 0
    print(f"Fetching T{tiers} products from Supabase...", flush=True)
    tier_filter = f"enrichment_priority=in.({tiers})"
    while True:
        url = f"{BASE}/rest/v1/products?{tier_filter}&select=sku,name,brand,classification,country,region,subregion,appellation,grape_variety,wine_classification,short_description_en,description_en_text&limit=1000&offset={offset}&order=sku.asc"
        req = request.Request(url, headers=H)
        with request.urlopen(req) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000:
                break
            offset += 1000

    missing = []
    for r in rows:
        cls = str(r.get("classification") or "").lower()
        if "wine" in cls:
            # Target products that are missing at least one of the key geographic or taxonomy levels
            if not r.get("region") or not r.get("subregion") or not r.get("appellation") or not r.get("grape_variety") or not r.get("wine_classification"):
                missing.append(r)
    return missing

def patch(sku, data):
    encoded = parse.quote(sku, safe="")
    url = f"{BASE}/rest/v1/products?sku=eq.{encoded}"
    body = json.dumps(data).encode()
    req = request.Request(
        url, data=body,
        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH",
    )
    with request.urlopen(req) as r:
        pass

def s(v):
    return str(v).strip() if v else ""

def ask_gemini_for_geography(p):
    name = s(p.get("name"))
    brand = s(p.get("brand"))
    country = p.get("country")
    region = p.get("region")
    subregion = p.get("subregion")
    appellation = p.get("appellation")
    grape_variety = p.get("grape_variety")
    wine_classification = p.get("wine_classification")
    desc_short = s(p.get("short_description_en"))
    desc_full = s(p.get("description_en_text"))

    prompt = f"""
You are an expert sommelier and wine/spirits taxonomy manager.
Extract the geographical origin, grape variety, and wine classification from the following product details.

Name: {name}
Brand: {brand}
Short Desc: {desc_short}
Full Desc: {desc_full}

Current Data:
- country: {country or "NULL"}
- region: {region or "NULL"}
- subregion: {subregion or "NULL"}
- appellation: {appellation or "NULL"}
- grape_variety: {grape_variety or "NULL"}
- wine_classification: {wine_classification or "NULL"}

Instructions:
1. If a Current Data field is NULL, infer it from the Name, Brand, or Descriptions.
2. If a Current Data field is already populated, keep it unless you are 100% sure it's wrong based on the product name.
3. Use official, recognized wine taxonomy names (e.g., "Bordeaux", "Pauillac", "Margaux AOC").
4. 'grape_variety' should be the standard grape name(s) (e.g., "Cabernet Sauvignon", "Chardonnay").
5. 'wine_classification' should be the quality tier or regulatory class if applicable (e.g., "Grand Cru Classé", "DOCG", "Reserva").
6. Return ONLY a valid JSON object with exactly these keys. Do not include markdown, explanations, or any other text. Use null if you cannot confidently identify a missing field.

{{
  "country": "string or null",
  "region": "string or null",
  "subregion": "string or null",
  "appellation": "string or null",
  "grape_variety": "string or null",
  "wine_classification": "string or null"
}}
"""
    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction="You output strict JSON without any conversational text."
        )
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(response_mime_type="application/json")
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"  API Error: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Enrich Geography (Region/Subregion/Appellation) using Gemini AI.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of products processed (0 = all)")
    parser.add_argument("--tiers", type=str, default="1,2", help="Comma-separated list of priority tiers (default: 1,2)")
    args = parser.parse_args()

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        print("Error: GEMINI_API_KEY environment variable is required.")
        exit(1)
        
    genai.configure(api_key=gemini_key)

    products = fetch_missing_geography(args.tiers)
    print(f"  Found: {len(products)} wine products missing region, subregion, appellation, grape variety, or classification.", flush=True)

    if args.limit > 0:
        products = products[:args.limit]
        print(f"  Limiting to: {len(products)}", flush=True)

    updates = {}
    skipped = 0

    for idx, p in enumerate(products, 1):
        sku = p["sku"]
        print(f"\n[{idx}/{len(products)}] Processing {sku} ({p['name'][:30]}...)", flush=True)
        
        ai_data = ask_gemini_for_geography(p)
        
        if not ai_data:
            skipped += 1
            continue

        # Compare and only patch what changed
        patch_data = {}
        for key in ["country", "region", "subregion", "appellation", "grape_variety", "wine_classification"]:
            old_val = p.get(key)
            new_val = ai_data.get(key)
            
            # Only update if the AI found a new value that isn't null and is different
            if new_val and new_val != old_val:
                patch_data[key] = new_val
        
        if patch_data:
            updates[sku] = patch_data
            for k, v in patch_data.items():
                print(f"    + {k}: {v}")
        else:
            skipped += 1
            print(f"    - No new taxonomy found")

    print(f"\n--- Summary ---", flush=True)
    print(f"  Will update:     {len(updates)}", flush=True)
    print(f"  Skipped (no new data): {skipped}", flush=True)

    if args.dry_run:
        print(f"\n[DRY RUN] No changes written to database.", flush=True)
        return

    if not updates:
        return

    print(f"\nWriting updates to Supabase...", flush=True)
    patched = 0
    failed = 0

    for sku, data in updates.items():
        try:
            patch(sku, data)
            patched += 1
        except Exception as e:
            print(f"  FAIL {sku}: {e}", flush=True)
            failed += 1

    print(f"\nDone: {patched} patched, {failed} failed.", flush=True)

if __name__ == "__main__":
    main()