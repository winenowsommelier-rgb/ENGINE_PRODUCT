#!/usr/bin/env python3
"""Seed designation_reference with (designation, region) KEYS ONLY -- no
explainer text. Explainer authoring is later content-generation work, run
separately. This script is pure structural bootstrapping from the existing
classification_master.json taxonomy file.

NOTE: classification_master.json has NO region field (verified 2026-07-16);
every row is seeded with region='ALL' as an explicit placeholder for later
content-authoring to split into per-region rows where a designation's
meaning genuinely differs (Grand Cru: Burgundy vs Alsace vs Champagne mean
different things) and leave 'ALL' where it doesn't (XO, VSOP mean the same
thing everywhere).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "dossier.db"
MASTER = REPO_ROOT / "data" / "taxonomy" / "classification_master.json"


def extract_designation_region_pairs(master: dict) -> list[tuple[str, str, str | None]]:
    """Returns (designation, region, kind) triples. region is always 'ALL' --
    see module docstring. kind is left None -- inferring quality-rank/dosage/
    aging-class/production-style requires judgment later content-authoring
    supplies, not something this file encodes."""
    pairs = []
    active_only = [r for r in master.get("data", []) if r.get("is_active", 1)]
    for entry in active_only:
        designation = entry.get("classification")
        if not designation:
            continue
        pairs.append((designation, "ALL", None))
    return pairs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--master", type=Path, default=MASTER)
    args = ap.parse_args(argv)

    master = json.loads(args.master.read_text())
    pairs = extract_designation_region_pairs(master)

    conn = sqlite3.connect(args.db)
    inserted = 0
    for designation, region, kind in pairs:
        cur = conn.execute(
            "INSERT OR IGNORE INTO designation_reference (designation, region, kind) "
            "VALUES (?, ?, ?)",
            (designation, region, kind),
        )
        inserted += cur.rowcount
    conn.commit()
    print(f"Seeded {inserted} (designation, region) key rows -- explainer text is later content-authoring work.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
