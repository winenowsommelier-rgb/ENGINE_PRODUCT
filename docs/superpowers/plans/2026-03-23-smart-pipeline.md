# Smart Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-pass enrichment pipeline (rule-based → Claude AI) that unblocks all 1,517 stuck products, auto-validates high-confidence ones, adds an "Ask Claude" button to the review queue, and upgrades Supabase sync.

**Architecture:** `lib/enrichment/` holds three files (rules, claude, pipeline). The pipeline orchestrator runs after every CSV import and on-demand. API routes expose pipeline control. UI components poll for progress and surface Claude suggestions inline.

**Tech Stack:** Next.js 14 App Router, TypeScript, `@anthropic-ai/sdk` (already installed), JSON file DB (`data/db/`), Tailwind CSS, Lucide React

**Spec:** `docs/superpowers/specs/2026-03-23-smart-pipeline-design.md`

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `lib/enrichment/rules.ts` | Brand/keyword lookup, returns EnrichmentResult |
| Create | `lib/enrichment/claude.ts` | Claude API batch + single enrichment |
| Create | `lib/enrichment/pipeline.ts` | Orchestrates rules → Claude → route → save |
| Create | `app/api/enrich/run/route.ts` | POST: trigger pipeline manually |
| Create | `app/api/enrich/claude-single/route.ts` | POST: on-demand single product enrichment |
| Create | `app/api/enrich/status/route.ts` | GET: pipeline progress for polling |
| Modify | `app/api/batch-process-db/route.ts` | Remove blocked logic, fire pipeline after save |
| Modify | `lib/db/client.ts` | Add pipeline-status + sync-status helpers |
| Modify | `components/pages/ProcessingReviewPage.tsx` | Add polling, progress bar, run button |
| Modify | `components/pages/TaxonomyQueuePage.tsx` | Add "Ask Claude" button + suggestion panel |
| Modify | `app/api/settings/sync/route.ts` | Add synced_at tracking, sync-status.json |

---

## Task 1: Enrichment types and rule engine

**Files:**
- Create: `lib/enrichment/rules.ts`

- [ ] **Step 1: Create `lib/enrichment/` directory and `rules.ts`**

```typescript
// lib/enrichment/rules.ts

export type EnrichmentResult = {
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  confidence: number;
  source: 'rules' | 'claude' | 'manual';
  note: string;
};

// Normalise brand/keyword for fuzzy matching
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BRAND_MAP: Array<{ patterns: string[]; country: string; confidence: number }> = [
  { patterns: ['bacardi', 'havanaclub'], country: 'Cuba', confidence: 0.95 },
  { patterns: ['jackdaniel', 'jibeam', 'makermark', 'buffalotrace', 'wildturkey', 'woodfordreserve'], country: 'USA', confidence: 0.95 },
  { patterns: ['johnniewalker', 'glenfiddich', 'macallan', 'chivas', 'laphroaig', 'glenlivet', 'balvenie', 'oban', 'talisker'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['hennessy', 'remymartin', 'courvoisier', 'martell', 'greygoo'], country: 'France', confidence: 0.95 },
  { patterns: ['patron', 'donjulio', 'josecuervo', 'espolon'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['tanqueray', 'gordons', 'beefeater', 'bombaysapphire', 'hendricks'], country: 'England', confidence: 0.90 },
  { patterns: ['absolut'], country: 'Sweden', confidence: 0.95 },
  { patterns: ['smirnoff'], country: 'Russia', confidence: 0.80 },
  { patterns: ['jameson', 'bushmills', 'tullamore'], country: 'Ireland', confidence: 0.95 },
  { patterns: ['yamazaki', 'hakushu', 'nikka', 'hibiki'], country: 'Japan', confidence: 0.95 },
];

type KeywordRule = { keyword: string; country: string; classification: string; confidence: number };
const KEYWORD_MAP: KeywordRule[] = [
  { keyword: 'champagne', country: 'France', classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'prosecco', country: 'Italy', classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'cava', country: 'Spain', classification: 'Sparkling Wine', confidence: 0.90 },
  { keyword: 'bordeaux', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'burgundy', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'bourgogne', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'barolo', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'chianti', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'brunello', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'rioja', country: 'Spain', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'cognac', country: 'France', classification: 'Brandy', confidence: 0.95 },
  { keyword: 'bourbon', country: 'USA', classification: 'Whiskey', confidence: 0.95 },
  { keyword: 'scotch', country: 'Scotland', classification: 'Whisky', confidence: 0.90 },
  { keyword: 'sake', country: 'Japan', classification: 'Rice Wine', confidence: 0.95 },
  { keyword: 'mezcal', country: 'Mexico', classification: 'Mezcal', confidence: 0.95 },
];

export function enrichWithRules(product: Record<string, any>): EnrichmentResult {
  const name = norm(String(product.name ?? ''));
  const brand = norm(String(product.brand ?? ''));

  // 1. Brand match
  for (const entry of BRAND_MAP) {
    if (entry.patterns.some(p => name.includes(p) || brand.includes(p))) {
      return {
        country: entry.country,
        confidence: entry.confidence,
        source: 'rules',
        note: `Brand match → ${entry.country}`,
      };
    }
  }

  // 2. Keyword match
  for (const rule of KEYWORD_MAP) {
    if (name.includes(rule.keyword)) {
      return {
        country: rule.country,
        classification: rule.classification,
        confidence: rule.confidence,
        source: 'rules',
        note: `Keyword "${rule.keyword}" → ${rule.country}`,
      };
    }
  }

  // 3. Category defaults (low confidence)
  const liquorType = String(product.liquor_main_type ?? '').toLowerCase();
  if (liquorType.includes('rum')) {
    return { country: 'Caribbean', confidence: 0.40, source: 'rules', note: 'Default: rum → Caribbean' };
  }

  return { confidence: 0.20, source: 'rules', note: 'No rule matched' };
}
```

