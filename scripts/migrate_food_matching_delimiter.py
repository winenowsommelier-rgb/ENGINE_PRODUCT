#!/usr/bin/env python3
"""Re-delimit products.food_matching from comma to pipe ('|').

Why this exists
---------------
`food_matching` stored items as a comma-separated string, e.g.
    "Tomato-based pasta, Comfort food (pasta bakes, casseroles, roasts)"
But ~1,191 rows contain *parenthetical clarifications that also use commas*
("Shellfish (lobster, crab, prawn)"). A naive comma split in the UI shatters
those into broken chips ("Comfort food (pasta bakes", "casseroles", "roasts)").

Comma is overloaded as both the item separator and a within-item character.
Pipe ('|') never appears inside the data (verified: 0 rows), so it is an
unambiguous separator. This script splits each value paren-aware (commas at
parenthesis depth 0 only) and rejoins with ' | '.

Safety
------
- Idempotent: a value already containing '|' is left untouched.
- INVARIANT enforced: no resulting item may have unbalanced parens; if any
  row violates it, the script aborts WITHOUT writing (so bad data can't ship).
- Run with --canary "SKU,SKU,..." to migrate a handful first (Rule 10).
- Run with --dry-run to preview counts without writing.

Usage
-----
    python3 scripts/migrate_food_matching_delimiter.py --dry-run
    python3 scripts/migrate_food_matching_delimiter.py --canary WRW3233BS
    python3 scripts/migrate_food_matching_delimiter.py            # full run
Then refresh the UI-facing export (Rule 9):
    python3 scripts/refresh_live_export.py
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
SEP = " | "


def split_paren_aware(s: str) -> list[str]:
    """Split on commas that sit OUTSIDE parentheses; trim and drop empties."""
    items: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in s:
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


def redelimit(value: str) -> tuple[str, list[str]]:
    """Return (new_value, items). Idempotent if value already uses '|'."""
    if "|" in value:
        # Already migrated; normalise spacing but keep paren-commas intact.
        items = [p.strip() for p in value.split("|") if p.strip()]
    else:
        items = split_paren_aware(value)
    return SEP.join(items), items


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--canary", type=str, default="",
                   help="comma-separated SKUs to migrate only (Rule 10 canary)")
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    where = "food_matching IS NOT NULL AND food_matching != ''"
    params: tuple = ()
    if args.canary:
        skus = [s.strip() for s in args.canary.split(",") if s.strip()]
        placeholders = ",".join("?" * len(skus))
        where += f" AND sku IN ({placeholders})"
        params = tuple(skus)

    rows = conn.execute(
        f"SELECT id, sku, food_matching FROM products WHERE {where}", params
    ).fetchall()

    # Phase 1: compute + enforce the invariant BEFORE any write.
    updates: list[tuple[str, int]] = []
    changed = 0
    violations = 0
    for r in rows:
        new_val, items = redelimit(r["food_matching"])
        for item in items:
            if item.count("(") != item.count(")"):
                violations += 1
                print(f"INVARIANT VIOLATION {r['sku']}: {item!r}", file=sys.stderr)
        if new_val != r["food_matching"]:
            changed += 1
        updates.append((new_val, r["id"]))

    print(f"rows considered: {len(rows)}")
    print(f"rows that will change: {changed}")
    print(f"invariant violations (must be 0): {violations}")

    if violations:
        print("ABORTING — refusing to write data that would break chips.",
              file=sys.stderr)
        conn.close()
        return 2

    if args.dry_run:
        print("DRY RUN — no write performed.")
        conn.close()
        return 0

    # Phase 2: write.
    conn.executemany(
        "UPDATE products SET food_matching = ? WHERE id = ?", updates
    )
    conn.commit()

    # Phase 3: verify (Rule 1 — confirm the write landed).
    verify = conn.execute(
        f"SELECT COUNT(*) FROM products WHERE {where} AND food_matching LIKE '%|%'",
        params,
    ).fetchone()[0]
    total = conn.execute(
        f"SELECT COUNT(*) FROM products WHERE {where}", params
    ).fetchone()[0]
    print(f"VERIFIED: {verify}/{total} migrated rows now use '|'")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
