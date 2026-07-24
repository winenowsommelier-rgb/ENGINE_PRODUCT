import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.instock import filter_in_stock


def test_keeps_only_string_one():
    items = [
        {'sku': 'A', 'is_in_stock': '1'},
        {'sku': 'B', 'is_in_stock': '0'},
        {'sku': 'C', 'is_in_stock': None},
        {'sku': 'D'},  # missing key
    ]
    out = filter_in_stock(items)
    assert [p['sku'] for p in out] == ['A']


def test_coerces_non_string_one():
    # DB flag is TEXT '1', but be defensive if an int 1 slips in.
    items = [{'sku': 'A', 'is_in_stock': 1}, {'sku': 'B', 'is_in_stock': '1'}]
    out = filter_in_stock(items)
    assert {p['sku'] for p in out} == {'A', 'B'}


def test_archived_but_in_stock_passes():
    # 3 archived (custom_stock_status='CATALOG') SKUs are is_in_stock='1'
    # and MUST pass the filter — not special-cased.
    items = [{'sku': 'A', 'is_in_stock': '1', 'custom_stock_status': 'CATALOG'}]
    out = filter_in_stock(items)
    assert [p['sku'] for p in out] == ['A']
