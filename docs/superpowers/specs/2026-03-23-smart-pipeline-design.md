# Smart Pipeline Design Spec
# WineNow PIM — Import → Enrich → Validate → Sync

**Goal:** Build a complete, mostly-automatic product pipeline: CSV import → rule-based enrichment → Claude AI enrichment → auto-validation → human review queue → Supabase sync. Manual effort limited to genuinely ambiguous products only.

**Architecture:** Two-pass enrichment (rules first, Claude second) feeds a confidence-based router. High-confidence products auto-validate. Low-confidence go to a review queue with Claude on-demand assist. Validated products sync to Supabase.

**Tech Stack:** Next.js 14 App Router, TypeScript, JSON file DB (`data/db/`), Claude API (`claude-sonnet-4-6`), Supabase REST API, Tailwind CSS, Lucide React

---

## 1. Pipeline Flow

```
CSV Upload (ImportPage)
  ↓
Ingest  →  ALL rows saved as needs_review (nothing blocked ever)
  ↓
Rule Enrichment  →  Brand/keyword lookup fills obvious gaps instantly (synchronous, free)
  ↓
Claude Enrichment  →  Batches of 20 unresolved products sent to Claude API
                       Claude fills missing fields using product knowledge
  ↓
Score + Route
  ≥ 0.75 confidence  →  validation_status = validated  (auto, no human needed)
  0.40–0.74           →  validation_status = needs_review  (queue)
  < 0.40              →  validation_status = needs_attention  (queue, highlighted amber)
  ↓
Taxonomy Queue  →  Human review with "Ask Claude" on-demand button
  ↓
Supabase Sync  →  Push all validated products (full resync of validated set)
```

### 1.1 Status Enum Migration

The existing code uses `status: 'ready' | 'review' | 'blocked'` internally in `batch-processor.ts`. The DB field `validation_status` is what persists. Migration mapping:

| Old validation_status | New validation_status |
|---|---|
| `blocked` | re-process through enrichment pipeline; result replaces old status |
| `validated` | keep as `validated` |
| `needs_review` | keep as `needs_review` |
| *(any other)* | treat as `needs_review` |

**`blocked` is retired as a persisted status.** After migration it will not appear in the DB. The batch-processor internal `status` field is still used during processing but is never written to DB directly — only `validation_status` is saved.

### 1.2 Initial Migration (one-time)

`pipeline-status.json` includes a `migration_done: boolean` flag. On the first `runEnrichmentPipeline()` call, if `migration_done === false`, all `blocked` products are included in the enrichment run. After completion, `migration_done` is set to `true`. Subsequent runs only process `needs_review` and `needs_attention` products.

---

## 2. Rule-Based Enrichment Engine

**File:** `lib/enrichment/rules.ts`

### Brand → Country map (~200 entries)

Fuzzy matching: strip punctuation and normalise case before lookup. "Jack Daniel's", "Jack Daniels", "Jack daniel" all match the same entry.

| Brand pattern | Country | Confidence |
|---|---|---|
| bacardi, havana club | Cuba | 0.95 |
| jack daniel, jim beam, maker's mark, buffalo trace | USA | 0.95 |
| johnnie walker, glenfiddich, macallan, chivas, laphroaig | Scotland | 0.95 |
| hennessy, remy martin, courvoisier, martell | France | 0.95 |
| patron, don julio, jose cuervo | Mexico | 0.95 |
| tanqueray, gordon's, beefeater | England | 0.90 |
| absolut | Sweden | 0.95 |
| grey goose | France | 0.95 |
| bombay sapphire | England | 0.95 |
| *(extend as catalog grows)* | | |

### Name keyword → Country + Classification

| Keyword in product name | Country | Classification | Confidence |
|---|---|---|---|
| champagne | France | Sparkling Wine | 0.95 |
| prosecco | Italy | Sparkling Wine | 0.95 |
| cava | Spain | Sparkling Wine | 0.90 |
| bordeaux | France | Red/White Wine | 0.90 |
| burgundy / bourgogne | France | Red/White Wine | 0.90 |
| barolo / chianti / brunello | Italy | Red Wine | 0.90 |
| rioja | Spain | Red Wine | 0.90 |
| cognac | France | Brandy | 0.95 |
| bourbon | USA | Whiskey | 0.95 |
| scotch | Scotland | Whiskey | 0.90 |
| sake | Japan | Rice Wine | 0.95 |
| mezcal | Mexico | Mezcal | 0.95 |

### Category defaults (last resort, low confidence)
- `liquor_main_type = Rum`, no country → Caribbean, 0.40
- `wine_type = Red Wine`, no country → Unknown, 0.30

### Confidence merging

