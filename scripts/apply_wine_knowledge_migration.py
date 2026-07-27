"""Applies schema.migrate + pairing_schema.migrate to the live taxonomy.db.

By default targets this checkout's data/taxonomy.db. Because the canonical
taxonomy.db is git-ignored and lives in the MAIN checkout (not in worktrees),
the DB path can be overridden with the WNLQ9_TAXONOMY_DB env var so this runner
can be executed from a worktree while writing to the real DB.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema, pairing_schema

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    schema.migrate(conn)
    pairing_schema.migrate(conn)
    conn.close()
    print(f"migrated {db}")
