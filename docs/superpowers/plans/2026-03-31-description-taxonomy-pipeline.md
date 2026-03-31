# Description & Taxonomy Enrichment Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a five-stage pipeline (SQL migration → style taxonomy → triage → AI enrichment → review + publish) that validates, paraphrases, and generates English descriptions and fills all taxonomy gaps for all 11,564 products across all categories.

**Architecture:** Foundational SQL migration creates new columns; per-category style taxonomy JSON files replace the old grape-varieties list; a triage script scans all primary variants and writes quality flags; an AI enrichment script calls Claude for one product at a time (5 concurrent) returning descriptions + taxonomy as a single JSON response; a review UI lets the team approve/edit each result before publishing; publish writes to the primary and syncs all shared fields to supplier variants.

**Tech Stack:** TypeScript + tsx (scripts), Next.js App Router (API routes), React + Tailwind (UI), Supabase REST API, Anthropic Claude API (`claude-sonnet-4-6`), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `ANTHROPIC_API_KEY` env vars.

---

> **Note on testing:** This codebase has no test framework configured. Each task uses one of:
> - `--dry-run` mode (scripts print changes without writing to DB)
> - Manual DB spot-checks via Supabase dashboard
> - TypeScript compilation (`npx tsc --noEmit`) as a baseline correctness gate
> - Explicit smoke-test commands that verify expected output strings

---

## File Map

**Create:**
```
scripts/migration_description_taxonomy.sql     New columns + sku_base backfill + primary variant flag
scripts/migrate-style-fields.ts                One-time: split grape_variety → style + style_detail
scripts/run-triage.ts                          Stage 2: scan primaries, write triage_flags
scripts/run-ai-enrichment.ts                   Stage 3: Claude batch enrichment
rules/styles/wine.json                         Grape varieties + blend styles
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
app/api/triage/route.ts                        POST: trigger triage scan; GET: fetch summary
app/api/ai-enrichment/route.ts                 POST: process single product, return result
app/api/ai-enrichment/publish/route.ts         POST: write approved records + sync variants
components/pages/AIReviewQueuePage.tsx         Stage 4 review interface
```

**Modify:**
```
components/pages/ProcessingReviewPage.tsx      Add triage card + AI enrichment card
components/pages/ProductsPage.tsx              Group by sku_base, variant badge, style filter
components/dashboard.tsx                       Add AI Review Queue nav entry
```

---

## Task 1: Database Migration

**Files:**
- Create: `scripts/migration_description_taxonomy.sql`

- [ ] **Step 1: Write the SQL migration file**

```sql
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

CREATE INDEX IF NOT EXISTS idx_products_sku_base ON products(sku_base);
CREATE INDEX IF NOT EXISTS idx_products_primary  ON products(sku_base, is_primary_variant);
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

Open Supabase dashboard → SQL Editor → paste and run the full migration.

Expected: "Success. 9 columns added." No errors.

- [ ] **Step 3: Spot-check the migration**

Run this query in Supabase SQL Editor:
```sql
SELECT
  COUNT(*) FILTER (WHERE sku_base IS NOT NULL) AS sku_base_filled,
  COUNT(*) FILTER (WHERE is_primary_variant = TRUE) AS primary_count,
  COUNT(*) FILTER (WHERE is_primary_variant = FALSE) AS variant_count,
  COUNT(DISTINCT sku_base) AS distinct_products
FROM products;
```

Expected:
- `sku_base_filled` ≈ 11,564
- `primary_count` = `distinct_products`
- `variant_count` = total − primary_count
- Spot-check: `SELECT sku, sku_base, is_primary_variant FROM products WHERE sku_base = 'WWW0448' ORDER BY sku` — should show only lowest SKU as TRUE

- [ ] **Step 4: Commit the SQL file**

```bash
git add scripts/migration_description_taxonomy.sql
git commit -m "feat: add DB migration for description/taxonomy pipeline columns"
```

---

## Task 2: Style Taxonomy JSON Files

**Files:**
- Create: `rules/styles/wine.json`, `rules/styles/whisky.json`, `rules/styles/gin.json`, `rules/styles/rum.json`, `rules/styles/tequila.json`, `rules/styles/vodka.json`, `rules/styles/liqueur.json`, `rules/styles/brandy.json`, `rules/styles/beer.json`, `rules/styles/sake.json`, `rules/styles/other.json`, `rules/styles/accessories.json`

- [ ] **Step 1: Create the `rules/styles/` directory and wine.json**

`rules/styles/wine.json` — grape varieties + blend styles (migrated from `rules/grape-varieties.json`, names only, flat array):

```json
[
  "Cabernet Sauvignon",
  "Merlot",
  "Pinot Noir",
  "Syrah",
  "Grenache",
  "Malbec",
  "Tempranillo",
  "Sangiovese",
  "Nebbiolo",
  "Barbera",
  "Montepulciano",
  "Zinfandel",
  "Pinotage",
  "Carménère",
  "Chardonnay",
  "Sauvignon Blanc",
  "Riesling",
  "Pinot Gris",
  "Gewurztraminer",
  "Viognier",
  "Muscat",
  "Chenin Blanc",
  "Semillon",
  "Albariño",
  "Grüner Veltliner",
  "Torrontés",
  "Vermentino",
  "Fiano",
  "Greco",
  "Primitivo",
  "Corvina",
  "Nero d'Avola",
  "Aglianico",
  "Touriga Nacional",
  "Garnacha Blanca",
  "Verdejo",
  "Godello",
  "Roussanne",
  "Marsanne",
  "Grenache Blanc",
  "Bourboulenc",
  "Clairette",
  "Furmint",
  "Assyrtiko",
  "Xinomavro",
  "Agiorgitiko",
  "Bordeaux Blend",
  "Rhône Blend",
  "Grenache-Syrah-Mourvèdre",
  "GSM Blend",
  "Tuscan Blend",
  "Meritage",
  "Field Blend",
  "Other Blend"
]
```

- [ ] **Step 2: Create `rules/styles/whisky.json`**

```json
[
  "Single Malt Scotch",
  "Blended Scotch",
  "Blended Malt Scotch",
  "Single Grain Scotch",
  "Blended Grain Scotch",
  "Bourbon",
  "Tennessee Whiskey",
  "Rye Whiskey",
  "Wheat Whiskey",
  "Corn Whiskey",
  "Japanese Single Malt",
  "Japanese Blended",
  "Irish Single Malt",
  "Irish Blended",
  "Irish Pot Still",
  "Canadian Whisky",
  "Taiwanese Whisky",
  "Indian Single Malt",
  "Australian Whisky",
  "Other Single Malt",
  "Other Blended Whisky"
]
```

- [ ] **Step 3: Create remaining style JSON files**

`rules/styles/gin.json`:
```json
["London Dry Gin","Old Tom Gin","Contemporary Gin","Sloe Gin","Navy Strength Gin","Barrel-Aged Gin","Floral Gin","Citrus Gin","Spiced Gin","Other Gin"]
```

`rules/styles/rum.json`:
```json
["White Rum","Gold Rum","Dark Rum","Aged Rum","Spiced Rum","Overproof Rum","Rhum Agricole","Cachaça","Falernum","Other Rum"]
```

`rules/styles/tequila.json`:
```json
["Blanco Tequila","Reposado Tequila","Añejo Tequila","Extra Añejo Tequila","Cristalino Tequila","Mezcal","Other Agave Spirit"]
```

`rules/styles/vodka.json`:
```json
["Plain Vodka","Flavoured Vodka","Grain Vodka","Potato Vodka","Rye Vodka","Wheat Vodka","Other Vodka"]
```

`rules/styles/liqueur.json`:
```json
["Coffee Liqueur","Herbal Liqueur","Fruit Liqueur","Cream Liqueur","Nut Liqueur","Floral Liqueur","Chocolate Liqueur","Citrus Liqueur","Anise Liqueur","Triple Sec","Other Liqueur"]
```

`rules/styles/brandy.json`:
```json
["Cognac VS","Cognac VSOP","Cognac XO","Armagnac","Calvados","Pisco","Grappa","Spanish Brandy","Other Brandy"]
```

`rules/styles/beer.json`:
```json
["Lager","Pilsner","Pale Ale","American Pale Ale","India Pale Ale","Double IPA","Wheat Beer","Hefeweizen","Witbier","Stout","Imperial Stout","Porter","Saison","Belgian Ale","Dubbel","Tripel","Quadrupel","Sour Ale","Gose","Lambic","Amber Ale","Red Ale","Brown Ale","Cream Ale","Kolsch","Bock","Doppelbock","Session IPA","Hazy IPA","Craft Lager","Other Beer"]
```

`rules/styles/sake.json`:
```json
["Junmai","Honjozo","Ginjo","Junmai Ginjo","Daiginjo","Junmai Daiginjo","Nigori","Sparkling Sake","Namazake","Koshu","Other Sake"]
```

`rules/styles/other.json`:
```json
["Non-Alcoholic Wine","Non-Alcoholic Beer","Non-Alcoholic Spirit","Other Spirit","Aperitif","Vermouth","Absinthe","Bitters"]
```

`rules/styles/accessories.json`:
```json
["Wine Glass","Champagne Flute","White Wine Glass","Red Wine Glass","Decanter","Carafe","Beer Glass","Whisky Glass","Cocktail Glass","Shot Glass","Wine Cooler","Wine Rack","Corkscrew","Wine Stopper","Aerator","Wine Thermometer","Glassware Set","Bar Tool","Other Accessory"]
```

- [ ] **Step 4: Verify JSON files are valid**

```bash
node -e "
const fs = require('fs');
const path = require('path');
const dir = 'rules/styles';
fs.readdirSync(dir).forEach(f => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  console.log(f, Array.isArray(data) ? data.length + ' entries OK' : 'ERROR: not array');
});
"
```

Expected: each file prints `N entries OK`, no ERROR lines.

- [ ] **Step 5: Create `rules/blend-styles.json`** (referenced in spec Section 12 as a standalone lookup for the rules engine)

```json
[
  "Bordeaux Blend",
  "Rhône Blend",
  "Grenache-Syrah-Mourvèdre",
  "GSM Blend",
  "Tuscan Blend",
  "Meritage",
  "Field Blend",
  "Other Blend"
]
```

- [ ] **Step 6: Commit**

```bash
git add rules/styles/ rules/blend-styles.json
git commit -m "feat: add per-category style taxonomy JSON files and blend-styles.json"
```

---

## Task 3: Migrate Style Fields Script

**Files:**
- Create: `scripts/migrate-style-fields.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-style-fields.ts
// One-time: split grape_variety data → style + style_detail.
// Run AFTER SQL migration (columns must exist) and BEFORE triage scan.
//
// Usage:
//   npx tsx scripts/migrate-style-fields.ts
//   npx tsx scripts/migrate-style-fields.ts --dry-run
//   npx tsx scripts/migrate-style-fields.ts --limit=100

