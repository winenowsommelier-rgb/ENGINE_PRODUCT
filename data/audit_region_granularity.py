#!/usr/bin/env python3
"""Audit every country's region values for granularity problems.

For each country, categorize its rows into:
  - 'specific'        — region is a known wine GI (Barossa Valley, Bordeaux, Napa, etc.)
  - 'state_or_zone'   — region is a state, province, or multi-state zone (South Australia, California, South Eastern Australia)
  - 'country_only'    — region equals the country name (or is the country in disguise)
  - 'blank'           — no region

Output: per-country breakdown + the top coarse values to attack first.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = REPO_ROOT / "data" / "db" / "products.json"

# Regions known to be coarse — flagged by-country. Anything not in these lists is treated
# as 'specific' (a real GI) by default. This is conservative — it errs on calling things
# specific when in doubt, so the report under-counts rather than over-counts.

COARSE_BY_COUNTRY: dict[str, set[str]] = {
    "Australia": {
        "South Australia", "South Eastern Australia", "Victoria", "Tasmania",
        "Western Australia", "New South Wales", "Queensland",
    },
    "USA": {
        "California", "Oregon", "Washington", "New York", "Texas", "Virginia",
    },
    "France": {
        "France",  # country-as-region
    },
    "Italy": {
        # Big Italian regions (regional level). Specific would be Chianti, Brunello, Barolo, etc.
        # However, some Italian regions ARE the GI (e.g., Sicilia DOC is OK at the region level).
        # We flag only the ones that almost always need refinement:
        "Italy",
    },
    "Spain": {
        "Spain", "Catalonia",
    },
    "Argentina": {
        "Argentina",
    },
    "Chile": {
        "Chile", "Central Valley",
    },
    "Germany": {
        "Germany",
    },
    "South Africa": {
        "South Africa",
    },
    "New Zealand": {
        "New Zealand",
    },
    "Portugal": {
        "Portugal",
    },
    "Austria": {
        "Austria",
    },
    "Hungary": {
        "Hungary",
    },
    "Greece": {
        "Greece",
    },
    "Lebanon": {
        "Lebanon",
    },
    "Israel": {
        "Israel",
    },
    "Turkey": {
        "Turkey",
    },
    "China": {
        "China",
    },
    "Japan": {
        "Japan",
    },
    "Canada": {
        "Canada", "Ontario", "British Columbia",
    },
    "Brazil": {
        "Brazil",
    },
    "Mexico": {
        "Mexico",
    },
    "Uruguay": {
        "Uruguay",
    },
    "Romania": {
        "Romania",
    },
    "Bulgaria": {
        "Bulgaria",
    },
}


def categorize(country: str, region: str) -> str:
    region = region or ""
    if not region.strip():
        return "blank"
    if country and region.strip().lower() == country.strip().lower():
        return "country_only"
    coarse_set = COARSE_BY_COUNTRY.get(country, set())
    if region in coarse_set:
        return "state_or_zone"
    return "specific"


def main() -> int:
    products = json.loads(PRODUCTS_PATH.read_text())
    by_country: dict[str, Counter[str]] = defaultdict(Counter)
    coarse_examples: dict[str, Counter[str]] = defaultdict(Counter)
    total_by_country: Counter[str] = Counter()

    for p in products:
        country = (p.get("country") or "").strip() or "(blank-country)"
        region = (p.get("region") or "").strip()
        cat = categorize(country, region)
        by_country[country][cat] += 1
        total_by_country[country] += 1
        if cat in ("state_or_zone", "country_only", "blank"):
            label = region or "(blank)"
            coarse_examples[country][label] += 1

    # Header
    print(f"{'Country':<22} {'Total':>6} {'Specific':>9} {'State/Zone':>11} {'Country-only':>13} {'Blank':>6} {'Coarse %':>9}")
    print("-" * 88)
    rows = []
    for country, total in total_by_country.most_common():
        if total < 5:  # skip noise
            continue
        cats = by_country[country]
        specific = cats["specific"]
        soz = cats["state_or_zone"]
        cou = cats["country_only"]
        blank = cats["blank"]
        coarse = soz + cou + blank
        pct = (coarse / total * 100) if total else 0
        rows.append((country, total, specific, soz, cou, blank, pct))

    # Sort by raw coarse count, descending — biggest cleanups first
    rows.sort(key=lambda r: -(r[3] + r[4] + r[5]))
    for country, total, specific, soz, cou, blank, pct in rows:
        print(f"{country[:21]:<22} {total:>6} {specific:>9} {soz:>11} {cou:>13} {blank:>6} {pct:>8.0f}%")

    # Top coarse value per country (with at least 5 coarse rows)
    print()
    print("=== Top coarse region values by country (where coarse >= 5) ===")
    for country, total, specific, soz, cou, blank, pct in rows:
        coarse = soz + cou + blank
        if coarse < 5:
            continue
        print(f"\n{country} — {coarse} coarse rows out of {total}:")
        for value, cnt in coarse_examples[country].most_common(8):
            print(f"  {cnt:5d}  {value!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
