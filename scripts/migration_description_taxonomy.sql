-- scripts/migration_description_taxonomy.sql
-- Run ONCE in Supabase SQL Editor before pipeline deployment.
-- enrichment_note already exists from migration_add_validation_columns.sql

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku_base             TEXT,
  ADD COLUMN IF NOT EXISTS is_primary_variant   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS style                TEXT,
  ADD COLUMN IF NOT EXISTS style_detail         TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_short        TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_full         TEXT,
  ADD COLUMN IF NOT EXISTS desc_source          TEXT
    CHECK (desc_source IN ('original', 'ai_processed', 'manual')),
  ADD COLUMN IF NOT EXISTS desc_processed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_flags         TEXT;

BEGIN;

-- Backfill sku_base from first 7 chars of sku
UPDATE products SET sku_base = LEFT(sku, 7) WHERE sku_base IS NULL;

-- Set all rows to FALSE first (handles NULL from DEFAULT on pre-existing rows)
UPDATE products SET is_primary_variant = FALSE;

-- Set TRUE for the alphabetically lowest SKU per sku_base group
UPDATE products p
SET is_primary_variant = TRUE
WHERE sku = (
  SELECT sku FROM products p2
  WHERE p2.sku_base = p.sku_base
  ORDER BY sku ASC
  LIMIT 1
);

COMMIT;

CREATE INDEX IF NOT EXISTS idx_products_sku_base ON products(sku_base);
CREATE INDEX IF NOT EXISTS idx_products_primary  ON products(sku_base, is_primary_variant);

-- Spot-check queries (run in Supabase SQL Editor to verify migration):
--
-- 1. Verify column creation:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'products' AND column_name IN (
--   'sku_base', 'is_primary_variant', 'style', 'style_detail',
--   'desc_en_short', 'desc_en_full', 'desc_source', 'desc_processed_at', 'triage_flags'
-- )
-- ORDER BY column_name;
--
-- 2. Verify sku_base backfill (should show 7 chars):
-- SELECT COUNT(*), MIN(LENGTH(sku_base)), MAX(LENGTH(sku_base))
-- FROM products
-- WHERE sku_base IS NOT NULL;
--
-- 3. Verify primary variant assignment (should have at least one per sku_base):
-- SELECT sku_base, COUNT(*) as total_variants, SUM(CASE WHEN is_primary_variant THEN 1 ELSE 0 END) as primary_count
-- FROM products
-- WHERE sku_base IS NOT NULL
-- GROUP BY sku_base
-- ORDER BY sku_base;
--
-- 4. Verify CHECK constraint on desc_source:
-- SELECT DISTINCT desc_source FROM products WHERE desc_source IS NOT NULL;
--
-- 5. Verify indexes were created:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'products' AND indexname LIKE 'idx_products_%';
