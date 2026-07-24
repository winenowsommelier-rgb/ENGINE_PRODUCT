import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.archive import write_archive_jsonl, ARCHIVE_COLS


def test_writes_one_line_per_record(tmp_path):
    items = [{'sku': str(i), 'name': f'P{i}', 'is_in_stock': '1' if i % 2 else '0',
              'category_group': 'Wine', 'price': i} for i in range(5)]
    path = write_archive_jsonl(items, str(tmp_path))
    lines = open(path).read().strip().splitlines()
    assert len(lines) == 5
    first = json.loads(lines[0])
    assert set(first.keys()) <= set(ARCHIVE_COLS)
    assert first['sku'] == '0'


def test_includes_all_rows_not_just_instock(tmp_path):
    items = [{'sku': 'IN', 'is_in_stock': '1'}, {'sku': 'OUT', 'is_in_stock': '0'}]
    path = write_archive_jsonl(items, str(tmp_path))
    skus = {json.loads(l)['sku'] for l in open(path)}
    assert skus == {'IN', 'OUT'}