- [ ] **Step 2: Verify file is syntactically valid**

```bash
/Users/admin/.nvm/versions/node/v24.14.0/bin/node node_modules/.bin/tsc --noEmit lib/enrichment/rules.ts 2>&1 | grep -v "^node_modules" | head -20
```

Expected: No errors (or only "cannot find module" errors which are fine without full Next.js context)

- [ ] **Step 3: Commit**

```bash
git add lib/enrichment/rules.ts
git commit -m "feat: add rule-based enrichment engine with brand/keyword lookup"
```

---

## Task 2: Claude enrichment module

**Files:**
- Create: `lib/enrichment/claude.ts`

- [ ] **Step 1: Create `lib/enrichment/claude.ts`**

```typescript
// lib/enrichment/claude.ts
import Anthropic from '@anthropic-ai/sdk';
import type { EnrichmentResult } from './rules';

const client = new Anthropic();

const BATCH_SIZE = 20;
const MAX_TOKENS_PER_RUN = 500_000;

export type ClaudeEnrichmentProgress = {
  tokensUsed: number;
  budgetExceeded: boolean;
};

type ProductInput = {
  sku: string;
  name: string;
  wine_type?: string;
  liquor_main_type?: string;
  current_country?: string;
  current_region?: string;
};

type ClaudeProductResult = {
  sku: string;
  country: string;
  region: string;
  subregion: string;
  classification: string;
  grape_variety: string;
  confidence: number;
  source_note: string;
};

async function enrichBatch(
  products: ProductInput[],
  progress: ClaudeEnrichmentProgress
): Promise<Map<string, EnrichmentResult>> {
  const results = new Map<string, EnrichmentResult>();

  if (progress.budgetExceeded) return results;

  const prompt = `You are a wine and spirits product data expert.

For each product below, fill in missing taxonomy fields using your knowledge.
Return ONLY a valid JSON array — no prose, no markdown, no code fences.

Products:
${JSON.stringify(products)}

For each product return exactly:
{"sku":"string","country":"string or empty","region":"string or empty","subregion":"string or empty","classification":"string or empty","grape_variety":"string or empty","confidence":0.0,"source_note":"brief explanation"}`;

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      progress.tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
      if (progress.tokensUsed > MAX_TOKENS_PER_RUN) progress.budgetExceeded = true;

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      // Strip any accidental markdown fences
      const clean = text.replace(/```[a-z]*\n?/g, '').trim();
      const parsed: ClaudeProductResult[] = JSON.parse(clean);

      for (const item of parsed) {
        results.set(item.sku, {
          country: item.country || undefined,
          region: item.region || undefined,
          subregion: item.subregion || undefined,
          classification: item.classification || undefined,
          grape_variety: item.grape_variety || undefined,
          confidence: item.confidence,
          source: 'claude',
          note: item.source_note,
        });
      }
      return results;
    } catch (err) {
      attempt++;
      if (attempt >= 3) {
        console.error(`Claude batch failed after 3 attempts:`, err);
        return results; // return empty — products stay in queue for manual review
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return results;
}

export async function enrichBatchWithClaude(
  products: Array<Record<string, any>>,
  progress: ClaudeEnrichmentProgress,
  onBatchDone?: (done: number, total: number) => void
): Promise<Map<string, EnrichmentResult>> {
  const allResults = new Map<string, EnrichmentResult>();
  const inputs: ProductInput[] = products.map(p => ({
    sku: String(p.sku ?? ''),
    name: String(p.name ?? ''),
    wine_type: String(p.wine_type ?? ''),
    liquor_main_type: String(p.liquor_main_type ?? ''),
    current_country: String(p.country ?? ''),
    current_region: String(p.region ?? ''),
  }));

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    if (progress.budgetExceeded) break;
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const batchResults = await enrichBatch(batch, progress);
    batchResults.forEach((v, k) => allResults.set(k, v));
    onBatchDone?.(Math.min(i + BATCH_SIZE, inputs.length), inputs.length);
  }

  return allResults;
}

