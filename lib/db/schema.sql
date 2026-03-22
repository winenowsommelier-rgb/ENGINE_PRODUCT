-- ============================================================================
-- WineNow Product Information Management - Local SQLite Schema
-- ============================================================================

-- Cleaned and validated products with taxonomy
CREATE TABLE IF NOT EXISTS cleaned_products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  original_name TEXT,
  brand TEXT,
  category TEXT,
  product_type TEXT,
  
  -- Taxonomy validation
  country TEXT,
  country_id INTEGER,
  region TEXT,
  region_id INTEGER,
  subregion TEXT,
  subregion_id INTEGER,
  origin TEXT,
  origin_id INTEGER,
  
  -- For wines/spirits
  classification TEXT,
  classification_id INTEGER,
  grape_variety TEXT,
  grape_family TEXT,
  grape_class TEXT,
  vintage TEXT,
  alcohol REAL,
  
  -- For products with ingredients
  ingredient_1 TEXT,
  ingredient_2 TEXT,
  ingredient_3 TEXT,
  ingredient_4 TEXT,
  ingredient_5 TEXT,
  
  -- Flavor & character profile
  flavor_profile TEXT, -- JSON array of flavor notes
  flavor_families TEXT, -- JSON array: fruity, spicy, floral, etc.
  character_traits TEXT, -- JSON: body, tannins, acidity, sweetness, etc.
  
  -- Description & content
  full_description TEXT, -- Full cleaned English description
  product_features TEXT, -- JSON array of key features
  quality_tier TEXT, -- budget, mid-range, premium, luxury
  
  -- Pricing
  price REAL,
  cost REAL,
  currency TEXT DEFAULT 'USD',
  
  -- Inventory
  sku_magento TEXT,
  quantity_in_stock INTEGER,
  is_in_stock BOOLEAN DEFAULT true,
  bottle_size TEXT,
  packaging TEXT,
  
  -- Validation & quality scores
  taxonomy_confidence REAL DEFAULT 0.0, -- 0.0 to 1.0
  description_confidence REAL DEFAULT 0.0, -- Scraping confidence
  overall_confidence REAL DEFAULT 0.0, -- Combined confidence
  validation_status TEXT DEFAULT 'pending', -- pending, validated, blocked, needs_review
  validation_notes TEXT,
  
  -- External data & scraping
  scraped_description TEXT,
  scraped_reviews_summary TEXT,
  scraped_rating REAL,
  scraped_reviews_count INTEGER,
  external_url TEXT,
  last_scraped_at TIMESTAMP,
  
  -- Metadata
  batch_id TEXT,
  source_file TEXT,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY(country_id) REFERENCES taxonomy_countries(id),
  FOREIGN KEY(region_id) REFERENCES taxonomy_regions(id),
  FOREIGN KEY(classification_id) REFERENCES taxonomy_classifications(id)
);

-- Taxonomy: Countries
CREATE TABLE IF NOT EXISTS taxonomy_countries (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT UNIQUE NOT NULL,
  iso_code TEXT,
  region TEXT,
  latitude REAL,
  longitude REAL
);

-- Taxonomy: Regions
CREATE TABLE IF NOT EXISTS taxonomy_regions (
  id INTEGER PRIMARY KEY,
  country_id INTEGER NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  FOREIGN KEY(country_id) REFERENCES taxonomy_countries(id),
  UNIQUE(country_id, name)
);

-- Taxonomy: Subregions
CREATE TABLE IF NOT EXISTS taxonomy_subregions (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  FOREIGN KEY(region_id) REFERENCES taxonomy_regions(id),
  UNIQUE(region_id, name)
);

-- Taxonomy: Origins (appellations, terroirs)
CREATE TABLE IF NOT EXISTS taxonomy_origins (
  id INTEGER PRIMARY KEY,
  country_id INTEGER,
  region_id INTEGER,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT, -- AOC, DO, DOC, etc.
  FOREIGN KEY(country_id) REFERENCES taxonomy_countries(id),
  FOREIGN KEY(region_id) REFERENCES taxonomy_regions(id)
);

-- Taxonomy: Classification (wine types, spirits types)
CREATE TABLE IF NOT EXISTS taxonomy_classifications (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT, -- wine, spirit, beer, liqueur
  subcategory TEXT,
  description TEXT
);

-- Taxonomy: Ingredients & Grapes
CREATE TABLE IF NOT EXISTS taxonomy_ingredients (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  type TEXT, -- grape_variety, ingredient, additive
  family TEXT,
  flavor_profile TEXT, -- JSON
  synonyms TEXT -- JSON array
);

-- Taxonomy: Flavor notes
CREATE TABLE IF NOT EXISTS taxonomy_flavors (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  family TEXT, -- fruity, spicy, floral, herbal, earthy, etc.
  intensity REAL, -- 0.0 to 1.0
  description TEXT
);

-- Batch processing history
CREATE TABLE IF NOT EXISTS batch_logs (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_type TEXT, -- csv, api, scrape
  total_rows INTEGER,
  processed_rows INTEGER,
  ready_rows INTEGER,
  review_rows INTEGER,
  blocked_rows INTEGER,
  status TEXT DEFAULT 'processing', -- processing, completed, failed
  error_message TEXT,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT
);

-- Scraping queue & history
CREATE TABLE IF NOT EXISTS scraping_queue (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  product_id TEXT,
  url TEXT,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  scraping_type TEXT, -- description, reviews, specifications
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  scraped_data TEXT, -- JSON
  queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES cleaned_products(id)
);

-- Reviews & ratings storage
CREATE TABLE IF NOT EXISTS product_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT,
  review_text TEXT,
  rating REAL,
  reviewer_name TEXT,
  review_date TIMESTAMP,
  source TEXT, -- external website
  sentiment TEXT, -- positive, neutral, negative
  is_verified BOOLEAN DEFAULT false,
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES cleaned_products(id)
);

-- Data quality flags & issues
CREATE TABLE IF NOT EXISTS data_issues (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT,
  issue_type TEXT, -- missing_field, invalid_taxonomy, low_confidence, duplicate, etc.
  severity TEXT, -- critical, warning, info
  description TEXT,
  suggested_value TEXT,
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES cleaned_products(id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cleaned_products_sku ON cleaned_products(sku);
CREATE INDEX IF NOT EXISTS idx_cleaned_products_country ON cleaned_products(country);
CREATE INDEX IF NOT EXISTS idx_cleaned_products_validation ON cleaned_products(validation_status);
CREATE INDEX IF NOT EXISTS idx_cleaned_products_confidence ON cleaned_products(overall_confidence);
CREATE INDEX IF NOT EXISTS idx_cleaned_products_batch ON cleaned_products(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_logs_status ON batch_logs(status);
CREATE INDEX IF NOT EXISTS idx_scraping_queue_status ON scraping_queue(status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_data_issues_product ON data_issues(product_id);
CREATE INDEX IF NOT EXISTS idx_data_issues_severity ON data_issues(severity);
