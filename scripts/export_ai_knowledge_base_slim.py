#!/usr/bin/env python3
"""
Generates slim knowledge base files for AI projects with file-size limits.
Two output sets:
  docs/ai-knowledge-base-slim/     — for Claude Projects & ChatGPT Projects
  docs/ai-knowledge-base-notebooklm/ — for Google NotebookLM (plain text, no JSON)

Slim strategy:
- Drop: full_description, taste_profile, enrichment_source, validation_status, bottle_size
- Keep: sku, name, brand, classification, country, region, subregion, appellation,
        grape_variety, vintage, alcohol, price, wine_body, wine_acidity, wine_tannin,
        flavor_tags, food_matching, pairing_rationale, desc_en_short, score_max, score_summary
- NotebookLM: plain text per category (no JSON), one product per block
"""
import json
import os
from collections import defaultdict

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC   = os.path.join(ROOT, 'data', 'live_products_export.json')
SLIM  = os.path.join(ROOT, 'docs', 'ai-knowledge-base-slim')
NLM   = os.path.join(ROOT, 'docs', 'ai-knowledge-base-notebooklm')

KEEP_SLIM = [
    'sku', 'name', 'brand', 'classification', 'wine_color',
    'country', 'region', 'subregion', 'appellation',
    'grape_variety', 'vintage', 'alcohol', 'price',
    'wine_body', 'wine_acidity', 'wine_tannin',
    'flavor_tags', 'food_matching', 'pairing_rationale',
    'desc_en_short', 'score_max', 'score_summary',
]

