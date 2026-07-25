from scripts.wine_knowledge import vocab


import sqlite3
import pytest
from scripts.wine_knowledge import ingest, schema

_FIXTURE_DDL = """
  CREATE TABLE scopes (id TEXT PRIMARY KEY, label TEXT);
  INSERT INTO scopes VALUES ('wine','Wine');
  CREATE TABLE taxonomy_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
    name TEXT NOT NULL, slug TEXT NOT NULL, parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(entity_type, slug));
  CREATE TABLE taxonomy_contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL,
    scope_id TEXT NOT NULL, description_short TEXT, description_en TEXT,
    attributes TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
    UNIQUE(entity_id, scope_id));
  CREATE TABLE taxonomy_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, context_id INTEGER NOT NULL,
    dimension_id TEXT NOT NULL, typical_value REAL NOT NULL,
    range_low REAL, range_high REAL, UNIQUE(context_id, dimension_id));
  CREATE TABLE character_dimensions (
    id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, dimension_key TEXT NOT NULL);
  INSERT INTO character_dimensions VALUES ('wine.body','wine','body');
  CREATE TABLE taxonomy_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
    scope_id TEXT, metadata TEXT DEFAULT '{}',
    UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
"""


@pytest.fixture
def db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_FIXTURE_DDL)
    c.commit()
    yield c
    c.close()


def test_upsert_entity_is_idempotent(db):
    schema.migrate(db)
    id1 = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    id2 = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    assert id1 == id2


def test_validated_context_requires_citation(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    with pytest.raises(ValueError, match="source_citation"):
        ingest.upsert_context(db, eid, "wine", short="x", full="y",
                              status="validated", source_citation=None)


def test_draft_context_allows_missing_citation(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    cid = ingest.upsert_context(db, eid, "wine", short="x", full="y",
                                status="draft", source_citation=None)
    assert cid > 0


def test_vocabulary_matches_spec_exactly():
    # The six §4.5 verbs, no more, no less.
    assert set(vocab.RELATIONSHIP_VERBS) == {
        "grown_in", "produces_style", "exhibits_style",
        "sub_appellation_of", "classified_under", "outranks",
    }


def test_every_verb_has_a_canonical_direction():
    # DIRECTION maps verb -> (from_types, to_types); every verb present.
    for verb in vocab.RELATIONSHIP_VERBS:
        assert verb in vocab.DIRECTION
        frm, to = vocab.DIRECTION[verb]
        assert frm and to


def test_add_relationship_rejects_unknown_verb(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    with pytest.raises(ValueError, match="verb"):
        ingest.add_relationship(db, g, r, "is_grown_in")  # ad-hoc synonym


def test_add_relationship_rejects_wrong_direction(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    # grown_in must be grape_variety -> region, not region -> grape_variety
    with pytest.raises(ValueError, match="direction"):
        ingest.add_relationship(db, r, g, "grown_in")


def test_add_relationship_happy_path(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    rid = ingest.add_relationship(db, g, r, "grown_in")
    assert rid > 0
