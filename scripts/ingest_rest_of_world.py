"""Loads the Plan-3c chapters (Argentina, New Zealand, Germany, Portugal,
Austria) from The Wine Bible into the taxonomy knowledge graph.

Targets this checkout's data/taxonomy.db by default; override with the
WNLQ9_TAXONOMY_DB env var to write to the canonical git-ignored DB in the main
checkout (mirrors scripts/ingest_france.py, ingest_italy.py and
ingest_new_world.py).

ORDER MATTERS: grapes + tiers MUST run before the region loader, which links
grapes and RAISES on a missing entity.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema, pairing_schema
from scripts.wine_knowledge.rest_of_world import grapes, tiers, regions

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"

# The 5 grape slugs authored in rest_of_world/grapes.py.
REST_OF_WORLD_GRAPE_SLUGS = (
    "torrontes", "blaufrankisch", "zweigelt", "touriga-nacional", "silvaner",
)

# 5 Prädikat rungs + 3 Vinea Wachau rungs + 2 standalone (eiswein, VDP).
REST_OF_WORLD_TIER_SLUGS = (
    tiers.KABINETT_SLUG, tiers.SPATLESE_SLUG, tiers.AUSLESE_SLUG,
    tiers.BA_SLUG, tiers.TBA_SLUG,
    tiers.SMARAGD_SLUG, tiers.FEDERSPIEL_SLUG, tiers.STEINFEDER_SLUG,
    tiers.EISWEIN_SLUG, tiers.VDP_SLUG,
)


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def load_all(conn: sqlite3.Connection) -> None:
    schema.migrate(conn)
    pairing_schema.migrate(conn)
    # grapes + tiers FIRST — the region loader links grapes and raises on miss.
    grapes.load(conn)
    tiers.load(conn)
    regions.load(conn)


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    load_all(conn)

    gp = ",".join("?" for _ in REST_OF_WORLD_GRAPE_SLUGS)
    grapes_n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        f"AND slug IN ({gp})", REST_OF_WORLD_GRAPE_SLUGS).fetchone()[0]
    tp = ",".join("?" for _ in REST_OF_WORLD_TIER_SLUGS)
    tiers_n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier' "
        f"AND slug IN ({tp})", REST_OF_WORLD_TIER_SLUGS).fetchone()[0]
    grown = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    outr = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    null_cite = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    conn.close()
    print(
        f"Rest of World loaded: grapes={grapes_n}/5 tiers={tiers_n}/10 "
        f"grown_in={grown} outranks={outr} "
        f"validated_contexts_missing_citation={null_cite}"
    )