export async function enrichSingleWithClaude(product: Record<string, any>): Promise<EnrichmentResult | { error: string; raw_response?: string }> {
  const input: ProductInput = {
    sku: String(product.sku ?? ''),
    name: String(product.name ?? ''),
    wine_type: String(product.wine_type ?? ''),
    liquor_main_type: String(product.liquor_main_type ?? ''),
    current_country: String(product.country ?? ''),
    current_region: String(product.region ?? ''),
  };

  try {
    const progress: ClaudeEnrichmentProgress = { tokensUsed: 0, budgetExceeded: false };
    const results = await enrichBatch([input], progress);
    const result = results.get(input.sku);
    if (!result) return { error: 'Claude returned no result for this product' };
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API error' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/enrichment/claude.ts
git commit -m "feat: add Claude AI enrichment module with batch and single-product modes"
```

---

## Task 3: DB helpers for pipeline state

**Files:**
- Modify: `lib/db/client.ts` (add to bottom of file)
- Create: `data/db/pipeline-status.json`
- Create: `data/db/sync-status.json`

- [ ] **Step 1: Create initial state files**

Create `data/db/pipeline-status.json`:
```json
{
  "status": "idle",
  "migration_done": false,
  "current_step": null,
  "progress": { "done": 0, "total": 0 },
  "tokens_used": 0,
  "last_run": null,
  "last_summary": null
}
```

Create `data/db/sync-status.json`:
```json
{
  "last_synced_at": null,
  "last_synced_count": 0
}
```

- [ ] **Step 2: Add DB helpers to `lib/db/client.ts`**

Append to the bottom of `lib/db/client.ts`:

```typescript
// ─── Pipeline status ────────────────────────────────────────────────────────

const pipelineStatusFile = path.join(dbDir, 'pipeline-status.json');
const syncStatusFile = path.join(dbDir, 'sync-status.json');

export type PipelineStatus = {
  status: 'idle' | 'running' | 'error';
  migration_done: boolean;
  current_step: string | null;
  progress: { done: number; total: number };
  tokens_used: number;
  last_run: string | null;
  last_summary: Record<string, any> | null;
};

export async function getPipelineStatus(): Promise<PipelineStatus> {
  try {
    if (fs.existsSync(pipelineStatusFile)) {
      return JSON.parse(await readFile(pipelineStatusFile, 'utf-8'));
    }
  } catch {}
  return { status: 'idle', migration_done: false, current_step: null, progress: { done: 0, total: 0 }, tokens_used: 0, last_run: null, last_summary: null };
}

export async function savePipelineStatus(status: Partial<PipelineStatus>): Promise<void> {
  const current = await getPipelineStatus();
  const next = { ...current, ...status };
  const tmp = pipelineStatusFile + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, pipelineStatusFile);
}

export type SyncStatus = { last_synced_at: string | null; last_synced_count: number };

export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    if (fs.existsSync(syncStatusFile)) {
      return JSON.parse(await readFile(syncStatusFile, 'utf-8'));
    }
  } catch {}
  return { last_synced_at: null, last_synced_count: 0 };
}

export async function saveSyncStatus(s: SyncStatus): Promise<void> {
  await writeFile(syncStatusFile, JSON.stringify(s, null, 2), 'utf-8');
}

