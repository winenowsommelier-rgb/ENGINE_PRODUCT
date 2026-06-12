#!/usr/bin/env python3
"""
Regenerates all files in docs/ai-knowledge-base/ from data/live_products_export.json.
Run this after any bulk enrichment or database update.
"""
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'data', 'live_products_export.json')
OUT  = os.path.join(ROOT, 'docs', 'ai-knowledge-base')

KEEP = [
    'sku', 'name', 'brand', 'classification', 'wine_classification', 'wine_color',
    'country', 'region', 'subregion', 'appellation',
    'grape_variety', 'vintage', 'alcohol', 'bottle_size', 'price',
    'wine_body', 'wine_acidity', 'wine_tannin',
    'flavor_tags', 'food_matching', 'pairing_rationale',
    'desc_en_short', 'full_description', 'taste_profile',
    'score_max', 'score_summary',
    'enrichment_source', 'validation_status',
]

GROUP_MAP = {
    'Red Wine':           None,          # handled with country split
    'White Wine':         None,          # handled with country split
    'Rose Wine':          'wines_rose',
    'Orange Wine':        'wines_rose',
    'Champagne':          'wines_sparkling',
    'Sparkling Wine':     'wines_sparkling',
    'Dessert Wine':       'wines_other',
    'Port Wine':          'wines_other',
    'Fruit Wine':         'wines_other',
    'Wine product':       'wines_other',
    'Wine':               'wines_other',
    'Sake/Shochu':        'sake_shochu',
    'Sake':               'sake_shochu',
    'Umeshu':             'sake_shochu',
    'Whisky':             'spirits_whisky',
    'Whiskey':            'spirits_whisky',
    'Gin':                'spirits_gin_vodka',
    'Vodka':              'spirits_gin_vodka',
    'White Spirits':      'spirits_gin_vodka',
    'Thai White Spirits': 'spirits_gin_vodka',
    'Rum':                'spirits_rum_tequila',
    'Tequila':            'spirits_rum_tequila',
    'Mezcal':             'spirits_rum_tequila',
    'Cachaça':            'spirits_rum_tequila',
    'Pisco':              'spirits_rum_tequila',
    'Brandy':             'spirits_brandy_liqueur',
    'Cognac':             'spirits_brandy_liqueur',
    'Calvados':           'spirits_brandy_liqueur',
    'Liqueur':            'spirits_brandy_liqueur',
    'Baijiu':             'spirits_brandy_liqueur',
    'Absinthe':           'spirits_brandy_liqueur',
    'Spirit':             'spirits_brandy_liqueur',
    'Beer':               'beer',
    'Non-Alcoholic':      'non_alcoholic',
    'Korean Wine':        'other_products',
    'Ready to Drink':     'other_products',
    'Events':             'other_products',
    'Cigar':              'other_products',
    'Glassware':          'other_products',
    'Accessories':        'other_products',
    'Others':             'other_products',
}


def clean(item):
    record = {}
    for k in KEEP:
        v = item.get(k)
        if v not in (None, '', [], 'null'):
            record[k] = v
    record['classification'] = item.get('classification', '')
    return record


def write_json(path, records, description=''):
    payload = {
        'file': os.path.basename(path),
        'description': description,
        'product_count': len(records),
        'products': records,
    }
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(path, 'w') as f:
        f.write(content)
    print(f"  {os.path.basename(path):50s}  {len(records):>5} products  {len(content)//1024:>5}KB")
    return len(content)


