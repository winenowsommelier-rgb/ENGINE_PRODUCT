import sys; sys.path.insert(0, ".")
from scripts.onboard_new_products import parse_money, pct_str, recompute_margins

def test_parse_money():
    assert parse_money("650") == 650.0
    assert parse_money("1,250.00") == 1250.0
    assert parse_money("฿880") == 880.0
    assert parse_money("") is None
    assert parse_money("-") is None
    assert parse_money("N/A") is None
    assert parse_money("abc") is None

def test_pct_str():
    # Production stores pct cols as a BARE 2-decimal percent number stored as
    # TEXT (e.g. '31.43', '30.0'), NOT 'NN%' and NOT '0.27'. Verified against
    # data/db/products.db (3000/3000 rows reproduced). The original spec's
    # '27%'/'8%' assertions were anti-tests vs the live DB (CLAUDE.md Rule 5)
    # and are corrected here; test_recompute_matches_existing_db_row is the
    # regression guard that this format == production.
    assert pct_str(0.27) == "27.0"
    assert pct_str(0.075) == "7.5"
    assert pct_str(None) is None

def test_recompute_margins_basic():
    m = recompute_margins(cost=480.0, price=700.0, special_price=None, b2b_price=None)
    assert m["margin_thb"] == 220.0
    assert m["margin_pct"] == "31.43"   # (700-480)/700 = 31.4285…% -> 31.43
    assert m["sp_discount_pct"] is None
    assert m["b2b_margin_thb"] is None

def test_recompute_margins_full():
    m = recompute_margins(cost=450.0, price=600.0, special_price=540.0, b2b_price=520.0)
    assert m["margin_thb"] == 150.0
    assert m["margin_pct"] == "25.0"        # (600-450)/600 = 25%
    assert m["sp_discount_pct"] == "10.0"   # (600-540)/600 = 10%
    assert m["b2b_margin_thb"] == 70.0
    assert m["b2b_margin_pct"] == "13.46"   # (520-450)/520 = 13.4615…% -> 13.46

def test_recompute_margins_guards_zero_price():
    m = recompute_margins(cost=10.0, price=0.0, special_price=None, b2b_price=None)
    assert m["margin_pct"] is None

def test_recompute_negative_margin_shape():
    m = recompute_margins(cost=700.0, price=600.0, special_price=None, b2b_price=None)
    assert m["margin_thb"] == -100.0
    assert m["margin_pct"] == "-16.67"   # (600-700)/600 = -16.666…% -> -16.67

def test_recompute_matches_existing_db_row():
    """Our recompute must reproduce an existing row's stored margin_pct, so the
    later price-import reuse inherits the SAME rounding as production."""
    import sqlite3, pytest
    from pathlib import Path
    db = Path("data/db/products.db")
    if not db.exists():
        pytest.skip("live db absent")
    row = sqlite3.connect(db).execute(
        "SELECT cost, price, margin_pct FROM products "
        "WHERE cost IS NOT NULL AND price IS NOT NULL AND margin_pct IS NOT NULL "
        "AND cost < price LIMIT 1").fetchone()
    if not row:
        pytest.skip("no comparable row")
    cost, price, stored = row
    got = recompute_margins(cost=cost, price=price, special_price=None, b2b_price=None)["margin_pct"]
    assert got == stored, f"rounding mismatch vs production: recompute {got} != stored {stored}"


def test_b2b_discount_matches_existing_db_row():
    """b2b_discount_pct must reproduce production's 1-decimal format (not 2dp)."""
    import sqlite3, pytest
    from pathlib import Path
    db = Path("data/db/products.db")
    if not db.exists():
        pytest.skip("live db absent")
    # find a row with a clean 1-decimal b2b_discount_pct that the formula reproduces
    rows = sqlite3.connect(db).execute(
        "SELECT price, b2b_price, b2b_discount_pct FROM products "
        "WHERE b2b_discount_pct IS NOT NULL AND b2b_discount_pct!='' "
        "AND price>0 AND b2b_price IS NOT NULL LIMIT 200").fetchall()
    checked = 0
    for price, b2b, stored in rows:
        got = recompute_margins(cost=1.0, price=price, special_price=None, b2b_price=b2b)["b2b_discount_pct"]
        if got == str(stored):
            checked += 1
    # the 1-decimal formula should match the large majority (allow rounding-edge residual)
    assert checked >= len(rows) * 0.9, f"only {checked}/{len(rows)} b2b_discount_pct matched production format"

def test_b2b_discount_is_one_decimal():
    m = recompute_margins(cost=1.0, price=700.0, special_price=None, b2b_price=620.0)
    # (700-620)/700 = 11.428...% -> 1dp -> '11.4'
    assert m["b2b_discount_pct"] == "11.4"
    # 2-decimal pct fields stay 2dp: (620-1)/620 = 99.8387...% -> 2dp -> '99.84'
    assert m["b2b_margin_pct"] == "99.84"


def test_select_new_beverages():
    from scripts.onboard_new_products import select_candidates
    import pytest
    from pathlib import Path
    if not Path("data/db/products.db").exists():
        pytest.skip("live db absent")
    cands, report = select_candidates(
        db_path="data/db/products.db",
        csv_path="/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv")
    assert 450 <= len(cands) <= 540, f"unexpected candidate count {len(cands)}"
    for c in cands:
        assert c["sku"] and c["price"] and c["cost"]
        assert c["id"] == f"onboard-{c['sku']}"
        assert c["currency"] == "THB" and c["is_in_stock"] == "1"
        assert c["classification"] is None
    for k in ("n","unknown_prefix","price_parse_failures","negative_margin",
              "missing_cost_or_price","dup_skus","type_distribution"):
        assert k in report
    # any Unknown-type sku is reported, NOT in candidates
    assert all(x not in [c["sku"] for c in cands] for x in report["unknown_prefix"])
    # composition: beverage types present, accessory types absent
    dist = report["type_distribution"]
    assert dist.get("Red Wine", 0) > 50
    for acc in ("Glassware","Bar Tools & Gifts","Wine Coolers & Fridges"):
        assert acc not in dist

def test_dry_run_writes_nothing(tmp_path):
    import subprocess, sys, shutil, sqlite3
    from pathlib import Path
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    before_n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    before_mtime = db.stat().st_mtime
    r = subprocess.run([sys.executable, "scripts/onboard_new_products.py",
                        "--db", str(db), "--dry-run"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    after_n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert after_n == before_n and db.stat().st_mtime == before_mtime, "dry-run touched the DB"
