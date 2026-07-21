#!/usr/bin/env python3
"""
Generate brand lookup data from products.db for use by ticket-analysis and other processes.

Outputs: data/brand_lookup.json
Schema:
  {
    "by_name": { "<exact product name>": "<canonical brand>" },
    "by_brand": { "<canonical brand>": { "sku_count": N, "skus": [...] } },
    "aliases": { "<name fragment / alias>": "<canonical brand>" }
  }

The ticket-analysis process should:
  1. Try exact match in by_name first (most reliable)
  2. Fall back to substring match against aliases keys
  3. Fall back to by_brand keys for brand-level grouping
"""

import sqlite3
import json
import csv
import re
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "db" / "products.db"
AUTHORITY_CSV = Path(__file__).parent.parent / "data" / "authority_brand_producer_library.csv"
OUTPUT_PATH = Path(__file__).parent.parent / "data" / "brand_lookup.json"


def normalize(s: str) -> str:
    """Lowercase, collapse whitespace."""
    return re.sub(r"\s+", " ", s.strip().lower())


def build_lookup() -> dict:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        SELECT sku, name, brand
        FROM products
        WHERE brand IS NOT NULL AND brand != ''
          AND name IS NOT NULL AND name != ''
        ORDER BY brand, name
    """)
    rows = cur.fetchall()
    conn.close()

    by_name: dict[str, str] = {}
    by_brand: dict[str, dict] = {}

    for sku, name, brand in rows:
        name = name.strip()
        brand = brand.strip()

        # exact name → canonical brand
        by_name[name] = brand

        if brand not in by_brand:
            by_brand[brand] = {"sku_count": 0, "skus": []}
        by_brand[brand]["sku_count"] += 1
        by_brand[brand]["skus"].append(sku)

    # Build aliases: canonical brand name variants + authority library entries
    aliases: dict[str, str] = {}

    # Every canonical brand maps to itself (normalized lookup)
    for brand in by_brand:
        aliases[normalize(brand)] = brand

    # Pull alternate names from authority library
    if AUTHORITY_CSV.exists():
        with open(AUTHORITY_CSV, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                authority = row.get("authority_name", "").strip()
                canonical_brand = row.get("canonical_brand", "").strip()
                if authority and canonical_brand:
                    # authority_name is already the canonical form
                    aliases[normalize(authority)] = canonical_brand
                    # Also map without accents for fuzzy matching surface
                    plain = _strip_accents(normalize(authority))
                    if plain != normalize(authority):
                        aliases[plain] = canonical_brand

    result = {
        "generated_at": _now_iso(),
        "sku_count": len(rows),
        "brand_count": len(by_brand),
        "by_name": by_name,
        "by_brand": by_brand,
        "aliases": aliases,
    }
    return result


def _strip_accents(s: str) -> str:
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def _now_iso() -> str:
    import subprocess
    try:
        return subprocess.check_output(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]).decode().strip()
    except Exception:
        return "unknown"


def resolve_brand(lookup: dict, query: str):
    """
    Resolve a raw product name or brand string to a canonical brand.
    Call order:
      1. Exact match in by_name
      2. Normalized alias match
      3. Accent-stripped alias match
      4. None
    """
    import unicodedata

    def strip_accents(s):
        return "".join(
            c for c in unicodedata.normalize("NFD", s)
            if unicodedata.category(c) != "Mn"
        )

    # 1. exact
    if query in lookup["by_name"]:
        return lookup["by_name"][query]

    q_norm = re.sub(r"\s+", " ", query.strip().lower())

    # 2. normalized alias
    if q_norm in lookup["aliases"]:
        return lookup["aliases"][q_norm]

    # 3. accent-stripped
    q_plain = strip_accents(q_norm)
    if q_plain in lookup["aliases"]:
        return lookup["aliases"][q_plain]

    # 4. prefix scan: longest alias that is a prefix of the query
    best = None
    best_len = 0
    for alias, brand in lookup["aliases"].items():
        if q_norm.startswith(alias) and len(alias) > best_len:
            best = brand
            best_len = len(alias)

    return best


if __name__ == "__main__":
    import sys

    data = build_lookup()
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"Written: {OUTPUT_PATH}")
    print(f"  SKUs:   {data['sku_count']}")
    print(f"  Brands: {data['brand_count']}")
    print(f"  Aliases: {len(data['aliases'])}")

    # Quick smoke-test
    tests = [
        ("Penfolds Grange Hermitage 1999", "Penfolds"),
        ("Moet & Chandon Brut Imperial", "Moet & Chandon"),
        ("Chandon Garden Spritz", None),  # will show what we get
        ("Dom Perignon Vintage 2013", None),
        ("Antinori Tignanello", "Antinori"),
        ("Robert Mondavi Cabernet Sauvignon", None),
    ]
    print("\nSmoke tests:")
    for name, expected in tests:
        got = resolve_brand(data, name)
        status = "✅" if got == expected or expected is None else "❌"
        print(f"  {status}  '{name}' → '{got}'" + (f"  (expected '{expected}')" if expected and got != expected else ""))