def main():
    os.makedirs(OUT, exist_ok=True)

    print(f"Loading {SRC} ...")
    with open(SRC) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get('products', data.get('items', []))
    print(f"  {len(items):,} products loaded\n")

    # --- product_index.md ---
    print("Generating product_index.md ...")
    bev_order = [
        'Red Wine','White Wine','Rose Wine','Champagne','Sparkling Wine','Dessert Wine',
        'Port Wine','Orange Wine','Fruit Wine','Wine product','Wine',
        'Sake/Shochu','Sake','Umeshu',
        'Whisky','Whiskey','Gin','Vodka','Rum','Tequila','Mezcal','Brandy','Cognac',
        'Calvados','Liqueur','Beer','Non-Alcoholic','Cigar','Glassware','Accessories','Others',
    ]
    by_class = defaultdict(list)
    for item in items:
        by_class[item.get('classification', 'Others')].append(item)
    sorted_classes = sorted(by_class.keys(), key=lambda x: bev_order.index(x) if x in bev_order else 999)

    lines = [
        "# WN/LIQ9 Product Index",
        f"Total products: {len(items)}",
        "",
        "Scan this index to find matching SKUs, then look up full detail in the category JSON file.",
        "Columns: SKU | Name | Country | Region | Grape/Style | Body | Vintage | Price (THB)",
        "",
        "---",
        "",
    ]
    for cls in sorted_classes:
        prods = by_class[cls]
        lines.append(f"## {cls} ({len(prods)} products)")
        lines.append("")
        lines.append("| SKU | Name | Country | Region | Grape/Style | Body | Vintage | Price |")
        lines.append("|-----|------|---------|--------|-------------|------|---------|-------|")
        for p in sorted(prods, key=lambda x: x.get('name', '')):
            name    = (p.get('name', '') or '').replace('|', '/')[:55]
            grape   = (p.get('grape_variety', '') or '')[:35]
            price   = p.get('price', '')
            price_s = f"{price:,.0f}" if isinstance(price, (int, float)) else str(price or '')
            lines.append(
                f"| {p.get('sku','')} | {name} | {p.get('country','')} | "
                f"{p.get('region','')} | {grape} | {p.get('wine_body','')} | "
                f"{p.get('vintage','')} | {price_s} |"
            )
        lines.append("")

    idx_path = os.path.join(OUT, 'product_index.md')
    with open(idx_path, 'w') as f:
        f.write('\n'.join(lines))
    print(f"  product_index.md  {len(lines)} lines  {os.path.getsize(idx_path)//1024}KB")

    # --- product_index_compact.tsv ---
    tsv_lines = ["SKU\tName\tClass\tCountry\tRegion\tGrape\tBody\tVintage\tPrice"]
    for p in sorted(items, key=lambda x: (x.get('classification',''), x.get('name',''))):
        tsv_lines.append('\t'.join([
            p.get('sku', ''),
            (p.get('name', '') or '').replace('\t', ' ')[:55],
            p.get('classification', '') or '',
            p.get('country', '') or '',
            p.get('region', '') or '',
            (p.get('grape_variety', '') or '')[:35],
            p.get('wine_body', '') or '',
            p.get('vintage', '') or '',
            str(p.get('price', '') or ''),
        ]))
    tsv_path = os.path.join(OUT, 'product_index_compact.tsv')
    with open(tsv_path, 'w') as f:
        f.write('\n'.join(tsv_lines))
    print(f"  product_index_compact.tsv  {len(tsv_lines)} rows  {os.path.getsize(tsv_path)//1024}KB")

    print()

    # --- category JSON files ---
    print("Generating category JSON files ...")
    groups = defaultdict(list)
    for item in items:
        cls = item.get('classification', 'Others')
        group = GROUP_MAP.get(cls)
        if group is None:
            # handled separately below
            continue
        groups[group].append(clean(item))

    total_bytes = 0
    for group, records in sorted(groups.items()):
        path = os.path.join(OUT, f'products_{group}.json')
        total_bytes += write_json(path, records, f"{group.replace('_',' ')} ({len(records)} products)")

    # Red wine — split by country
    red = [clean(i) for i in items if i.get('classification') == 'Red Wine']
    for suffix, country_filter in [
        ('wines_red_france', lambda c: c == 'France'),
        ('wines_red_italy',  lambda c: c == 'Italy'),
        ('wines_red_world',  lambda c: c not in ('France', 'Italy')),
    ]:
        subset = [r for r in red if country_filter(r.get('country', ''))]
        path = os.path.join(OUT, f'products_{suffix}.json')
        total_bytes += write_json(path, subset, f"Red wine — {suffix.split('_')[-1].title()}")

    # White wine — split by country
    white = [clean(i) for i in items if i.get('classification') == 'White Wine']
    for suffix, country_filter in [
        ('wines_white_france', lambda c: c == 'France'),
        ('wines_white_world',  lambda c: c != 'France'),
    ]:
        subset = [r for r in white if country_filter(r.get('country', ''))]
        path = os.path.join(OUT, f'products_{suffix}.json')
        total_bytes += write_json(path, subset, f"White wine — {suffix.split('_')[-1].title()}")

    print(f"\nTotal output: {total_bytes // (1024*1024):.1f}MB across {OUT}")
    print("Done.")


if __name__ == '__main__':
    main()
