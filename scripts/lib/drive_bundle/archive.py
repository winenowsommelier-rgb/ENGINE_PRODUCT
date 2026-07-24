"""Thin full-catalog archive (ALL SKUs, in-stock or not) as JSONL.

Reference layer so nothing is lost when the live/catalog tiers are in-stock-only.
Thin field set keeps it small; recommendations never draw from here.
"""
from __future__ import annotations

import json
import os

ARCHIVE_COLS = [
    'sku', 'name', 'brand', 'category_group', 'category_type',
    'country', 'region', 'vintage', 'price', 'is_in_stock',
    'custom_stock_status', 'product_url',
]


def _thin(rec: dict) -> dict:
    return {c: rec.get(c) for c in ARCHIVE_COLS if rec.get(c) not in (None, '')}


def write_archive_jsonl(items: list[dict], out_dir: str) -> str:
    """Write products_all_archive.jsonl (one record per line). Returns path."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'products_all_archive.jsonl')
    with open(path, 'w') as f:
        for rec in items:
            f.write(json.dumps(_thin(rec), ensure_ascii=False))
            f.write('\n')
    return path
