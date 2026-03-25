# Validation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local rule-based enrichment pipeline that processes 11,564 products in Supabase, extracting classification, geography (country/region/sub-region), appellation, wine profile attributes, and flavor tags from SKU patterns and text descriptions — then assigns validation status based on field completeness.

**Architecture:** Five pure-function stages (SKU → Name → Description → Geography → Score) compose into a single pipeline. Rules live in versioned JSON files under `rules/` — no code change needed to add new patterns. Unknown taxonomy values are written to a `taxonomy_proposals` table for user review via the Taxonomy Queue UI.

**Tech Stack:** TypeScript + tsx (no build step), Supabase REST API direct calls, Next.js App Router for new API routes, React for UI updates. No AI API. No test framework — verification via `npx tsc --noEmit` + dry-run script output.

**Spec:** `docs/superpowers/specs/2026-03-25-validation-pipeline-design.md`

---

## File Map

**Create:**
- `rules/sku-prefixes.json` — SKU prefix → classification + segment
- `rules/grape-varieties.json` — ~200 grape varieties with aliases
- `rules/brands.json` — known producer/brand names
- `rules/regions.json` — Country → Region → Sub-region tree
- `rules/appellations.json` — known AOC/DOC/AVA by country
- `rules/classification-tiers.json` — country-aware wine classification tiers
- `rules/body-keywords.json` — body/acidity/tannin keyword → tier
- `rules/flavor-keywords.json` — flavor category → trigger words
- `rules/food-keywords.json` — food pairing trigger → label
- `lib/validation/types.ts` — shared TypeScript types
- `lib/validation/rules.ts` — loads and caches all JSON rules files
- `lib/validation/stages.ts` — five pure stage functions
- `lib/validation/engine.ts` — composes stages, scores, assigns status
- `scripts/run-validation.ts` — CLI entry point with progress output
- `scripts/migration_add_validation_columns.sql` — new DB columns + taxonomy_proposals table + upsert RPC
- `app/api/taxonomy-proposals/route.ts` — GET list + PATCH approve/reject
- `app/api/run-pipeline/route.ts` — spawns validation script, streams output to UI

**Modify:**
- `components/pages/TaxonomyQueuePage.tsx` — add Proposals tab showing taxonomy_proposals
- `components/pages/ProcessingReviewPage.tsx` — add pipeline run button + live progress
- `components/pages/ProductsPage.tsx` — show subregion, appellation, wine_classification, flavor_tags in Details tab

---

## Task 1: Database Migration

**Files:**
- Create: `scripts/migration_add_validation_columns.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- scripts/migration_add_validation_columns.sql
-- Run ONCE in Supabase SQL Editor before running the validation pipeline.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS subregion            TEXT,
  ADD COLUMN IF NOT EXISTS appellation          TEXT,
  ADD COLUMN IF NOT EXISTS wine_classification  TEXT,
  ADD COLUMN IF NOT EXISTS flavor_tags          TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_note      TEXT;

CREATE INDEX IF NOT EXISTS idx_products_subregion   ON products (subregion);
CREATE INDEX IF NOT EXISTS idx_products_appellation ON products (appellation);

CREATE TABLE IF NOT EXISTS taxonomy_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  parent_path    TEXT NOT NULL DEFAULT '',
  source_sku     TEXT,
  occurrences    INT DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT,
  UNIQUE(type, proposed_value, parent_path)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_status ON taxonomy_proposals (status);
CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_type   ON taxonomy_proposals (type);

-- RPC for atomic occurrence increment on conflict.
-- PostgREST's resolution=merge-duplicates overwrites columns — it cannot do arithmetic.
-- This function must be created before running the validation script.
CREATE OR REPLACE FUNCTION upsert_taxonomy_proposal(
  p_type           TEXT,
  p_proposed_value TEXT,
  p_parent_path    TEXT,
  p_source_sku     TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO taxonomy_proposals (type, proposed_value, parent_path, source_sku, occurrences)
  VALUES (p_type, p_proposed_value, p_parent_path, p_source_sku, 1)
  ON CONFLICT (type, proposed_value, parent_path)
  DO UPDATE SET
    occurrences = taxonomy_proposals.occurrences + 1,
    source_sku  = EXCLUDED.source_sku;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Run the migration**

Open Supabase SQL Editor at your project dashboard and paste + run the file contents.

Expected: All statements complete with no errors. "ADD COLUMN" statements are idempotent (`IF NOT EXISTS`).

- [ ] **Step 3: Verify columns exist**

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/products?select=subregion,appellation,wine_classification,flavor_tags,enrichment_note&limit=1" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"
```

Expected: JSON array with one object containing those five keys (values may be null).

- [ ] **Step 4: Commit**

```bash
git add scripts/migration_add_validation_columns.sql
git commit -m "feat: add validation pipeline DB migration (new columns + taxonomy_proposals)"
```

---

## Task 2: Rules Knowledge Base (JSON Files)

**Files:**
- Create: `rules/sku-prefixes.json`
- Create: `rules/body-keywords.json`
- Create: `rules/flavor-keywords.json`
- Create: `rules/food-keywords.json`
- Create: `rules/grape-varieties.json`
- Create: `rules/brands.json`
- Create: `rules/regions.json`
- Create: `rules/appellations.json`
- Create: `rules/classification-tiers.json`

- [ ] **Step 1: Create `rules/sku-prefixes.json`**

```json
[
  { "prefix": "WRW", "classification": "Red Wine",      "segment": "wine" },
  { "prefix": "WWW", "classification": "White Wine",    "segment": "wine" },
  { "prefix": "WSP", "classification": "Sparkling Wine","segment": "wine" },
  { "prefix": "WRS", "classification": "Rosé Wine",     "segment": "wine" },
  { "prefix": "WDW", "classification": "Dessert Wine",  "segment": "wine" },
  { "prefix": "LBE", "classification": "Beer",          "segment": "beer" },
  { "prefix": "LWH", "classification": "Whisky",        "segment": "spirits" },
  { "prefix": "LGN", "classification": "Gin",           "segment": "spirits" },
  { "prefix": "LRM", "classification": "Rum",           "segment": "spirits" },
  { "prefix": "LTQ", "classification": "Tequila",       "segment": "spirits" },
  { "prefix": "LVK", "classification": "Vodka",         "segment": "spirits" },
  { "prefix": "LLQ", "classification": "Liqueur",       "segment": "spirits" },
  { "prefix": "LBD", "classification": "Brandy",        "segment": "spirits" },
  { "prefix": "LSK", "classification": "Sake",          "segment": "spirits" },
  { "prefix": "LOT", "classification": "Other Spirit",  "segment": "spirits" },
  { "prefix": "ABA", "classification": "Accessory",     "segment": "accessories" },
  { "prefix": "AWC", "classification": "Accessory",     "segment": "accessories" },
  { "prefix": "GWN", "classification": "Glassware",     "segment": "accessories" },
  { "prefix": "GLQ", "classification": "Glassware",     "segment": "accessories" },
  { "prefix": "GBE", "classification": "Glassware",     "segment": "accessories" },
  { "prefix": "NNA", "classification": "Non-Alcoholic", "segment": "other" }
]
```

