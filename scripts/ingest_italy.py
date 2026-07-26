"""Loads the Italy chapter (Piedmont, Tuscany, Veneto, the South & Islands)
from The Wine Bible into the taxonomy knowledge graph.

Targets this checkout's data/taxonomy.db by default; override with the
WNLQ9_TAXONOMY_DB env var to write to the canonical git-ignored DB in the main
checkout (mirrors scripts/ingest_france.py). Runs schema.migrate and
pairing_schema.migrate first (idempotent) so the required columns/tables exist,
then the grape + tier loaders (which the region loaders link against), then
each region sub-chapter loader. ORDER MATTERS: grapes + tiers MUST run before
the region loaders, which link grapes (grown_in) and the DOCG tier
(classified_under).
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema, pairing_schema
from scripts.wine_knowledge.italy import (
    grapes,
    tiers,
    piedmont,
    tuscany,
    veneto,
    south_islands,
)

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"

# The 10 core Italian grape slugs authored in italy/grapes.py.
ITALY_GRAPE_SLUGS = (
    "primitivo",
    "corvina",
    "garganega",
    "aglianico",
    "montepulciano-grape",
    "vermentino",
    "dolcetto",
    "glera",
    "nero-d-avola",
    "verdicchio",
)


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def load_all(conn: sqlite3.Connection) -> None:
    schema.migrate(conn)
    pairing_schema.migrate(conn)
    # grapes + tiers FIRST — the region loaders link grapes and the DOCG tier.
    grapes.load(conn)
    tiers.load(conn)
    piedmont.load(conn)
    tuscany.load(conn)
    veneto.load(conn)
    south_islands.load(conn)


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    load_all(conn)
    placeholders = ",".join("?" for _ in ITALY_GRAPE_SLUGS)
    grapes_n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        f"AND slug IN ({placeholders})",
        ITALY_GRAPE_SLUGS,
    ).fetchone()[0]
    styles = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='style'"
    ).fetchone()[0]
    itiers = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug LIKE 'italy-%'"
    ).fetchone()[0]
    grown = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    classified = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='classified_under'"
    ).fetchone()[0]
    produces = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='produces_style'"
    ).fetchone()[0]
    outr = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    conn.close()
    print(
        f"Italy loaded: grapes={grapes_n} styles={styles} classification_tiers={itiers} "
        f"grown_in={grown} classified_under={classified} produces_style={produces} "
        f"outranks={outr}"
    )
