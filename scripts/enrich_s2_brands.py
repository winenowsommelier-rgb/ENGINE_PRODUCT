#!/usr/bin/env python3
"""
Enrich S2 Brands using Claude 3.5 Sonnet (Mid-Market / Core Catalog).

Reads data/brand_description_library.csv, filters for mid-tier brands
(by default, 3 <= product_count <= 9), and calls Claude to generate
retailer-optimized, sensory-focused brand descriptions.

Usage:
    export ANTHROPIC_API_KEY="your-api-key"
    python scripts/enrich_s2_brands.py --min-products 3 --max-products 9
    python scripts/enrich_s2_brands.py --dry-run
"""

import csv
import json
import os
import time
import argparse
import urllib.request
from urllib.error import HTTPError

CSV_PATH = "data/brand_description_library.csv"

SYSTEM_PROMPT = """You are a wine and spirits expert writing taxonomy descriptions for a premium online retailer. 
Write in a third-party, expert sommelier voice. NEVER use first-person ("we", "our").

ANTI-HALLUCINATION RULE:
If this is an obscure or highly localized brand and you DO NOT have reliable factual knowledge about its history, terroir, or production methods, DO NOT hallucinate. Return empty strings ("") for both description fields.

Your task is to write two descriptions for the requested brand:

1. desc_short_en (max 150 chars):
   - 1-2 sentences acting as a hook.
   - State what the brand is, its origin, and what it is most famous for.

2. desc_full_en (max 1000 chars, 5-8 sentences):
   - Copywriting Constraint: Make the FIRST sentence a strong value proposition or statement of prestige/social proof.
   - Middle sentences: Cover history, production philosophy (e.g., still types, oak programs, terroir), and signature portfolio.
   - Copywriting Constraint: Dedicate the FINAL sentence strictly to the sensory profile (what it tastes/feels like) to drive consumer craving.

Output exactly in this JSON format:
{
  "description_short_en": "...",
  "description_full_en": "..."
}
"""

def call_claude(brand_name, country, classification, api_key):
    url = "https://api.anthropic.com/v1/messages"
    
    user_prompt = f"""
    Please write the descriptions for the following producer/brand:
    - Brand Name: {brand_name}
    - Country of Origin: {country}
    - Primary Classification: {classification}
    """
    
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    
    data = {
        "model": "claude-3-5-sonnet-20240620",
        "max_tokens": 1000,
        "temperature": 0.5, # Slightly lower temperature for S2 to enforce strict factual accuracy
        "system": SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": user_prompt}
        ]
    }
    
    req = urllib.request.Request(url, json.dumps(data).encode("utf-8"), headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read()
            res_json = json.loads(res_body)
            content = res_json["content"][0]["text"]
            
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
                
            return json.loads(content)
            
    except HTTPError as e:
        print(f"  [!] HTTP Error calling Claude: {e.code} {e.reason}")
        if e.code == 429:
            print("  [!] Rate limited. Sleeping for 10 seconds...")
            time.sleep(10)
        return None
    except Exception as e:
        print(f"  [!] Error parsing Claude response: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Enrich S2 Brands using Claude")
    parser.add_argument("--min-products", type=int, default=3, help="Minimum product count")
    parser.add_argument("--max-products", type=int, default=9, help="Maximum product count")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed")
    args = parser.parse_args()
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not args.dry_run and not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable is missing.")
        return
        
    rows = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)
            
    s2_brands = []
    for idx, row in enumerate(rows):
        try:
            count = int(row.get("product_count", 0))
        except ValueError:
            count = 0
            
        if args.min_products <= count <= args.max_products and row.get("copy_status") != "expert_reviewed":
            s2_brands.append((idx, row))
            
    print(f"Found {len(s2_brands)} S2 brands (between {args.min_products} and {args.max_products} products).")
    
    if args.dry_run:
        return
        
    processed_count = 0
    skipped_count = 0
    
    for idx, row in s2_brands:
        brand_name = row.get("entity_name")
        country = row.get("parent_country")
        
        print(f"Processing: {brand_name} ({country})...")
        result = call_claude(brand_name, country, row.get("classification_scope"), api_key)
        
        if result and result.get("description_short_en") and result.get("description_full_en"):
            rows[idx]["description_short_en"] = result["description_short_en"]
            rows[idx]["description_full_en"] = result["description_full_en"]
            rows[idx]["copy_status"] = "expert_reviewed"
            rows[idx]["notes"] = "AI generated S2 enrichment"
            processed_count += 1
            print(f"  [+] Success! Updated {brand_name}.")
            
            temp_path = CSV_PATH + ".tmp"
            with open(temp_path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            os.replace(temp_path, CSV_PATH)
        else:
            print(f"  [-] Skipped {brand_name} (Insufficient AI knowledge or error).")
            skipped_count += 1
            
        time.sleep(1.5)
            
    print(f"\nDone! Enriched {processed_count} S2 brands. Skipped {skipped_count} brands.")

if __name__ == "__main__":
    main()