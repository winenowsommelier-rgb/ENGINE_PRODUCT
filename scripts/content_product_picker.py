#!/usr/bin/env python3
"""Rank in-stock products for blog embeds — premium-first.

Reads data/live_products_export.json (the UI source of truth, Rule 9).
Rank: reputation tier (iconic > premium > established > everyday/unrated)
      -> critic score desc -> 90d sales qty desc -> price desc.

Usage:
  .venv/bin/python scripts/content_product_picker.py --prefix WR --region Bordeaux --max-price 15000
  .venv/bin/python scripts/content_product_picker.py --name margaux
  .venv/bin/python scripts/content_product_picker.py --country Japan --prefix LS --limit 15
"""
import argparse
import json
from pathlib import Path

EXPORT = Path(__file__).resolve().parent.parent / "data" / "live_products_export.json"
TIER_RANK = {"iconic": 0, "premium": 1, "established": 2, "everyday": 3}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prefix", help="SKU prefix, e.g. WR, WSP, LS, LW")
    ap.add_argument("--country")
    ap.add_argument("--region")
    ap.add_argument("--variety", help="substring match on variety")
    ap.add_argument("--name", help="substring match on product name")
    ap.add_argument("--min-price", type=float, default=0)
    ap.add_argument("--max-price", type=float, default=1e12)
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    products = json.loads(EXPORT.read_text())
    rows = []
    for p in products:
        if str(p.get("is_in_stock")) != "1":
            continue
        price = p.get("price") or 0
        if not (args.min_price <= price <= args.max_price):
            continue
        if args.prefix and not (p.get("sku") or "").startswith(args.prefix):
            continue
        if args.country and (p.get("country") or "").lower() != args.country.lower():
            continue
        if args.region and args.region.lower() not in (p.get("region") or "").lower():
            continue
        if args.variety and args.variety.lower() not in (p.get("variety") or "").lower():
            continue
        if args.name and args.name.lower() not in (p.get("name") or "").lower():
            continue
        rows.append(p)

    rows.sort(
        key=lambda p: (
            TIER_RANK.get(p.get("reputation_tier") or "", 9),
            -(p.get("score_max") or 0),
            -(p.get("popularity_qty_window") or 0),
            -(p.get("price") or 0),
        )
    )

    print(f"{len(rows)} matches (showing {min(args.limit, len(rows))})")
    print(f"{'SKU':<12} {'TIER':<12} {'SCORE':>5} {'QTY90':>6} {'PRICE':>10}  {'IMG':<3} NAME")
    for p in rows[: args.limit]:
        print(
            f"{p.get('sku',''):<12} {p.get('reputation_tier') or '-':<12} "
            f"{p.get('score_max') or '-':>5} {p.get('popularity_qty_window') or 0:>6.0f} "
            f"{'฿' + format(p.get('price') or 0, ',.0f'):>10}  "
            f"{'yes' if p.get('image_url') else 'NO':<3} {(p.get('name') or '')[:60]}"
        )


if __name__ == "__main__":
    main()
