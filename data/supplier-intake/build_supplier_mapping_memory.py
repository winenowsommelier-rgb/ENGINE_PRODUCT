#!/usr/bin/env python3
"""Seed supplier product mapping memory from the current masterfile."""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from product_identity_matcher import clean, product_identity_id, sku_suffix


ROOT = Path(__file__).resolve().parents[2]
MASTERFILE = ROOT / "data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB - MR2026MAR31.csv"
OUTPUT = ROOT / "data/supplier-intake/supplier_product_mapping_memory.csv"


FIELDNAMES = [
    "supplier_code",
    "supplier_item_code",
    "supplier_product_name_raw",
    "normalized_product_name",
    "product_identity_id",
    "current_sku",
    "previous_sku",
    "brand",
    "bottle_size",
    "vintage",
    "first_seen_date",
    "last_seen_date",
    "source_file_id",
    "approval_status",
    "approved_by",
    "approved_at",
    "notes",
]


def main() -> None:
    today = date.today().isoformat()
    rows = []
    seen = set()
    with open(MASTERFILE, encoding="utf-8-sig", newline="") as handle:
        for source in csv.DictReader(handle):
            sku = clean(source.get("sku"))
            if not sku:
                continue
            supplier_code = sku_suffix(sku)
            supplier_item_code = clean(source.get("supplier_code"))
            key = (supplier_code, supplier_item_code, sku)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "supplier_code": supplier_code,
                "supplier_item_code": supplier_item_code,
                "supplier_product_name_raw": clean(source.get("name")),
                "normalized_product_name": clean(source.get("name")).lower(),
                "product_identity_id": product_identity_id(source),
                "current_sku": sku,
                "previous_sku": "",
                "brand": clean(source.get("brand") or source.get("manufacturer")),
                "bottle_size": clean(source.get("bottle_size")),
                "vintage": clean(source.get("vintage")),
                "first_seen_date": today,
                "last_seen_date": today,
                "source_file_id": "masterfile_seed_2026FEB_MR2026MAR31",
                "approval_status": "seeded_from_masterfile",
                "approved_by": "",
                "approved_at": "",
                "notes": "Seeded from existing masterfile; verify during first supplier intake review.",
            })

    with open(OUTPUT, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} supplier mapping rows to {OUTPUT}")


if __name__ == "__main__":
    main()