When rule enrichment fills a field, it sets `enrichment_source = 'rules'` and records its confidence. The final confidence stored on the product is:
```
final_confidence = max(rule_confidence, claude_confidence)
```
`enrichment_source` reflects whichever source produced the higher confidence. If Claude runs after rules and achieves higher confidence, `enrichment_source` becomes `'claude'`.

### Output type
```typescript
type EnrichmentResult = {
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  confidence: number;       // 0.0–1.0
  source: 'rules' | 'claude' | 'manual';
  note: string;             // human-readable explanation
}
```

---

## 3. Claude AI Enrichment

**File:** `lib/enrichment/claude.ts`

### 3.1 Batch enrichment (automatic, pipeline)

Called for products where `confidence < 0.75` after rule enrichment.

**Batch size:** 20 products per API call.

**Cost control:**
- Skip products where `claude_enriched_at` is set (already done) unless explicitly re-triggered
- Skip products with no name
- Each batch call logs `tokens_used` to `pipeline-status.json`
- Hard budget cap: if cumulative `tokens_used` in current run exceeds 500,000 tokens, pause and log warning — do not abort, just stop sending new batches
- Retry on failure: exponential backoff, max 3 retries per batch; after 3 failures log the batch as skipped and continue with remaining batches

**Prompt template:**
```
You are a wine and spirits product data expert.

For each product below, fill in missing taxonomy fields using your knowledge.
Return ONLY a valid JSON array — no prose, no markdown fences.

Products:
[{ sku, name, wine_type, liquor_main_type, current_country, current_region }]

For each product return:
{
  "sku": "string",
  "country": "string or empty string",
  "region": "string or empty string",
  "subregion": "string or empty string",
  "classification": "string or empty string",
  "grape_variety": "string or empty string",
  "confidence": 0.0 to 1.0,
  "source_note": "brief explanation"
}
```

**Error handling per batch:**
- If Claude returns invalid JSON: log error, mark all products in batch as `enrichment_source = null`, keep them in queue for manual review
- If Claude returns partial array (fewer items than sent): match by `sku`, apply results for matched products, skip unmatched
- Never throw — always return a result object even if empty

### 3.2 On-demand enrichment (Taxonomy Queue)

**Endpoint:** `POST /api/enrich/claude-single`
**Request:** `{ product_id, sku, name, wine_type, liquor_main_type }`
**Response:** `{ suggestions: EnrichmentResult, raw_response: string }`

**Error handling:**
- Invalid JSON from Claude → return `{ error: 'Claude returned invalid data', raw_response }` — UI shows error toast
- API failure → return `{ error: 'Claude API unavailable' }` — UI shows retry button
- Rapid double-click: debounce 1 second on client; server is idempotent (same product re-enriched is fine)

**No per-user cost limit** for now (single-user system). Add when multi-user is built.

---

## 4. Enrichment Pipeline Orchestrator

**File:** `lib/enrichment/pipeline.ts`

```typescript
type PipelineOptions = {
  productIds?: string[];   // if omitted, processes all needs_review + needs_attention
  forceReEnrich?: boolean; // re-run Claude even if claude_enriched_at is set
}

type PipelineSummary = {
  enriched: number;
  autoValidated: number;
  sentToQueue: number;
  needsAttention: number;
  tokensUsed: number;
  errors: number;
}

async function runEnrichmentPipeline(options?: PipelineOptions): Promise<PipelineSummary>
```

**Execution steps:**
1. Write `pipeline-status.json` with `status: 'running'`
2. If `migration_done === false`: load all `blocked` products too
3. Apply rule enrichment to each product in memory (no DB writes yet)
4. Batch-write all rule-enriched products to `products.json` in one write (not per-product)
5. Collect products still below 0.75 confidence → send to Claude in batches of 20
6. After each Claude batch: accumulate results in memory
7. After all Claude batches: batch-write all Claude-enriched products to `products.json` in one write
8. Route: update `validation_status` based on final confidence for all affected products — one final batch write
9. Write final `pipeline-status.json` with `status: 'idle'`, summary, and `migration_done: true`

**File write strategy:** All writes to `products.json` are done as atomic rename (write to temp file, rename to final). Minimum 3 writes per pipeline run regardless of product count — no per-product writes.

**Triggered by:**
- Automatically after CSV import (POST /api/batch-process-db, fire-and-forget)
- Manually via POST /api/enrich/run

**Progress updates:** `pipeline-status.json` is updated after each Claude batch completes (not per product).

---

## 5. API Routes

### POST /api/batch-process-db (modify existing)
- Save all rows as `needs_review` (remove all blocking logic)
- Fire-and-forget: call `runEnrichmentPipeline()` without awaiting
- Return immediately: `{ saved: N, enrichmentStarted: true }`

