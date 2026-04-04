-- ============================================================================
-- TAXONOMY KNOWLEDGE LIBRARY
-- Dynamic, scope-aware taxonomy system for product intelligence
-- ============================================================================

-- 1. SCOPES — Define product category domains
-- Each scope has its own character dimensions, attribute definitions, and descriptions
-- Adding coffee/tea/matcha = just INSERT a new scope row
CREATE TABLE IF NOT EXISTS scopes (
  id          text PRIMARY KEY,              -- 'wine', 'spirits', 'sake', 'beer', etc.
  label       text NOT NULL,                 -- 'Wine', 'Spirits'
  description text,
  icon        text,                          -- emoji or icon key
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Map classifications → scopes
-- e.g., 'Red Wine' → 'wine', 'Whisky' → 'spirits'
CREATE TABLE IF NOT EXISTS classification_scope_map (
  classification text PRIMARY KEY,           -- matches products.classification
  scope_id       text NOT NULL REFERENCES scopes(id),
  sort_order     int NOT NULL DEFAULT 0
);

-- 2. CHARACTER DIMENSIONS — Define what axes exist per scope
-- Wine: body, acidity, tannin, sweetness, alcohol
-- Spirits: peat, smoke, sweetness, complexity, age_depth
-- Sake: umami, sweetness, acidity, body, fragrance
-- This drives the radar chart dynamically — no hardcoded axes
CREATE TABLE IF NOT EXISTS character_dimensions (
  id          text PRIMARY KEY,              -- 'wine.body', 'spirits.peat'
  scope_id    text NOT NULL REFERENCES scopes(id),
  dimension_key text NOT NULL,               -- 'body', 'peat', 'umami'
  label       text NOT NULL,                 -- 'Body', 'Peat Influence'
  description text,                          -- tooltip: "Perceived weight and richness..."
  min_value   numeric NOT NULL DEFAULT 0,
  max_value   numeric NOT NULL DEFAULT 5,
  sort_order  int NOT NULL DEFAULT 0,
  UNIQUE(scope_id, dimension_key)
);

-- 3. SCOPE ATTRIBUTE DEFINITIONS — What metadata fields each scope uses
-- Wine: key_grapes, terroir, climate, soil, aoc_system, aging_potential
-- Spirits: distillation_method, base_ingredient, aging_tradition, cask_types
-- This lets the UI render the right input fields per scope
CREATE TABLE IF NOT EXISTS scope_attribute_defs (
  id          text PRIMARY KEY,              -- 'wine.key_grapes', 'spirits.cask_types'
  scope_id    text NOT NULL REFERENCES scopes(id),
  attribute_key text NOT NULL,               -- 'key_grapes', 'distillation_method'
  label       text NOT NULL,                 -- 'Key Grape Varieties'
  data_type   text NOT NULL DEFAULT 'text',  -- 'text', 'text[]', 'number', 'json', 'boolean'
  options     jsonb,                         -- for enum/select: ["pot still","column still"]
  is_required boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  UNIQUE(scope_id, attribute_key)
);

-- 4. TAXONOMY ENTITIES — Identity layer (scope-independent)
-- Represents: countries, regions, subregions, appellations, brands, grapes, styles
CREATE TABLE IF NOT EXISTS taxonomy_entities (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,                 -- 'country','region','subregion','appellation','brand','grape','style'
  name        text NOT NULL,
  slug        text NOT NULL,
  parent_id   bigint REFERENCES taxonomy_entities(id),  -- hierarchy: country→region→subregion→appellation
  -- Shared metadata (not scope-specific)
  latitude    numeric,
  longitude   numeric,
  iso_code    text,                          -- for countries: 'FR', 'JP'
  image_url   text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, slug)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_entities_type ON taxonomy_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_taxonomy_entities_parent ON taxonomy_entities(parent_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_entities_slug ON taxonomy_entities(slug);

-- 5. TAXONOMY CONTEXTS — The core: scope-specific knowledge per entity
-- "France for wine" vs "France for spirits" = 2 different context rows
-- Only create rows where relevant (no "Scotland for wine")
CREATE TABLE IF NOT EXISTS taxonomy_contexts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  scope_id    text NOT NULL REFERENCES scopes(id),
  -- Content
  description_en    text,                    -- rich text, Wikipedia-reference style
  description_short text,                    -- 1-2 sentence summary
  -- Dynamic attributes stored as JSON (keys defined by scope_attribute_defs)
  attributes        jsonb NOT NULL DEFAULT '{}',
  -- Metadata
  status            text NOT NULL DEFAULT 'draft',  -- draft|validated|published
  validated_by      text,
  validated_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_contexts_scope ON taxonomy_contexts(scope_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_contexts_status ON taxonomy_contexts(status);

-- 6. TAXONOMY BENCHMARKS — Typical character profile per entity per scope
-- "Bordeaux wine typically has body=4, tannin=4, acidity=3"
-- Used to: (a) pre-fill new products, (b) compare product vs region benchmark
CREATE TABLE IF NOT EXISTS taxonomy_benchmarks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  context_id    bigint NOT NULL REFERENCES taxonomy_contexts(id) ON DELETE CASCADE,
  dimension_id  text NOT NULL REFERENCES character_dimensions(id),
  typical_value numeric NOT NULL,            -- the "expected" value
  range_low     numeric,                     -- acceptable range low
  range_high    numeric,                     -- acceptable range high
  UNIQUE(context_id, dimension_id)
);

-- 7. TAXONOMY RELATIONSHIPS — Flexible entity-to-entity links
-- grape "grows_in" region, brand "headquartered_in" country
-- region "known_for" grape, style "originates_from" region
CREATE TABLE IF NOT EXISTS taxonomy_relationships (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_entity_id  bigint NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  to_entity_id    bigint NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  relationship    text NOT NULL,             -- 'grows_in', 'produced_by', 'known_for', 'pairs_with'
  scope_id        text REFERENCES scopes(id),-- optional: relationship may be scope-specific
  metadata        jsonb DEFAULT '{}',        -- extra context: {"dominance": "primary"}
  UNIQUE(from_entity_id, to_entity_id, relationship, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_rel_from ON taxonomy_relationships(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_rel_to ON taxonomy_relationships(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_rel_type ON taxonomy_relationships(relationship);

-- 8. PRODUCT VINTAGES — Vintage-specific data per product
-- Separate from the base product; each vintage can have its own description,
-- character profile, price, and availability
CREATE TABLE IF NOT EXISTS product_vintages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku_base        text NOT NULL,             -- FK to products.sku_base
  vintage_year    int NOT NULL,
  -- Vintage-specific content
  description_en  text,                      -- tasting notes for THIS vintage
  -- Vintage-specific character (overrides base product when present)
  character       jsonb,                     -- {"body": 4.5, "acidity": 3, "tannin": 4}
  -- Commercial
  price           numeric,
  cost_price      numeric,
  availability    text DEFAULT 'available',  -- available|limited|sold_out|pre_order
  is_current      boolean NOT NULL DEFAULT false,
  -- Quality
  rating_score    numeric,                   -- internal or aggregated score
  rating_source   text,                      -- 'internal', 'wine_spectator', etc.
  -- Meta
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sku_base, vintage_year)
);

CREATE INDEX IF NOT EXISTS idx_product_vintages_base ON product_vintages(sku_base);
CREATE INDEX IF NOT EXISTS idx_product_vintages_current ON product_vintages(is_current) WHERE is_current = true;

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Scopes
INSERT INTO scopes (id, label, description, icon, sort_order) VALUES
  ('wine',          'Wine',           'Grape-based wines including still, sparkling, fortified, and dessert',  '🍷', 1),
  ('spirits',       'Spirits',        'Distilled spirits including whisky, gin, vodka, rum, tequila, brandy', '🥃', 2),
  ('sake',          'Sake & Shochu',  'Japanese rice-based beverages',                                        '🍶', 3),
  ('beer',          'Beer',           'Brewed beverages from grain and hops',                                 '🍺', 4),
  ('asian_spirits', 'Asian Spirits',  'Traditional Asian spirits: soju, baijiu, Thai white spirits',          '🫗', 5),
  ('non_alc',       'Non-Alcoholic',  'Non-alcoholic beverages and dealcoholized products',                   '🧃', 6),
  ('accessories',   'Accessories',    'Glassware, tools, cigars, and related accessories',                    '🔧', 7)
ON CONFLICT (id) DO NOTHING;

-- Classification → Scope mapping
INSERT INTO classification_scope_map (classification, scope_id, sort_order) VALUES
  ('Red Wine',          'wine', 1),
  ('White Wine',        'wine', 2),
  ('Rose Wine',         'wine', 3),
  ('Sparkling Wine',    'wine', 4),
  ('Champagne',         'wine', 5),
  ('Dessert Wine',      'wine', 6),
  ('Orange Wine',       'wine', 7),
  ('Port Wine',         'wine', 8),
  ('Fruit Wine',        'wine', 9),
  ('Whisky',            'spirits', 10),
  ('Gin',               'spirits', 11),
  ('Vodka',             'spirits', 12),
  ('Rum',               'spirits', 13),
  ('Tequila',           'spirits', 14),
  ('Brandy',            'spirits', 15),
  ('Liqueur',           'spirits', 16),
  ('White Spirits',     'spirits', 17),
  ('Sake/Shochu',       'sake', 18),
  ('Beer',              'beer', 19),
  ('Korean Wine',       'asian_spirits', 20),
  ('Chinese Spirits',   'asian_spirits', 21),
  ('Thai White Spirits','asian_spirits', 22),
  ('Ready to Drink',    'non_alc', 23),
  ('Non-Alcoholic',     'non_alc', 24),
  ('Mineral Water',     'non_alc', 25),
  ('Accessories',       'accessories', 26),
  ('Glassware',         'accessories', 27),
  ('Cigar',             'accessories', 28),
  ('Events',            'accessories', 29),
  ('Others',            'accessories', 30)
ON CONFLICT (classification) DO NOTHING;

-- Character dimensions — WINE
INSERT INTO character_dimensions (id, scope_id, dimension_key, label, description, min_value, max_value, sort_order) VALUES
  ('wine.body',      'wine', 'body',      'Body',      'Perceived weight and richness on the palate, from light to full',              0, 5, 1),
  ('wine.acidity',   'wine', 'acidity',   'Acidity',   'Crispness and freshness; higher acidity feels tart and lively',               0, 5, 2),
  ('wine.tannin',    'wine', 'tannin',    'Tannin',    'Astringent, drying sensation from grape skins and oak; reds have more',       0, 5, 3),
  ('wine.sweetness', 'wine', 'sweetness', 'Sweetness', 'Residual sugar level from bone-dry to lusciously sweet',                      0, 5, 4),
  ('wine.alcohol',   'wine', 'alcohol',   'Alcohol',   'Warmth and viscosity from alcohol content',                                   0, 5, 5),
  ('wine.intensity', 'wine', 'intensity', 'Intensity', 'Aromatic and flavor concentration; how expressive the wine is',               0, 5, 6),
  ('wine.complexity','wine', 'complexity','Complexity', 'Number and interplay of distinct flavors; simple vs multi-layered',           0, 5, 7),
  ('wine.finish',    'wine', 'finish',    'Finish',    'How long flavors linger after swallowing; short to exceptionally long',        0, 5, 8)
ON CONFLICT (id) DO NOTHING;

-- Character dimensions — SPIRITS
INSERT INTO character_dimensions (id, scope_id, dimension_key, label, description, min_value, max_value, sort_order) VALUES
  ('spirits.body',       'spirits', 'body',       'Body',       'Weight and mouthfeel from light and crisp to rich and oily',           0, 5, 1),
  ('spirits.sweetness',  'spirits', 'sweetness',  'Sweetness',  'Perceived sweetness from dry to noticeably sweet',                     0, 5, 2),
  ('spirits.smoke',      'spirits', 'smoke',      'Smoke',      'Smoky character from peat, charred casks, or production method',       0, 5, 3),
  ('spirits.spice',      'spirits', 'spice',      'Spice',      'Warm spice notes: pepper, cinnamon, clove from spirit or cask',        0, 5, 4),
  ('spirits.complexity', 'spirits', 'complexity', 'Complexity', 'Layered flavors and evolving character in the glass',                  0, 5, 5),
  ('spirits.finish',     'spirits', 'finish',     'Finish',     'Length and character of the aftertaste',                               0, 5, 6),
  ('spirits.oak',        'spirits', 'oak',        'Oak',        'Influence from barrel aging: vanilla, caramel, wood tannin',           0, 5, 7),
  ('spirits.fruit',      'spirits', 'fruit',      'Fruit',      'Fruit-forward character from base ingredient or maturation',           0, 5, 8)
ON CONFLICT (id) DO NOTHING;

-- Character dimensions — SAKE
INSERT INTO character_dimensions (id, scope_id, dimension_key, label, description, min_value, max_value, sort_order) VALUES
  ('sake.body',      'sake', 'body',      'Body',      'Weight from light and delicate to rich and full',                 0, 5, 1),
  ('sake.umami',     'sake', 'umami',     'Umami',     'Savory depth and richness characteristic of rice-based brewing',  0, 5, 2),
  ('sake.sweetness', 'sake', 'sweetness', 'Sweetness', 'Residual sweetness measured by Sake Meter Value (SMV)',           0, 5, 3),
  ('sake.acidity',   'sake', 'acidity',   'Acidity',   'Crispness that balances sweetness and umami',                     0, 5, 4),
  ('sake.fragrance', 'sake', 'fragrance', 'Fragrance', 'Aromatic intensity from fruity-floral to subtle and clean',       0, 5, 5),
  ('sake.finish',    'sake', 'finish',    'Finish',    'Lingering aftertaste and overall balance',                        0, 5, 6)
ON CONFLICT (id) DO NOTHING;

-- Character dimensions — BEER
INSERT INTO character_dimensions (id, scope_id, dimension_key, label, description, min_value, max_value, sort_order) VALUES
  ('beer.body',       'beer', 'body',       'Body',       'Mouthfeel from thin and watery to thick and chewy',              0, 5, 1),
  ('beer.bitterness', 'beer', 'bitterness', 'Bitterness', 'Hop bitterness measured in IBU equivalence',                     0, 5, 2),
  ('beer.sweetness',  'beer', 'sweetness',  'Sweetness',  'Malt-derived sweetness from dry to sweet',                       0, 5, 3),
  ('beer.carbonation','beer', 'carbonation','Carbonation', 'Effervescence from flat to highly sparkling',                    0, 5, 4),
  ('beer.roast',      'beer', 'roast',      'Roast',      'Roasted malt character from pale to deeply toasted',             0, 5, 5),
  ('beer.fruit',      'beer', 'fruit',      'Fruit',      'Fruity esters from yeast or fruit additions',                    0, 5, 6)
ON CONFLICT (id) DO NOTHING;

-- Scope attribute definitions — WINE
INSERT INTO scope_attribute_defs (id, scope_id, attribute_key, label, data_type, is_required, sort_order) VALUES
  ('wine.key_grapes',     'wine', 'key_grapes',     'Key Grape Varieties',  'text[]',  true,  1),
  ('wine.terroir',        'wine', 'terroir',        'Terroir',              'text',    false, 2),
  ('wine.climate',        'wine', 'climate',        'Climate',              'text',    false, 3),
  ('wine.soil',           'wine', 'soil',           'Soil Types',           'text',    false, 4),
  ('wine.classification_system', 'wine', 'classification_system', 'Classification System', 'text', false, 5),
  ('wine.aging_potential', 'wine', 'aging_potential','Aging Potential',      'text',    false, 6),
  ('wine.production_method','wine','production_method','Production Method',  'text',    false, 7)
ON CONFLICT (id) DO NOTHING;

-- Scope attribute definitions — SPIRITS
INSERT INTO scope_attribute_defs (id, scope_id, attribute_key, label, data_type, is_required, sort_order) VALUES
  ('spirits.distillation_method','spirits','distillation_method','Distillation Method','text',    true,  1),
  ('spirits.base_ingredient',    'spirits','base_ingredient',    'Base Ingredient',    'text',    true,  2),
  ('spirits.aging_tradition',    'spirits','aging_tradition',    'Aging Tradition',    'text',    false, 3),
  ('spirits.cask_types',         'spirits','cask_types',         'Cask Types',         'text[]',  false, 4),
  ('spirits.key_styles',         'spirits','key_styles',         'Key Styles',         'text[]',  false, 5),
  ('spirits.regulation',         'spirits','regulation',         'Regulation/Standards','text',    false, 6)
ON CONFLICT (id) DO NOTHING;

-- Scope attribute definitions — SAKE
INSERT INTO scope_attribute_defs (id, scope_id, attribute_key, label, data_type, is_required, sort_order) VALUES
  ('sake.rice_varieties',  'sake', 'rice_varieties',  'Rice Varieties',    'text[]', true,  1),
  ('sake.water_source',    'sake', 'water_source',    'Water Source',      'text',   false, 2),
  ('sake.polishing_ratio', 'sake', 'polishing_ratio', 'Polishing Ratio',  'text',   false, 3),
  ('sake.brewing_style',   'sake', 'brewing_style',   'Brewing Style',    'text',   false, 4),
  ('sake.grade_system',    'sake', 'grade_system',    'Grade System',     'text',   false, 5)
ON CONFLICT (id) DO NOTHING;
