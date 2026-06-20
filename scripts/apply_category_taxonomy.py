#!/usr/bin/env python3
"""One-time backfill: write category_group/category_type onto the live export.

SKU-derived (data/taxonomy). classification is left untouched (advisory).
"""
from __future__ import annotations
import argparse, json, shutil, sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402

DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"


def add_category_fields(product: dict) -> dict:
    out = dict(product)
    r = resolve(product)
    out["category_group"] = r["group"]
    out["category_type"] = r["type"]
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    products = json.loads(args.export.read_text())
    updated = [add_category_fields(x) for x in products]
    import collections
    counts = collections.Counter(x["category_group"] for x in updated)
    print("group counts:", dict(counts.most_common()))
    if args.dry_run:
        print("--dry-run: nothing written."); return 0
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = args.export.with_suffix(args.export.suffix + f".bak-pre-taxonomy-{ts}")
    shutil.copy2(args.export, backup)
    print("Backup:", backup)
    args.export.write_text(json.dumps(updated, ensure_ascii=False))
    print("Wrote category_group/category_type to", args.export)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