// Batch-write enrichment fields back to products (atomic rename)
export async function batchUpdateEnrichment(
  updates: Array<{
    id: string;
    enrichment_source?: string;
    enrichment_note?: string;
    claude_enriched_at?: string;
    country?: string;
    region?: string;
    subregion?: string;
    classification?: string;
    grape_variety?: string;
    overall_confidence?: number;
    taxonomy_confidence?: number;
    validation_status?: string;
  }>
): Promise<void> {
  const products = await readProducts();
  const map = new Map(products.map(p => [p.id, p]));
  for (const u of updates) {
    const existing = map.get(u.id);
    if (!existing) continue;
    map.set(u.id, { ...existing, ...u, updated_at: new Date().toISOString() });
  }
  const next = Array.from(map.values());
  const tmp = productsFile + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, productsFile);
}
```

- [ ] **Step 3: Commit**

```bash
git add data/db/pipeline-status.json data/db/sync-status.json lib/db/client.ts
git commit -m "feat: add pipeline-status and sync-status DB helpers with atomic writes"
```

---

## Task 4: Pipeline orchestrator

**Files:**
- Create: `lib/enrichment/pipeline.ts`

- [ ] **Step 1: Create `lib/enrichment/pipeline.ts`**

```typescript
// lib/enrichment/pipeline.ts
import { enrichWithRules } from './rules';
import { enrichBatchWithClaude, type ClaudeEnrichmentProgress } from './claude';
import {
  readProducts,
  batchUpdateEnrichment,
  getPipelineStatus,
  savePipelineStatus,
} from '@/lib/db/client';

export const AUTO_VALIDATE_THRESHOLD = 0.75;
export const NEEDS_ATTENTION_THRESHOLD = 0.40;

export type PipelineSummary = {
  enriched: number;
  autoValidated: number;
  sentToQueue: number;
  needsAttention: number;
  tokensUsed: number;
  errors: number;
};

export type PipelineOptions = {
  productIds?: string[];
  forceReEnrich?: boolean;
};

