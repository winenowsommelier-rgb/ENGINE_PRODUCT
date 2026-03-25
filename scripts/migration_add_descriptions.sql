-- ============================================================================
-- Migration: Add multi-store description + tasting note columns to products
-- Run this ONCE in Supabase SQL Editor before running import-descriptions.ts
-- ============================================================================

ALTER TABLE products
  -- EN Store (Default) — English descriptions
  ADD COLUMN IF NOT EXISTS short_description_en   TEXT,
  ADD COLUMN IF NOT EXISTS description_en_html    TEXT,   -- raw HTML as-is from Magento
  ADD COLUMN IF NOT EXISTS description_en_text    TEXT,   -- HTML-stripped plain text

  -- Store TH WN — Thai WineNow store descriptions
  ADD COLUMN IF NOT EXISTS short_description_th_wn  TEXT,
  ADD COLUMN IF NOT EXISTS description_th_wn_html   TEXT,
  ADD COLUMN IF NOT EXISTS description_th_wn_text   TEXT,

  -- Store TH Liq9 — Thai Liq9 store descriptions
  ADD COLUMN IF NOT EXISTS short_description_th_liq9  TEXT,
  ADD COLUMN IF NOT EXISTS description_th_liq9_html   TEXT,
  ADD COLUMN IF NOT EXISTS description_th_liq9_text   TEXT,

  -- Tasting notes (from EN Store — used for validation / calibration)
  ADD COLUMN IF NOT EXISTS wine_color      TEXT,  -- visual: "Light straw yellow, clear…"
  ADD COLUMN IF NOT EXISTS wine_aroma      TEXT,  -- nose: "Pleasant aromas of muscat…"
  ADD COLUMN IF NOT EXISTS wine_palate     TEXT,  -- palate: "Sweet but not cloying…"
  ADD COLUMN IF NOT EXISTS wine_body       TEXT,  -- body tier: Light / Medium / Full
  ADD COLUMN IF NOT EXISTS wine_acidity    TEXT,  -- Low / Medium / High
  ADD COLUMN IF NOT EXISTS wine_tannin     TEXT,  -- Low / Medium / High
  ADD COLUMN IF NOT EXISTS food_matching   TEXT;  -- pairings: "Dessert", "Red meat"…

-- Speed up description searches / filters
CREATE INDEX IF NOT EXISTS idx_products_wine_body     ON products (wine_body);
CREATE INDEX IF NOT EXISTS idx_products_wine_acidity  ON products (wine_acidity);
CREATE INDEX IF NOT EXISTS idx_products_wine_tannin   ON products (wine_tannin);
