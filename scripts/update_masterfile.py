#!/usr/bin/env python3
"""
Merge enrichment data from products.db into the WNLQ9 masterfile CSV.
Pricing columns are NEVER touched. Only non-pricing fields are updated
where the DB has a non-null value.

Fields updated from DB:
  country, region, sub_region, grape_variety, wine_body, wine_acidity,
  wine_tanin, food_matching, score_summary → wine_score_range,
  short_description (desc_en_short), description (full_description)

Fields left untouched:
  ID, Type, sku, is_in_stock, custom_stock_status, manufacturer,
  supplier_code, brand, name, bottle_size, vintage,
  cost, price, special_price, Margin THB, Margin %, SP discount %,
  B2B, B2B Margin THB, B2B Margin %, B2B Discount %,
  WN Stock, Consign Stock, item_type, grape_class,
  wine_score_1..4, wine_score_wineenthusiast, wine_score_wineadvocate,
  wine_score_winespectator, wine_score_jamessuckling
"""
from __future__ import annotations

import csv
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH   = REPO_ROOT / "data" / "db" / "products.db"

MASTERFILE_IN  = Path("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv")
MASTERFILE_OUT = Path("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile UPDATED.csv")


def load_db_products(db_path: Path) -> dict[str, dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT sku, country, region, subregion, variety,
               body, acidity, tannin,
               food_matching, score_summary,
               desc_en_short, full_description
        FROM products
    """).fetchall()
    conn.close()
    out = {}
    for r in rows:
        d = dict(r)
        # food_matching may be JSON array — join to pipe-separated string
        fm = d.get("food_matching")
        if fm:
            try:
                parsed = json.loads(fm)
                if isinstance(parsed, list):
                    # Each item may be "Dish (detail)" — keep as-is joined by |
                    d["food_matching"] = " | ".join(str(x) for x in parsed)
            except (ValueError, TypeError):
                pass
        out[d["sku"]] = d
    return out


def update_row(row: dict, db: dict) -> tuple[dict, bool]:
    sku = row.get("sku", "").strip()
    prod = db.get(sku)
    if not prod:
        return row, False

    changed = False

    def maybe_set(csv_col: str, db_val):
        nonlocal changed
        if db_val and str(db_val).strip():
            if row.get(csv_col, "").strip() != str(db_val).strip():
                row[csv_col] = str(db_val).strip()
                changed = True

    maybe_set("country",           prod["country"])
    maybe_set("region",            prod["region"])
    maybe_set("sub_region",        prod["subregion"])
    maybe_set("grape_variety",     prod["variety"])
    maybe_set("wine_body",         prod["body"])
    maybe_set("wine_acidity",      prod["acidity"])
    maybe_set("wine_tanin",        prod["tannin"])
    maybe_set("food_matching",     prod["food_matching"])
    maybe_set("wine_score_range",  prod["score_summary"])
    # Wrap short description in <p> tags for Magento HTML field
    short = prod.get("desc_en_short")
    if short and str(short).strip() and not str(short).strip().startswith("<"):
        short = f"<p>{short.strip()}</p>"
    maybe_set("short_description", short)
    maybe_set("description",       prod["full_description"])

    return row, changed


def main():
    print(f"Loading DB products from {DB_PATH}")
    db = load_db_products(DB_PATH)
    print(f"  {len(db):,} products in DB")

    print(f"Reading masterfile: {MASTERFILE_IN}")
    with open(MASTERFILE_IN, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)
    print(f"  {len(rows):,} rows in masterfile")

    updated_count = 0
    matched_count = 0
    out_rows = []
    for row in rows:
        new_row, changed = update_row(dict(row), db)
        if row.get("sku", "").strip() in db:
            matched_count += 1
        if changed:
            updated_count += 1
        out_rows.append(new_row)

    print(f"  {matched_count:,} rows matched by SKU")
    print(f"  {updated_count:,} rows updated with new data")

    print(f"Writing output: {MASTERFILE_OUT}")
    with open(MASTERFILE_OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"\nDone. Upload this file:")
    print(f"  {MASTERFILE_OUT}")


if __name__ == "__main__":
    sys.exit(main())
