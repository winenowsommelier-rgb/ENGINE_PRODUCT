#!/usr/bin/env python3
"""Strip structural words from products.flavor_tags.

Why
---
flavor_tags is supposed to carry AROMATIC information (Blackcurrant, Cedar,
Oak, Citrus zest, …) — the kind of data that powers similarity matching.

After Phase 5, ~2,300 flavor_tag occurrences are STRUCTURAL words like
"Soft tannins", "Crisp finish", "Fine bubbles", "Refreshing", "Smooth
palate". These duplicate what's already captured in wine_body / wine_acidity
/ wine_tannin columns and clog the 8-tag budget, eating slots that should
hold real flavor descriptors. Two distinct wines end up with identical
flavor_tags because of this noise → similarity matching collapses.

This script removes the structural noise. No API calls, no LLM. Pure
deterministic substring matching against a curated stoplist. Idempotent —
safe to re-run.

Usage
-----
    .venv/bin/python scripts/strip_structural_flavor_tags.py --dry-run
    .venv/bin/python scripts/strip_structural_flavor_tags.py             # apply

Per CLAUDE.md Rule 10 (pre-flight checklist): script makes a DB backup
before applying changes and reports tag-count distribution before/after.
"""
from __future__ import annotations

import argparse
import collections
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"


# Tags to remove entirely — they duplicate the wine_body/acidity/tannin
# columns or describe mouthfeel/structure rather than flavor.
PURE_STRUCTURAL_TAGS = {
    # Tannin descriptors (already in wine_tannin column)
    "soft tannins", "smooth tannins", "silky tannins", "structured tannins",
    "ripe tannins", "fine tannins", "grippy tannins", "firm tannins",
    "rounded tannins", "balanced tannins", "integrated tannins",
    "food-friendly tannins", "dense tannins", "elegant tannins",
    "velvety tannins", "dusty tannins", "polished tannins",
    "soft tannin", "smooth tannin", "silky tannin", "structured tannin",
    "ripe tannin", "fine tannin", "grippy tannin", "firm tannin",
    "rounded tannin", "balanced tannin", "integrated tannin",
    "food-friendly tannin", "dense tannin", "elegant tannin",
    "velvety tannin", "dusty tannin", "polished tannin",
    "soft tannin structure", "smooth tannin structure",
    "silky tannin structure", "structured tannin structure",
    "tannin structure", "food-friendly tannin structure",

    # Acidity descriptors (already in wine_acidity column)
    "bright acidity", "fresh acidity", "crisp acidity", "balanced acidity",
    "refreshing acidity", "lively acidity", "vibrant acidity",
    "zesty acidity", "high acidity", "low acidity", "racy acidity",
    "searing acidity", "firm acidity", "soft acidity",

    # Body descriptors (already in wine_body column)
    "full-bodied", "medium-bodied", "light-bodied", "light body",
    "full body", "medium body", "rich body", "silky body", "smooth body",

    # Generic finish/structure with no flavor info
    "crisp finish", "dry finish", "smooth finish", "clean finish",
    "warm finish", "elegant finish", "long finish", "short finish",
    "lingering finish", "persistent finish", "lasting finish",
    "balanced finish", "food-friendly finish", "refreshing finish",
    "silky finish", "integrated finish",
    "balanced structure", "food-friendly structure",
    "integrated structure", "elegant structure",

    # Mouthfeel / texture (not flavor)
    "refreshing", "crisp", "smooth", "silky", "velvety", "plush",
    "round", "rounded", "lively", "vibrant", "elegant", "approachable",
    "food-friendly", "well-balanced", "balanced",
    "smooth texture", "silky texture", "rich texture", "full texture",
    "silky mouthfeel",
    "smooth palate", "silky palate", "crisp palate", "clean palate",
    "rich palate", "full palate",

    # Bubble structure (implicit in Sparkling Wine classification)
    "fine bubbles", "delicate bubbles", "persistent bubbles",
    "soft bubbles", "creamy bubbles", "effervescent", "fizzy", "fizz",

    # Other structural / sugar (already in classification or separate axis)
    "bitter", "sweet", "dry", "off-dry", "sweet finish", "dry palate",

    # Generic positivity (no information)
    "versatile", "approachable",

    # Compound structural phrases (caught after first-pass review)
    "fresh and bright", "fresh and silky", "fresh and smooth",
    "crisp and bright", "crisp and clean", "crisp and refreshing",
    "smooth and silky", "silky and smooth",
    "neutral palate", "creamy mouthfeel", "rounded palate", "soft palate",
    "juicy palate", "juicy mid-palate", "rich mid-palate",
    "approachable tannins", "approachable tannin",
    "rustic tannin", "rustic tannins",
    "medium tannin grip", "tannin grip",
    "balanced sweetness", "tart acidity",
    "well-integrated oak", "well-integrated",
    "fruit-forward",  # generic, no specific fruit info
}


