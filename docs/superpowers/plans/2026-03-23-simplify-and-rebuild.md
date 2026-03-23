# WineNow PIM — Simplify & Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicates, fix broken code, then build Taxonomy Queue, Product Browser with changelog, and Override Import on a clean foundation.

**Architecture:** JSON file DB (`data/db/`) is the working store — all new features add new JSON files and TypeScript interfaces to the existing pattern. Dashboard splits into a routing shell + 6 focused page components. New API routes follow the existing Next.js App Router pattern in `app/api/`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Lucide React, `data/db/*.json` for persistence.

> **Note on testing:** No test framework is configured in this project. Verification steps use `npm run typecheck` (TypeScript) and manual browser checks. Each task ends with a typecheck + commit.

---

## File Map

### Deleted
- `lib/batch-pipeline.ts` — superseded by batch-processor.ts
- `preview/` — static duplicate

### Fixed
- `lib/supabase/client.ts` — remove dead return block (lines 130–146)
- `README.md` — remove merge conflict markers

### Taxonomy consolidation
| Old | New |
|---|---|
| `lib/taxonomy-loader.ts` | → `lib/taxonomy/maps.ts` |
| `lib/taxonomy-service.ts` | → `lib/taxonomy/service.ts` |
| `lib/taxonomy.ts` | merged into `lib/taxonomy/maps.ts` |
| `lib/taxonomy-mappings.ts` | merged into `lib/taxonomy/maps.ts` |

### New data files
- `data/db/product-changelog.json` — created on first write
- `data/db/override-batches.json` — created on first write
- `data/db/brand-list.json` — created on first write

### Modified lib files
- `lib/db/client.ts` — add changelog, override-batch, brand-list CRUD + queue priority computation
- `lib/batch-processor.ts` — update taxonomy imports + add changelog writes on processing

### New API routes
- `app/api/taxonomy-queue/route.ts`
- `app/api/taxonomy-queue/validate/route.ts`
- `app/api/taxonomy-options/route.ts`
- `app/api/products/route.ts`
- `app/api/products/[id]/route.ts`
- `app/api/override-import/preview/route.ts`
- `app/api/override-import/confirm/route.ts`
- `app/api/settings/brands/route.ts`
- `app/api/settings/brands/[id]/route.ts`
- `app/api/settings/sync/route.ts`

### New page components
- `components/pages/ImportPage.tsx`
- `components/pages/ProcessingReviewPage.tsx`
- `components/pages/TaxonomyQueuePage.tsx`
- `components/pages/ProductsPage.tsx`
- `components/pages/OverrideImportPage.tsx`
- `components/pages/SettingsPage.tsx`

### Modified component
- `components/dashboard.tsx` — shrunk to sidebar shell + routing only

---

## Task 1: Delete dead code and fix broken files

**Files:**
- Delete: `lib/batch-pipeline.ts`
- Delete: `preview/` (entire folder)
- Fix: `lib/supabase/client.ts`
- Fix: `README.md`

- [ ] **Step 1: Verify batch-pipeline.ts has no callers**

```bash
grep -r "batch-pipeline" "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" --include="*.ts" --include="*.tsx" -l
```
Expected: only `lib/batch-pipeline.ts` itself (or nothing). If other files appear, update their imports to use `lib/batch-processor.ts` equivalents first.

- [ ] **Step 2: Delete batch-pipeline.ts**

```bash
rm "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/batch-pipeline.ts"
```

- [ ] **Step 3: Verify preview/ has no references**

```bash
grep -r "preview" "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/package.json"
```
Expected: no output (preview not referenced in scripts). Then delete:

```bash
rm -rf "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/preview"
```

- [ ] **Step 4: Fix supabase/client.ts — remove broken import + delete dead return block**

Open `lib/supabase/client.ts` and make two changes:

**Change A — remove the batch-pipeline import (line 3) and define the type inline.**

Delete:
```typescript
import { type BatchProcessingResult } from '@/lib/batch-pipeline';
```

Add in its place (the type was only used internally — moving it inline keeps the file self-contained):
```typescript
type BatchProcessingResult = {
  rows: Array<{
    original: Record<string, any>;
    normalized: Record<string, any>;
    corrections: Record<string, any>[];
    issues: Array<{ severity: 'error' | 'warning'; [key: string]: any }>;
    confidence: number;
  }>;
  summary: { totalRows: number; autoCorrected: number; blocked: number; readyToImport?: number };
};
```

**Change B — delete lines 130–146** (the duplicate `return { importRunId, stagedRows, blockedRows, savedProducts }` block and the orphaned `});` lines above it). The file should end cleanly after the first `return` statement inside `persistImportToSupabase`.

- [ ] **Step 5: Fix README.md — remove merge conflict markers**

Open `README.md`. Delete all lines containing `<<<<<<< ours`, `=======`, and `>>>>>>> theirs`. Keep the content from the "ours" sections (the working content already in the file). The result should be clean Markdown with no conflict markers.

- [ ] **Step 6: Typecheck**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add -A && git commit -m "cleanup: delete batch-pipeline, preview folder; fix supabase client dead code and README conflicts"
```

---

## Task 2: Consolidate taxonomy files

**Files:**
- Create: `lib/taxonomy/maps.ts`
- Create: `lib/taxonomy/service.ts`
- Delete: `lib/taxonomy.ts`, `lib/taxonomy-mappings.ts`, `lib/taxonomy-service.ts`, `lib/taxonomy-loader.ts`
- Update imports in: `lib/batch-processor.ts`, `app/api/batch-process-db/route.ts`, `components/dashboard.tsx`

- [ ] **Step 1: Create lib/taxonomy/ directory and maps.ts**

`lib/taxonomy/maps.ts` is the merge of `lib/taxonomy-loader.ts` (the Map-based build functions and suggest functions) plus the lookup maps and CSV utilities from `lib/taxonomy-mappings.ts`, plus the hardcoded alias tables from `lib/taxonomy.ts`.

```typescript
// lib/taxonomy/maps.ts
// All taxonomy data lookups, alias maps, and CSV parsing utilities.
// Built once at module load from data/taxonomy/*.json files.

export { buildTaxonomyMaps, type TaxonomyMap, type FieldSuggestion,
  suggestCountry, suggestRegion, suggestIngredient, suggestSubregion,
  suggestOrigin, suggestFlavors, taxonomyMaps } from '@/lib/taxonomy-loader';

export { countryIsoMap, regionCountryMap, grapeAliasMap, taxonomyMappings,
  requiredUploadFields, uploadFieldGuide, parseCsvText,
  mapMagentoCsvToImportRows, type CountryRecord, type RegionRecord,
  type IngredientRecord, type UploadedImportDataset } from '@/lib/taxonomy-mappings';

// Re-export hardcoded aliases from taxonomy.ts for backwards compatibility
export { knownGrapeAliases, knownRegionAliases, knownStyleAliases,
  knownRegionCountryMap, taxonomyCountries, taxonomyAuditIssues } from '@/lib/taxonomy';
```

> This barrel file approach means existing code referencing the old paths still works after the import update step. The actual implementations stay in the old files until Step 4 when they are inlined and the old files deleted. **Do not do Step 4 until all imports are updated.**

- [ ] **Step 2: Create lib/taxonomy/service.ts**

`lib/taxonomy/service.ts` re-exports everything from `lib/taxonomy-service.ts`:

```typescript
// lib/taxonomy/service.ts
// Taxonomy entity types, parsed data arrays, hierarchy queries, and alias resolution.

