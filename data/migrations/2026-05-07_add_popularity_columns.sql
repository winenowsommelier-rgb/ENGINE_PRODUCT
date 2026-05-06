-- Add popularity_* columns to products table.
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_score          double precision;
ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_qty_90d        double precision;
ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_orders_90d     integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_revenue_90d    double precision;
ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_window_days    integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS popularity_synced_at      timestamptz;

-- Index for sort performance: popular sort uses popularity_score DESC NULLS LAST.
CREATE INDEX IF NOT EXISTS idx_products_popularity_score
    ON products (popularity_score DESC NULLS LAST);