export async function runEnrichmentPipeline(options: PipelineOptions = {}): Promise<PipelineSummary> {
  const { productIds, forceReEnrich = false } = options;

  await savePipelineStatus({ status: 'running', current_step: 'loading', progress: { done: 0, total: 0 }, tokens_used: 0 });

  try {
    const status = await getPipelineStatus();

    // Load products to process
    let allProducts = await readProducts();

    // Include blocked products on first migration run
    const includeBlocked = !status.migration_done;

    let targets = productIds
      ? allProducts.filter(p => productIds.includes(p.id))
      : allProducts.filter(p => {
          const vs = p.validation_status;
          if (includeBlocked && vs === 'blocked') return true;
          return vs === 'needs_review' || vs === 'needs_attention' || !vs;
        });

    // Skip already Claude-enriched unless forceReEnrich
    if (!forceReEnrich) {
      targets = targets.filter(p => !p.claude_enriched_at);
    }

    await savePipelineStatus({ current_step: 'rule_enrichment', progress: { done: 0, total: targets.length } });

    // Pass 1: Rule enrichment (in memory)
    const ruleUpdates: Parameters<typeof batchUpdateEnrichment>[0] = [];
    const needsClaudeIds = new Set<string>();

    for (const p of targets) {
      // If product already has country from previous import, keep it if confidence is ok
      const existingConf = p.overall_confidence ?? 0;
      if (existingConf >= AUTO_VALIDATE_THRESHOLD && !forceReEnrich) {
        ruleUpdates.push({
          id: p.id,
          validation_status: 'validated',
          enrichment_source: p.enrichment_source ?? 'rules',
        });
        continue;
      }

      const result = enrichWithRules(p);
      const maxConf = Math.max(result.confidence, existingConf);

      const update: Parameters<typeof batchUpdateEnrichment>[0][0] = {
        id: p.id,
        enrichment_source: result.confidence > existingConf ? result.source : (p.enrichment_source ?? 'rules'),
        enrichment_note: result.note,
        overall_confidence: maxConf,
        taxonomy_confidence: maxConf,
      };

      if (result.country && (!p.country || p.country === '')) update.country = result.country;
      if (result.classification && !p.classification) update.classification = result.classification;

      if (maxConf >= AUTO_VALIDATE_THRESHOLD) {
        update.validation_status = 'validated';
      } else {
        needsClaudeIds.add(p.id);
      }

      ruleUpdates.push(update);
    }

    // Batch write rule results
    if (ruleUpdates.length > 0) await batchUpdateEnrichment(ruleUpdates);

    // Pass 2: Claude enrichment for unresolved products
    const needsClaudeProducts = targets.filter(p => needsClaudeIds.has(p.id));
    const progress: ClaudeEnrichmentProgress = { tokensUsed: 0, budgetExceeded: false };
    const claudeUpdates: Parameters<typeof batchUpdateEnrichment>[0] = [];
    let done = 0;

    await savePipelineStatus({ current_step: 'claude_enrichment', progress: { done: 0, total: needsClaudeProducts.length } });

    const claudeResults = await enrichBatchWithClaude(
      needsClaudeProducts,
      progress,
      (batchDone, total) => {
        done = batchDone;
        savePipelineStatus({ progress: { done, total }, tokens_used: progress.tokensUsed });
      }
    );

    const now = new Date().toISOString();
    for (const p of needsClaudeProducts) {
      const cr = claudeResults.get(p.sku);
      if (!cr) continue;

      const existingConf = p.overall_confidence ?? 0;
      const maxConf = Math.max(cr.confidence, existingConf);

      const update: Parameters<typeof batchUpdateEnrichment>[0][0] = {
        id: p.id,
        enrichment_source: cr.confidence > existingConf ? 'claude' : (p.enrichment_source ?? 'rules'),
        enrichment_note: cr.note,
        claude_enriched_at: now,
        overall_confidence: maxConf,
        taxonomy_confidence: maxConf,
      };

      if (cr.country && (!p.country || p.country === '')) update.country = cr.country;
      if (cr.region && !p.region) update.region = cr.region;
      if (cr.subregion && !p.subregion) update.subregion = cr.subregion;
      if (cr.classification && !p.classification) update.classification = cr.classification;
      if (cr.grape_variety && !p.grape_variety) update.grape_variety = cr.grape_variety;

      if (maxConf >= AUTO_VALIDATE_THRESHOLD) {
        update.validation_status = 'validated';
      } else if (maxConf >= NEEDS_ATTENTION_THRESHOLD) {
        update.validation_status = 'needs_review';
      } else {
        update.validation_status = 'needs_attention';
      }

      claudeUpdates.push(update);
    }

    // Batch write Claude results
    if (claudeUpdates.length > 0) await batchUpdateEnrichment(claudeUpdates);

    // Build summary from final state
    const finalProducts = await readProducts();
    const summary: PipelineSummary = {
      enriched: ruleUpdates.length + claudeUpdates.length,
      autoValidated: finalProducts.filter(p => p.validation_status === 'validated').length,
      sentToQueue: finalProducts.filter(p => p.validation_status === 'needs_review').length,
      needsAttention: finalProducts.filter(p => p.validation_status === 'needs_attention').length,
      tokensUsed: progress.tokensUsed,
      errors: 0,
    };

    await savePipelineStatus({
      status: 'idle',
      migration_done: true,
      current_step: null,
      progress: { done: targets.length, total: targets.length },
      tokens_used: progress.tokensUsed,
      last_run: now,
      last_summary: summary,
    });

    return summary;
  } catch (err) {
    await savePipelineStatus({ status: 'error', current_step: null });
    throw err;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/enrichment/pipeline.ts
git commit -m "feat: add pipeline orchestrator (rules → Claude → auto-validate)"
```

---

## Task 5: New API routes for pipeline control

**Files:**
- Create: `app/api/enrich/run/route.ts`
- Create: `app/api/enrich/claude-single/route.ts`
- Create: `app/api/enrich/status/route.ts`

- [ ] **Step 1: Create `app/api/enrich/run/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { runEnrichmentPipeline } from '@/lib/enrichment/pipeline';
import { getPipelineStatus } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const status = await getPipelineStatus();
    if (status.status === 'running') {
      return NextResponse.json({ error: 'Pipeline already running' }, { status: 409 });
    }
    const body = await req.json().catch(() => ({}));
    // Run in background — don't await
    runEnrichmentPipeline({ productIds: body.productIds, forceReEnrich: body.forceReEnrich })
      .catch(console.error);
    return NextResponse.json({ started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `app/api/enrich/claude-single/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { enrichSingleWithClaude } from '@/lib/enrichment/claude';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.sku || !body.name) {
      return NextResponse.json({ error: 'sku and name are required' }, { status: 400 });
    }
    const result = await enrichSingleWithClaude(body);
    if ('error' in result) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json({ suggestions: result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Claude API error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `app/api/enrich/status/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getPipelineStatus } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET() {
  const status = await getPipelineStatus();
  return NextResponse.json(status);
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/enrich/
git commit -m "feat: add /api/enrich/run, /claude-single, /status routes"
```

---

## Task 6: Fix batch-process-db ingest route

**Files:**
- Modify: `app/api/batch-process-db/route.ts`

Current problem: Line 84 still maps `row.status === 'ready'` → `'validated'` and `row.status === 'blocked'` → `'blocked'`. Must be changed so ALL rows save as `needs_review` and pipeline fires after.

- [ ] **Step 1: Open `app/api/batch-process-db/route.ts` and update the POST handler**

Replace the `for (const row of batchResult.rows)` section. The new save call removes the validation_status mapping and always uses `'needs_review'`:

Find this line (around line 84):
```typescript
validation_status: row.status === 'ready' ? 'validated' : row.status === 'blocked' ? 'blocked' : 'needs_review',
```

Replace it with:
```typescript
validation_status: 'needs_review',
```

- [ ] **Step 2: Add pipeline fire-and-forget after the save loop**

After the `saveBatchLog` call and before the `return NextResponse.json(...)`, add:

```typescript
    // Fire enrichment pipeline in background — don't block response
    import('@/lib/enrichment/pipeline').then(({ runEnrichmentPipeline }) => {
      runEnrichmentPipeline().catch(console.error);
    });
```

- [ ] **Step 3: Update the success response to include enrichmentStarted**

Change:
```typescript
    return NextResponse.json({
      success: true,
      batch_id: logId,
      stats,
      saved: successCount,
      issues: issueCount,
      message: `Successfully processed and saved ${successCount} products to database`,
    });
```

To:
```typescript
    return NextResponse.json({
      success: true,
      batch_id: logId,
      stats,
      saved: successCount,
      issues: issueCount,
      enrichmentStarted: true,
      message: `Saved ${successCount} products. Enrichment pipeline started in background.`,
    });
```

- [ ] **Step 4: Commit**

```bash
git add app/api/batch-process-db/route.ts
git commit -m "fix: save all imports as needs_review, fire enrichment pipeline after save"
```

---

## Task 7: Upgrade ProcessingReviewPage with live progress

**Files:**
- Modify: `components/pages/ProcessingReviewPage.tsx`

- [ ] **Step 1: Rewrite `components/pages/ProcessingReviewPage.tsx`**

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

type Stats = { total: number; validated: number; needs_review: number; needs_attention: number; blocked: number };
type PipelineStatus = {
  status: 'idle' | 'running' | 'error';
  current_step: string | null;
  progress: { done: number; total: number };
  tokens_used: number;
  last_run: string | null;
  last_summary: Record<string, any> | null;
};

export function ProcessingReviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadAll() {
    const [s, l, p] = await Promise.all([
      fetch('/api/batch-process-db?action=stats').then(r => r.json()),
      fetch('/api/batch-process-db?action=logs').then(r => r.json()),
      fetch('/api/enrich/status').then(r => r.json()),
    ]);
    setStats(s);
    setLogs(l.logs ?? []);
    setPipeline(p);
    return p as PipelineStatus;
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const p = await fetch('/api/enrich/status').then(r => r.json()) as PipelineStatus;
      setPipeline(p);
      // Also refresh stats when pipeline goes idle
      if (p.status !== 'running') {
        stopPolling();
        setRunning(false);
        const s = await fetch('/api/batch-process-db?action=stats').then(r => r.json());
        setStats(s);
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => {
    loadAll().then(p => { if (p.status === 'running') { setRunning(true); startPolling(); } });
    return stopPolling;
  }, []);

  async function handleRunPipeline() {
    setRunning(true);
    await fetch('/api/enrich/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    startPolling();
  }

  const pct = pipeline && pipeline.progress.total > 0
    ? Math.round((pipeline.progress.done / pipeline.progress.total) * 100)
    : 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Processing Review</h1>
        <button
          onClick={handleRunPipeline}
          disabled={running}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Play size={14} />
          {running ? 'Running…' : 'Run Enrichment'}
        </button>
      </div>

      {/* Pipeline progress */}
      {pipeline?.status === 'running' && (
        <div className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-xl p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-violet-300">{pipeline.current_step?.replace(/_/g, ' ') ?? 'Processing…'}</span>
            <span className="text-violet-300">{pipeline.progress.done} / {pipeline.progress.total}</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div className="bg-violet-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {pipeline.tokens_used > 0 && (
            <p className="text-xs text-slate-500 mt-2">Tokens used: {pipeline.tokens_used.toLocaleString()}</p>
          )}
        </div>
      )}

      {/* Last run summary */}
      {pipeline?.last_summary && pipeline.status !== 'running' && (
        <div className="mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-2">Last enrichment run — {pipeline.last_run ? new Date(pipeline.last_run).toLocaleString() : '—'}</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Auto-validated', value: pipeline.last_summary.autoValidated },
              { label: 'In queue', value: pipeline.last_summary.sentToQueue },
              { label: 'Needs attention', value: pipeline.last_summary.needsAttention },
              { label: 'Tokens used', value: (pipeline.last_summary.tokensUsed ?? 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Total', value: stats.total },
            { label: 'Validated', value: stats.validated },
            { label: 'Needs review', value: stats.needs_review },
            { label: 'Needs attention', value: stats.needs_attention },
            { label: 'Blocked (legacy)', value: stats.blocked },
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

- [ ] **Step 2: Commit**

```bash
git add components/pages/ProcessingReviewPage.tsx
git commit -m "feat: add pipeline progress bar and Run Enrichment button to ProcessingReviewPage"
```

---

## Task 8: Add "Ask Claude" to Taxonomy Queue

**Files:**
- Modify: `components/pages/TaxonomyQueuePage.tsx`

- [ ] **Step 1: Add Claude state and handler to the component**

After the existing state declarations (after line 29, before the `useEffect`), add:

```typescript
  const [claudeSuggestions, setClaudeSuggestions] = useState<Record<string, any> | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeNote, setClaudeNote] = useState<string>('');
```

Add the handler function after `handleValidateOne`:

```typescript
  async function handleAskClaude() {
    if (!panelProduct) return;
    setClaudeLoading(true);
    setClaudeSuggestions(null);
    try {
      const res = await fetch('/api/enrich/claude-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: panelProduct.id,
          sku: panelProduct.sku,
          name: panelProduct.name,
          wine_type: panelProduct.wine_type,
          liquor_main_type: panelProduct.liquor_main_type,
          country: panelProduct.country,
          region: panelProduct.region,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setClaudeNote(`Error: ${json.error}`);
      } else {
        setClaudeSuggestions(json.suggestions);
        setClaudeNote(json.suggestions?.note ?? '');
      }
    } catch {
      setClaudeNote('Claude API unavailable. Try again.');
    } finally {
      setClaudeLoading(false);
    }
  }

  function acceptClaudeSuggestion(field: string, value: string) {
    setLocalFields(prev => ({ ...prev, [field]: value }));
    setClaudeSuggestions(prev => prev ? { ...prev, [field]: undefined } : null);
  }

  function acceptAllClaudeSuggestions() {
    if (!claudeSuggestions) return;
    const fields: Record<string, string> = {};
    const MAPPABLE = ['country', 'region', 'subregion', 'classification', 'grape_variety'];
    for (const f of MAPPABLE) {
      if (claudeSuggestions[f]) fields[f] = claudeSuggestions[f];
    }
    setLocalFields(prev => ({ ...prev, ...fields }));
    setClaudeSuggestions(null);
  }
```

- [ ] **Step 2: Reset Claude state when panel opens/closes**

In `openPanel`, add after `setPanelProduct(p)`:
```typescript
    setClaudeSuggestions(null);
    setClaudeNote('');
```

In `closePanel`, add:
```typescript
    setClaudeSuggestions(null);
    setClaudeNote('');
```

- [ ] **Step 3: Add "Ask Claude" section to the panel JSX**

In the panel, after the `<div className="space-y-3 mb-6">` fields block and before the Validate button, add:

```tsx
          {/* Ask Claude section */}
          <div className="border border-white/10 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-slate-300">Claude AI Assist</p>
              <button
                onClick={handleAskClaude}
                disabled={claudeLoading}
                className="text-xs bg-violet-600/30 hover:bg-violet-600/50 disabled:opacity-50 text-violet-300 px-3 py-1 rounded-lg transition-colors"
              >
                {claudeLoading ? 'Asking…' : '✦ Ask Claude'}
              </button>
            </div>

            {claudeNote && (
              <p className="text-xs text-slate-500 mb-3 italic">{claudeNote}</p>
            )}

            {claudeSuggestions && (
              <div className="space-y-2">
                {(['country', 'region', 'subregion', 'classification', 'grape_variety'] as const).map(field => {
                  const val = claudeSuggestions[field];
                  if (!val) return null;
                  return (
                    <div key={field} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{field}: <span className="text-white">{val}</span></span>
                      <button
                        onClick={() => acceptClaudeSuggestion(field, val)}
                        className="text-emerald-400 hover:text-emerald-300 ml-2"
                      >
                        Accept
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={acceptAllClaudeSuggestions}
                  className="w-full text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 py-1.5 rounded-lg transition-colors mt-1"
                >
                  Accept all suggestions
                </button>
              </div>
            )}
          </div>
```

- [ ] **Step 4: Add enrichment note display to table row and panel header**

In the table, add a column header "Source" after "Status", and in each `<tr>` add:
```tsx
<td className="px-4 py-3 text-xs text-slate-500">{p.enrichment_source ?? '—'}</td>
```

In the panel header area (after the name display), add:
```tsx
          {panelProduct.enrichment_note && (
            <p className="text-xs text-slate-500 mt-2 italic">
              {panelProduct.enrichment_source === 'claude' ? '✦ ' : ''}{panelProduct.enrichment_note}
            </p>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add components/pages/TaxonomyQueuePage.tsx
git commit -m "feat: add Ask Claude button and suggestion panel to Taxonomy Queue"
```

---

## Task 9: Upgrade Supabase sync

**Files:**
- Modify: `app/api/settings/sync/route.ts`

- [ ] **Step 1: Rewrite `app/api/settings/sync/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getCleanedProducts, batchUpdateEnrichment, getSyncStatus, saveSyncStatus } from '@/lib/db/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const runtime = 'nodejs';

export async function GET() {
  const s = await getSyncStatus();
  return NextResponse.json(s);
}

export async function POST() {
  try {
    const products = await getCleanedProducts({ validation_status: 'validated' });
    if (products.length === 0) return NextResponse.json({ synced: 0, message: 'No validated products to sync' });

    const client = createSupabaseBrowserClient();
    const rows = products.map(p => ({
      sku: p.sku,
      name: p.name,
      country: p.country,
      region: p.region,
      subregion: p.subregion,
      classification: p.classification,
      grape_variety: p.grape_variety,
      wine_type: p.wine_type,
      liquor_main_type: p.liquor_main_type,
      price: p.price,
      cost_price: p.cost,
      currency: p.currency,
      overall_confidence: p.overall_confidence,
      validation_status: p.validation_status,
      flavor_profile: p.flavor_profile,
      brand: p.brand,
      vintage: p.vintage,
      alcohol: p.alcohol,
      bottle_size: p.bottle_size,
      enrichment_source: p.enrichment_source,
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

    // Mark all synced products with synced_at timestamp
    const now = new Date().toISOString();
    await batchUpdateEnrichment(products.map(p => ({ id: p.id, synced_at: now })));
    await saveSyncStatus({ last_synced_at: now, last_synced_count: rows.length });

    return NextResponse.json({ synced: rows.length, timestamp: now });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update SettingsPage to show sync status**

In `components/pages/SettingsPage.tsx`, find the Supabase sync section and add a `GET /api/settings/sync` call on mount to show last sync time. Add to the sync button area:

```tsx
{syncStatus && (
  <p className="text-xs text-slate-500 mt-1">
    Last synced: {syncStatus.last_synced_at
      ? `${new Date(syncStatus.last_synced_at).toLocaleString()} — ${syncStatus.last_synced_count} products`
      : 'Never'}
  </p>
)}
```

And fetch it in a `useEffect`:
```typescript
const [syncStatus, setSyncStatus] = useState<{last_synced_at: string|null; last_synced_count: number}|null>(null);
useEffect(() => { fetch('/api/settings/sync').then(r=>r.json()).then(setSyncStatus); }, []);
```

- [ ] **Step 3: Commit**

```bash
git add app/api/settings/sync/route.ts components/pages/SettingsPage.tsx
git commit -m "feat: upgrade Supabase sync with synced_at tracking and sync-status.json"
```

---

## Task 10: TypeScript check and push

**Files:** All modified files

- [ ] **Step 1: Run TypeScript check**

```bash
/Users/admin/.nvm/versions/node/v24.14.0/bin/node node_modules/.bin/tsc --noEmit 2>&1 | grep -v "^app/api/gsc\|^app/api/site-health\|^app/api/ga4\|^app/api/aeo\|^app/api/competitors\|^app/api/summary" | grep "error TS" | head -30
```

Expected: No errors (the SEO routes have pre-existing errors unrelated to this work).

- [ ] **Step 2: Fix any new TS errors found**

Common patterns to check:
- `batchUpdateEnrichment` receives the `synced_at` field — ensure `CleanedProduct` interface in `lib/db/client.ts` allows `[key: string]: any` (it already does via the existing interface)
- Claude module uses `@anthropic-ai/sdk` — verify import resolves

- [ ] **Step 3: Push to origin**

```bash
git push origin main
```

- [ ] **Step 4: Verify in browser**

1. Go to Processing Review page → click "Run Enrichment" → watch progress bar fill
2. After pipeline finishes → check stats: some products should show as validated
3. Go to Taxonomy Queue → open any product → click "✦ Ask Claude" → verify suggestions appear
4. Go to Settings → click Sync → verify "Last synced" appears

---

## Notes for the implementor

- **Node binary:** Use `/Users/admin/.nvm/versions/node/v24.14.0/bin/node` for all node/tsc commands
- **Anthropic API key:** Must be set as `ANTHROPIC_API_KEY` env var — check `.env.local`
- **Pre-existing TS errors:** `app/api/gsc/`, `app/api/site-health/`, `app/api/ga4/`, `app/api/aeo/` all have pre-existing errors from SEO routes — ignore these
- **products.json:** 1,517 products currently all have `validation_status: 'blocked'` — after Task 6, new imports save as `needs_review`; after running pipeline (Task 7), blocked products get re-processed
- **Cost estimate:** 1,517 products in batches of 20 ≈ 76 Claude API calls ≈ ~150k tokens ≈ ~$0.45 USD at Sonnet pricing
