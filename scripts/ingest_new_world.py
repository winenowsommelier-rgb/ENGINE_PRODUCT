"""Loads the Plan-3b chapters (Spain, USA, Australia, Chile) from The Wine
Bible into the taxonomy knowledge graph.

Targets this checkout's data/taxonomy.db by default; override with the
WNLQ9_TAXONOMY_DB env var to write to the canonical git-ignored DB in the main
checkout (mirrors scripts/ingest_france.py and scripts/ingest_italy.py). Runs
schema.migrate and pairing_schema.migrate first (idempotent) so the required
columns/tables exist, then the grape + tier loaders, then each country loader.

ORDER MATTERS: grapes + tiers MUST run before the country loaders, which link
grapes (grown_in) and tiers (classified_under) and RAISE on a missing entity.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema, pairing_schema
from scripts.wine_knowledge.new_world import (
    grapes,
    tiers,
    spain,
    usa,
    australia,
    chile,
)

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"

# The 4 grape slugs authored in new_world/grapes.py. garnacha/monastrell/shiraz
# are NOT here — the book maps them to grenache/mourvedre/syrah, which already
# exist (see grapes.SYNONYM_TO_SLUG).
NEW_WORLD_GRAPE_SLUGS = ("carmenere", "petite-sirah", "palomino", "pais")

# Tier slugs this chapter owns: 2 Spanish place + 3 Spanish aging + 2 unranked.
NEW_WORLD_TIER_SLUGS = (
    tiers.DOCA_SLUG, tiers.DO_SLUG,
    tiers.GRAN_RESERVA_SLUG, tiers.RESERVA_SLUG, tiers.CRIANZA_SLUG,
    tiers.AVA_SLUG, tiers.CHILE_DO_SLUG,
)


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def load_all(conn: sqlite3.Connection) -> None:
    schema.migrate(conn)
    pairing_schema.migrate(conn)
    # grapes + tiers FIRST — the country loaders link both and raise on misses.
    grapes.load(conn)
    tiers.load(conn)
    spain.load(conn)
    usa.load(conn)
    australia.load(conn)
    chile.load(conn)


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    load_all(conn)

    gp = ",".join("?" for _ in NEW_WORLD_GRAPE_SLUGS)
    grapes_n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        f"AND slug IN ({gp})", NEW_WORLD_GRAPE_SLUGS).fetchone()[0]
    tp = ",".join("?" for _ in NEW_WORLD_TIER_SLUGS)
    tiers_n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier' "
        f"AND slug IN ({tp})", NEW_WORLD_TIER_SLUGS).fetchone()[0]
    grown = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    classified = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='classified_under'"
    ).fetchone()[0]
    outr = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    # Rule 1 style check: the invariant that makes the drawer trustworthy.
    null_cite = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    conn.close()
    print(
        f"New World loaded: grapes={grapes_n}/4 tiers={tiers_n}/7 "
        f"grown_in={grown} classified_under={classified} outranks={outr} "
        f"validated_contexts_missing_citation={null_cite}"
    )
