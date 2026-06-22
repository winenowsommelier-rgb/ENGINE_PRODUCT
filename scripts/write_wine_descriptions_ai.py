#!/usr/bin/env python3
"""
AI-powered Universal Product Description Generator.

Uses the Google Gemini API to generate professional, engaging tasting notes and descriptions
for all product categories (Wine, Spirits, Sake, Accessories, etc.) based on structured attributes.
"""
import json
import argparse
import os
import re
from urllib import request, parse

try:
    import google.generativeai as genai
except ImportError:
    print("Error: google-generativeai library is required. Please run: pip install google-generativeai")
    exit(1)

BASE = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://xfcvliyxxguhihehqwkg.supabase.co")
KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

def s(v):
    return str(v).strip() if v else ""

def is_placeholder(text):
    """Return True if existing description is essentially empty or a bare placeholder."""
    if not text or not text.strip():
        return True
    if len(text.strip()) < 20:
        return True
    return False

def fetch_products(tiers, force):
    rows, offset = [], 0
    print(f"Fetching T{tiers} products from Supabase...", flush=True)
    tier_filter = f"enrichment_priority=in.({tiers})"
    while True:
        url = f"{BASE}/rest/v1/products?{tier_filter}&select=sku,name,brand,classification,style,country,region,subregion,appellation,variety,wine_classification,flavor_tags,food_matching,desc_en_short,desc_en_full,short_description_en,description_en_text&limit=1000&offset={offset}&order=sku.asc"
        req = request.Request(url, headers=H)
        with request.urlopen(req) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000:
                break
            offset += 1000

    targets = []
    for r in rows:
        # Target products that are missing short or full descriptions, or if force is true
        missing_short = is_placeholder(r.get("desc_en_short")) and is_placeholder(r.get("short_description_en"))
        missing_full = is_placeholder(r.get("desc_en_full"))
        if force or missing_short or missing_full:
            targets.append(r)
    return targets

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

def ask_gemini_for_description(p):
    name = s(p.get("name"))
    brand = s(p.get("brand"))
    cls = s(p.get("classification"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    region = s(p.get("region"))
    subregion = s(p.get("subregion"))
    appellation = s(p.get("appellation"))
    grape = s(p.get("variety"))
    wine_class = s(p.get("wine_classification"))
    flavor_tags = s(p.get("flavor_tags"))
    food_matching = s(p.get("food_matching"))
    old_short = s(p.get("short_description_en"))
    old_full = s(p.get("description_en_text"))

    prompt = f"""
You are an elite Master Sommelier, Master Distiller, Cicerone, and world-class luxury goods copywriter.
Write a definitive, captivating product description that will serve as the core foundational text across all brand matrixes and visual merchandising. Avoid generic, cookie-cutter templates. Write with profound expertise, sensory depth, and elegant prose.

Product Data:
- Name: {name}
- Brand: {brand}
- Classification: {cls}
- Style: {style}
- Origin: {country}, {region}, {subregion}, {appellation}
- Grape Variety: {grape}
- Quality Tier: {wine_class}
- Flavor Tags/Notes: {flavor_tags}
- Food Pairings: {food_matching}
- Existing Draft Short Desc: {old_short}
- Existing Draft Full Desc: {old_full}

Instructions:
1. Read all product data. If key details are empty, infer them naturally from the Name or Existing Drafts.
2. Create a "desc_en_short": A punchy, elegant 1 to 2 sentence summary of the product.
3. Create a "desc_en_full": A beautifully written, bespoke product story and tasting note (2 to 3 paragraphs).
   - Wrap the full description in HTML, exactly like this: <div class="prod-desc"><p>Para 1</p><p>Para 2</p></div>
4. Output strict JSON with exactly these two keys. No markdown, no explanations.

Category-Specific Focus Guidelines:
- WINE: Emphasize terroir, vintage conditions (if known), grape expression, winemaking philosophy, detailed tasting notes, and pairing elegance.
- SPIRITS (Whisky, Gin, Rum, Tequila, Cognac, etc.): Focus on distillation craft, mash bill/botanicals, cask maturation, the art of the Master Distiller, and complex sensory evolution.
- SAKE: Highlight rice polishing (Seimai-buai), water purity, brewery heritage, umami balance, and traditional craftsmanship.
- BEER: Discuss brewing tradition, malt/hop harmony, mouthfeel, and character (refreshing or robust).
- ACCESSORY/GLASSWARE: Focus on artisanal design, material quality, ergonomics, and how it elevates the ritual of drinking.

Make sure the writing is highly unique, descriptive, and does NOT sound like a generic fill-in-the-blank template.

{{
  "desc_en_short": "string",
  "desc_en_full": "string containing HTML"
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
    parser = argparse.ArgumentParser(description="Generate rich descriptions for all products using Gemini AI.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of products processed (0 = all)")
    parser.add_argument("--tiers", type=str, default="1,2", help="Comma-separated list of priority tiers (default: 1,2)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing generated descriptions")
    args = parser.parse_args()

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        print("Error: GEMINI_API_KEY environment variable is required.")
        exit(1)
        
    genai.configure(api_key=gemini_key)

    products = fetch_products(args.tiers, args.force)
    print(f"  Found: {len(products)} products needing descriptions.", flush=True)

    if args.limit > 0:
        products = products[:args.limit]
        print(f"  Limiting to: {len(products)}", flush=True)

    updates = {}
    skipped = 0

    for idx, p in enumerate(products, 1):
        sku = p["sku"]
        print(f"\n[{idx}/{len(products)}] Writing notes for {sku} ({p['name'][:30]}...)", flush=True)
        
        ai_data = ask_gemini_for_description(p)
        
        if not ai_data or "desc_en_short" not in ai_data or "desc_en_full" not in ai_data:
            skipped += 1
            print("    - Failed to generate valid description.")
            continue

        updates[sku] = ai_data
        
        if args.dry_run:
            print(f"    + SHORT: {ai_data['desc_en_short']}")
            print(f"    + FULL:  {ai_data['desc_en_full'][:100]}...")

    print(f"\n--- Summary ---", flush=True)
    print(f"  Will update: {len(updates)}", flush=True)
    print(f"  Skipped:     {skipped}", flush=True)

    if args.dry_run or not updates:
        print(f"\n[DRY RUN] No changes written to database.", flush=True)
        return

    print(f"\nWriting updates to Supabase...", flush=True)
    patched = 0
    failed = 0
    items = list(updates.items())
    total = len(items)

    for i in range(0, total, 50):
        batch = items[i:i + 50]
        for sku, data in batch:
            try:
                patch(sku, data)
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        done = min(i + 50, total)
        pct = (done / total) * 100
        print(f"  Patched {done}/{total} ({pct:.0f}%)", flush=True)

    print(f"\nDone: {patched} patched, {failed} failed.", flush=True)

if __name__ == "__main__":
    main()