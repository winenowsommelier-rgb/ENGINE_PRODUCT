import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIT = REPO_ROOT / "scripts" / "audit_wine_keys.py"


def _make_products_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE products (
        sku TEXT PRIMARY KEY, name TEXT, custom_stock_status TEXT
    )""")
    conn.execute("CREATE TABLE critic_scores (id TEXT PRIMARY KEY, sku TEXT)")
    conn.execute("INSERT INTO products VALUES ('WRW0001','Sassicaia 2020', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0002','Sassicaia 2021', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0003','Other Wine 2019', 'CATALOG')")
    conn.execute("INSERT INTO critic_scores VALUES ('c1','WRW0001')")
    conn.execute("INSERT INTO critic_scores VALUES ('c2','WRW0002')")
    conn.execute("INSERT INTO critic_scores VALUES ('c3','WRW0003')")
    conn.commit()
    return db


def test_audit_groups_by_wine_key_and_excludes_archived(tmp_path):
    db = _make_products_db(tmp_path)
    out = tmp_path / "audit.json"
    subprocess.run(
        [sys.executable, str(AUDIT), "--db", str(db), "--out", str(out)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(out.read_text())
    assert data["in_stock_critic_scored_count"] == 2  # WRW0003 is CATALOG-archived
    keys = {g["wine_key"]: g["skus"] for g in data["groups"]}
    sassicaia = keys["sassicaia"]
    assert [e["sku"] for e in sassicaia] == ["WRW0001", "WRW0002"]
    # Names must be present so a human can eyeball the group without a
    # separate SKU lookup.
    assert {e["name"] for e in sassicaia} == {"Sassicaia 2020", "Sassicaia 2021"}
    assert data["multi_vintage_family_count"] == 1


def _make_format_token_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE products (
        sku TEXT PRIMARY KEY, name TEXT, custom_stock_status TEXT
    )""")
    conn.execute("CREATE TABLE critic_scores (id TEXT PRIMARY KEY, sku TEXT)")
    # False-merge risk: "Imperial" is a stripped format token, but here it's
    # plausibly part of a proper-noun/cuvee edition name, not a bottle size.
    # After stripping, "Chateau Imperial Tokaji" and "Chateau Tokaji" both
    # collapse to the same wine_key ("chateau-tokaji") -- exactly the false
    # merge the reviewer flagged.
    conn.execute("INSERT INTO products VALUES ('WRW0101','Chateau Imperial Tokaji 2018', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0102','Chateau Tokaji 2019', NULL)")
    conn.execute("INSERT INTO critic_scores VALUES ('c101','WRW0101')")
    conn.execute("INSERT INTO critic_scores VALUES ('c102','WRW0102')")
    # Normal multi-vintage group, no format tokens anywhere in the names.
    conn.execute("INSERT INTO products VALUES ('WRW0103','Sassicaia 2020', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0104','Sassicaia 2021', NULL)")
    conn.execute("INSERT INTO critic_scores VALUES ('c103','WRW0103')")
    conn.execute("INSERT INTO critic_scores VALUES ('c104','WRW0104')")
    conn.commit()
    return db


def test_flags_small_groups_with_stripped_format_token_for_review(tmp_path):
    db = _make_format_token_db(tmp_path)
    out = tmp_path / "audit.json"
    subprocess.run(
        [sys.executable, str(AUDIT), "--db", str(db), "--out", str(out)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(out.read_text())

    def _sku_set(entry):
        return {e["sku"] for e in entry["skus"]}

    imperial_group = next(
        f for f in data["flagged_for_review"]
        if _sku_set(f) == {"WRW0101", "WRW0102"}
    )
    assert "format-size token" in imperial_group["reason"] or "format" in imperial_group["reason"]

    # Names must be present alongside SKUs -- this is the whole point of the
    # flag: a human needs to read the actual product names to judge whether
    # "Chateau Imperial Tokaji" and "Chateau Tokaji" are really the same wine.
    names_in_imperial_group = {e["name"] for e in imperial_group["skus"]}
    assert names_in_imperial_group == {
        "Chateau Imperial Tokaji 2018",
        "Chateau Tokaji 2019",
    }

    # The Sassicaia group has no format token in its names and must NOT be flagged.
    flagged_sku_sets = [_sku_set(f) for f in data["flagged_for_review"]]
    assert {"WRW0103", "WRW0104"} not in flagged_sku_sets
