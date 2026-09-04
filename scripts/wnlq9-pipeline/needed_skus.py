# -*- coding: utf-8 -*-
"""Emit every SKU the build touches, batched for the links_cache refresh query.

    python3 needed_skus.py          -> batches of 280, ready to paste into the
                                       string_to_array(...) literal in links.py
"""
import json, re, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
PAT = re.compile(r'\b([A-Z]{3}\d{4}[A-Z]{2}(?:-\d+)?)\b')

def skus():
    out = set()
    files = (glob.glob(os.path.join(HERE, 'cat_*.json'))
             + glob.glob(os.path.join(HERE, 'bs2_*.tsv'))
             + [os.path.join(HERE, f) for f in
                ('catalog.json', 'margin_ml.json', 'trend_types.json', 'blurbs.json',
                 'trending_demand.json', 'items.json', 'stock_checks.csv', 'oos.txt')])
    for f in files:
        if os.path.exists(f):
            out |= set(PAT.findall(open(f, encoding='utf-8').read()))
    return sorted(out)

if __name__ == '__main__':
    s = skus()
    print(f'-- {len(s)} SKUs, {-(-len(s)//280)} batches\n')
    for i in range(0, len(s), 280):
        print(f'-- batch {i//280}')
        print(','.join(s[i:i+280]))
        print()