import fs from 'fs';
import path from 'path';

const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT    = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const PAGE     = 500;
const PATCH_BATCH = 50;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

// Load approved wine style values for taxonomy proposal check
const WINE_STYLES: string[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'rules/styles/wine.json'), 'utf-8')
);
const WINE_STYLE_SET = new Set(WINE_STYLES.map(s => s.toLowerCase()));

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

/** Extract primary variety name from a potentially-percentage-mixed string */
function extractPrimaryVariety(raw: string): string {
  // "85% Cab Sauv / 15% Merlot" → "Cab Sauv"
  // "Cabernet Sauvignon" → "Cabernet Sauvignon"
  const pctMatch = raw.match(/^(\d+)%\s*(.+?)(?:\s*\/|$)/);
  if (pctMatch) {
    return pctMatch[2].trim();
  }
  // "60% Cabernet Sauvignon / 40% Merlot" → "Cabernet Sauvignon"
  const pctMatch2 = raw.match(/\d+%\s*(.+?)(?:\s*\/)/);
  if (pctMatch2) return pctMatch2[1].trim();
  return raw.trim();
}

/** Normalise to Title Case */
function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function fetchProducts(offset: number, limit: number): Promise<any[]> {
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,grape_variety,classification&grape_variety=not.is.null&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchBatch(patches: Array<{ id: string; style?: string; style_detail?: string; grape_variety: null }>): Promise<void> {
  if (DRY_RUN || patches.length === 0) return;
  for (let i = 0; i < patches.length; i += PATCH_BATCH) {
    const chunk = patches.slice(i, i + PATCH_BATCH);
    const ids = chunk.map(p => p.id).join(',');
    // Individual PATCH per record to set different style/style_detail values
    await Promise.all(chunk.map(async (p) => {
      const body: Record<string, any> = { grape_variety: null };
      if (p.style) body.style = p.style;
      if (p.style_detail) body.style_detail = p.style_detail;
      const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error(`  PATCH failed for ${p.id}: ${res.status}`);
    }));
  }
}

async function emitTaxonomyProposal(style: string, sku: string): Promise<void> {
  if (DRY_RUN) return;
  const res = await sbFetch(`${BASE_URL}/rest/v1/taxonomy_proposals`, {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ type: 'style', value: style, source_sku: sku, status: 'pending' }),
  });
  if (!res.ok && res.status !== 409) {
    console.error(`  taxonomy_proposals insert failed: ${res.status}`);
  }
}

