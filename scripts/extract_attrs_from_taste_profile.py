#!/usr/bin/env python3
"""
Extract structured attributes already present in `taste_profile` JSON into the
flat product columns that are currently empty.

WHY THIS IS NOT INFERENCE
-------------------------
This script performs no reasoning about how a product tastes. It only copies a
value that already exists on the same row, from the JSON blob into the flat
column that the UI and recommender read. Provenance is carried over unchanged
from the source row — if taste_profile was AI-generated ('unverified'), the
extracted value stays 'unverified'. Extraction never upgrades evidence tier.

Two taste_profile schemas exist in the data (verified 2026-07-27):
  1. tiered  (schema_version 2.0, 3,693 rows) -> `structural`: body/acidity/tannin
  2. flat    (category+axes,       419 rows) -> `axes`: {name: {value, scale}}
Both are handled; anything else is skipped and counted.

Only fills a column that is EMPTY. Never overwrites an existing value, and never
touches taste_profile_override rows (a human override must win).

Default is a dry run; writing requires --apply.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

# structural block (tiered schema) -> flat column
STRUCTURAL_MAP = {"body": "body", "acidity": "acidity", "tannin": "tannin"}

# axes (flat schema) -> flat column. Only axes whose meaning matches the column
# exactly. Deliberately EXCLUDED: body_umami, polish_ratio, peat_smoke,
# oak_influence, fruit_intensity etc. — those are category-specific composites
# that do NOT map 1:1 onto body/smokiness/intensity, and forcing them in would
# be interpretation, not extraction.
AXES_MAP = {"sweetness": "sweetness", "bitterness": "bitterness"}

TARGET_COLS = sorted(set(STRUCTURAL_MAP.values()) | set(AXES_MAP.values()))

# Canonical casing per the UI gauge scales (apps/catalog/lib/taste-adapter.ts
# SCALE, components/product/StructuralGauges.tsx). The taste_profile JSON emits
# 'Off-dry' while the catalog vocabulary is 'Off-Dry'; extracting raw would split
# one value across two casings in a live UI column. Case-folded lookup, so any
# incoming casing lands on the canonical token.
CANONICAL_CASE = {
    col: {v.lower(): v for v in vals}
    for col, vals in {
        "body": ["Light", "Medium-Light", "Medium", "Medium-Full", "Full"],
        "acidity": ["Low", "Medium", "Medium-High", "High"],
        "tannin": ["Low", "Medium", "Medium-High", "High"],
        "sweetness": ["Dry", "Off-Dry", "Medium-Sweet", "Sweet"],
        "bitterness": ["None", "Trace", "Low", "Medium", "Pronounced", "High"],
    }.items()
}

# The sweetness gauge matches SCALE = {Dry, Off-Dry, Medium-Sweet, Sweet}
# case-sensitively and DROPS anything else to null → a silently blank gauge
# (tests/test_sweetness_scale_export_invariant.py, CLAUDE.md Rule 6). The
# taste_profile axes vocabulary is wider than the gauge, so off-scale tokens
# must be mapped onto the scale — never written through raw.
SWEETNESS_REMAP = {
    "bone-dry": "Dry",       # drier than Dry; the scale has no drier bucket
    "very dry": "Dry",
    "slight": "Off-Dry",     # 'slight' sweetness == just off dry
    "balanced": "Off-Dry",   # neither dry nor sweet
    "medium": "Medium-Sweet",
    "lush": "Sweet",
    "very sweet": "Sweet",
}

# Values that carry no usable signal for the target column — dropped, not guessed.
UNMAPPABLE = {"sweetness": {"light"}}


def canon(col: str, val: str) -> str | None:
    """Normalize to the catalog's canonical, on-scale token.

    Returns None when the value cannot be represented on the target column's
    scale, so the caller skips it rather than shipping a token the UI drops.
    """
    v = val.strip()
    if not v:
        return None
    low = v.lower()
    if low in UNMAPPABLE.get(col, set()):
        return None
    hit = CANONICAL_CASE.get(col, {}).get(low)
    if hit:
        return hit
    if col == "sweetness":
        return SWEETNESS_REMAP.get(low)
    return v


def extract(tp_raw: str) -> tuple[dict[str, str], str]:
    """Return ({column: value}, schema_kind) for one taste_profile blob."""
    try:
        d = json.loads(tp_raw)
    except Exception:
        return {}, "unparseable"
    if not isinstance(d, dict):
        return {}, "unparseable"

    out: dict[str, str] = {}

    structural = d.get("structural")
    if isinstance(structural, dict) and structural:
        for key, col in STRUCTURAL_MAP.items():
            val = structural.get(key)
            if isinstance(val, str) and val.strip():
                c = canon(col, val)
                if c:
                    out[col] = c
        return out, "tiered"

    axes = d.get("axes")
    if isinstance(axes, dict) and axes:
        for key, col in AXES_MAP.items():
            node = axes.get(key)
            if isinstance(node, dict):
                val = node.get("value")
                if isinstance(val, str) and val.strip():
                    c = canon(col, val)
                    if c:
                        out[col] = c
        return out, "axes"

    return {}, "no_structured_block"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry run)")
    ap.add_argument("--limit", type=int, default=0, help="canary: process only N rows")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        for need in TARGET_COLS + ["taste_profile", "taste_profile_override"]:
            if need not in cols:
                print(f"ERROR: column {need} missing from products", file=sys.stderr)
                return 1

        sel = ", ".join(["sku", "taste_profile", "taste_profile_override", *TARGET_COLS])
        sql = (f"SELECT {sel} FROM products "
               f"WHERE COALESCE(taste_profile,'') <> '' "
               f"  AND COALESCE(taste_profile_override,'') = ''")
        if args.limit:
            sql += f" LIMIT {args.limit}"
        rows = con.execute(sql).fetchall()

        schemas = Counter()
        per_col = Counter()
        updates: list[tuple[str, dict[str, str]]] = []
        conflicts = 0

        for r in rows:
            vals, kind = extract(r["taste_profile"])
            schemas[kind] += 1
            fill = {}
            for col, val in vals.items():
                current = (r[col] or "").strip()
                if current:
                    if current.lower() != val.lower():
                        conflicts += 1
                    continue  # never overwrite
                fill[col] = val
            if fill:
                updates.append((r["sku"], fill))
                for c in fill:
                    per_col[c] += 1

        print(f"candidate rows (taste_profile set, no override): {len(rows)}")
        print(f"schemas seen: {dict(schemas)}")
        print(f"rows needing a fill: {len(updates)}")
        for c in TARGET_COLS:
            if per_col.get(c):
                print(f"  {c:<10} +{per_col[c]}")
        print(f"existing values that DIFFER from JSON (left untouched): {conflicts}")

        if not args.apply:
            print("\nDRY RUN — nothing written. Re-run with --apply to commit.")
            for sku, fill in updates[:8]:
                print(f"  e.g. {sku}: {fill}")
            return 0

        for sku, fill in updates:
            sets = ", ".join(f"{c} = ?" for c in fill)
            con.execute(f"UPDATE products SET {sets} WHERE sku = ?", [*fill.values(), sku])
        con.commit()
        print(f"\nwrote {len(updates)} rows")
    except Exception as e:
        con.rollback()
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        con.close()

    # Rule 1: verify at the destination, not from the loop counter.
    chk = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        print("\nVerified remaining gaps (JSON has value, column still empty):")
        remaining = 0
        for r in chk.execute(
            "SELECT taste_profile, body, acidity, tannin, sweetness, bitterness "
            "FROM products WHERE COALESCE(taste_profile,'') <> '' "
            "AND COALESCE(taste_profile_override,'') = ''"
        ):
            vals, _ = extract(r[0])
            cur = {"body": r[1], "acidity": r[2], "tannin": r[3], "sweetness": r[4], "bitterness": r[5]}
            if any(v and not (cur.get(c) or "").strip() for c, v in vals.items()):
                remaining += 1
        print(f"  rows still unfilled: {remaining}")
    finally:
        chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
