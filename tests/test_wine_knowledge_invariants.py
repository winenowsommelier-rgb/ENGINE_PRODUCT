import sqlite3
from pathlib import Path

import pytest

from scripts.wine_knowledge import schema

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def db(tmp_path):
    """A minimal taxonomy.db-shaped fixture DB (not the live one)."""
    p = tmp_path / "taxonomy.db"
    c = sqlite3.connect(p)
    c.executescript("""
        CREATE TABLE scopes (id TEXT PRIMARY KEY, label TEXT);
        INSERT INTO scopes VALUES ('wine','Wine');
        CREATE TABLE taxonomy_entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
          name TEXT NOT NULL, slug TEXT NOT NULL, parent_id INTEGER,
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(entity_type, slug));
        CREATE TABLE taxonomy_contexts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL,
          scope_id TEXT NOT NULL, description_short TEXT, description_en TEXT,
          attributes TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
          UNIQUE(entity_id, scope_id));
        CREATE TABLE taxonomy_benchmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, context_id INTEGER NOT NULL,
          dimension_id TEXT NOT NULL, typical_value REAL NOT NULL,
          range_low REAL, range_high REAL,
          UNIQUE(context_id, dimension_id));
        CREATE TABLE character_dimensions (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, dimension_key TEXT NOT NULL);
        INSERT INTO character_dimensions VALUES ('wine.body','wine','body');
        CREATE TABLE taxonomy_relationships (
          id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
          to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
          scope_id TEXT, metadata TEXT DEFAULT '{}',
          UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
    """)
    c.commit()
    yield c
    c.close()


def _cols(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_adds_citation_columns(db):
    schema.migrate(db)
    assert "source_citation" in _cols(db, "taxonomy_contexts")
    assert "confidence" in _cols(db, "taxonomy_contexts")
    assert "source_citation" in _cols(db, "taxonomy_benchmarks")
    assert "confidence" in _cols(db, "taxonomy_benchmarks")


def test_migration_is_idempotent(db):
    schema.migrate(db)
    schema.migrate(db)  # must not raise "duplicate column"
    assert "source_citation" in _cols(db, "taxonomy_contexts")


def test_migration_backfills_legacy_validated_citations(db):
    # A validated context with no citation existed BEFORE the citation regime.
    eid = db.execute(
        "INSERT INTO taxonomy_entities (entity_type,name,slug) "
        "VALUES ('region','Legacy','legacy')").lastrowid
    db.execute(
        "INSERT INTO taxonomy_contexts (entity_id,scope_id,status) "
        "VALUES (?, 'wine', 'validated')", (eid,))
    db.commit()
    schema.migrate(db)
    cite = db.execute(
        "SELECT source_citation FROM taxonomy_contexts WHERE entity_id=?",
        (eid,)).fetchone()[0]
    assert cite == schema.LEGACY_CITATION  # marked, not left NULL, not faked
