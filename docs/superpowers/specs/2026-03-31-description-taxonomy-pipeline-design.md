# Description & Taxonomy Enrichment Pipeline — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Full product enrichment — English descriptions (validate, paraphrase, generate) + complete taxonomy enrichment for all 11,564 products in Supabase. Single unified AI pass per product so descriptions and taxonomy are consistent.

---

## 1. Background & Problem Statement

The rules-based validation pipeline is already built and running (`scripts/run-validation.ts`). After its last run:
- 11,433 products marked `validated`, 131 `needs_review`
- But "validated" only means the rules engine found enough fields — many content gaps remain:
  - 2,378 missing full English description (21%)
  - 6,228 missing region (54%)
  - 6,191 missing grape variety (54%)
  - 3,476 missing brand (30%)
  - 2,884–3,831 missing wine sensory profile fields each

Additionally, the existing descriptions were copied directly from brands/producers and are written in brand voice ("We crafted...", "Our estate..."). They need to be paraphrased into third-party website voice before use in Magento.

---

## 2. SKU Structure & Base Product Model

Every SKU is structured as:
```
WWW  0448  AA
[type][num][supplier suffix]
```

- `sku_base` = first 7 characters (e.g. `WWW0448`) — identifies the product
- Suffix (`AA`, `AB`, `AC`...) = supplier variant — same product, different supplier/price
- One product may have multiple supplier variants

**Primary variant:** the alphabetically lowest suffix (e.g. `AA` if present, else the lowest available). All shared content lives on the primary and is synced to all other variants with the same `sku_base` on every publish.

**Shared fields** (synced primary → all variants):
```
desc_en_short, desc_en_full, desc_source, desc_processed_at
grape_variety, grape_composition, vintage, brand, classification
wine_classification, country, region, subregion, appellation
wine_body, wine_acidity, wine_tannin, flavor_tags, food_matching
overall_confidence, validation_status, enrichment_note, triage_flags
```

**Per-variant fields** (never synced — stays per supplier):
```
price, cost_price, b2b_price_inc_vat_thb, supplier_code
is_in_stock, currency
```

**Primary variant maintenance:** `is_primary_variant` is set by migration for existing products. For new product inserts, the application import logic recalculates `is_primary_variant` for the affected `sku_base` group (set TRUE on lowest-suffix SKU, FALSE on all others). No DB trigger — handled in the import route.

---

## 3. Grape Variety Split

Existing `grape_variety` stores mixed data (some have style names, some have percentage strings like `"95% Cabernet Sauvignon, 2% Petit Verdot"`). This is split into two fields:

| Field | Purpose | Example |
|---|---|---|
| `grape_variety` | Taxonomy / filter (style or main variety) | `"Cabernet Sauvignon"`, `"Bordeaux Blend"`, `"Chardonnay"` |
| `grape_composition` | Detail data (percentages, for display) | `"60% Cabernet Sauvignon / 40% Merlot"`, `"100% Chardonnay"` |

**Migration:** existing `grape_variety` values that contain percentages are split:
- Percentage string → `grape_composition`
- Primary variety name extracted → `grape_variety` (normalised to title case)

A set of recognised blend taxonomy terms is maintained in `rules/blend-styles.json`:
```json
["Bordeaux Blend", "Rhône Blend", "GSM Blend", "Field Blend", "Meritage",
 "Champagne Blend", "Super Tuscan", "Alsace Blend", "Port Blend"]
```

If the grape composition resolves to a known blend style, that label is used in `grape_variety`.

---

## 4. Data Model — New Columns

The column `enrichment_note` already exists (added by `scripts/migration_add_validation_columns.sql`). All other columns below are new:

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku_base             TEXT,
  ADD COLUMN IF NOT EXISTS is_primary_variant   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS grape_composition    TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_short        TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_full         TEXT,
  ADD COLUMN IF NOT EXISTS desc_source          TEXT
    CHECK (desc_source IN ('original', 'ai_processed', 'manual')),
  ADD COLUMN IF NOT EXISTS desc_processed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_flags         TEXT;   -- comma-separated flags
