#!/usr/bin/env python3
"""Apply a Magento media-export image CSV as the new image source of truth.

CONTEXT (2026-07-10): the user confirmed that where a SKU's image filename no
longer matches the SKU code, the item merely changed supplier but is the SAME
product — so the filename/SKU mismatch is EXPECTED, not the cross-SKU bug. The
new CSV therefore WINS over the curated masterfile on every conflict.

This writes the CSV's base_image_url to BOTH:
  1. the curated masterfile "image url" CSV (image column) — keeps it the
     source of truth so tests/test_image_url_invariants.py stays green, and
  2. products.db image_url — the enriched DB.
Only SKUs that exist in products.db are touched.

After --apply you MUST run scripts/refresh_live_export.py (Rule 9).

Usage:
  apply_image_csv_update.py [--limit N] [--only SKU,SKU] [--apply]
Default is dry-run.
"""
from __future__ import annotations
import argparse
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
CURATED = ROOT / "data" / "data mastefile WNLQ9" / \
    "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"
DEFAULT_NEWCSV = Path("/Users/admin/Downloads/export_path_images_all_media_no_null_20260708.csv")


def load_new(newcsv: Path) -> dict:
    """sku(upper) -> base_image_url. Skips blank urls."""
    m = {}
    with open(newcsv, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            url = (row.get("base_image_url") or "").strip()
            if sku and url:
                m[sku] = url
    return m


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default dry-run)")
    ap.add_argument("--limit", type=int, default=0, help="canary: only first N eligible SKUs")
    ap.add_argument("--only", default="", help="comma-separated SKUs to restrict to")
    ap.add_argument("--csv", default=str(DEFAULT_NEWCSV),
                    help="path to the new Magento image-export CSV (sku,websites,base_image_url)")
    args = ap.parse_args()

    new = load_new(Path(args.csv))
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    db = {}
    dbmeta = {}  # sku -> (name, brand, is_in_stock) for appending new masterfile rows
    for r in con.execute("SELECT sku, image_url, name, brand, is_in_stock FROM products"):
        if not r["sku"]:
            continue
        s = r["sku"].strip().upper()
        db[s] = (r["image_url"] or "").strip()
        dbmeta[s] = (r["name"] or "", r["brand"] or "", r["is_in_stock"] or "")

    only = {s.strip().upper() for s in args.only.split(",") if s.strip()}

    # Eligible = CSV sku that exists in DB (optionally restricted by --only/--limit)
    eligible = [s for s in new if s in db and (not only or s in only)]
    eligible.sort()
    if args.limit:
        eligible = eligible[:args.limit]
    eligible_set = set(eligible)

    db_changes = [(s, db[s], new[s]) for s in eligible if db[s].lower() != new[s].lower()]

    print(f"CSV urls: {len(new)}  DB skus: {len(db)}  eligible (in both): {len(eligible)}")
    print(f"DB image_url rows that will CHANGE: {len(db_changes)}")
    for s, old, nw in db_changes[:15]:
        print(f"  {s:12s} {old.split('/product/')[-1] or '(blank)':40s} -> {nw.split('/product/')[-1]}")
    if len(db_changes) > 15:
        print(f"  ... and {len(db_changes) - 15} more")

    if not args.apply:
        print("\nDRY RUN — re-run with --apply. Then refresh_live_export.py")
        con.close()
        return 0

    # 1) Write DB
    cur = con.cursor()
    cur.executemany(
        "UPDATE products SET image_url=?, updated_at=datetime('now') WHERE sku=?",
        [(nw, s) for s, _o, nw in db_changes],
    )
    con.commit()

    # Verify DB write landed (Rule 1)
    bad = 0
    for s, _o, nw in db_changes:
        got = (cur.execute("SELECT image_url FROM products WHERE sku=?", (s,)).fetchone()[0] or "")
        if got.lower() != nw.lower():
            bad += 1
            print(f"  !! DB STILL WRONG: {s} -> {got!r}")
    con.close()
    if bad:
        print(f"\nFAILED: {bad} DB rows did not take the update")
        return 1

    # 2) Rewrite curated masterfile image column for the same eligible SKUs.
    #    SKUs present in the DB but ABSENT from the masterfile are APPENDED
    #    (else DB and masterfile drift and the invariant test can't see it).
    with open(CURATED, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)
    seen_mf = set()
    mf_changed = 0
    for r in rows:
        s = (r.get("sku") or "").strip().upper()
        seen_mf.add(s)
        if s in eligible_set and (r.get("image") or "").strip().lower() != new[s].lower():
            r["image"] = new[s]
            mf_changed += 1
    mf_appended = 0
    for s in eligible_set:
        if s not in seen_mf:
            name, brand, iis = dbmeta.get(s, ("", "", ""))
            row = {k: "" for k in fieldnames}
            row.update({"sku": s, "image": new[s], "thumbnail": new[s],
                        "small_image": new[s], "name": name, "brand": brand,
                        "is_in_stock": iis})
            rows.append(row)
            mf_appended += 1
    with open(CURATED, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    print(f"\nApplied: {len(db_changes)} DB image_url updates, "
          f"{mf_changed} masterfile image updates, {mf_appended} masterfile rows appended.")
    print("Now run: .venv/bin/python scripts/refresh_live_export.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
