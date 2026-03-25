# Validation Pipeline — Design Spec
**Date:** 2026-03-25
**Status:** Approved (v2 — post spec-review fixes)

---

## Overview

A local, rule-based enrichment and validation pipeline for 11,564 products in Supabase. No AI API calls — all extraction is done via JSON knowledge-base lookups and regex. Rules are stored as versioned JSON files so new patterns can be added without code changes.

**Scope:** All products regardless of current `validation_status`. The null-check protection applies unconditionally to any field with an existing non-null value, regardless of the product's current status.

**Write strategy:** The pipeline calls Supabase REST directly (same as `import-descriptions.ts`), not via the Next.js API layer, to avoid the `parseInt()` coercion applied to `price`/`cost_price` in `app/api/products/[id]/route.ts`.

**Output statuses (four-tier):**
- `validated` — post-run field completeness ≥ 75% of expected fields for product type
- `needs_review` — 40–74% completeness, or a new unknown taxonomy value was encountered
- `needs_attention` — retained as a distinct status for products flagged by other processes (not assigned by this pipeline; pre-existing `needs_attention` records are enriched but their status is only upgraded, never downgraded)
- `raw` — <40% completeness; status unchanged

**Status transition rules:**
- `raw` → may become `validated`, `needs_review`, or stay `raw`
- `needs_review` → may become `validated` or stay `needs_review`
- `needs_attention` → may become `validated` or `needs_review` (upgrade only); never set back to `raw`
- `validated` → fields are enriched (null-only) but status is never changed by the pipeline

---

## Architecture

Five sequential stages per product:

```
Stage 1: SKU Classification
Stage 2: Name Extraction
Stage 3: Description Keyword Scan
Stage 4: Geography, Appellation & Classification Tier
Stage 5: Confidence Scoring & Status Assignment
```

Each stage is a pure function: takes a product record + any patches from prior stages, returns a partial patch object. Stages are composed in order; later stages can use results from earlier stages.

---

## Stage 1 — SKU Classification

**Source:** `sku` field (prefix matching)
**Confidence:** Certain — SKU prefix is a hard-coded catalog convention

**Matching rule:** Longest prefix wins. `LBE` (Beer) must be evaluated before the generic `L*` spirits prefix to avoid misclassification. `ABA` and `AWC` are two separate entries both resolving to Accessory.

Maps SKU prefix → `classification` + `segment`:

| Prefix | Classification | Segment |
|--------|---------------|---------|
| WRW | Red Wine | wine |
| WWW | White Wine | wine |
| WSP | Sparkling Wine | wine |
| WRS | Rosé Wine | wine |
| WDW | Dessert Wine | wine |
| LBE | Beer | beer |
| LWH | Whisky | spirits |
| LGN | Gin | spirits |
| LRM | Rum | spirits |
| LTQ | Tequila | spirits |
| LVK | Vodka | spirits |
| LLQ | Liqueur | spirits |
| LBD | Brandy | spirits |
| LSK | Sake | spirits |
| LOT | Other Spirit | spirits |
| ABA | Accessory | accessories |
| AWC | Accessory | accessories |
| GWN | Glassware | accessories |
| GLQ | Glassware | accessories |
| GBE | Glassware | accessories |
| NNA | Non-Alcoholic | other |

**Rules file:** `rules/sku-prefixes.json`

---

## Stage 2 — Name Extraction

**Source:** `name` field
**Confidence:** High

Extracts via regex and keyword lookup:

- **Vintage year** — `/\b(19[5-9]\d|20[0-3]\d)\b/` → `vintage`
- **Alcohol %** — `/\b(\d{1,2}\.?\d?)\s*(%|vol|abv)/i` → `alcohol`
- **Grape variety** — match against `rules/grape-varieties.json` (~200 entries, case-insensitive, supports aliases e.g. "Syrah" = "Shiraz") → `grape_variety`
- **Brand** — if `brand` is null: first attempt lookup against the brand knowledge base in `rules/brands.json`; if no match, extract text before the first separator token (vintage year match, ` - `, `,`) as the brand candidate. Multi-word brands (e.g. "Château Margaux") are resolved by the knowledge base lookup.