async function main() {
  console.log(`migrate-style-fields${DRY_RUN ? ' [DRY RUN]' : ''}`);
  let offset = 0;
  let totalMigrated = 0;
  let totalProposals = 0;
  const patches: Array<{ id: string; style?: string; style_detail?: string; grape_variety: null }> = [];
  const proposals: Array<{ style: string; sku: string }> = [];

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchProducts(offset, limit);
    if (rows.length === 0) break;

    for (const row of rows) {
      const raw: string = row.grape_variety;
      const hasPercent = /\d+%/.test(raw);
      let style: string | undefined;
      let style_detail: string | undefined;

      if (hasPercent) {
        const primary = extractPrimaryVariety(raw);
        style = toTitleCase(primary);
        style_detail = raw.trim();
      } else {
        style = raw.trim();
      }

      // Check against wine taxonomy (only wines have grape varieties)
      if (style && !WINE_STYLE_SET.has(style.toLowerCase())) {
        proposals.push({ style, sku: row.sku });
      }

      patches.push({ id: row.id, style, style_detail, grape_variety: null });
    }

    totalMigrated += rows.length;
    offset += rows.length;
    if (rows.length < PAGE) break;
    process.stdout.write(`  Fetched ${totalMigrated} products...\r`);
  }

  console.log(`\n  Total products to migrate: ${totalMigrated}`);
  console.log(`  Taxonomy proposals: ${proposals.length}`);

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] First 5 patches:');
    patches.slice(0, 5).forEach(p => console.log('  ', JSON.stringify(p)));
    console.log('\n  [DRY RUN] First 5 proposals:');
    proposals.slice(0, 5).forEach(p => console.log('  ', JSON.stringify(p)));
    return;
  }

  // Write patches in batches
  for (let i = 0; i < patches.length; i += PATCH_BATCH) {
    await patchBatch(patches.slice(i, i + PATCH_BATCH));
    process.stdout.write(`  Written ${Math.min(i + PATCH_BATCH, patches.length)}/${patches.length}\r`);
  }

  // Write taxonomy proposals
  for (const p of proposals) {
    await emitTaxonomyProposal(p.style, p.sku);
    totalProposals++;
  }

  console.log(`\n  Done. Migrated: ${totalMigrated} | Proposals emitted: ${totalProposals}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Compile-check**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Dry-run smoke test**

```bash
npx tsx scripts/migrate-style-fields.ts --dry-run --limit=20
```

Expected output:
```
migrate-style-fields [DRY RUN]
  Total products to migrate: 20
  Taxonomy proposals: N
  [DRY RUN] First 5 patches:
  { id: '...', style: '...', style_detail: ..., grape_variety: null }
  ...
```

Verify: patches with `%` strings have both `style` and `style_detail`; clean names have `style` only with `style_detail` absent.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-style-fields.ts
git commit -m "feat: add migrate-style-fields script — split grape_variety into style + style_detail"
```

---

## Task 4: Triage Script + API Route

**Files:**
- Create: `scripts/run-triage.ts`
- Create: `app/api/triage/route.ts`

- [ ] **Step 1: Write `scripts/run-triage.ts`**

```typescript
// scripts/run-triage.ts
// Stage 2: scan primary variants, write triage_flags.
// Pre-scan: seeds desc_source = 'original' for products with existing descriptions.
//
// Usage:
//   npx tsx scripts/run-triage.ts
//   npx tsx scripts/run-triage.ts --dry-run
//   npx tsx scripts/run-triage.ts --limit=200

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const PAGE     = 500;
const PATCH_BATCH = 50;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) { console.error('Missing env vars'); process.exit(1); }

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000 * (i+1))); continue; }
      return res;
    } catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, 1000*(i+1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

const BRAND_VOICE_RE = /\b(we|our|we've|we craft|we produce)\b/i;
const HTML_TAG_RE    = /<[a-z][^>]*>/i;
const WINE_CLASSIFICATIONS = new Set([
  'red wine','white wine','rosé wine','rosé','rose wine','dessert wine',
  'sparkling wine','champagne','prosecco','cava','crémant',
]);
const SENSORY_FIELDS = ['wine_body','wine_acidity','wine_tannin'] as const;

function computeFlags(row: Record<string, any>): string {
  const short = row.short_description_en ?? '';
  const full  = row.description_en_text ?? '';
  const combined = `${short} ${full}`.trim();
  const cls = (row.classification ?? '').toLowerCase();

  const flags: string[] = [];

  // Description flags
  if (!short && !full) {
    flags.push('desc_missing');
  } else if (short && !full) {
    flags.push('desc_short_only');
  } else {
    if (BRAND_VOICE_RE.test(combined)) flags.push('desc_brand_voice');
    if (HTML_TAG_RE.test(combined))    flags.push('desc_html');
    if (flags.length === 0)            flags.push('desc_ok');
  }

  // Taxonomy completeness
  const taxoMissing: string[] = [];
  if (!row.country)  taxoMissing.push('country');
  if (!row.region)   taxoMissing.push('region');
  const isAccessory = /access|glassware|glass|decant|opener/i.test(cls);
  if (!isAccessory && !row.style) taxoMissing.push('style');
  if (!row.brand)    taxoMissing.push('brand');
  const isWine = WINE_CLASSIFICATIONS.has(cls);
  if (isWine) {
    for (const f of SENSORY_FIELDS) {
      if (!row[f]) taxoMissing.push(f);
    }
  }
  if (taxoMissing.length > 0) flags.push('taxonomy_incomplete');

  return flags.join(',');
}

type TriageRow = { id: string; triage_flags: string; desc_source?: string };

async function fetchPrimaryBatch(offset: number, limit: number): Promise<any[]> {
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,classification,short_description_en,description_en_text,country,region,style,brand,wine_body,wine_acidity,wine_tannin,desc_source&is_primary_variant=eq.true&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchBatch(rows: TriageRow[]): Promise<void> {
  if (DRY_RUN || rows.length === 0) return;
  await Promise.all(rows.map(async (r) => {
    const body: Record<string, any> = { triage_flags: r.triage_flags };
    if (r.desc_source !== undefined) body.desc_source = r.desc_source;
    const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`  PATCH failed for ${r.id}: ${res.status}`);
  }));
}

async function main() {
  console.log(`run-triage${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // Summary counters: { classification → { flag → count } }
  const summary: Record<string, Record<string, number>> = {};
  let offset = 0;
  let total = 0;

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchPrimaryBatch(offset, limit);
    if (rows.length === 0) break;

    const patches: TriageRow[] = [];

    for (const row of rows) {
      const flags = computeFlags(row);
      const cls = row.classification ?? 'Unknown';

      // Pre-scan seeding: set desc_source = 'original' if it's null but descriptions exist
      const descSource = (!row.desc_source && (row.short_description_en || row.description_en_text))
        ? 'original'
        : undefined;

      patches.push({ id: row.id, triage_flags: flags, ...(descSource ? { desc_source: descSource } : {}) });

      // Accumulate summary
      if (!summary[cls]) summary[cls] = {};
      for (const flag of flags.split(',')) {
        summary[cls][flag] = (summary[cls][flag] ?? 0) + 1;
      }
    }

    await patchBatch(patches);
    total += rows.length;
    offset += rows.length;
    process.stdout.write(`  Scanned ${total} primaries...\r`);
    if (rows.length < PAGE) break;
  }

  console.log(`\n  Done. Scanned ${total} primary variants.`);
  console.log('\nTriage summary:');
  console.log('  Classification          | desc_missing | desc_short_only | desc_brand_voice | desc_html | desc_ok | taxonomy_incomplete');
  console.log('  ' + '-'.repeat(110));
  for (const [cls, counts] of Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = [
      cls.padEnd(23),
      String(counts['desc_missing'] ?? 0).padStart(12),
      String(counts['desc_short_only'] ?? 0).padStart(15),
      String(counts['desc_brand_voice'] ?? 0).padStart(16),
      String(counts['desc_html'] ?? 0).padStart(9),
      String(counts['desc_ok'] ?? 0).padStart(7),
      String(counts['taxonomy_incomplete'] ?? 0).padStart(19),
    ].join(' | ');
    console.log('  ' + row);
  }

  // Write summary JSON for the UI to read
  if (!DRY_RUN) {
    const fs = await import('fs');
    const p = await import('path');
    const dir = p.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p.join(dir, 'triage_summary.json'), JSON.stringify({ total, summary, generated_at: new Date().toISOString() }, null, 2));
    console.log('  Written data/triage_summary.json');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Write `app/api/triage/route.ts`**

```typescript
// app/api/triage/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

// GET — return the last triage summary JSON (if present)
export async function GET() {
  const summaryPath = path.join(process.cwd(), 'data', 'triage_summary.json');
  if (!fs.existsSync(summaryPath)) {
    return NextResponse.json({ ok: false, summary: null }, { status: 200 });
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  return NextResponse.json({ ok: true, summary });
}

// POST — trigger triage scan
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-triage.ts'];

  const limit = Number(body.limit);
  if (Number.isInteger(limit) && limit > 0 && limit <= 20_000) {
    args.push(`--limit=${limit}`);
  }

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));
  child.on('error', (err) => lines.push(`[spawn error] ${err.message}`));

  const code = await new Promise<number>(res => child.on('close', res));
  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
```

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Dry-run smoke test**

```bash
npx tsx scripts/run-triage.ts --dry-run --limit=50
```

Expected: prints triage summary table with counts per classification. No Supabase writes.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-triage.ts app/api/triage/route.ts
git commit -m "feat: add triage scan script and API route (Stage 2)"
```

---

## Task 5: AI Enrichment Script + API Route

**Files:**
- Create: `scripts/run-ai-enrichment.ts`
- Create: `app/api/ai-enrichment/route.ts`

- [ ] **Step 1: Write `scripts/run-ai-enrichment.ts`**

```typescript
// scripts/run-ai-enrichment.ts
// Stage 3: Claude API enrichment — descriptions + taxonomy in one pass.
//
// Usage:
//   npx tsx scripts/run-ai-enrichment.ts
//   npx tsx scripts/run-ai-enrichment.ts --dry-run
//   npx tsx scripts/run-ai-enrichment.ts --category="Red Wine" --limit=10
//   npx tsx scripts/run-ai-enrichment.ts --batch=1   (batch numbers from spec Section 8)

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT    = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const CATEGORY = (() => { const m = process.argv.find(a => a.startsWith('--category=')); return m ? m.split('=').slice(1).join('=') : null; })();
const BATCH_N  = (() => { const m = process.argv.find(a => a.startsWith('--batch=')); return m ? parseInt(m.split('=')[1]) : 0; })();

const CONCURRENCY = 5;
const PAGE        = 500;
const PATCH_BATCH = 50;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) { console.error('Missing Supabase env vars'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Batch definitions: number → [classifications]
const BATCHES: Record<number, string[]> = {
  1: ['Red Wine'],
  2: ['White Wine'],
  3: ['Rosé Wine', 'Rosé', 'Rose Wine', 'Dessert Wine'],
  4: ['Sparkling Wine', 'Champagne', 'Prosecco', 'Cava', 'Crémant'],
  5: ['Whisky', 'Whiskey'],
  6: ['Gin', 'Rum', 'Tequila', 'Vodka', 'Brandy', 'Liqueur', 'Other Spirit'],
  7: ['Beer'],
  8: ['Sake'],
  9: ['Accessory', 'Glassware', 'Non-Alcoholic', 'Other'],
};

const TEMPLATE_MAP: Record<string, string> = {
  'red wine': 'wine', 'white wine': 'wine', 'rosé wine': 'wine', 'rosé': 'wine',
  'rose wine': 'wine', 'dessert wine': 'wine',
  'sparkling wine': 'sparkling', 'champagne': 'sparkling', 'prosecco': 'sparkling',
  'cava': 'sparkling', 'crémant': 'sparkling',
  'whisky': 'whisky', 'whiskey': 'whisky',
  'gin': 'spirits', 'rum': 'spirits', 'tequila': 'spirits', 'vodka': 'spirits',
  'brandy': 'spirits', 'liqueur': 'spirits', 'other spirit': 'spirits',
  'beer': 'beer', 'sake': 'sake',
  'accessory': 'accessories', 'glassware': 'accessories',
  'non-alcoholic': 'accessories', 'other': 'accessories',
};

function getTemplate(classification: string): string {
  return TEMPLATE_MAP[classification.toLowerCase()] ?? 'wine';
}

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000*(i+1))); continue; }
      return res;
    } catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, 1000*(i+1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

const SYSTEM_PROMPT = `You are a product content writer for an online wine and spirits retailer in Thailand serving both Wine-now and LIQ9. Write in clear, engaging English as an expert retailer recommending products to customers — third-party voice, never brand voice. Never use "we", "our", or first-person. The page template already displays all structured attributes (style, vintage, ABV, body, food matching, etc.) so do not repeat them as lists. Instead write storytelling content: producer context, what makes this product distinctive, evocative tasting prose, and specific occasion or pairing guidance. Include specific named entities (producer names, appellations, grape varieties, techniques) naturally in prose — this improves SEO and AI discoverability.`;

function buildUserPrompt(row: Record<string, any>): string {
  const n = (v: any) => (v == null || v === '') ? 'NULL' : String(v);
  const template = getTemplate(row.classification ?? '');
  return `Product: ${row.name}
SKU base: ${row.sku_base ?? row.sku?.substring(0,7)}
Category: ${row.classification}
Existing data (KNOWN = do not change; NULL = infer from name and descriptions):
  country:           ${n(row.country)}
  region:            ${n(row.region)}
  style:             ${n(row.style)}
  style_detail:      ${n(row.style_detail)}
  vintage:           ${n(row.vintage)}
  brand:             ${n(row.brand)}
  wine_body:         ${n(row.wine_body)}
  wine_acidity:      ${n(row.wine_acidity)}
  wine_tannin:       ${n(row.wine_tannin)}
  subregion:         ${n(row.subregion)}
  appellation:       ${n(row.appellation)}
  wine_classification: ${n(row.wine_classification)}
  flavor_tags:       ${n(row.flavor_tags)}
  food_matching:     ${n(row.food_matching)}

Source descriptions (raw — may be brand voice, HTML, or empty):
  Short: "${row.short_description_en ?? ''}"
  Full:  "${row.description_en_text ?? ''}"

Write the full description using the HTML template for ${template}.
Return a JSON object with these exact keys:
{
  "desc_en_short": "string, 1-2 sentences, 30-60 words, no HTML",
  "desc_en_full":  "string, HTML using ${template} template, 180-300 words, must start with <div class=\\"prod-desc\\">",
  "desc_confidence": number 0.0-1.0,
  "style":         "string or null",
  "style_detail":  "string or null",
  "vintage":       "4-digit year string or null",
  "brand":         "string or null",
  "country":       "string or null",
  "region":        "string or null",
  "subregion":     "string or null",
  "appellation":   "string or null",
  "wine_classification": "string or null",
  "wine_body":     "light or medium or full or null",
  "wine_acidity":  "low or medium or high or null",
  "wine_tannin":   "low or medium or high or null",
  "flavor_tags":   ["fruit","spice","oak","earth","floral","mineral","herbal"] (array or null),
  "food_matching": "pipe-separated from: Red Meat|Poultry|Seafood|Cheese|Pork|Dessert|Pasta|Vegetables|Spicy Food|Aperitif or null"
}
For KNOWN fields, echo back the existing value. For NULL fields, infer from the product name and source descriptions.`;
}

async function callClaude(row: Record<string, any>): Promise<Record<string, any>> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(row) }],
  });
  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  // Extract JSON block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response for ${row.sku}`);
  return JSON.parse(match[0]);
}

