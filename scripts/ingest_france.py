"""Loads the France chapter (Bordeaux, Burgundy, Champagne, Rhône) from
The Wine Bible into the taxonomy knowledge graph.

Targets this checkout's data/taxonomy.db by default; override with the
WNLQ9_TAXONOMY_DB env var to write to the canonical git-ignored DB in the main
checkout (mirrors scripts/apply_wine_knowledge_migration.py). Runs schema.migrate
first (idempotent) so the citation columns exist, then each sub-chapter loader.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema
from scripts.wine_knowledge.france import bordeaux, burgundy, champagne, rhone

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def load_all(conn: sqlite3.Connection) -> None:
    schema.migrate(conn)
    bordeaux.load(conn)
    burgundy.load(conn)
    champagne.load(conn)
    rhone.load(conn)


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    load_all(conn)
    tiers = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'"
    ).fetchone()[0]
    grown = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    outr = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    conn.close()
    print(f"France loaded: classification_tiers={tiers} grown_in={grown} outranks={outr}")
