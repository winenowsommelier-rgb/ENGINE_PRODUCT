import json
import sqlite3

import pytest


@pytest.fixture
def taxonomy_dir(tmp_path):
    docs = {
        "countries.json": {
            "data": [{"id": 1, "name": "France", "iso": "FR"}]
        },
        "regions.json": {
            "data": [
                {"id": 10, "country_id": 1, "name": "Cognac"},
                {"id": 11, "country_id": 1, "name": "Bordeaux"},
            ]
        },
        "subregions.json": {
            "data": [
                {
                    "id": 100,
                    "region_id": 10,
                    "name": "Grande Champagne",
                },
                {"id": 101, "region_id": 11, "name": "Pauillac"},
            ]
        },
        "geography-aliases.json": {
            "schema_version": 1,
            "country": [
                {"alias": "French Republic", "canonical": "France"}
            ],
            "region": [],
            "subregion": [],
        },
    }
    for name, document in docs.items():
        (tmp_path / name).write_text(
            json.dumps(document), encoding="utf-8"
        )
    return tmp_path


@pytest.fixture
def products_db(tmp_path):
    path = tmp_path / "products.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE products (
          id TEXT PRIMARY KEY, sku TEXT UNIQUE, name TEXT,
          classification TEXT, country TEXT, region TEXT, subregion TEXT,
          is_active INTEGER, has_recent_sales INTEGER,
          popularity_revenue_90d REAL, popularity_orders_90d INTEGER,
          wn_stock INTEGER, quantity_in_stock INTEGER,
          enrichment_source TEXT, enrichment_note TEXT, updated_at TEXT
        );
        """
    )
    conn.close()
    return path