function validateResponse(ai: Record<string, any>, row: Record<string, any>): Record<string, any> {
  const VALID_BODY     = new Set(['light','medium','full']);
  const VALID_ACIDITY  = new Set(['low','medium','high']);
  const VALID_TANNIN   = new Set(['low','medium','high']);
  const VALID_FOOD     = new Set(['Red Meat','Poultry','Seafood','Cheese','Pork','Dessert','Pasta','Vegetables','Spicy Food','Aperitif']);

  const result: Record<string, any> = {
    desc_en_short: ai.desc_en_short ?? null,
    desc_en_full:  ai.desc_en_full ?? null,
    desc_confidence: Math.max(0, Math.min(1, Number(ai.desc_confidence) || 0)),
  };

  // Validate desc_en_full has required wrapper
  if (result.desc_en_full && !result.desc_en_full.includes('<div class="prod-desc">')) {
    console.warn(`  WARNING: desc_en_full missing <div class="prod-desc"> wrapper for ${row.sku} — flagging`);
    result.desc_confidence = Math.min(result.desc_confidence, 0.5);
  }

  // Taxonomy: only write if current value is null/empty
  const taxFields = ['style','style_detail','vintage','brand','country','region','subregion','appellation','wine_classification'];
  for (const f of taxFields) {
    const current = row[f];
    if (current == null || current === '') {
      // vintage: strip non-numeric
      if (f === 'vintage' && ai[f]) {
        const m = String(ai[f]).match(/\d{4}/);
        result[f] = m ? m[0] : null;
      } else {
        result[f] = ai[f] ?? null;
      }
    }
  }

  const sensory: Record<string, Set<string>> = { wine_body: VALID_BODY, wine_acidity: VALID_ACIDITY, wine_tannin: VALID_TANNIN };
  for (const [f, valid] of Object.entries(sensory)) {
    if (!row[f]) {
      const v = ai[f]?.toLowerCase();
      result[f] = valid.has(v) ? v : null;
    }
  }

  // flavor_tags: array → JSON string
  if (!row.flavor_tags && ai.flavor_tags) {
    const arr = Array.isArray(ai.flavor_tags) ? ai.flavor_tags : null;
    result.flavor_tags = arr ? JSON.stringify(arr) : null;
  }

  // food_matching: validate pipe-separated values
  if (!row.food_matching && ai.food_matching) {
    const items = String(ai.food_matching).split('|').map(s => s.trim()).filter(s => VALID_FOOD.has(s));
    result.food_matching = items.length > 0 ? items.join('|') : null;
  }

  return result;
}

