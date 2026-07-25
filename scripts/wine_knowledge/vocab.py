"""Controlled relationship vocabulary for taxonomy_relationships.

Single source of truth — imported by schema.py and ingest.py so no
ingestion session can invent ad-hoc synonyms (spec §4.5). Each verb's
canonical direction is (from_entity_types, to_entity_types); rows MUST be
written from -> to, because the table's UNIQUE(from,to,relationship,scope_id)
constraint does not self-correct a reversed edge.
"""
from __future__ import annotations

# verb -> (allowed from entity_types, allowed to entity_types)
DIRECTION: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "grown_in":           (("grape_variety",),                  ("region", "appellation")),
    "produces_style":     (("region", "appellation"),           ("style",)),
    "exhibits_style":     (("grape_variety", "classification_tier"), ("style",)),
    "sub_appellation_of": (("appellation",),                    ("appellation", "region")),
    "classified_under":   (("appellation", "region"),           ("classification_tier",)),
    "outranks":           (("classification_tier",),            ("classification_tier",)),
}

RELATIONSHIP_VERBS: tuple[str, ...] = tuple(DIRECTION.keys())

# New entity_types this effort introduces (entity_type is free-text in the DDL).
NEW_ENTITY_TYPES: tuple[str, ...] = ("grape_variety", "style", "classification_tier")
