#!/usr/bin/env python3
"""Validate every <!-- product: SKU --> embed in blog posts against the live export.

Fails (exit 1) if any embedded SKU is missing from the export, out of stock,
or lacks an image/price. Flags PLACEHOLDER embeds as warnings.
Run before every publish batch, and monthly on the whole archive.

Usage:
  .venv/bin/python scripts/validate_blog_embeds.py            # all posts
  .venv/bin/python scripts/validate_blog_embeds.py post1.md   # specific post(s)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "apps" / "catalog" / "app" / "blog" / "posts"
EXPORT = ROOT / "data" / "live_products_export.json"
EMBED_RE = re.compile(r"<!--\s*product:\s*([^>]+?)\s*-->")


def main() -> None:
    by_sku = {p["sku"]: p for p in json.loads(EXPORT.read_text())}
    files = (
        [POSTS_DIR / f for f in sys.argv[1:]]
        if len(sys.argv) > 1
        else sorted(POSTS_DIR.glob("*.md"))
    )

    errors, warnings, total = [], [], 0
    for f in files:
        for m in EMBED_RE.finditer(f.read_text()):
            total += 1
            token = m.group(1).strip()
            if token.upper().startswith("PLACEHOLDER"):
                warnings.append(f"{f.name}: placeholder embed — {token[:70]}")
                continue
            p = by_sku.get(token)
            if p is None:
                errors.append(f"{f.name}: SKU {token} not in live export")
            elif str(p.get("is_in_stock")) != "1":
                errors.append(f"{f.name}: SKU {token} OUT OF STOCK ({p.get('name','')[:40]})")
            elif not p.get("image_url"):
                errors.append(f"{f.name}: SKU {token} has no image ({p.get('name','')[:40]})")
            elif not p.get("price"):
                errors.append(f"{f.name}: SKU {token} has no price ({p.get('name','')[:40]})")

    print(f"checked {total} embeds in {len(files)} posts")
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    if errors:
        sys.exit(1)
    print("all embeds valid")


if __name__ == "__main__":
    main()