Note: array is sorted longest-prefix-first. The engine matches the first entry whose prefix matches the start of the SKU.

- [ ] **Step 2: Create `rules/body-keywords.json`**

```json
{
  "wine_body": {
    "light":  ["light-bodied", "light body", "delicate", "lightweight", "ethereal", "light and fresh"],
    "medium": ["medium-bodied", "medium body", "medium weight", "balanced body"],
    "full":   ["full-bodied", "full body", "rich and full", "powerful", "robust", "weighty", "opulent", "concentrated"]
  },
  "wine_acidity": {
    "low":    ["low acidity", "soft acidity", "round", "supple", "low acid"],
    "medium": ["medium acidity", "fresh", "lively", "balanced acidity", "moderate acidity"],
    "high":   ["high acidity", "crisp", "vibrant", "zesty", "sharp", "racy", "bright acidity", "steely"]
  },
  "wine_tannin": {
    "low":    ["soft tannins", "silky", "smooth", "velvety", "low tannin", "gentle tannins", "fine tannins"],
    "medium": ["medium tannins", "firm tannins", "structured", "moderate tannins"],
    "high":   ["grippy", "tannic", "astringent", "tight tannins", "chewy", "powerful tannins", "robust tannins"]
  }
}
```

- [ ] **Step 3: Create `rules/flavor-keywords.json`**

```json
{
  "fruit":   ["cherry", "plum", "berry", "blackcurrant", "raspberry", "strawberry", "peach", "apricot", "citrus", "apple", "pear", "fig", "mango", "tropical", "blueberry", "blackberry", "pomegranate", "lychee", "passionfruit", "melon", "watermelon", "redcurrant"],
  "spice":   ["pepper", "black pepper", "spice", "clove", "cinnamon", "nutmeg", "vanilla", "anise", "licorice", "cardamom", "ginger", "bay leaf"],
  "herbal":  ["herb", "herbal", "mint", "eucalyptus", "thyme", "grass", "green", "sage", "rosemary", "bay", "dried herbs"],
  "earth":   ["earth", "earthy", "soil", "mushroom", "truffle", "leather", "tobacco", "forest floor", "undergrowth", "wet leaves"],
  "oak":     ["oak", "cedar", "wood", "smoke", "smoky", "toast", "toasty", "charcoal", "coffee", "cocoa", "chocolate"],
  "floral":  ["floral", "rose", "violet", "jasmine", "blossom", "flower", "lavender", "acacia", "elderflower"],
  "mineral": ["mineral", "minerality", "chalk", "flint", "stone", "slate", "wet stone", "gravel", "iodine", "saline"]
}
```

- [ ] **Step 4: Create `rules/food-keywords.json`**

```json
{
  "Red Meat":    ["beef", "steak", "lamb", "venison", "red meat", "grilled meat", "roast beef", "hock", "veal"],
  "Poultry":     ["chicken", "turkey", "duck", "poultry", "game bird"],
  "Seafood":     ["fish", "seafood", "salmon", "tuna", "shellfish", "oyster", "lobster", "prawn", "crab", "sea bass"],
  "Cheese":      ["cheese", "fromage", "charcuterie", "terrines", "blue cheese"],
  "Pork":        ["pork", "ham", "bacon", "sausage", "charcuterie", "smoked pork"],
  "Dessert":     ["dessert", "chocolate", "cake", "sweet", "pastry", "ice cream", "fruit tart"],
  "Pasta":       ["pasta", "risotto", "pizza", "italian food"],
  "Vegetables":  ["vegetables", "salad", "vegetarian", "mushroom", "grilled vegetables"],
  "Spicy Food":  ["spicy", "thai food", "indian food", "curry", "asian food"],
  "Aperitif":    ["aperitif", "aperitivo", "starter", "canapé", "nibbles"]
}
```

- [ ] **Step 5: Create `rules/grape-varieties.json`**

```json
[
  { "name": "Cabernet Sauvignon", "aliases": ["Cab Sauv", "Cabernet-Sauvignon", "Cab. Sauvignon"] },
  { "name": "Merlot",             "aliases": [] },
  { "name": "Pinot Noir",         "aliases": ["Pinot-Noir", "Spätburgunder", "Spatburgunder", "Pinot Nero", "Blauburgunder"] },
  { "name": "Syrah",              "aliases": ["Shiraz", "Syrah/Shiraz"] },
  { "name": "Grenache",           "aliases": ["Garnacha", "Grenache Noir"] },
  { "name": "Malbec",             "aliases": ["Côt", "Auxerrois"] },
  { "name": "Tempranillo",        "aliases": ["Tinto Fino", "Tinta del País", "Ull de Llebre"] },
  { "name": "Sangiovese",         "aliases": ["Brunello", "Prugnolo", "Morellino"] },
  { "name": "Nebbiolo",           "aliases": [] },
  { "name": "Barbera",            "aliases": [] },
  { "name": "Montepulciano",      "aliases": [] },
  { "name": "Zinfandel",          "aliases": ["Primitivo"] },
  { "name": "Pinotage",           "aliases": [] },
  { "name": "Carménère",          "aliases": ["Carmenere"] },
  { "name": "Chardonnay",         "aliases": [] },
  { "name": "Sauvignon Blanc",    "aliases": ["Sauvignon-Blanc", "Fumé Blanc", "Fume Blanc"] },
  { "name": "Riesling",           "aliases": [] },
  { "name": "Pinot Gris",         "aliases": ["Pinot Grigio", "Grauburgunder", "Tokay Pinot Gris"] },
  { "name": "Gewurztraminer",     "aliases": ["Gewürztraminer"] },
  { "name": "Viognier",           "aliases": [] },
  { "name": "Muscat",             "aliases": ["Moscato", "Muscat Blanc", "Muskat"] },
  { "name": "Chenin Blanc",       "aliases": ["Steen"] },
  { "name": "Semillon",           "aliases": ["Sémillon"] },
  { "name": "Albariño",           "aliases": ["Albarino", "Albarin"] },
  { "name": "Grüner Veltliner",   "aliases": ["Gruner Veltliner", "Grüner"] },
  { "name": "Torrontés",          "aliases": ["Torrontes"] },
  { "name": "Vermentino",         "aliases": [] },
  { "name": "Fiano",              "aliases": [] },
  { "name": "Greco",              "aliases": [] },
  { "name": "Roussanne",          "aliases": [] },
  { "name": "Marsanne",           "aliases": [] },
  { "name": "Grenache Blanc",     "aliases": [] },
  { "name": "Mauzac",             "aliases": [] },
  { "name": "Petit Verdot",       "aliases": [] },
  { "name": "Cabernet Franc",     "aliases": ["Cab Franc"] },
  { "name": "Mourvèdre",          "aliases": ["Mourvedre", "Monastrell"] },
  { "name": "Cinsault",           "aliases": ["Cinsaut"] },
  { "name": "Carignan",           "aliases": ["Cariñena", "Mazuelo"] },
  { "name": "Gamay",              "aliases": [] },
  { "name": "Melon de Bourgogne", "aliases": ["Muscadet"] },
  { "name": "Verdicchio",         "aliases": [] },
  { "name": "Aglianico",          "aliases": [] },
  { "name": "Nero d'Avola",       "aliases": ["Nero d Avola"] },
  { "name": "Primitivo",          "aliases": [] },
  { "name": "Touriga Nacional",   "aliases": [] },
  { "name": "Tempranillo Blanco", "aliases": [] }
]
```