> **Note:** The upstream Excel source uses `wine_tanin` (one 'n'); the Supabase column is `wine_tannin` (two 'n's). All pipeline references use the correct column name `wine_tannin`.

**Rules files:** `rules/grape-varieties.json`, `rules/brands.json`

---

## Stage 3 — Description Keyword Scan

**Source:** `description_en_text` + `short_description_en` (combined, lowercased)
**Confidence:** Medium

### Wine Profile (body / acidity / tannin)

Each attribute mapped from keyword lists in `rules/body-keywords.json`:

```json
{
  "wine_body": {
    "light":  ["light-bodied", "light body", "delicate", "lightweight", "ethereal"],
    "medium": ["medium-bodied", "medium body", "balanced"],
    "full":   ["full-bodied", "full body", "rich", "powerful", "robust", "weighty"]
  },
  "wine_acidity": {
    "low":    ["low acidity", "soft", "round", "supple"],
    "medium": ["medium acidity", "fresh", "lively", "balanced acidity"],
    "high":   ["high acidity", "crisp", "vibrant", "zesty", "sharp", "racy"]
  },
  "wine_tannin": {
    "low":    ["soft tannins", "silky", "smooth", "velvety", "low tannin"],
    "medium": ["medium tannins", "firm tannins", "structured"],
    "high":   ["grippy", "tannic", "astringent", "tight tannins", "chewy"]
  }
}
```

First match wins per attribute. Existing non-null values are never overwritten.

### Flavor Tags

Extracted into a JSON array of category strings written to `flavor_tags` (new column — distinct from any existing `flavor_profile` table). Uses `rules/flavor-keywords.json`:

```json
{
  "fruit":   ["cherry", "plum", "berry", "blackcurrant", "raspberry", "peach", "citrus", "apple", "pear", "fig", "mango", "tropical"],
  "spice":   ["pepper", "spice", "clove", "cinnamon", "nutmeg", "vanilla", "anise"],
  "herbal":  ["herb", "mint", "eucalyptus", "thyme", "grass", "green"],
  "earth":   ["earth", "soil", "mushroom", "truffle", "leather", "tobacco"],
  "oak":     ["oak", "cedar", "wood", "smoke", "toast"],
  "floral":  ["floral", "rose", "violet", "jasmine", "blossom"],
  "mineral": ["mineral", "chalk", "flint", "stone", "slate", "wet stone"]
}
```

All matched categories → `flavor_tags` as a JSON string array e.g. `["fruit","spice","oak"]`.

### Food Matching

`rules/food-keywords.json` maps trigger phrases → standardised pairing labels:

```json
{
  "Red Meat":    ["beef", "steak", "lamb", "venison", "red meat", "grilled meat"],
  "Poultry":     ["chicken", "turkey", "duck", "poultry"],
  "Seafood":     ["fish", "seafood", "salmon", "tuna", "shellfish", "oyster"],
  "Cheese":      ["cheese", "fromage"],
  "Dessert":     ["dessert", "chocolate", "cake", "sweet"],
  "Pasta":       ["pasta", "risotto", "pizza"],
  "Vegetables":  ["vegetables", "salad", "vegetarian"],
  "Spicy Food":  ["spicy", "thai", "indian", "curry"]
}
```

Output: pipe-separated string `"Red Meat|Cheese"` (consistent with existing format).

---

## Stage 4 — Geography, Appellation & Classification Tier

**Source:** `name` + `description_en_text` + existing `country` field
**Confidence:** High for known taxonomy, triggers proposal for unknown

### 3-Level Geography

```
Country → Region → Sub-region
```

Stored in `rules/regions.json` as the approved taxonomy tree. Germany is in scope. Sample structure (full tree covers 20+ countries):

