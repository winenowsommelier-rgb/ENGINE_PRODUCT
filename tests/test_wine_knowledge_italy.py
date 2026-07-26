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


def test_piedmont_context_grapes_and_tier(conn):
    from scripts.wine_knowledge.italy import grapes, tiers, piedmont
    grapes.load(conn); tiers.load(conn); piedmont.load(conn)
    rid = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='piedmont'").fetchone()[0]
    ctx = conn.execute("SELECT status, source_citation FROM taxonomy_contexts "
        "WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
    assert ctx[0]=='validated' and ctx[1]
    grown = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships "
        "WHERE to_entity_id=? AND relationship='grown_in'", (rid,)).fetchone()[0]
    assert grown >= 2
    docg = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='italy-docg'").fetchone()[0]
    classified = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships "
        "WHERE from_entity_id=? AND to_entity_id=? AND relationship='classified_under'",
        (rid, docg)).fetchone()[0]
    assert classified == 1
    # citation invariant holds across the whole DB
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_super_tuscan_style_and_relationships(conn):
    from scripts.wine_knowledge.italy import grapes, tiers, tuscany
    grapes.load(conn); tiers.load(conn); tuscany.load(conn)
    st = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='style' AND slug='super-tuscan'").fetchone()
    assert st, "Super Tuscan style entity must exist"
    tus = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='tuscany'").fetchone()[0]
    produces = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
        "AND to_entity_id=? AND relationship='produces_style'", (tus, st[0])).fetchone()[0]
    assert produces == 1
    sang = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='sangiovese'").fetchone()[0]
    exhibits = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
        "AND to_entity_id=? AND relationship='exhibits_style'", (sang, st[0])).fetchone()[0]
    assert exhibits == 1
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_veneto_context_and_grapes(conn):
    from scripts.wine_knowledge.italy import grapes, tiers, veneto
    grapes.load(conn); tiers.load(conn); veneto.load(conn)
    vid = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='veneto'").fetchone()[0]
    ctx = conn.execute("SELECT status, source_citation FROM taxonomy_contexts "
        "WHERE entity_id=? AND scope_id='wine'", (vid,)).fetchone()
    assert ctx[0]=='validated' and ctx[1]
    grown = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships "
        "WHERE to_entity_id=? AND relationship='grown_in'", (vid,)).fetchone()[0]
    assert grown >= 2
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_south_islands_contexts_and_flagship_grapes(conn):
    from scripts.wine_knowledge import ingest
    from scripts.wine_knowledge.italy import grapes, south_islands
    grapes.load(conn)
    for name, slug in [("Campania","campania"),("Puglia","puglia"),("Sicily","sicily"),
                       ("Sardinia","sardinia"),("Abruzzo","abruzzo"),("Marche","marche"),
                       ("Friuli-Venezia Giulia","friuli-venezia-giulia")]:
        ingest.upsert_entity(conn, "region", name, slug)
    south_islands.load(conn)
    # each region has a validated cited context
    for slug in ["campania","puglia","sicily","sardinia","abruzzo","marche","friuli-venezia-giulia"]:
        rid = conn.execute("SELECT id FROM taxonomy_entities WHERE slug=?", (slug,)).fetchone()[0]
        ctx = conn.execute("SELECT status, source_citation FROM taxonomy_contexts "
            "WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
        assert ctx and ctx[0]=='validated' and ctx[1], f"missing/uncited context for {slug}"
    # at least the flagship grown_in links exist (>=6; friuli uses pinot-gris)
    total_grown = conn.execute("SELECT COUNT(*) FROM taxonomy_relationships "
        "WHERE relationship='grown_in'").fetchone()[0]
    assert total_grown >= 6
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0
