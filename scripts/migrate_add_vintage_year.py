#!/usr/bin/env python3
"""
Derive a machine-usable vintage from the free-text `vintage` field.

WHY THIS EXISTS
---------------
`vintage` is human-entered free text. It holds "2015", "2015 [**VINTAGE MAY
CHANGE]", "Current vintage", "NV", "2020/2021", typos ("CURRENT VINATGE"), and
empty. Any script that needs "which year is this bottle" must re-parse it, and
getting that wrong is silent: a 2026-07-27 canary reported 0/10 producer-note
matches purely because it compared page text against the RAW string
"2015 [**VINTAGE MAY CHANGE]" instead of "2015". The real match rate was not
zero — the measurement was broken. Parsing once, here, prevents that class of bug.

Adds:
  vintage_year           INTEGER  the sellable year, or NULL when there isn't one
  vintage_is_provisional INTEGER  1 when the source carried [**VINTAGE MAY CHANGE]

THE PROVISIONAL FLAG IS LOAD-BEARING — DO NOT FLATTEN IT
`[**VINTAGE MAY CHANGE]` is a real supplier signal: the year is what is on the
shelf today, but the next delivery may differ. Those rows are MORE likely to be
in stock (870) than firm-vintage rows (715), so dropping them would discard the
most commercially active half of the catalog. Keep the year AND the caveat:
anything vintage-specific written against a provisional row (e.g. a producer
tasting note) must record which year it was sourced for, so a later vintage
rollover is detectable instead of silently wrong.

Parsing rules (deliberately conservative — ambiguity yields NULL, never a guess):
  "2015"                        -> 2015, provisional=0
  "2015 [**VINTAGE MAY CHANGE]" -> 2015, provisional=1   (spacing variants ok)
  "2020/2021"                   -> NULL, provisional=0   ambiguous, refuse to pick
  "NV" / "N/V" / "Non Vintage"  -> NULL  (also handles a stray Thai prefix seen
                                          in one row, and NV+MAY CHANGE)
  "Current vintage" (+ typos)   -> NULL  no year asserted
  "" / NULL                     -> NULL
A year outside 1900..(current+2) is rejected as a typo rather than stored.

Safe to run repeatedly: columns are added only when absent, and values are
recomputed idempotently from the source field.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLS = [("vintage_year", "INTEGER"), ("vintage_is_provisional", "INTEGER")]

MAX_YEAR = date.today().year + 2
MIN_YEAR = 1900

_PROVISIONAL = re.compile(r"MAY\s*CHANGE", re.I)
_RANGE = re.compile(r"\b(19|20)\d{2}\s*[/\-]\s*(19|20)\d{2}\b")
_YEAR = re.compile(r"\b((?:19|20)\d{2})\b")


def parse_vintage(raw: str | None) -> tuple[int | None, int]:
    """Return (vintage_year | None, provisional flag 0/1)."""
    s = (raw or "").strip()
    provisional = 1 if _PROVISIONAL.search(s) else 0
    if not s:
        return None, 0
    # Ambiguous ranges ("2020/2021") assert two different bottles — refuse both.
    if _RANGE.search(s):
        return None, provisional
    years = _YEAR.findall(s)
    if len(years) != 1:
        return None, provisional  # zero years (NV/Current), or several -> no claim
    year = int(years[0])
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return None, provisional
    return year, provisional


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write (default is dry run)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    probe = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()[0]
        rowcount = probe.execute("SELECT count(*) FROM products").fetchone()[0] if has_table else 0
    finally:
        probe.close()
    if not has_table or rowcount == 0:
        print(f"ERROR: {args.db} has no populated products table — refusing "
              f"(CLAUDE.md Rule 1).", file=sys.stderr)
        return 1

    print(f"Target DB: {args.db} ({rowcount} products)")

    con = sqlite3.connect(args.db)
    try:
        existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        to_add = [(c, t) for c, t in NEW_COLS if c not in existing]
        for c, _ in NEW_COLS:
            if c in existing:
                print(f"  {c}: already exists")

        rows = con.execute("SELECT sku, COALESCE(vintage,'') FROM products").fetchall()
        parsed = [(sku, *parse_vintage(v)) for sku, v in rows]
        with_year = [p for p in parsed if p[1] is not None]
        prov = [p for p in with_year if p[2] == 1]
        firm = [p for p in with_year if p[2] == 0]

        print(f"\n  parseable vintage_year : {len(with_year)} / {rowcount}")
        print(f"    firm                 : {len(firm)}")
        print(f"    provisional          : {len(prov)}")
        print(f"  no year (NV/current/…) : {rowcount - len(with_year)}")

        if not args.apply:
            print("\nDRY RUN — nothing written. Re-run with --apply.")
            return 0

        for col, coltype in to_add:
            con.execute(f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            print(f"  {col}: added ({coltype})")

        con.executemany(
            "UPDATE products SET vintage_year = ?, vintage_is_provisional = ? WHERE sku = ?",
            [(y, p, sku) for sku, y, p in parsed],
        )
        con.commit()
        print(f"\nwrote {len(parsed)} rows")
    except Exception as e:
        con.rollback()
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        con.close()

    # Rule 1: verify at the destination.
    chk = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        n_year, n_prov = chk.execute(
            "SELECT SUM(vintage_year IS NOT NULL), "
            "       SUM(COALESCE(vintage_is_provisional,0)=1 AND vintage_year IS NOT NULL) "
            "FROM products"
        ).fetchone()
        print(f"\nVerified in DB: vintage_year set on {n_year} rows "
              f"({n_prov} of them provisional)")
        bad = chk.execute(
            f"SELECT COUNT(*) FROM products WHERE vintage_year IS NOT NULL "
            f"AND (vintage_year < {MIN_YEAR} OR vintage_year > {MAX_YEAR})"
        ).fetchone()[0]
        print(f"out-of-range years: {bad}")
        if bad:
            return 1
    finally:
        chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
