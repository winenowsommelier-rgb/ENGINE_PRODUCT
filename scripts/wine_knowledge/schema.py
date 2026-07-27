"""Idempotent migration for the wine-knowledge ingestion effort.

Adds source_citation + confidence to taxonomy_contexts and
taxonomy_benchmarks (spec §4.2). entity_type is free-text in the DDL, so
the three new types (grape_variety/style/classification_tier) need no DDL
change — see vocab.NEW_ENTITY_TYPES. Idempotent because the shared DB can
revert between turns.
"""
from __future__ import annotations

import sqlite3

# Legacy validated contexts predate the citation regime (153 rows from the
# explore-map effort — 93 wine / 52 spirits / 4 sake / 4 accessories). We do
# NOT retroactively pretend they came from a book; we mark them honestly so the
# citation invariant can enforce "no NULL citation on validated rows" without
# either failing on legacy data or silently exempting it.
LEGACY_CITATION = "legacy:pre-wine-knowledge (uncited explore-map seed)"


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def _add_column_if_missing(conn, table, col, decl):
    if not _has_column(conn, table, col):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def migrate(conn: sqlite3.Connection) -> None:
    for table in ("taxonomy_contexts", "taxonomy_benchmarks"):
        _add_column_if_missing(conn, table, "source_citation", "TEXT")
        _add_column_if_missing(conn, table, "confidence", "TEXT")
    # Backfill legacy validated contexts with the explicit legacy marker.
    conn.execute(
        "UPDATE taxonomy_contexts SET source_citation=? "
        "WHERE status='validated' AND (source_citation IS NULL OR source_citation='')",
        (LEGACY_CITATION,))
    conn.commit()
