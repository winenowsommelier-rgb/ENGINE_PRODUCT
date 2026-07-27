"""Shared lookups for the Plan-3b (Spain/USA/Australia/Chile) sub-chapter
loaders. Re-exports the France/Italy helpers so the linking rules stay
identical across every chapter — we link to the EXISTING region skeleton and
RAISE on a missing entity rather than blind-creating one."""
from __future__ import annotations

from scripts.wine_knowledge.france._helpers import (  # noqa: F401
    find_region, find_or_create_subregion, link_grape,
)
from scripts.wine_knowledge.italy._helpers import find_grape  # noqa: F401


def find_tier(conn, slug: str) -> int:
    """Classification-tier id by slug. Raises with an actionable message if the
    tier loader has not run yet (the region loaders depend on it)."""
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug=?", (slug,)).fetchone()
    if not row:
        raise ValueError(
            f"tier {slug!r} not found — run tiers.load(conn) before the region loaders")
    return row[0]
