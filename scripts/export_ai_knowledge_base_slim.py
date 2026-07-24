#!/usr/bin/env python3
"""
Generates slim knowledge base files for AI projects with file-size limits.
Two output sets:
  docs/ai-knowledge-base-slim/     — for Claude Projects & ChatGPT Projects
  docs/ai-knowledge-base-notebooklm/ — for Google NotebookLM (plain text, no JSON)

Slim strategy:
- Drop: full_description, taste_profile, enrichment_source, validation_status, bottle_size
- Keep: sku, name, brand, classification, country, region, subregion, appellation,
        variety, vintage, alcohol, price, body, acidity, tannin,
        flavor_tags, food_matching, pairing_rationale, desc_en_short, score_max, score_summary
- NotebookLM: plain text per category (no JSON), one product per block
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.drive_bundle.grouping import group_records

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC   = os.path.join(ROOT, 'data', 'live_products_export.json')
SLIM  = os.path.join(ROOT, 'docs', 'ai-knowledge-base-slim')
NLM   = os.path.join(ROOT, 'docs', 'ai-knowledge-base-notebooklm')

KEEP_SLIM = [
    'sku', 'name', 'brand', 'classification', 'color',
    'category_group', 'category_type',
    'country', 'region', 'subregion', 'appellation',
    'variety', 'vintage', 'alcohol', 'price',
    'body', 'acidity', 'tannin',
    'flavor_tags', 'food_matching', 'pairing_rationale',
    'desc_en_short', 'score_max', 'score_summary',
]

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
    lines.append(f"Type: {p.get('category_type', '')}")
    loc_parts = [p.get('country'), p.get('region'), p.get('subregion'), p.get('appellation')]
    loc = ', '.join(x for x in loc_parts if x)
    if loc:
        lines.append(f"Origin: {loc}")
    if p.get('variety'):
        lines.append(f"Grape/Style: {p['variety']}")
    if p.get('vintage'):
        lines.append(f"Vintage: {p['vintage']}")
    if p.get('alcohol'):
        lines.append(f"Alcohol: {p['alcohol']}")
    if p.get('price'):
        lines.append(f"Price: {p['price']} THB")
    body_parts = []
    if p.get('body'):
        body_parts.append(f"Body: {p['body']}")
    if p.get('acidity'):
        body_parts.append(f"Acidity: {p['acidity']}")
    if p.get('tannin'):
        body_parts.append(f"Tannin: {p['tannin']}")
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


def generate_slim(items, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for stem, records in sorted(group_records([clean_slim(i) for i in items]).items()):
        path = os.path.join(out_dir, f'products_{stem}.json')
        total += write_slim_json(path, records, stem.replace('_', ' '))
    return total


def _write_nlm_index(items, out_dir):
    """Write product_index.txt (plain text). Type column sources from
    category_type (Rule 12) — NEVER raw classification."""
    idx_lines = [
        "WN/LIQ9 Product Index — All SKUs",
        f"Total: {len(items)} products",
        "SKU | Name | Type | Country | Region | Grape | Body | Vintage | Price THB",
        "=" * 80,
    ]
    for p in sorted(items, key=lambda x: (x.get('category_type', ''), x.get('name', ''))):
        idx_lines.append('\t'.join([
            p.get('sku', ''),
            (p.get('name', '') or '')[:55],
            p.get('category_type', '') or '',
            p.get('country', '') or '',
            p.get('region', '') or '',
            (p.get('variety', '') or '')[:30],
            p.get('body', '') or '',
            str(p.get('vintage', '') or ''),
            str(p.get('price', '') or ''),
        ]))
    idx_path = os.path.join(out_dir, 'product_index.txt')
    with open(idx_path, 'w') as f:
        f.write('\n'.join(idx_lines))
    print(f"  NLM   {'product_index.txt':50s}  {len(items):>5} products  {os.path.getsize(idx_path)//1024:>5}KB")


def generate_notebooklm(items, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for stem, records in sorted(group_records([clean_slim(i) for i in items]).items()):
        path = os.path.join(out_dir, f'products_{stem}.txt')
        total += write_notebooklm_txt(path, records, stem.replace('_', ' ').title())
    _write_nlm_index(items, out_dir)
    return total


def main():
    with open(SRC) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get('products', data.get('items', []))
    generate_slim(items, SLIM)
    generate_notebooklm(items, NLM)
    print('Done.')


if __name__ == '__main__':
    main()
