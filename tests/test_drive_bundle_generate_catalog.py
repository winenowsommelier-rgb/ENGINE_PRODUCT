import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.export_ai_knowledge_base import generate


def test_generate_drops_no_record_and_uses_stems(tmp_path):
    items = [
        {'sku': 'A', 'category_group': 'Wine', 'category_type': 'Red Wine', 'country': 'France', 'name': 'RA'},
        {'sku': 'B', 'category_group': 'Whisky', 'name': 'WB'},
        {'sku': 'C', 'category_group': '', 'classification': 'Mineral Water', 'name': 'MC'},  # -> unknown
    ]
    generate(items, str(tmp_path))
    seen = set()
    for path in glob.glob(str(tmp_path / 'products_*.json')):
        payload = json.load(open(path))
        for p in payload['products']:
            seen.add(p['sku'])
    assert seen == {'A', 'B', 'C'}  # zero dropped, incl. the blank-group one
    assert os.path.exists(tmp_path / 'products_unknown.json')  # catch-all written
    assert os.path.exists(tmp_path / 'products_wine_red_france.json')