GROUP_MAP = {
    'Red Wine':           None,
    'White Wine':         None,
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


def clean_slim(item):
    record = {}
    for k in KEEP_SLIM:
        v = item.get(k)
        if v not in (None, '', [], 'null'):
            record[k] = v
    record['classification'] = item.get('classification', '')
    return record


def write_slim_json(path, records, description=''):
    payload = {
        'file': os.path.basename(path),
        'description': description,
        'product_count': len(records),
        'products': records,
    }
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w') as f:
        f.write(content)
    kb = len(content) // 1024
    print(f"  SLIM  {os.path.basename(path):50s}  {len(records):>5} products  {kb:>5}KB")
    return len(content)


def product_to_text(p):
    """Convert one product to a human-readable text block for NotebookLM."""
    lines = []
    lines.append(f"SKU: {p.get('sku', '')}")
    lines.append(f"Name: {p.get('name', '')}")
    if p.get('brand'):
        lines.append(f"Brand: {p['brand']}")
    lines.append(f"Type: {p.get('classification', '')}")
    loc_parts = [p.get('country'), p.get('region'), p.get('subregion'), p.get('appellation')]
    loc = ', '.join(x for x in loc_parts if x)
    if loc:
        lines.append(f"Origin: {loc}")
    if p.get('grape_variety'):
        lines.append(f"Grape/Style: {p['grape_variety']}")
    if p.get('vintage'):
        lines.append(f"Vintage: {p['vintage']}")
    if p.get('alcohol'):
        lines.append(f"Alcohol: {p['alcohol']}")
    if p.get('price'):
        lines.append(f"Price: {p['price']} THB")
    body_parts = []
    if p.get('wine_body'):
        body_parts.append(f"Body: {p['wine_body']}")
    if p.get('wine_acidity'):
        body_parts.append(f"Acidity: {p['wine_acidity']}")
    if p.get('wine_tannin'):
        body_parts.append(f"Tannin: {p['wine_tannin']}")
    if body_parts:
        lines.append(' | '.join(body_parts))
    if p.get('flavor_tags'):
        tags = p['flavor_tags']
        if isinstance(tags, list):
            tags = ', '.join(tags)
        lines.append(f"Flavors: {tags}")
    if p.get('food_matching'):
        lines.append(f"Food pairing: {p['food_matching']}")
    if p.get('pairing_rationale'):
        lines.append(f"Why: {p['pairing_rationale']}")
    if p.get('desc_en_short'):
        lines.append(f"Description: {p['desc_en_short']}")
    if p.get('score_summary'):
        lines.append(f"Score: {p['score_summary']}")
    return '\n'.join(lines)


def write_notebooklm_txt(path, records, description=''):
    blocks = [
        f"WN/LIQ9 Product Catalog — {description}",
        f"Total: {len(records)} products",
        "=" * 60,
        "",
    ]
    for p in records:
        blocks.append(product_to_text(p))
        blocks.append("")
        blocks.append("---")
        blocks.append("")
    content = '\n'.join(blocks)
    with open(path, 'w') as f:
        f.write(content)
    kb = len(content) // 1024
    print(f"  NLM   {os.path.basename(path):50s}  {len(records):>5} products  {kb:>5}KB")
    return len(content)


def build_groups(items):
    """Return (groups dict, red list, white list) after applying GROUP_MAP."""
    groups = defaultdict(list)
    red, white = [], []
    for item in items:
        cls = item.get('classification', 'Others')
        if cls == 'Red Wine':
            red.append(clean_slim(item))
        elif cls == 'White Wine':
            white.append(clean_slim(item))
        else:
            group = GROUP_MAP.get(cls, 'other_products')
            groups[group].append(clean_slim(item))
    return groups, red, white


def main():
    os.makedirs(SLIM, exist_ok=True)
    os.makedirs(NLM,  exist_ok=True)

    print(f"Loading {SRC} ...")
    with open(SRC) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get('products', data.get('items', []))
    print(f"  {len(items):,} products loaded\n")

    groups, red, white = build_groups(items)

    # --- slim JSON for Claude/ChatGPT ---
    print("Generating slim JSON files (Claude Projects / ChatGPT) ...")
    total_slim = 0

    for group, records in sorted(groups.items()):
        path = os.path.join(SLIM, f'products_{group}.json')
        total_slim += write_slim_json(path, records, group.replace('_', ' '))

    for suffix, filt in [
        ('wines_red_france', lambda r: r.get('country') == 'France'),
        ('wines_red_italy',  lambda r: r.get('country') == 'Italy'),
        ('wines_red_world',  lambda r: r.get('country') not in ('France', 'Italy')),
    ]:
        subset = [r for r in red if filt(r)]
        path = os.path.join(SLIM, f'products_{suffix}.json')
        total_slim += write_slim_json(path, subset, suffix.replace('_', ' '))

    for suffix, filt in [
        ('wines_white_france', lambda r: r.get('country') == 'France'),
        ('wines_white_world',  lambda r: r.get('country') != 'France'),
    ]:
        subset = [r for r in white if filt(r)]
        path = os.path.join(SLIM, f'products_{suffix}.json')
        total_slim += write_slim_json(path, subset, suffix.replace('_', ' '))

    # copy compact TSV index (already small)
    import shutil
    src_tsv = os.path.join(ROOT, 'docs', 'ai-knowledge-base', 'product_index_compact.tsv')
    dst_tsv = os.path.join(SLIM, 'product_index_compact.tsv')
    shutil.copy2(src_tsv, dst_tsv)
    print(f"  SLIM  {'product_index_compact.tsv':50s}  {os.path.getsize(dst_tsv)//1024:>5}KB  (copied)")

    src_sp = os.path.join(ROOT, 'docs', 'ai-knowledge-base', 'system_prompt.md')
    dst_sp = os.path.join(SLIM, 'system_prompt.md')
    shutil.copy2(src_sp, dst_sp)
    print(f"  SLIM  {'system_prompt.md':50s}  {os.path.getsize(dst_sp)//1024:>5}KB  (copied)")

    print(f"\nSlim total: {total_slim // (1024*1024):.1f}MB  →  {SLIM}")

    # --- NotebookLM plain text ---
    print("\nGenerating NotebookLM plain text files ...")
    total_nlm = 0

    for group, records in sorted(groups.items()):
        path = os.path.join(NLM, f'products_{group}.txt')
        label = group.replace('_', ' ').title()
        total_nlm += write_notebooklm_txt(path, records, label)

    for suffix, filt, label in [
        ('wines_red_france', lambda r: r.get('country') == 'France',  'Red Wine — France'),
        ('wines_red_italy',  lambda r: r.get('country') == 'Italy',   'Red Wine — Italy'),
        ('wines_red_world',  lambda r: r.get('country') not in ('France','Italy'), 'Red Wine — World'),
    ]:
        subset = [r for r in red if filt(r)]
        path = os.path.join(NLM, f'products_{suffix}.txt')
        total_nlm += write_notebooklm_txt(path, subset, label)

    for suffix, filt, label in [
        ('wines_white_france', lambda r: r.get('country') == 'France', 'White Wine — France'),
        ('wines_white_world',  lambda r: r.get('country') != 'France', 'White Wine — World'),
    ]:
        subset = [r for r in white if filt(r)]
        path = os.path.join(NLM, f'products_{suffix}.txt')
        total_nlm += write_notebooklm_txt(path, subset, label)

    # NotebookLM index (plain text)
    idx_lines = [
        "WN/LIQ9 Product Index — All SKUs",
        f"Total: {len(items)} products",
        "SKU | Name | Type | Country | Region | Grape | Body | Vintage | Price THB",
        "=" * 80,
    ]
    for p in sorted(items, key=lambda x: (x.get('classification',''), x.get('name',''))):
        idx_lines.append('\t'.join([
            p.get('sku', ''),
            (p.get('name', '') or '')[:55],
            p.get('classification', '') or '',
            p.get('country', '') or '',
            p.get('region', '') or '',
            (p.get('grape_variety', '') or '')[:30],
            p.get('wine_body', '') or '',
            str(p.get('vintage', '') or ''),
            str(p.get('price', '') or ''),
        ]))
    idx_path = os.path.join(NLM, 'product_index.txt')
    with open(idx_path, 'w') as f:
        f.write('\n'.join(idx_lines))
    print(f"  NLM   {'product_index.txt':50s}  {len(items):>5} products  {os.path.getsize(idx_path)//1024:>5}KB")

    # NotebookLM system prompt (plain text version)
    nlm_prompt = """WN/LIQ9 Sommelier AI — Instructions for NotebookLM

You are a professional sommelier for Wine Now (WN) and LIQ9, a premium beverage retailer in Thailand.
Your product catalog covers 11,000+ wines, spirits, sake, beer, and accessories.

HOW TO USE THESE SOURCES
This notebook contains:
- product_index.txt  — all SKUs with key facts (always search this first)
- products_*.txt     — full detail per category (search when you need tasting notes, pairing, price)

WHEN ANSWERING A QUESTION
1. Search product_index.txt to find matching SKUs by name, country, grape, or style
2. Search the relevant category file for full tasting notes and pairing detail
3. Compose your answer using real product data — SKU, name, price, tasting notes, pairing
4. If you find better data than what is recorded, note it at the end as a suggested update

ANSWER FORMAT
For each recommended product include:
- SKU and full product name
- Price in THB
- Origin (country, region, appellation if known)
- Grape variety / style
- Tasting profile (body, key flavors)
- Food pairing suggestion
- Why this matches the customer's request

SUGGESTED UPDATE FORMAT
At the end of your reply, if you found corrections or improvements, output:

SUGGESTED UPDATES:
- SKU [sku] | Field: [field_name] | Current: [current] | Suggested: [new value] | Confidence: high/medium/low

TONE
Professional but approachable. Speak like a knowledgeable sommelier, not a database.
"""
    nlm_sp_path = os.path.join(NLM, 'system_prompt.txt')
    with open(nlm_sp_path, 'w') as f:
        f.write(nlm_prompt)
    print(f"  NLM   {'system_prompt.txt':50s}  {os.path.getsize(nlm_sp_path)//1024:>5}KB")

    print(f"\nNotebookLM total: {total_nlm // (1024*1024):.1f}MB  →  {NLM}")
    print("\nDone.")


if __name__ == '__main__':
    main()