def parse_tags(raw: str | None) -> list[str] | None:
    """Decode flavor_tags as JSON list. Returns None if unparseable."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(v, list):
        return None
    return [str(t).strip() for t in v if str(t).strip()]


def strip(tags: list[str]) -> tuple[list[str], list[str]]:
    """Return (kept, removed) tags."""
    kept: list[str] = []
    removed: list[str] = []
    for t in tags:
        if t.lower() in PURE_STRUCTURAL_TAGS:
            removed.append(t)
        else:
            kept.append(t)
    return kept, removed


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true",
                   help="Report counts without modifying the DB.")
    p.add_argument("--no-backup", action="store_true",
                   help="Skip the DB backup step (default is to back up).")
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = args.db.with_suffix(args.db.suffix + f".bak-pre-strip-{ts}")
        shutil.copy2(args.db, backup)
        print(f"Backup: {backup}")

    conn = sqlite3.connect(args.db)

    rows = conn.execute(
        "SELECT sku, flavor_tags FROM products "
        "WHERE flavor_tags IS NOT NULL AND flavor_tags != '' "
        "AND flavor_tags != '[]'"
    ).fetchall()

    sizes_before: collections.Counter[int] = collections.Counter()
    sizes_after: collections.Counter[int] = collections.Counter()
    removed_counter: collections.Counter[str] = collections.Counter()
    underflow: list[tuple[str, list[str], list[str]]] = []
    to_update: list[tuple[str, str]] = []
    unchanged = 0

    for sku, ft in rows:
        tags = parse_tags(ft)
        if tags is None:
            continue
        sizes_before[len(tags)] += 1
        kept, removed = strip(tags)
        sizes_after[len(kept)] += 1
        for r in removed:
            removed_counter[r] += 1
        if not removed:
            unchanged += 1
            continue
        if len(kept) < 3:
            underflow.append((sku, tags, kept))
        to_update.append((sku, json.dumps(kept, ensure_ascii=False)))

    print(f"\nScanned {len(rows)} rows with flavor_tags")
    print(f"  unchanged:        {unchanged}")
    print(f"  to-update:        {len(to_update)}")
    print(f"  would-underflow (<3 tags): {len(underflow)}")
    print(f"  total tag occurrences removed: {sum(removed_counter.values())}")

    print(f"\nTag-count distribution:")
    print(f"  size    before   after")
    for sz in sorted(set(sizes_before) | set(sizes_after)):
        print(f"  {sz:>3}     {sizes_before.get(sz,0):>5}   {sizes_after.get(sz,0):>5}")

    print(f"\nTop 15 removed tags:")
    for tag, n in removed_counter.most_common(15):
        print(f"  {n:>5}  {tag!r}")

    if underflow:
        print(f"\nUnderflow SKUs ({len(underflow)} total):")
        for sku, before, after in underflow[:10]:
            print(f"  {sku}: {before} → {after}")

    if args.dry_run:
        print("\nDRY-RUN: no DB changes.")
        return 0

    # Apply
    with conn:
        for sku, new_ft in to_update:
            conn.execute("UPDATE products SET flavor_tags=? WHERE sku=?",
                         (new_ft, sku))
    print(f"\nUpdated {len(to_update)} rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
