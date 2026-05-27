# Supplier Intake Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a supplier product intake workflow that imports supplier files from Google Drive or manual upload, preserves evidence, classifies the pricing structure, normalizes rows, matches products, calculates website selling price, requires human approval, and writes audited cost/price changes.

**Architecture:** Extend the existing local-first Next.js product engine with focused JSON-backed repositories in `lib/db/client.ts`, pure business logic modules for matching and pricing, API routes for settings/intake/review/commit, and new UI pages under Import and Settings. Keep all final product writes behind validation and changelog entries so every cost and price decision can be traced to supplier evidence.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, local JSON database under `ENGINE_PRODUCT/data/db`, existing Supabase sync, `xlsx` for spreadsheet normalization, `googleapis` for optional Drive ingestion, existing changelog APIs and UI patterns.

---

## File Structure

- Create `ENGINE_PRODUCT/lib/supplier-intake/types.ts` for shared supplier, intake, match, pricing, and audit types.
- Create `ENGINE_PRODUCT/lib/supplier-intake/pricing.ts` for pure price calculation and validation.
- Create `ENGINE_PRODUCT/lib/supplier-intake/matching.ts` for pure product match scoring.
- Create `ENGINE_PRODUCT/lib/supplier-intake/normalization.ts` for supplier file row normalization.
- Create `ENGINE_PRODUCT/lib/supplier-intake/google-drive.ts` for Drive file listing/download helpers.
- Modify `ENGINE_PRODUCT/lib/db/client.ts` to add JSON-backed supplier intake persistence and widen changelog source types.
- Create `ENGINE_PRODUCT/app/api/settings/suppliers/route.ts` for supplier settings list/create/update.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/route.ts` for creating/listing intake runs.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/route.ts` for run detail.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/normalize/route.ts` for normalized CSV generation.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/match/route.ts` for product matching.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/price/route.ts` for selling price proposals.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/approve/route.ts` for human approval.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/commit/route.ts` for final cost/price database updates.
- Create `ENGINE_PRODUCT/app/api/supplier-intake/monthly-audit/route.ts` for consistency checks.
- Create `ENGINE_PRODUCT/components/pages/SupplierIntakePage.tsx` for the operational workflow.
- Create `ENGINE_PRODUCT/components/pages/SupplierSettingsPage.tsx` for supplier, Drive folder, code, and pricing rule configuration.
- Modify `ENGINE_PRODUCT/components/pages/ImportHubPage.tsx` to add a Supplier Intake tab.
- Modify `ENGINE_PRODUCT/components/pages/SettingsPage.tsx` to include Supplier Intake settings.
- Add tests in `ENGINE_PRODUCT/tests/supplier-intake/` for pricing, matching, normalization, and commit behavior.

---

## Google Drive Folder Contract

The production Drive source folder is:

`https://drive.google.com/drive/folders/1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG`

It contains three top-level pricing structure buckets:

- `1.RSP PRICE` (`1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY`)
  - Supplier file includes agreed RSP / Retail Suggested Price.
  - The pricing engine should prefer supplier RSP after margin and price-change validation.
  - Includes a tracking spreadsheet: `Check List RSP Supplier`.

- `2. NO RSP PRICE` (`132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf`)
  - Supplier file provides cost but no agreed RSP.
  - The pricing engine must calculate website selling price from supplier/category formula.

- `3.Retail Supplier (Cash on store)` (`1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz`)
  - Supplier is retail/cash-store style.
  - Treat as a distinct pricing structure because margin, tax, and retail reference behavior may differ from importer/distributor suppliers.

Observed folder depth:

`Pricing bucket -> Supplier folder -> Month folder -> Evidence file(s)`

Examples inspected:

- `1.RSP PRICE / United Beverage (Update) / May 2026 / 4. Quotation May 2026.xlsx`
- `2. NO RSP PRICE / SK Liqour (Update) / May 2026 / SK WINE PRice List2026-2(1).pdf`
- `3.Retail Supplier (Cash on store) / Surawong Store (Update) / May / PDF price files`

Supported evidence file types must include `.xlsx`, Google Sheets, `.csv`, and `.pdf`. PDF files should be preserved as evidence even when automatic extraction is not reliable. The workflow must allow a human/operator to attach or upload a normalized CSV derived from the PDF while keeping the original Drive PDF linked to the intake run.

---

### Task 1: Add Shared Supplier Intake Types

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/types.ts`

- [ ] **Step 1: Create the type module**

```ts
export type SupplierStatus = 'active' | 'inactive';
export type PricingMode = 'supplier_rsp' | 'formula' | 'hybrid';
export type SupplierPricingStructure = 'rsp_price' | 'no_rsp_price' | 'retail_cash_store';
export type RoundingMode = 'none' | 'nearest_1' | 'nearest_5' | 'nearest_9' | 'nearest_10';
export type IntakeRunStatus = 'registered' | 'normalized' | 'matched' | 'priced' | 'approved' | 'committed' | 'blocked';
export type IntakeRowStatus = 'pending' | 'matched_auto' | 'matched_needs_review' | 'new_code_required' | 'priced' | 'approved' | 'blocked' | 'committed';
export type PriceDecisionSource = 'supplier_rsp' | 'formula' | 'manual_override';

