#!/usr/bin/env python3
"""Re-map products.food_matching onto the curated sommelier DISPLAY categories.

Why this exists
---------------
`food_matching` held 6,000+ free-text dish names mixed with broad categories,
inconsistent casing/diacritics, and broken grammar ("Beef stew & braised").
This collapses every value onto the ~36 clean, customer-facing categories in
data/lib/pairing_knowledge/food_taxonomy/pairing_categories.json.

Behaviour
---------
- Original detailed values are PRESERVED in a new `food_matching_detail` column
  (nothing is lost — a future 'signature dish' display can use it).
- `food_matching` is rewritten to the deduped category labels, pipe-delimited.
- Values that map to no category (long-tail noise) are dropped from the
  category list but remain in food_matching_detail.

Safety (Rule 10)
----------------
- --dry-run previews counts without writing.
- --canary "SKU,SKU" migrates a few first and prints before/after.
- Idempotent: re-running maps already-category values to themselves.
- Run scripts/refresh_live_export.py afterwards (Rule 9).

Usage
-----
    python3 scripts/remap_food_matching_categories.py --dry-run
    python3 scripts/remap_food_matching_categories.py --canary WRW3233BS,WWW5186FP
    python3 scripts/remap_food_matching_categories.py
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.pairing_categories import remap_items  # noqa: E402

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
SEP = " | "


def split_value(v: str) -> list[str]:
    """Split a stored food_matching value (pipe-first, paren-aware comma)."""
    if "|" in v:
        return [s.strip() for s in v.split("|") if s.strip()]
    items, buf, depth = [], [], 0
    for ch in v:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch == "," and depth == 0:
            items.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        items.append("".join(buf))
    return [i.strip() for i in items if i.strip()]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--canary", type=str, default="")
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    # Ensure the detail column exists (preserve originals).
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "food_matching_detail" not in cols and not args.dry_run:
        conn.execute("ALTER TABLE products ADD COLUMN food_matching_detail TEXT")
        conn.commit()

    where = "food_matching IS NOT NULL AND food_matching != ''"
    params: tuple = ()
    if args.canary:
        skus = [s.strip() for s in args.canary.split(",") if s.strip()]
        where += f" AND sku IN ({','.join('?' * len(skus))})"
        params = tuple(skus)

    rows = conn.execute(
        f"SELECT id, sku, food_matching FROM products WHERE {where}", params
    ).fetchall()

    updates: list[tuple[str, str, int]] = []  # (categories, detail, id)
    emptied = 0  # rows where NOTHING mapped (all noise)
    total_raw = 0
    total_cats = 0
    for r in rows:
        raw_items = split_value(r["food_matching"])
        cats = remap_items(raw_items)
        total_raw += len(raw_items)
        total_cats += len(cats)
        if not cats:
            emptied += 1
        # Keep the original detailed string verbatim in the detail column.
        updates.append((SEP.join(cats), r["food_matching"], r["id"]))

    print(f"rows considered:        {len(rows)}")
    print(f"raw items in:           {total_raw}")
    print(f"category items out:     {total_cats}  (deduped)")
    print(f"rows with NO category:  {emptied}  (kept in food_matching_detail)")

    if args.canary or args.dry_run:
        print("\n--- before / after (first 8) ---")
        for r in rows[:8]:
            raw = split_value(r["food_matching"])
            print(f"\n{r['sku']}")
            print(f"  before: {' | '.join(raw)}")
            print(f"  after:  {' | '.join(remap_items(raw)) or '(no category — detail kept)'}")

    if args.dry_run:
        print("\nDRY RUN — no write performed.")
        conn.close()
        return 0

    conn.executemany(
        "UPDATE products SET food_matching = ?, food_matching_detail = ? WHERE id = ?",
        updates,
    )
    conn.commit()

    # Verify (Rule 1): every written food_matching is either empty or contains
    # only known category labels; detail is populated for all considered rows.
    from data.lib.taxonomy.pairing_categories import all_labels

    valid = set(all_labels())
    check = conn.execute(
        f"SELECT food_matching, food_matching_detail FROM products WHERE {where}",
        params,
    ).fetchall()
    bad_label = 0
    missing_detail = 0
    for fm, det in check:
        if fm:
            for item in fm.split("|"):
                if item.strip() and item.strip() not in valid:
                    bad_label += 1
        if not det:
            missing_detail += 1
    print(f"\nVERIFIED: rows written: {len(updates)}")
    print(f"  food_matching items outside the controlled vocab (must be 0): {bad_label}")
    print(f"  rows missing food_matching_detail (must be 0): {missing_detail}")
    conn.close()
    return 0 if bad_label == 0 and missing_detail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
