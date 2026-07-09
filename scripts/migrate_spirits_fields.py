"""
Add 5 spirits classification columns to products table.
Safe to run multiple times (IF NOT EXISTS guards each ALTER TABLE).
"""
import sqlite3, pathlib

DB = pathlib.Path(__file__).parent.parent / 'data/db/products.db'

NEW_COLS = [
    ('gin_style',         'TEXT'),
    ('agave_aging',       'TEXT'),
    ('rum_style',         'TEXT'),
    ('peat_level',        'TEXT'),
    ('production_method', 'TEXT'),
]

conn = sqlite3.connect(DB)
cur = conn.cursor()
existing = {row[1] for row in cur.execute('PRAGMA table_info(products)')}
for col, typ in NEW_COLS:
    if col not in existing:
        cur.execute(f'ALTER TABLE products ADD COLUMN {col} {typ}')
        print(f'Added column: {col}')
    else:
        print(f'Already exists: {col}')
conn.commit()
conn.close()
print('Done.')