async function fetchProductBatch(classifications: string[], offset: number, limit: number): Promise<any[]> {
  // Build OR filter for classifications
  const clsFilter = classifications.map(c => `classification.eq.${encodeURIComponent(c)}`).join(',');
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,sku_base,name,classification,country,region,subregion,appellation,style,style_detail,vintage,brand,wine_body,wine_acidity,wine_tannin,wine_classification,flavor_tags,food_matching,short_description_en,description_en_text,desc_source&is_primary_variant=eq.true&or=(${clsFilter})&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function saveResult(productId: string, result: Record<string, any>): Promise<void> {
  // Save to data/enrichment_results/ as JSON files for review queue
  const dir = path.join(process.cwd(), 'data', 'enrichment_results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${productId}.json`), JSON.stringify(result, null, 2));
}

async function processProduct(row: Record<string, any>, stats: { processed: number; errors: number; rate_limited: number }): Promise<void> {
  try {
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would process: ${row.sku} — ${row.name?.substring(0, 60)}`);
      stats.processed++;
      return;
    }
    const ai = await callClaude(row);
    const validated = validateResponse(ai, row);
    await saveResult(row.id, {
      product_id: row.id,
      sku: row.sku,
      sku_base: row.sku_base,
      name: row.name,
      classification: row.classification,
      status: 'pending_review',
      processed_at: new Date().toISOString(),
      desc_confidence: validated.desc_confidence,
      // Preserve original desc_source so review queue can apply manual-edit protection
      // to products that had desc_source = 'manual' before AI processing.
      original_desc_source: row.desc_source ?? null,
      result: validated,
      original: {
        short_description_en: row.short_description_en,
        description_en_text: row.description_en_text,
      },
    });
    stats.processed++;
  } catch (e: any) {
    if (e.message?.includes('rate_limit') || e.status === 429) {
      stats.rate_limited++;
    } else {
      stats.errors++;
    }
    console.error(`  ERROR ${row.sku}: ${e.message}`);
  }
}

async function runBatch(classifications: string[]): Promise<void> {
  const stats = { processed: 0, errors: 0, rate_limited: 0 };
  const label = classifications[0];
  let offset = 0;
  let total = 0;

  // Count total for progress display
  const countRes = await sbFetch(
    `${BASE_URL}/rest/v1/products?is_primary_variant=eq.true&or=(${classifications.map(c => `classification.eq.${encodeURIComponent(c)}`).join(',')})&select=id`,
    { method: 'GET', headers: { Prefer: 'count=exact', Range: '0-0' } }
  );
  const contentRange = countRes.headers.get('content-range') ?? '';
  const grandTotal = parseInt(contentRange.split('/')[1] ?? '0') || 0;

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchProductBatch(classifications, offset, limit);
    if (rows.length === 0) break;

    // Process CONCURRENCY at a time
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(r => processProduct(r, stats)));
      total = offset + Math.min(i + CONCURRENCY, rows.length);
      process.stdout.write(`  [${label}] ${total}/${grandTotal} — processed: ${stats.processed} | errors: ${stats.errors} | rate_limited: ${stats.rate_limited}\r`);
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  console.log(`\n  [${label}] Complete — processed: ${stats.processed} | errors: ${stats.errors} | rate_limited: ${stats.rate_limited}`);
}

async function main() {
  console.log(`run-ai-enrichment${DRY_RUN ? ' [DRY RUN]' : ''}`);

  let batchesToRun: Record<number, string[]> = { ...BATCHES };

  if (BATCH_N > 0) {
    if (!BATCHES[BATCH_N]) { console.error(`Invalid batch number: ${BATCH_N}. Valid: 1-9`); process.exit(1); }
    batchesToRun = { [BATCH_N]: BATCHES[BATCH_N] };
  } else if (CATEGORY) {
    // Find which batch contains this classification
    const found = Object.entries(BATCHES).find(([, clss]) =>
      clss.some(c => c.toLowerCase() === CATEGORY!.toLowerCase())
    );
    if (!found) { console.error(`Unknown category: ${CATEGORY}`); process.exit(1); }
    batchesToRun = { [Number(found[0])]: found[1] };
  }

  for (const [batchNum, classifications] of Object.entries(batchesToRun).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`\nBatch ${batchNum}: ${classifications.join(', ')}`);
    await runBatch(classifications);
  }

  console.log('\nAll batches complete. Results saved to data/enrichment_results/');
  console.log('Run Stage 4 review in the PIM app: AI Review Queue page');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Write `app/api/ai-enrichment/route.ts`**

```typescript
// app/api/ai-enrichment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

const VALID_BATCHES = new Set(['1','2','3','4','5','6','7','8','9']);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-ai-enrichment.ts'];

  // Optional: specific batch number
  if (typeof body.batch === 'string' && VALID_BATCHES.has(body.batch)) {
    args.push(`--batch=${body.batch}`);
  }

  // Optional: limit for testing
  const limit = Number(body.limit);
  if (Number.isInteger(limit) && limit > 0 && limit <= 500) {
    args.push(`--limit=${limit}`);
  }

  if (body.dry_run === true) {
    args.push('--dry-run');
  }

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));
  child.on('error', (err) => lines.push(`[spawn error] ${err.message}`));

  const code = await new Promise<number>(res => child.on('close', res));
  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
```

- [ ] **Step 3: Install Anthropic SDK if not present**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && grep '"@anthropic-ai/sdk"' package.json || npm install @anthropic-ai/sdk
```

Expected: either confirms package already present or installs it.

- [ ] **Step 4: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

- [ ] **Step 5: Dry-run smoke test (5 products)**

```bash
npx tsx scripts/run-ai-enrichment.ts --dry-run --batch=1 --limit=5
```

Expected:
```
run-ai-enrichment [DRY RUN]

Batch 1: Red Wine
  [DRY RUN] Would process: WRW0123AA — Château...
  ...
  [Red Wine] Complete — processed: 5 | errors: 0 | rate_limited: 0
```

- [ ] **Step 6: Commit**

```bash
git add scripts/run-ai-enrichment.ts app/api/ai-enrichment/route.ts
git commit -m "feat: add AI enrichment script and API route (Stage 3)"
```

---

## Task 6: Publish API Route

**Files:**
- Create: `app/api/ai-enrichment/publish/route.ts`

- [ ] **Step 1: Write `app/api/ai-enrichment/publish/route.ts`**

```typescript
// app/api/ai-enrichment/publish/route.ts
// Stage 5: write approved enrichment results to Supabase primary + sync variants.
//
// POST body: { productIds: string[] }  — list of product IDs to publish
// Reads from data/enrichment_results/{id}.json for each product.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const RESULTS_DIR = path.join(process.cwd(), 'data', 'enrichment_results');

// Shared fields that are synced from primary → all variants
const SHARED_FIELDS = [
  'desc_en_short', 'desc_en_full', 'desc_source', 'desc_processed_at',
  'style', 'style_detail', 'vintage', 'brand', 'classification',
  'wine_classification', 'country', 'region', 'subregion', 'appellation',
  'wine_body', 'wine_acidity', 'wine_tannin', 'flavor_tags', 'food_matching',
  'overall_confidence', 'validation_status', 'enrichment_note', 'triage_flags',
] as const;

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000*(i+1))); continue; }
      return res;
    } catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, 1000*(i+1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

async function fetchProduct(id: string): Promise<Record<string, any> | null> {
  const res = await sbFetch(
    `${BASE_URL}/rest/v1/products?id=eq.${id}&select=id,sku,sku_base,overall_confidence`,
    { method: 'GET', headers: { Prefer: 'count=none' } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function fetchVariants(skuBase: string, primaryId: string): Promise<string[]> {
  const res = await sbFetch(
    `${BASE_URL}/rest/v1/products?sku_base=eq.${encodeURIComponent(skuBase)}&id=neq.${primaryId}&select=id`,
    { method: 'GET', headers: { Prefer: 'count=none' } }
  );
  if (!res.ok) return [];
  const rows: any[] = await res.json();
  return rows.map(r => r.id);
}

async function patchProduct(id: string, body: Record<string, any>): Promise<boolean> {
  const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const productIds: string[] = Array.isArray(body.productIds) ? body.productIds : [];

  if (productIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'productIds required' }, { status: 400 });
  }

  const results = {
    published: 0,
    primaryFailed: [] as string[],
    variantSyncFailed: [] as string[],
  };

  for (const productId of productIds) {
    // Load enrichment result from disk
    const resultPath = path.join(RESULTS_DIR, `${productId}.json`);
    if (!fs.existsSync(resultPath)) {
      results.primaryFailed.push(productId);
      continue;
    }

    const enrichment = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    const aiResult: Record<string, any> = enrichment.result ?? {};
    const isManual = enrichment.manual_edited === true;

    // Fetch current product to get overall_confidence for weighted average
    const current = await fetchProduct(productId);
    if (!current) { results.primaryFailed.push(productId); continue; }

    // Compute new overall_confidence
    const prevConf = parseFloat(String(current.overall_confidence ?? 0));
    const descConf = parseFloat(String(aiResult.desc_confidence ?? 0));
    const newConf = prevConf > 0
      ? Math.max(0, Math.min(1, prevConf * 0.4 + descConf * 0.6))
      : descConf;

    const now = new Date().toISOString();
    const primaryPayload: Record<string, any> = {
      ...aiResult,
      desc_source: isManual ? 'manual' : 'ai_processed',
      desc_processed_at: now,
      overall_confidence: newConf,
    };
    // Remove desc_confidence from the DB payload (not a DB column)
    delete primaryPayload.desc_confidence;

    // Write primary
    const primaryOk = await patchProduct(productId, primaryPayload);
    if (!primaryOk) {
      results.primaryFailed.push(productId);
      continue;
    }

    results.published++;

    // Sync shared fields to all variants
    const skuBase = current.sku_base ?? enrichment.sku_base;
    if (!skuBase) continue;

    const variantIds = await fetchVariants(skuBase, productId);
    if (variantIds.length === 0) continue;

    // Build variant payload: shared fields only, from the primary payload
    const variantPayload: Record<string, any> = {};
    for (const f of SHARED_FIELDS) {
      if (f in primaryPayload) variantPayload[f] = primaryPayload[f];
    }

    for (const varId of variantIds) {
      const ok = await patchProduct(varId, variantPayload);
      if (!ok) results.variantSyncFailed.push(varId);
    }

    // Mark result as published
    enrichment.status = 'published';
    enrichment.published_at = now;
    fs.writeFileSync(resultPath, JSON.stringify(enrichment, null, 2));
  }

  return NextResponse.json({
    ok: results.primaryFailed.length === 0,
    published: results.published,
    primaryFailed: results.primaryFailed,
    variantSyncFailed: results.variantSyncFailed,
  });
}
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add app/api/ai-enrichment/publish/route.ts
git commit -m "feat: add publish API route — write approved results + sync variants (Stage 5)"
```

---

## Task 7: AI Review Queue Page

**Files:**
- Create: `components/pages/AIReviewQueuePage.tsx`

- [ ] **Step 1: Write `components/pages/AIReviewQueuePage.tsx`**

```tsx
'use client';
// Stage 4: Review Queue — approve / edit / skip AI enrichment results before publish.
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Edit2, SkipForward, X } from 'lucide-react';
import fs from 'fs';

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichmentRecord = {
  product_id: string;
  sku: string;
  sku_base: string;
  name: string;
  classification: string;
  desc_confidence: number;
  status: 'pending_review' | 'approved' | 'skipped' | 'published';
  manual_edited?: boolean;
  // Loaded from the enrichment result JSON — set by run-ai-enrichment.ts when it reads desc_source from Supabase
  original_desc_source?: string | null;
  result: Record<string, any>;
  original: { short_description_en: string | null; description_en_text: string | null };
  processed_at: string;
};

type FilterState = {
  category: string;
  confidence: 'all' | 'high' | 'medium' | 'low';
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function confBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high';
  if (score >= 0.70) return 'medium';
  return 'low';
}

const CONF_COLORS: Record<string, string> = {
  high:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  low:    'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function ConfBadge({ score }: { score: number }) {
  const band = confBand(score);
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${CONF_COLORS[band]}`}>
      {(score * 100).toFixed(0)}%
    </span>
  );
}