- [ ] **Step 6: Create `rules/brands.json`**

This is a starter list; add entries as products are processed.

```json
[
  "Château Margaux", "Château Latour", "Château Pétrus", "Château Mouton Rothschild",
  "Château Haut-Brion", "Château Lafite Rothschild", "Château Ausone",
  "Domaine de la Romanée-Conti", "Domaine Leflaive", "Domaine Leroy",
  "Louis Jadot", "Joseph Drouhin", "Bouchard Père & Fils",
  "Antinori", "Sassicaia", "Ornellaia", "Tignanello",
  "Gaja", "Bruno Giacosa", "Marchesi di Barolo",
  "Torres", "Vega Sicilia", "Pingus",
  "Penfolds", "Leeuwin Estate", "Henschke",
  "Robert Mondavi", "Opus One", "Screaming Eagle",
  "Concha y Toro", "Almaviva", "Montes",
  "Clos de los Siete", "Catena Zapata",
  "Max Ferd. Richter", "Rainer Wess", "Antech", "Vinturi"
]
```

- [ ] **Step 7: Create `rules/regions.json`**

```json
{
  "France": {
    "Bordeaux":  { "aliases": ["Bx"], "sub_regions": ["Médoc", "Haut-Médoc", "Pomerol", "Saint-Émilion", "Graves", "Sauternes", "Margaux", "Pauillac", "Saint-Julien", "Saint-Estèphe", "Pessac-Léognan", "Fronsac", "Côtes de Bourg", "Blaye"] },
    "Burgundy":  { "aliases": ["Bourgogne"], "sub_regions": ["Côte de Nuits", "Côte de Beaune", "Côte Chalonnaise", "Mâconnais", "Chablis", "Beaujolais"] },
    "Champagne": { "aliases": [], "sub_regions": ["Montagne de Reims", "Vallée de la Marne", "Côte des Blancs", "Aube"] },
    "Rhône":     { "aliases": ["Rhone", "Côtes du Rhône", "Cotes du Rhone"], "sub_regions": ["Northern Rhône", "Southern Rhône", "Châteauneuf-du-Pape", "Gigondas", "Vacqueyras", "Crozes-Hermitage", "Hermitage", "Côte-Rôtie", "Condrieu"] },
    "Alsace":    { "aliases": [], "sub_regions": [] },
    "Loire":     { "aliases": ["Loire Valley"], "sub_regions": ["Sancerre", "Pouilly-Fumé", "Muscadet", "Anjou", "Touraine", "Chinon", "Bourgueil", "Vouvray", "Montlouis"] },
    "Provence":  { "aliases": [], "sub_regions": ["Bandol", "Cassis", "Les Baux de Provence"] },
    "Languedoc": { "aliases": ["Languedoc-Roussillon", "Pays d'Oc", "IGP Pays d OC"], "sub_regions": ["Faugères", "Saint-Chinian", "Corbières", "Minervois", "Limoux"] },
    "Southwest": { "aliases": ["Sud-Ouest"], "sub_regions": ["Cahors", "Madiran", "Bergerac"] }
  },
  "Italy": {
    "Tuscany":   { "aliases": ["Toscana"], "sub_regions": ["Chianti", "Chianti Classico", "Montalcino", "Montepulciano", "Bolgheri", "Maremma", "Brunello", "Vino Nobile"] },
    "Piedmont":  { "aliases": ["Piemonte"], "sub_regions": ["Barolo", "Barbaresco", "Asti", "Langhe", "Monferrato", "Moscato d'Asti"] },
    "Veneto":    { "aliases": [], "sub_regions": ["Amarone", "Valpolicella", "Soave", "Prosecco", "Bardolino"] },
    "Sicily":    { "aliases": ["Sicilia"], "sub_regions": ["Etna", "Marsala", "Nero d'Avola"] },
    "Campania":  { "aliases": [], "sub_regions": ["Taurasi", "Fiano di Avellino", "Greco di Tufo"] },
    "Friuli":    { "aliases": ["Friuli-Venezia Giulia"], "sub_regions": ["Collio", "Friuli Colli Orientali"] }
  },
  "Spain": {
    "Rioja":             { "aliases": ["La Rioja"], "sub_regions": ["Rioja Alta", "Rioja Alavesa", "Rioja Oriental"] },
    "Ribera del Duero":  { "aliases": [], "sub_regions": [] },
    "Priorat":           { "aliases": ["Priorat DOCa"], "sub_regions": [] },
    "Rías Baixas":       { "aliases": ["Rias Baixas"], "sub_regions": [] },
    "Jerez":             { "aliases": ["Sherry", "Xerez"], "sub_regions": [] },
    "Penedès":           { "aliases": ["Penedes"], "sub_regions": [] },
    "Rueda":             { "aliases": [], "sub_regions": [] }
  },
  "Germany": {
    "Mosel":       { "aliases": ["Moselle"], "sub_regions": ["Bernkastel", "Piesport", "Wehlen", "Brauneberg", "Saar", "Ruwer"] },
    "Rheingau":    { "aliases": [], "sub_regions": ["Rüdesheim", "Johannisberg", "Hochheim", "Eltville"] },
    "Rheinhessen": { "aliases": [], "sub_regions": ["Nierstein", "Oppenheim", "Alzey"] },
    "Pfalz":       { "aliases": [], "sub_regions": ["Forst", "Deidesheim", "Ruppertsberg", "Wachenheim"] },
    "Baden":       { "aliases": [], "sub_regions": ["Kaiserstuhl", "Breisgau"] },
    "Franken":     { "aliases": ["Franconia"], "sub_regions": [] }
  },
  "Portugal": {
    "Douro":       { "aliases": [], "sub_regions": ["Cima Corgo", "Baixo Corgo", "Douro Superior"] },
    "Alentejo":    { "aliases": [], "sub_regions": [] },
    "Dão":         { "aliases": ["Dao"], "sub_regions": [] },
    "Vinho Verde": { "aliases": [], "sub_regions": [] },
    "Setúbal":     { "aliases": ["Setubal"], "sub_regions": [] }
  },
  "Argentina": {
    "Mendoza":     { "aliases": [], "sub_regions": ["Luján de Cuyo", "Maipú", "Valle de Uco"] },
    "Salta":       { "aliases": [], "sub_regions": ["Cafayate"] },
    "Patagonia":   { "aliases": [], "sub_regions": [] }
  },
  "Chile": {
    "Maipo":       { "aliases": ["Maipo Valley"], "sub_regions": [] },
    "Colchagua":   { "aliases": ["Colchagua Valley"], "sub_regions": [] },
    "Casablanca":  { "aliases": ["Casablanca Valley"], "sub_regions": [] },
    "Maule":       { "aliases": ["Maule Valley"], "sub_regions": [] }
  },
  "Australia": {
    "Barossa":     { "aliases": ["Barossa Valley"], "sub_regions": ["Eden Valley"] },
    "Clare":       { "aliases": ["Clare Valley"], "sub_regions": [] },
    "Hunter":      { "aliases": ["Hunter Valley"], "sub_regions": [] },
    "Yarra":       { "aliases": ["Yarra Valley"], "sub_regions": [] },
    "Coonawarra":  { "aliases": [], "sub_regions": [] },
    "Margaret River": { "aliases": [], "sub_regions": [] }
  },
  "New Zealand": {
    "Marlborough":  { "aliases": [], "sub_regions": [] },
    "Hawke's Bay":  { "aliases": ["Hawkes Bay"], "sub_regions": [] },
    "Central Otago":{ "aliases": [], "sub_regions": [] }
  },
  "USA": {
    "Napa":         { "aliases": ["Napa Valley"], "sub_regions": ["Stags Leap", "Rutherford", "Oakville", "St. Helena", "Calistoga"] },
    "Sonoma":       { "aliases": ["Sonoma County"], "sub_regions": ["Russian River Valley", "Alexander Valley", "Dry Creek Valley"] },
    "Willamette":   { "aliases": ["Willamette Valley"], "sub_regions": [] },
    "Washington":   { "aliases": ["Columbia Valley"], "sub_regions": [] }
  },
  "South Africa": {
    "Stellenbosch": { "aliases": [], "sub_regions": [] },
    "Franschhoek":  { "aliases": [], "sub_regions": [] },
    "Swartland":    { "aliases": [], "sub_regions": [] }
  }
}
```

