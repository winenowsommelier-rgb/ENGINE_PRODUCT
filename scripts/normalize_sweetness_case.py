#!/usr/bin/env python3
"""One-off: normalize legacy lowercase sweetness tokens to the gauge scale.

279 pre-Phase-A rows carry lowercase 'dry'/'sweet' in products.sweetness. The
catalog gauge (apps/catalog/lib/taste-adapter.ts normalizeScale) matches the
scale [Dry, Off-Dry, Medium-Sweet, Sweet] case-sensitively, so these render
blank. This maps the two known lowercase tokens to their Title-Case scale
points. Idempotent (re-running is a no-op once values are already Title-Case).

Only the two exact tokens are touched — NOT a blind lower->title that could
mangle multi-word values. Rule 1/9: refresh the export after running and verify.
"""
import argparse
import sqlite3
import sys

# exact legacy token -> canonical gauge value
MAP = {"dry": "Dry", "sweet": "Sweet"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/db/products.db")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    c = db.cursor()
    total = 0
    for raw, canon in MAP.items():
        n = c.execute(
            "SELECT COUNT(*) FROM products WHERE sweetness = ?", (raw,)
        ).fetchone()[0]
        print(f"  {raw!r:8} -> {canon!r:8}  {n} rows")
        total += n
        if not args.dry_run and n:
            c.execute(
                "UPDATE products SET sweetness = ? WHERE sweetness = ?", (canon, raw)
            )

    if args.dry_run:
        print(f"DRY-RUN: would normalize {total} rows")
        db.close()
        return 0

    db.commit()
    # verify: zero off-scale tokens remain
    leftover = c.execute(
        "SELECT COUNT(*) FROM products "
        "WHERE sweetness IS NOT NULL AND TRIM(sweetness) != '' "
        "AND sweetness NOT IN ('Dry','Off-Dry','Medium-Sweet','Sweet')"
    ).fetchone()[0]
    db.close()
    print(f"normalized {total} rows; off-scale tokens remaining: {leftover}")
    return 0 if leftover == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
