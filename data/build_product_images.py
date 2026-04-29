#!/usr/bin/env python3
"""Build data/db/product-images.json from the 2026FEB masterfile CSV.

See docs/superpowers/specs/2026-04-20-product-image-library-design.md
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib import product_naming as pn  # noqa: E402


DEFAULT_MASTER = (
    REPO_ROOT / "data" / "data mastefile WNLQ9"
    / "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"
)
DEFAULT_OUTPUT = REPO_ROOT / "data" / "db" / "product-images.json"
DEFAULT_SUMMARY = REPO_ROOT / "data" / "db" / "product-images-summary.json"
DEFAULT_PRODUCTS = REPO_ROOT / "data" / "db" / "products.json"
SOURCE_TAG = "masterfile-2026FEB"


def build_records(csv_path: Path) -> tuple[dict, dict]:
    records: dict[str, dict] = {}
    by_website: Counter[str] = Counter()
    unknown_prefixes: set[str] = set()
    missing_count = 0
    partial_filled_count = 0
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sku = (row.get("sku") or "").strip()
            if not sku:
                continue

            website = pn.detect_website(sku)
            if website is None and sku[:3] not in pn.NO_SUFFIX_PREFIXES and len(sku) >= 3:
                unknown_prefixes.add(sku[:3])

            thumb = row.get("thumbnail", "") or ""
            img = row.get("image", "") or ""
            small = row.get("small_image", "") or ""
            best_url = pn.pick_best_url(thumb, img, small)

            slots_present = sum(1 for u in (thumb, img, small) if u and u.strip())
            if 0 < slots_present < 3:
                partial_filled_count += 1

            images, status = pn.build_image_struct(best_url)
            if status == "missing":
                missing_count += 1

            # The masterfile name column already contains the brand prefix,
            # so pass an empty brand to avoid duplication in SEO title / slug.
            name = row.get("name") or ""
            vintage_raw = row.get("vintage") or ""
            size_raw = row.get("bottle_size") or ""

            records[sku] = {
                "sku": sku,
                "website": website,
                "name_seo": pn.to_seo_title("", name, vintage_raw, size_raw, website),
                "name_slug": pn.to_slug("", name, vintage_raw, size_raw),
                "image_filename_base": pn.to_image_filename_base("", name, vintage_raw, size_raw, sku),
                "brand": (row.get("brand") or "").strip(),
                "vintage": pn.normalize_vintage(vintage_raw),
                "bottle_size": pn.normalize_bottle_size(size_raw),
                "images": images,
                "image_status": status,
                "is_in_stock": (row.get("is_in_stock") or "").strip() == "1",
                "last_source": SOURCE_TAG,
                "updated_at": generated_at,
            }
            by_website[website or "none"] += 1

    meta = {
        "generated_at": generated_at,
        "source_file": csv_path.name,
        "row_count": len(records),
        "missing_count": missing_count,
        "partial_filled_count": partial_filled_count,
        "by_website": dict(by_website),
        "unknown_prefixes": sorted(unknown_prefixes),
    }
    return records, meta


def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8"
    ) as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build product image library from masterfile CSV.")
    p.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    p.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    p.add_argument("--mirror-to-products", type=Path, default=DEFAULT_PRODUCTS)
    p.add_argument("--no-mirror", action="store_true")
    p.add_argument("--no-commit", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.master.exists():
        print(f"ERROR: masterfile not found: {args.master}", file=sys.stderr)
        return 1
    records, meta = build_records(args.master)
    output_data = {"_meta": meta, "records": records}

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        return 0

    atomic_write_json(args.output, output_data)
    print(f"Wrote {len(records)} records to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