- [ ] **Step 8: Create `rules/appellations.json`**

```json
{
  "France": ["AOC", "AOP", "Saint-Émilion Grand Cru", "Pomerol", "Pauillac", "Margaux", "Saint-Julien", "Saint-Estèphe", "Gevrey-Chambertin", "Chambolle-Musigny", "Vosne-Romanée", "Nuits-Saint-Georges", "Puligny-Montrachet", "Meursault", "Chassagne-Montrachet", "Chablis Premier Cru", "Chablis Grand Cru", "Châteauneuf-du-Pape", "Hermitage", "Côte-Rôtie", "Sancerre", "Pouilly-Fumé", "Vouvray", "Muscadet"],
  "Italy": ["DOC", "DOCG", "Barolo", "Barbaresco", "Brunello di Montalcino", "Vino Nobile di Montepulciano", "Chianti Classico", "Amarone della Valpolicella", "Prosecco", "Franciacorta", "Soave Classico", "Taurasi"],
  "Spain": ["DOCa", "DO", "Rioja DOCa", "Priorat DOCa", "Rías Baixas DO", "Ribera del Duero DO", "Penedès DO"],
  "Germany": ["QbA", "Prädikatswein", "Kabinett", "Spätlese", "Auslese", "Beerenauslese", "Trockenbeerenauslese", "Eiswein", "Sekt"],
  "Portugal": ["DOC", "Porto", "Douro DOC", "Vinho Verde DOC", "Dão DOC", "Alentejo DOC"],
  "USA": ["AVA", "Napa Valley AVA", "Sonoma Coast AVA", "Russian River Valley AVA", "Willamette Valley AVA"],
  "Australia": ["GI", "Barossa Valley GI", "Clare Valley GI", "Coonawarra GI", "Margaret River GI"]
}
```

- [ ] **Step 9: Create `rules/classification-tiers.json`**

```json
{
  "France": {
    "Bordeaux": ["Grand Cru Classé", "Premier Grand Cru Classé", "Premier Cru Classé", "Deuxième Cru Classé", "Troisième Cru Classé", "Quatrième Cru Classé", "Cinquième Cru Classé", "Cru Bourgeois Exceptionnel", "Cru Bourgeois Supérieur", "Cru Bourgeois", "Cru Artisan"],
    "Burgundy": ["Grand Cru", "Premier Cru", "1er Cru", "Village", "Régionale"],
    "Champagne": ["Grand Cru", "Premier Cru"],
    "Alsace": ["Grand Cru"]
  },
  "Italy": {
    "_any": ["DOCG", "DOC", "IGT", "IGP"]
  },
  "Spain": {
    "_any": ["DOCa", "DO", "Gran Reserva", "Reserva", "Crianza", "Joven", "Vino de Pago"]
  },
  "Germany": {
    "_any": ["Große Lage", "GG", "Grosses Gewächs", "Erste Lage", "Ortswein", "Gutswein", "Trockenbeerenauslese", "TBA", "Beerenauslese", "BA", "Eiswein", "Auslese", "Spätlese", "Kabinett", "QbA"]
  },
  "Portugal": {
    "_any": ["DOC", "VR", "Vintage", "LBV", "Late Bottled Vintage", "Colheita", "Tawny", "Ruby"]
  }
}
```

