from __future__ import annotations
import json, sqlite3
import pytest
from scripts.wine_knowledge import pairing_schema, collections_schema, collections_seed


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)       # creates the base collections table
    collections_schema.migrate(c)   # + category_group / sort_order columns
    yield c
    c.close()


ALLOWED_KEYS = {"country","region","subregion","class","designation","body","acidity","tannin","price"}
# Collection groups = the 10 canonical CATEGORY_GROUPS PLUS curation-only
# pseudo-groups (cross-category themes that aren't a product category, e.g.
# classification tiers). Keep this in sync with the seed's group values.
CATEGORY_GROUPS = {"Wine","Whisky","Spirits","Sake & Asian","Liqueur",
                   "Beer & RTD","Non-Alcoholic","Cigars","Events","Accessories"}
CURATION_GROUPS = {"Iconic & Classified"}
VALID_GROUPS = CATEGORY_GROUPS | CURATION_GROUPS


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


# --- group + sort_order (Tasks 2/3) ---

def test_every_seed_has_a_valid_group():
    assert len(collections_seed.COLLECTIONS) >= 28
    for c in collections_seed.COLLECTIONS:
        assert c.get("group") in VALID_GROUPS, f"{c['slug']} bad group {c.get('group')!r}"


def test_seed_writes_group_column(conn):
    collections_seed.seed(conn)
    rows = conn.execute("SELECT slug, category_group FROM collections").fetchall()
    assert rows
    assert all(g in VALID_GROUPS for _, g in rows)


def test_export_carries_group_and_sorts(conn):
    from scripts import export_collections
    collections_seed.seed(conn)
    data = export_collections.build(conn)
    assert all("group" in c for c in data)
    assert {c["group"] for c in data} >= {"Iconic & Classified", "Wine", "Whisky", "Sake & Asian", "Spirits"}
    # sorted by (sort_order, slug): Iconic (0-9) before Wine (10+) before Spirits (50+)
    orders = [c.get("sortOrder", 999) for c in data]
    assert orders == sorted(orders)


def test_iconic_classified_collections_are_designation_driven_and_first(conn):
    """The classification-tier collections use the `designation` filter key
    (Grand Cru/DOCG/XO/Single Malt…) and their group sorts ABOVE the category
    sections so 'Iconic & Classified' renders first on the landing."""
    from scripts import export_collections
    collections_seed.seed(conn)
    data = export_collections.build(conn)
    iconic = [c for c in data if c["group"] == "Iconic & Classified"]
    assert len(iconic) >= 10
    # every iconic collection filters on designation
    assert all("designation" in c["filter"] for c in iconic), \
        [c["slug"] for c in iconic if "designation" not in c["filter"]]
    # and NONE uses grape/variety/category (§7 + Rule 12 still hold)
    for c in iconic:
        keys = set(c["filter"])
        assert not (keys & {"grape", "variety", "category"})
    # Iconic sorts strictly before every non-Iconic collection (contiguous, first)
    iconic_max = max(c["sortOrder"] for c in iconic)
    others_min = min((c["sortOrder"] for c in data if c["group"] != "Iconic & Classified"), default=999)
    assert iconic_max < others_min
