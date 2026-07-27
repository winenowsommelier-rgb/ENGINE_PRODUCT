"""Shared lookups for France sub-chapter loaders. We link to the EXISTING
region/subregion skeleton (verified present) rather than blind-creating, and
resolve duplicate region entities to the canonical lowest-id one."""
from __future__ import annotations

import sqlite3
from typing import Optional

from scripts.wine_knowledge import ingest


def find_region(conn, name: str) -> int:
    """Canonical region id by name (case-insensitive). On duplicates returns the
    LOWEST id. Raises if no region matches (we never blind-create a region)."""
    rows = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='region' "
        "AND LOWER(name)=LOWER(?) ORDER BY id", (name,)).fetchall()
    if not rows:
        raise ValueError(f"region not found: {name!r}")
    return rows[0][0]


def find_or_create_subregion(conn, name: str, parent_region_id: int,
                             slug: Optional[str] = None) -> int:
    """Existing subregion id by name, else create under the given parent."""
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='subregion' "
        "AND LOWER(name)=LOWER(?)", (name,)).fetchone()
    if row:
        return row[0]
    slug = slug or name.lower().replace(" ", "-").replace("é", "e").replace("è", "e")
    return ingest.upsert_entity(conn, "subregion", name, slug,
                                parent_id=parent_region_id)


def link_grape(conn, grape_slug: str, region_or_appellation_id: int) -> None:
    """Add grown_in from the grape entity (by slug) to a region/appellation."""
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug=?", (grape_slug,)).fetchone()
    if not row:
        raise ValueError(f"grape not found: {grape_slug!r}")
    ingest.add_relationship(conn, row[0], region_or_appellation_id, "grown_in")