- [ ] **Step 10: Verify all JSON files parse correctly**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
for f in rules/*.json; do
  python3 -c "import json; json.load(open('$f'))" && echo "✓ $f" || echo "✗ $f INVALID"
done
```

Expected: all files print `✓`.

- [ ] **Step 11: Commit**

```bash
git add rules/
git commit -m "feat: add validation pipeline rules knowledge base (9 JSON files)"
```

---

## Task 3: Validation Engine (TypeScript Library)

**Files:**
- Create: `lib/validation/types.ts`
- Create: `lib/validation/rules.ts`
- Create: `lib/validation/stages.ts`
- Create: `lib/validation/engine.ts`

- [ ] **Step 1: Create `lib/validation/types.ts`**

```typescript
// lib/validation/types.ts

export type Segment = 'wine' | 'spirits' | 'beer' | 'accessories' | 'other';

export type ValidationStatus = 'raw' | 'needs_review' | 'needs_attention' | 'validated';

export type Product = Record<string, any>;

// What the pipeline writes back — only fields it extracted (null-only protection applied by engine)
export interface EnrichmentPatch {
  classification?:     string;
  segment?:            string;
  vintage?:            string;
  alcohol?:            string;
  grape_variety?:      string;
  brand?:              string;
  country?:            string;
  region?:             string;
  subregion?:          string;
  appellation?:        string;
  wine_classification?: string;
  wine_body?:          string;
  wine_acidity?:       string;
  wine_tannin?:        string;
  food_matching?:      string;
  flavor_tags?:        string;   // JSON array string
  validation_status?:  ValidationStatus;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  enrichment_note?:    string;
}

export interface TaxonomyProposal {
  type:           'country' | 'region' | 'sub_region' | 'appellation' | 'classification_tier';
  proposed_value: string;
  parent_path:    string;   // NOT NULL — use '' when no parent context; matches DB column
  source_sku:     string;
}

export interface StageResult {
  patch:     EnrichmentPatch;
  proposals: TaxonomyProposal[];
}

export interface RuleSet {
  skuPrefixes:          Array<{ prefix: string; classification: string; segment: string }>;
  grapeVarieties:       Array<{ name: string; aliases: string[] }>;
  brands:               string[];
  regions:              Record<string, Record<string, { aliases: string[]; sub_regions: string[] }>>;
  appellations:         Record<string, string[]>;
  classificationTiers:  Record<string, Record<string, string[]>>;
  bodyKeywords:         Record<string, Record<string, string[]>>;
  flavorKeywords:       Record<string, string[]>;
  foodKeywords:         Record<string, string[]>;
}
```

- [ ] **Step 2: Create `lib/validation/rules.ts`**

```typescript
// lib/validation/rules.ts
// Loads all JSON rules files once and caches them.

import * as path from 'path';
import * as fs from 'fs';
import type { RuleSet } from './types';

const RULES_DIR = path.resolve(process.cwd(), 'rules');

function load<T>(filename: string): T {
  const filepath = path.join(RULES_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T;
}

let _cached: RuleSet | null = null;

export function getRules(): RuleSet {
  if (_cached) return _cached;
  _cached = {
    skuPrefixes:         load('sku-prefixes.json'),
    grapeVarieties:      load('grape-varieties.json'),
    brands:              load('brands.json'),
    regions:             load('regions.json'),
    appellations:        load('appellations.json'),
    classificationTiers: load('classification-tiers.json'),
    bodyKeywords:        load('body-keywords.json'),
    flavorKeywords:      load('flavor-keywords.json'),
    foodKeywords:        load('food-keywords.json'),
  };
  return _cached;
}

// Call this in tests or if rules files change between runs
export function clearRulesCache(): void {
  _cached = null;
}
```

- [ ] **Step 3: Create `lib/validation/stages.ts`**

```typescript
// lib/validation/stages.ts
// Five pure stage functions — no I/O, no side effects.

import type { Product, StageResult, TaxonomyProposal, RuleSet } from './types';

// ── helpers ──────────────────────────────────────────────────────────────────

function isEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

function textFrom(product: Product): string {
  return [
    product.description_en_text ?? '',
    product.short_description_en ?? '',
  ].join(' ').toLowerCase();
}

// ── Stage 1: SKU Classification ───────────────────────────────────────────────

export function stage1Sku(product: Product, rules: RuleSet): StageResult {
  const patch: StageResult['patch'] = {};
  const sku = (product.sku ?? '').toUpperCase();

  // Sorted longest-prefix-first in the JSON file
  const match = rules.skuPrefixes.find(r => sku.startsWith(r.prefix));
  if (match) {
    if (isEmpty(product.classification)) patch.classification = match.classification;
    if (isEmpty(product.segment))        patch.segment        = match.segment;
  }

  return { patch, proposals: [] };
}

// ── Stage 2: Name Extraction ──────────────────────────────────────────────────

export function stage2Name(product: Product, rules: RuleSet, priorPatch: StageResult['patch']): StageResult {
  const patch: StageResult['patch'] = {};
  const name = (product.name ?? '').trim();
  const segment = priorPatch.segment || product.segment || '';

  // Vintage year
  if (isEmpty(product.vintage)) {
    const m = name.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    if (m) patch.vintage = m[1];
  }

  // Alcohol %
  if (isEmpty(product.alcohol)) {
    const m = name.match(/\b(\d{1,2}\.?\d?)\s*(%|vol|abv)/i);
    if (m) patch.alcohol = m[1];
  }

  // Grape variety (wine only — check aliases too)
  if (segment === 'wine' && isEmpty(product.grape_variety)) {
    const nameLower = name.toLowerCase();
    for (const variety of rules.grapeVarieties) {
      const terms = [variety.name, ...variety.aliases].map(s => s.toLowerCase());
      if (terms.some(t => nameLower.includes(t))) {
        patch.grape_variety = variety.name;
        break;
      }
    }
  }

  // Brand: knowledge base first, then positional
  if (isEmpty(product.brand)) {
    const nameLower = name.toLowerCase();
    const knownBrand = rules.brands.find(b => nameLower.startsWith(b.toLowerCase()));
    if (knownBrand) {
      patch.brand = knownBrand;
    } else {
      // Extract text before first separator: year token, ' - ', or ','
      const sepMatch = name.match(/^(.+?)(?:\s+(?:19|20)\d{2}\b|\s+-\s+|,)/);
      if (sepMatch) {
        const candidate = sepMatch[1].trim();
        if (candidate.length > 1 && candidate.length < 50) patch.brand = candidate;
      }
    }
  }

  return { patch, proposals: [] };
}

// ── Stage 3: Description Keyword Scan ────────────────────────────────────────

export function stage3Description(product: Product, rules: RuleSet): StageResult {
  const patch: StageResult['patch'] = {};
  const text = textFrom(product);

  if (!text.trim()) return { patch, proposals: [] };

  // Wine profile (body / acidity / tannin)
  const profileFields = ['wine_body', 'wine_acidity', 'wine_tannin'] as const;
  for (const field of profileFields) {
    if (isEmpty(product[field])) {
      const tiers = rules.bodyKeywords[field];
      for (const [tier, keywords] of Object.entries(tiers)) {
        if (keywords.some(kw => text.includes(kw))) {
          patch[field] = tier;
          break;
        }
      }
    }
  }

  // Flavor tags
  if (isEmpty(product.flavor_tags)) {
    const matched: string[] = [];
    for (const [category, keywords] of Object.entries(rules.flavorKeywords)) {
      if ((keywords as string[]).some(kw => text.includes(kw))) {
        matched.push(category);
      }
    }
    if (matched.length) patch.flavor_tags = JSON.stringify(matched);
  }

  // Food matching
  if (isEmpty(product.food_matching)) {
    const matched: string[] = [];
    for (const [label, keywords] of Object.entries(rules.foodKeywords)) {
      if ((keywords as string[]).some(kw => text.includes(kw))) {
        matched.push(label);
      }
    }
    if (matched.length) patch.food_matching = matched.join('|');
  }

  return { patch, proposals: [] };
}

// ── Stage 4: Geography, Appellation & Classification Tier ─────────────────────

export function stage4Geography(product: Product, rules: RuleSet, priorPatch: StageResult['patch']): StageResult {
  const patch: StageResult['patch'] = {};
  const proposals: TaxonomyProposal[] = [];

  const country = product.country || priorPatch.country;
  const nameAndDesc = `${product.name ?? ''} ${product.description_en_text ?? ''}`;
  const text = nameAndDesc.toLowerCase();
  const sku = (product.sku ?? '').toUpperCase();

  // Region + Sub-region extraction
  if (country && rules.regions[country]) {
    const countryRegions = rules.regions[country];
    for (const [regionName, regionData] of Object.entries(countryRegions)) {
      const regionTerms = [regionName, ...(regionData.aliases ?? [])].map(s => s.toLowerCase());
      const regionMatched = regionTerms.some(t => text.includes(t));

      if (regionMatched) {
        if (isEmpty(product.region)) patch.region = regionName;

        // Sub-region
        if (isEmpty(product.subregion)) {
          for (const sub of regionData.sub_regions) {
            if (text.includes(sub.toLowerCase())) {
              patch.subregion = sub;
              break;
            }
          }
        }
        break;
      }
    }
  }

  // Appellation
  if (isEmpty(product.appellation) && country && rules.appellations[country]) {
    for (const app of rules.appellations[country]) {
      if (text.includes(app.toLowerCase())) {
        patch.appellation = app;
        break;
      }
    }
  }

  // Classification tier (country-aware)
  if (isEmpty(product.wine_classification) && country) {
    const countryTiers = rules.classificationTiers[country];
    if (countryTiers) {
      const effectiveRegion = patch.region || product.region;
      const tiersToCheck: string[] = [
        ...(effectiveRegion && countryTiers[effectiveRegion] ? countryTiers[effectiveRegion] : []),
        ...(countryTiers['_any'] ?? []),
      ];
      for (const tier of tiersToCheck) {
        if (text.includes(tier.toLowerCase()) || nameAndDesc.includes(tier)) {
          patch.wine_classification = tier;
          break;
        }
      }
    }
  }

  // ── Proposal generation: detect unknown values via text patterns ─────────────

  // 1. Country detection — if still no country, scan for known country names in text
  const resolvedCountry = patch.country || product.country;
  if (!resolvedCountry) {
    const knownCountries = Object.keys(rules.regions);
    for (const c of knownCountries) {
      if (text.includes(c.toLowerCase())) {
        patch.country = c;
        break;
      }
    }
  }

  // 2. Unknown appellation — regex scan for AOC/AOP/DOC/DOCG/DOCa/DO/GI/AVA/QbA markers
  //    If the text contains an appellation-like phrase not in our known list, propose it.
  if (isEmpty(product.appellation) && !patch.appellation) {
    const appellationRe = /\b([\w\s'\u00C0-\u024F-]{2,40}?)\s+(AOC|AOP|DOC|DOCG|DOCa|DO|GI|AVA|QbA|PDO)\b/gi;
    const knownApps = new Set(
      Object.values(rules.appellations).flat().map(s => s.toLowerCase())
    );
    let m: RegExpExecArray | null;
    while ((m = appellationRe.exec(nameAndDesc)) !== null) {
      const candidate = `${m[1].trim()} ${m[2]}`.trim();
      if (candidate.length > 2 && !knownApps.has(candidate.toLowerCase())) {
        proposals.push({
          type:           'appellation',
          proposed_value: candidate,
          parent_path:    (patch.country || product.country) ?? '',
          source_sku:     sku,
        });
        break; // one appellation proposal per product per run
      }
    }
  }

  return { patch, proposals };
}

// ── Stage 5: Confidence Scoring & Status Assignment ───────────────────────────

const EXPECTED_FIELDS: Record<string, string[]> = {
  wine:        ['classification', 'grape_variety', 'country', 'region', 'wine_body', 'wine_acidity', 'wine_tannin'],
  spirits:     ['classification', 'country'],
  beer:        ['classification', 'country'],
  accessories: ['classification'],
  other:       ['classification'],
};

export function stage5Score(
  product: Product,
  allPatches: StageResult['patch'],
  proposals: TaxonomyProposal[],
): StageResult {
  const segment = (allPatches.segment || product.segment || '').toLowerCase();
  const expected = EXPECTED_FIELDS[segment] ?? EXPECTED_FIELDS['other'];

  // Count fields that will be non-null after this run (existing OR newly extracted)
  let filled = 0;
  for (const field of expected) {
    const val = allPatches[field as keyof typeof allPatches] ?? product[field];
    if (!isEmpty(val)) filled++;
  }

  let score = expected.length > 0 ? filled / expected.length : 0;

  // Bonus for appellation/wine_classification
  const hasAppellation = !isEmpty(allPatches.appellation ?? product.appellation);
  const hasClassTier   = !isEmpty(allPatches.wine_classification ?? product.wine_classification);
  if (hasAppellation || hasClassTier) score = Math.min(1.0, score + 0.1);

  const patch: StageResult['patch'] = {
    overall_confidence:  parseFloat(score.toFixed(3)),
    // taxonomy_confidence mirrors overall_confidence — deliberate (no separate formula defined yet)
    taxonomy_confidence: parseFloat(score.toFixed(3)),
  };

  // Determine new status (never downgrade validated; never downgrade needs_attention to raw)
  const current = product.validation_status as string | null;
  if (current !== 'validated') {
    if (score >= 0.75) {
      patch.validation_status = 'validated';
    } else if (score >= 0.40) {
      patch.validation_status = 'needs_review'; // includes upgrade of needs_attention
    } else {
      // score < 0.40 — stay raw, but don't downgrade needs_attention
      if (current !== 'needs_attention' && current !== 'needs_review') {
        // keep raw / null unchanged
      }
    }
  }

  // If any unknown taxonomy values were detected, force needs_review regardless of score
  // (spec requirement: unknown taxonomy → needs_review even if field completeness is high)
  // Guard on `current` so validated products are never touched by this path
  if (proposals.length > 0 && current !== 'validated') {
    patch.validation_status = 'needs_review';
  }

  return { patch, proposals: [] };
}
```

- [ ] **Step 4: Create `lib/validation/engine.ts`**

```typescript
// lib/validation/engine.ts
// Composes the five stages; applies null-only protection; collects proposals.

import { getRules } from './rules';
import { stage1Sku, stage2Name, stage3Description, stage4Geography, stage5Score } from './stages';
import type { Product, EnrichmentPatch, TaxonomyProposal } from './types';

export interface PipelineResult {
  patch:     EnrichmentPatch;
  proposals: TaxonomyProposal[];
}

export function runPipeline(product: Product): PipelineResult {
  const rules = getRules();
  const allProposals: TaxonomyProposal[] = [];

  // Accumulate patch across stages
  let accumulated: EnrichmentPatch = {};

  const s1 = stage1Sku(product, rules);
  accumulated = { ...accumulated, ...s1.patch };

  const s2 = stage2Name(product, rules, accumulated);
  accumulated = { ...accumulated, ...s2.patch };

  const s3 = stage3Description(product, rules);
  accumulated = { ...accumulated, ...s3.patch };
  allProposals.push(...s3.proposals);

  const s4 = stage4Geography(product, rules, accumulated);
  accumulated = { ...accumulated, ...s4.patch };
  allProposals.push(...s4.proposals);

  const s5 = stage5Score(product, accumulated, allProposals);
  accumulated = { ...accumulated, ...s5.patch };

  // Null-only protection: remove keys where product already has a non-null value
  const safePatch: EnrichmentPatch = {};
  for (const [key, value] of Object.entries(accumulated)) {
    const existing = product[key];
    // Always write confidence + status + enrichment_note (these are always updated)
    const alwaysWrite = ['overall_confidence', 'taxonomy_confidence', 'validation_status', 'enrichment_note'];
    if (alwaysWrite.includes(key) || existing === null || existing === undefined || existing === '') {
      (safePatch as any)[key] = value;
    }
  }

  return { patch: safePatch, proposals: allProposals };
}
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validation/
git commit -m "feat: validation engine — 5 pure stage functions + rules loader"
```

---

## Task 4: Run-Validation Script (CLI Entry Point)

**Files:**
- Create: `scripts/run-validation.ts`

- [ ] **Step 1: Create `scripts/run-validation.ts`**

```typescript
/**
 * run-validation.ts
 * ─────────────────
 * Runs the local rules-based enrichment pipeline over all (or filtered) products.
 *
 * Usage:
 *   npx tsx scripts/run-validation.ts --dry-run --limit=10
 *   npx tsx scripts/run-validation.ts --status=raw
 *   npx tsx scripts/run-validation.ts
 */

