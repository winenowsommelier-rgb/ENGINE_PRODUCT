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
        producer_history TEXT,
        signature_pairings_json TEXT, provenance_json TEXT, suppressed INTEGER DEFAULT 0
    )""")
    dconn.execute("""CREATE TABLE sku_dossier_overlay (
        sku TEXT PRIMARY KEY, wine_key TEXT,
        stock_snapshot_json TEXT, honors_json TEXT
    )""")
    dconn.execute("""
        INSERT INTO wine_dossier VALUES (
            'sassicaia', 'A Super Tuscan icon', 'Sourced expert note text',
            'Sourced producer history text',
            '[{"dish":"Steak","cuisine":"thai","confidence":"sourced"}]',
            '{"style_summary":{"confidence":"model","source_urls":[]},
              "expert_note":{"confidence":"sourced","source_urls":["https://x.com"]},
              "producer_history":{"confidence":"sourced","source_urls":["https://y.com"]}}',
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


def test_producer_history_sourced_passes_through(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    parsed = json.loads(dossier_json)
    # producer_history is 'sourced' confidence in the fixture -> must pass through
    assert parsed["producer_history"] == "Sourced producer history text"


def test_producer_history_model_confidence_suppressed(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    # downgrade producer_history's provenance to 'model' confidence
    conn.execute(
        "UPDATE dossier.wine_dossier SET provenance_json = ? WHERE wine_key = 'sassicaia'",
        (json.dumps({
            "style_summary": {"confidence": "model", "source_urls": []},
            "expert_note": {"confidence": "sourced", "source_urls": ["https://x.com"]},
            "producer_history": {"confidence": "model", "source_urls": []},
        }),),
    )
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    parsed = json.loads(dossier_json)
    assert "producer_history" not in parsed or parsed.get("producer_history") is None


def test_refresh_all_one_malformed_row_does_not_corrupt_other_skus(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)

    # Add a second, healthy overlay/dossier pair for WRW0002
    dconn = sqlite3.connect(dossier_db)
    dconn.execute("""
        INSERT INTO wine_dossier VALUES (
            'goodwine', 'A fine wine', 'Sourced note for good wine', 'Sourced history',
            '[]', '{"expert_note":{"confidence":"sourced","source_urls":[]}}', 0
        )
    """)
    dconn.execute("INSERT INTO sku_dossier_overlay (sku, wine_key) VALUES ('WRW0002', 'goodwine')")
    # Corrupt WRW0001's provenance_json so it can't be parsed
    dconn.execute(
        "UPDATE wine_dossier SET provenance_json = ? WHERE wine_key = 'sassicaia'",
        ("{not valid json!!",),
    )
    dconn.commit()
    dconn.close()

    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")

    # Must not raise despite WRW0001's malformed provenance_json
    written = refresh_all(conn)

    # The good SKU (WRW0002) must still get its correct value written
    row2 = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0002'").fetchone()
    assert row2[0] is not None
    parsed2 = json.loads(row2[0])
    assert parsed2["expert_note"] == "Sourced note for good wine"
    assert written == 1  # only the good SKU counts as written

    # The bad SKU must not be silently nulled out or corrupted -- its prior
    # value (NULL, since it never had one) should be left alone, not
    # fabricated or forced to NULL as a side effect of the crash.
    row1 = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0001'").fetchone()
    assert row1[0] is None
