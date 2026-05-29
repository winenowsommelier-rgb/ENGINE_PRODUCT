import json, pathlib
from lib.curation.hard_filter import hard_filter
from lib.curation.models import StructuredQuery

FIXTURES = pathlib.Path("tests/curation/fixtures/sample_products.json")

def _products():
    return json.loads(FIXTURES.read_text())

def test_filter_in_stock_only():
    q = StructuredQuery(raw_brief="test", in_stock_only=True)
    result = hard_filter(_products(), q)
    assert all(p["is_in_stock"] == "1" for p in result)

def test_filter_category():
    q = StructuredQuery(raw_brief="test", category_filter=["Whisky"])
    result = hard_filter(_products(), q)
    assert all(p["classification"] == "Whisky" for p in result)

def test_filter_country():
    q = StructuredQuery(raw_brief="test", country_filter=["USA"])
    result = hard_filter(_products(), q)
    assert all(p["country"] == "USA" for p in result)

def test_filter_price_range():
    q = StructuredQuery(raw_brief="test", price_min_thb=2000, price_max_thb=3000)
    result = hard_filter(_products(), q)
    assert all(2000 <= p["price"] <= 3000 for p in result)

def test_filter_no_constraints_returns_in_stock_only_by_default():
    q = StructuredQuery(raw_brief="test")
    result = hard_filter(_products(), q)
    assert all(p["is_in_stock"] == "1" for p in result)