import { runPipeline } from '../lib/validation/engine';
import type { TaxonomyProposal } from '../lib/validation/types';

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN    = process.argv.includes('--dry-run');
const STATUS_ARG = process.argv.find(a => a.startsWith('--status='))?.split('=')[1];
const SKU_ARG    = process.argv.find(a => a.startsWith('--sku='))?.split('=')[1];
const LIMIT_ARG  = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
}
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE        = 500;
const PATCH_BATCH = 50;

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(`[${res.status}] ${path} → ${await res.text()}`);
  if (res.status === 204 || res.status === 201) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function patchProducts(ids: string[], fields: Record<string, any>): Promise<void> {
  const idList = ids.map(id => `"${id}"`).join(',');
  await sbFetch(`products?id=in.(${idList})`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

async function upsertProposal(p: TaxonomyProposal): Promise<void> {
  // Uses a server-side RPC to atomically increment occurrences on conflict.
  // PostgREST's resolution=merge-duplicates does a simple column overwrite —
  // it cannot perform arithmetic and would reset occurrences to 1 every time.
  await sbFetch('rpc/upsert_taxonomy_proposal', {
    method: 'POST',
    body: JSON.stringify({
      p_type:           p.type,
      p_proposed_value: p.proposed_value,
      p_parent_path:    p.parent_path ?? '',
      p_source_sku:     p.source_sku,
    }),
  });
}

// ── Fetch products ────────────────────────────────────────────────────────────

async function fetchAllProducts(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;

  const filters = [];
  if (STATUS_ARG) filters.push(`validation_status=eq.${STATUS_ARG}`);
  if (SKU_ARG)    filters.push(`sku=eq.${SKU_ARG}`);
  const filterStr = filters.length ? '&' + filters.join('&') : '';

  while (true) {
    const rows = await sbFetch(
      `products?select=*&order=id&limit=${PAGE}&offset=${offset}${filterStr}`
    );
    if (!rows?.length) break;
    all.push(...rows);
    if (LIMIT_ARG && all.length >= LIMIT_ARG) { all.splice(LIMIT_ARG); break; }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔧 Validation Pipeline');
  if (DRY_RUN) console.log('   DRY RUN — no writes to Supabase\n');

  console.log('📦 Fetching products…');
  const products = await fetchAllProducts();
  console.log(`   ${products.length} products to process\n`);

  let countValidated = 0, countNeedsReview = 0, countRaw = 0, countTaxFlag = 0;
  const patchGroups = new Map<string, { ids: string[]; patch: Record<string, any> }>();
  const allProposals: TaxonomyProposal[] = [];

  // ── Process each product ──────────────────────────────────────────────────
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const { patch, proposals } = runPipeline(product);

    if (proposals.length) {
      countTaxFlag += proposals.length;
      allProposals.push(...proposals);
      if (!patch.enrichment_note) {
        patch.enrichment_note = proposals.map(p =>
          `unknown taxonomy: ${p.type} '${p.proposed_value}'${p.parent_path ? ` under ${p.parent_path}` : ''} — pending approval`
        ).join('; ');
      }
    }

    const status = patch.validation_status;
    if (status === 'validated')    countValidated++;
    else if (status === 'needs_review') countNeedsReview++;
    else countRaw++;

    // Group products by identical patch content for batch PATCH
    const patchKey = JSON.stringify(patch);
    if (!patchGroups.has(patchKey)) patchGroups.set(patchKey, { ids: [], patch });
    patchGroups.get(patchKey)!.ids.push(product.id);

    if ((i + 1) % 500 === 0 || i === products.length - 1) {
      process.stdout.write(
        `\r[${i + 1}/${products.length}] validated: +${countValidated} | needs_review: +${countNeedsReview} | raw: ${countRaw} | taxonomy flags: ${countTaxFlag}`
      );
    }
  }

  console.log('\n');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN — sample of first patch:');
    const first = products[0];
    if (first) {
      const { patch } = runPipeline(first);
      console.log(JSON.stringify({ sku: first.sku, patch }, null, 2));
    }
    return;
  }

  // ── Write patches to Supabase ─────────────────────────────────────────────
  console.log(`📤 Writing patches (${patchGroups.size} unique patch shapes)…`);
  let written = 0;
  for (const { ids, patch } of patchGroups.values()) {
    for (let i = 0; i < ids.length; i += PATCH_BATCH) {
      await patchProducts(ids.slice(i, i + PATCH_BATCH), patch);
    }
    written += ids.length;
    process.stdout.write(`\r   Written: ${written}/${products.length}`);
  }
  console.log('\n   ✓ Patches written');

  // ── Write taxonomy proposals ───────────────────────────────────────────────
  if (allProposals.length) {
    console.log(`\n🚩 Writing ${allProposals.length} taxonomy proposals…`);
    for (const p of allProposals) {
      try { await upsertProposal(p); } catch (e: any) { console.error(`  ✗ ${e.message}`); }
    }
    console.log('   ✓ Proposals written');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n✅ Pipeline complete!');
  console.log(`   → validated:    ${countValidated}`);
  console.log(`   → needs_review: ${countNeedsReview}`);
  console.log(`   → raw:          ${countRaw}`);
  console.log(`   → taxonomy flags: ${countTaxFlag}`);
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Test dry run on 10 products**

```bash
npx tsx scripts/run-validation.ts --dry-run --limit=10
```

Expected: shows a sample patch JSON with extracted fields. No Supabase writes.

- [ ] **Step 4: Test a single wine product**

```bash
npx tsx scripts/run-validation.ts --dry-run --sku=WRW3356DD
```

Expected: patch shows classification="Red Wine", segment="wine", and any body/acidity/tannin values extractable from the description.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-validation.ts
git commit -m "feat: run-validation CLI script with dry-run + batch PATCH + taxonomy proposals"
```

---

## Task 5: Taxonomy Proposals API

**Files:**
- Create: `app/api/taxonomy-proposals/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
// app/api/taxonomy-proposals/route.ts

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204 || res.status === 201) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// GET /api/taxonomy-proposals?status=pending
export async function GET(req: NextRequest) {
  try {
    const status = new URL(req.url).searchParams.get('status') ?? 'pending';
    const rows = await sbFetch(
      `taxonomy_proposals?status=eq.${status}&order=occurrences.desc,created_at.asc&limit=200`
    );
    return NextResponse.json({ proposals: rows ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// PATCH /api/taxonomy-proposals/:id  body: { action: 'approve' | 'reject' }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action } = body as { id: string; action: 'approve' | 'reject' };
    if (!id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
    }

    // Update proposal status
    await sbFetch(`taxonomy_proposals?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() }),
    });

    // On approve: reset affected products to raw so next pipeline run re-processes them
    if (action === 'approve') {
      const proposals = await sbFetch(`taxonomy_proposals?id=eq.${id}&select=proposed_value`);
      const val = proposals?.[0]?.proposed_value;
      if (val) {
        await sbFetch(`products?enrichment_note=like.*${encodeURIComponent(val)}*&validation_status=neq.validated`, {
          method: 'PATCH',
          body: JSON.stringify({ validation_status: 'raw', enrichment_note: null }),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/taxonomy-proposals/
git commit -m "feat: taxonomy-proposals API (GET list + PATCH approve/reject)"
```

---

## Task 6: Run the Pipeline

- [ ] **Step 1: Run on a small sample first**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
npx tsx scripts/run-validation.ts --limit=100 --status=raw
```

Check: open the Products page in the browser and filter to `needs_review` or `validated` — you should see recently enriched products with `region`, `wine_body`, `wine_acidity`, `wine_tannin` filled in.

- [ ] **Step 2: Run on all raw products**

```bash
npx tsx scripts/run-validation.ts --status=raw
```

Expected output after ~5 min:
```
✅ Pipeline complete!
   → validated:    ~2000+
   → needs_review: ~3000+
   → raw:          remaining
   → taxonomy flags: varies
```

- [ ] **Step 3: Re-enrich all existing validated products (fill null fields only)**

```bash
npx tsx scripts/run-validation.ts --status=validated
```

This fills `grape_variety`, `region`, `wine_body` etc. that were null in the original validated batch. Status stays `validated`.

- [ ] **Step 4: Verify a sample in Supabase**

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/products?select=sku,name,validation_status,classification,region,subregion,wine_body,wine_acidity,wine_tannin,grape_variety,appellation,wine_classification,overall_confidence&validation_status=eq.validated&limit=5" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" | python3 -m json.tool
```

Expected: products show non-null `region`, `wine_body`, `classification` etc.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: validation pipeline first run complete"
```

---

## Task 7: UI — Taxonomy Proposals in Taxonomy Queue Page

**Files:**
- Modify: `components/pages/TaxonomyQueuePage.tsx`

- [ ] **Step 1: Add a "Proposals" tab to TaxonomyQueuePage**

Find the tab row in `TaxonomyQueuePage.tsx` and add a `Proposals` tab. Read the file first to find the exact insertion point.

The tab should call `GET /api/taxonomy-proposals?status=pending` and render proposals grouped by `type` (country / region / sub_region / appellation / classification_tier) in a table with:
- `proposed_value` — the unknown value found
- `parent_path` — context (e.g. "France > Burgundy")
- `occurrences` — how many products triggered it
- `source_sku` — first product that triggered it
- **Approve** button → calls `PATCH /api/taxonomy-proposals` with `{ id, action: 'approve' }`
- **Reject** button → calls `PATCH /api/taxonomy-proposals` with `{ id, action: 'reject' }`

After approve/reject, refresh the proposals list.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Verify in browser**

Open browser → Products → Taxonomy Queue page → click the "Proposals" tab.

Expected state:
- Table visible with columns: `proposed_value`, `parent_path`, `occurrences`, `source_sku`, Approve, Reject
- If Task 6 generated taxonomy flags, rows appear (grouped by type header: appellation, sub_region, etc.)
- Click **Approve** on one row → row disappears from table (list auto-refreshes); in Supabase SQL Editor confirm: `SELECT status FROM taxonomy_proposals WHERE status='approved' LIMIT 1` returns one row
- Click **Reject** on another row → row disappears from table

- [ ] **Step 4: Commit**

```bash
git add components/pages/TaxonomyQueuePage.tsx
git commit -m "feat: taxonomy queue — Proposals tab with approve/reject actions"
```

---

## Task 8: UI — Pipeline Run Button in Processing Review Page

**Files:**
- Modify: `components/pages/ProcessingReviewPage.tsx`

- [ ] **Step 1: Add a pipeline trigger section**

The pipeline runs as a server-side script, so the UI button should call a new lightweight API route that spawns the validation script as a child process and streams progress.

Create `app/api/run-pipeline/route.ts`:

```typescript
// app/api/run-pipeline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as path from 'path';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-validation.ts'];
  if (body.status) args.push(`--status=${body.status}`);
  if (body.limit)  args.push(`--limit=${body.limit}`);

  const cwd = path.resolve(process.cwd());
  const child = spawn('npx', args, { cwd, env: { ...process.env } });

  // Accumulate output and return after completion (MVP: no streaming).
  // The UI button stays disabled while waiting; output appears all at once when done.
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));

  const code = await new Promise<number>(res => child.on('close', res));
  return NextResponse.json({ ok: code === 0, output: lines.join('') });
}
```

- [ ] **Step 2: Add Run Pipeline card to ProcessingReviewPage**

In `ProcessingReviewPage.tsx`, add a card above the existing content with:
- "Run Validation Pipeline" heading
- Filter options: All / Raw only / Validated only (radio group)
- "Run Pipeline" button
- Status indicator (idle / running / done)
- Output log textarea that shows the response output

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Test in browser**

Open browser → Processing Review page.

Expected initial state: "Run Validation Pipeline" card visible with filter radio group (All / Raw only / Validated only) and a "Run Pipeline" button (enabled), output log area empty.

Select "Raw only", click **Run Pipeline**.

Expected running state: button shows "Running…" (disabled). Note: the route accumulates output and returns after the script finishes — the log area will be empty while running, then all output appears at once when the process completes (3–6 minutes for a full run).

Expected completed state: log area shows the full progress output ending with `✅ Pipeline complete!` summary block; button re-enables.

- [ ] **Step 5: Commit**

```bash
git add app/api/run-pipeline/ components/pages/ProcessingReviewPage.tsx
git commit -m "feat: pipeline run button in Processing Review page"
```

---

## Task 9: UI — Show New Fields in Products Page

**Files:**
- Modify: `components/pages/ProductsPage.tsx`

- [ ] **Step 1: Add subregion, appellation, wine_classification to Details tab**

In the Details tab Geography section of the product panel, update the breadcrumb to show:
```
Country › Region › Subregion › Appellation
```
And add `wine_classification` as a badge next to the status badge in the panel header (e.g. `Grand Cru`, `Reserva`).

Add `flavor_tags` (parsed from JSON) to the Tasting tab alongside the existing `character_traits`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Verify in browser**

Open browser → Products page → filter by validation_status=validated → click a Red Wine product (WRW* SKU) that now has region populated.

Expected Details tab: Geography breadcrumb shows `Country › Region` (e.g. "France › Bordeaux"); if subregion is present, shows `France › Bordeaux › Pauillac`; if appellation is present, it appears at the end of the breadcrumb.

Expected panel header: if `wine_classification` is set (e.g. "Grand Cru Classé"), it appears as a badge next to the status badge.

Expected Tasting tab: if `flavor_tags` is populated, a "Flavor Tags" section shows chips for each matched category (e.g. "fruit", "spice", "oak").

- [ ] **Step 4: Commit**

```bash
git add components/pages/ProductsPage.tsx
git commit -m "feat: products page shows subregion, appellation, wine_classification, flavor_tags"
```

---

## Final Verification

- [ ] Run full TypeScript check: `npx tsc --noEmit` — expected: 0 errors
- [ ] Run dry-run on 10 products: `npx tsx scripts/run-validation.ts --dry-run --limit=10`
- [ ] Open browser → Products page → check a validated wine has region, wine_body, wine_acidity, wine_tannin filled
- [ ] Check Taxonomy Queue → Proposals tab (if any proposals were generated)
- [ ] Check Processing Review → pipeline run button works