export {
  type TaxCountry, type TaxRegion, type TaxSubregion, type TaxOrigin,
  type TaxClassification, type TaxIngredient, type TaxFlavour, type TaxCategory,
  type GeographyTree,
  countries, regions, subregions, origins, classifications, ingredients,
  flavours, categoryConfigs,
  getRegionsByCountry, getSubregionsByRegion, getOriginsBySubregion,
  getCountryForRegion, getIngredientsByScope, getIngredientGroups,
  getClassificationsByScope, getClassificationGroups, getFlavoursByFamily,
  getFlavourFamilies, resolveIngredientAlias, resolveCountry, resolveRegion,
  buildGeographyTree,
  countryByName, countryByIso, regionByName, regionById, subregionById,
  countryById, ingredientByAlias, regionCountryLookup,
} from '@/lib/taxonomy-service';
```

- [ ] **Step 3: Update all imports to use the new paths**

Find every file that imports from the old taxonomy paths:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && grep -r "from '@/lib/taxonomy'" --include="*.ts" --include="*.tsx" -l
grep -r "from '@/lib/taxonomy-" --include="*.ts" --include="*.tsx" -l .
```

For each file found, update imports:
- `from '@/lib/taxonomy-loader'` → `from '@/lib/taxonomy/maps'`
- `from '@/lib/taxonomy-mappings'` → `from '@/lib/taxonomy/maps'`
- `from '@/lib/taxonomy-service'` → `from '@/lib/taxonomy/service'`
- `from '@/lib/taxonomy'` → `from '@/lib/taxonomy/maps'`

Key files to check: `lib/batch-processor.ts`, `app/api/batch-process-db/route.ts`, `components/dashboard.tsx`, `lib/auto-mapping.ts`, `lib/render-validation.ts`, `lib/export.ts`.

- [ ] **Step 4: Typecheck with barrel files in place**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run typecheck
```
Expected: no errors. Fix any import mismatches before proceeding.

- [ ] **Step 5: Inline the implementations into maps.ts and service.ts, delete old files**

Now replace the barrel `export ... from` approach with the actual implementation code:
- Copy the full content of `lib/taxonomy-loader.ts` + the relevant parts of `lib/taxonomy-mappings.ts` + `lib/taxonomy.ts` hardcoded aliases → into `lib/taxonomy/maps.ts` as one file
- Copy the full content of `lib/taxonomy-service.ts` → into `lib/taxonomy/service.ts`

Then delete the old files:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && rm lib/taxonomy.ts lib/taxonomy-mappings.ts lib/taxonomy-service.ts lib/taxonomy-loader.ts
```

- [ ] **Step 6: Final typecheck**

```bash
npm run typecheck
```
Expected: no errors. If errors appear, the import paths in step 3 missed something — grep for remaining references and fix them.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: consolidate 4 taxonomy files into lib/taxonomy/maps.ts + lib/taxonomy/service.ts"
```

---

## Task 3: Extend the data layer

**Files:**
- Modify: `lib/db/client.ts` — add new types and CRUD functions

The DB is JSON-file based. New "tables" = new JSON files in `data/db/`. Add these exports to `lib/db/client.ts`:

- [ ] **Step 1: Add types and helper at the top of lib/db/client.ts**

Add after the existing imports:

```typescript
// ── New types ──────────────────────────────────────────────────────────────────

export interface ProductChangelog {
  id: string;
  product_id: string;
  sku: string;
  changed_at: string;       // ISO 8601
  source: 'batch_process' | 'taxonomy_queue' | 'manual_edit' | 'override_import';
  field: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

export interface OverrideBatch {
  id: string;
  created_at: string;
  source_file: string;
  note: string;
  rows_updated: number;
  rows_skipped: number;
}

export interface BrandListEntry {
  id: string;
  name: string;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
```

- [ ] **Step 2: Add changelog file path and CRUD functions**

Append to `lib/db/client.ts`:

```typescript
// ── Changelog ─────────────────────────────────────────────────────────────────

const changelogFile = path.join(dbDir, 'product-changelog.json');

async function readChangelog(): Promise<ProductChangelog[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(changelogFile)) {
      return JSON.parse(await readFile(changelogFile, 'utf-8'));
    }
  } catch { /* empty file or parse error */ }
  return [];
}

async function saveChangelog(entries: ProductChangelog[]) {
  await ensureDbDir();
  await writeFile(changelogFile, JSON.stringify(entries, null, 2), 'utf-8');
}

export async function addChangelogEntries(entries: Omit<ProductChangelog, 'id' | 'changed_at'>[]) {
  const existing = await readChangelog();
  const now = new Date().toISOString();
  const newEntries: ProductChangelog[] = entries.map(e => ({
    ...e,
    id: randomId(),
    changed_at: now,
  }));
  await saveChangelog([...existing, ...newEntries]);
  return newEntries;
}

export async function getChangelogForProduct(productId: string): Promise<ProductChangelog[]> {
  const all = await readChangelog();
  return all.filter(e => e.product_id === productId).sort(
    (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
  );
}

// ── Override batches ───────────────────────────────────────────────────────────

const overrideBatchesFile = path.join(dbDir, 'override-batches.json');

async function readOverrideBatches(): Promise<OverrideBatch[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(overrideBatchesFile)) {
      return JSON.parse(await readFile(overrideBatchesFile, 'utf-8'));
    }
  } catch { /* empty */ }
  return [];
}

export async function saveOverrideBatch(batch: Omit<OverrideBatch, 'id' | 'created_at'>) {
  const batches = await readOverrideBatches();
  const entry: OverrideBatch = { ...batch, id: randomId(), created_at: new Date().toISOString() };
  batches.unshift(entry);
  await writeFile(overrideBatchesFile, JSON.stringify(batches, null, 2), 'utf-8');
  return entry;
}

export async function getOverrideBatches(): Promise<OverrideBatch[]> {
  return readOverrideBatches();
}

// ── Brand list ─────────────────────────────────────────────────────────────────

const brandListFile = path.join(dbDir, 'brand-list.json');

async function readBrandList(): Promise<BrandListEntry[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(brandListFile)) {
      return JSON.parse(await readFile(brandListFile, 'utf-8'));
    }
  } catch { /* empty */ }
  return [];
}

export async function getBrands(): Promise<BrandListEntry[]> {
  return readBrandList();
}

