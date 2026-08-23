#!/usr/bin/env python3
"""
Label existing rows' attribute provenance honestly. Adds no new attribute data.

Audited 2026-07-27: every row with live flavor_tags was AI-generated and none
carried a source URL. This stamps `attr_evidence_tier` so unsourced legacy data
is visibly unsourced rather than silently indistinguishable from real research.

Mapping (from `enrichment_source`, which records how the row was produced):
  ai_* / phase_* / ai_low_conf   -> 'unverified'   model-generated, no per-item source
  masterfile_onboard_*           -> 'label'        transcribed from supplier/masterfile data
  reimport / rules / *_rule*     -> left NULL      these sources don't populate flavor
                                                   attributes at all (verified: 0 rows
                                                   with flavor_tags), so nothing to label

'unverified' is deliberately used rather than 'inferred': 'inferred' asserts we know
the derivation was grape/region reasoning, which we cannot confirm retroactively for
legacy rows. 'unverified' states only what is certain — provenance is unknown and no
source backs it.

Never overwrites a row that already carries a stronger tier or an attr_sources URL.
Default is --dry-run; writing requires --apply.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

STRONGER = ("producer", "critic", "retailer", "label")


def classify(src: str) -> str | None:
    s = (src or "").strip().lower()
    if not s:
        return None
    if s.startswith(("ai_", "phase_")) or s == "ai_low_conf":
        return "unverified"
    if s.startswith("masterfile_onboard"):
        return "label"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry run)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        for need in ("attr_evidence_tier", "attr_sources"):
            if need not in cols:
                print(f"ERROR: {need} missing — run migrate_add_attribute_provenance.py first",
                      file=sys.stderr)
                return 1

        rows = con.execute(
            """SELECT sku, enrichment_source, flavor_tags, taste_profile,
                      attr_evidence_tier, attr_sources
                 FROM products"""
        ).fetchall()

        planned: dict[str, list[str]] = {}
        skipped_stronger = 0
        for r in rows:
            tier = classify(r["enrichment_source"])
            if tier is None:
                continue
            # Never downgrade a row that already has real evidence.
            if (r["attr_evidence_tier"] or "").strip() in STRONGER or (r["attr_sources"] or "").strip():
                skipped_stronger += 1
                continue
            if (r["attr_evidence_tier"] or "").strip() == tier:
                continue
            planned.setdefault(tier, []).append(r["sku"])

        has_attr = sum(
            1 for r in rows
            if (r["flavor_tags"] or "").strip() not in ("", "[]") or (r["taste_profile"] or "").strip()
        )
        print(f"rows total                       : {len(rows)}")
        print(f"rows with flavor_tags/taste_profile: {has_attr}")
        print(f"rows skipped (already stronger)   : {skipped_stronger}")
        for tier, skus in sorted(planned.items()):
            print(f"  -> '{tier}': {len(skus)} rows")

        if not args.apply:
            print("\nDRY RUN — nothing written. Re-run with --apply to commit.")
            return 0

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        total = 0
        for tier, skus in planned.items():
            for i in range(0, len(skus), 500):
                chunk = skus[i:i + 500]
                q = ",".join("?" * len(chunk))
                con.execute(
                    f"""UPDATE products
                           SET attr_evidence_tier = ?,
                               attr_verified_at   = ?,
                               attr_verified_by   = 'backfill_attr_provenance.py'
                         WHERE sku IN ({q})""",
                    [tier, stamp, *chunk],
                )
                total += len(chunk)
        con.commit()
        print(f"\nwrote {total} rows")
    except Exception as e:
        con.rollback()
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        con.close()

    # Verify from a fresh read-only connection (Rule 1: query the destination).
    chk = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        print("\nVerified in DB:")
        for tier, n in chk.execute(
            """SELECT COALESCE(NULLIF(attr_evidence_tier,''),'(null)'), COUNT(*)
                 FROM products GROUP BY 1 ORDER BY 2 DESC"""
        ):
            print(f"  {tier:<12} {n}")
        unsourced_live = chk.execute(
            """SELECT COUNT(*) FROM products
                WHERE COALESCE(flavor_tags,'') NOT IN ('','[]')
                  AND attr_evidence_tier = 'unverified'"""
        ).fetchone()[0]
        print(f"\nlive flavor rows now labelled unverified: {unsourced_live}")
    finally:
        chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
