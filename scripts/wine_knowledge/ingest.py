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


def _entity_type(conn, entity_id: int) -> str:
    row = conn.execute("SELECT entity_type FROM taxonomy_entities WHERE id=?",
                       (entity_id,)).fetchone()
    if not row:
        raise ValueError(f"no entity id={entity_id}")
    return row[0]


def add_relationship(conn, from_id: int, to_id: int, relationship: str,
                     scope_id: Optional[str] = "wine", metadata: str = "{}") -> int:
    if relationship not in vocab.RELATIONSHIP_VERBS:
        raise ValueError(f"unknown relationship verb: {relationship!r}")
    allowed_from, allowed_to = vocab.DIRECTION[relationship]
    ft, tt = _entity_type(conn, from_id), _entity_type(conn, to_id)
    if ft not in allowed_from or tt not in allowed_to:
        raise ValueError(
            f"wrong direction for {relationship}: {ft}->{tt}, "
            f"expected {allowed_from}->{allowed_to}")
    cur = conn.execute(
        "INSERT OR IGNORE INTO taxonomy_relationships "
        "(from_entity_id,to_entity_id,relationship,scope_id,metadata) "
        "VALUES (?,?,?,?,?)", (from_id, to_id, relationship, scope_id, metadata))
    conn.commit()
    if cur.lastrowid:
        return cur.lastrowid
    row = conn.execute(
        "SELECT id FROM taxonomy_relationships WHERE from_entity_id=? AND "
        "to_entity_id=? AND relationship=? AND scope_id IS ?",
        (from_id, to_id, relationship, scope_id)).fetchone()
    return row[0]


def upsert_benchmark(conn, context_id: int, dimension_id: str, *,
                     typical: float, low: Optional[float] = None,
                     high: Optional[float] = None,
                     confidence: Optional[str] = None,
                     source_citation: Optional[str] = None) -> int:
    # benchmarks derived from narrative prose are always sourced (§4.2/§8).
    if not source_citation:
        raise ValueError("benchmark requires a non-null source_citation")
    existing = conn.execute(
        "SELECT id FROM taxonomy_benchmarks WHERE context_id=? AND dimension_id=?",
        (context_id, dimension_id)).fetchone()
    if existing:
        conn.execute(
            "UPDATE taxonomy_benchmarks SET typical_value=?, range_low=?, "
            "range_high=?, confidence=?, source_citation=? WHERE id=?",
            (typical, low, high, confidence, source_citation, existing[0]))
        conn.commit()
        return existing[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_benchmarks (context_id,dimension_id,typical_value,"
        "range_low,range_high,confidence,source_citation) VALUES (?,?,?,?,?,?,?)",
        (context_id, dimension_id, typical, low, high, confidence, source_citation))
    conn.commit()
    return cur.lastrowid


def add_pairing_rule(conn, *, wine_dimension: str, wine_op: str,
                     wine_value: float, food_attribute: str, food_value: str,
                     score: float, rationale: str, source_citation: str,
                     confidence: Optional[str] = None) -> int:
    if not source_citation:
        raise ValueError("pairing rule requires a source_citation")
    cur = conn.execute(
        "INSERT INTO pairing_rules (wine_dimension,wine_op,wine_value,"
        "food_attribute,food_value,score,rationale,source_citation,confidence) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (wine_dimension, wine_op, wine_value, food_attribute, food_value,
         score, rationale, source_citation, confidence))
    conn.commit()
    return cur.lastrowid
