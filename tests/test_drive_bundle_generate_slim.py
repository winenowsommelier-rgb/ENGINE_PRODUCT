import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.export_ai_knowledge_base_slim import generate_slim, generate_notebooklm


def test_slim_groups_by_stem_zero_drop(tmp_path):
    items = [
        {'sku': 'A', 'category_group': 'Wine', 'category_type': 'White Wine', 'country': 'France', 'name': 'WA'},
        {'sku': 'B', 'category_group': 'Spirits', 'category_type': 'Gin', 'name': 'GB'},
        {'sku': 'C', 'category_group': '', 'name': 'UC'},  # unknown
    ]
    generate_slim(items, str(tmp_path))
    seen = set()
    for f in glob.glob(str(tmp_path / 'products_*.json')):
        for p in json.load(open(f))['products']:
            seen.add(p['sku'])
    assert seen == {'A', 'B', 'C'}
    assert os.path.exists(tmp_path / 'products_wine_white_france.json')


def test_notebooklm_writes_txt_zero_drop(tmp_path):
    items = [{'sku': 'A', 'category_group': 'Whisky', 'name': 'WA'},
             {'sku': 'B', 'category_group': '', 'name': 'UB'}]
    generate_notebooklm(items, str(tmp_path))
    txt = ''.join(open(f).read() for f in glob.glob(str(tmp_path / 'products_*.txt')))
    assert 'A' in txt and 'B' in txt
    assert os.path.exists(tmp_path / 'products_unknown.txt')
