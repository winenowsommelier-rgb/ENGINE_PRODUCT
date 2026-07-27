"""Unit tests for the Plan-3c (Argentina/NZ/Germany/Portugal/Austria) loaders.

NOTE: `schema.migrate` ONLY ALTERs — it adds the citation/confidence columns
but does NOT create the base tables, so the fixture must create them first.
`_DDL` is copied verbatim from tests/test_wine_knowledge_italy.py.
"""
from __future__ import annotations
import json
import re
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.rest_of_world import _helpers, tiers, regions

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

_REGIONS = {
    "argentina": ["Mendoza"],
    "new-zealand": ["Marlborough", "Central Otago", "Hawke's Bay",
                    "Martinborough"],
    "germany": ["Mosel", "Rheingau", "Pfalz", "Rheinhessen"],
    "portugal": ["Douro", "Dão"],
    "austria": ["Wachau", "Kamptal"],
}

# Grapes the loaders link that come from EARLIER plans, not rest_of_world.
_PREEXISTING_GRAPES = [
    ("Malbec", "malbec"), ("Cabernet Sauvignon", "cabernet-sauvignon"),
    ("Chardonnay", "chardonnay"), ("Sauvignon Blanc", "sauvignon-blanc"),
    ("Pinot Noir", "pinot-noir"), ("Riesling", "riesling"),
    ("Merlot", "merlot"), ("Syrah", "syrah"),
    ("Gruner Veltliner", "gruner-veltliner"),
]


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    for country, region_names in _REGIONS.items():
        cid = ingest.upsert_entity(c, "country", country.title(), country)
        for r in region_names:
            slug = (r.lower().replace(" ", "-").replace("'", "")
                    .replace("ã", "a"))
            ingest.upsert_entity(c, "region", r, slug, parent_id=cid)
    for name, slug in _PREEXISTING_GRAPES:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit()
    yield c
    c.close()


@pytest.fixture
def loaded(conn):
    from scripts.wine_knowledge.rest_of_world import grapes
    grapes.load(conn)
    tiers.load(conn)
    regions.load(conn)
    return conn


