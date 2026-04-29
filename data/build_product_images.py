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


def build_records(csv_path: Path) -> tuple[dict, dict, dict]:
    """Read CSV; return (records, meta, warnings)."""
    records: dict[str, dict] = {}
    by_website: Counter[str] = Counter()
    unknown_prefixes: set[str] = set()
    sku_collisions: list[dict] = []
    slug_to_skus: dict[str, list[str]] = defaultdict(list)
    seen_skus: dict[str, int] = {}  # sku -> first-seen row number
    missing_count = 0
    partial_filled_count = 0
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, start=2):  # 1 = header
            sku = (row.get("sku") or "").strip()
            if not sku:
                continue

            if sku in seen_skus:
                sku_collisions.append({
                    "sku": sku,
                    "first_row": seen_skus[sku],
                    "duplicate_row": row_num,
                })
            else:
                seen_skus[sku] = row_num

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

            brand = (row.get("brand") or "").strip()
            name = row.get("name") or ""
            vintage_raw = row.get("vintage") or ""
            size_raw = row.get("bottle_size") or ""

            # Strip brand prefix from name to avoid duplication
            cleaned_name = name
            if brand and name.lower().lstrip().startswith(brand.lower()):
                after = name.lstrip()[len(brand):]
                cleaned_name = after.lstrip()

            slug = pn.to_slug(brand, cleaned_name, vintage_raw, size_raw)
            if slug:
                slug_to_skus[slug].append(sku)

            records[sku] = {
                "sku": sku,
                "website": website,
                "name_seo": pn.to_seo_title(brand, cleaned_name, vintage_raw, size_raw, website),
                "name_slug": slug,
                "image_filename_base": pn.to_image_filename_base(brand, cleaned_name, vintage_raw, size_raw, sku),
                "brand": brand,
                "vintage": pn.normalize_vintage(vintage_raw),
                "bottle_size": pn.normalize_bottle_size(size_raw),
                "images": images,
                "image_status": status,
                "is_in_stock": (row.get("is_in_stock") or "").strip() == "1",
                "last_source": SOURCE_TAG,
                "updated_at": generated_at,
            }
            by_website[website or "none"] += 1

    # For SKU collisions, dedupe slug entries (the duplicate row's slug got appended twice)
    for slug_key, skus in list(slug_to_skus.items()):
        slug_to_skus[slug_key] = sorted(set(skus))

    slug_collisions = [
        {"slug": s, "skus": skus}
        for s, skus in slug_to_skus.items()
        if len(skus) > 1
    ]

    meta = {
        "generated_at": generated_at,
        "source_file": csv_path.name,
        "row_count": len(records),
        "missing_count": missing_count,
        "partial_filled_count": partial_filled_count,
        "by_website": dict(by_website),
        "unknown_prefixes": sorted(unknown_prefixes),
    }
    warnings = {
        "sku_collisions": sku_collisions,
        "slug_collisions": slug_collisions,
    }
    return records, meta, warnings


def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8"
    ) as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def mirror_image_url_to_products(
    products_path: Path, records: dict[str, dict]
) -> int:
    """Overwrite only the `image_url` field per matching SKU. Returns count updated.

    All other fields on each record are untouched. Records in products.json whose
    SKU is not in the image library are untouched. Atomic write.
    """
    if not products_path.exists():
        print(
            f"WARNING: products.json not found at {products_path}, skipping mirror",
            file=sys.stderr,
        )
        return 0
    products: list[dict] = json.loads(products_path.read_text(encoding="utf-8"))
    updated = 0
    for row in products:
        sku = row.get("sku")
        if not sku:
            continue
        rec = records.get(sku)
        if not rec or not rec.get("images"):
            continue
        row["image_url"] = rec["images"]["image"]["url"]
        updated += 1
    atomic_write_json(products_path, products)
    return updated


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
    records, meta, warnings = build_records(args.master)
    output_data = {"_meta": meta, "records": records}
    summary_data = {**meta, "warnings": warnings}

    # Stderr warnings for operator-visible issues
    if warnings["sku_collisions"]:
        print(f"WARNING: {len(warnings['sku_collisions'])} SKU collisions (see summary)", file=sys.stderr)
    if warnings["slug_collisions"]:
        print(f"WARNING: {len(warnings['slug_collisions'])} slug collisions (see summary)", file=sys.stderr)
    if meta["unknown_prefixes"]:
        print(f"WARNING: unknown SKU prefixes: {meta['unknown_prefixes']}", file=sys.stderr)

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        print(f"[dry-run] would write summary to {args.summary}")
        if not args.no_mirror:
            print(f"[dry-run] would mirror image_url into {args.mirror_to_products}")
        return 0

    atomic_write_json(args.output, output_data)
    atomic_write_json(args.summary, summary_data)
    print(f"Wrote {len(records)} records to {args.output}")
    print(f"Wrote summary to {args.summary}")

    if not args.no_mirror:
        updated = mirror_image_url_to_products(args.mirror_to_products, records)
        print(f"Mirrored image_url to {updated} records in {args.mirror_to_products}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
