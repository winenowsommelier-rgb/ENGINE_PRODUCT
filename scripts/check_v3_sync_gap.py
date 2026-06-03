"""How many v3 enriched rows were skipped by the last sync due to NULL enrichment_confidence?"""
import sqlite3
c = sqlite3.connect('data/db/products.db')
last_synced = c.execute("SELECT last_synced_at FROM sync_state WHERE table_name='products'").fetchone()[0]
print('last_synced_at:', last_synced)
print()

total_v3 = c.execute("SELECT COUNT(*) FROM products WHERE enrichment_source LIKE 'ai_brand_library_v3%'").fetchone()[0]
v3_null_conf = c.execute("""
    SELECT COUNT(*) FROM products
    WHERE enrichment_source LIKE 'ai_brand_library_v3%' AND enrichment_confidence IS NULL
""").fetchone()[0]
v3_updated_after_sync = c.execute("""
    SELECT COUNT(*) FROM products
    WHERE enrichment_source LIKE 'ai_brand_library_v3%' AND updated_at > ?
""", (last_synced,)).fetchone()[0]
v3_would_sync = c.execute("""
    SELECT COUNT(*) FROM products
    WHERE enrichment_source LIKE 'ai_brand_library_v3%'
      AND enrichment_confidence IS NOT NULL
      AND updated_at > ?
""", (last_synced,)).fetchone()[0]
print('v3 rows total:', total_v3)
print('v3 rows with NULL enrichment_confidence:', v3_null_conf)
print('v3 rows updated AFTER last sync:', v3_updated_after_sync)
print('v3 rows that would have been included by last sync filter:', v3_would_sync)
print()
print('=> rows skipped by sync because of NULL confidence:',
      v3_updated_after_sync - v3_would_sync)