export async function addBrand(name: string): Promise<BrandListEntry> {
  const brands = await readBrandList();
  if (brands.some(b => b.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Brand "${name}" already exists.`);
  }
  const entry: BrandListEntry = { id: randomId(), name: name.trim() };
  brands.push(entry);
  await writeFile(brandListFile, JSON.stringify(brands, null, 2), 'utf-8');
  // Brand list changed — recompute all queue priorities so new brand is reflected
  await computeAndSaveQueuePriorities(true);
  return entry;
}

export async function deleteBrand(id: string): Promise<void> {
  const brands = await readBrandList();
  const filtered = brands.filter(b => b.id !== id);
  await writeFile(brandListFile, JSON.stringify(filtered, null, 2), 'utf-8');
  // Brand list changed — recompute all queue priorities
  await computeAndSaveQueuePriorities(true);
}

// ── Queue priority ─────────────────────────────────────────────────────────────

function computePriority(product: CleanedProduct, brandNames: string[]): number {
  let score = 0;
  // Confidence: 0–40 (confidence is 0–5 scale)
  const conf = parseFloat(String(product.overall_confidence ?? product.taxonomy_confidence ?? 0));
  score += Math.min(40, Math.round(conf * 8));
  // Has notes or is in stock: 20
  if ((product.notes && String(product.notes).trim()) || product.is_in_stock) score += 20;
  // Reputable brand: 20
  const nameLower = String(product.name ?? '').toLowerCase();
  if (brandNames.some(b => nameLower.includes(b.toLowerCase()))) score += 20;
  // Premium price: 0–10
  const price = parseFloat(String(product.price ?? 0));
  if (price >= 3000) score += 10;
  else if (price >= 1000) score += 5;
  return Math.min(100, score);
}

export async function computeAndSaveQueuePriorities(forceAll = false): Promise<void> {
  const products = await readProducts();
  const brands = await readBrandList();
  const brandNames = brands.map(b => b.name);
  // Recompute rows that haven't been scored yet (queue_priority null or 0).
  // Pass forceAll=true to recompute every row — used when the brand list changes.
  let changed = false;
  for (const p of products) {
    if (forceAll || p.queue_priority == null || p.queue_priority === 0) {
      p.queue_priority = computePriority(p, brandNames);
      changed = true;
    }
  }
  if (changed) await saveProducts(products);
}

export async function getQueueProducts(filters: {
  validation_status?: string;
  page?: number;
  page_size?: number;
}) {
  await computeAndSaveQueuePriorities();
  let products = await readProducts();

  if (filters.validation_status) {
    products = products.filter(p => (p.validation_status ?? 'unvalidated') === filters.validation_status);
  } else {
    // Default: show unvalidated only
    products = products.filter(p => !p.validation_status || p.validation_status === 'unvalidated');
  }

  products.sort((a, b) => (b.queue_priority ?? 0) - (a.queue_priority ?? 0));

  const page = filters.page ?? 1;
  const pageSize = filters.page_size ?? 50;
  const total = products.length;
  const items = products.slice((page - 1) * pageSize, page * pageSize);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function validateProducts(ids: string[], note?: string): Promise<{ updated: number }> {
  const products = await readProducts();
  const changelog: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];
  let updated = 0;

  for (const product of products) {
    if (!ids.includes(product.id!)) continue;
    if ((product.validation_status ?? 'unvalidated') === 'validated') continue;
    const old = product.validation_status ?? 'unvalidated';
    product.validation_status = 'validated';
    changelog.push({
      product_id: product.id!,
      sku: product.sku ?? '',
      source: 'taxonomy_queue',
      field: 'validation_status',
      old_value: old,
      new_value: 'validated',
      note: note ?? null,
    });
    updated++;
  }

  if (updated > 0) {
    await saveProducts(products);
    await addChangelogEntries(changelog);
  }
  return { updated };
}

export async function batchValidateTopN(n: number): Promise<{ updated: number }> {
  const products = await readProducts();
  const brands = await readBrandList();
  const brandNames = brands.map(b => b.name);

  const eligible = products
    .filter(p => {
      const conf = parseFloat(String(p.overall_confidence ?? p.taxonomy_confidence ?? 0));
      return conf >= 4.0 && (!p.validation_status || p.validation_status === 'unvalidated');
    })
    .sort((a, b) => (b.queue_priority ?? 0) - (a.queue_priority ?? 0))
    .slice(0, n);

  const ids = eligible.map(p => p.id!).filter(Boolean);
  return validateProducts(ids);
}

export async function updateProductFields(
  productId: string,
  fields: Record<string, string>,
  note?: string
): Promise<{ updated: boolean }> {
  const products = await readProducts();
  const idx = products.findIndex(p => p.id === productId);
  if (idx < 0) return { updated: false };

  const product = products[idx];
  const changelog: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];

  for (const [field, newValue] of Object.entries(fields)) {
    const oldValue = product[field] != null ? String(product[field]) : null;
    if (oldValue !== newValue) {
      product[field] = newValue;
      changelog.push({
        product_id: productId,
        sku: product.sku ?? '',
        source: 'manual_edit',
        field,
        old_value: oldValue,
        new_value: newValue,
        note: note ?? null,
      });
    }
  }

  products[idx] = { ...product, updated_at: new Date().toISOString() };
  await saveProducts(products);
  if (changelog.length > 0) await addChangelogEntries(changelog);
  return { updated: true };
}

export async function getProductWithChangelog(productId: string) {
  const products = await readProducts();
  const product = products.find(p => p.id === productId);
  if (!product) return null;
  const changelog = await getChangelogForProduct(productId);
  return { product, changelog };
}

export async function getPaginatedProducts(filters: {
  search?: string;
  category?: string;
  country?: string;
  validation_status?: string;
  page?: number;
}) {
  let products = await readProducts();

  if (filters.search) {
    const q = filters.search.toLowerCase();
    products = products.filter(p =>
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.name ?? '').toLowerCase().includes(q)
    );
  }
  if (filters.country) products = products.filter(p => p.country === filters.country);
  if (filters.category) products = products.filter(p =>
    (p.mainCategory ?? '').toLowerCase() === filters.category.toLowerCase()
  );
  if (filters.validation_status) products = products.filter(p =>
    (p.validation_status ?? 'unvalidated') === filters.validation_status
  );

  const page = filters.page ?? 1;
  const pageSize = 50;
  const total = products.length;
  const items = products.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/client.ts && git commit -m "feat(db): add changelog, override-batch, brand-list, queue-priority functions"
```

---

## Task 3.5: Update batch-processor.ts to write changelog

**Files:**
- Modify: `lib/batch-processor.ts`

Do this now — before any page tasks — so that if Task 15 smoke-tests import + changelog, the data is there.

- [ ] **Step 1: Add changelog import to lib/batch-processor.ts**

At the top of `lib/batch-processor.ts`, add:
```typescript
import { addChangelogEntries } from '@/lib/db/client';
```

- [ ] **Step 2: Write changelog entries for each processed row**

Inside `processBatch` (or wherever individual rows are finalized and saved), after saving each row, add:

```typescript
const CHANGELOG_FIELDS = ['country', 'region', 'classification', 'grape_variety',
  'subregion', 'origin', 'wine_type', 'liquor_main_type'];

const entries = CHANGELOG_FIELDS
  .filter(f => row[f])
  .map(f => ({
    product_id: String(row.id ?? ''),
    sku: row.sku ?? '',
    source: 'batch_process' as const,
    field: f,
    old_value: null,
    new_value: String(row[f]),
    note: null,
  }));

if (entries.length > 0) {
  addChangelogEntries(entries).catch(console.error); // fire-and-forget
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run typecheck && git add lib/batch-processor.ts && git commit -m "feat: batch-processor writes changelog entries per processed field"
```

---

## Task 4: New API routes — Taxonomy Queue

**Files:**
- Create: `app/api/taxonomy-queue/route.ts`
- Create: `app/api/taxonomy-queue/validate/route.ts`

- [ ] **Step 1: Create app/api/taxonomy-queue/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getQueueProducts } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await getQueueProducts({
      validation_status: searchParams.get('validation_status') ?? undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/taxonomy-queue/validate/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateProducts, batchValidateTopN } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.batchMode === true) {
      const n = typeof body.n === 'number' ? body.n : 50;
      const result = await batchValidateTopN(n);
      return NextResponse.json(result);
    }

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    const result = await validateProducts(body.ids, body.note);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create app/api/taxonomy-options/route.ts**

This serves dropdown options for the taxonomy side panel. Called once on mount by `TaxonomyQueuePage`. Returns country names, region names with their parent country, classification names, and grape variety names.

```typescript
import { NextResponse } from 'next/server';
import countriesJson from '@/data/taxonomy/countries.json';
import regionsJson from '@/data/taxonomy/regions.json';
import subregionsJson from '@/data/taxonomy/subregions.json';
import classificationJson from '@/data/taxonomy/classification_master.json';
import ingredientJson from '@/data/taxonomy/ingredient_master.json';
import flavorJson from '@/data/taxonomy/flavor_note_master.json';

export const runtime = 'nodejs';

export async function GET() {
  const countriesData = (countriesJson.data ?? []) as Array<{ id: number; name: string }>;
  const regionsData = (regionsJson.data ?? []) as Array<{ country_id: number; name: string }>;
  const subregionsData = (subregionsJson.data ?? []) as Array<{ name: string }>;
  const classificationData = (classificationJson.data ?? []) as Array<{ classification: string }>;
  const ingredientData = (ingredientJson.data ?? []) as Array<{ ingredient: string }>;
  const flavorData = (flavorJson.data ?? []) as Array<{ note: string }>;

  const countryById = Object.fromEntries(countriesData.map(c => [c.id, c.name]));

  return NextResponse.json({
    countries: countriesData.map(c => c.name).filter(Boolean).sort(),
    // regions include their parent country name so the UI can filter by selected country
    regions: regionsData.map(r => ({ name: r.name, country: countryById[r.country_id] ?? '' })),
    subregions: subregionsData.map(s => s.name).filter(Boolean).sort(),
    classifications: classificationData.map(c => c.classification).filter(Boolean).sort(),
    grapeVarieties: ingredientData.map(i => i.ingredient).filter(Boolean).sort(),
    flavorNotes: flavorData.map(f => f.note).filter(Boolean).sort(),
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck && git add app/api/taxonomy-queue/ app/api/taxonomy-options/ && git commit -m "feat(api): taxonomy-queue, validate, and taxonomy-options routes"
```

---

## Task 5: New API routes — Products

**Files:**
- Create: `app/api/products/route.ts`
- Create: `app/api/products/[id]/route.ts`

- [ ] **Step 1: Create app/api/products/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getPaginatedProducts } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await getPaginatedProducts({
      search: searchParams.get('search') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      country: searchParams.get('country') ?? undefined,
      validation_status: searchParams.get('validation_status') ?? undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/products/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getProductWithChangelog, updateProductFields } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await getProductWithChangelog(params.id);
    if (!result) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 });
    }
    const result = await updateProductFields(params.id, body.fields, body.note);
    if (!result.updated) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck && git add app/api/products/ && git commit -m "feat(api): products list and detail/edit routes"
