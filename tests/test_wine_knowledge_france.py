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


from scripts.wine_knowledge.france import bordeaux


@pytest.fixture
def bordeaux_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    for name, slug in [("Cabernet Sauvignon", "cabernet-sauvignon"),
                       ("Merlot", "merlot"), ("Cabernet Franc", "cabernet-franc"),
                       ("Sauvignon Blanc", "sauvignon-blanc"), ("Sémillon", "semillon")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit(); yield c; c.close()


def test_bordeaux_loads_region_context_with_real_citation(bordeaux_db):
    bordeaux.load(bordeaux_db)
    rid = _helpers.find_region(bordeaux_db, "Bordeaux")
    row = bordeaux_db.execute(
        "SELECT status, source_citation FROM taxonomy_contexts WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
    assert row[0] == "validated"
    assert row[1] and not row[1].startswith("legacy:")


def test_bordeaux_creates_1855_classification_tier(bordeaux_db):
    bordeaux.load(bordeaux_db)
    n = bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'").fetchone()[0]
    assert n >= 1
    rel = bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='classified_under'").fetchone()[0]
    assert rel >= 1


def test_bordeaux_links_grapes(bordeaux_db):
    bordeaux.load(bordeaux_db)
    n = bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n >= 4


def test_bordeaux_is_idempotent(bordeaux_db):
    bordeaux.load(bordeaux_db)
    tiers = bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'").fetchone()[0]
    grown = bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    bordeaux.load(bordeaux_db)
    assert tiers == bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'").fetchone()[0]
    assert grown == bordeaux_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]


from scripts.wine_knowledge.france import burgundy


@pytest.fixture
def burgundy_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Burgundy", "burgundy", parent_id=fr)
    for name, slug in [("Pinot Noir", "pinot-noir"), ("Chardonnay", "chardonnay"), ("Gamay", "gamay")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit(); yield c; c.close()


def test_burgundy_creates_four_tier_ladder(burgundy_db):
    burgundy.load(burgundy_db)
    tiers = {r[0] for r in burgundy_db.execute("SELECT name FROM taxonomy_entities WHERE entity_type='classification_tier'")}
    assert {"Burgundy Grand Cru", "Burgundy Premier Cru", "Burgundy Village", "Burgundy Regional"} <= tiers


def test_burgundy_outranks_chain_uses_the_verb(burgundy_db):
    burgundy.load(burgundy_db)
    n = burgundy_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'").fetchone()[0]
    assert n >= 3


def test_burgundy_outranks_is_tier_to_tier(burgundy_db):
    burgundy.load(burgundy_db)
    rows = burgundy_db.execute('''SELECT ef.entity_type, et.entity_type FROM taxonomy_relationships r
        JOIN taxonomy_entities ef ON ef.id=r.from_entity_id JOIN taxonomy_entities et ON et.id=r.to_entity_id
        WHERE r.relationship='outranks' ''').fetchall()
    assert rows and all(f == "classification_tier" and t == "classification_tier" for f, t in rows)


def test_burgundy_is_idempotent(burgundy_db):
    burgundy.load(burgundy_db); burgundy.load(burgundy_db)
    n = burgundy_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'").fetchone()[0]
    assert n == 3


from scripts.wine_knowledge.france import champagne, rhone


@pytest.fixture
def champagne_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Champagne", "champagne", parent_id=fr)
    for name, slug in [("Chardonnay", "chardonnay"), ("Pinot Noir", "pinot-noir")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit(); yield c; c.close()


@pytest.fixture
def rhone_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Rhône", "rhone", parent_id=fr)
    ingest.upsert_entity(c, "region", "Rhône Valley", "rhone-valley", parent_id=fr)  # duplicate
    for name, slug in [("Syrah", "syrah"), ("Grenache", "grenache"),
                       ("Viognier", "viognier"), ("Mourvèdre", "mourvedre")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit(); yield c; c.close()


def test_champagne_region_context_real_citation(champagne_db):
    champagne.load(champagne_db)
    rid = _helpers.find_region(champagne_db, "Champagne")
    row = champagne_db.execute("SELECT status, source_citation FROM taxonomy_contexts WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
    assert row[0] == "validated" and row[1] and not row[1].startswith("legacy:")


def test_champagne_links_grapes(champagne_db):
    champagne.load(champagne_db)
    n = champagne_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n >= 2


def test_champagne_idempotent(champagne_db):
    champagne.load(champagne_db); champagne.load(champagne_db)
    n = champagne_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n == 2


def test_rhone_targets_canonical_region(rhone_db):
    rhone.load(rhone_db)
    # canonical Rhône (lower id) got the context, not a third entity created
    rid = _helpers.find_region(rhone_db, "Rhône")
    row = rhone_db.execute("SELECT status, source_citation FROM taxonomy_contexts WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
    assert row and row[0] == "validated" and not row[1].startswith("legacy:")
    # still exactly 2 region entities named like Rhône (no third created)
    n_regions = rhone_db.execute("SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='region' AND name LIKE 'Rh%'").fetchone()[0]
    assert n_regions == 2


def test_rhone_links_four_grapes(rhone_db):
    rhone.load(rhone_db)
    n = rhone_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n >= 4


def test_rhone_idempotent(rhone_db):
    rhone.load(rhone_db); rhone.load(rhone_db)
    n = rhone_db.execute("SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
    assert n == 4
