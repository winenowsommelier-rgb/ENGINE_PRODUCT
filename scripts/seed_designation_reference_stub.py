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

SCOPE: wine-only (category_scope == "wine"), per spec's v1 scope of ~21
designation rows. classification_master.json has 78 active rows total, but
51 of them are out of scope for this table right now:
  - 39 are legitimate whisky/rum/tequila/cognac/gin/sake designations
    (e.g. VSOP, Single Malt, Reposado) -- real designations, but spirits/sake
    support is an explicit Phase 2/3 addendum, not this task.
  - 12 aren't designations at all -- glassware material (Crystal), wine-fridge
    tech (Compressor, Dual Zone), cigar construction (Handmade, Long Filler),
    and generic marketing tiers (Premium, Limited Edition) that happen to
    share the same source file via category_scope in ('glassware',
    'wine_fridge', 'cigar', 'all').
Filtering to category_scope == "wine" yields 27 rows (verified 2026-07-16),
close to the spec's ~21 estimate. Fixed 2026-07-16 after a code-quality
review caught the initial version seeding all 78 rows unfiltered.
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
    supplies, not something this file encodes.

    Filtered to category_scope == "wine" only -- see module docstring SCOPE
    section. Spirits/sake designations and non-designation rows (glassware,
    wine_fridge, cigar, marketing tiers) are excluded until a later phase."""
    pairs = []
    wine_active = [
        r
        for r in master.get("data", [])
        if r.get("is_active", 1) and r.get("category_scope") == "wine"
    ]
    for entry in wine_active:
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