```

---

## Task 6: New API routes — Override Import

**Files:**
- Create: `app/api/override-import/preview/route.ts`
- Create: `app/api/override-import/confirm/route.ts`

- [ ] **Step 1: Create app/api/override-import/preview/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts } from '@/lib/db/client';
import { parseCsvText } from '@/lib/taxonomy/maps';

export const runtime = 'nodejs';

const SKU_HEADERS = new Set(['sku', 'product_sku']);

// Only headers matching these field names are applied; all others are shown as ignored.
const KNOWN_PRODUCT_FIELDS = new Set([
  'name', 'category', 'type', 'grape', 'region', 'style',
  'price', 'cost', 'cost_price', 'currency', 'status', 'oak', 'country',
  'subregion', 'origin', 'classification', 'grape_variety',
  'wine_type', 'liquor_main_type', 'flavor_profile', 'full_description',
]);

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csvText: string = body.csvText;
    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const skuColIndex = normalizedHeaders.findIndex(h => SKU_HEADERS.has(h));

    if (skuColIndex < 0) return NextResponse.json({ error: 'CSV must contain a "sku" column' }, { status: 400 });

    // ignoredColumns: non-sku headers that don't match a known product field
    const ignoredColumns = rawHeaders.filter((_, i) => i !== skuColIndex && !KNOWN_PRODUCT_FIELDS.has(normalizedHeaders[i]));
    const dataHeaders = normalizedHeaders.filter((h, i) => i !== skuColIndex && KNOWN_PRODUCT_FIELDS.has(h));

    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    const matched: Array<{ sku: string; productId: string; changes: Array<{ field: string; oldValue: string; newValue: string }> }> = [];
    const unmatched: string[] = [];

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIndex] ?? '').trim().toUpperCase();
      if (!sku) continue;

      const product = productBySku.get(sku);
      if (!product) { unmatched.push(sku); continue; }

      const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
      dataHeaders.forEach((field, i) => {
        const actualIdx = normalizedHeaders.indexOf(field);
        const newVal = String(row[actualIdx] ?? '').trim();
        if (!newVal) return; // blank cell = no change
        const oldVal = product[field] != null ? String(product[field]) : '';
        if (oldVal !== newVal) changes.push({ field, oldValue: oldVal, newValue: newVal });
      });

      if (changes.length > 0) matched.push({ sku, productId: String(product.id ?? ''), changes });
    }

    return NextResponse.json({ matched, unmatched, ignoredColumns });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Preview failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/override-import/confirm/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts, saveCleanedProduct, addChangelogEntries, saveOverrideBatch } from '@/lib/db/client';
import { parseCsvText } from '@/lib/taxonomy/maps';

export const runtime = 'nodejs';

const SKU_HEADERS = new Set(['sku', 'product_sku']);
const KNOWN_PRODUCT_FIELDS = new Set([
  'name', 'category', 'type', 'grape', 'region', 'style',
  'price', 'cost', 'cost_price', 'currency', 'status', 'oak', 'country',
  'subregion', 'origin', 'classification', 'grape_variety',
  'wine_type', 'liquor_main_type', 'flavor_profile', 'full_description',
]);
function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { csvText, note, batchId } = body;

    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });
    if (!note || !String(note).trim()) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const skuColIndex = normalizedHeaders.findIndex(h => SKU_HEADERS.has(h));
    if (skuColIndex < 0) return NextResponse.json({ error: 'CSV must contain a "sku" column' }, { status: 400 });

    const dataHeaders = normalizedHeaders.filter((h, i) => i !== skuColIndex && KNOWN_PRODUCT_FIELDS.has(h));
    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    let rowsUpdated = 0;
    let rowsSkipped = 0;
    const changelogEntries: any[] = [];

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIndex] ?? '').trim().toUpperCase();
      if (!sku) continue;
      const product = productBySku.get(sku);
      if (!product) { rowsSkipped++; continue; }

      const updates: Record<string, any> = {};
      dataHeaders.forEach(field => {
        const actualIdx = normalizedHeaders.indexOf(field);
        const newVal = String(row[actualIdx] ?? '').trim();
        if (!newVal) return;
        const oldVal = product[field] != null ? String(product[field]) : '';
        if (oldVal !== newVal) {
          updates[field] = newVal;
          changelogEntries.push({
            product_id: String(product.id ?? ''),
            sku: product.sku ?? '',
            source: 'override_import' as const,
            field,
            old_value: oldVal || null,
            new_value: newVal,
            note: String(note).trim(),
          });
        }
      });

      if (Object.keys(updates).length > 0) {
        await saveCleanedProduct({ ...product, ...updates });
        rowsUpdated++;
      }
    }

    if (changelogEntries.length > 0) await addChangelogEntries(changelogEntries);

    await saveOverrideBatch({
      source_file: batchId ?? 'unknown',
      note: String(note).trim(),
      rows_updated: rowsUpdated,
      rows_skipped: rowsSkipped,
    });

    return NextResponse.json({ rowsUpdated, rowsSkipped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Confirm failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck && git add app/api/override-import/ && git commit -m "feat(api): override-import preview and confirm routes"
```

---

## Task 7: New API routes — Settings (brand list)

**Files:**
- Create: `app/api/settings/brands/route.ts`
- Create: `app/api/settings/brands/[id]/route.ts`