# ---------------------------------------------------------------- grapes
def test_grapes_load_creates_five_entities(conn):
    from scripts.wine_knowledge.rest_of_world import grapes
    grapes.load(conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug IN ('torrontes','blaufrankisch','zweigelt','touriga-nacional',"
        "'silvaner')").fetchone()[0]
    assert n == 5


def test_welschriesling_is_not_aliased_to_riesling(conn):
    """The book is explicit: welschriesling is NOT riesling but the Croatian
    grape graševina. It must not be created, nor aliased onto riesling."""
    from scripts.wine_knowledge.rest_of_world import grapes
    grapes.load(conn)
    assert "welschriesling" in grapes.FALSE_FRIENDS
    assert "welschriesling" not in grapes.SYNONYM_TO_SLUG
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug='welschriesling'").fetchone()
    assert row is None


def test_sylvaner_synonym_does_not_duplicate_silvaner(conn):
    from scripts.wine_knowledge.rest_of_world import grapes
    grapes.load(conn)
    assert grapes.SYNONYM_TO_SLUG["sylvaner"] == "silvaner"
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug='sylvaner'").fetchone()
    assert row is None
    assert _helpers.find_grape(conn, "silvaner") > 0


def test_only_touriga_gets_a_structural_benchmark(conn):
    """Honest-sparse: only touriga nacional carries an explicit structural
    claim ('a commanding tannic structure')."""
    from scripts.wine_knowledge.rest_of_world import grapes
    grapes.load(conn)

    def bench_count(slug):
        return conn.execute(
            "SELECT COUNT(*) FROM taxonomy_benchmarks b "
            "JOIN taxonomy_contexts c ON c.id=b.context_id "
            "JOIN taxonomy_entities e ON e.id=c.entity_id WHERE e.slug=?",
            (slug,)).fetchone()[0]

    assert bench_count("touriga-nacional") > 0
    for slug in ("torrontes", "blaufrankisch", "zweigelt", "silvaner"):
        assert bench_count(slug) == 0


# ----------------------------------------------------------------- tiers
def test_pradikat_ladder_is_five_adjacent_rungs(conn):
    tiers.load(conn)

    def edge(a, b):
        return conn.execute(
            "SELECT COUNT(*) FROM taxonomy_relationships r "
            "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.relationship='outranks' AND f.slug=? AND t.slug=?",
            (a, b)).fetchone()[0]

    assert edge(tiers.TBA_SLUG, tiers.BA_SLUG) == 1
    assert edge(tiers.BA_SLUG, tiers.AUSLESE_SLUG) == 1
    assert edge(tiers.AUSLESE_SLUG, tiers.SPATLESE_SLUG) == 1
    assert edge(tiers.SPATLESE_SLUG, tiers.KABINETT_SLUG) == 1
    # no transitive shortcuts
    assert edge(tiers.TBA_SLUG, tiers.KABINETT_SLUG) == 0
    assert edge(tiers.TBA_SLUG, tiers.AUSLESE_SLUG) == 0


def test_wachau_ladder_is_three_adjacent_rungs(conn):
    tiers.load(conn)

    def edge(a, b):
        return conn.execute(
            "SELECT COUNT(*) FROM taxonomy_relationships r "
            "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
            "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
            "WHERE r.relationship='outranks' AND f.slug=? AND t.slug=?",
            (a, b)).fetchone()[0]

    assert edge(tiers.SMARAGD_SLUG, tiers.FEDERSPIEL_SLUG) == 1
    assert edge(tiers.FEDERSPIEL_SLUG, tiers.STEINFEDER_SLUG) == 1
    assert edge(tiers.SMARAGD_SLUG, tiers.STEINFEDER_SLUG) == 0


def test_eiswein_is_outside_the_pradikat_ladder(conn):
    """Eiswein is defined by a harvest method (frozen on the vine), not by a
    ripeness rung, so it must carry NO outranks edge in either direction."""
    tiers.load(conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships r "
        "JOIN taxonomy_entities e ON e.id IN (r.from_entity_id, r.to_entity_id) "
        "WHERE r.relationship='outranks' AND e.slug=?",
        (tiers.EISWEIN_SLUG,)).fetchone()[0]
    assert n == 0


def test_vdp_is_a_separate_system_not_a_rung(conn):
    tiers.load(conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships r "
        "JOIN taxonomy_entities e ON e.id IN (r.from_entity_id, r.to_entity_id) "
        "WHERE r.relationship='outranks' AND e.slug=?",
        (tiers.VDP_SLUG,)).fetchone()[0]
    assert n == 0


def test_pradikat_and_wachau_ladders_are_not_joined(conn):
    """A German Kabinett and a Wachau Steinfeder are not comparable rungs."""
    tiers.load(conn)
    pradikat = {tiers.KABINETT_SLUG, tiers.SPATLESE_SLUG, tiers.AUSLESE_SLUG,
                tiers.BA_SLUG, tiers.TBA_SLUG}
    wachau = {tiers.SMARAGD_SLUG, tiers.FEDERSPIEL_SLUG, tiers.STEINFEDER_SLUG}
    rows = conn.execute(
        "SELECT f.slug, t.slug FROM taxonomy_relationships r "
        "JOIN taxonomy_entities f ON f.id=r.from_entity_id "
        "JOIN taxonomy_entities t ON t.id=r.to_entity_id "
        "WHERE r.relationship='outranks'").fetchall()
    for a, b in rows:
        assert not (a in pradikat and b in wachau), f"cross-ladder {a}->{b}"
        assert not (a in wachau and b in pradikat), f"cross-ladder {a}->{b}"


# ----------------------------------------------------------------- regions
def test_all_regions_load_with_citations(loaded):
    for names in _REGIONS.values():
        for name in names:
            rid = _helpers.find_region(loaded, name)
            row = loaded.execute(
                "SELECT status, source_citation FROM taxonomy_contexts "
                "WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
            assert row is not None, f"{name} has no wine context"
            assert row[0] == "validated"
            assert row[1] and not row[1].startswith("legacy:")


def test_every_validated_context_has_a_citation(loaded):
    bad = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_no_region_is_classified_under_any_tier(loaded):
    """Every Plan-3c tier is a property of a WINE (ripeness/alcohol), not of a
    place, so no region may carry a classified_under edge."""
    n = loaded.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships r "
        "JOIN taxonomy_entities e ON e.id=r.from_entity_id "
        "WHERE r.relationship='classified_under' AND e.entity_type='region'"
    ).fetchone()[0]
    assert n == 0


def test_low_sku_regions_carry_no_benchmark_and_a_sourcing_note(loaded):
    """no-inferred-item-level-data: a region with <=3 in-stock SKUs must not
    carry structural benchmarks that would read as claims about those few
    specific bottles, and must flag that limitation in its attributes."""
    for name in regions.LOW_SKU_REGIONS:
        rid = _helpers.find_region(loaded, name)
        ctx_id, attrs = loaded.execute(
            "SELECT id, attributes FROM taxonomy_contexts WHERE entity_id=? "
            "AND scope_id='wine'", (rid,)).fetchone()
        n = loaded.execute(
            "SELECT COUNT(*) FROM taxonomy_benchmarks WHERE context_id=?",
            (ctx_id,)).fetchone()[0]
        assert n == 0, f"{name} is a low-SKU region and must carry no benchmark"
        assert "sourcing_note" in json.loads(attrs), (
            f"{name} must flag its low-SKU sourcing limitation")


def test_low_sku_region_copy_avoids_sensory_language(loaded):
    """Guards the exact failure the rule was written for: taxonomy copy that
    reads as a tasting note for the one or two bottles behind it."""
    sensory = re.compile(
        r"\b(palate|finish|aroma|bouquet|tastes?|flavou?rs? of|notes? of|"
        r"silky|velvety|lush|juicy|creamy|zesty|crisp|tannic)\b", re.I)
    for name in regions.LOW_SKU_REGIONS:
        rid = _helpers.find_region(loaded, name)
        short, full = loaded.execute(
            "SELECT description_short, description_en FROM taxonomy_contexts "
            "WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
        for field, text in (("short", short), ("full", full)):
            hit = sensory.search(text or "")
            assert hit is None, (
                f"{name} {field} contains sensory language {hit.group(0)!r} — "
                "low-SKU regions must stay on verifiable geography")


def test_benchmarks_stay_on_the_1_to_5_gauge(loaded):
    rows = loaded.execute(
        "SELECT dimension_id, typical_value, range_low, range_high "
        "FROM taxonomy_benchmarks").fetchall()
    assert rows
    for dim, typical, low, high in rows:
        assert dim in ("wine.body", "wine.acidity", "wine.tannin")
        for v in (typical, low, high):
            if v is not None:
                assert 1.0 <= v <= 5.0
        if low is not None and high is not None:
            assert low <= typical <= high


def test_mosel_is_lighter_and_sharper_than_rheingau(loaded):
    """The book draws this contrast explicitly; the benchmarks must reflect it
    rather than giving two neighbouring riesling regions identical numbers."""
    def bench(region, dim):
        rid = _helpers.find_region(loaded, region)
        return loaded.execute(
            "SELECT b.typical_value FROM taxonomy_benchmarks b "
            "JOIN taxonomy_contexts c ON c.id=b.context_id "
            "WHERE c.entity_id=? AND b.dimension_id=?", (rid, dim)).fetchone()[0]

    assert bench("Mosel", "wine.body") < bench("Rheingau", "wine.body")
    assert bench("Mosel", "wine.acidity") > bench("Rheingau", "wine.acidity")


def test_mendoza_malbec_is_soft_not_tannic(loaded):
    """The book contrasts Argentine malbec ('remarkably soft') with Cahors côt
    ('extremely hard, sleek, and tannic'). Tannin must be modest."""
    rid = _helpers.find_region(loaded, "Mendoza")
    tannin = loaded.execute(
        "SELECT b.typical_value FROM taxonomy_benchmarks b "
        "JOIN taxonomy_contexts c ON c.id=b.context_id "
        "WHERE c.entity_id=? AND b.dimension_id='wine.tannin'", (rid,)).fetchone()[0]
    assert tannin <= 3.0


def test_region_attributes_are_valid_json(loaded):
    rows = loaded.execute(
        "SELECT attributes FROM taxonomy_contexts WHERE status='validated'"
    ).fetchall()
    for (attrs,) in rows:
        assert isinstance(json.loads(attrs), dict)


def test_loaders_are_idempotent(loaded):
    from scripts.wine_knowledge.rest_of_world import grapes

    def counts():
        return tuple(loaded.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                     for t in ("taxonomy_entities", "taxonomy_contexts",
                               "taxonomy_relationships", "taxonomy_benchmarks"))

    before = counts()
    grapes.load(loaded)
    tiers.load(loaded)
    regions.load(loaded)
    assert counts() == before
