"""Unit tests for the Plan-3b (Spain/USA/Australia/Chile) chapter loaders.

NOTE (the lesson that cost the Italy task an hour): `schema.migrate` ONLY
ALTERs — it adds the citation/confidence columns but does NOT create the base
tables. So the fixture MUST create them first. `_DDL` below is copied verbatim
from tests/test_wine_knowledge_italy.py.
"""
from __future__ import annotations
import json
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.new_world import _helpers, tiers

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

# Regions each country loader expects to already exist (they mirror the live
# taxonomy skeleton — the loaders RAISE rather than blind-create).
_REGIONS = {
    "spain": ["Rioja", "Ribera del Duero", "Jerez", "Priorat", "Rías Baixas",
              "Catalunya"],
    "usa": ["California", "Napa", "Sonoma County", "Washington", "Oregon",
            "Willamette Valley"],
    "australia": ["South Australia", "South Eastern Australia", "Barossa Valley",
                  "Clare Valley", "Coonawarra", "McLaren Vale", "Adelaide Hills",
                  "Margaret River", "Victoria", "Yarra", "Hunter"],
    "chile": ["Central Valley", "Colchagua Valley", "Maipo Valley",
              "Casablanca Valley", "Aconcagua Valley", "Maule",
              "Cachapoal Valley"],
}

# Grapes the loaders link that come from EARLIER plans (1/2/3), not from
# new_world/grapes.py. If any of these is missing the loaders raise.
_PREEXISTING_GRAPES = [
    ("Tempranillo", "tempranillo"), ("Grenache", "grenache"),
    ("Mourvedre", "mourvedre"), ("Albarino", "albarino"),
    ("Cabernet Sauvignon", "cabernet-sauvignon"), ("Chardonnay", "chardonnay"),
    ("Merlot", "merlot"), ("Syrah", "syrah"), ("Pinot Noir", "pinot-noir"),
    ("Zinfandel", "zinfandel"), ("Riesling", "riesling"),
    ("Sauvignon Blanc", "sauvignon-blanc"), ("Semillon", "semillon"),
    ("Pinot Gris", "pinot-gris"), ("Muscat", "muscat"),
]


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    for country, regions in _REGIONS.items():
        cid = ingest.upsert_entity(c, "country", country.title(), country)
        for r in regions:
            slug = r.lower().replace(" ", "-").replace("í", "i").replace("á", "a")
            ingest.upsert_entity(c, "region", r, slug, parent_id=cid)
    for name, slug in _PREEXISTING_GRAPES:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit()
    yield c
    c.close()


@pytest.fixture
def loaded(conn):
    """Full pipeline in the runner's required order."""
    from scripts.wine_knowledge.new_world import grapes, spain, usa, australia, chile
    grapes.load(conn)
    tiers.load(conn)
    spain.load(conn)
    usa.load(conn)
    australia.load(conn)
    chile.load(conn)
    return conn


# --------------------------------------------------------------- helpers
def test_find_tier_raises_before_tiers_load(conn):
    with pytest.raises(ValueError, match="run tiers.load"):
        _helpers.find_tier(conn, tiers.DOCA_SLUG)


def test_find_grape_resolves_and_raises(conn):
    assert _helpers.find_grape(conn, "tempranillo") > 0
    with pytest.raises(ValueError):
        _helpers.find_grape(conn, "no-such-grape")


# ---------------------------------------------------------------- grapes
def test_grapes_load_creates_four_entities(conn):
    from scripts.wine_knowledge.new_world import grapes
    grapes.load(conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug IN ('carmenere','petite-sirah','palomino','pais')").fetchone()[0]
    assert n == 4


def test_synonyms_do_not_create_duplicate_grape_entities(conn):
    """garnacha/monastrell/shiraz must NOT become their own entities — they map
    onto grenache/mourvedre/syrah. A duplicate would fork the grown_in graph."""
    from scripts.wine_knowledge.new_world import grapes
    grapes.load(conn)
    for synonym in grapes.SYNONYM_TO_SLUG:
        row = conn.execute(
            "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
            "AND slug=?", (synonym,)).fetchone()
        assert row is None, f"{synonym} was created as a duplicate entity"
    # and every synonym target must actually resolve
    for target in grapes.SYNONYM_TO_SLUG.values():
        assert _helpers.find_grape(conn, target) > 0


def test_honest_sparse_benchmarks(conn):
    """palomino and país get NO benchmark (the book makes no structural claim);
    carmenere and petite-sirah do."""
    from scripts.wine_knowledge.new_world import grapes
    grapes.load(conn)

    def bench_count(slug):
        return conn.execute(
            "SELECT COUNT(*) FROM taxonomy_benchmarks b "
            "JOIN taxonomy_contexts c ON c.id=b.context_id "
            "JOIN taxonomy_entities e ON e.id=c.entity_id WHERE e.slug=?",
            (slug,)).fetchone()[0]

    assert bench_count("palomino") == 0
    assert bench_count("pais") == 0
    assert bench_count("carmenere") > 0
    assert bench_count("petite-sirah") > 0


# ----------------------------------------------------------------- tiers
def test_spain_place_ladder_outranks(conn):
    tiers.load(conn)
    row = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships r "
        "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
        "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
        "WHERE r.relationship='outranks' AND f.slug=? AND t.slug=?",
        (tiers.DOCA_SLUG, tiers.DO_SLUG)).fetchone()[0]
    assert row == 1


