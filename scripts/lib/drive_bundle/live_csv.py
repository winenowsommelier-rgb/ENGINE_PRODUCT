"""Daily live commercial feeds: inventory + pricing/promotions.

Flat CSVs, cheap to diff and push. Columns are fixed (spec sec 4).
magento_product_url is emitted empty until the source column is populated
(auto-populates then). There is NO promo-validity column — the DB has no such
field (do not invent one).
"""
from __future__ import annotations

import csv
import os

INVENTORY_COLS = [
    'sku', 'name', 'is_in_stock', 'custom_stock_status', 'wn_stock',
    'category_group', 'category_type', 'magento_product_url',
]
PRICING_COLS = [
    'sku', 'price', 'special_price', 'sp_discount_pct', 'currency', 'magento_product_url',
]


def _write(path: str, cols: list[str], items: list[dict]) -> None:
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for p in items:
            w.writerow({c: ('' if p.get(c) is None else p.get(c)) for c in cols})


def write_live_csvs(items: list[dict], out_dir: str) -> dict[str, int]:
    """Write both live CSVs to out_dir. Returns {filename: row_count}."""
    os.makedirs(out_dir, exist_ok=True)
    inv_path = os.path.join(out_dir, 'inventory_live.csv')
    pri_path = os.path.join(out_dir, 'pricing_promotions_live.csv')
    _write(inv_path, INVENTORY_COLS, items)
    _write(pri_path, PRICING_COLS, items)
    return {'inventory_live.csv': len(items), 'pricing_promotions_live.csv': len(items)}
