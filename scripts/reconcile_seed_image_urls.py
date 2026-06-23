#!/usr/bin/env python3
"""Sync data/db/products.json (the re-seed source) image_url to the masterfile.

Companion to reconcile_image_urls.py. The seed JSON is what
seed_sqlite_from_json.py UPSERTs into products.db by SKU, so if it still holds
borrowed cross-SKU images, a re-seed resurrects the bug (the exact gap noted in
commit cfeb215). This makes the seed agree with the masterfile source of truth.

Idempotent. Default dry-run; --apply writes products.json in place.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "db" / "products.json"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / \
    "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"


def load_master() -> dict:
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if sku:
                good[sku] = (row.get("image") or "").strip()
    return good


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    good = load_master()
    raw = json.loads(SEED.read_text())
    items = raw if isinstance(raw, list) else raw.get("products", raw)

    changed = 0
    for p in items:
        if not isinstance(p, dict):
            continue
        sku = (p.get("sku") or "").strip().upper()
        master = good.get(sku)
        if master is None:
            continue
        cur = (p.get("image_url") or "").strip()
        if cur.lower() != master.lower():
            p["image_url"] = master
            changed += 1

    print(f"Seed rows updated to match masterfile: {changed}")
    if not args.apply:
        print("DRY RUN — re-run with --apply to write products.json")
        return 0

    # Match existing on-disk format: single-line compact JSON (no reflow noise).
    SEED.write_text(json.dumps(raw, ensure_ascii=False, separators=(", ", ": ")))
    print(f"Wrote {SEED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
