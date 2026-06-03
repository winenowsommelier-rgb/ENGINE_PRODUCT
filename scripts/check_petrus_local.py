"""Confirm local SQLite has v3 description and would be picked up by sync."""
import sqlite3
c = sqlite3.connect('data/db/products.db')
c.row_factory = sqlite3.Row
row = c.execute("""
    SELECT id, sku, length(full_description) AS fd_len,
           enrichment_confidence, updated_at, enriched_at, enrichment_source
    FROM products WHERE sku='WRW5086AF'
""").fetchone()
for k in row.keys():
    print(f'{k}: {row[k]}')
print()
last_synced = c.execute("SELECT last_synced_at FROM sync_state WHERE table_name='products'").fetchone()
print('products.last_synced_at:', last_synced[0] if last_synced else None)
