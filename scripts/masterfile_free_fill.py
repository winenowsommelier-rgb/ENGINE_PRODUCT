#!/usr/bin/env python3
"""Task 3 — NULL-only free-fill from the masterfile into canonical products.db.

DB WINS on every conflict: a column is SET only when the current DB value
is_empty_cell(...) AND the masterfile has a non-empty value. Existing curated
values are NEVER overwritten. Idempotent (a second run fills nothing new).

Safety:
- Backs up data/db/products.db before opening for write (unless --no-backup).
- Parameterized UPDATEs only (never string-format SQL).
- Re-queries PRAGMA table_info before trusting columns exist (DB-revert hazard).
"""
from __future__ import annotations
import argparse, json, sqlite3, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "data" / "lib" / "taxonomy"))

# Task-1 pure helpers
from scripts.masterfile_lib import (  # noqa: E402
    load_masterfile, is_empty_cell, normalize_variety, extract_designation,
)

DEFAULT_DB = "data/db/products.db"
DEFAULT_CSV = ("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
               "Masterfile Data WNLQ9 - MReport Masterfile.csv")
FILLED_SKUS_PATH = Path("data/masterfile_filled_skus.json")

# (db_col, masterfile_col). variety + designation handled specially below.
SIMPLE_MAP = [
    ("region", "region"),
    ("subregion", "sub_region"),
    ("body", "wine_body"),
    ("acidity", "wine_acidity"),
    ("tannin", "wine_tanin"),
    ("food_matching", "food_matching"),
    ("country", "country"),
    ("desc_en_short", "short_description"),
    ("full_description", "description"),
]
# Every DB column this script may write (used for filled-set keys + the summary).
ALL_DB_COLS = [c for c, _ in SIMPLE_MAP] + ["variety", "designation"]


def _type_for(sku: str) -> str:
    """Resolve product TYPE from SKU taxonomy (fallback when masterfile item_type empty)."""
    try:
        import sku_taxonomy  # type: ignore  # path added at module import
        return sku_taxonomy.type_for(sku) or ""
    except Exception:
        return ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-write backup (tests use this on a temp copy)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report fill counts, write nothing")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        sys.exit(f"DB not found: {db_path}")

    # Backup BEFORE opening for write (Rule 10). Skip on dry-run / --no-backup.
    if not args.no_backup and not args.dry_run:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bak = db_path.with_name(db_path.name + f".bak-pre-masterfile-freefill-{ts}")
        shutil.copy(db_path, bak)
        print(f"backup: {bak}")

    rows, dups = load_masterfile(args.csv)
    if dups:
        print(f"masterfile: {len(dups)} duplicate SKU(s) collapsed (last wins)")
    mf_by_sku = {(r.get("sku") or "").strip(): r for r in rows}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Re-query columns; DB can be reverted between turns (shared checkout hazard).
    present = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    missing = [c for c in ALL_DB_COLS if c not in present]
    if missing:
        conn.close()
        sys.exit(f"products table missing expected columns: {missing}")

    filled: dict[str, list[str]] = {c: [] for c in ALL_DB_COLS}

    for db_row in conn.execute("SELECT * FROM products"):
        sku = db_row["sku"]
        mf = mf_by_sku.get(sku)
        if mf is None:
            continue  # only SKUs in BOTH masterfile and products table

        set_cols: dict[str, str] = {}

        for db_col, mf_col in SIMPLE_MAP:
            if not is_empty_cell(db_row[db_col]):
                continue  # DB wins — never overwrite a curated value
            mf_val = (mf.get(mf_col) or "").strip()
            if is_empty_cell(mf_val):
                continue
            set_cols[db_col] = mf_val

        # variety: normalize_variety(grape_variety) first; if that's empty
        # (None OR a sentinel like 'N/A'/'-' that is_empty_cell rejects), fall
        # back to grape_class. normalize_variety only strips '100%', so an 'N/A'
        # grape_variety survives normalization and must be treated as empty here.
        if is_empty_cell(db_row["variety"]):
            var = normalize_variety(mf.get("grape_variety"))
            if not var or is_empty_cell(var):
                var = normalize_variety(mf.get("grape_class"))
            if var and not is_empty_cell(var):
                set_cols["variety"] = var

        # designation: derive from name + item_type (masterfile, else SKU taxonomy).
        if is_empty_cell(db_row["designation"]):
            item_type = (mf.get("item_type") or "").strip()
            if not item_type:
                item_type = _type_for(sku)
            desig = extract_designation(mf.get("name") or db_row["name"], item_type)
            if desig and not is_empty_cell(desig):
                set_cols["designation"] = desig

        if not set_cols:
            continue

        for c in set_cols:
            filled[c].append(sku)

        if not args.dry_run:
            assign = ", ".join(f"{c} = ?" for c in set_cols)
            params = list(set_cols.values()) + [sku]
            conn.execute(f"UPDATE products SET {assign} WHERE sku = ?", params)

    if not args.dry_run:
        conn.commit()
    conn.close()

    # Per-field summary.
    print(f"{'DRY-RUN ' if args.dry_run else ''}filled per field:")
    for c in ALL_DB_COLS:
        print(f"  {c:18s} {len(filled[c])}")

    # Emit/merge the filled-SKU set (consumed by Task-6 export-reach test).
    if not args.dry_run:
        existing: dict = {}
        if FILLED_SKUS_PATH.exists():
            try:
                existing = json.loads(FILLED_SKUS_PATH.read_text())
            except Exception:
                existing = {}
        existing.update(filled)  # merge: our keys overwrite, others preserved
        FILLED_SKUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        FILLED_SKUS_PATH.write_text(json.dumps(existing, indent=2))
        print(f"wrote {FILLED_SKUS_PATH} (keys: {sorted(existing)})")


if __name__ == "__main__":
    main()
