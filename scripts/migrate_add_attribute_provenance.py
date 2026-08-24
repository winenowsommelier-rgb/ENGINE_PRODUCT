#!/usr/bin/env python3
"""
Add per-item attribute provenance columns to the products table.

WHY THIS EXISTS
---------------
Audited 2026-07-27: 6,681 of 6,681 rows with live `flavor_tags` were AI-generated
(`enrichment_source` in ai_backfill_from_cache / ai_brand_library_v3 / phase_*),
and **zero** carried a source URL. There was no column in which to record one, so
sourced research and model inference were indistinguishable in the schema. That is
the condition that let 70 inferred flavor rows be reported as "verified" work.

The catalog standard is item-level validated real data. These columns make the
distinction representable, and therefore auditable and enforceable:

  attr_sources       TEXT  Pipe-delimited source URLs backing this row's
                           attributes. Pipe-delimited to match the project's
                           existing convention (see food_matching) — never commas,
                           because URLs and note text contain commas.
  attr_evidence_tier TEXT  How the attributes were obtained. Controlled vocabulary:
                             producer   - producer/estate published tasting note
                             critic     - named critic or competition note
                             retailer   - retailer/aggregator note (wine.com,
                                          wine-searcher, Vivino)
                             label      - read off the physical bottle/back label
                             inferred   - derived from grape/region/style knowledge
                                          with NO per-item source. NOT publishable
                                          as validated data.
                             unverified - provenance unknown (the 6,681 legacy rows)
  attr_verified_at   TEXT  ISO-8601 UTC timestamp of the last human/source check.
  attr_verified_by   TEXT  Who or what performed that check.

WHAT THIS SCRIPT DOES NOT DO
----------------------------
It does not reclassify or backfill any existing row, and it does not touch
flavor_tags/taste_profile. Adding columns only. Labelling the legacy rows is a
separate, reviewable decision (see backfill_attr_provenance.py --dry-run).

Safe to run repeatedly: SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS, so a
Python-side PRAGMA table_info(products) check skips columns that already exist.

NOTE: Always pass --db explicitly when running from a git worktree; the default
path resolves relative to the script and can point at the wrong DB (e.g. a stray
0-byte auto-created file in a worktree checkout).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLS = [
    ("attr_sources",       "TEXT"),
    ("attr_evidence_tier", "TEXT"),
    ("attr_verified_at",   "TEXT"),
    ("attr_verified_by",   "TEXT"),
]

EVIDENCE_TIERS = ("producer", "critic", "retailer", "label", "inferred", "unverified")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Guard the worktree/stray-empty-DB trap: sqlite3.connect() silently creates
    # an empty file, and a 0-byte file passes .exists() above. Refuse unless the
    # products table exists AND has rows. (CLAUDE.md Rule 1.)
    probe = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()[0]
        row_count = probe.execute("SELECT count(*) FROM products").fetchone()[0] if has_table else 0
    finally:
        probe.close()
    if not has_table or row_count == 0:
        print(
            f"ERROR: {args.db} has no populated products table "
            f"(has_table={bool(has_table)}, rows={row_count}). Refusing to migrate — "
            f"pass --db with the real database path (CLAUDE.md Rule 1).",
            file=sys.stderr,
        )
        return 1

    print(f"Target DB: {args.db} ({row_count} products)")
    print(f"Evidence tiers: {', '.join(EVIDENCE_TIERS)}")

    con = sqlite3.connect(args.db)
    try:
        existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        planned = [(c, t) for c, t in NEW_COLS if c not in existing]

        for col, coltype in NEW_COLS:
            if col in existing:
                print(f"  {col}: already exists, skipping")

        if args.dry_run:
            for col, coltype in planned:
                print(f"  {col}: WOULD ADD ({coltype})")
            print("\nDry run — no changes written.")
            return 0

        for col, coltype in planned:
            con.execute(f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            print(f"  {col}: added ({coltype})")
        con.commit()
    except Exception as e:
        con.rollback()
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        con.close()

    # Verify from a fresh read-only connection rather than trusting the writes.
    check = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        cols = {r[1] for r in check.execute("PRAGMA table_info(products)")}
    finally:
        check.close()
    missing = [c for c, _ in NEW_COLS if c not in cols]
    if missing:
        print(f"ERROR: columns still missing after migrate: {missing}", file=sys.stderr)
        return 1

    print("Migration complete; all provenance columns verified present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