```json
{
  "France": {
    "Bordeaux":  { "sub_regions": ["Médoc", "Pomerol", "Saint-Émilion", "Graves", "Sauternes", "Margaux", "Pauillac", "Saint-Julien", "Saint-Estèphe"] },
    "Burgundy":  { "sub_regions": ["Côte de Nuits", "Côte de Beaune", "Côte Chalonnaise", "Mâconnais", "Chablis"] },
    "Champagne": { "sub_regions": ["Montagne de Reims", "Vallée de la Marne", "Côte des Blancs"] },
    "Rhône":     { "sub_regions": ["Northern Rhône", "Southern Rhône"] },
    "Alsace":    { "sub_regions": [] },
    "Loire":     { "sub_regions": ["Sancerre", "Pouilly-Fumé", "Muscadet", "Anjou", "Touraine"] },
    "Provence":  { "sub_regions": [] }
  },
  "Germany": {
    "Mosel":      { "sub_regions": ["Bernkastel", "Piesport", "Wehlen", "Brauneberg"] },
    "Rheingau":   { "sub_regions": ["Rüdesheim", "Johannisberg", "Hochheim"] },
    "Rheinhessen":{ "sub_regions": ["Nierstein", "Oppenheim"] },
    "Pfalz":      { "sub_regions": ["Forst", "Deidesheim", "Ruppertsberg"] },
    "Baden":      { "sub_regions": [] }
  },
  "Italy": {
    "Tuscany":   { "sub_regions": ["Chianti", "Chianti Classico", "Montalcino", "Montepulciano", "Bolgheri", "Maremma"] },
    "Piedmont":  { "sub_regions": ["Barolo", "Barbaresco", "Asti", "Langhe", "Monferrato"] },
    "Veneto":    { "sub_regions": ["Amarone", "Valpolicella", "Soave", "Prosecco"] }
  },
  "Spain": {
    "Rioja":            { "sub_regions": ["Rioja Alta", "Rioja Alavesa", "Rioja Oriental"] },
    "Ribera del Duero": { "sub_regions": [] },
    "Priorat":          { "sub_regions": [] },
    "Rías Baixas":      { "sub_regions": [] }
  }
}
```

Written to: `country`, `region`, `subregion` respectively.

### Appellation Extraction

Matched from `rules/appellations.json` — flat list of known AOC/DOC/AVA names grouped by country. Written to `appellation` field.

### Classification Tier

Matched from `rules/classification-tiers.json`, country-aware:

| Country | Tiers |
|---------|-------|
| France (Bordeaux) | Grand Cru Classé, Premier Cru Classé, Cru Bourgeois, Cru Artisan |
| France (Burgundy/Champagne/Alsace) | Grand Cru, Premier Cru, Village, Régionale |
| Italy | DOCG, DOC, IGT |
| Spain | DOCa, DO + Gran Reserva, Reserva, Crianza, Joven |
| Germany | Große Lage (GG), Erste Lage, Spätlese, Auslese, Beerenauslese, TBA, Eiswein, Kabinett |
| Portugal | DOC, VR, Colheita, LBV, Vintage (Porto) |

Written to `wine_classification` field.

### New Taxonomy Flag Process

If any extracted value is **not found** in the approved rules files:

1. Product `validation_status` set to `needs_review` (never downgraded below current status)
2. `enrichment_note` records: `"unknown taxonomy: sub_region 'X' under France > Burgundy — pending approval"`
3. Upsert into `taxonomy_proposals` table on `UNIQUE(type, proposed_value, parent_path)` — increments `occurrences` if already exists:

```sql
INSERT INTO taxonomy_proposals (type, proposed_value, parent_path, source_sku, occurrences)
VALUES ($1, $2, $3, $4, 1)
ON CONFLICT (type, proposed_value, parent_path)
DO UPDATE SET occurrences = taxonomy_proposals.occurrences + 1,
              source_sku  = EXCLUDED.source_sku;
```

4. **Taxonomy Queue** page shows pending proposals grouped by type
5. **Approve** → value added to the relevant rules JSON file; all products with that value in `enrichment_note` have `validation_status` reset to `raw` so the next pipeline run re-processes them with the now-approved taxonomy
6. **Reject** → proposal `status` set to `rejected`; product stays `needs_review`

---

## Stage 5 — Confidence Scoring & Status Assignment

