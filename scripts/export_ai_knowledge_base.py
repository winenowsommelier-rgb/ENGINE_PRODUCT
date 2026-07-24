#!/usr/bin/env python3
"""
Regenerates all files in docs/ai-knowledge-base/ from data/live_products_export.json.
Run this after any bulk enrichment or database update.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.drive_bundle.grouping import group_records

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'data', 'live_products_export.json')
OUT  = os.path.join(ROOT, 'docs', 'ai-knowledge-base')

KEEP = [
    'sku', 'name', 'brand', 'classification', 'wine_classification', 'color',
    'category_group', 'category_type',
    'country', 'region', 'subregion', 'appellation',
    'variety', 'vintage', 'alcohol', 'bottle_size', 'price',
    'body', 'acidity', 'tannin',
    'flavor_tags', 'food_matching', 'pairing_rationale',
    'desc_en_short', 'full_description', 'taste_profile',
    'score_max', 'score_summary',
    'enrichment_source', 'validation_status',
]


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


def _write_compact_tsv(items, out_dir):
    # Class column sources from category_type (Rule 12) — NOT raw classification.
    tsv_lines = ["SKU\tName\tClass\tCountry\tRegion\tGrape\tBody\tVintage\tPrice"]
    for p in sorted(items, key=lambda x: (x.get('category_type', ''), x.get('name', ''))):
        tsv_lines.append('\t'.join([
            p.get('sku', ''),
            (p.get('name', '') or '').replace('\t', ' ')[:55],
            p.get('category_type', '') or '',
            p.get('country', '') or '',
            p.get('region', '') or '',
            (p.get('variety', '') or '')[:35],
            p.get('body', '') or '',
            p.get('vintage', '') or '',
            str(p.get('price', '') or ''),
        ]))
    tsv_path = os.path.join(out_dir, 'product_index_compact.tsv')
    with open(tsv_path, 'w') as f:
        f.write('\n'.join(tsv_lines))
    print(f"  product_index_compact.tsv  {len(tsv_lines)} rows  {os.path.getsize(tsv_path)//1024}KB")


def generate(items, out_dir):
    """Write category JSON + compact TSV for `items` into out_dir.

    Groups by category_group/category_type via grouping.group_records (Rule 12);
    NEVER by classification. No record is dropped — unmapped groups land in
    products_unknown.json.
    """
    os.makedirs(out_dir, exist_ok=True)
    _write_compact_tsv(items, out_dir)
    total_bytes = 0
    buckets = group_records([clean(i) for i in items])
    for stem, records in sorted(buckets.items()):
        path = os.path.join(out_dir, f'products_{stem}.json')
        total_bytes += write_json(path, records, f"{stem.replace('_', ' ')} ({len(records)} products)")
    return total_bytes


def main():
    with open(SRC) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get('products', data.get('items', []))
    generate(items, OUT)   # full unfiltered list -> legacy dir
    print('Done.')


if __name__ == '__main__':
    main()
