#!/usr/bin/env python3
"""Compute and populate products.enrichment_quality_grade (A / B / C).

Why
---
After Phase 5, we have 3,807 SKUs with AI-written descriptions but no
honest way to distinguish high-trust from formulaic-mid-trust from
needs-review. The UI and similarity engine need a signal that says
"trust this", "use this as default", "show with caveat".

Grading rubric (no LLM calls — purely from existing signals):

    Grade A   confidence >= 0.80
              OR (confidence >= 0.72 AND has Winesensed match)
              → external grounding OR model confident
              → safe to surface in recommendations + curation

    Grade B   confidence >= 0.65 AND validation_status='repaired'
              → clean first-pass, no retry needed
              → use as default but don't trust factual claims

    Grade C   everything else (model retried, or confidence < 0.65)
              → flag for human review or re-enrichment

The grade is stored as a string in products.enrichment_quality_grade.
Idempotent — safe to re-run as the rubric evolves.

Usage
-----
    .venv/bin/python scripts/compute_enrichment_grade.py --dry-run
    .venv/bin/python scripts/compute_enrichment_grade.py
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
from typing import Literal

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

Grade = Literal["A", "B", "C"]


def ensure_column(conn: sqlite3.Connection) -> None:
    """Add enrichment_quality_grade column if missing."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "enrichment_quality_grade" not in cols:
        conn.execute(
            "ALTER TABLE products ADD COLUMN enrichment_quality_grade TEXT"
        )
        conn.commit()
        print("Added column products.enrichment_quality_grade")


def load_winesensed_matched_skus(conn: sqlite3.Connection) -> set[str]:
    """SKUs whose AI response cited a Winesensed record ID."""
    out: set[str] = set()
    for sku, response in conn.execute(
        "SELECT sku, response_json FROM enrichment_cache "
        "WHERE validation_status IN ('passed','repaired','failed_then_retried')"
    ):
        try:
            r = json.loads(response)
        except (ValueError, TypeError):
            continue
        ids = (r.get("citations") or {}).get("winesensed_record_ids") or []
        if ids:
            out.add(sku)
    return out


def load_validation_status(conn: sqlite3.Connection) -> dict[str, str]:
    """Latest validation_status per SKU from enrichment_cache."""
    out: dict[str, str] = {}
    for sku, status in conn.execute(
        "SELECT sku, validation_status FROM enrichment_cache "
        "WHERE validation_status IN ('passed','repaired','failed_then_retried') "
        "ORDER BY created_at DESC"
    ):
        if sku not in out:
            out[sku] = status
    return out


def grade_row(
    sku: str,
    confidence: float,
    has_winesensed: bool,
    status: str,
    price: float | None = None,
) -> Grade:
    """Apply the A/B/C rubric to one row.

    Prestige floor: famous-brand SKUs (priced ≥ ฿15k) should never grade C
    just because the validator forced a retry. A first-growth Bordeaux or
    aged Yamazaki is, by definition, a curation-worthy product even when
    the formulaic prompt struggles to describe it. Price is a noisy proxy
    for prestige but the only signal we have until brand_description_library
    is built out (Phase B).
    """
    # Prestige floor — high-price SKUs never grade below A
    if price is not None and price >= 15000:
        return "A"
    # Mid-prestige — never grade below B
    if price is not None and price >= 5000:
        if confidence >= 0.80 or (confidence >= 0.72 and has_winesensed):
            return "A"
        return "B"
    # Standard rubric
    if confidence >= 0.80:
        return "A"
    if confidence >= 0.72 and has_winesensed:
        return "A"
    if confidence >= 0.65 and status == "repaired":
        return "B"
    return "C"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true",
                   help="Show distribution without writing.")
    p.add_argument("--no-backup", action="store_true")
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = args.db.with_suffix(args.db.suffix + f".bak-pre-grade-{ts}")
        shutil.copy2(args.db, backup)
        print(f"Backup: {backup}")

    conn = sqlite3.connect(args.db)
    if not args.dry_run:
        ensure_column(conn)

    ws_skus = load_winesensed_matched_skus(conn)
    statuses = load_validation_status(conn)

    rows = conn.execute(
        "SELECT sku, classification, brand, enrichment_confidence, price "
        "FROM products WHERE desc_en_short IS NOT NULL AND desc_en_short != ''"
    ).fetchall()

    updates: list[tuple[str, str]] = []
    dist: collections.Counter[str] = collections.Counter()
    by_class: dict[str, collections.Counter[str]] = collections.defaultdict(
        collections.Counter
    )
    by_brand_grade_c: collections.Counter[str] = collections.Counter()

    for sku, cls, brand, conf, price in rows:
        g = grade_row(
            sku=sku,
            confidence=conf or 0.0,
            has_winesensed=sku in ws_skus,
            status=statuses.get(sku, "repaired"),
            price=price,
        )
        updates.append((g, sku))
        dist[g] += 1
        by_class[cls or "?"][g] += 1
        if g == "C" and brand:
            by_brand_grade_c[brand] += 1

    print(f"\nGraded {len(rows)} enriched SKUs")
    print(f"  Grade A: {dist['A']:>5}  ({100*dist['A']/len(rows):.1f}%)")
    print(f"  Grade B: {dist['B']:>5}  ({100*dist['B']/len(rows):.1f}%)")
    print(f"  Grade C: {dist['C']:>5}  ({100*dist['C']/len(rows):.1f}%)")

    print("\nBy classification:")
    for cls in sorted(by_class, key=lambda c: -sum(by_class[c].values()))[:15]:
        counts = by_class[cls]
        tot = sum(counts.values())
        print(f"  {cls:20s}  A={counts['A']:>4}  B={counts['B']:>4}  "
              f"C={counts['C']:>4}  (n={tot})")

    print("\nTop 15 brands with C-grade rows (re-enrichment / brand-library priorities):")
    for brand, n in by_brand_grade_c.most_common(15):
        print(f"  {n:>3}  {brand}")

    if args.dry_run:
        print("\nDRY-RUN: no DB changes.")
        return 0

    with conn:
        for grade, sku in updates:
            conn.execute(
                "UPDATE products SET enrichment_quality_grade=? WHERE sku=?",
                (grade, sku),
            )
    print(f"\nUpdated {len(updates)} rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