Score is computed against **post-run field completeness** (not delta). A field counts as populated whether it was pre-existing or just extracted this run. This prevents products with pre-existing partial data from being scored lower than their actual completeness.

Expected fields per product type:

| Type | Expected fields (each worth 1 point) |
|------|--------------------------------------|
| Wine | classification, grape_variety, country, region, wine_body, wine_acidity, wine_tannin |
| Spirits | classification, country, sub-type (from SKU = certain) |
| Beer | classification, country |
| Accessories | classification |

**Score** = non-null expected fields after this run / total expected for type

Bonus: if `appellation` or `wine_classification` are populated after this run → +0.1, **clamped to 1.0 maximum** before writing to `overall_confidence`.

| Score | Status assigned |
|-------|----------------|
| ≥ 0.75 | `validated` |
| 0.40–0.74 | `needs_review` |
| < 0.40 | `raw` (no change) |

**Status transition constraints (never downgrade):**
- If current status is `validated` → do not change status, only fill null fields
- If current status is `needs_attention` → may upgrade to `validated` or `needs_review` only
- `overall_confidence` and `taxonomy_confidence` are always updated (reflecting current completeness)

---

## Rules File Structure

```
rules/
  sku-prefixes.json          SKU prefix → classification + segment (longest match)
  grape-varieties.json       ~200 varieties with aliases
  brands.json                Known producer/brand names for brand extraction
  regions.json               Country → Region → Sub-region tree (20+ countries)
  appellations.json          Known AOC/DOC/AVA names by country
  classification-tiers.json  Country-aware tier keywords
  body-keywords.json         Body / acidity / tannin keyword → tier
  flavor-keywords.json       Flavor category → trigger words
  food-keywords.json         Food pairing trigger → label
```

All files are plain JSON, version-controlled in git. New entries take effect on the next pipeline run with no code changes required.

---

## Script Interface

```
scripts/run-validation.ts

Options:
  --dry-run          Preview patches, write nothing to Supabase
  --status=raw       Only process products with this validation_status
  --sku=WRW1234XX    Process a single product by SKU
  --limit=100        Process only N products (for testing)

Default (no flags): processes ALL products. Re-running on validated products
enriches null fields but never changes their status.
```

Progress output per batch:
```
[500/11564] validated: +312 | needs_review: +156 | raw: 32 | taxonomy flags: 8
```

---

## Database Changes Required

```sql
-- New columns on products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS subregion           TEXT,
  ADD COLUMN IF NOT EXISTS appellation         TEXT,
  ADD COLUMN IF NOT EXISTS wine_classification  TEXT,
  ADD COLUMN IF NOT EXISTS flavor_tags         TEXT,   -- JSON array string, distinct from flavor_profile table
  ADD COLUMN IF NOT EXISTS enrichment_note     TEXT;

-- New table for taxonomy governance
CREATE TABLE IF NOT EXISTS taxonomy_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL,        -- country | region | sub_region | appellation | classification_tier
  proposed_value TEXT NOT NULL,
  parent_path    TEXT,                 -- e.g. "France > Burgundy"
  source_sku     TEXT,
  occurrences    INT DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT,
  UNIQUE(type, proposed_value, parent_path)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_status ON taxonomy_proposals(status);
```

---

## What Is Never Overwritten

The engine only writes to fields that are currently `NULL` or empty string. This applies unconditionally to any non-null field, regardless of the product's current `validation_status`. Manual edits and previous enrichment are always preserved.

---

## UI Changes

- **Products page** — `subregion`, `appellation`, `wine_classification`, `flavor_tags` shown in Details tab
- **Taxonomy Queue page** — updated to show `taxonomy_proposals` grouped by type with Approve / Reject actions; Approve triggers bulk status reset to `raw` for affected products
- **Processing Review page** — pipeline run button + live progress + summary stats

---

## Estimated Performance

- ~11,564 products, all stages local
- Network calls only for final batch PATCH to Supabase (batches of 50 IDs)
- Estimated run time: **3–6 minutes**
- Re-runnable: safe to run multiple times, idempotent on non-null fields
