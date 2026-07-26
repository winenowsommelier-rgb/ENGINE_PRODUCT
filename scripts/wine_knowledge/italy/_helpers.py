"""Shared lookups for Italy sub-chapter loaders. Re-exports the France helpers
so the linking rules are identical, and adds find_grape (raise-on-missing)."""
from __future__ import annotations

from scripts.wine_knowledge.france._helpers import (  # noqa: F401
    find_region, find_or_create_subregion, link_grape,
)


def find_grape(conn, slug: str) -> int:
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug=?", (slug,)).fetchone()
    if not row:
        raise ValueError(f"grape not found: {slug!r}")
    return row[0]
