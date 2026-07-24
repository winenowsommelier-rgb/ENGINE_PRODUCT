import sys, os, csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.live_csv import write_live_csvs, INVENTORY_COLS, PRICING_COLS


def test_writes_both_files_with_fixed_columns(tmp_path):
    items = [
        {'sku': 'A', 'name': 'Wine A', 'is_in_stock': '1',
         'custom_stock_status': '', 'wn_stock': '', 'category_group': 'Wine',
         'category_type': 'Red Wine', 'price': 500, 'special_price': 450,
         'sp_discount_pct': 10, 'currency': 'THB'},
    ]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    pri = list(csv.DictReader(open(tmp_path / 'pricing_promotions_live.csv')))
    assert list(inv[0].keys()) == INVENTORY_COLS
    assert list(pri[0].keys()) == PRICING_COLS
    assert inv[0]['sku'] == 'A'
    assert pri[0]['price'] == '500'


def test_magento_product_url_empty_when_absent(tmp_path):
    items = [{'sku': 'A', 'is_in_stock': '1'}]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    assert inv[0]['magento_product_url'] == ''


def test_magento_product_url_flows_through_when_present(tmp_path):
    # Rule 1 guard: when the source column is populated, the URL must actually
    # reach BOTH live feeds — not get silently dropped by a name mismatch.
    url = 'https://th.wine-now.com/catalog/product/view/id/123'
    items = [{'sku': 'A', 'is_in_stock': '1', 'magento_product_url': url}]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    pri = list(csv.DictReader(open(tmp_path / 'pricing_promotions_live.csv')))
    assert inv[0]['magento_product_url'] == url
    assert pri[0]['magento_product_url'] == url


def test_row_count_matches_input(tmp_path):
    items = [{'sku': str(i), 'is_in_stock': '1'} for i in range(50)]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    assert len(inv) == 50
