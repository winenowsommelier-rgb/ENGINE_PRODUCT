# Description & Taxonomy Enrichment Pipeline — Design Spec

**Date:** 2026-03-31
**Status:** Approved v2
**Scope:** Full product enrichment — English descriptions (validate, paraphrase, generate) + complete taxonomy enrichment for all 11,564 products across all categories (Wine-now + LIQ9). Single unified AI pass per product so descriptions and taxonomy are consistent.

---

## 1. Background & Problem Statement

The rules-based validation pipeline is already built and running (`scripts/run-validation.ts`). After its last run:
- 11,433 products marked `validated`, 131 `needs_review`
- But "validated" only means the rules engine found enough fields — many content gaps remain:
  - 2,378 missing full English description (21%)
  - 6,228 missing region (54%)
  - 6,191 missing style/grape (54%)
  - 3,476 missing brand (30%)
  - 2,884–3,831 missing wine sensory profile fields each

Additionally, the existing descriptions were copied directly from brands/producers and written in brand voice ("We crafted...", "Our estate..."). They need to be rewritten as retailer-voice storytelling content optimised for SEO and AEO (Answer Engine Optimisation — how AI assistants like ChatGPT and Perplexity cite and recommend products).

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
style, style_detail, vintage, brand, classification
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

## 3. Universal Taxonomy Framework

All product categories share the same field names. Category-specific meaning is captured in the `style` field, with allowed values managed in separate per-category JSON files under `rules/styles/`.

### Universal fields (every product, all categories)

| Field | Wine example | Whisky example | Beer example | Sake example |
|---|---|---|---|---|
| `classification` | Red Wine | Whisky | Beer | Sake |
| `brand` | Château Margaux | Talisker | BrewDog | Dassai |
| `country` | France | Scotland | USA | Japan |
| `region` | Bordeaux | Speyside | Oregon | Niigata |
| `style` | Cabernet Sauvignon | Single Malt Scotch | West Coast IPA | Junmai Daiginjo |
| `style_detail` | 85% Cab Sauv / 15% Merlot | Aged 18 years, ex-Bourbon | 6.5% ABV, 65 IBU | Polishing ratio 45% |
| `flavor_tags` | fruit, spice, earth | smoke, fruit, spice | fruit, herbal | floral, fruit, mineral |
| `food_matching` | Red Meat\|Cheese | Seafood\|Cheese | Spicy Food\|Cheese | Seafood\|Poultry |

### Wine-only fields
`wine_body`, `wine_acidity`, `wine_tannin`, `appellation`, `subregion`, `wine_classification`, `vintage`

### Style taxonomy — per-category files

Taxonomy for `style` is managed as separate JSON files, one per category. This keeps filter options clean (no "IPA" appearing in a wine filter) while using a universal field name. The unified website filter groups options by category when "All" is selected.

```
rules/styles/
  wine.json          Grape varieties + blend styles (replaces rules/grape-varieties.json)
  whisky.json        Single Malt Scotch, Blended Scotch, Bourbon, Rye, Japanese...
  gin.json           London Dry, Old Tom, Contemporary, Sloe, Navy Strength...
  rum.json           Aged Dark, White, Spiced, Agricole, Overproof...
  tequila.json       Blanco, Reposado, Añejo, Extra Añejo, Mezcal...
  vodka.json         Plain, Flavoured, Grain, Potato...
  liqueur.json       Coffee, Herbal, Fruit, Cream, Nut, Floral...
  brandy.json        Cognac, Armagnac, Calvados, Pisco, Grappa...
  beer.json          Lager, Pale Ale, IPA, Stout, Wheat, Sour, Saison...
  sake.json          Junmai, Honjozo, Ginjo, Daiginjo, Junmai Daiginjo, Nigori...
  other.json         Non-Alcoholic, Other Spirit...
  accessories.json   Wine Glass, Decanter, Champagne Flute, Beer Glass, Opener...
```

Each file is a flat JSON array of approved `style` values for that category. Unknown values extracted by the AI pipeline flow through the existing `taxonomy_proposals` system for approval.

---

## 4. Data Model — New Columns

