"""Tests for the products.json -> SQLite bootstrap."""
import json
import sqlite3
from pathlib import Path

import pytest

from scripts.seed_sqlite_from_json import seed_products_db

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def sample_products():
    return [
        {"id": "row-1", "sku": "WRW0001", "name": "Test Red", "brand": "Foo",
         "classification": "Red Wine", "country": "France",
         "wine_production_style": ["organic", "sustainable"]},
        {"id": "row-2", "sku": "WSP0002", "name": "Test Sparkling", "brand": "Bar",
         "classification": "Sparkling Wine"},
    ]


def test_seed_creates_rows(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert count == 2


def test_seed_encodes_list_columns_as_json(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT wine_production_style FROM products WHERE sku='WRW0001'").fetchone()
    assert json.loads(row[0]) == ["organic", "sustainable"]


def test_seed_is_idempotent(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)
    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)  # second run

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert count == 2, "second seed should UPSERT, not duplicate"


def test_seed_overwrites_existing_columns_on_re_seed(tmp_path):
    """Re-seeding from products.json only overwrites columns that are present in the
    source JSON record. Columns absent from the source (e.g. wine_body written by a
    downstream enrichment step) are NOT touched by the UPSERT because they never
    appear in the ON CONFLICT … DO UPDATE SET clause.

    Practical implication: re-seeding from products.json is safe to run after
    enrichment has populated wine_body/full_description/etc. — those enrichment
    columns will be preserved as long as they are not also present in products.json.
    Catalog fields that ARE in products.json (name, country, …) will be refreshed
    to their source-of-truth values.
    """
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    source = [{"id": "row-1", "sku": "WRW0001", "name": "Original", "country": "France"}]
    products_json.write_text(json.dumps(source))

    # Step 1: initial seed
    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    # Step 2: simulate downstream enrichment writing wine_body
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE products SET wine_body='Full-Bodied' WHERE sku='WRW0001'")
    conn.commit()
    conn.close()

    # Step 3: re-seed from the same source JSON (no wine_body field present)
    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    # Step 4: wine_body should be PRESERVED — absent from source JSON so not in SET clause
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT wine_body, name FROM products WHERE sku='WRW0001'"
    ).fetchone()
    conn.close()

    assert row[0] == "Full-Bodied", (
        "wine_body was not in source JSON so UPSERT should NOT have overwritten it"
    )
    assert row[1] == "Original", "catalog field from source JSON should be refreshed correctly"
