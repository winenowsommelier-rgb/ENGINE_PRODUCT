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
