"""Shared lookups for the Plan-3c sub-chapter loaders. Re-exports the same
helpers every earlier chapter uses so the linking rules stay identical across
the whole graph — we link to the EXISTING region skeleton and RAISE on a
missing entity rather than blind-creating one."""
from __future__ import annotations

from scripts.wine_knowledge.france._helpers import (  # noqa: F401
    find_region, find_or_create_subregion, link_grape,
)
from scripts.wine_knowledge.italy._helpers import find_grape  # noqa: F401
from scripts.wine_knowledge.new_world._helpers import find_tier  # noqa: F401
