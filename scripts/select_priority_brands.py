#!/usr/bin/env python3
"""Pick the N priority brands for brand-library curation.

Priority rubric (no LLM — pure scoring against products.db state):

    priority = (C-grade SKU count) * 2
             + min(max_price / 1000, 30)     -- prestige proxy, capped
             + min(total_skus / 2, 15)       -- catalog coverage value

The C-grade weighting forces "we have premium brands with weak content
RIGHT NOW" to surface (Suntory, Hennessy, Chateau Margaux, etc.).
Prestige cap prevents one ฿250k bottle from dominating; catalog cap
prevents Coastal Ridge (1000+ SKUs at low prices) from dominating.

Output: data/brand_curation_priorities.csv — the input list for the
research swarm. Re-runnable as catalog/grades change.

Usage:
    .venv/bin/python scripts/select_priority_brands.py --top 50
"""
from __future__ import annotations

import argparse
import collections
import csv
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "brand_curation_priorities.csv"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--top", type=int, default=50)
    args = p.parse_args(argv)

    conn = sqlite3.connect(args.db)
    stats: dict[str, dict] = collections.defaultdict(lambda: {
        "total_skus": 0, "enriched_skus": 0,
        "a_count": 0, "b_count": 0, "c_count": 0,
        "max_price": 0.0, "sum_price": 0.0, "price_count": 0,
        "classifications": set(),
        "country": "",
    })
    for sku, brand, cls, country, price, grade in conn.execute("""
        SELECT sku, brand, classification, country, price, enrichment_quality_grade
        FROM products WHERE brand IS NOT NULL AND brand != ''
    """):
        b = stats[brand]
        b["total_skus"] += 1
        if not b["country"] and country:
            b["country"] = country
        if grade in ("A", "B", "C"):
            b["enriched_skus"] += 1
            b[f"{grade.lower()}_count"] += 1
        if price and price > 0:
            b["max_price"] = max(b["max_price"], price)
            b["sum_price"] += price
            b["price_count"] += 1
        if cls:
            b["classifications"].add(cls)

    rows = []
    for brand, s in stats.items():
        if s["enriched_skus"] == 0:
            continue
        avg_price = s["sum_price"] / max(s["price_count"], 1)
        priority = (
            s["c_count"] * 2
            + min(s["max_price"] / 1000, 30)
            + min(s["total_skus"] / 2, 15)
        )
        rows.append({
            "brand": brand,
            "country": s["country"],
            "classifications": "|".join(sorted(s["classifications"])),
            "total_skus": s["total_skus"],
            "enriched_skus": s["enriched_skus"],
            "a_count": s["a_count"],
            "b_count": s["b_count"],
            "c_count": s["c_count"],
            "max_price_thb": int(s["max_price"]),
            "avg_price_thb": int(avg_price),
            "priority_score": round(priority, 2),
        })
    rows.sort(key=lambda r: -r["priority_score"])
    selected = rows[: args.top]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=list(selected[0].keys()))
        wr.writeheader()
        wr.writerows(selected)
    print(f"Wrote {len(selected)} priority brands → {args.out}")
    print(f"\nTop {min(10, len(selected))}:")
    for r in selected[:10]:
        print(f"  {r['priority_score']:>5.1f}  {r['brand']:<35s}  "
              f"{r['country']:<20s}  C={r['c_count']:>3}  max=฿{r['max_price_thb']:>7,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
