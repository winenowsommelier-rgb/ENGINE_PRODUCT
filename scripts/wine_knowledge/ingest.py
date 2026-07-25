"""Safe write API for the wine-knowledge graph.

Every write goes through here so two rules are enforced in ONE place:
  1. status='validated' rows MUST carry a non-null source_citation (§4.2, §8).
  2. relationships MUST use a verb from vocab.RELATIONSHIP_VERBS in its
     canonical direction (§4.5).
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from scripts.wine_knowledge import vocab


def upsert_entity(conn, entity_type: str, name: str, slug: str,
                  parent_id: Optional[int] = None) -> int:
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type=? AND slug=?",
        (entity_type, slug)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_entities (entity_type,name,slug,parent_id) "
        "VALUES (?,?,?,?)", (entity_type, name, slug, parent_id))
    conn.commit()
    return cur.lastrowid


def upsert_context(conn, entity_id: int, scope_id: str, *, short: str,
                   full: str, status: str = "draft",
                   source_citation: Optional[str] = None,
                   confidence: Optional[str] = None,
                   attributes: str = "{}") -> int:
    if status == "validated" and not source_citation:
        raise ValueError("validated context requires a non-null source_citation")
    existing = conn.execute(
        "SELECT id FROM taxonomy_contexts WHERE entity_id=? AND scope_id=?",
        (entity_id, scope_id)).fetchone()
    if existing:
        conn.execute(
            "UPDATE taxonomy_contexts SET description_short=?, description_en=?, "
            "attributes=?, status=?, source_citation=?, confidence=? WHERE id=?",
            (short, full, attributes, status, source_citation, confidence, existing[0]))
        conn.commit()
        return existing[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_contexts (entity_id,scope_id,description_short,"
        "description_en,attributes,status,source_citation,confidence) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (entity_id, scope_id, short, full, attributes, status,
         source_citation, confidence))
    conn.commit()
    return cur.lastrowid
