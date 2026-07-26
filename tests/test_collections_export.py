from __future__ import annotations
import json, sqlite3
import pytest
from scripts.wine_knowledge import pairing_schema, collections_seed


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)   # creates the collections table
    yield c
    c.close()


ALLOWED_KEYS = {"country","region","subregion","class","body","acidity","tannin","price"}


def test_seed_inserts_collections_with_valid_json(conn):
    collections_seed.seed(conn)
    rows = conn.execute("SELECT slug, filter_definition FROM collections").fetchall()
    assert len(rows) >= 6
    for slug, fdef in rows:
        parsed = json.loads(fdef)
        assert isinstance(parsed, dict) and parsed


def test_seed_is_idempotent(conn):
    collections_seed.seed(conn); collections_seed.seed(conn)
    n = conn.execute("SELECT COUNT(*) FROM collections WHERE slug='bordeaux-reds'").fetchone()[0]
    assert n == 1


def test_no_grape_or_variety_filters(conn):
    collections_seed.seed(conn)
    for (fdef,) in conn.execute("SELECT filter_definition FROM collections"):
        keys = set(json.loads(fdef).keys())
        assert "variety" not in keys and "grape" not in keys
        assert "category" not in keys, "use `class`, not `category`"
        assert keys <= ALLOWED_KEYS, f"disallowed keys: {keys - ALLOWED_KEYS}"


def test_export_shape_and_allowlist(conn):
    from scripts import export_collections
    collections_seed.seed(conn)
    data = export_collections.build(conn)
    assert isinstance(data, list) and len(data) >= 6
    for c in data:
        assert set(c) >= {"slug","name","description","filter"}
        assert isinstance(c["filter"], dict)
        assert set(c["filter"].keys()) <= ALLOWED_KEYS


def test_export_drops_disallowed_keys(conn):
    from scripts import export_collections
    # insert a row with a disallowed key directly
    conn.execute("INSERT INTO collections(slug,name,filter_definition,description) "
        "VALUES('x','X',?,'')", (json.dumps({"region":"Tuscany","grape":"sangiovese","category":"Red Wine"}),))
    conn.commit()
    data = export_collections.build(conn)
    row = [c for c in data if c["slug"]=="x"][0]
    assert set(row["filter"].keys()) == {"region"}  # grape + category dropped
