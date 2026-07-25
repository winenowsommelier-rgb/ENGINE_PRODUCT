import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.france import _helpers

_DDL = """
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
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    ingest.upsert_entity(c, "region", "Rhône", "rhone", parent_id=fr)
    ingest.upsert_entity(c, "region", "Rhône Valley", "rhone-valley", parent_id=fr)
    ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    c.commit()
    yield c
    c.close()


def test_find_region_returns_existing_canonical_id(db):
    rid = _helpers.find_region(db, "Bordeaux")
    got = db.execute("SELECT name FROM taxonomy_entities WHERE id=?", (rid,)).fetchone()[0]
    assert got == "Bordeaux"


def test_find_region_prefers_lowest_id_on_duplicates(db):
    rid = _helpers.find_region(db, "Rhône")
    dup = db.execute("SELECT id FROM taxonomy_entities WHERE name='Rhône Valley'").fetchone()[0]
    assert rid < dup


def test_find_region_raises_when_absent(db):
    with pytest.raises(ValueError, match="region not found"):
        _helpers.find_region(db, "Nonexistent")


def test_link_grape_adds_grown_in(db):
    rid = _helpers.find_region(db, "Bordeaux")
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    n = db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n == 1


def test_link_grape_is_idempotent(db):
    rid = _helpers.find_region(db, "Bordeaux")
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    n = db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n == 1