def test_spain_aging_ladder_is_adjacent_only(conn):
    """Gran Reserva -> Reserva -> Crianza, with NO transitive shortcut."""
    tiers.load(conn)

    def edge(a, b):
        return conn.execute(
            "SELECT COUNT(*) FROM taxonomy_relationships r "
            "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.relationship='outranks' AND f.slug=? AND t.slug=?",
            (a, b)).fetchone()[0]

    assert edge(tiers.GRAN_RESERVA_SLUG, tiers.RESERVA_SLUG) == 1
    assert edge(tiers.RESERVA_SLUG, tiers.CRIANZA_SLUG) == 1
    # the transitive shortcut must NOT be authored
    assert edge(tiers.GRAN_RESERVA_SLUG, tiers.CRIANZA_SLUG) == 0


def test_place_and_aging_ladders_are_not_joined(conn):
    """The two ladders measure different axes — no edge may connect them."""
    tiers.load(conn)
    place = {tiers.DOCA_SLUG, tiers.DO_SLUG}
    aging = {tiers.GRAN_RESERVA_SLUG, tiers.RESERVA_SLUG, tiers.CRIANZA_SLUG}
    rows = conn.execute(
        "SELECT f.slug, t.slug FROM taxonomy_relationships r "
        "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
        "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
        "WHERE r.relationship='outranks'").fetchall()
    for a, b in rows:
        assert not (a in place and b in aging), f"cross-ladder edge {a}->{b}"
        assert not (a in aging and b in place), f"cross-ladder edge {a}->{b}"


def test_unranked_tiers_have_no_outranks_edge(conn):
    """AVA and Chile DO are single-level by design — the absence IS the data."""
    tiers.load(conn)
    for slug in (tiers.AVA_SLUG, tiers.CHILE_DO_SLUG):
        n = conn.execute(
            "SELECT COUNT(*) FROM taxonomy_relationships r "
            "JOIN taxonomy_entities e ON e.id IN (r.from_entity_id, r.to_entity_id) "
            "WHERE r.relationship='outranks' AND e.slug=?", (slug,)).fetchone()[0]
        assert n == 0, f"{slug} must not participate in an outranks ladder"


def test_no_australia_gi_tier_is_invented(conn):
    """The book never documents Australia's GI system, so no entity exists."""
    tiers.load(conn)
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug LIKE 'australia%'").fetchone()
    assert row is None


# ------------------------------------------------------------ region load
def test_all_country_loaders_run(loaded):
    n = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated'"
    ).fetchone()[0]
    # 4 grapes + 7 tiers + 31 regions
    assert n >= 40


def test_every_validated_context_has_a_citation(loaded):
    """The invariant the whole graph rests on (spec 4.2/8)."""
    bad = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_no_legacy_marker_survives_in_loaded_regions(loaded):
    """Plan-3b regions must carry a real book citation, not a legacy marker."""
    bad = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts "
        "WHERE status='validated' AND source_citation LIKE 'legacy:%'"
    ).fetchone()[0]
    assert bad == 0


def test_australia_regions_have_no_tier_link(loaded):
    """No GI system in the book => no classified_under edge for Australia."""
    for name in _REGIONS["australia"]:
        rid = _helpers.find_region(loaded, name)
        n = loaded.execute(
            "SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
            "AND relationship='classified_under'", (rid,)).fetchone()[0]
        assert n == 0, f"{name} must not be classified_under any tier"


