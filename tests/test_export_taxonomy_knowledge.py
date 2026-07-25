import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts import export_taxonomy_knowledge as ex

# same DDL string used in tests/test_wine_knowledge_france.py
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
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    bx = ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    ingest.upsert_context(c, bx, "wine", short="Benchmark red region.",
        full="Bordeaux is the reference point for fine wine.",
        status="validated", source_citation="Wine Bible 2e, France/Bordeaux",
        confidence="high", attributes='{"climate":"maritime","key_grapes":["merlot"]}')
    # a DRAFT spirits context on the same region — must be IGNORED by the export
    ingest.upsert_context(c, bx, "spirits", short="", full="",
        status="draft", source_citation=None, confidence=None, attributes='{}')
    cab = ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    mer = ingest.upsert_entity(c, "grape_variety", "Merlot", "merlot")
    ingest.add_relationship(c, cab, bx, "grown_in")
    ingest.add_relationship(c, mer, bx, "grown_in")
    tier = ingest.upsert_entity(c, "classification_tier", "Bordeaux 1855 First Growth", "bordeaux-1855-first-growth")
    ingest.add_relationship(c, bx, tier, "classified_under")
    c.commit(); yield c; c.close()


def test_export_includes_short_and_full_from_wine_context(db):
    out = ex.build(db)
    assert out["regions"]["bordeaux"]["short"] == "Benchmark red region."
    assert out["regions"]["bordeaux"]["full"].startswith("Bordeaux is the reference")


def test_export_includes_knowledge_grapes_sorted(db):
    out = ex.build(db)
    k = out["regions"]["bordeaux"]["knowledge"]
    assert k["grapes"] == ["Cabernet Sauvignon", "Merlot"]  # sorted display names


def test_export_includes_tiers_and_attributes(db):
    out = ex.build(db)
    k = out["regions"]["bordeaux"]["knowledge"]
    assert k["tiers"] == ["Bordeaux 1855 First Growth"]
    assert k["attributes"]["climate"] == "maritime"


def test_region_without_context_absent(db):
    ingest.upsert_entity(db, "region", "Nowhere", "nowhere")
    out = ex.build(db)
    assert "nowhere" not in out["regions"]


def test_draft_spirits_context_not_used(db):
    # the region's wine context wins; the empty draft spirits context is ignored
    out = ex.build(db)
    assert out["regions"]["bordeaux"]["short"] == "Benchmark red region."  # not the empty spirits one
