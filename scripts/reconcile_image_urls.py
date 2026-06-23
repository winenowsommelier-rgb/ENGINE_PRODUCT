#!/usr/bin/env python3
"""Reconcile products.db image_url against the known-good masterfile.

WHY THIS EXISTS (recurring bug — see commits cfeb215, e9e11c9, 0f4b327, edcf1fd):
Many distinct products had image_url pointing at ANOTHER SKU's bottle image
(e.g. 40+ wines all showing wrw6567gx.jpg = Riporta Nero D'Avola). A prior fix
reconciled the export + seed json + masterfile, but products.db got reverted/
re-seeded from a stale source afterward, resurrecting the wrong bottles.

SOURCE OF TRUTH: the masterfile "image url" CSV (per-SKU image, blank = no image).
Per established behavior (e9e11c9): if the masterfile has NO image for a SKU we
BLANK it in the DB rather than leave a borrowed/wrong bottle.

This script is idempotent. Run with --apply to write; default is dry-run.
After --apply you MUST run scripts/refresh_live_export.py (Rule 9).
"""
import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / \
    "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"

SKU_RE = re.compile(r"/([a-z0-9_]+)\.jpg", re.I)


def img_token(url: str) -> str:
    """Filename stem of an image URL, lowercased (for comparison/logging)."""
    if not url:
        return ""
    m = SKU_RE.search(url)
    return m.group(1).lower() if m else url.lower()


def load_master() -> dict:
    """sku(upper) -> image url string ('' means intentionally blank)."""
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            img = (row.get("image") or "").strip()
            if sku:
                good[sku] = img
    return good


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default dry-run)")
    args = ap.parse_args()

    good = load_master()
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    rows = cur.execute("SELECT sku, image_url FROM products").fetchall()

    fixes = []           # (sku, old, new)  new='' means blank
    no_master = []       # sku has image in DB but no row in masterfile -> leave alone
    for r in rows:
        sku = (r["sku"] or "").strip()
        if not sku:
            continue
        db_url = (r["image_url"] or "").strip()
        master = good.get(sku.upper())
        if master is None:
            if db_url:
                no_master.append(sku)
            continue
        # Compare on the resolved string. Treat case-insensitively.
        if db_url.lower() != master.lower():
            fixes.append((sku, db_url, master))

    print(f"DB rows: {len(rows)}  masterfile SKUs: {len(good)}")
    print(f"SKUs needing reconcile: {len(fixes)}")
    print(f"  (DB has image but SKU absent from masterfile, left untouched: {len(no_master)})")
    print()
    for sku, old, new in fixes[:80]:
        print(f"  {sku:12s} {img_token(old):22s} -> {(img_token(new) or '(BLANK)')}")
    if len(fixes) > 80:
        print(f"  ... and {len(fixes) - 80} more")

    if not args.apply:
        print("\nDRY RUN — re-run with --apply to write, then refresh_live_export.py")
        con.close()
        return 0

    cur.executemany(
        "UPDATE products SET image_url = ? WHERE sku = ?",
        [(new, sku) for sku, _old, new in fixes],
    )
    con.commit()

    # Verify the write landed (Rule 1): re-query and assert invariant.
    bad = 0
    for sku, _old, new in fixes:
        got = cur.execute(
            "SELECT image_url FROM products WHERE sku = ?", (sku,)
        ).fetchone()[0]
        if (got or "").lower() != new.lower():
            bad += 1
            print(f"  !! STILL WRONG: {sku} -> {got!r}")
    con.close()

    if bad:
        print(f"\nFAILED: {bad} rows did not take the update")
        return 1
    print(f"\nApplied {len(fixes)} image_url corrections. "
          f"Now run: .venv/bin/python scripts/refresh_live_export.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