```

Existing `description_en_text` and `short_description_en` are preserved as raw originals — never overwritten. The new `desc_en_full` / `desc_en_short` are the clean library versions used for Magento export.

---

## 5. Pipeline Architecture

Five sequential stages:

```
Stage 1: Rules Engine Pass     free, ~5 min   — existing pipeline
Stage 2: Triage Scan           free, instant  — local quality scan
Stage 3: AI Enrichment         Claude API     — descriptions + taxonomy
Stage 4: Review Queue          human          — approve / edit / skip
Stage 5: Publish + Sync        Supabase       — write + sync variants
```

---

## 6. Stage 1 — Rules Engine Pass

Run existing `scripts/run-validation.ts` (no changes needed).

Fills: SKU classification, known brands, geography patterns from name, grape variety from name (where pattern-matched), body/acidity/tannin from description keywords, flavor tags, food matching.

After this pass, the triage scan will show exactly what AI needs to handle.

---

## 7. Stage 2 — Triage Scan

**Source:** runs locally against all primary variants (`is_primary_variant = TRUE`). No AI. Instant.

Tags each product with `triage_flags` (comma-separated, multiple flags allowed per product):

| Flag | Detection rule |
|---|---|
| `desc_missing` | `description_en_text IS NULL AND short_description_en IS NULL` |
| `desc_short_only` | `short_description_en IS NOT NULL AND description_en_text IS NULL` |
| `desc_brand_voice` | Combined short + full text matches `/\b(we\|our\|we've\|we craft\|we produce)\b/i` (whole-word regex, not substring) |
| `desc_html` | Combined text matches `/<[a-z][^>]*>/i` (opening HTML tag pattern) |
| `desc_ok` | None of the above description flags apply (description quality passes) |
| `taxonomy_incomplete` | One or more of the following fields are still null after Stage 1: `country`, `region`, `grape_variety` (wines only), `wine_body`, `wine_acidity`, `wine_tannin` (wines only), `brand` |

`desc_ok` and `taxonomy_incomplete` are independent — a product can have `desc_ok,taxonomy_incomplete` (good description, missing fields) or `desc_brand_voice,taxonomy_incomplete` (both issues). All products get processed in Stage 3 regardless of flags (descriptions always paraphrased; taxonomy always filled where null).

**UI output:** triage summary displayed as a section within the Processing Review page, showing counts by category × flag:

```
              | desc_missing | desc_short_only | desc_brand_voice | desc_html | desc_ok | taxonomy_incomplete
Red Wine      |     89       |      646         |       821        |    124    |   55    |       1,102
White Wine    |     31       |      202         |       310        |     44    |   18    |         584
...
```

No AI credits spent until the user reviews the triage and triggers Stage 3.

---

## 8. Stage 3 — AI Enrichment

**Scope:** primary variants only (`is_primary_variant = TRUE`). All products get processed — even `desc_ok` ones get their descriptions paraphrased to website voice.

**Processing order (priority batches):**
1. Red Wine
2. White Wine
3. Sparkling Wine / Rosé / Dessert Wine
4. Whisky / Spirits
5. Beer / Sake
6. Accessories / Other

**Batch size:** 1 product per Claude call (descriptions + full taxonomy together). Concurrent batch of 5 at a time with exponential backoff on rate limits.

### Claude prompt structure

System prompt (constant):
```
You are a product content writer for an online wine and spirits retailer in Thailand.
Write in clear, engaging English from the retailer's perspective — third-party voice,
not brand voice. Never use "we", "our", or first-person. Describe the product as
an informed expert recommending it to a customer.
```

User prompt (per product):
```
Product: {name}
SKU base: {sku_base}
Category: {classification}
Existing data (do not change fields marked as KNOWN — only fill fields marked NULL):
  country:           {country ?? "NULL"}
  region:            {region ?? "NULL"}
  grape_variety:     {grape_variety ?? "NULL"}
  grape_composition: {grape_composition ?? "NULL"}
  vintage:           {vintage ?? "NULL"}
  brand:             {brand ?? "NULL"}
  wine_body:         {wine_body ?? "NULL"}
  wine_acidity:      {wine_acidity ?? "NULL"}
  wine_tannin:       {wine_tannin ?? "NULL"}
  subregion:         {subregion ?? "NULL"}
  appellation:       {appellation ?? "NULL"}
  wine_classification: {wine_classification ?? "NULL"}
  flavor_tags:       {flavor_tags ?? "NULL"}
  food_matching:     {food_matching ?? "NULL"}

Source descriptions (raw — may be brand voice, HTML, or empty):
  Short: "{short_description_en ?? ""}"
  Full:  "{description_en_text ?? ""}"

Return a JSON object. For taxonomy fields marked KNOWN above, echo back the existing
value unchanged. For fields marked NULL, infer from product name and source descriptions.
Always rewrite desc_en_short and desc_en_full in third-party website voice.
```

### Claude response schema

```json
{
  "desc_en_short":      "string, 1–2 sentences, 30–60 words",
  "desc_en_full":       "string, 2–3 paragraphs, 120–250 words",
  "desc_confidence":    0.0,
  "grape_variety":      "string or null — style/main variety only (e.g. Cabernet Sauvignon, Bordeaux Blend)",
  "grape_composition":  "string or null — percentage detail (e.g. 60% Cabernet Sauvignon / 40% Merlot)",
  "vintage":            "string or null — 4-digit year only (e.g. 2019); null if unknown",
  "brand":              "string or null",
  "country":            "string or null",
  "region":             "string or null",
  "subregion":          "string or null",
  "appellation":        "string or null",
  "wine_classification":"string or null",
  "wine_body":          "light | medium | full | null",
  "wine_acidity":       "low | medium | high | null",
  "wine_tannin":        "low | medium | high | null",
  "flavor_tags":        ["fruit","spice","oak","earth","floral","mineral","herbal"] or null,
  "food_matching":      "pipe-separated string from allowed values or null"
}
```

**Allowed values — `food_matching`:** pipe-separated string using all 10 labels from `rules/food-keywords.json`:
`"Red Meat"`, `"Poultry"`, `"Seafood"`, `"Cheese"`, `"Pork"`, `"Dessert"`, `"Pasta"`, `"Vegetables"`, `"Spicy Food"`, `"Aperitif"`.
Example: `"Red Meat|Cheese"` or `"Seafood|Aperitif"`. Matches the existing Supabase column type (text, pipe-delimited). Not a JSON array.

**Allowed values — `flavor_tags`:** JSON array of category strings: `"fruit"`, `"spice"`, `"herbal"`, `"earth"`, `"oak"`, `"floral"`, `"mineral"`. Written to Supabase as a JSON array string.

**Write rules (enforced in application code, not by Claude):**
- For taxonomy fields: only write to Supabase if the current value is null or empty string — Claude echoes back existing values but the code discards them if already set
- Descriptions (`desc_en_short`, `desc_en_full`): always written (paraphrase is mandatory)
- `wine_body`/`wine_acidity`/`wine_tannin`: validated against allowed values before write; invalid responses → null
- `vintage`: strip any non-numeric suffix (e.g. `"2019 [**VINTAGE MAY CHANGE]"` → `"2019"`); write null if no valid 4-digit year found

**`overall_confidence` calculation on publish:**
`overall_confidence` = weighted average of rules-engine `overall_confidence` (existing, weight 0.4) and `desc_confidence` from the AI response (weight 0.6), clamped to 0.0–1.0. If no prior rules-engine confidence exists, use `desc_confidence` directly.

**Products with no source material** (both descriptions null, minimal data): Claude generates from name + classification + any known taxonomy. These get `desc_confidence` ≤ 0.70 and are shown in the Review Queue sorted to the top (lowest confidence first).

**Progress output:**
```
[Red Wine] 124/1821 — processed: 119 | errors: 5 | rate_limited: 0
```

---

## 9. Stage 4 — Review Queue

**Location:** `AIReviewQueuePage` — a sub-page accessible from the Processing Review page via "Review & Publish" button.

Each processed product shows:
- **Before**: raw `short_description_en` + `description_en_text`
- **After**: AI-generated `desc_en_short` + `desc_en_full`
- **Taxonomy diff**: table showing null → proposed values only (existing non-null values shown as greyed "unchanged")
- Confidence score badge (≥0.85 green, 0.70–0.84 yellow, <0.70 red)

**Per-product actions:**
- **Approve** (default) — marks for publish
- **Edit** — inline editor for description text; taxonomy dropdowns for structured fields constrained to allowed values from rules files; saves as `desc_source: 'manual'`
- **Skip** — leaves product unchanged in Supabase

**Bulk actions (per category batch):**
- "Approve all high-confidence" (≥0.85)
- "Approve all" — includes low-confidence; excludes already-`manual` records
- "Skip all"

**Manual-edit protection:** products with existing `desc_source: 'manual'` are shown with a yellow badge and excluded from all bulk-approve actions. They require individual explicit approval.

---

## 10. Stage 5 — Publish + Sync

On publish of a primary variant:
1. Write all approved fields to the primary variant record in Supabase
2. Set `desc_source: 'ai_processed'` (or `'manual'` if edited in Review Queue), `desc_processed_at: now()`, updated `overall_confidence`
3. Fetch all variants with matching `sku_base`
4. Copy all shared fields (Section 2 list) to each variant — price/supplier fields are never touched
5. `desc_source` on variants is copied from the primary as part of the shared-field sync — not hard-coded; a manually-edited primary correctly propagates `'manual'` to its variants

**Batching:** publish in groups of 50 primary SKUs. For each primary: write primary first, then sync variants.

**Partial failure handling:**
- If writing the primary fails: skip variant sync for that SKU, add to failed list, continue with next batch
- If writing the primary succeeds but one or more variant syncs fail: primary remains published (not rolled back); failed variant SKUs are added to a separate "sync retry" list shown in the UI. User can re-trigger sync for failed variants without re-running AI
- End-of-run summary shows: N published successfully, N primary failures (retry available), N variant sync failures (retry available)

---

## 11. UI Changes

### Products Browser (`ProductsPage.tsx`)
- Groups by `sku_base` — one card per product (not per supplier variant)
- Variant badge shows supplier count: `3 suppliers`
- Expand to show per-variant pricing and supplier codes
- "Primary" tag on the primary variant row

### Processing Review Page (`ProcessingReviewPage.tsx`)
- Stage 1 button: "Run Rules Engine" → existing pipeline trigger (already built)
- Stage 2 button: "Run Triage Scan" → triggers triage script, renders triage summary table inline on completion
- Stage 3 button: "Start AI Enrichment" → category selector + estimated call count → confirm → progress display with pause/resume
- "Review & Publish" button → navigates to AI Review Queue page

### Triage Summary (section within Processing Review page — not a separate page)
- Rendered inline on the Processing Review page after Stage 2 completes
- Table: category × flag type × count (see Section 7)
- Shows total estimated AI calls (= count of primary variants)

### AI Review Queue (`AIReviewQueuePage.tsx` — new page)
- Filterable by category, confidence band, flag type
- Default sort: confidence ascending (lowest first for closer review)
- Inline description editor with word count
- All taxonomy fields editable via dropdown constrained to allowed values from rules files

---

## 12. New Files

```
scripts/run-triage.ts                       Stage 2: scan all primaries, write triage_flags
scripts/run-ai-enrichment.ts                Stage 3: Claude batch, options: --category=red-wine, --limit=N, --dry-run
scripts/migration_description_taxonomy.sql  New columns + sku_base backfill + primary variant flag
scripts/migrate-grape-composition.ts        One-time: split existing grape_variety % strings into two fields
rules/blend-styles.json                     Known blend style taxonomy labels
app/api/ai-enrichment/route.ts              POST: process single product, return enrichment result
app/api/ai-enrichment/publish/route.ts      POST: write approved records + sync variants
app/api/triage/route.ts                     POST: trigger triage scan; GET: fetch triage summary
```

**Modify:**
```
components/pages/ProcessingReviewPage.tsx   Stage 1–3 buttons + inline triage summary section
components/pages/ProductsPage.tsx           Group by sku_base, variant badge + expand
components/dashboard.tsx                    Add AI Review Queue navigation entry
```

**New components:**
```
components/pages/AIReviewQueuePage.tsx      Stage 4 review + approve/edit/skip interface
```

---

## 13. Out of Scope (this phase)

- Thai descriptions (`desc_th_short` / `desc_th_full`) — separate phase
- Wheel components (Character/Flavour/Aromatic wheels) — Description Manager spec, separate phase
- Manual per-product description editing beyond inline Review Queue edits
- Automated re-enrichment trigger (scheduled runs)
- Bulk image processing

---

## 14. Database Migration

```sql
-- Run ONCE in Supabase SQL Editor before pipeline deployment.
-- Note: enrichment_note already exists from migration_add_validation_columns.sql

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku_base             TEXT,
  ADD COLUMN IF NOT EXISTS is_primary_variant   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS grape_composition    TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_short        TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_full         TEXT,
  ADD COLUMN IF NOT EXISTS desc_source          TEXT
    CHECK (desc_source IN ('original', 'ai_processed', 'manual')),
  ADD COLUMN IF NOT EXISTS desc_processed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_flags         TEXT;

-- Backfill sku_base for all existing products
UPDATE products SET sku_base = LEFT(sku, 7) WHERE sku_base IS NULL;

-- Set all rows to FALSE first (handles NULL from DEFAULT on pre-existing rows)
UPDATE products SET is_primary_variant = FALSE;

-- Then set TRUE for the lowest-suffix SKU per sku_base
UPDATE products p
SET is_primary_variant = TRUE
WHERE sku = (
  SELECT sku FROM products p2
  WHERE p2.sku_base = p.sku_base
  ORDER BY sku ASC
  LIMIT 1
);

CREATE INDEX IF NOT EXISTS idx_products_sku_base ON products(sku_base);
CREATE INDEX IF NOT EXISTS idx_products_primary  ON products(sku_base, is_primary_variant);
```

---

## 15. Estimated Scope

| Category | Primary variants (est.) | Est. AI calls |
|---|---|---|
| Red Wine | ~1,821 | ~1,821 |
| White Wine | ~1,205 | ~1,205 |
| Sparkling / Rosé / Dessert | ~580 | ~580 |
| Whisky / Spirits | ~1,100 | ~1,100 |
| Beer / Sake | ~420 | ~420 |
| Accessories / Other | ~480 | ~480 |
| **Total** | **~5,606** | **~5,606** |

~5,600 Claude API calls (roughly half of 11,564 total products — the rest are non-primary variants that receive synced data for free). Estimated run time: 45–90 minutes at 5 concurrent calls.
