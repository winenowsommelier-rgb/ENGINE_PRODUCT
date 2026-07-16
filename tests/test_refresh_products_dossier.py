import json
import sqlite3
from pathlib import Path

import pytest

from scripts.refresh_products_dossier import derive_curation_dossier, refresh_all


def _make_dbs(tmp_path):
    products_db = tmp_path / "products.db"
    dossier_db = tmp_path / "dossier.db"

    pconn = sqlite3.connect(products_db)
    pconn.execute("CREATE TABLE products (sku TEXT PRIMARY KEY, curation_dossier TEXT)")
    pconn.execute("INSERT INTO products (sku) VALUES ('WRW0001')")
    pconn.execute("INSERT INTO products (sku) VALUES ('WRW0002')")
    pconn.commit()
    pconn.close()

    dconn = sqlite3.connect(dossier_db)
    dconn.execute("""CREATE TABLE wine_dossier (
        wine_key TEXT PRIMARY KEY, style_summary TEXT, expert_note TEXT,
        signature_pairings_json TEXT, provenance_json TEXT, suppressed INTEGER DEFAULT 0
    )""")
    dconn.execute("""CREATE TABLE sku_dossier_overlay (
        sku TEXT PRIMARY KEY, wine_key TEXT,
        stock_snapshot_json TEXT, honors_json TEXT
    )""")
    dconn.execute("""
        INSERT INTO wine_dossier VALUES (
            'sassicaia', 'A Super Tuscan icon', 'Sourced expert note text',
            '[{"dish":"Steak","cuisine":"thai","confidence":"sourced"}]',
            '{"style_summary":{"confidence":"model","source_urls":[]},
              "expert_note":{"confidence":"sourced","source_urls":["https://x.com"]}}',
            0
        )
    """)
    dconn.execute("INSERT INTO sku_dossier_overlay (sku, wine_key, stock_snapshot_json) "
                  "VALUES ('WRW0001', 'sassicaia', '{\"price\": 5000}')")
    dconn.commit()
    dconn.close()
    return products_db, dossier_db


def test_public_export_suppresses_model_confidence_fields(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    assert dossier_json is not None
    parsed = json.loads(dossier_json)
    # style_summary is 'model' confidence -> suppressed from public export
    assert "style_summary" not in parsed or parsed.get("style_summary") is None
    assert parsed["expert_note"] == "Sourced expert note text"


def test_stock_snapshot_never_in_public_export(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    parsed = json.loads(dossier_json)
    assert "stock_snapshot_json" not in parsed
    assert "price" not in json.dumps(parsed)


def test_refresh_all_writes_products_curation_dossier_column(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    written = refresh_all(conn)
    assert written == 1  # only WRW0001 has an overlay row
    row = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0001'").fetchone()
    assert row[0] is not None
    row2 = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0002'").fetchone()
    assert row2[0] is None  # no overlay row -> stays NULL, not fabricated