export interface SupplierPricingRule {
  mode: PricingMode;
  target_margin_pct: number;
  minimum_margin_pct: number;
  markup_multiplier?: number;
  vat_pct?: number;
  rounding: RoundingMode;
  review_price_change_pct: number;
}

export interface SupplierDefinition {
  id: string;
  name: string;
  supplier_code: string;
  status: SupplierStatus;
  pricing_structure: SupplierPricingStructure;
  drive_bucket_folder_id?: string;
  drive_folder_id?: string;
  allowed_formats: Array<'csv' | 'xlsx' | 'google_sheet' | 'pdf'>;
  default_currency: string;
  pricing_rule: SupplierPricingRule;
  created_at: string;
  updated_at: string;
}

export interface SupplierIntakeRun {
  id: string;
  supplier_id: string;
  supplier_name: string;
  source_filename: string;
  source_format: 'csv' | 'xlsx' | 'google_sheet' | 'pdf';
  pricing_structure: SupplierPricingStructure;
  source_bucket_folder_id?: string;
  source_supplier_folder_id?: string;
  source_month_folder_id?: string;
  source_drive_file_id?: string;
  source_file_hash?: string;
  normalized_filename?: string;
  normalized_file_hash?: string;
  status: IntakeRunStatus;
  total_rows: number;
  approved_rows: number;
  blocked_rows: number;
  created_at: string;
  updated_at: string;
  notes?: string;
}

export interface SupplierNormalizedRow {
  id: string;
  run_id: string;
  row_number: number;
  raw_payload: Record<string, unknown>;
  normalized_payload: {
    supplier_item_code?: string;
    sku?: string;
    barcode?: string;
    name: string;
    brand?: string;
    category?: string;
    bottle_size?: string;
    vintage?: string;
    country?: string;
    region?: string;
    cost: number;
    rsp?: number;
    currency: string;
  };
  status: IntakeRowStatus;
  issues: string[];
  match?: SupplierMatchProposal;
  price?: SupplierPriceProposal;
  approved_by?: string;
  approved_at?: string;
}

export interface SupplierMatchCandidate {
  product_id: string;
  sku: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface SupplierMatchProposal {
  status: 'no_match' | 'strong_match' | 'likely_match' | 'conflict';
  selected_product_id?: string;
  selected_sku?: string;
  confidence: number;
  candidates: SupplierMatchCandidate[];
  reasons: string[];
}

export interface SupplierPriceProposal {
  cost: number;
  supplier_rsp?: number;
  calculated_price: number;
  final_selling_price: number;
  margin_amount: number;
  margin_pct: number;
  decision_source: PriceDecisionSource;
  status: 'auto_approved' | 'needs_review' | 'blocked';
  issues: string[];
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/types.ts
git commit -m "feat: add supplier intake domain types"
```

---

### Task 1A: Seed Drive Pricing Buckets

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/drive-structure.ts`

- [ ] **Step 1: Create Drive bucket constants**

```ts
import type { SupplierPricingStructure } from './types';

export interface SupplierDriveBucket {
  structure: SupplierPricingStructure;
  label: string;
  folder_id: string;
  folder_url: string;
  pricing_behavior: 'use_rsp_when_valid' | 'calculate_from_cost' | 'retail_cash_store_rule';
}

export const SUPPLIER_DRIVE_ROOT_FOLDER_ID = '1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG';

export const SUPPLIER_DRIVE_BUCKETS: SupplierDriveBucket[] = [
  {
    structure: 'rsp_price',
    label: '1.RSP PRICE',
    folder_id: '1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY',
    folder_url: 'https://drive.google.com/drive/folders/1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY',
    pricing_behavior: 'use_rsp_when_valid',
  },
  {
    structure: 'no_rsp_price',
    label: '2. NO RSP PRICE',
    folder_id: '132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf',
    folder_url: 'https://drive.google.com/drive/folders/132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf',
    pricing_behavior: 'calculate_from_cost',
  },
  {
    structure: 'retail_cash_store',
    label: '3.Retail Supplier (Cash on store)',
    folder_id: '1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz',
    folder_url: 'https://drive.google.com/drive/folders/1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz',
    pricing_behavior: 'retail_cash_store_rule',
  },
];
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/drive-structure.ts ENGINE_PRODUCT/lib/supplier-intake/types.ts
git commit -m "feat: define supplier drive pricing buckets"
```

---

### Task 2: Build Pricing Engine

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/pricing.ts`
- Test: `ENGINE_PRODUCT/tests/supplier-intake/pricing.test.ts`

- [ ] **Step 1: Write pricing tests**

```ts
import { calculateSupplierPrice } from '@/lib/supplier-intake/pricing';

describe('calculateSupplierPrice', () => {
  it('uses supplier RSP when hybrid mode has valid RSP', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      supplierRsp: 890,
      currentWebsitePrice: 820,
      rule: {
        mode: 'hybrid',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.final_selling_price).toBe(890);
    expect(result.decision_source).toBe('supplier_rsp');
    expect(result.status).toBe('auto_approved');
  });

  it('falls back to formula when hybrid mode has no RSP', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      currentWebsitePrice: 820,
      rule: {
        mode: 'hybrid',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.final_selling_price).toBe(700);
    expect(result.decision_source).toBe('formula');
  });

