from __future__ import annotations
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.italy import _helpers

# _DDL copied verbatim from tests/test_wine_knowledge_france.py, extended with
# wine.acidity + wine.tannin character_dimensions rows (harmless; the benchmarks
# table has no FK to character_dimensions). This is the shared base fixture that
# ALL later Italy tasks reuse.
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
  INSERT INTO character_dimensions VALUES ('wine.acidity','wine','acidity');
  INSERT INTO character_dimensions VALUES ('wine.tannin','wine','tannin');
  CREATE TABLE taxonomy_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
    scope_id TEXT, metadata TEXT DEFAULT '{}',
    UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
"""


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    it = ingest.upsert_entity(c, "country", "Italy", "italy")
    ingest.upsert_entity(c, "region", "Piedmont", "piedmont", parent_id=it)
    ingest.upsert_entity(c, "region", "Tuscany", "tuscany", parent_id=it)
    ingest.upsert_entity(c, "region", "Veneto", "veneto", parent_id=it)
    ingest.upsert_entity(c, "grape_variety", "Nebbiolo", "nebbiolo")
    ingest.upsert_entity(c, "grape_variety", "Sangiovese", "sangiovese")
    ingest.upsert_entity(c, "grape_variety", "Barbera", "barbera")
    ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    ingest.upsert_entity(c, "grape_variety", "Pinot Gris", "pinot-gris")
    c.commit()
    yield c
    c.close()


def test_find_region_resolves_existing(conn):
    assert _helpers.find_region(conn, "Piedmont") > 0


def test_find_region_raises_on_missing(conn):
    with pytest.raises(ValueError):
        _helpers.find_region(conn, "Nowhere")


def test_find_grape_resolves_and_raises(conn):
    assert _helpers.find_grape(conn, "nebbiolo") > 0
    with pytest.raises(ValueError):
        _helpers.find_grape(conn, "no-such-grape")


def test_grapes_load_creates_entities_with_cited_contexts(conn):
    from scripts.wine_knowledge.italy import grapes
    grapes.load(conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug IN ('primitivo','corvina','garganega','aglianico',"
        "'montepulciano-grape','vermentino','dolcetto','glera','nero-d-avola',"
        "'verdicchio')").fetchone()[0]
    assert n == 10
    bad = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_grapes_load_is_idempotent(conn):
    from scripts.wine_knowledge.italy import grapes
    grapes.load(conn); grapes.load(conn)
    n = conn.execute("SELECT COUNT(*) FROM taxonomy_entities "
                     "WHERE slug='primitivo'").fetchone()[0]
    assert n == 1


def test_tiers_create_docg_outranks_doc(conn):
    from scripts.wine_knowledge.italy import tiers
    tiers.load(conn)
    docg = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='classification_tier' AND slug='italy-docg'").fetchone()
    doc = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='classification_tier' AND slug='italy-doc'").fetchone()
    assert docg and doc
    edge = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
        "AND to_entity_id=? AND relationship='outranks'",
        (docg[0], doc[0])).fetchone()[0]
    assert edge == 1


def test_tiers_load_is_idempotent(conn):
    from scripts.wine_knowledge.italy import tiers
    tiers.load(conn); tiers.load(conn)
    n = conn.execute("SELECT COUNT(*) FROM taxonomy_entities "
                     "WHERE entity_type='classification_tier' "
                     "AND slug IN ('italy-docg','italy-doc')").fetchone()[0]
    assert n == 2
    edges = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships "
                         "WHERE relationship='outranks'").fetchone()[0]
    assert edges == 1
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
                       "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0
