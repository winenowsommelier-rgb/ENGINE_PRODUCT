#!/usr/bin/env python3
"""Backfill a `designation` column on data/db/products.db from product names.

Designations are the product CLASS (Grand Cru/DOCG/IGT/XO/Reserva/…). They are
NOT the raw `classification` field (that is product TYPE — CLAUDE.md RULE 12).
Pure regex over `name`; NO paid API. Mirrors apps/catalog/lib/designation.ts —
keep them in sync (tests/test_designation_parity.py guards drift).

This file is import-safe: defining patterns + designation_for_name has no side
effects (the DB write only runs under `if __name__ == '__main__'` / explicit calls).

USAGE (Rule 10 gated):
    python scripts/backfill_designation.py --canary SKU1 SKU2 ...   # 5-SKU canary
    python scripts/backfill_designation.py                          # full run ($0 API)
    python scripts/backfill_designation.py --verify                 # print populated count
Then `python scripts/refresh_live_export.py` to propagate to the UI JSON (RULE 9).
"""
from __future__ import annotations  # Python 3.9
import argparse
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Ordered MOST-SPECIFIC FIRST — first match wins. Mirrors the TS table EXACTLY.
# Spirit grades (XO/VSOP/VS) + Single Malt beat soft modifiers (Reserva/Reserve/Limited/Vintage).
DESIGNATION_PATTERNS = [
    ("Grand Cru",   re.compile(r"\bgrand\s+cru\b", re.I)),
    ("Premier Cru", re.compile(r"\b(?:premier\s+cru|1er\s+cru)\b", re.I)),
    ("Cru Classé",  re.compile(r"\bcru\s+class[eé](?![a-z])", re.I)),
    ("DOCG",        re.compile(r"\bDOCG\b")),
    ("DOC",         re.compile(r"\bDOC\b")),
    ("IGT",         re.compile(r"\bIGT\b")),
    ("DOP/IGP",     re.compile(r"\b(?:DOP|IGP)\b")),
    ("AOC",         re.compile(r"\b(?:AOC|AOP)\b")),
    ("Single Malt", re.compile(r"\bsingle\s+malt\b", re.I)),
    ("XO",          re.compile(r"\bXO\b")),
    ("VSOP",        re.compile(r"\bVSOP\b")),
    ("VS",          re.compile(r"\bVS\b")),
    ("Gran Reserva",re.compile(r"\bgran\s+reserva\b", re.I)),
    ("Extra Brut",  re.compile(r"\bextra\s+brut\b", re.I)),
    ("Brut",        re.compile(r"\bbrut\b", re.I)),
    ("Reserva",     re.compile(r"\b(?:reserva|riserva)\b", re.I)),
    ("Reserve",     re.compile(r"\breserve\b", re.I)),
    ("Limited",     re.compile(r"\blimited(?:\s+edition)?\b", re.I)),
    ("Vintage",     re.compile(r"\bvintage\b", re.I)),
]

def designation_for_name(name: str | None) -> str | None:
    n = name or ""
    for label, rx in DESIGNATION_PATTERNS:
        if rx.search(n):
            return label
    return None


def ensure_column(conn: sqlite3.Connection) -> None:
    """Idempotent: add the `designation` column if missing. Re-query PRAGMA every
    run — the shared products.db can be replaced between turns (project memory)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "designation" not in cols:
        conn.execute("ALTER TABLE products ADD COLUMN designation TEXT")
        conn.commit()


def backfill(db: Path, limit_skus: list[str] | None = None) -> int:
    """Write designation for every row (or only limit_skus). Returns count set non-null."""
    conn = sqlite3.connect(db)
    try:
        ensure_column(conn)
        q = "SELECT sku, name FROM products"
        params: list[str] = []
        if limit_skus:
            q += " WHERE sku IN (%s)" % ",".join("?" * len(limit_skus))
            params = limit_skus
        rows = conn.execute(q, params).fetchall()
        n = 0
        for sku, name in rows:
            d = designation_for_name(name)
            if d:
                conn.execute("UPDATE products SET designation=? WHERE sku=?", (d, sku))
                n += 1
            else:
                conn.execute("UPDATE products SET designation=NULL WHERE sku=?", (sku,))
        conn.commit()
        return n
    finally:
        conn.close()


def populated_count(db: Path) -> int:
    conn = sqlite3.connect(db)
    try:
        return conn.execute(
            "SELECT count(*) FROM products WHERE designation IS NOT NULL AND designation != ''"
        ).fetchone()[0]
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill designation column on products.db")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--canary", nargs="*", help="SKUs for a canary run (writes only these)")
    ap.add_argument("--verify", action="store_true", help="print populated count and exit")
    args = ap.parse_args()
    if args.verify:
        print(f"designation populated: {populated_count(args.db)}")
        return 0
    n = backfill(args.db, args.canary)
    scope = f" (canary: {args.canary})" if args.canary else ""
    print(f"designation set on {n} row(s){scope}; db={args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
