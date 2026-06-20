"""Integration test: refresh_live_export.py re-derives flavor_tags_canonical.

Guards the P4 drift risk (Rule 6 invariant): if the export is regenerated from
the DB, the canonical field must be present and correct — not silently dropped.
Hits the real code path: SQLite read -> JSON decode -> canonicalize -> file write.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import scripts.refresh_live_export as refresh


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, flavor_tags TEXT, "
        "is_in_stock TEXT, price REAL)"
    )
    conn.executemany(
        "INSERT INTO products (sku, name, flavor_tags, is_in_stock, price) VALUES (?,?,?,?,?)",
        [
            # raw flavor_tags stored JSON-encoded, as the real DB does
            ("A1", "Wine A", json.dumps(["Vanilla oak", "Cassis"]), "1", 500.0),
            ("A2", "Wine B", json.dumps(["Subtle oak", "Graphite"]), "1", 800.0),
            ("A3", "Vodka", json.dumps(["clean spirit", "mild ethanol"]), "1", 300.0),
            ("A4", "No tags", None, "1", 200.0),
            # Recognizable SKU prefix -> resolves to a precise category group.
            ("LWH0001", "Some Whisky", None, "1", 1200.0),
        ],
    )
    conn.commit()
    conn.close()


def test_refresh_writes_canonical_field(tmp_path):
    db = tmp_path / "products.db"
    out = tmp_path / "export.json"
    _make_db(db)

    rc = refresh.main(["--db", str(db), "--out", str(out)])
    assert rc == 0

    records = json.loads(out.read_text())
    by_sku = {r["sku"]: r for r in records}

    # Every record has the field (present even when empty -> can't drift).
    assert all("flavor_tags_canonical" in r for r in records)

    # Mapped correctly, raw tags preserved.
    assert by_sku["A1"]["flavor_tags_canonical"] == ["Vanilla", "Oak", "Blackcurrant"]
    assert by_sku["A1"]["flavor_tags"] == ["Vanilla oak", "Cassis"]
    assert by_sku["A2"]["flavor_tags_canonical"] == ["Oak", "Graphite"]

    # Flavorless spirit and no-tag row -> empty canonical list, no crash.
    assert by_sku["A3"]["flavor_tags_canonical"] == []
    assert by_sku["A4"]["flavor_tags_canonical"] == []


def test_refresh_writes_category_fields(tmp_path):
    """Guards taxonomy drift: every refresh must re-derive category_group /
    category_type from the SKU prefix, so a future regen can't drop them."""
    db = tmp_path / "products.db"
    out = tmp_path / "export.json"
    _make_db(db)

    rc = refresh.main(["--db", str(db), "--out", str(out)])
    assert rc == 0

    records = json.loads(out.read_text())
    by_sku = {r["sku"]: r for r in records}

    # Every record gets a non-empty category_group (present -> can't drift).
    assert all(r.get("category_group") for r in records)
    assert all("category_type" in r for r in records)

    # Recognizable prefix resolves to a precise group.
    assert by_sku["LWH0001"]["category_group"] == "Whisky"
    assert by_sku["LWH0001"]["category_type"] == "Whisky"