function DescriptionPreview({ html, label }: { html: string | null; label: string }) {
  const [show, setShow] = useState(false);
  if (!html) return <p className="text-slate-500 text-xs italic">—</p>;
  return (
    <div>
      <button onClick={() => setShow(v => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-1">
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {label}
      </button>
      {show && (
        <div
          className="text-xs text-slate-300 prose prose-invert prose-sm max-w-none border border-white/10 rounded p-3 bg-black/20"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

function ProductCard({
  record,
  onApprove,
  onSkip,
  onEdit,
}: {
  record: EnrichmentRecord;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onEdit: (id: string, field: 'desc_en_short' | 'desc_en_full', value: string) => void;
}) {
  const [editingShort, setEditingShort] = useState(false);
  const [editingFull, setEditingFull] = useState(false);
  const [shortVal, setShortVal] = useState(record.result.desc_en_short ?? '');
  const [fullVal, setFullVal] = useState(record.result.desc_en_full ?? '');

  const isManual = record.manual_edited === true;
  const statusColors: Record<string, string> = {
    approved: 'border-emerald-500/40',
    skipped:  'border-slate-600/40 opacity-60',
    pending_review: 'border-white/10',
  };

  return (
    <div className={`bg-white/5 border rounded-xl p-5 mb-4 ${statusColors[record.status] ?? 'border-white/10'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-medium text-white">{record.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{record.sku} · {record.classification}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isManual && <span className="text-xs px-2 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/30">manual</span>}
          <ConfBadge score={record.desc_confidence} />
        </div>
      </div>

      {/* Before / After descriptions */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Before (original)</p>
          <p className="text-xs text-slate-400 line-clamp-3">{record.original.short_description_en ?? <em>—</em>}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">After (AI)</p>
          {editingShort ? (
            <div>
              <textarea
                value={shortVal}
                onChange={e => setShortVal(e.target.value)}
                className="w-full h-20 bg-black/40 border border-white/20 rounded p-2 text-xs text-slate-200 font-mono resize-y"
              />
              <button
                onClick={() => { onEdit(record.product_id, 'desc_en_short', shortVal); setEditingShort(false); }}
                className="text-xs text-emerald-400 hover:text-emerald-300 mr-2"
              >Save</button>
              <button onClick={() => setEditingShort(false)} className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-300">{record.result.desc_en_short}</p>
              <button onClick={() => setEditingShort(true)} className="text-xs text-violet-400 hover:text-violet-300 mt-1 flex items-center gap-1">
                <Edit2 size={10} /> Edit short
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Full description preview / editor */}
      <div className="mb-4">
        <DescriptionPreview html={record.result.desc_en_full} label="Full description preview" />
        <button onClick={() => setEditingFull(v => !v)} className="text-xs text-violet-400 hover:text-violet-300 mt-1 flex items-center gap-1">
          <Edit2 size={10} /> {editingFull ? 'Close editor' : 'Edit HTML'}
        </button>
        {editingFull && (
          <div className="mt-2">
            <textarea
              value={fullVal}
              onChange={e => setFullVal(e.target.value)}
              className="w-full h-48 bg-black/40 border border-white/20 rounded p-2 text-xs text-slate-200 font-mono resize-y"
            />
            <button
              onClick={() => { onEdit(record.product_id, 'desc_en_full', fullVal); setEditingFull(false); }}
              className="text-xs text-emerald-400 hover:text-emerald-300 mr-2"
            >Save</button>
            <button onClick={() => setEditingFull(false)} className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {record.status === 'pending_review' && (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(record.product_id)}
            className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Check size={12} /> Approve
          </button>
          <button
            onClick={() => onSkip(record.product_id)}
            className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/15 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <SkipForward size={12} /> Skip
          </button>
        </div>
      )}
      {record.status === 'approved' && (
        <span className="text-xs text-emerald-400 flex items-center gap-1"><Check size={12} /> Approved</span>
      )}
      {record.status === 'skipped' && (
        <span className="text-xs text-slate-500 flex items-center gap-1"><X size={12} /> Skipped</span>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AIReviewQueuePage() {
  const [records, setRecords] = useState<EnrichmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({ category: 'all', confidence: 'all' });
  const [publishing, setPublishing] = useState(false);
  const [publishOutput, setPublishOutput] = useState('');

  async function loadResults() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-enrichment/results');
      const data = await res.json();
      // Sort by confidence ascending (lowest confidence first)
      const sorted = (data.records ?? []).sort((a: EnrichmentRecord, b: EnrichmentRecord) =>
        a.desc_confidence - b.desc_confidence
      );
      setRecords(sorted);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadResults(); }, []);

  function handleApprove(id: string) {
    setRecords(rs => rs.map(r => r.product_id === id ? { ...r, status: 'approved' } : r));
  }

  function handleSkip(id: string) {
    setRecords(rs => rs.map(r => r.product_id === id ? { ...r, status: 'skipped' } : r));
  }

  function handleEdit(id: string, field: 'desc_en_short' | 'desc_en_full', value: string) {
    setRecords(rs => rs.map(r =>
      r.product_id === id
        ? { ...r, manual_edited: true, result: { ...r.result, [field]: value } }
        : r
    ));
  }

  // A record is "manually protected" if it was edited in this session OR it had
  // desc_source = 'manual' in Supabase before AI processing (pre-existing manual content).
  function isManuallyProtected(r: EnrichmentRecord): boolean {
    return r.manual_edited === true || r.original_desc_source === 'manual';
  }

  function handleApproveHighConfidence() {
    setRecords(rs => rs.map(r =>
      r.status === 'pending_review' && confBand(r.desc_confidence) === 'high' && !isManuallyProtected(r)
        ? { ...r, status: 'approved' }
        : r
    ));
  }

  function handleApproveAll() {
    setRecords(rs => rs.map(r =>
      r.status === 'pending_review' && !isManuallyProtected(r) ? { ...r, status: 'approved' } : r
    ));
  }

  async function handlePublish() {
    const approvedIds = records.filter(r => r.status === 'approved').map(r => r.product_id);
    if (approvedIds.length === 0) { setPublishOutput('No approved records to publish.'); return; }

    setPublishing(true);
    setPublishOutput('Publishing…');
    try {
      const res = await fetch('/api/ai-enrichment/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: approvedIds }),
      });
      const data = await res.json();
      const msg = [
        `Published: ${data.published}`,
        data.primaryFailed.length > 0 ? `Primary failures: ${data.primaryFailed.length}` : '',
        data.variantSyncFailed.length > 0 ? `Variant sync failures: ${data.variantSyncFailed.length}` : '',
      ].filter(Boolean).join(' | ');
      setPublishOutput(msg);
      if (data.ok) {
        setRecords(rs => rs.map(r => approvedIds.includes(r.product_id) ? { ...r, status: 'published' } : r));
      }
    } catch (e) {
      setPublishOutput(String(e));
    } finally {
      setPublishing(false);
    }
  }

  // ── Filtering ──
  const categories = ['all', ...Array.from(new Set(records.map(r => r.classification))).sort()];
  const filtered = records.filter(r => {
    if (filter.category !== 'all' && r.classification !== filter.category) return false;
    if (filter.confidence !== 'all' && confBand(r.desc_confidence) !== filter.confidence) return false;
    return true;
  });

  const pendingCount  = records.filter(r => r.status === 'pending_review').length;
  const approvedCount = records.filter(r => r.status === 'approved').length;
  const skippedCount  = records.filter(r => r.status === 'skipped').length;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white mb-1">AI Review Queue</h1>
        <p className="text-sm text-slate-400">Review AI-generated descriptions and taxonomy before publishing to Supabase.</p>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6">
        {[
          { label: 'Pending', count: pendingCount, color: 'text-amber-300' },
          { label: 'Approved', count: approvedCount, color: 'text-emerald-300' },
          { label: 'Skipped', count: skippedCount, color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center min-w-[100px]">
            <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={handleApproveHighConfidence} className="text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors">
          Approve all high-confidence (≥85%)
        </button>
        <button onClick={handleApproveAll} className="text-xs bg-white/10 hover:bg-white/15 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
          Approve all
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing || approvedCount === 0}
          className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors ml-auto"
        >
          {publishing ? 'Publishing…' : `Publish ${approvedCount} approved`}
        </button>
      </div>

      {publishOutput && (
        <div className="bg-black/20 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 mb-5">
          {publishOutput}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select
          value={filter.category}
          onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300"
        >
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <select
          value={filter.confidence}
          onChange={e => setFilter(f => ({ ...f, confidence: e.target.value as any }))}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300"
        >
          <option value="all">All confidence</option>
          <option value="low">Low (&lt;70%)</option>
          <option value="medium">Medium (70–84%)</option>
          <option value="high">High (≥85%)</option>
        </select>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-16">No results match the current filter.</p>
      ) : (
        filtered.map(r => (
          <ProductCard
            key={r.product_id}
            record={r}
            onApprove={handleApprove}
            onSkip={handleSkip}
            onEdit={handleEdit}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the results listing API route**

Create `app/api/ai-enrichment/results/route.ts` (the review queue page fetches results from here):

```typescript
// app/api/ai-enrichment/results/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  const dir = path.join(process.cwd(), 'data', 'enrichment_results');
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ records: [] });
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const records = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return {
      ...data,
      desc_confidence: data.result?.desc_confidence ?? data.desc_confidence ?? 0,
      // Ensure original_desc_source is always present (may be null for older result files)
      original_desc_source: data.original_desc_source ?? null,
    };
  });
  return NextResponse.json({ records });
}
```

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add components/pages/AIReviewQueuePage.tsx app/api/ai-enrichment/results/route.ts
git commit -m "feat: add AI Review Queue page and results listing route (Stage 4)"
```

---

## Task 8: Update ProcessingReviewPage

**Files:**
- Modify: `components/pages/ProcessingReviewPage.tsx`

Read the full file before editing. The plan adds two new cards after the existing RunPipelineCard:
1. **Triage Scan card** — triggers `POST /api/triage`, displays triage summary table on completion
2. **AI Enrichment card** — category selector (all/batch 1–9), optional limit, triggers `POST /api/ai-enrichment`, navigates to review queue

- [ ] **Step 1: Read the current file fully**

Read `components/pages/ProcessingReviewPage.tsx` to see the full current content before editing.

- [ ] **Step 2: Add TriageScanCard component after RunPipelineCard**

Add this component before `export function ProcessingReviewPage()`:

```tsx
// Triage Scan Card
function TriageScanCard() {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [output, setOutput] = useState('');
  const [summary, setSummary] = useState<Record<string, any> | null>(null);

  const FLAGS = ['desc_missing','desc_short_only','desc_brand_voice','desc_html','desc_ok','taxonomy_incomplete'];

  async function handleRun() {
    setRunStatus('running');
    setOutput('');
    try {
      const res = await fetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      setOutput(data.output ?? '');
      // Load summary
      const s = await fetch('/api/triage').then(r => r.json());
      if (s.ok) setSummary(s.summary);
    } catch (err) {
      setOutput(String(err));
    } finally {
      setRunStatus('done');
    }
  }

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-4">Stage 2 — Triage Scan</h2>
      <p className="text-xs text-slate-500 mb-4">Scans all primary variants, writes quality flags (desc_missing, brand_voice, taxonomy_incomplete, etc.). No AI credits used.</p>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={runStatus === 'running'}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={runStatus === 'running' ? 'animate-spin' : ''} />
          {runStatus === 'running' ? 'Scanning…' : 'Run Triage Scan'}
        </button>
        <span className={`text-xs font-medium ${runStatus === 'running' ? 'text-violet-300' : runStatus === 'done' ? 'text-emerald-300' : 'text-slate-500'}`}>
          {runStatus === 'idle' ? 'Idle' : runStatus === 'running' ? 'Running…' : 'Done'}
        </span>
      </div>
      {output && (
        <textarea readOnly value={output} className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 resize-y mb-4" />
      )}
      {summary && (
        <div className="overflow-x-auto">
          <table className="text-xs text-slate-300 w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-1.5 pr-4 text-slate-400 font-normal">Category</th>
                {FLAGS.map(f => <th key={f} className="text-right py-1.5 px-2 text-slate-400 font-normal whitespace-nowrap">{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.summary ?? {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([cls, counts]: [string, any]) => (
                <tr key={cls} className="border-b border-white/5">
                  <td className="py-1.5 pr-4 text-slate-300 whitespace-nowrap">{cls}</td>
                  {FLAGS.map(f => <td key={f} className="text-right py-1.5 px-2 text-slate-400">{counts[f] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">Last scan: {summary.generated_at ? new Date(summary.generated_at).toLocaleString() : '—'}</p>
        </div>
      )}
    </div>
  );
}

// AI Enrichment Card
function AIEnrichmentCard({ onNavigateToReview }: { onNavigateToReview: () => void }) {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [output, setOutput]   = useState('');
  const [batch, setBatch]     = useState('0');     // 0 = all batches
  const [limit, setLimit]     = useState('');

  const BATCH_OPTIONS = [
    { value: '0', label: 'All batches' },
    { value: '1', label: 'Batch 1 — Red Wine' },
    { value: '2', label: 'Batch 2 — White Wine' },
    { value: '3', label: 'Batch 3 — Rosé / Dessert Wine' },
    { value: '4', label: 'Batch 4 — Sparkling Wine' },
    { value: '5', label: 'Batch 5 — Whisky' },
    { value: '6', label: 'Batch 6 — Other Spirits' },
    { value: '7', label: 'Batch 7 — Beer' },
    { value: '8', label: 'Batch 8 — Sake' },
    { value: '9', label: 'Batch 9 — Accessories / Other' },
  ];

  async function handleRun() {
    setRunStatus('running');
    setOutput('');
    const body: Record<string, any> = {};
    if (batch !== '0') body.batch = batch;
    const l = parseInt(limit);
    if (!isNaN(l) && l > 0) body.limit = l;

    try {
      const res = await fetch('/api/ai-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setOutput(data.output ?? '');
    } catch (err) {
      setOutput(String(err));
    } finally {
      setRunStatus('done');
    }
  }

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-1">Stage 3 — AI Enrichment</h2>
      <p className="text-xs text-slate-500 mb-4">Calls Claude for each primary variant — rewrites descriptions and fills taxonomy gaps. Results saved locally for review before publishing.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={batch} onChange={e => setBatch(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300">
          {BATCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="number"
          placeholder="Limit (test only)"
          value={limit}
          onChange={e => setLimit(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-36"
        />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={runStatus === 'running'}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Sparkles size={14} />
          {runStatus === 'running' ? 'Running…' : 'Start AI Enrichment'}
        </button>
        {runStatus === 'done' && (
          <button onClick={onNavigateToReview}
            className="text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors">
            Review & Publish →
          </button>
        )}
      </div>

      {output && (
        <textarea readOnly value={output} className="w-full h-48 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 resize-y" />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `onNavigateToReview` prop to `ProcessingReviewPage` and render new cards**

In `export function ProcessingReviewPage()`:
1. Add `onNavigateToReview?: () => void` prop
2. Render `<TriageScanCard />` after `<RunPipelineCard />`
3. Render `<AIEnrichmentCard onNavigateToReview={onNavigateToReview ?? (() => {})} />` after TriageScanCard

- [ ] **Step 4: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add components/pages/ProcessingReviewPage.tsx
git commit -m "feat: add triage scan card and AI enrichment card to ProcessingReviewPage"
```

---

## Task 9: Dashboard Nav Entry + ProductsPage SKU Base Grouping

**Files:**
- Modify: `components/dashboard.tsx`
- Modify: `components/pages/ProductsPage.tsx`

- [ ] **Step 1: Add AI Review Queue to dashboard nav**

In `components/dashboard.tsx`:

1. Add `'ai_review_queue'` to the `Section` type union
2. Add lazy import: `const AIReviewQueuePage = React.lazy(() => import('@/components/pages/AIReviewQueuePage').then(m => ({ default: m.AIReviewQueuePage })));`
3. Add to `NAV_ITEMS` after `processing`:
   ```tsx
   { id: 'ai_review_queue', label: 'AI Review Queue', Icon: Sparkles },
   ```
   (import `Sparkles` from lucide-react)
4. Add case in the page renderer section to mount `AIReviewQueuePage` when `active === 'ai_review_queue'`
5. Pass `onNavigateToReview={() => setActive('ai_review_queue')}` prop to ProcessingReviewPage

- [ ] **Step 2: Read ProductsPage.tsx fully to understand current card rendering**

Read `components/pages/ProductsPage.tsx` — understand how cards are rendered and where API calls happen, before making any changes.

- [ ] **Step 3: Add sku_base grouping to ProductsPage**

In `ProductsPage.tsx`:

a. In the `Facets` type, add `skuBases: Facet[]` (optional — for future use)

b. After products are loaded, group by `sku_base`:
```tsx
// Group products by sku_base — show one card per base product
const grouped = useMemo(() => {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const base = p.sku_base ?? p.sku?.substring(0, 7) ?? p.sku;
    if (!map.has(base)) map.set(base, []);
    map.get(base)!.push(p);
  }
  // Sort variants: primary first
  for (const variants of map.values()) {
    variants.sort((a, b) => {
      if (a.is_primary_variant) return -1;
      if (b.is_primary_variant) return 1;
      return (a.sku ?? '').localeCompare(b.sku ?? '');
    });
  }
  return Array.from(map.values());
}, [products]);
```

c. When rendering product cards, use the primary variant for display, show a "N suppliers" badge if there are multiple variants, and add an expand toggle to show per-variant price/supplier rows.

d. Use `style` field for display where `grape_variety` was previously used (search for `grape_variety` references in the file).

- [ ] **Step 4: Compile-check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add components/dashboard.tsx components/pages/ProductsPage.tsx
git commit -m "feat: add AI Review Queue nav, group products by sku_base with variant badge"
```

---

## End-to-End Verification

After all tasks are complete:

- [ ] **Run triage dry-run on 100 products**

```bash
npx tsx scripts/run-triage.ts --dry-run --limit=100
```

Expected: table printed, no Supabase writes, no crashes.

- [ ] **Run AI enrichment dry-run on 3 Red Wine products**

```bash
npx tsx scripts/run-ai-enrichment.ts --dry-run --batch=1 --limit=3
```

Expected: `[DRY RUN] Would process: WRW... — ...` × 3, no API calls made, no crashes.

- [ ] **Run style migration dry-run**

```bash
npx tsx scripts/migrate-style-fields.ts --dry-run --limit=30
```

Expected: first 5 patches printed, percentages split correctly, no writes.

- [ ] **Verify app builds**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds (or only pre-existing warnings).

- [ ] **Final commit**

```bash
git add .
git commit -m "feat: complete description/taxonomy enrichment pipeline — all 9 tasks"
```
