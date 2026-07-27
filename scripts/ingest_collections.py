"""Load + export shop-filter collections into the live taxonomy.db.

WNLQ9_TAXONOMY_DB overrides the target DB (worktree runs point it at the main
checkout's git-ignored data/taxonomy.db). Idempotent: schema migrations are
ALTER/CREATE IF NOT EXISTS, and seed() upserts on slug.
"""
from __future__ import annotations
import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import pairing_schema, collections_schema, collections_seed


def resolve_db() -> str:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    if override:
        return override
    return str(Path(__file__).resolve().parent.parent / "data" / "taxonomy.db")


def main() -> None:
    db = resolve_db()
    conn = sqlite3.connect(db)
    try:
        pairing_schema.migrate(conn)
        collections_schema.migrate(conn)
        collections_seed.seed(conn)
    finally:
        conn.close()
    print(f"seeded {len(collections_seed.COLLECTIONS)} collections into {db}")


if __name__ == "__main__":
    main()