### POST /api/enrich/run (new)
- Body: `{ productIds?: string[], forceReEnrich?: boolean }`
- Calls `runEnrichmentPipeline(options)`
- Returns pipeline summary

### POST /api/enrich/claude-single (new)
- Body: `{ product_id, sku, name, wine_type, liquor_main_type }`
- Returns `{ suggestions: EnrichmentResult } | { error: string, raw_response?: string }`

### GET /api/enrich/status (new)
- Returns contents of `pipeline-status.json`
- Used by ProcessingReviewPage for polling (client polls every 3s while status = 'running')

---

## 6. Taxonomy Queue Page Upgrades

**File:** `components/pages/TaxonomyQueuePage.tsx` (modify existing)

### List view changes
- Show `needs_review` + `needs_attention` products only
- `needs_attention` rows have amber left border
- Column: "Source" — shows `enrichment_source` badge (rules / claude / manual / —)
- Column: "Note" — shows `enrichment_note` truncated to 60 chars
- Bulk checkbox + "Validate selected" button
- "Auto-validate all ≥ 0.75" button (shows count: "Auto-validate 234 products")
- "Re-enrich selected with Claude" button (shows count of selected)

### Detail panel changes
- Confidence displayed as percentage + colour-coded badge (green/amber/red)
- Enrichment note block: "Source: claude — Coastal Ridge is a California brand, Central Coast appellation"
- **"Ask Claude" button** — disabled while a request is in flight
  - On click: calls `/api/enrich/claude-single`
  - Shows suggestion panel with each field + current value vs suggested value
  - Accept / Skip per field, or "Accept all"
  - After accepting: saves fields via PATCH /api/products/[id], records changelog entry with `source: 'manual'`
- Manual field edits write a changelog entry: `{ product_id, field, old_value, new_value, source: 'manual', note: null }`

---

## 7. Processing Review Page Upgrades

**File:** `components/pages/ProcessingReviewPage.tsx` (modify existing)

- Poll `/api/enrich/status` every 3 seconds
- While `status === 'running'`: show progress bar (`done/total` from pipeline-status.json), tokens used so far
- While `status === 'idle'`: show last run summary (auto-validated, in queue, needs attention, tokens used, timestamp)
- "Run Enrichment" button (calls POST /api/enrich/run)
- Stats: Total products / Validated / In queue / Needs attention / Synced to Supabase
- Recent batch logs table (already exists)

---

## 8. Supabase Sync

**File:** `app/api/settings/sync/route.ts` (modify existing)

**Strategy:** Full resync of all `validated` products on each trigger (no delta for v1 — simpler, idempotent).

**Why not delta:** With < 5,000 products, full resync is fast. Delta adds complexity with minimal benefit. Add in v2 if performance is needed.

**Implementation:**
- Fetch all products with `validation_status === 'validated'`
- Upsert to Supabase using `Prefer: resolution=merge-duplicates` on `sku`
- On success: write `synced_at = now()` to each synced product record (batch write)
- Return: `{ synced: N, failed: 0, timestamp }`

**Last sync tracking:** Stored in `data/db/sync-status.json`:
```json
{ "last_synced_at": "2026-03-23T10:00:00Z", "last_synced_count": 342 }
```
SettingsPage shows: "Last synced: Mar 23, 2026 — 342 products"

**Idempotency:** Upsert on `sku` means re-running sync is always safe.

---

## 9. Data Model Changes

### Product record additions
```typescript
{
  // New fields added to existing product records:
  enrichment_source: 'rules' | 'claude' | 'manual' | null,
  enrichment_note: string | null,       // explanation from enrichment
  claude_enriched_at: string | null,    // ISO timestamp, null = not yet enriched
  synced_at: string | null,             // ISO timestamp of last successful Supabase sync
}
```

`validation_status` already exists. New valid values: `validated`, `needs_review`, `needs_attention`. `blocked` is retired.

### `data/db/pipeline-status.json`
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

### `data/db/sync-status.json`
```json
{
  "last_synced_at": null,
  "last_synced_count": 0
}
```

---

## 10. Confidence Threshold

Default: `0.75` for auto-validation. Stored as a constant in `lib/enrichment/pipeline.ts`:
```typescript
export const AUTO_VALIDATE_THRESHOLD = 0.75;
```
Can be adjusted without spec change. After first real run, review false-positive rate and tune if needed.

---

## 11. Out of Scope (v1)

- Real-time scraping (product images, full descriptions)
- Per-user cost limits (single-user system for now)
- Delta sync to Supabase (full resync is sufficient for current catalog size)
- Live WebSocket progress (polling every 3s is sufficient)
- Confidence bar visualisation in queue (show number + badge, no bar chart)
- LIQ9-specific taxonomy differences (handled by existing category fields)
- User authentication / multi-user roles
- Scheduled auto-sync