def test_rioja_and_priorat_are_doca_others_are_do(loaded):
    def tier_slugs(region):
        rid = _helpers.find_region(loaded, region)
        return {r[0] for r in loaded.execute(
            "SELECT t.slug FROM taxonomy_relationships r "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.from_entity_id=? AND r.relationship='classified_under'",
            (rid,)).fetchall()}

    assert tier_slugs("Rioja") == {tiers.DOCA_SLUG}
    assert tier_slugs("Priorat") == {tiers.DOCA_SLUG}
    assert tier_slugs("Ribera del Duero") == {tiers.DO_SLUG}
    assert tier_slugs("Jerez") == {tiers.DO_SLUG}


def test_no_region_is_classified_under_an_aging_tier(loaded):
    """A region is not a gran reserva — gran reservas are 1-10% of production."""
    aging = (tiers.GRAN_RESERVA_SLUG, tiers.RESERVA_SLUG, tiers.CRIANZA_SLUG)
    n = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships r "
        "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
        f"WHERE r.relationship='classified_under' AND t.slug IN ({','.join('?' * 3)})",
        aging).fetchone()[0]
    assert n == 0


def test_usa_and_chile_regions_link_their_unranked_tier(loaded):
    for name in ("Napa", "California", "Washington"):
        rid = _helpers.find_region(loaded, name)
        got = {r[0] for r in loaded.execute(
            "SELECT t.slug FROM taxonomy_relationships r "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.from_entity_id=? AND r.relationship='classified_under'",
            (rid,)).fetchall()}
        assert got == {tiers.AVA_SLUG}
    for name in ("Maipo Valley", "Central Valley"):
        rid = _helpers.find_region(loaded, name)
        got = {r[0] for r in loaded.execute(
            "SELECT t.slug FROM taxonomy_relationships r "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.from_entity_id=? AND r.relationship='classified_under'",
            (rid,)).fetchall()}
        assert got == {tiers.CHILE_DO_SLUG}


def test_shiraz_regions_link_syrah_entity(loaded):
    """Barossa's shiraz must resolve to the EXISTING syrah entity."""
    rid = _helpers.find_region(loaded, "Barossa Valley")
    slugs = {r[0] for r in loaded.execute(
        "SELECT g.slug FROM taxonomy_relationships r "
        "JOIN taxonomy_entities g ON g.id=r.from_entity_id "
        "WHERE r.to_entity_id=? AND r.relationship='grown_in'", (rid,)).fetchall()}
    assert "syrah" in slugs
    assert "shiraz" not in slugs


def test_benchmarks_stay_on_the_1_to_5_gauge(loaded):
    rows = loaded.execute(
        "SELECT dimension_id, typical_value, range_low, range_high "
        "FROM taxonomy_benchmarks").fetchall()
    assert rows
    for dim, typical, low, high in rows:
        assert dim in ("wine.body", "wine.acidity", "wine.tannin")
        for v in (typical, low, high):
            if v is not None:
                assert 1.0 <= v <= 5.0, f"{dim} value {v} off the 1-5 gauge"
        if low is not None and high is not None:
            assert low <= typical <= high


def test_region_attributes_are_valid_json(loaded):
    rows = loaded.execute(
        "SELECT attributes FROM taxonomy_contexts WHERE status='validated'"
    ).fetchall()
    for (attrs,) in rows:
        assert isinstance(json.loads(attrs), dict)


def test_loaders_are_idempotent(loaded):
    """Re-running must not duplicate entities, contexts or relationships."""
    from scripts.wine_knowledge.new_world import grapes, spain, usa, australia, chile

    def counts():
        return tuple(loaded.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                     for t in ("taxonomy_entities", "taxonomy_contexts",
                               "taxonomy_relationships", "taxonomy_benchmarks"))

    before = counts()
    grapes.load(loaded)
    tiers.load(loaded)
    spain.load(loaded)
    usa.load(loaded)
    australia.load(loaded)
    chile.load(loaded)
    assert counts() == before


def test_south_eastern_australia_is_documented_as_a_blend_designation(loaded):
    """The 171-SKU catch-all must be described honestly, not given a fake
    terroir. It also must carry NO benchmark — the wine could be from anywhere."""
    rid = _helpers.find_region(loaded, "South Eastern Australia")
    ctx_id, attrs = loaded.execute(
        "SELECT id, attributes FROM taxonomy_contexts WHERE entity_id=? "
        "AND scope_id='wine'", (rid,)).fetchone()
    parsed = json.loads(attrs)
    assert "designation_type" in parsed
    n = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_benchmarks WHERE context_id=?",
        (ctx_id,)).fetchone()[0]
    assert n == 0
