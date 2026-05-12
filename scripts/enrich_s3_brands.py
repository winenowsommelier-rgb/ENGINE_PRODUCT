#!/usr/bin/env python3
"""
Enrich S3 Brands using Claude 3.5 Sonnet (Long-Tail / Boutique / Single SKU).

Reads data/brand_description_library.csv, filters for long-tail brands
(by default, product_count < 3), and calls Claude to generate descriptions.
Includes a strict confidence check to prevent hallucination on obscure brands.

Usage:
    export ANTHROPIC_API_KEY="your-api-key"
    python scripts/enrich_s3_brands.py --max-products 2
    python scripts/enrich_s3_brands.py --dry-run
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

You are evaluating a "long-tail" or boutique brand. It might be highly obscure.

STRICT HALLUCINATION RULE:
If you DO NOT have deep, factual knowledge about this specific brand's history and production:
1. Set "confidence" to "low".
2. Write a very simple, factual `description_short_en` based strictly on its origin and classification (e.g. "A boutique producer of Red Wine from the Burgundy region of France.").
3. Leave `description_full_en` completely blank ("").

If you DO know the brand intimately:
1. Set "confidence" to "high".
2. desc_short_en (max 150 chars): 1-2 sentences acting as a hook.
3. desc_full_en (max 1000 chars): First sentence is a strong value proposition. Middle covers history/terroir. Final sentence strictly describes the sensory profile.

Output exactly in this JSON format:
{
  "description_short_en": "...",
  "description_full_en": "...",
  "confidence": "high" or "low"
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
        "temperature": 0.2, # Very low temperature for S3 to strictly enforce anti-hallucination
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
    parser = argparse.ArgumentParser(description="Enrich S3 Brands using Claude")
    parser.add_argument("--max-products", type=int, default=2, help="Maximum product count for S3 criteria")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be processed without saving")
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
            
    s3_brands = []
    for idx, row in enumerate(rows):
        try:
            count = int(row.get("product_count", 0))
        except ValueError:
            count = 0
            
        # Match S3 criteria (<= max_products) and ensure we haven't already processed it
        if count <= args.max_products and row.get("copy_status") not in ["expert_reviewed", "needs_review"]:
            s3_brands.append((idx, row))
            
    print(f"Found {len(s3_brands)} S3 brands (<= {args.max_products} products) needing enrichment.")
    
    if args.dry_run:
        print("Dry run complete. Exiting.")
        return
        
    processed_count = 0
    high_confidence_count = 0
    low_confidence_count = 0
    
    for idx, row in s3_brands:
        brand_name = row.get("entity_name")
        country = row.get("parent_country")
        
        print(f"Processing: {brand_name} ({country})...")
        result = call_claude(brand_name, country, row.get("classification_scope"), api_key)
        
        if result:
            confidence = result.get("confidence", "low").lower()
            
            rows[idx]["description_short_en"] = result.get("description_short_en", "")
            rows[idx]["description_full_en"] = result.get("description_full_en", "")
            
            if confidence == "high":
                rows[idx]["copy_status"] = "expert_reviewed"
                rows[idx]["notes"] = "AI generated S3 - High Confidence"
                high_confidence_count += 1
                print(f"  [+] HIGH CONFIDENCE: Updated {brand_name}.")
            else:
                rows[idx]["copy_status"] = "needs_review"
                rows[idx]["notes"] = "AI generated S3 - Generic/Obscure"
                low_confidence_count += 1
                print(f"  [-] LOW CONFIDENCE: Safely generated generic short description for {brand_name}.")
            
            processed_count += 1
            
            # Save atomically
            temp_path = CSV_PATH + ".tmp"
            with open(temp_path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            os.replace(temp_path, CSV_PATH)
            
            time.sleep(1.5)
        else:
            print(f"  [!] Failed to get valid response for {brand_name}.")
            
    print(f"\nDone! Enriched {processed_count} S3 brands.")
    print(f"  - High Confidence (Auto-Approved): {high_confidence_count}")
    print(f"  - Low Confidence (Needs Review): {low_confidence_count}")

if __name__ == "__main__":
    main()