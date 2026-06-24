#!/usr/bin/env python3
"""Task 6 — export an enriched masterfile-shape CSV from the enriched products.db.

Produces the EXACT 44-column masterfile header (the "43-col shape" the spec
refers to — the masterfile literally has this header). Strategy:

  * Load the original masterfile keyed by sku → pass-through for the columns we
    do NOT own (ID, Type, price/cost/B2B/margins/stock, score columns, etc.).
  * Overlay the enriched DB values for the columns we DO own
    (country/region/sub_region, grape_variety, wine_body/acidity/tanin,
    food_matching, short_description, description).
  * item_type comes from the SKU taxonomy resolver (Rule 12), NOT a DB column.
  * For the 174 DB-only SKUs (in DB, not in masterfile) still emit a row:
    owned columns from the DB, pass-through columns blank.

OUTPUT SAFETY (73% of descriptions carry HTML with commas/quotes/newlines):
  * csv.writer with quoting=csv.QUOTE_ALL.
  * Write to a TEMP file, then RE-PARSE it and assert header / row-count /
    a 10-SKU name+country checksum against the DB. Only on success do we move
    temp → --out and (unless --no-refresh) run scripts/refresh_live_export.py.
    Any failure → temp left in place, no move, no refresh, exit non-zero.
"""
from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "data" / "lib" / "taxonomy"))

from scripts.masterfile_lib import load_masterfile  # noqa: E402
import sku_taxonomy  # noqa: E402

# The exact masterfile header (== the "43-col shape" in the spec; 44 cells).
HEADER = [
    "ID", "Type", "sku", "is_in_stock", "custom_stock_status", "manufacturer",
    "supplier_code", "brand", "name", "bottle_size", "vintage", "cost", "price",
    "special_price", "Margin THB", "Margin %", "SP discount %", "B2B",
    "B2B Margin THB", "B2B Margin %", "B2B Discount %", "WN Stock",
    "Consign Stock", "country", "region", "sub_region", "item_type",
    "grape_class", "grape_variety", "wine_body", "wine_acidity", "wine_tanin",
    "food_matching", "wine_score_range", "wine_score_1", "wine_score_2",
    "wine_score_3", "wine_score_4", "wine_score_wineenthusiast",
    "wine_score_wineadvocate", "wine_score_winespectator",
    "wine_score_jamessuckling", "short_description", "description",
]

# Columns whose value we OWN and overlay from the enriched DB.
# output_col -> db_col
OWNED = {
    "is_in_stock": "is_in_stock",
    "custom_stock_status": "custom_stock_status",
    "manufacturer": "manufacturer",
    "supplier_code": "supplier_code",
    "brand": "brand",
    "name": "name",
    "bottle_size": "bottle_size",
    "vintage": "vintage",
    "country": "country",
    "region": "region",
    "sub_region": "subregion",
    "grape_variety": "variety",
    "wine_body": "body",
    "wine_acidity": "acidity",
    "wine_tanin": "tannin",
    "food_matching": "food_matching",
    "short_description": "desc_en_short",
    "description": "full_description",
}

DEFAULT_MASTERFILE = (
    "/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
    "Masterfile Data WNLQ9 - MReport Masterfile.csv"
)


def _s(v) -> str:
    """Render a DB/masterfile cell as a string; None -> ''."""
    return "" if v is None else str(v)


def _db_rows(db_path: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    needed = sorted({c for c in OWNED.values()} | {"sku"})
    rows = [dict(r) for r in conn.execute(
        f"SELECT {', '.join(needed)} FROM products")]
    conn.close()
    return rows


def build_rows(db_path: str, masterfile_path: str) -> list[dict]:
    db_rows = _db_rows(db_path)
    db_by_sku = {(r.get("sku") or "").strip(): r for r in db_rows}

    mf_by_sku: dict[str, dict] = {}
    if masterfile_path and Path(masterfile_path).exists():
        mf_rows, _dups = load_masterfile(masterfile_path)
        mf_by_sku = {(r.get("sku") or "").strip(): r for r in mf_rows}

    out_rows: list[dict] = []
    # Emit one row per DB product (DB is source of truth for which SKUs ship).
    for sku, dbr in db_by_sku.items():
        mf = mf_by_sku.get(sku, {})
        row = {}
        for col in HEADER:
            if col == "sku":
                row[col] = sku
            elif col == "item_type":
                # Authoritative type from the SKU taxonomy (Rule 12) — never a DB col.
                row[col] = sku_taxonomy.type_for(sku)
            elif col in OWNED:
                row[col] = _s(dbr.get(OWNED[col]))
            else:
                # Pass-through non-owned masterfile cell by sku (blank if absent).
                row[col] = _s(mf.get(col))
        out_rows.append(row)
    return out_rows


def write_temp(rows: list[dict], temp_path: Path) -> None:
    with temp_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(HEADER)
        for r in rows:
            w.writerow([r.get(c, "") for c in HEADER])


def verify_temp(temp_path: Path, db_path: str) -> None:
    """Re-parse the temp file and assert it's well-formed. Raise on any failure."""
    with temp_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        parsed = list(reader)

    if fieldnames != HEADER:
        raise SystemExit(
            "HEADER MISMATCH after re-parse.\n"
            f"  expected: {HEADER}\n  got:      {fieldnames}"
        )

    conn = sqlite3.connect(db_path)
    db_n = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    if len(parsed) < db_n:
        raise SystemExit(
            f"ROW COUNT REGRESSION: re-parsed {len(parsed)} < {db_n} DB products "
            "(174 DB-only SKUs must still be carried)."
        )

    # 10-SKU spot checksum: re-parsed name/country must match the DB.
    parsed_by_sku = {r["sku"]: r for r in parsed}
    sample = [r[0] for r in conn.execute(
        "SELECT sku FROM products ORDER BY sku LIMIT 10")]
    diffs = []
    for sku in sample:
        db = conn.execute(
            "SELECT name, country FROM products WHERE sku=?", (sku,)).fetchone()
        pr = parsed_by_sku.get(sku)
        if pr is None:
            diffs.append(f"  {sku}: missing from re-parsed CSV")
            continue
        for out_col, db_val in (("name", db[0]), ("country", db[1])):
            if pr.get(out_col, "") != _s(db_val):
                diffs.append(
                    f"  {sku}.{out_col}: csv={pr.get(out_col)!r} db={_s(db_val)!r}")
    conn.close()
    if diffs:
        raise SystemExit("SPOT CHECKSUM FAILED:\n" + "\n".join(diffs))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default="data/db/products.db")
    ap.add_argument("--out", default="data/masterfile_enriched_export.csv")
    ap.add_argument("--csv", default=DEFAULT_MASTERFILE,
                    help="original masterfile (pass-through source)")
    ap.add_argument("--no-refresh", action="store_true",
                    help="skip the live-export refresh after a successful write")
    args = ap.parse_args(argv)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = out.with_suffix(out.suffix + ".tmp")

    rows = build_rows(args.db, args.csv)
    write_temp(rows, temp)

    # Verify BEFORE moving into place. On failure this raises SystemExit (rc!=0)
    # and the temp file is left for inspection; the real --out is untouched.
    verify_temp(temp, args.db)

    os.replace(temp, out)
    print(f"OK: wrote {len(rows)} rows -> {out}")

    if not args.no_refresh:
        print("Refreshing live export (scripts/refresh_live_export.py) ...")
        subprocess.run([sys.executable, "scripts/refresh_live_export.py"],
                       check=True, cwd=str(REPO))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