- [ ] **Step 1: Create app/api/settings/brands/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBrands, addBrand } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const brands = await getBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const brand = await addBrand(String(name).trim());
    return NextResponse.json({ brand });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/settings/brands/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { deleteBrand } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteBrand(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create app/api/settings/sync/route.ts**

This route reads all validated products from the JSON DB and upserts them to Supabase using the same column mapping as `persistImportToSupabase`. `Prefer: resolution=merge-duplicates` is the Supabase upsert header that keys on the table's unique constraint (sku).

Note: `createSupabaseBrowserClient()` is typed as `SupabaseBrowserClientConfig` (`{ url: string; publishableKey: string; headers: Record<string, string> }`) — accessing `.url` and `.headers` is safe and will typecheck correctly.

```typescript
import { NextResponse } from 'next/server';
import { getCleanedProducts } from '@/lib/db/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const products = await getCleanedProducts({ validation_status: 'validated' });
    if (products.length === 0) return NextResponse.json({ synced: 0 });

    const client = createSupabaseBrowserClient();
    const rows = products.map(p => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      type: p.type,
      grape: p.grape,
      region: p.region,
      style: p.style,
      price: p.price,
      cost_price: p.cost ?? p.costPrice,
      currency: p.currency,
      status: p.status,
      oak: p.oak,
      country: p.country,
    }));

    const response = await fetch(`${client.url}/rest/v1/products`, {
      method: 'POST',
      headers: {
        ...client.headers,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const msg = await response.text();
      throw new Error(msg || `Supabase error ${response.status}`);
    }

    return NextResponse.json({ synced: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck && git add app/api/settings/ && git commit -m "feat(api): brand list CRUD routes + Supabase sync route"
```

---

## Task 8: Dashboard shell extraction

**Files:**
- Modify: `components/dashboard.tsx`
- Create: `components/pages/ImportPage.tsx` (stub)
- Create: `components/pages/ProcessingReviewPage.tsx` (stub)
- Create: `components/pages/TaxonomyQueuePage.tsx` (stub)
- Create: `components/pages/ProductsPage.tsx` (stub)
- Create: `components/pages/OverrideImportPage.tsx` (stub)
- Create: `components/pages/SettingsPage.tsx` (stub)

The strategy: create stub page components first, then gut dashboard.tsx to be a shell that renders them. The old inline sections get deleted as each stub is filled in (Tasks 9–12).

- [ ] **Step 1: Create all 6 stub page components**

Create each file with a minimal placeholder so the dashboard shell can import them immediately:

`components/pages/ImportPage.tsx`:
```tsx
'use client';
export function ImportPage() {
  return <div className="p-8 text-white">Import — coming soon</div>;
}
```

Repeat the same pattern for:
- `components/pages/ProcessingReviewPage.tsx` → `export function ProcessingReviewPage()`
- `components/pages/TaxonomyQueuePage.tsx` → `export function TaxonomyQueuePage()`
- `components/pages/ProductsPage.tsx` → `export function ProductsPage()`
- `components/pages/OverrideImportPage.tsx` → `export function OverrideImportPage()`
- `components/pages/SettingsPage.tsx` → `export function SettingsPage()`

- [ ] **Step 2: Rewrite dashboard.tsx as a routing shell**

Replace the full content of `components/dashboard.tsx` with:

```tsx
'use client';
import { useState } from 'react';
import { Database, LayoutDashboard, Package, RefreshCw, Settings, Upload } from 'lucide-react';
import { ImportPage } from '@/components/pages/ImportPage';
import { ProcessingReviewPage } from '@/components/pages/ProcessingReviewPage';
import { TaxonomyQueuePage } from '@/components/pages/TaxonomyQueuePage';
import { ProductsPage } from '@/components/pages/ProductsPage';
import { OverrideImportPage } from '@/components/pages/OverrideImportPage';
import { SettingsPage } from '@/components/pages/SettingsPage';

type Section = 'import' | 'processing' | 'taxonomy_queue' | 'products' | 'override_import' | 'settings';

const NAV_ITEMS: Array<{ id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'import', label: 'Import', Icon: Upload },
  { id: 'processing', label: 'Processing Review', Icon: RefreshCw },
  { id: 'taxonomy_queue', label: 'Taxonomy Queue', Icon: Database },
  { id: 'products', label: 'Products', Icon: Package },
  { id: 'override_import', label: 'Override Import', Icon: LayoutDashboard },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

function Sidebar({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }) {
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-slate-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="text-xl">🍷</span>
        <span className="text-sm font-semibold text-white">WineNow PIM</span>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2 pt-3">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              active === id
                ? 'bg-violet-500/20 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function Dashboard() {
  const [section, setSection] = useState<Section>('import');

  const pages: Record<Section, React.ReactNode> = {
    import: <ImportPage />,
    processing: <ProcessingReviewPage />,
    taxonomy_queue: <TaxonomyQueuePage />,
    products: <ProductsPage />,
    override_import: <OverrideImportPage />,
    settings: <SettingsPage />,
  };

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar active={section} onNavigate={setSection} />
      <main className="flex-1 overflow-auto">
        {pages[section]}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors. The app should now render with stub pages.

- [ ] **Step 4: Start dev server and verify navigation works**

```bash
npm run dev
```
Open http://localhost:3000. Verify all 6 nav items show their stub text. No console errors.

- [ ] **Step 5: Commit**

```bash
git add components/ && git commit -m "refactor: extract dashboard to routing shell, add stub page components"
```

---

## Task 9: Import Page + Processing Review Page

Extract the existing import and processing review logic from the old dashboard into the two page components.

**Files:**
- Modify: `components/pages/ImportPage.tsx`
- Modify: `components/pages/ProcessingReviewPage.tsx`

> The old `components/dashboard.tsx` had inline CSV upload, batch processing preview, and row review functionality. Reference the git history (`git show HEAD~1:components/dashboard.tsx`) if you need to see the old implementation. The logic to port uses `mapMagentoCsvToImportRows` (from `lib/taxonomy/maps`), `runBatchProcessing` (note: this was in the deleted `batch-pipeline.ts` — use `processBatch` from `lib/batch-processor.ts` instead), and the `persistImportToSupabase` path.

- [ ] **Step 1: Implement ImportPage.tsx**

The Import page handles: drag-and-drop or file input for CSV upload → parse via `mapMagentoCsvToImportRows` → call `/api/batch-process-db` POST with the rows → show result summary.

```tsx
'use client';
import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { mapMagentoCsvToImportRows } from '@/lib/taxonomy/maps';

type ImportState = 'idle' | 'parsing' | 'processing' | 'done' | 'error';

export function ImportPage() {
  const [state, setState] = useState<ImportState>('idle');
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState('parsing');
    setError(null);
    try {
      const text = await file.text();
      const dataset = mapMagentoCsvToImportRows(text, file.name);

      if (dataset.missingRequiredFields.length > 0) {
        setError(`Missing required columns: ${dataset.missingRequiredFields.join(', ')}`);
        setState('error');
        return;
      }

      setState('processing');
      const res = await fetch('/api/batch-process-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: dataset.rows, source_file: file.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Processing failed');
      setResult(json);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-white mb-6">Import Products</h1>

      <div
        className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-violet-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <Upload size={32} className="mx-auto mb-3 text-slate-500" />
        <p className="text-slate-400 text-sm">Drop a CSV file here or click to browse</p>
        <p className="text-slate-600 text-xs mt-1">Supports Magento-style CSV with sku, name, price columns</p>
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {state === 'parsing' && <p className="mt-4 text-slate-400 text-sm">Parsing CSV…</p>}
      {state === 'processing' && <p className="mt-4 text-slate-400 text-sm">Processing rows through batch pipeline…</p>}

      {state === 'error' && (
        <div className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
          <p className="text-rose-300 text-sm">{error}</p>
        </div>
      )}

      {state === 'done' && result && (
        <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 space-y-1">
          <p className="text-emerald-300 text-sm font-medium">Import complete</p>
          <p className="text-slate-400 text-sm">Total rows: {result.stats?.total ?? 0}</p>
          <p className="text-slate-400 text-sm">Saved: {result.saved ?? 0}</p>
          <p className="text-slate-400 text-sm">Blocked: {result.stats?.blocked ?? 0}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement ProcessingReviewPage.tsx**

The Processing Review page shows the latest batch logs and product stats fetched from `/api/batch-process-db?action=stats` and `?action=logs`.

```tsx
'use client';
import { useEffect, useState } from 'react';

export function ProcessingReviewPage() {
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/batch-process-db?action=stats').then(r => r.json()),
      fetch('/api/batch-process-db?action=logs').then(r => r.json()),
    ]).then(([s, l]) => {
      setStats(s);
      setLogs(l.logs ?? []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-white mb-6">Processing Review</h1>

      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total products', value: stats.total },
            { label: 'Validated', value: stats.validated },
            { label: 'Needs review', value: stats.needs_review },
            { label: 'Blocked', value: stats.blocked },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-2xl font-semibold text-white mt-1">{value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-medium text-slate-300 mb-3">Recent batch logs</h2>
      <div className="space-y-2">
        {logs.length === 0 && <p className="text-slate-500 text-sm">No batch logs yet.</p>}
        {logs.map((log: any, i: number) => (
          <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-white">{log.source_file}</p>
              <p className="text-xs text-slate-400 mt-0.5">{log.timestamp}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-300">{log.processed_rows} / {log.total_rows} rows</p>
              <p className="text-xs text-slate-500 mt-0.5">{log.status}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + verify in browser**

```bash
npm run typecheck
```
Open http://localhost:3000 → Import page should show file upload UI. Processing Review should show stats/logs (or empty state).

- [ ] **Step 4: Commit**

```bash
git add components/pages/ImportPage.tsx components/pages/ProcessingReviewPage.tsx && git commit -m "feat: implement ImportPage and ProcessingReviewPage components"
```

---

## Task 10: Taxonomy Queue Page

**Files:**
- Modify: `components/pages/TaxonomyQueuePage.tsx`

- [ ] **Step 1: Implement TaxonomyQueuePage.tsx**

Key points:
- Fetches `/api/taxonomy-options` on mount for dropdown data. Regions are filtered client-side by the selected country value.
- `localFields` is a controlled form initialized from the product when the panel opens.
- `handleValidateOne` PATCHes changed fields first (creates changelog entries), then marks as validated.
- The currently open row shows a blue "In review" badge — UI-only, never written to DB.
- `country`, `region`, `classification`, `grape_variety` are rendered as `<select>` dropdowns. `subregion` and `origin` remain text inputs.
- `wine_type` (wine only) and `liquor_main_type` (non-wine) are mutually exclusive dropdowns.
- `flavor_profile` is a comma-separated text input.

```tsx
'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, X } from 'lucide-react';

type Product = Record<string, any>;
type TaxOptions = {
  countries: string[];
  regions: Array<{ name: string; country: string }>;
  subregions: string[];
  classifications: string[];
  grapeVarieties: string[];
  flavorNotes: string[];
};

const WINE_TYPE_OPTIONS = ['Red Wine', 'White Wine', 'Rosé', 'Sparkling', 'Dessert'];
const LIQUOR_TYPE_OPTIONS = ['Whisky', 'Rum', 'Tequila', 'Gin', 'Vodka', 'Brandy', 'Other'];
const ALL_PANEL_FIELDS = ['country', 'region', 'subregion', 'origin', 'classification', 'grape_variety', 'wine_type', 'liquor_main_type', 'flavor_profile'];

export function TaxonomyQueuePage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [taxOptions, setTaxOptions] = useState<TaxOptions | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('unvalidated');
  const [panelProduct, setPanelProduct] = useState<Product | null>(null);
  const [localFields, setLocalFields] = useState<Record<string, string>>({});
  const [batchN, setBatchN] = useState(50);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Load taxonomy options once on mount
  useEffect(() => {
    fetch('/api/taxonomy-options').then(r => r.json()).then(setTaxOptions);
  }, []);

  async function load(p = page, f = filter) {
    const res = await fetch(`/api/taxonomy-queue?page=${p}&validation_status=${f}`);
    setData(await res.json());
  }

  useEffect(() => { load(); }, [page, filter]);

  function openPanel(p: Product) {
    const fields: Record<string, string> = {};
    ALL_PANEL_FIELDS.forEach(f => { fields[f] = String(p[f] ?? ''); });
    setLocalFields(fields);
    setPanelProduct(p);
  }

  function closePanel() { setPanelProduct(null); setLocalFields({}); }

  async function handleBatchValidate() {
    setWorking(true);
    const res = await fetch('/api/taxonomy-queue/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchMode: true, n: batchN }),
    });
    const json = await res.json();
    setMessage(`Validated ${json.updated} products`);
    setWorking(false);
    load();
  }

  async function handleValidateOne() {
    if (!panelProduct) return;
    setSaving(true);

    // Only send fields that changed
    const changedFields: Record<string, string> = {};
    Object.entries(localFields).forEach(([k, v]) => {
      if (v !== String(panelProduct[k] ?? '')) changedFields[k] = v;
    });

    // PATCH field edits first — creates changelog entries per changed field
    if (Object.keys(changedFields).length > 0) {
      await fetch(`/api/products/${panelProduct.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: changedFields }),
      });
    }

    // Then mark as validated
    await fetch('/api/taxonomy-queue/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [panelProduct.id] }),
    });

    setSaving(false);
    closePanel();
    load();
  }

  const isWine = (p: Product) => String(p.category ?? '').toLowerCase().includes('wine');

  // Regions filtered to selected country
  const filteredRegions = taxOptions?.regions.filter(r => !localFields['country'] || r.country === localFields['country']) ?? [];

  const sel = (field: string, opts: string[]) => (
    <select
      value={localFields[field] ?? ''}
      onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
    >
      <option value="">— select —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const txt = (field: string, placeholder?: string) => (
    <input
      value={localFields[field] ?? ''}
      onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      placeholder={placeholder}
      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
    />
  );

  const statusColors: Record<string, string> = {
    unvalidated: 'bg-amber-500/20 text-amber-200',
    validated: 'bg-emerald-500/20 text-emerald-200',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Taxonomy Queue</h1>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10">
            <option value="unvalidated">Unvalidated</option>
            <option value="validated">Validated</option>
          </select>
          <input type="number" min={1} max={500} value={batchN}
            onChange={e => setBatchN(parseInt(e.target.value) || 50)}
            className="w-20 bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10" />
          <button onClick={handleBatchValidate} disabled={working}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors">
            Batch validate top {batchN}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex justify-between">
          <span className="text-emerald-300 text-sm">{message}</span>
          <button onClick={() => setMessage(null)}><X size={14} className="text-slate-400" /></button>
        </div>
      )}

      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU', 'Name', 'Country', 'Region', 'Confidence', 'Priority', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => {
              const isOpen = panelProduct?.id === p.id;
              return (
                <tr key={p.id} className={`border-b border-white/5 hover:bg-white/5 ${isOpen ? 'bg-blue-500/5' : ''}`}>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.country}</td>
                  <td className="px-4 py-3 text-slate-300">{p.region}</td>
                  <td className="px-4 py-3 text-slate-300">{(p.overall_confidence ?? p.taxonomy_confidence ?? 0).toFixed(1)}</td>
                  <td className="px-4 py-3 text-slate-300">{p.queue_priority ?? 0}</td>
                  <td className="px-4 py-3">
                    {isOpen
                      ? <span className="rounded-full px-2 py-0.5 text-xs bg-blue-500/20 text-blue-200">In review</span>
                      : <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.validation_status ?? 'unvalidated'] ?? ''}`}>{p.validation_status ?? 'unvalidated'}</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openPanel(p)} className="text-violet-400 hover:text-violet-300 text-xs">Validate</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-400">{data.total} products</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-slate-400 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-300">Page {data.page} / {data.totalPages}</span>
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="text-slate-400 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Validation side panel */}
      {panelProduct && (
        <div className="fixed inset-y-0 right-0 w-96 bg-slate-900 border-l border-white/10 p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-white">Validate product</h2>
            <button onClick={closePanel}><X size={16} className="text-slate-400" /></button>
          </div>
          <div className="space-y-1 mb-4">
            <p className="text-xs text-slate-400">SKU</p>
            <p className="text-sm text-white font-mono">{panelProduct.sku}</p>
            <p className="text-xs text-slate-400 mt-2">Name</p>
            <p className="text-sm text-white">{panelProduct.name}</p>
          </div>

          <div className="space-y-3 mb-6">
            {/* country — dropdown from taxonomy-options */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">country</label>
              {sel('country', taxOptions?.countries ?? [])}
            </div>

            {/* region — dropdown filtered by selected country */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">region</label>
              {sel('region', filteredRegions.map(r => r.name))}
            </div>

            {/* subregion — text input with datalist autocomplete from subregions.json */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">subregion</label>
              <input
                list="subregion-options"
                value={localFields['subregion'] ?? ''}
                onChange={e => setLocalFields(prev => ({ ...prev, subregion: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <datalist id="subregion-options">
                {(taxOptions?.subregions ?? []).map(s => <option key={s} value={s} />)}
              </datalist>
            </div>

            {/* origin — free text */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">origin</label>
              {txt('origin')}
            </div>

            {/* classification — dropdown */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">classification</label>
              {sel('classification', taxOptions?.classifications ?? [])}
            </div>

            {/* grape_variety — dropdown */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">grape_variety</label>
              {sel('grape_variety', taxOptions?.grapeVarieties ?? [])}
            </div>

            {/* wine_type — shown only for wine */}
            {isWine(panelProduct) && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">wine_type</label>
                {sel('wine_type', WINE_TYPE_OPTIONS)}
              </div>
            )}

            {/* liquor_main_type — shown only for non-wine */}
            {!isWine(panelProduct) && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">liquor_main_type</label>
                {sel('liquor_main_type', LIQUOR_TYPE_OPTIONS)}
              </div>
            )}

            {/* flavor_profile — multi-select from flavor_note_master.json */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">flavor_profile <span className="text-slate-600">(hold Ctrl/⌘ to select multiple)</span></label>
              <select
                multiple
                value={(localFields['flavor_profile'] ?? '').split(',').map(s => s.trim()).filter(Boolean)}
                onChange={e => {
                  const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                  setLocalFields(prev => ({ ...prev, flavor_profile: selected.join(', ') }));
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-32"
              >
                {(taxOptions?.flavorNotes ?? []).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <button onClick={handleValidateOne} disabled={saving}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg flex items-center justify-center gap-2 transition-colors">
            <CheckCircle size={15} /> {saving ? 'Saving…' : 'Save & mark as validated'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + browser check**

```bash
npm run typecheck
```
Open Taxonomy Queue. Verify the table loads, pagination works, side panel opens and closes, batch validate button triggers the API.

- [ ] **Step 3: Commit**

```bash
git add components/pages/TaxonomyQueuePage.tsx && git commit -m "feat: implement TaxonomyQueuePage with ranking, pagination, side panel, batch validate"
```

---

## Task 11: Products Page

**Files:**
- Modify: `components/pages/ProductsPage.tsx`

- [ ] **Step 1: Implement ProductsPage.tsx**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Edit2, X } from 'lucide-react';

type Product = Record<string, any>;
type ChangelogEntry = Record<string, any>;
type DetailView = 'edit' | 'changelog';

export function ProductsPage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [view, setView] = useState<DetailView>('edit');
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function load(p = page, q = search) {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('search', q);
    const res = await fetch(`/api/products?${params}`);
    const json = await res.json();
    setData(json);
  }

  useEffect(() => { load(); }, [page, search]);

  async function openProduct(product: Product) {
    setSelected(product);
    setView('edit');
    setEditFields(Object.fromEntries(
      Object.entries(product).map(([k, v]) => [k, v != null ? String(v) : ''])
    ));
    setNote('');
    setSaveMsg(null);
    const res = await fetch(`/api/products/${product.id}`);
    const json = await res.json();
    if (json.changelog) setChangelog(json.changelog);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/products/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: editFields, note: note || undefined }),
    });
    const json = await res.json();
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved');
      load();
      // Reload changelog
      const r2 = await fetch(`/api/products/${selected.id}`);
      const j2 = await r2.json();
      if (j2.changelog) setChangelog(j2.changelog);
    } else {
      setSaveMsg(json.error ?? 'Save failed');
    }
  }

  const EDITABLE_FIELDS = ['name', 'sku', 'country', 'region', 'subregion', 'classification',
    'grape_variety', 'price', 'cost', 'currency', 'validation_status'];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Products</h1>
        <input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 w-64"
        />
      </div>

      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU', 'Name', 'Country', 'Region', 'Price', 'Confidence', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => (
              <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => openProduct(p)}>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                <td className="px-4 py-3 text-slate-300">{p.country}</td>
                <td className="px-4 py-3 text-slate-300">{p.region}</td>
                <td className="px-4 py-3 text-slate-300">{p.price}</td>
                <td className="px-4 py-3 text-slate-300">{(p.overall_confidence ?? 0).toFixed(1)}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${p.validation_status === 'validated' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'}`}>
                    {p.validation_status ?? 'unvalidated'}
                  </span>
                </td>
                <td className="px-4 py-3"><Edit2 size={13} className="text-slate-500" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-400">{data.total} products</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-slate-400 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-300">Page {data.page} / {data.totalPages}</span>
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="text-slate-400 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-slate-900 border-l border-white/10 flex flex-col z-50">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex gap-3">
              <button onClick={() => setView('edit')} className={`text-xs px-3 py-1.5 rounded-lg ${view === 'edit' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-white'}`}>
                <Edit2 size={12} className="inline mr-1" />Edit
              </button>
              <button onClick={() => setView('changelog')} className={`text-xs px-3 py-1.5 rounded-lg ${view === 'changelog' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-white'}`}>
                <Clock size={12} className="inline mr-1" />Changelog
              </button>
            </div>
            <button onClick={() => setSelected(null)}><X size={16} className="text-slate-400" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {view === 'edit' && (
              <div className="space-y-3">
                {EDITABLE_FIELDS.map(field => (
                  <div key={field}>
                    <label className="text-xs text-slate-400 block mb-1">{field}</label>
                    <input
                      value={editFields[field] ?? ''}
                      onChange={e => setEditFields(f => ({ ...f, [field]: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Note (optional)</label>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for this change…"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600" />
                </div>
              </div>
            )}

            {view === 'changelog' && (
              <div className="space-y-2">
                {changelog.length === 0 && <p className="text-slate-500 text-sm">No changes recorded yet.</p>}
                {changelog.map((entry: ChangelogEntry, i: number) => (
                  <div key={i} className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-violet-300">{entry.source}</span>
                      <span className="text-xs text-slate-500">{new Date(entry.changed_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-300"><span className="text-slate-400">{entry.field}:</span> {entry.old_value ?? '∅'} → {entry.new_value ?? '∅'}</p>
                    {entry.note && <p className="text-xs text-slate-500 mt-1 italic">{entry.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {view === 'edit' && (
            <div className="p-4 border-t border-white/10">
              {saveMsg && <p className="text-xs text-slate-400 mb-2">{saveMsg}</p>}
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + browser check**

```bash
npm run typecheck
```
Open Products page. Verify table loads, search works, clicking a row opens the detail panel, Edit and Changelog tabs switch, saving calls the API.

- [ ] **Step 3: Commit**

```bash
git add components/pages/ProductsPage.tsx && git commit -m "feat: implement ProductsPage with inline editing and changelog view"
```

---

## Task 12: Override Import Page

**Files:**
- Modify: `components/pages/OverrideImportPage.tsx`

- [ ] **Step 1: Implement OverrideImportPage.tsx**

```tsx
'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

type DiffRow = { sku: string; productId: string; changes: Array<{ field: string; oldValue: string; newValue: string }> };
type PreviewResult = { matched: DiffRow[]; unmatched: string[]; ignoredColumns: string[] };
type Stage = 'idle' | 'loading' | 'preview' | 'confirming' | 'done' | 'error';

export function OverrideImportPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStage('loading');
    setError(null);
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    const res = await fetch('/api/override-import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: text }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setStage('error'); return; }
    setPreview(json);
    setStage('preview');
  }

  async function handleConfirm() {
    if (!note.trim()) return;
    setStage('confirming');
    const res = await fetch('/api/override-import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText, note, batchId: fileName }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setStage('error'); return; }
    setResult(json);
    setStage('done');
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-white mb-2">Override Import</h1>
      <p className="text-slate-400 text-sm mb-6">Upload a CSV to hard-code overrides to existing products. SKU is used as the match key.</p>

      {stage === 'idle' || stage === 'error' ? (
        <>
          <div
            className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-violet-400 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <Upload size={32} className="mx-auto mb-3 text-slate-500" />
            <p className="text-slate-400 text-sm">Drop a CSV here or click to browse</p>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
          {stage === 'error' && <p className="mt-4 text-rose-300 text-sm">{error}</p>}
        </>
      ) : stage === 'loading' ? (
        <p className="text-slate-400 text-sm">Parsing and comparing against database…</p>
      ) : stage === 'preview' && preview ? (
        <div>
          <div className="flex gap-4 mb-4">
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-white">{preview.matched.length}</p>
              <p className="text-xs text-slate-400">rows with changes</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-amber-300">{preview.unmatched.length}</p>
              <p className="text-xs text-slate-400">unmatched SKUs</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-slate-400">{preview.ignoredColumns.length}</p>
              <p className="text-xs text-slate-400">ignored columns</p>
            </div>
          </div>

          {preview.ignoredColumns.length > 0 && (
            <p className="text-xs text-slate-500 mb-4">Ignored columns: {preview.ignoredColumns.join(', ')}</p>
          )}

          <div className="bg-white/5 rounded-xl overflow-hidden mb-4 max-h-80 overflow-y-auto">
            {preview.matched.slice(0, 50).map((row, i) => (
              <div key={i} className="border-b border-white/5 px-4 py-3">
                <p className="text-xs text-white font-mono mb-1">{row.sku}</p>
                {row.changes.map((c, j) => (
                  <p key={j} className="text-xs text-slate-400">
                    <span className="text-slate-300">{c.field}:</span> {c.oldValue || '∅'} → <span className="text-violet-300">{c.newValue}</span>
                  </p>
                ))}
              </div>
            ))}
            {preview.matched.length > 50 && <p className="px-4 py-3 text-xs text-slate-500">…and {preview.matched.length - 50} more rows</p>}
          </div>

          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">Batch note (required)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Manual price corrections from supplier sheet 2026-03"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStage('idle'); setPreview(null); setNote(''); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={!note.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white transition-colors">
              Confirm override ({preview.matched.length} rows)
            </button>
          </div>
        </div>
      ) : stage === 'confirming' ? (
        <p className="text-slate-400 text-sm">Applying overrides…</p>
      ) : stage === 'done' && result ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <p className="text-emerald-300 text-sm font-medium mb-2">Override complete</p>
          <p className="text-slate-400 text-sm">Rows updated: {result.rowsUpdated}</p>
          <p className="text-slate-400 text-sm">Rows skipped (SKU not found): {result.rowsSkipped}</p>
          <button onClick={() => { setStage('idle'); setResult(null); setNote(''); }}
            className="mt-3 text-xs text-violet-400 hover:text-violet-300">
            Import another file
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + browser check**

```bash
npm run typecheck
```
Open Override Import. Verify file upload shows a diff preview, note field gates the Confirm button, confirm applies changes.

- [ ] **Step 3: Commit**

```bash
git add components/pages/OverrideImportPage.tsx && git commit -m "feat: implement OverrideImportPage with diff preview and batch note"
```

---

## Task 13: Settings Page

**Files:**
- Modify: `components/pages/SettingsPage.tsx`

- [ ] **Step 1: Implement SettingsPage.tsx**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

type Brand = { id: string; name: string };

export function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newBrand, setNewBrand] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function loadBrands() {
    const res = await fetch('/api/settings/brands');
    const json = await res.json();
    setBrands(json.brands ?? []);
  }

  useEffect(() => { loadBrands(); }, []);

  async function addBrand() {
    if (!newBrand.trim()) return;
    await fetch('/api/settings/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBrand.trim() }),
    });
    setNewBrand('');
    loadBrands();
  }

  async function removeBrand(id: string) {
    await fetch(`/api/settings/brands/${id}`, { method: 'DELETE' });
    loadBrands();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/settings/sync', { method: 'POST' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSyncMsg(`Synced ${json.synced} validated products to Supabase.`);
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed');
    }
    setSyncing(false);
  }

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-xl font-semibold text-white mb-8">Settings</h1>

      {/* Brand list */}
      <section className="mb-10">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Reputable brand list</h2>
        <p className="text-xs text-slate-500 mb-4">Products whose names contain these strings receive +20 priority points in the Taxonomy Queue.</p>

        <div className="flex gap-2 mb-3">
          <input
            value={newBrand}
            onChange={e => setNewBrand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addBrand(); }}
            placeholder="Brand name…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <button onClick={addBrand} className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-2 rounded-lg transition-colors">
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-1">
          {brands.length === 0 && <p className="text-slate-500 text-xs">No brands added yet.</p>}
          {brands.map(b => (
            <div key={b.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
              <span className="text-sm text-white">{b.name}</span>
              <button onClick={() => removeBrand(b.id)} className="text-slate-500 hover:text-rose-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Supabase sync */}
      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-1">Supabase sync</h2>
        <p className="text-xs text-slate-500 mb-4">Push all validated products to Supabase (one-way upsert keyed on SKU).</p>
        <button onClick={handleSync} disabled={syncing}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          {syncing ? 'Syncing…' : 'Sync validated products to Supabase'}
        </button>
        {syncMsg && <p className="mt-2 text-xs text-slate-400">{syncMsg}</p>}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + browser check**

```bash
npm run typecheck
```
Open Settings. Add a brand, verify it appears in the list, remove it. Check the sync button shows the count message.

- [ ] **Step 3: Commit**

```bash
git add components/pages/SettingsPage.tsx && git commit -m "feat: implement SettingsPage with brand list and Supabase sync trigger"
```

---

## Task 14: Final verification

- [ ] **Step 1: Run full typecheck**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 2: Start dev server and smoke-test all 6 pages**

```bash
npm run dev
```

Check each page:
1. **Import** — upload a small CSV, verify it processes and shows success
2. **Processing Review** — shows product stats and batch logs
3. **Taxonomy Queue** — shows ranked products, side panel opens/closes, batch validate runs
4. **Products** — table loads, search filters, click opens detail panel, edit saves, changelog tab shows entries
5. **Override Import** — upload a CSV, preview shows diff, note gates confirm, confirm applies changes
6. **Settings** — brand list add/remove works, sync button responds

- [ ] **Step 3: Final commit**

```bash
git add -A && git commit -m "chore: final verification pass — all 6 pages functional"
```
