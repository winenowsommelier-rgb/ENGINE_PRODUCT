#!/usr/bin/env python3
"""Rename wine_* attribute columns → universal names + add new sensory columns.
Idempotent (checks current schema first). Does NOT drop wine_type/other_type —
that is a separate one-way migration. Backs up the real DB when run on it."""
from __future__ import annotations
import argparse, shutil, sqlite3, sys
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path: sys.path.insert(0, str(REPO))
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS

def migrate(db_path: str | Path) -> None:
    conn = sqlite3.connect(db_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for old, new in ATTRIBUTE_MAP.items():
        if old in cols and new not in cols:
            conn.execute(f"ALTER TABLE products RENAME COLUMN {old} TO {new}")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for nc in NEW_COLUMNS:
        if nc not in cols:
            conn.execute(f"ALTER TABLE products ADD COLUMN {nc} TEXT")
    conn.commit(); conn.close()

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO / "data" / "db" / "products.db"))
    ap.add_argument("--no-backup", action="store_true")
    a = ap.parse_args(argv)
    if not a.no_backup:
        bak = f"{a.db}.bak-pre-attr-rename"
        shutil.copy2(a.db, bak); print(f"backup → {bak}")
    migrate(a.db); print("migration applied")
    return 0

if __name__ == "__main__":
    sys.exit(main())
