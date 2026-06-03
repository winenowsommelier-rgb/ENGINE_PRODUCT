"""Backfill enrichment_confidence for v3 brand-library re-enriched rows.

Why: scripts/reenrich_with_brand_library.py never set enrichment_confidence,
so the incremental sync filter `WHERE enrichment_confidence IS NOT NULL`
silently dropped all v3 rows from Supabase pushes. v3 was researcher+verifier
validated against the brand library, so treat it as high confidence (0.92).

Also nudges updated_at forward so the next sync picks them up.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "db" / "products.db"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--confidence", type=float, default=0.92,
                   help="confidence value to assign (default 0.92)")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT id, sku FROM products
        WHERE enrichment_source LIKE 'ai_brand_library_v3%'
          AND enrichment_confidence IS NULL
    """).fetchall()
    print(f"v3 rows with NULL enrichment_confidence: {len(rows)}")

    if args.dry_run:
        for r in rows[:5]:
            print(f"  would update {r['sku']} ({r['id']})")
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more")
        return 0

    if not rows:
        print("Nothing to do.")
        return 0

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ids = [r["id"] for r in rows]
    # Use executemany so each row's updated_at is identical.
    conn.executemany(
        "UPDATE products SET enrichment_confidence=?, updated_at=? WHERE id=?",
        [(args.confidence, now, pid) for pid in ids],
    )
    conn.commit()
    conn.close()
    print(f"Updated {len(ids)} rows with enrichment_confidence={args.confidence}, "
          f"updated_at={now}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
