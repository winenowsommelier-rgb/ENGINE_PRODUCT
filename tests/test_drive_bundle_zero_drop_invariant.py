import sys, os, json, glob, csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.instock import filter_in_stock
from scripts.lib.drive_bundle.live_csv import write_live_csvs
from scripts.export_ai_knowledge_base import generate as gen_catalog
from scripts.export_ai_knowledge_base_slim import generate_slim, generate_notebooklm

EXPORT = os.path.join(os.path.dirname(__file__), '..', 'data', 'live_products_export.json')


def _load_instock():
    data = json.load(open(EXPORT))
    items = data if isinstance(data, list) else data.get('products', [])
    return filter_in_stock(items)


def test_every_instock_sku_in_live_and_exactly_one_file_per_tier(tmp_path):
    instock = _load_instock()
    assert len(instock) > 5000, "sanity: expected thousands of in-stock SKUs"
    expected = {p['sku'] for p in instock}

    # live
    live = tmp_path / 'live'
    write_live_csvs(instock, str(live))
    inv = {r['sku'] for r in csv.DictReader(open(live / 'inventory_live.csv'))}
    assert inv == expected

    # each tier: exactly one file per SKU, zero dropped
    for gen, out, pattern in [
        (gen_catalog,       tmp_path / 'catalog',    'products_*.json'),
        (generate_slim,     tmp_path / 'slim',       'products_*.json'),
        (generate_notebooklm, tmp_path / 'nlm',      'products_*.txt'),
    ]:
        os.makedirs(out, exist_ok=True)
        gen(instock, str(out))
        placement = {}
        for path in glob.glob(str(out / pattern)):
            if path.endswith('.json'):
                skus = [p['sku'] for p in json.load(open(path))['products']]
            else:
                skus = [ln.split('SKU: ', 1)[1].strip()
                        for ln in open(path) if ln.startswith('SKU: ')]
            for s in skus:
                placement.setdefault(s, []).append(os.path.basename(path))
        dropped = expected - set(placement)
        dupes = {s: f for s, f in placement.items() if len(f) > 1}
        assert not dropped, f"{out.name}: {len(dropped)} in-stock SKUs in ZERO files: {list(dropped)[:5]}"
        assert not dupes, f"{out.name}: SKUs in >1 file: {list(dupes.items())[:5]}"


def test_sparkling_file_is_not_empty(tmp_path):
    # Guards the mis-file class of bug the zero-drop test can't catch: a wrong
    # sparkling category_type string routes SKUs to wine_other, leaving
    # products_wine_sparkling.json empty. Spec sizes it at ~448 in-stock.
    instock = _load_instock()
    gen_catalog(instock, str(tmp_path))
    spark = tmp_path / 'products_wine_sparkling.json'
    assert spark.exists(), "no sparkling file — category_type string mismatch?"
    assert len(json.load(open(spark))['products']) > 100, \
        "sparkling file suspiciously small — check SPARKLING_TYPES matches real category_type"
