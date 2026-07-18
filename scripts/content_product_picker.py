#!/usr/bin/env python3
"""Rank in-stock products for blog embeds — premium-first.

Reads data/live_products_export.json (the UI source of truth, Rule 9).
Rank: reputation tier (iconic > premium > established > everyday/unrated)
      -> critic score desc -> 90d sales qty desc -> price desc.

Usage:
  .venv/bin/python scripts/content_product_picker.py --prefix WR --region Bordeaux --max-price 15000
  .venv/bin/python scripts/content_product_picker.py --name margaux
  .venv/bin/python scripts/content_product_picker.py --country Japan --prefix LS --limit 15
  .venv/bin/python scripts/content_product_picker.py --anchor WRW6601AF   # BI co-purchase companions
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORT = ROOT / "data" / "live_products_export.json"
AFFINITIES = ROOT / "data" / "bi-product-affinities.json"
TIER_RANK = {"iconic": 0, "premium": 1, "established": 2, "everyday": 3}
STALE_DAYS = 14


def warn_if_stale(label: str, iso: str) -> None:
    try:
        ts = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return
    age = (datetime.now(timezone.utc) - ts).days
    if age > STALE_DAYS:
        print(f"⚠️  {label} is {age} days old — re-sync from BI before trusting ranks")


def fmt_row(p: dict, extra: str = "") -> str:
    return (
        f"{p.get('sku',''):<12} {p.get('reputation_tier') or '-':<12} "
        f"{p.get('score_max') or '-':>5} {p.get('popularity_qty_window') or 0:>6.0f} "
        f"{'฿' + format(p.get('price') or 0, ',.0f'):>10}  "
        f"{'yes' if p.get('image_url') else 'NO':<3} {(p.get('name') or '')[:52]}{extra}"
    )


def show_anchor(anchor: str, products: list) -> None:
    """Print in-stock BI co-purchase companions for the anchor SKU."""
    data = json.loads(AFFINITIES.read_text())
    warn_if_stale("affinities export", data.get("exported_at", ""))
    base = anchor[:-2]
    entry = (data.get("affinities") or {}).get(base)
    if not entry:
        print(f"no BI affinity data for {anchor} (base {base})")
        return
    # best in-stock product per base code
    by_base: dict = {}
    for p in products:
        if str(p.get("is_in_stock")) != "1":
            continue
        b = (p.get("sku") or "")[:-2]
        if b not in by_base or (p.get("score_max") or 0) > (by_base[b].get("score_max") or 0):
            by_base[b] = p
    for kind, label in (("co_order_affinities", "SAME BASKET"), ("co_customer_affinities", "SAME CUSTOMER")):
        print(f"\n{label} — customers who bought {anchor} also bought:")
        shown = 0
        for row in entry.get(kind) or []:
            p = by_base.get(row["base_product_code"])
            if not p:
                continue  # companion is out of stock — never embed it
            print(fmt_row(p, f"  (rate {row['rate']:.0%})"))
            shown += 1
        if not shown:
            print("  (no in-stock companions)")


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
    ap.add_argument("--anchor", help="SKU: show BI co-purchase companions instead of a ranked list")
    args = ap.parse_args()

    products = json.loads(EXPORT.read_text())
    synced = next((p.get("popularity_synced_at") for p in products if p.get("popularity_synced_at")), "")
    warn_if_stale("BI popularity sync", synced)

    if args.anchor:
        show_anchor(args.anchor.upper(), products)
        return

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
    print(f"{'SKU':<12} {'TIER':<12} {'SCORE':>5} {'QTY':>6} {'PRICE':>10}  {'IMG':<3} NAME")
    for p in rows[: args.limit]:
        print(fmt_row(p))


if __name__ == "__main__":
    main()
