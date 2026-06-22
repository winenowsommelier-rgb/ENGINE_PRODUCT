#!/usr/bin/env python3
"""
local-enrich.py  — Zero-API enrichment for products that already have source descriptions.

Strategy:
  - short_description_en  →  desc_en_short  (used as-is, trimmed)
  - description_en_text   →  desc_en_full   (plain text → HTML paragraphs)
  - Products with neither → written to data/needs_ai_review.json for manual handling

Usage:
  python3 scripts/local-enrich.py [--tier=1] [--dry-run] [--limit=N] [--overwrite]
  python3 scripts/local-enrich.py --tier=1 --dry-run
  python3 scripts/local-enrich.py --tier=1
"""

from __future__ import annotations
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, parse, error as urlerror

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL  = "https://xfcvliyxxguhihehqwkg.supabase.co"
API_KEY   = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
HEADERS   = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}

RESULTS_DIR  = Path(__file__).parent.parent / "data" / "enrichment_results"
NEEDS_AI_FILE = Path(__file__).parent.parent / "data" / "needs_ai_review.json"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sb_get(path: str) -> list[dict]:
    url = f"{BASE_URL}/rest/v1/{path}"
    req = request.Request(url, headers={**HEADERS, "Prefer": "count=none"})
    with request.urlopen(req) as r:
        return json.loads(r.read())


def sb_get_all(path: str, page_size: int = 1000) -> list[dict]:
    """Paginated fetch — keeps requesting until fewer than page_size rows returned."""
    all_rows: list[dict] = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        page_path = f"{path}{sep}limit={page_size}&offset={offset}"
        rows = sb_get(page_path)
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def text_to_html(text: str) -> str:
    """Convert plain-text description to simple HTML paragraphs."""
    if not text:
        return ""
    # Normalise line endings, split on double newlines
    paras = [p.strip() for p in re.split(r"\n{2,}", text.strip()) if p.strip()]
    if not paras:
        return ""
    inner = "\n".join(f"<p>{p}</p>" for p in paras)
    return f'<div class="prod-desc">\n{inner}\n</div>'


def confidence_score(has_short: bool, has_long: bool, product: dict) -> float:
    """Estimate confidence based on how much source material exists."""
    score = 0.0
    if has_short:
        score += 0.50
        # Bonus for longer short description
        if len(product.get("short_description_en", "")) > 100:
            score += 0.10
    if has_long:
        score += 0.20
    # Bonus for rich taxonomy fields
    for field in ("country", "region", "style", "variety", "appellation"):
        if product.get(field):
            score += 0.02
    return round(min(score, 0.92), 2)  # Cap at 0.92; perfect score reserved for human-verified


def make_result_record(product: dict, now: str) -> dict | None:
    """Build the enrichment result JSON for a product. Returns None if no source material."""
    short = (product.get("short_description_en") or "").strip()
    long  = (product.get("description_en_text") or "").strip()

    has_short = bool(short)
    has_long  = bool(long)

    if not has_short and not has_long:
        return None  # Needs actual AI

    desc_en_short = short or None
    desc_en_full  = text_to_html(long) if has_long else (
        f'<div class="prod-desc"><p>{short}</p></div>' if has_short else None
    )

    conf = confidence_score(has_short, has_long, product)

    result = {
        "desc_en_short":    desc_en_short,
        "desc_en_full":     desc_en_full,
        "desc_confidence":  conf,
        "style_detail":     product.get("style_detail"),
        "subregion":        product.get("subregion"),
        "appellation":      product.get("appellation"),
        "wine_classification": None,
    }

    return {
        "product_id":           product["id"],
        "sku":                  product["sku"],
        "sku_base":             product["sku_base"],
        "name":                 product["name"],
        "classification":       product.get("classification"),
        "status":               "pending_review",
        "processed_at":         now,
        "desc_confidence":      conf,
        "original_desc_source": "original",
        "result":               result,
        "original": {
            "short_description_en": short or None,
            "description_en_text":  long or None,
        },
    }

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier",      type=int, default=0,     help="Enrichment priority tier (0=all)")
    parser.add_argument("--limit",     type=int, default=0,     help="Max products to process (0=all)")
    parser.add_argument("--dry-run",   action="store_true",      help="Print what would happen, don't write files")
    parser.add_argument("--overwrite", action="store_true",      help="Overwrite existing result files")
    args = parser.parse_args()

    # Build Supabase query
    filters = "is_primary_variant=eq.true&desc_en_short=is.null"
    if args.tier > 0:
        filters += f"&enrichment_priority=eq.{args.tier}"
    select = (
        "id,sku,sku_base,name,classification,color,style,style_detail,"
        "country,region,subregion,appellation,vintage,brand,variety,"
        "body,acidity,tannin,flavor_tags,food_matching,"
        "overall_confidence,short_description_en,description_en_text"
    )
    print(f"Fetching products (tier={args.tier or 'all'})…", flush=True)
    query = f"products?{filters}&select={select}&order=id.asc"
    if args.limit > 0:
        products = sb_get(f"{query}&limit={args.limit}")
    else:
        products = sb_get_all(query)
    print(f"  → {len(products)} products need desc_en_short")

    now = datetime.now(timezone.utc).isoformat()
    written = 0
    skipped = 0
    needs_ai: list[dict] = []

    for p in products:
        out_path = RESULTS_DIR / f"{p['id']}.json"

        # Skip if file already exists (unless --overwrite)
        if out_path.exists() and not args.overwrite:
            skipped += 1
            continue

        record = make_result_record(p, now)

        if record is None:
            needs_ai.append({"id": p["id"], "sku": p["sku"], "name": p["name"]})
            continue

        if args.dry_run:
            print(f"  [DRY] {p['id']} | conf={record['desc_confidence']} | {p['name'][:60]}")
        else:
            out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False))
            written += 1

        if written % 100 == 0 and written > 0:
            print(f"  … {written} written", flush=True)

    if not args.dry_run:
        print(f"\nDone: {written} written | {skipped} skipped (already exist) | {len(needs_ai)} need AI")
        if needs_ai:
            NEEDS_AI_FILE.write_text(json.dumps(needs_ai, indent=2, ensure_ascii=False))
            print(f"Products needing AI saved to: {NEEDS_AI_FILE}")
    else:
        print(f"\n[DRY RUN] Would write: {len(products) - len(needs_ai) - skipped} | Needs AI: {len(needs_ai)}")


if __name__ == "__main__":
    main()
