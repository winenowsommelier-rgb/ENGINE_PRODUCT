#!/usr/bin/env python3
"""
Enrich S1 Brands using Claude 3.5 Sonnet.

Reads data/brand_description_library.csv, filters for top-tier brands
(by default, product_count >= 10), and calls Claude to generate
retailer-optimized, sensory-focused brand descriptions.

Usage:
    export ANTHROPIC_API_KEY="your-api-key"
    python scripts/enrich_s1_brands.py --min-products 10
    python scripts/enrich_s1_brands.py --dry-run
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
        "temperature": 0.7,
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
            
            # Parse the JSON out of Claude's response
            # Sometimes Claude wraps json in markdown blocks
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
    parser = argparse.ArgumentParser(description="Enrich S1 Brands using Claude")
    parser.add_argument("--min-products", type=int, default=10, help="Minimum product count to qualify as S1")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed without calling API")
    args = parser.parse_args()
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not args.dry_run and not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable is missing.")
        print("Run: export ANTHROPIC_API_KEY='your-key'")
        return
        
    # Read all rows
    rows = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)
            
    s1_brands = []
    for idx, row in enumerate(rows):
        try:
            count = int(row.get("product_count", 0))
        except ValueError:
            count = 0
            
        # Filter criteria: High product count AND not already expert_reviewed
        if count >= args.min_products and row.get("copy_status") != "expert_reviewed":
            s1_brands.append((idx, row))
            
    print(f"Found {len(s1_brands)} S1 brands (>= {args.min_products} products) needing enrichment.")
    
    if args.dry_run:
        print("Dry run complete. Exiting.")
        return
        
    processed_count = 0
    
    for idx, row in s1_brands:
        brand_name = row.get("entity_name")
        country = row.get("parent_country")
        classification = row.get("classification_scope")
        
        print(f"Processing: {brand_name} ({country} - {classification})...")
        
        result = call_claude(brand_name, country, classification, api_key)
        
        if result and "description_short_en" in result and "description_full_en" in result:
            # Update the row
            rows[idx]["description_short_en"] = result["description_short_en"]
            rows[idx]["description_full_en"] = result["description_full_en"]
            rows[idx]["copy_status"] = "expert_reviewed"
            rows[idx]["notes"] = "AI generated S1 enrichment"
            processed_count += 1
            print(f"  [+] Success! Updated {brand_name}.")
            
            # Save safely after every successful call to prevent data loss
            temp_path = CSV_PATH + ".tmp"
            with open(temp_path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            os.replace(temp_path, CSV_PATH)
            
            # Gentle rate limiting
            time.sleep(1.5)
        else:
            print(f"  [-] Failed to process {brand_name}.")
            
    print(f"\nDone! Successfully enriched {processed_count} S1 brands.")

if __name__ == "__main__":
    main()