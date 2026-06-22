#!/usr/bin/env python3
"""Phase A taste backfill (free, deterministic, NULL-only).

Applies data/lib/enrichment/taste_rules to products.db, filling ONLY rows where the
target column is currently NULL/empty. NEVER overwrites an existing enriched value
(Rule 5 — don't clobber real data). Dry-run by default; --apply writes after backing
up the DB (Rule 10). Prints a per-field fill delta.

Column names go through ATTRIBUTE_MAP so the script never hardcodes wine_body vs body.

Usage:
    python scripts/backfill_taste_phase_a.py            # dry-run, prints delta
    python scripts/backfill_taste_phase_a.py --apply    # backup + write
    python scripts/backfill_taste_phase_a.py --db <path> [--apply]
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.enrichment.taste_rules import infer_body, infer_smokiness, infer_sweetness  # noqa: E402
from data.lib.taxonomy.attribute_map import rename_key  # noqa: E402

try:
    from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_group  # noqa: E402
except Exception:  # pragma: no cover — tests pass a fake table without SKUs
    _resolve_group = None

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Smokiness is a WHISKY/SPIRITS concept only — never apply it to wine/sake/beer (else
# the region-fallback would tag ~10k wines 'none', which is wrong data, Rule 2). Scope
# by the SKU-derived group (Rule 12: SKU is source of truth, NOT classification).
_SMOKINESS_GROUPS = {"Whisky", "Spirits"}


def _group_for(sku: str, name: str) -> str:
    if _resolve_group is None or not sku:
        return ""
    try:
        return _resolve_group({"sku": sku, "name": name}).get("group", "")
    except Exception:
        return ""

# (column, inferer(name, second_arg), which row field feeds the inferer's 2nd arg).
# NOTE: `category_type` is EXPORT-derived (computed by refresh_live_export.py from the
# SKU taxonomy) and is NOT a column in products.db — so the body/sweetness inferers
# receive '' for their category hint here (they key off `name` anyway). `region` IS a
# real DB column and feeds smokiness. The 2nd-arg source must be a real products column
# or None (→ pass '').
# (column, inferer, 2nd-arg source col or None, group-scope set or None).
# group-scope = only infer for rows whose SKU group is in the set (None = all rows).
BACKFILL = [
    (rename_key("wine_body"), infer_body, None, None),          # → "body"  (name-only)
    ("sweetness", infer_sweetness, None, None),                # name-only; self-limits on keywords
    ("smokiness", infer_smokiness, "region", _SMOKINESS_GROUPS),  # whisky/spirits ONLY
]


def _empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write (default is dry-run)")
    ap.add_argument("--ts", default="manual", help="backup suffix (deterministic for tests)")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"ERROR: DB not found: {args.db}", file=sys.stderr)
        return 1

    if args.apply and args.db == DEFAULT_DB:
        # Rule 10: back up the canonical DB before any write.
        bak = args.db.with_name(f"{args.db.name}.bak-pre-taste-A-{args.ts}")
        shutil.copy2(args.db, bak)
        print(f"backup → {bak}")

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for col, _fn, _src, _grp in BACKFILL:
        if col not in cols:
            print(f"ERROR: column {col!r} not in products table", file=sys.stderr)
            return 1

    # Pull rowid + sku (for group scoping) + name + source cols + target cols.
    has_sku = "sku" in cols
    src_cols = sorted({src for _, _, src, _ in BACKFILL if src})
    select_cols = ["rowid", *(["sku"] if has_sku else []), "name",
                   *src_cols, *[c for c, _, _, _ in BACKFILL]]
    rows = conn.execute(f"SELECT {', '.join(select_cols)} FROM products").fetchall()

    updates: dict[str, list[tuple[str, int]]] = {c: [] for c, _, _, _ in BACKFILL}
    was_null: dict[str, int] = {c: 0 for c, _, _, _ in BACKFILL}
    for row in rows:
        name = row["name"] or ""
        sku = row["sku"] if has_sku else ""
        group = None  # resolved lazily only when a scoped column needs it
        for col, fn, src, scope in BACKFILL:
            if not _empty(row[col]):
                continue  # NULL-only: never overwrite an existing value
            if scope is not None:
                if group is None:
                    group = _group_for(sku, name)
                if group not in scope:
                    continue  # out of scope (e.g. smokiness on a wine) → skip, leave NULL
            was_null[col] += 1
            second = (row[src] or "") if src else ""
            val = fn(name, second)
            if val is not None:
                updates[col].append((val, row["rowid"]))

    print(f"DB: {args.db}  rows: {len(rows)}  mode: {'APPLY' if args.apply else 'dry-run'}")
    for col, _, _, _ in BACKFILL:
        print(f"  {col:10s} would fill {len(updates[col]):5d} / {was_null[col]} null")

    if args.apply:
        for col, _, _, _ in BACKFILL:
            conn.executemany(f"UPDATE products SET {col}=? WHERE rowid=?", updates[col])
        conn.commit()
        print("WROTE.")
    else:
        print("(dry-run — pass --apply to write)")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