  it('blocks prices below minimum margin', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      supplierRsp: 500,
      currentWebsitePrice: 820,
      rule: {
        mode: 'supplier_rsp',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.issues).toContain('Margin below minimum');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- supplier-intake/pricing.test.ts`

Expected: FAIL because `calculateSupplierPrice` does not exist. If the repo has no test runner yet, add Vitest in a separate preparatory commit or use `tsx` script tests consistent with existing project practice.

- [ ] **Step 3: Implement pricing logic**

```ts
import type { SupplierPriceProposal, SupplierPricingRule } from './types';

export function roundPrice(value: number, rounding: SupplierPricingRule['rounding']): number {
  if (rounding === 'none') return Math.round(value * 100) / 100;
  if (rounding === 'nearest_1') return Math.round(value);
  if (rounding === 'nearest_5') return Math.round(value / 5) * 5;
  if (rounding === 'nearest_9') return Math.max(9, Math.round(value / 10) * 10 - 1);
  return Math.round(value / 10) * 10;
}

export function calculateSupplierPrice(input: {
  cost: number;
  supplierRsp?: number;
  currentWebsitePrice?: number;
  rule: SupplierPricingRule;
}): SupplierPriceProposal {
  const issues: string[] = [];
  const vatMultiplier = 1 + ((input.rule.vat_pct ?? 0) / 100);
  const formulaBase = input.cost / (1 - input.rule.target_margin_pct / 100);
  const formulaPrice = roundPrice(formulaBase * vatMultiplier, input.rule.rounding);
  const canUseRsp = input.supplierRsp !== undefined && input.supplierRsp > 0;

  let finalPrice = formulaPrice;
  let decisionSource: SupplierPriceProposal['decision_source'] = 'formula';

  if (input.rule.mode === 'supplier_rsp' && canUseRsp) {
    finalPrice = roundPrice(input.supplierRsp!, input.rule.rounding);
    decisionSource = 'supplier_rsp';
  }

  if (input.rule.mode === 'hybrid' && canUseRsp) {
    finalPrice = roundPrice(input.supplierRsp!, input.rule.rounding);
    decisionSource = 'supplier_rsp';
  }

  const marginAmount = finalPrice - input.cost;
  const marginPct = finalPrice > 0 ? (marginAmount / finalPrice) * 100 : 0;

  if (input.cost <= 0) issues.push('Cost must be greater than zero');
  if (finalPrice <= input.cost) issues.push('Selling price must be greater than cost');
  if (marginPct < input.rule.minimum_margin_pct) issues.push('Margin below minimum');

  if (input.currentWebsitePrice && input.currentWebsitePrice > 0) {
    const changePct = Math.abs((finalPrice - input.currentWebsitePrice) / input.currentWebsitePrice) * 100;
    if (changePct > input.rule.review_price_change_pct) issues.push('Price change exceeds review threshold');
  }

  const blocked = issues.some(issue =>
    issue === 'Cost must be greater than zero' ||
    issue === 'Selling price must be greater than cost' ||
    issue === 'Margin below minimum'
  );

  return {
    cost: input.cost,
    supplier_rsp: input.supplierRsp,
    calculated_price: formulaPrice,
    final_selling_price: finalPrice,
    margin_amount: Math.round(marginAmount * 100) / 100,
    margin_pct: Math.round(marginPct * 10) / 10,
    decision_source: decisionSource,
    status: blocked ? 'blocked' : issues.length > 0 ? 'needs_review' : 'auto_approved',
    issues,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/pricing.ts ENGINE_PRODUCT/tests/supplier-intake/pricing.test.ts
git commit -m "feat: calculate supplier selling prices"
```

---

### Task 3: Build Product Matching Engine

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/matching.ts`
- Test: `ENGINE_PRODUCT/tests/supplier-intake/matching.test.ts`

- [ ] **Step 1: Write matching tests**

```ts
import { buildMatchProposal } from '@/lib/supplier-intake/matching';

const products = [
  { id: 'p1', sku: 'WRW0001AA', name: 'Chateau Example Rouge 2020', brand: 'Chateau Example', bottle_size: '750ml', vintage: '2020' },
  { id: 'p2', sku: 'WRW0002AA', name: 'Other Wine 2021', brand: 'Other', bottle_size: '750ml', vintage: '2021' },
];

describe('buildMatchProposal', () => {
  it('returns strong match for exact SKU', () => {
    const proposal = buildMatchProposal({ sku: 'WRW0001AA', name: 'Different label', cost: 400, currency: 'THB' }, products);
    expect(proposal.status).toBe('strong_match');
    expect(proposal.selected_sku).toBe('WRW0001AA');
  });

  it('returns likely match from brand, name, size, and vintage', () => {
    const proposal = buildMatchProposal({
      name: 'Chateau Example Rouge',
      brand: 'Chateau Example',
      bottle_size: '750ml',
      vintage: '2020',
      cost: 455,
      currency: 'THB',
    }, products);
    expect(proposal.status).toBe('likely_match');
    expect(proposal.candidates[0].sku).toBe('WRW0001AA');
  });
});
```

- [ ] **Step 2: Implement scoring**

```ts
import type { SupplierMatchProposal, SupplierNormalizedRow } from './types';

function norm(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(norm(a).split(' ').filter(Boolean));
  const right = new Set(norm(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

export function buildMatchProposal(
  row: SupplierNormalizedRow['normalized_payload'],
  products: Array<Record<string, any>>,
): SupplierMatchProposal {
  const candidates = products.map(product => {
    let score = 0;
    const reasons: string[] = [];

    if (row.sku && norm(row.sku) === norm(product.sku)) {
      score += 100;
      reasons.push('Exact SKU match');
    }

    const nameScore = tokenOverlap(row.name, product.name);
    if (nameScore > 0) {
      score += Math.round(nameScore * 35);
      reasons.push('Product name similarity');
    }

    if (row.brand && norm(row.brand) === norm(product.brand)) {
      score += 20;
      reasons.push('Brand match');
    }

    if (row.bottle_size && norm(row.bottle_size) === norm(product.bottle_size)) {
      score += 10;
      reasons.push('Bottle size match');
    }

    if (row.vintage && norm(row.vintage) === norm(product.vintage)) {
      score += 10;
      reasons.push('Vintage match');
    }

    return {
      product_id: String(product.id ?? ''),
      sku: String(product.sku ?? ''),
      name: String(product.name ?? ''),
      score,
      reasons,
    };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

  const best = candidates[0];
  if (!best) return { status: 'no_match', confidence: 0, candidates: [], reasons: ['No product candidate found'] };
  if (best.score >= 100) return { status: 'strong_match', selected_product_id: best.product_id, selected_sku: best.sku, confidence: best.score, candidates, reasons: best.reasons };
  if (best.score >= 55) return { status: 'likely_match', selected_product_id: best.product_id, selected_sku: best.sku, confidence: best.score, candidates, reasons: best.reasons };
  return { status: 'conflict', confidence: best.score, candidates, reasons: ['Low-confidence candidate requires review'] };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/matching.ts ENGINE_PRODUCT/tests/supplier-intake/matching.test.ts
git commit -m "feat: score supplier product matches"
```

---

### Task 4: Add Supplier Intake Persistence

**Files:**
- Modify: `ENGINE_PRODUCT/lib/db/client.ts`

- [ ] **Step 1: Add JSON file constants**

Add near existing `productsFile` and `logsFile`:

```ts
const suppliersFile = path.join(dbDir, 'suppliers.json');
const supplierIntakeRunsFile = path.join(dbDir, 'supplier-intake-runs.json');
const supplierIntakeRowsFile = path.join(dbDir, 'supplier-intake-rows.json');
```

- [ ] **Step 2: Import supplier types**

```ts
import type { SupplierDefinition, SupplierIntakeRun, SupplierNormalizedRow } from '@/lib/supplier-intake/types';
```

- [ ] **Step 3: Widen changelog source**

Change `ProductChangelog['source']` to include:

```ts
| 'supplier_intake'
| 'supplier_pricing'
| 'monthly_audit'
```

- [ ] **Step 4: Add read/write helpers**

```ts
async function readJsonArray<T>(file: string): Promise<T[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(file)) {
      const data = await readFile(file, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error reading ${file}:`, error);
  }
  return [];
}

async function writeJsonArray<T>(file: string, rows: T[]) {
  await ensureDbDir();
  await writeFile(file, JSON.stringify(rows, null, 2), 'utf-8');
}
```

- [ ] **Step 5: Add supplier repository functions**

```ts
export async function getSuppliers() {
  return readJsonArray<SupplierDefinition>(suppliersFile);
}

export async function saveSupplier(input: Omit<SupplierDefinition, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
  const now = new Date().toISOString();
  const suppliers = await getSuppliers();
  const idx = suppliers.findIndex(s => s.id === input.id);
  if (idx >= 0) {
    suppliers[idx] = { ...suppliers[idx], ...input, updated_at: now };
  } else {
    suppliers.push({ ...input, id: randomId(), created_at: now, updated_at: now });
  }
  await writeJsonArray(suppliersFile, suppliers);
  return { success: true };
}

export async function getSupplierIntakeRuns() {
  return readJsonArray<SupplierIntakeRun>(supplierIntakeRunsFile);
}

export async function saveSupplierIntakeRun(run: SupplierIntakeRun) {
  const runs = await getSupplierIntakeRuns();
  const idx = runs.findIndex(r => r.id === run.id);
  if (idx >= 0) runs[idx] = { ...run, updated_at: new Date().toISOString() };
  else runs.unshift(run);
  await writeJsonArray(supplierIntakeRunsFile, runs);
  return { success: true };
}

export async function getSupplierIntakeRows(runId?: string) {
  const rows = await readJsonArray<SupplierNormalizedRow>(supplierIntakeRowsFile);
  return runId ? rows.filter(r => r.run_id === runId) : rows;
}

export async function saveSupplierIntakeRows(runId: string, nextRows: SupplierNormalizedRow[]) {
  const rows = await readJsonArray<SupplierNormalizedRow>(supplierIntakeRowsFile);
  const kept = rows.filter(r => r.run_id !== runId);
  await writeJsonArray(supplierIntakeRowsFile, [...kept, ...nextRows]);
  return { success: true };
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ENGINE_PRODUCT/lib/db/client.ts
git commit -m "feat: persist supplier intake records"
```

---

### Task 5: Add Supplier Settings API

**Files:**
- Create: `ENGINE_PRODUCT/app/api/settings/suppliers/route.ts`

- [ ] **Step 1: Implement API route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSuppliers, saveSupplier } from '@/lib/db/client';

export async function GET() {
  return NextResponse.json({ suppliers: await getSuppliers() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.supplier_code) {
    return NextResponse.json({ error: 'name and supplier_code are required' }, { status: 400 });
  }

  await saveSupplier({
    id: body.id,
    name: String(body.name).trim(),
    supplier_code: String(body.supplier_code).trim().toUpperCase(),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    pricing_structure: body.pricing_structure ?? 'no_rsp_price',
    drive_bucket_folder_id: body.drive_bucket_folder_id ? String(body.drive_bucket_folder_id).trim() : undefined,
    drive_folder_id: body.drive_folder_id ? String(body.drive_folder_id).trim() : undefined,
    allowed_formats: Array.isArray(body.allowed_formats) ? body.allowed_formats : ['csv', 'xlsx', 'google_sheet', 'pdf'],
    default_currency: body.default_currency ? String(body.default_currency).trim().toUpperCase() : 'THB',
    pricing_rule: body.pricing_rule ?? {
      mode: 'hybrid',
      target_margin_pct: 35,
      minimum_margin_pct: 25,
      vat_pct: 0,
      rounding: 'nearest_10',
      review_price_change_pct: 20,
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ENGINE_PRODUCT/app/api/settings/suppliers/route.ts
git commit -m "feat: expose supplier settings api"
```

---

### Task 6: Add Normalization Engine

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/normalization.ts`

- [ ] **Step 1: Implement normalization**

```ts
import * as XLSX from 'xlsx';
import type { SupplierDefinition, SupplierNormalizedRow } from './types';

function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pick(row: Record<string, unknown>, names: string[]): unknown {
  const lowered = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const name of names) {
    const value = lowered[name.toLowerCase()];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function parseSupplierWorkbook(buffer: Buffer, filename: string): Record<string, unknown>[] {
  if (filename.toLowerCase().endsWith('.csv')) {
    const workbook = XLSX.read(buffer.toString('utf-8'), { type: 'string' });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}

export function normalizeSupplierRows(input: {
  runId: string;
  supplier: SupplierDefinition;
  rows: Record<string, unknown>[];
}): SupplierNormalizedRow[] {
  return input.rows.map((row, index) => {
    const cost = cleanNumber(pick(row, ['cost', 'cost price', 'net cost', 'buy price', 'wholesale price']));
    const rsp = cleanNumber(pick(row, ['rsp', 'rrp', 'retail suggest price', 'retail suggested price', 'suggested retail price']));
    const name = String(pick(row, ['name', 'product name', 'item name', 'description']) ?? '').trim();
    const issues: string[] = [];

    if (!name) issues.push('Missing product name');
    if (!cost || cost <= 0) issues.push('Missing valid cost');

    return {
      id: `${input.runId}-${index + 1}`,
      run_id: input.runId,
      row_number: index + 1,
      raw_payload: row,
      normalized_payload: {
        supplier_item_code: String(pick(row, ['supplier item code', 'item code', 'code']) ?? '').trim() || undefined,
        sku: String(pick(row, ['sku', 'product code']) ?? '').trim() || undefined,
        barcode: String(pick(row, ['barcode', 'ean', 'upc']) ?? '').trim() || undefined,
        name,
        brand: String(pick(row, ['brand', 'producer']) ?? '').trim() || undefined,
        category: String(pick(row, ['category', 'type']) ?? '').trim() || undefined,
        bottle_size: String(pick(row, ['size', 'bottle size', 'volume']) ?? '').trim() || undefined,
        vintage: String(pick(row, ['vintage', 'year']) ?? '').trim() || undefined,
        country: String(pick(row, ['country', 'origin country']) ?? '').trim() || undefined,
        region: String(pick(row, ['region']) ?? '').trim() || undefined,
        cost: cost ?? 0,
        rsp,
        currency: input.supplier.default_currency,
      },
      status: issues.length ? 'blocked' : 'pending',
      issues,
    };
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/normalization.ts
git commit -m "feat: normalize supplier files"
```

---

### Task 7: Add Intake Run APIs

**Files:**
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/route.ts`
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/route.ts`
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/normalize/route.ts`
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/match/route.ts`
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/price/route.ts`

- [ ] **Step 1: Create/list runs**

`ENGINE_PRODUCT/app/api/supplier-intake/runs/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun } from '@/lib/db/client';

export async function GET() {
  return NextResponse.json({ runs: await getSupplierIntakeRuns() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const suppliers = await getSuppliers();
  const supplier = suppliers.find(s => s.id === body.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const now = new Date().toISOString();
  const run = {
    id: `intake-${Date.now()}`,
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    source_filename: String(body.source_filename ?? 'supplier-file.csv'),
    source_format: body.source_format === 'pdf' ? 'pdf' as const : body.source_format === 'google_sheet' ? 'google_sheet' as const : String(body.source_format ?? 'csv').toLowerCase() === 'xlsx' ? 'xlsx' as const : 'csv' as const,
    pricing_structure: supplier.pricing_structure,
    source_bucket_folder_id: body.source_bucket_folder_id ? String(body.source_bucket_folder_id) : supplier.drive_bucket_folder_id,
    source_supplier_folder_id: body.source_supplier_folder_id ? String(body.source_supplier_folder_id) : supplier.drive_folder_id,
    source_month_folder_id: body.source_month_folder_id ? String(body.source_month_folder_id) : undefined,
    source_drive_file_id: body.source_drive_file_id ? String(body.source_drive_file_id) : undefined,
    status: 'registered' as const,
    total_rows: 0,
    approved_rows: 0,
    blocked_rows: 0,
    created_at: now,
    updated_at: now,
    notes: body.notes ? String(body.notes) : undefined,
  };

  await saveSupplierIntakeRun(run);
  return NextResponse.json({ run });
}
```

- [ ] **Step 2: Run detail**

`ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSupplierIntakeRows, getSupplierIntakeRuns } from '@/lib/db/client';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  return NextResponse.json({ run, rows: await getSupplierIntakeRows(params.id) });
}
```

- [ ] **Step 3: Normalize endpoint**

This endpoint should accept uploaded file bytes first. Drive download is added in Task 11. If the source file is PDF and no automatic extractor is available, the endpoint must keep the PDF evidence linked to the run and require an attached normalized CSV/XLSX derived from that PDF.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { normalizeSupplierRows, parseSupplierWorkbook } from '@/lib/supplier-intake/normalization';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  if (run.source_format === 'pdf' && !file.name.toLowerCase().match(/\.(csv|xlsx)$/)) {
    return NextResponse.json({
      error: 'PDF evidence requires an attached normalized CSV/XLSX file before automated normalization',
    }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawRows = parseSupplierWorkbook(buffer, file.name);
  const rows = normalizeSupplierRows({ runId: run.id, supplier, rows: rawRows });

  await saveSupplierIntakeRows(run.id, rows);
  await saveSupplierIntakeRun({ ...run, status: 'normalized', total_rows: rows.length, blocked_rows: rows.filter(r => r.status === 'blocked').length, updated_at: new Date().toISOString() });

  return NextResponse.json({ rows });
}
```

- [ ] **Step 4: Match endpoint**

```ts
import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows, getSupplierIntakeRuns, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { buildMatchProposal } from '@/lib/supplier-intake/matching';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows(run.id);
  const nextRows = rows.map(row => {
    if (row.status === 'blocked') return row;
    const match = buildMatchProposal(row.normalized_payload, products);
    return {
      ...row,
      match,
      status: match.status === 'strong_match' ? 'matched_auto' as const : match.status === 'no_match' ? 'new_code_required' as const : 'matched_needs_review' as const,
    };
  });

  await saveSupplierIntakeRows(run.id, nextRows);
  await saveSupplierIntakeRun({ ...run, status: 'matched', updated_at: new Date().toISOString() });
  return NextResponse.json({ rows: nextRows });
}
```

- [ ] **Step 5: Price endpoint**

```ts
import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows, getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { calculateSupplierPrice } from '@/lib/supplier-intake/pricing';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows(run.id);
  const nextRows = rows.map(row => {
    if (row.status === 'blocked') return row;
    const product = products.find(p => p.id === row.match?.selected_product_id || p.sku === row.match?.selected_sku);
    const price = calculateSupplierPrice({
      cost: row.normalized_payload.cost,
      supplierRsp: row.normalized_payload.rsp,
      currentWebsitePrice: product?.price,
      rule: supplier.pricing_rule,
    });
    return { ...row, price, status: price.status === 'blocked' ? 'blocked' as const : 'priced' as const, issues: [...row.issues, ...price.issues] };
  });

  await saveSupplierIntakeRows(run.id, nextRows);
  await saveSupplierIntakeRun({ ...run, status: 'priced', blocked_rows: nextRows.filter(r => r.status === 'blocked').length, updated_at: new Date().toISOString() });
  return NextResponse.json({ rows: nextRows });
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ENGINE_PRODUCT/app/api/supplier-intake/runs
git commit -m "feat: add supplier intake run pipeline api"
```

---

### Task 8: Add Approval And Commit APIs

**Files:**
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/approve/route.ts`
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/commit/route.ts`

- [ ] **Step 1: Approval endpoint**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRows, getSupplierIntakeRuns, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const approvedIds = new Set<string>(Array.isArray(body.row_ids) ? body.row_ids : []);
  const approver = String(body.approved_by ?? 'internal');
  const rows = await getSupplierIntakeRows(params.id);
  const now = new Date().toISOString();

  const nextRows = rows.map(row => {
    if (!approvedIds.has(row.id)) return row;
    if (!row.price || row.price.status === 'blocked') return { ...row, status: 'blocked' as const, issues: [...row.issues, 'Blocked price cannot be approved'] };
    return { ...row, status: 'approved' as const, approved_by: approver, approved_at: now };
  });

  await saveSupplierIntakeRows(params.id, nextRows);
  const run = (await getSupplierIntakeRuns()).find(r => r.id === params.id);
  if (run) await saveSupplierIntakeRun({ ...run, status: 'approved', approved_rows: nextRows.filter(r => r.status === 'approved').length, updated_at: now });
  return NextResponse.json({ rows: nextRows });
}
```

- [ ] **Step 2: Commit endpoint**

```ts
import { NextResponse } from 'next/server';
import { addChangelogEntries, getCleanedProducts, getSupplierIntakeRows, saveCleanedProduct, saveSupplierIntakeRows } from '@/lib/db/client';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows(params.id);
  const approved = rows.filter(row => row.status === 'approved' && row.match?.selected_product_id && row.price);
  const changelogEntries: any[] = [];

  for (const row of approved) {
    const product = products.find(p => p.id === row.match?.selected_product_id || p.sku === row.match?.selected_sku);
    if (!product) continue;

    const oldCost = product.cost ?? product.cost_price ?? null;
    const oldPrice = product.price ?? null;
    const nextCost = row.normalized_payload.cost;
    const nextPrice = row.price!.final_selling_price;

    await saveCleanedProduct({ ...product, cost: nextCost, cost_price: nextCost, price: nextPrice });

    if (String(oldCost ?? '') !== String(nextCost)) {
      changelogEntries.push({ product_id: product.id, sku: product.sku, source: 'supplier_intake', field: 'cost', old_value: oldCost == null ? null : String(oldCost), new_value: String(nextCost), note: `Supplier intake ${params.id} row ${row.row_number}` });
    }

    if (String(oldPrice ?? '') !== String(nextPrice)) {
      changelogEntries.push({ product_id: product.id, sku: product.sku, source: 'supplier_pricing', field: 'price', old_value: oldPrice == null ? null : String(oldPrice), new_value: String(nextPrice), note: `Supplier intake ${params.id} row ${row.row_number}` });
    }
  }

  if (changelogEntries.length > 0) await addChangelogEntries(changelogEntries);
  await saveSupplierIntakeRows(params.id, rows.map(row => approved.some(a => a.id === row.id) ? { ...row, status: 'committed' as const } : row));

  return NextResponse.json({ committed: approved.length, changelog_entries: changelogEntries.length });
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/approve/route.ts ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/commit/route.ts
git commit -m "feat: approve and commit supplier intake pricing"
```

---

### Task 9: Build Supplier Settings UI

**Files:**
- Create: `ENGINE_PRODUCT/components/pages/SupplierSettingsPage.tsx`
- Modify: `ENGINE_PRODUCT/components/pages/SettingsPage.tsx`

- [ ] **Step 1: Create SupplierSettingsPage**

Build a dense internal settings surface with:

- Supplier list.
- Name and two-letter supplier code.
- Pricing structure bucket: RSP PRICE, NO RSP PRICE, or Retail Supplier / Cash on Store.
- Drive bucket folder ID, supplier folder ID, and latest month folder discovery.
- Google Drive folder ID.
- Pricing mode selector.
- Target margin, minimum margin, VAT, rounding, review threshold.
- Save button.

Use existing Tailwind conventions from `SettingsPage.tsx`; avoid decorative cards and keep it operational.

- [ ] **Step 2: Wire into SettingsPage**

Add a section titled `Supplier Intake` below the existing Supabase sync section and render `<SupplierSettingsPage />`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ENGINE_PRODUCT/components/pages/SupplierSettingsPage.tsx ENGINE_PRODUCT/components/pages/SettingsPage.tsx
git commit -m "feat: configure supplier intake settings"
```

---

### Task 10: Build Supplier Intake Workflow UI

**Files:**
- Create: `ENGINE_PRODUCT/components/pages/SupplierIntakePage.tsx`
- Modify: `ENGINE_PRODUCT/components/pages/ImportHubPage.tsx`

- [ ] **Step 1: Create SupplierIntakePage**

The page must support:

- Select supplier.
- Register new intake run.
- Browse Drive bucket, supplier folder, month folder, and evidence files.
- Upload supplier CSV/XLSX for the run, including normalized CSV/XLSX for PDF evidence.
- Buttons for Normalize, Match, Calculate Price, Approve Selected, Commit Approved.
- Review table with columns:
  - row number
  - supplier item code
  - name
  - current matched SKU
  - match confidence
  - cost
  - supplier RSP
  - calculated price
  - final selling price
  - margin percent
  - status
  - issues

- [ ] **Step 2: Add ImportHub tab**

Modify `ImportHubPage.tsx`:

- Import `ClipboardCheck` or `FileSpreadsheet`.
- Add tab id `supplier_intake`.
- Lazy-load `SupplierIntakePage`.
- Render the page when active.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Start dev server and verify**

Run: `npm run dev`

Open the local app and verify:

- Import tab has Supplier Intake.
- Supplier Intake can create a run.
- Uploaded CSV produces rows.
- Match and price buttons update statuses.

- [ ] **Step 5: Commit**

```bash
git add ENGINE_PRODUCT/components/pages/SupplierIntakePage.tsx ENGINE_PRODUCT/components/pages/ImportHubPage.tsx
git commit -m "feat: add supplier intake workflow page"
```

---

### Task 11: Add Google Drive Source Integration

**Files:**
- Create: `ENGINE_PRODUCT/lib/supplier-intake/google-drive.ts`
- Modify: `ENGINE_PRODUCT/app/api/supplier-intake/runs/route.ts`
- Modify: `ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/normalize/route.ts`

- [ ] **Step 1: Add Drive helper**

```ts
import { google } from 'googleapis';

function driveClient() {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentials) throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not configured');
  const parsed = JSON.parse(credentials);
  const auth = new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function listSupplierDriveFiles(folderId: string) {
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
  });
  return res.data.files ?? [];
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = driveClient();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}

export async function exportGoogleSheetAsXlsx(fileId: string): Promise<Buffer> {
  const drive = driveClient();
  const res = await drive.files.export(
    { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
```

- [ ] **Step 2: Allow run creation from Drive file**

Update `runs/route.ts` so POST accepts `source_drive_file_id` and stores it on the run.

- [ ] **Step 3: Normalize from Drive when no upload exists**

Update `normalize/route.ts`:

- If multipart file exists, use upload.
- Else if run has `source_drive_file_id` and source format is `google_sheet`, download via `exportGoogleSheetAsXlsx`.
- Else if run has `source_drive_file_id` and source format is `pdf`, require an attached normalized CSV/XLSX and keep the Drive PDF as evidence.
- Else if run has `source_drive_file_id`, download via `downloadDriveFile`.
- Else return `file or source_drive_file_id is required`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ENGINE_PRODUCT/lib/supplier-intake/google-drive.ts ENGINE_PRODUCT/app/api/supplier-intake/runs/route.ts ENGINE_PRODUCT/app/api/supplier-intake/runs/[id]/normalize/route.ts
git commit -m "feat: load supplier files from google drive"
```

---

### Task 12: Add Monthly Supplier Data Audit

**Files:**
- Create: `ENGINE_PRODUCT/app/api/supplier-intake/monthly-audit/route.ts`

- [ ] **Step 1: Implement audit endpoint**

```ts
import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows } from '@/lib/db/client';

export async function POST() {
  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows();
  const issues: Array<{ severity: 'critical' | 'warning' | 'info'; sku?: string; message: string }> = [];

  const skuCounts = new Map<string, number>();
  for (const product of products) {
    if (product.sku) skuCounts.set(product.sku, (skuCounts.get(product.sku) ?? 0) + 1);
    if (product.price && (product.cost ?? product.cost_price) && product.price <= (product.cost ?? product.cost_price)) {
      issues.push({ severity: 'critical', sku: product.sku, message: 'Selling price is not above cost' });
    }
    if (!product.validation_status || product.validation_status !== 'validated') {
      issues.push({ severity: 'warning', sku: product.sku, message: 'Product is not validated' });
    }
  }

  for (const [sku, count] of skuCounts.entries()) {
    if (count > 1) issues.push({ severity: 'critical', sku, message: `Duplicate SKU appears ${count} times` });
  }

  const uncommittedApproved = rows.filter(row => row.status === 'approved');
  for (const row of uncommittedApproved) {
    issues.push({ severity: 'warning', message: `Approved supplier intake row not committed: ${row.run_id} row ${row.row_number}` });
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    total_issues: issues.length,
    issues,
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ENGINE_PRODUCT/app/api/supplier-intake/monthly-audit/route.ts
git commit -m "feat: audit supplier intake consistency"
```

---

### Task 13: Final Verification

**Files:**
- No new files unless fixing defects found during verification.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Manual scenario**

Create a supplier:

```json
{
  "name": "ABC Wine",
  "supplier_code": "AA",
  "default_currency": "THB",
  "pricing_rule": {
    "mode": "hybrid",
    "target_margin_pct": 35,
    "minimum_margin_pct": 25,
    "vat_pct": 0,
    "rounding": "nearest_10",
    "review_price_change_pct": 20
  }
}
```

Upload a CSV:

```csv
item code,product name,brand,size,vintage,cost,rsp
ABC001,Chateau Example Rouge 2020,Chateau Example,750ml,2020,455,890
```

Expected:

- Run status becomes `normalized`.
- Row status becomes `matched_auto` or `matched_needs_review` depending on catalog contents.
- Pricing proposes final selling price `890` from supplier RSP.
- Approval marks the row `approved`.
- Commit updates product `cost` and `price`.
- Change Log shows `supplier_intake` cost change and `supplier_pricing` price change.

- [ ] **Step 3: Google Drive scenario**

Configure supplier `drive_folder_id`, create a run using a Drive file ID, normalize without upload, and verify the row output matches the manual upload path.

- [ ] **Step 4: Monthly audit**

Run `POST /api/supplier-intake/monthly-audit`.

Expected:

- Returns JSON with `generated_at`, `total_issues`, and `issues`.
- Products where price is below cost are reported as critical.

- [ ] **Step 5: Final commit**

```bash
git status --short
git add ENGINE_PRODUCT
git commit -m "feat: build supplier intake pricing workflow"
```

---

## Build Notes

- The first production version should block automatic commits for `matched_needs_review`, `new_code_required`, and any price proposal with `needs_review` or `blocked`.
- Code generation for new SKUs should be a separate follow-up task after this workflow is stable. It needs sequence locking before production use.
- Google Drive credentials must stay in environment variables. Do not store service account JSON in the repository.
- Supplier RSP is not automatically trusted; it is a preferred input that still goes through margin and price-change validation.
- The changelog is the operational audit trail. Every committed cost and price change must produce at least one changelog entry.