The column `enrichment_note` already exists (added by `scripts/migration_add_validation_columns.sql`). `grape_variety` is renamed to `style`; `grape_composition` is a new column replacing the percentage-mixed data previously stored in `grape_variety`.

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku_base             TEXT,
  ADD COLUMN IF NOT EXISTS is_primary_variant   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS style                TEXT,   -- replaces grape_variety
  ADD COLUMN IF NOT EXISTS style_detail         TEXT,   -- replaces mixed % data in grape_variety
  ADD COLUMN IF NOT EXISTS desc_en_short        TEXT,
  ADD COLUMN IF NOT EXISTS desc_en_full         TEXT,
  ADD COLUMN IF NOT EXISTS desc_source          TEXT
    CHECK (desc_source IN ('original', 'ai_processed', 'manual')),
  ADD COLUMN IF NOT EXISTS desc_processed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_flags         TEXT;
```

> `grape_variety` is kept as a column during transition — the migration script copies its data to `style`/`style_detail` then nulls it. A separate cleanup migration drops `grape_variety` once all references are updated.

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

Run existing `scripts/run-validation.ts` (no changes needed for this stage — the existing rules populate `grape_variety` which the triage/migration then moves to `style`).

Fills: SKU classification, known brands, geography patterns from name, style/grape from name (where pattern-matched), body/acidity/tannin from description keywords, flavor tags, food matching.

After this pass, run `scripts/migrate-style-fields.ts` to move data from `grape_variety` into `style`/`style_detail`. This script must run after the SQL migration (so columns exist) and before the triage scan (so triage sees `style` not `grape_variety`).

**`migrate-style-fields.ts` logic:**
1. Fetch all products where `grape_variety IS NOT NULL`
2. For each product:
   - If `grape_variety` matches `/\d+%/` (contains a percentage — e.g. `"85% Cab Sauv / 15% Merlot"`):
     - Extract primary variety before first `/` or `%` delimiter, normalise to title case → write to `style`
     - Copy full original string → write to `style_detail`
   - Otherwise (clean style name — e.g. `"Cabernet Sauvignon"`):
     - Copy value → `style`; leave `style_detail` null
3. Check extracted `style` value against `rules/styles/wine.json`; if not found, emit to `taxonomy_proposals` as type `style`
4. Set `grape_variety = NULL` on all processed rows (column retained for follow-up drop migration)
5. Print summary: N migrated, N taxonomy proposals emitted

---

## 7. Stage 2 — Triage Scan

**Source:** runs locally against all primary variants (`is_primary_variant = TRUE`). No AI. Instant.

**Pre-scan seeding:** before writing triage flags, set `desc_source = 'original'` on all products where `desc_source IS NULL AND (description_en_text IS NOT NULL OR short_description_en IS NOT NULL)`. This ensures pre-existing manually-edited content is protected from bulk-approve in Stage 4 (the manual-edit protection keys off `desc_source = 'manual'`; without seeding, legacy content would be unprotected).

Tags each product with `triage_flags` (comma-separated, multiple flags allowed per product):

| Flag | Detection rule |
|---|---|
| `desc_missing` | `description_en_text IS NULL AND short_description_en IS NULL` |
| `desc_short_only` | `short_description_en IS NOT NULL AND description_en_text IS NULL` |
| `desc_brand_voice` | Combined text matches `/\b(we\|our\|we've\|we craft\|we produce)\b/i` (whole-word regex) |
| `desc_html` | Combined text matches `/<[a-z][^>]*>/i` (contains raw HTML tags) |
| `desc_ok` | None of the above description flags apply |
| `taxonomy_incomplete` | One or more key fields still null after Stage 1: `country`, `region`, `style` (non-accessories), `wine_body`/`wine_acidity`/`wine_tannin` (wines only), `brand` |

`desc_ok` and `taxonomy_incomplete` are independent — a product can have both simultaneously. All products are processed in Stage 3 (descriptions always paraphrased; taxonomy filled where null).

**UI output:** triage summary rendered inline on the Processing Review page after Stage 2 completes:

```
              | desc_missing | desc_short_only | desc_brand_voice | desc_html | desc_ok | taxonomy_incomplete
Red Wine      |     89       |      646         |       821        |    124    |   55    |       1,102
White Wine    |     31       |      202         |       310        |     44    |   18    |         584
Whisky        |      4       |       40         |        61        |      8    |    2    |         312
...
```

No AI credits spent until the user reviews triage and triggers Stage 3.

---

## 8. Stage 3 — AI Enrichment

**Scope:** primary variants only (`is_primary_variant = TRUE`). All products processed — even `desc_ok` ones get descriptions rewritten as storytelling content.

**Processing order and template mapping:**

| Batch | Classifications | HTML template used |
|---|---|---|
| 1 | Red Wine | `wine` |
| 2 | White Wine | `wine` |
| 3 | Rosé Wine, Dessert Wine | `wine` (still wines — not sparkling) |
| 4 | Sparkling Wine | `sparkling` |
| 5 | Whisky | `whisky` |
| 6 | Gin, Rum, Tequila, Vodka, Brandy, Liqueur, Other Spirit | `spirits` |
| 7 | Beer | `beer` |
| 8 | Sake | `sake` |
| 9 | Accessory, Glassware, Non-Alcoholic, Other | `accessories` |

`{category_template_name}` in the Claude prompt is resolved by this table — lookup by exact `classification` value, pass the template name string to the prompt.

**Batch size:** 1 product per Claude call. Concurrency: 5 at a time with exponential backoff on rate limits.

---

### Description philosophy

The Magento page template already displays structured attributes (style, body, acidity, country, vintage, food matching, etc.). Descriptions must NOT repeat this data as a list. Instead they:
- Tell the story that data fields cannot (producer history, regional context, what makes this product genuinely interesting)
- Answer the real questions behind the search ("what's special about this?", "when should I open it?", "who is it for?")
- Use specific named entities naturally (producer, appellation, grape, technique) so AI search engines (ChatGPT, Perplexity, Claude) can cite them when answering recommendation queries
- Feel like expert guidance from a knowledgeable retailer, not a data sheet

**Short description** (`desc_en_short`): 1–2 sentences, 30–60 words. A compelling hook that stands alone as a product card teaser.

**Full description** (`desc_en_full`): HTML-formatted (see templates below). Story-driven. 180–300 words. Three sections. No redundant attribute lists.

---

### HTML templates per category

The page template handles all structured attributes. The description contributes story, sensory experience, and occasion context only.

**Wine (Red / White / Rosé / Dessert)**
```html
<div class="prod-desc">
  <p class="lead">[1–2 sentence hook. Specific — names producer, region, or what makes
  this particular wine worth noticing. Never generic ("This is a beautiful wine from...").]</p>
  <p>[Story — producer or region context, winemaking philosophy, what defines this
  expression. 2–3 sentences. Named entities: estate name, appellation, technique.]</p>
  <h2>Tasting Notes</h2>
  <p>[Flowing prose — evocative, not a checklist. Describes the drinking experience:
  aromas, palate character, texture, finish. 2–3 sentences. Uses sensory language
  that matches how people naturally describe what they want.]</p>
  <h2>Perfect With</h2>
  <p>[Occasion + food pairing as a sentence or two. Answers "when do I open this?"
  and "what do I eat with it?". Specific and inspiring, not generic.]</p>
</div>
```

**Sparkling Wine (Champagne / Prosecco / Cava / Crémant)**
```html
<div class="prod-desc">
  <p class="lead">[Hook — house or producer, style, what distinguishes this from
  other sparkling wines.]</p>
  <p>[Story — house history or method (traditional method / charmat), grape blend,
  dosage level context, why this expression matters.]</p>
  <h2>Tasting Notes</h2>
  <p>[Prose — bubbles, freshness, mousse, fruit character, finish. Specific and
  evocative. Mention whether it's brut / extra brut / demi-sec naturally in prose
  if relevant.]</p>
  <h2>Perfect With</h2>
  <p>[Occasion (celebration, aperitif, brunch) + food pairing. Specific.]</p>
</div>
```

**Whisky**
```html
<div class="prod-desc">
  <p class="lead">[Hook — distillery name, region, what defines this expression.
  Specific enough that someone unfamiliar with the distillery immediately understands
  why it's interesting.]</p>
  <p>[Story — distillery background, production character (worm tubs, pot stills,
  water source), age/maturation context. 2–3 sentences. Named entities.]</p>
  <h2>Tasting Notes</h2>
  <p>[Prose nose, palate, finish. Evocative and specific. Mention dominant character
  (peaty, sherried, coastal, fruity) naturally in prose without labelling it.]</p>
  <h2>Best Enjoyed</h2>
  <p>[How to drink it (neat, drop of water, on ice, cocktail) and what occasion or
  pairing it suits. Practical and memorable.]</p>
</div>
```

**Other Spirits (Gin / Rum / Tequila / Vodka / Brandy / Liqueur)**
```html
<div class="prod-desc">
  <p class="lead">[Hook — producer/origin/style, what makes this spirit distinctive
  in its category.]</p>
  <p>[Story — production philosophy, key ingredient (botanicals, agave, sugarcane),
  heritage or craft approach. 2–3 sentences.]</p>
  <h2>Tasting Notes</h2>
  <p>[Flowing prose — aroma, character on the palate, finish. Specific flavour
  descriptors without being a technical sheet.]</p>
  <h2>Best Enjoyed</h2>
  <p>[Serve recommendation — signature cocktail, neat, with mixer — and occasion.]</p>
</div>
```

**Beer**
```html
<div class="prod-desc">
  <p class="lead">[Hook — brewery name, style, why this particular beer stands out
  in the category.]</p>
  <p>[Story — brewery background or brewing approach, what makes the recipe or
  ingredients distinctive. 2–3 sentences.]</p>
  <h2>Tasting Notes</h2>
  <p>[Prose — colour, aroma, flavour, mouthfeel, finish. Specific and honest.
  Avoid clichés like "crisp and refreshing" unless they genuinely apply.]</p>
  <h2>Perfect With</h2>
  <p>[Food pairing + occasion. Specific meal or setting recommendation.]</p>
</div>
```

**Sake**
```html
<div class="prod-desc">
  <p class="lead">[Hook — kura (brewery) name, prefecture, grade and what defines
  this sake's character.]</p>
  <p>[Story — brewery history or philosophy, rice variety and polishing approach,
  what the region contributes. 2–3 sentences. Named entities.]</p>
  <h2>Tasting Notes</h2>
  <p>[Prose — aroma profile (fruity, floral, earthy), palate texture (dry/sweet
  balance, umami), finish. Evocative without being overly technical.]</p>
  <h2>Best Enjoyed</h2>
  <p>[Temperature recommendation (chilled / room / warm), vessel, and food pairing.
  Specific and culturally informed.]</p>
</div>
```

**Accessories / Glassware**
```html
<div class="prod-desc">
  <p class="lead">[Hook — what it is, who it's for, why this particular product
  is worth owning rather than a generic alternative.]</p>
  <p>[Story — brand heritage, design philosophy, material quality. 2–3 sentences.
  Specific named entities where relevant (Riedel, Zalto, etc.).]</p>
  <h2>Why It Enhances Your Experience</h2>
  <p>[Functional benefit — how this shape, material, or design actually improves
  the drinking experience. Evidence-based, not marketing language.]</p>
  <h2>Best Used For</h2>
  <p>[Specific drink types, occasions, gifting context. Practical and specific.]</p>
</div>
```

---

### Claude system prompt

```
You are a product content writer for an online wine and spirits retailer in Thailand
serving both Wine-now and LIQ9. Write in clear, engaging English as an expert retailer
recommending products to customers — third-party voice, never brand voice. Never use
"we", "our", or first-person. The page template already displays all structured
attributes (style, vintage, ABV, body, food matching, etc.) so do not repeat them
as lists. Instead write storytelling content: producer context, what makes this
product distinctive, evocative tasting prose, and specific occasion or pairing
guidance. Include specific named entities (producer names, appellations, grape
varieties, techniques) naturally in prose — this improves SEO and AI discoverability.
```

### Claude user prompt (per product)

```
Product: {name}
SKU base: {sku_base}
Category: {classification}
Existing data (KNOWN = do not change; NULL = infer from name and descriptions):
  country:           {country ?? "NULL"}
  region:            {region ?? "NULL"}
  style:             {style ?? "NULL"}
  style_detail:      {style_detail ?? "NULL"}
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

Write the full description using the HTML template for {category_template_name}.
Return a JSON object. For taxonomy fields marked KNOWN, echo back the existing value
unchanged. For fields marked NULL, infer from product name and source descriptions.
Always write both descriptions as retailer storytelling content.
```

### Claude response schema

```json
{
  "desc_en_short": "string, 1–2 sentences, 30–60 words, no HTML",
  "desc_en_full":  "string, HTML using category template, 180–300 words",
  "desc_confidence": 0.0,
  "style":         "string or null — from rules/styles/{category}.json taxonomy",
  "style_detail":  "string or null — free text detail (composition, age, ABV, polishing...)",
  "vintage":       "string or null — 4-digit year only",
  "brand":         "string or null",
  "country":       "string or null",
  "region":        "string or null",
  "subregion":     "string or null",
  "appellation":   "string or null",
  "wine_classification": "string or null",
  "wine_body":     "light | medium | full | null",
  "wine_acidity":  "low | medium | high | null",
  "wine_tannin":   "low | medium | high | null",
  "flavor_tags":   ["fruit","spice","oak","earth","floral","mineral","herbal"] or null,
  "food_matching": "pipe-separated string of allowed values or null"
}
```

**Allowed values — `food_matching`:** all 10 labels from `rules/food-keywords.json`:
`"Red Meat"`, `"Poultry"`, `"Seafood"`, `"Cheese"`, `"Pork"`, `"Dessert"`, `"Pasta"`, `"Vegetables"`, `"Spicy Food"`, `"Aperitif"`. Pipe-separated string, not a JSON array.

**Allowed values — `flavor_tags`:** JSON array of strings — `"fruit"`, `"spice"`, `"herbal"`, `"earth"`, `"oak"`, `"floral"`, `"mineral"`. The `flavor_tags` Supabase column is `TEXT` — application code serializes the array via `JSON.stringify()` before writing (e.g. `'["fruit","spice","oak"]'`). When reading, parse with `JSON.parse()`. Column type is not changed by this migration.

**Write rules (enforced in application code):**
- Taxonomy fields: only write to Supabase if current value is null or empty string
- Descriptions: always written (rewrite is mandatory regardless of triage flag)
- `wine_body`/`wine_acidity`/`wine_tannin`: validated against allowed values; invalid → null
- `vintage`: strip non-numeric suffix (e.g. `"2019 [**VINTAGE MAY CHANGE]"` → `"2019"`); null if no valid 4-digit year
- `desc_en_full`: validated to contain `<div class="prod-desc">` wrapper; if missing, flag for manual review

**`overall_confidence` on publish:**
Weighted average of existing rules-engine `overall_confidence` (weight 0.4) and `desc_confidence` from AI response (weight 0.6), clamped to 0.0–1.0. If no prior rules-engine confidence, use `desc_confidence` directly.

**Products with no source material** (both descriptions null, minimal data): Claude generates from name + classification + any known taxonomy. These get `desc_confidence` ≤ 0.70 and appear at the top of the Review Queue (lowest confidence first).

**Progress output:**
```
[Red Wine] 124/1821 — processed: 119 | errors: 5 | rate_limited: 0
```

---

## 9. Stage 4 — Review Queue

**Location:** `AIReviewQueuePage` — new page accessible from Processing Review via "Review & Publish" button.

Each processed product shows:
- **Before**: raw `short_description_en` + `description_en_text`
- **After**: AI-generated `desc_en_short` + rendered preview of `desc_en_full` HTML
- **Taxonomy diff**: null → proposed values only (existing non-null values shown greyed as "unchanged")
- Confidence score badge (≥0.85 green, 0.70–0.84 yellow, <0.70 red)

**Per-product actions:**
- **Approve** (default) — marks for publish
- **Edit** — inline HTML editor for `desc_en_full`; plain text editor for `desc_en_short`; taxonomy dropdowns constrained to `rules/styles/{category}.json`; saves as `desc_source: 'manual'`
- **Skip** — leaves product unchanged in Supabase

**Bulk actions (per category batch):**
- "Approve all high-confidence" (≥0.85)
- "Approve all" — includes low-confidence; excludes already-`manual` records
- "Skip all"

**Manual-edit protection:** products with existing `desc_source: 'manual'` shown with yellow badge, excluded from all bulk-approve. Require individual explicit approval.

---

## 10. Stage 5 — Publish + Sync

On publish of a primary variant:
1. Write all approved fields to the primary variant record in Supabase
2. Set `desc_source: 'ai_processed'` (or `'manual'` if edited), `desc_processed_at: now()`, updated `overall_confidence`
3. Fetch all variants with matching `sku_base`
4. Copy all shared fields (Section 2 list) to each variant — price/supplier fields untouched
5. `desc_source` on variants is copied from the primary via shared-field sync (not hard-coded — a manually-edited primary correctly propagates `'manual'` to variants)

**Batching:** groups of 50 primary SKUs. Write primary first, then sync variants.

**Partial failure handling:**
- Primary write fails: skip variant sync, add to primary-failed list, continue with next batch
- Primary succeeds but variant sync fails: primary remains published (not rolled back); failed variant SKUs added to "sync retry" list
- End-of-run summary: N published, N primary failures (retry available), N variant sync failures (retry available)

---

## 11. UI Changes

### Products Browser (`ProductsPage.tsx`)
- Groups by `sku_base` — one card per product (not per supplier variant)
- Variant badge: `3 suppliers`
- Expand to see per-variant pricing and supplier codes
- "Primary" tag on the primary variant row
- Style filter uses per-category taxonomy from `rules/styles/{category}.json`

### Processing Review Page (`ProcessingReviewPage.tsx`)
- Stage 1: "Run Rules Engine" button (existing)
- Stage 2: "Run Triage Scan" → renders inline triage summary table on completion
- Stage 3: "Start AI Enrichment" → category selector + estimated call count → confirm → progress with pause/resume
- "Review & Publish" → navigates to AI Review Queue page

### AI Review Queue (`AIReviewQueuePage.tsx` — new page)
- Default sort: confidence ascending (lowest first)
- Filterable by category, confidence band, triage flag
- Rendered HTML preview for `desc_en_full` (not raw code)
- Inline HTML editor on Edit mode
- Taxonomy dropdowns constrained to per-category allowed values

---

## 12. New Files

```
scripts/run-triage.ts                         Stage 2: scan primaries, write triage_flags
scripts/run-ai-enrichment.ts                  Stage 3: Claude batch, --category=red-wine, --limit=N, --dry-run
scripts/migration_description_taxonomy.sql    New columns + sku_base backfill + primary flag + style migration
scripts/migrate-style-fields.ts               One-time: split grape_variety % data → style + style_detail
rules/blend-styles.json                       Blend taxonomy (Bordeaux Blend, GSM Blend, etc.)
rules/styles/wine.json                        Grape varieties + blend styles (replaces grape-varieties.json)
rules/styles/whisky.json
rules/styles/gin.json
rules/styles/rum.json
rules/styles/tequila.json
rules/styles/vodka.json
rules/styles/liqueur.json
rules/styles/brandy.json
rules/styles/beer.json
rules/styles/sake.json
rules/styles/other.json
rules/styles/accessories.json
app/api/ai-enrichment/route.ts                POST: process single product, return result
app/api/ai-enrichment/publish/route.ts        POST: write approved records + sync variants
app/api/triage/route.ts                       POST: trigger scan; GET: fetch summary
```

**Modify:**
```
components/pages/ProcessingReviewPage.tsx     Stage 1–3 buttons + inline triage section
components/pages/ProductsPage.tsx             Group by sku_base, variant badge, per-category style filter
components/dashboard.tsx                      Add AI Review Queue navigation entry
```

**New components:**
```
components/pages/AIReviewQueuePage.tsx        Stage 4 review interface
```

---

## 13. Out of Scope (this phase)

- Thai descriptions (`desc_th_short` / `desc_th_full`) — separate phase
- Wheel components (Character/Flavour/Aromatic wheels) — Description Manager spec, separate phase
- Manual per-product description editing beyond inline Review Queue edits
- Automated re-enrichment trigger (scheduled runs)
- Bulk image processing
- Final drop of `grape_variety` column (done in a follow-up cleanup migration once all consumers updated)

---

## 14. Database Migration

```sql
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

-- Backfill sku_base
UPDATE products SET sku_base = LEFT(sku, 7) WHERE sku_base IS NULL;

-- Set all rows to FALSE first (handles NULL from DEFAULT on pre-existing rows)
UPDATE products SET is_primary_variant = FALSE;

-- Set TRUE for the lowest-suffix SKU per sku_base
UPDATE products p
SET is_primary_variant = TRUE
WHERE sku = (
  SELECT sku FROM products p2
  WHERE p2.sku_base = p.sku_base
  ORDER BY sku ASC
  LIMIT 1
);

-- Migrate grape_variety → style + style_detail (handled by migrate-style-fields.ts script;
-- grape_variety column retained during transition, dropped in follow-up migration)

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
| Whisky | ~820 | ~820 |
| Other Spirits | ~280 | ~280 |
| Beer / Sake | ~420 | ~420 |
| Accessories / Other | ~480 | ~480 |
| **Total** | **~5,606** | **~5,606** |

~5,600 Claude API calls (non-primary variants receive synced data for free). Estimated run time: 45–90 minutes at 5 concurrent calls.
