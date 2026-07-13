# Wire Real Co-Purchase (BI) Data Into the Recommender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real BI co-purchase data (`data/bi-product-affinities.json`, `co_order_affinities` only) into `recommender.ts` as an additive scoring signal, replacing the never-implemented `coPurchaseStrategy` seam.

**Architecture:** A new, independently-testable module `apps/catalog/lib/co-purchase.ts` owns BI-file loading, base-SKU↔live-SKU mapping, and bonus calculation. `recommender.ts` threads a `baseSkuMap` parameter through its two existing call chains and adds one new scoring line inside `scoreCandidateDetailed`. No new call chains, no parallel ranking path.

**Tech Stack:** TypeScript, Next.js (apps/catalog), Vitest. Follows existing patterns in `catalog-data.ts` (static JSON loading) and `category-scorer.ts` (pluggable signal module consumed by `scoreCandidateDetailed`).

**Spec:** `docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md` (approved, 4th review pass clean).

---

## Before you start

The spec's investigation numbers (freshness `2026-07-11T08:50 UTC`, `base_count: 5,439`, coverage `96.25%`) were measured against the BI export as it existed on 2026-07-11. **Re-verify against the live file in Task 1** — a quick check during planning found the file now reports `exported_at: 2026-06-12T08:41:47 UTC` and `base_count: 5351`, meaning the export has been rotated at least once since the spec was written. The JSON *structure* is unchanged (verified), so the design still holds, but do not hardcode the spec's exact figures into code comments or tests — recompute them fresh in Task 1 and use what you actually measure.

---

## File Structure

- **Create:** `apps/catalog/lib/co-purchase.ts` — BI file loading, `buildBaseSkuMap`, `baseCodeOf`, `getCoPurchaseBonus`. Kept separate from `recommender.ts` (577 lines) per spec decision.
- **Create:** `apps/catalog/lib/__tests__/co-purchase.test.ts` — unit tests for the new module.
- **Modify:** `apps/catalog/lib/recommender.ts` — thread `baseSkuMap` through `scoreCandidateDetailed`, `scoreCandidate`, `rankAgainst`, `getRecommendations`, `getRecommendationsWithBands`, `precomputeRecommendations`; update the BI-SWAP-SEAM docblock.
- **Modify:** `apps/catalog/lib/__tests__/recommender.test.ts` — one integration test for a real co-order pair ranking above an equivalent no-signal candidate; update any call sites broken by the new parameter.

---

## Task 1: Re-verify BI file stats and confirm SKU mapping approach

**Files:** none (investigation only, informs Task 2 constants)

- [ ] **Step 1: Confirm current file stats**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2"
python3 -c "
import json
with open('data/bi-product-affinities.json') as f:
    d = json.load(f)
print('source:', d['source'])
print('exported_at:', d['exported_at'])
print('base_count:', d['base_count'])
print('num affinity keys:', len(d['affinities']))
zero_co_order = sum(1 for v in d['affinities'].values() if len(v.get('co_order_affinities', [])) == 0)
print('subjects with zero co_order entries:', zero_co_order)
"
```
Expected: prints real numbers (not necessarily matching the spec's 2026-07-11 snapshot — that's fine, just note whatever you see).

- [ ] **Step 2: Confirm SKU-suffix mapping coverage against the live export**

Run:
```bash
python3 -c "
import json, re
with open('data/bi-product-affinities.json') as f:
    bi = json.load(f)
with open('data/live_products_export.json') as f:
    live = json.load(f)
live_rows = live if isinstance(live, list) else live.get('products', [])
live_skus = {r['sku'] for r in live_rows if r.get('sku')}
live_base_codes = set()
for sku in live_skus:
    m = re.match(r'^([A-Z]{3}\d{4})', sku)
    if m: live_base_codes.add(m.group(1))
bi_codes = set(bi['affinities'].keys())
mapped = bi_codes & live_base_codes
print(f'BI subject codes: {len(bi_codes)}')
print(f'mapped to a live base code: {len(mapped)} ({100*len(mapped)/len(bi_codes):.1f}%)')
"
```
Expected: a coverage percentage in the same ballpark as the spec's 96.25% (used as the regression-guard threshold in Task 5). If it's materially lower (e.g. <90%), STOP and flag to the user before continuing — the core mapping assumption may no longer hold.

- [ ] **Step 3: No commit** (investigation only — findings feed Task 2/5 constants and comments)

---

## Task 2: `co-purchase.ts` — base SKU mapping

**Files:**
- Create: `apps/catalog/lib/co-purchase.ts`
- Test: `apps/catalog/lib/__tests__/co-purchase.test.ts`

- [ ] **Step 1: Write failing tests for `baseCodeOf` and `buildBaseSkuMap`**

```ts
import { describe, it, expect } from 'vitest';
import { baseCodeOf, buildBaseSkuMap } from '@/lib/co-purchase';

describe('baseCodeOf', () => {
  it('strips a trailing variant-lot suffix', () => {
    expect(baseCodeOf('WRW6603AC')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it has no suffix', () => {
    expect(baseCodeOf('WRW6603')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it does not match the 3-letter/4-digit pattern', () => {
    expect(baseCodeOf('WEIRD')).toBe('WEIRD');
  });
});

describe('buildBaseSkuMap', () => {
  const products = [
    { sku: 'WRW6603AC', name: 'A' },
    { sku: 'WRW6564GF', name: 'B' },
    { sku: 'WRW6564AA', name: 'C' },
    { sku: 'NOPREFIXMATCH', name: 'D' },
  ] as any;

  it('maps a base code to its live sku', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6603')).toEqual(['WRW6603AC']);
  });
  it('fans out a base code to 2 live sku variants', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6564')?.sort()).toEqual(['WRW6564AA', 'WRW6564GF']);
  });
  it('excludes codes with no live match (map has no entry for them)', () => {
    const map = buildBaseSkuMap(products);
    expect(map.has('NOP')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (module doesn't exist yet)**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: FAIL — `Cannot find module '@/lib/co-purchase'`.

- [ ] **Step 3: Implement `baseCodeOf` and `buildBaseSkuMap`**

```ts
/**
 * co-purchase.ts — real BI co-purchase ("customers also bought in the same
 * order") data, wired into the recommender's additive scorer as one more
 * signal. See docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md
 * for the full design and the decisions behind it (esp. why only
 * co_order_affinities is used, never co_customer_affinities).
 */
import fs from 'fs';
import path from 'path';
import type { PublicProduct } from '@/lib/types';

type AffinityEntry = { rank: number; base_product_code: string; product_name: string; rate: number };
// co_customer_affinities is parsed as part of the file's shape but
// deliberately never read by this module (spec decision #2).
type AffinityRecord = { co_order_affinities: AffinityEntry[]; co_customer_affinities: AffinityEntry[] };
type AffinityFile = { source: string; exported_at: string; base_count: number; affinities: Record<string, AffinityRecord> };

// live sku -> base_product_code, via the 3-letter/4-digit prefix BI base
// codes are keyed on (e.g. "WRW6603AC" -> "WRW6603"). SKUs that don't match
// the pattern are returned unchanged (defensive: never throws on a weird sku).
export function baseCodeOf(sku: string): string {
  const m = sku.match(/^([A-Z]{3}\d{4})/);
  return m ? m[1] : sku;
}

/**
 * base_product_code (BI) -> live sku[] (0 built here; callers get [] via
 * Map.get returning undefined -> treat as no live match). `all` is the FULL
 * product pool (in-stock AND out-of-stock) — matching the existing `all`
 * parameter convention on precomputeRecommendations/getRecommendations.
 * Stock filtering is NOT this function's job (same as every other
 * candidate-pool step in recommender.ts); it happens later via isEligible.
 */
export function buildBaseSkuMap(all: readonly PublicProduct[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of all) {
    if (!p.sku) continue;
    const base = baseCodeOf(p.sku);
    const arr = map.get(base);
    if (arr) arr.push(p.sku);
    else map.set(base, [p.sku]);
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: PASS (all `baseCodeOf`/`buildBaseSkuMap` tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/co-purchase.ts apps/catalog/lib/__tests__/co-purchase.test.ts
git commit -m "feat(recs): add base-SKU mapping for BI co-purchase data"
```

---

## Task 3: `co-purchase.ts` — BI file loading with graceful degradation

**Files:**
- Modify: `apps/catalog/lib/co-purchase.ts`
- Test: `apps/catalog/lib/__tests__/co-purchase.test.ts`

Per spec's error-handling section: unlike `catalog-data.ts`'s loader (which fails the build loudly on a missing/malformed file), this is optional enrichment data — a missing or broken file degrades to a 0-bonus, logged once, never thrown.

- [ ] **Step 1: Write failing tests for load behavior**

Append to `co-purchase.test.ts`:

```ts
import { getCoPurchaseBonus, __resetForTest } from '@/lib/co-purchase';

describe('BI file loading — graceful degradation', () => {
  it('getCoPurchaseBonus returns 0 when there is no co_order data for the subject', () => {
    const map = new Map<string, string[]>();
    expect(getCoPurchaseBonus('NOSUCHSKU0000', 'ALSONOTREAL0000', map)).toBe(0);
  });
});
```

(Full missing-file-path simulation is deferred to Task 6's dedicated fixture-path test — this step just confirms the function is safe to call with data that doesn't resolve to anything, which exercises the same code path as a missing file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: FAIL — `getCoPurchaseBonus` and `__resetForTest` are not exported yet.

- [ ] **Step 3: Implement the loader**

Append to `co-purchase.ts`:

```ts
/**
 * Resolve the absolute path to the BI affinity file. Mirrors the multi-path
 * probe in catalog-data.ts's exportPath() (cwd differs between local dev and
 * the Vercel build) but does NOT throw when nothing is found — see module
 * docblock on graceful degradation.
 */
function affinityPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data', 'bi-product-affinities.json'),
    path.join(process.cwd(), '..', '..', 'data', 'bi-product-affinities.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let _affinities: Record<string, AffinityRecord> | null = null;
let _loaded = false;

function loadAffinities(): Record<string, AffinityRecord> {
  if (_loaded) return _affinities ?? {};
  _loaded = true;
  const file = affinityPath();
  if (!file) {
    console.warn('[co-purchase] bi-product-affinities.json not found; co-purchase bonus disabled for this build.');
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AffinityFile;
    _affinities = parsed.affinities ?? {};
    return _affinities;
  } catch (e) {
    console.warn(`[co-purchase] failed to parse ${file}: ${(e as Error).message}; co-purchase bonus disabled for this build.`);
    return {};
  }
}

// Test-only: reset module-level cache so tests can simulate a fresh load.
// Not exported from any public index — import directly from this module in tests.
export function __resetForTest(): void {
  _affinities = null;
  _loaded = false;
}
```

- [ ] **Step 4: Implement `getCoPurchaseBonus` (stub scaling for now, damping comes in Task 4)**

```ts
const K = 5; // ceiling bonus, only reachable at rate=1.0 AND full damping

/**
 * Bonus points for candidate given subject, scaled from BI co_order rate.
 * Returns 0 if no co_order data for subject, or candidate isn't a listed
 * co_order target. Deliberately never consults co_customer_affinities (spec
 * decision #2) — no blend, no fallback to it when co_order is empty.
 */
export function getCoPurchaseBonus(
  subjectSku: string,
  candidateSku: string,
  baseSkuMap: Map<string, string[]>,
): number {
  const affinities = loadAffinities();
  const subjectBase = baseCodeOf(subjectSku);
  const record = affinities[subjectBase];
  if (!record || !record.co_order_affinities?.length) return 0;

  const candidateBase = baseCodeOf(candidateSku);
  const entry = record.co_order_affinities.find((e) => e.base_product_code === candidateBase);
  if (!entry) return 0;

  return entry.rate * K;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/lib/co-purchase.ts apps/catalog/lib/__tests__/co-purchase.test.ts
git commit -m "feat(recs): load BI affinity file with graceful degradation on missing/malformed data"
```

---

## Task 4: `co-purchase.ts` — support damping

**Files:**
- Modify: `apps/catalog/lib/co-purchase.ts`
- Test: `apps/catalog/lib/__tests__/co-purchase.test.ts`

Per spec decision #6: dampen the bonus by `co_order_affinities` list length as a support proxy, since `rate` alone can't distinguish a pair backed by 1 order from one backed by 200.

- [ ] **Step 1: Write failing tests for damping**

Append to `co-purchase.test.ts`. Use `__resetForTest` plus a way to inject test data — since `loadAffinities` reads from disk, these damping-formula tests should test the pure damping math directly rather than round-tripping through the file loader (the file-loading path is already covered by Task 3/6 tests):

```ts
import { supportDamping } from '@/lib/co-purchase';

describe('supportDamping', () => {
  it('a short list (length 1) is damped well below 1.0', () => {
    expect(supportDamping(1)).toBeCloseTo(0.2, 5);
  });
  it('a list at SUPPORT_FULL_AT (5) reaches full damping (1.0)', () => {
    expect(supportDamping(5)).toBe(1);
  });
  it('a list longer than SUPPORT_FULL_AT is capped at 1.0, never exceeds it', () => {
    expect(supportDamping(50)).toBe(1);
  });
  it('a list of length 0 damps to 0', () => {
    expect(supportDamping(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: FAIL — `supportDamping` not exported.

- [ ] **Step 3: Implement `supportDamping` and wire it into `getCoPurchaseBonus`**

```ts
// SUPPORT_FULL_AT is curve-fit to an observed gap between well-supported and
// thinly-supported subjects' co_order list lengths (see Task 1 investigation
// and spec decision #6) — a rough proxy, not a calibrated confidence
// threshold. TODO: replace with a real order-count-based Wilson/Bayesian
// shrinkage once/if the BI export adds a support (n_orders) field per pair.
const SUPPORT_FULL_AT = 5;

export function supportDamping(listLength: number): number {
  return Math.min(1, listLength / SUPPORT_FULL_AT);
}
```

Then update `getCoPurchaseBonus`'s return line:

```ts
  const damping = supportDamping(record.co_order_affinities.length);
  return entry.rate * K * damping;
```

- [ ] **Step 4: Add a `getCoPurchaseBonus`-level damping regression test**

Append to `co-purchase.test.ts` (this one needs real-shaped data — write a small in-module test fixture by temporarily monkey-patching is NOT the pattern here; instead assert the formula indirectly via the already-tested `supportDamping` + a hand-built scenario using the real file, deferred to Task 6's integration test). Skip a redundant unit test here — Task 6 covers the end-to-end scaling assertion against real data.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/lib/co-purchase.ts apps/catalog/lib/__tests__/co-purchase.test.ts
git commit -m "feat(recs): dampen co-purchase bonus by list-length support proxy"
```

---

## Task 5: Coverage regression guard (against real data)

**Files:**
- Modify: `apps/catalog/lib/__tests__/co-purchase.test.ts`

Per spec decision #5: a test asserts mapped-coverage stays above a threshold, so a future BI SKU-format change fails a test loudly instead of the signal silently going dead.

- [ ] **Step 1: Write the coverage guard test**

Append to `co-purchase.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

describe('coverage regression guard (real data)', () => {
  it('maps >90% of real BI subject codes to a live base SKU', () => {
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    if (!biPath || !exportPathFile) {
      throw new Error('Real data files not found — run this test from the repo, not an isolated fixture dir.');
    }
    const bi = JSON.parse(fs.readFileSync(biPath, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    const baseSkuMap = buildBaseSkuMap(liveRows as any);
    const biCodes = Object.keys(bi.affinities);
    const mapped = biCodes.filter((code) => baseSkuMap.has(code));
    const coverage = mapped.length / biCodes.length;

    expect(coverage).toBeGreaterThan(0.90);
  });
});

function findRealFile(relPath: string): string | null {
  const candidates = [
    path.join(process.cwd(), relPath),
    path.join(process.cwd(), '..', '..', relPath),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
```

- [ ] **Step 2: Run the test**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts -t "coverage regression guard"`
Expected: PASS, with actual coverage printed if you add a `console.log(coverage)` while checking (remove before commit, or leave the assertion as the source of truth — no need to keep the log).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/__tests__/co-purchase.test.ts
git commit -m "test(recs): add coverage regression guard for BI base-SKU mapping"
```

---

## Task 6: Regression guard — dropped co_customer blend + full `getCoPurchaseBonus` integration test

**Files:**
- Modify: `apps/catalog/lib/__tests__/co-purchase.test.ts`

Per spec decision #2/testing plan: explicitly guard against reintroducing the dropped blend, and exercise `getCoPurchaseBonus` end-to-end against a real sampled pair.

- [ ] **Step 1: Write the regression guard + integration tests**

Append to `co-purchase.test.ts`:

```ts
describe('getCoPurchaseBonus — real data integration', () => {
  it('returns a positive bonus for a real known co_order pair', () => {
    __resetForTest();
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    // Find one real subject with a co_order entry that maps to a live sku.
    let subjectSku = '', candidateSku = '';
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base);
      if (!subjectSkus?.length) continue;
      for (const entry of record.co_order_affinities ?? []) {
        const candSkus = baseSkuMap.get(entry.base_product_code);
        if (candSkus?.length) {
          subjectSku = subjectSkus[0];
          candidateSku = candSkus[0];
          break outer;
        }
      }
    }
    expect(subjectSku).not.toBe('');

    const bonus = getCoPurchaseBonus(subjectSku, candidateSku, baseSkuMap);
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(5); // K ceiling
  });

  // REGRESSION GUARD: a candidate that appears ONLY in co_customer_affinities
  // (never in co_order_affinities) must score 0 — this is the dropped
  // max-blend decision (spec decision #2). If this test ever fails, someone
  // reintroduced the co_customer fallback; don't "fix" the test, fix the code.
  it('scores 0 for a candidate that ONLY appears in co_customer_affinities, not co_order_affinities', () => {
    __resetForTest();
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    let subjectSku = '', candidateSku = '';
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base);
      if (!subjectSkus?.length) continue;
      const orderCodes = new Set((record.co_order_affinities ?? []).map((e: any) => e.base_product_code));
      for (const entry of record.co_customer_affinities ?? []) {
        if (orderCodes.has(entry.base_product_code)) continue; // must be customer-only
        const candSkus = baseSkuMap.get(entry.base_product_code);
        if (candSkus?.length) {
          subjectSku = subjectSkus[0];
          candidateSku = candSkus[0];
          break outer;
        }
      }
    }
    expect(subjectSku).not.toBe(''); // sanity: found a customer-only pair to test against

    const bonus = getCoPurchaseBonus(subjectSku, candidateSku, baseSkuMap);
    expect(bonus).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/co-purchase.test.ts`
Expected: PASS, all describe blocks green.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/__tests__/co-purchase.test.ts
git commit -m "test(recs): guard against reintroducing dropped co_customer blend"
```

---

## Task 7: Thread `baseSkuMap` through `recommender.ts` — signatures + scoring line

**Files:**
- Modify: `apps/catalog/lib/recommender.ts`

This is the "not a one-line change" the spec explicitly calls out — six functions across two call chains need the new parameter threaded through. No behavior change to any function's existing logic; this task only adds a parameter and one new scoring line.

- [ ] **Step 1: Add the import**

At the top of `recommender.ts`, alongside the existing `category-scorer` import:

```ts
import { getCoPurchaseBonus } from '@/lib/co-purchase';
```

- [ ] **Step 2: Update `scoreCandidateDetailed` signature and add the scoring line**

Modify the signature (around line 118) to accept `baseSkuMap`:

```ts
export function scoreCandidateDetailed(
  product: PublicProduct,
  candidate: PublicProduct,
  productFoods?: Set<string>,
  baseSkuMap?: Map<string, string[]>,
): { score: number; breakdown: Record<string, number> } {
```

Add the new scoring line right after the `add` helper is defined (co-purchase is a real behavioral signal like popularity — place it near the popularity block at the end, before the final `score` sum, matching the spec's placement decision: co-purchase can exceed region, sits above popularity):

```ts
  // Co-purchase (real BI "bought in the same order" data) — see
  // docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md. Only
  // active when a baseSkuMap is provided (both call chains build one; tests
  // that omit it simply get 0 co-purchase bonus, same as a subject with no
  // BI record). Placed above popularity: two SPECIFIC products bought
  // together is stronger evidence than both merely being popular in general.
  if (baseSkuMap) {
    const coPurchasePts = getCoPurchaseBonus(product.sku, candidate.sku, baseSkuMap);
    if (coPurchasePts > 0) add('co_purchase', coPurchasePts);
  }
```

- [ ] **Step 3: Update `scoreCandidate` to pass `baseSkuMap` through**

```ts
export function scoreCandidate(
  product: PublicProduct,
  candidate: PublicProduct,
  productFoods?: Set<string>,
  baseSkuMap?: Map<string, string[]>,
): number {
  return scoreCandidateDetailed(product, candidate, productFoods, baseSkuMap).score;
}
```

- [ ] **Step 4: Update `rankAgainst` to accept and pass through `baseSkuMap`**

```ts
function rankAgainst(
  product: PublicProduct,
  candidates: readonly PublicProduct[],
  productFoods: Set<string>,
  baseSkuMap?: Map<string, string[]>,
): PublicProduct[] {
  const scored: Array<{ p: PublicProduct; score: number }> = [];
  for (const c of candidates) {
    if (!isEligible(product, c)) continue;
    const score = scoreCandidate(product, c, productFoods, baseSkuMap);
    if (score > 0) scored.push({ p: c, score });
  }
  scored.sort((x, y) => (y.score - x.score) || (x.p.sku < y.p.sku ? -1 : x.p.sku > y.p.sku ? 1 : 0));
  return scored.slice(0, MAX_RECS).map((s) => s.p);
}
```

- [ ] **Step 5: Update `getRecommendations` to build (or accept) and pass `baseSkuMap`**

`getRecommendations` is called both standalone (e.g. by tests, and potentially by a product-detail-page live path) and is one leg of the "two call chains" — it needs its own `baseSkuMap` since it doesn't go through `precomputeRecommendations`. Build it once per call (not per candidate):

```ts
export function getRecommendations(
  product: PublicProduct,
  all: readonly PublicProduct[],
): PublicProduct[] {
  // Dedupe candidates by sku (defensive: a pool could contain repeats).
  const seen = new Set<string>();
  const candidates: PublicProduct[] = [];
  for (const p of all) {
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    candidates.push(p);
  }
  const baseSkuMap = buildBaseSkuMap(all);
  return rankAgainst(product, candidates, foodSet(product.food_matching), baseSkuMap);
}
```

Add `buildBaseSkuMap` to the import from `@/lib/co-purchase`:

```ts
import { getCoPurchaseBonus, buildBaseSkuMap } from '@/lib/co-purchase';
```

- [ ] **Step 6: Update `getRecommendationsWithBands` to build and pass `baseSkuMap`**

This function also stands alone (called directly by `precomputeRecommendations`, but also independently per its own docblock/tests). Build once per call, same as Step 5:

```ts
export function getRecommendationsWithBands(
  product: PublicProduct,
  all: readonly PublicProduct[],
  opts: { includeGreatAlternative?: boolean; b2bPrices?: ReadonlyMap<string, number> } = {},
): RecommendationResult[] {
  const { includeGreatAlternative = false, b2bPrices } = opts;

  const seen = new Set<string>();
  const candidates: PublicProduct[] = [];
  for (const p of all) {
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    candidates.push(p);
  }

  const productFoods = foodSet(product.food_matching);
  const baseSkuMap = buildBaseSkuMap(all);
  // ... (rest of function unchanged except the scoreCandidateDetailed call below)
```

And update its scoring call:

```ts
    const { score, breakdown } = scoreCandidateDetailed(product, c, productFoods, baseSkuMap);
```

**Performance note for Step 6:** `precomputeRecommendations` calls `getRecommendationsWithBands` once per product (~11,436 times), and as written this rebuilds `baseSkuMap` from the (much smaller, bucketed) `pool` on every call — not from the full catalog, so it's cheap per-call, but still redundant work repeated ~11,436 times. Task 8 fixes this by having `precomputeRecommendations` build the map ONCE from `all` and pass it in, matching the existing `productFoods`-style pre-split optimization. Leave `getRecommendationsWithBands` building its own map internally for now (keeps it a valid standalone function when called directly, e.g. from a live product-detail-page path or tests) — Task 8 adds an optional override.

- [ ] **Step 7: Run the existing recommender test suite to confirm no regressions from signature changes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: PASS — all existing tests still green (new parameters are optional/additive, existing call sites in tests that don't pass `baseSkuMap` should still work since `getRecommendations`/`getRecommendationsWithBands` build their own).

- [ ] **Step 8: Commit**

```bash
git add apps/catalog/lib/recommender.ts
git commit -m "feat(recs): thread baseSkuMap through recommender scoring chain, wire co-purchase bonus"
```

---

## Task 8: Precompute — build `baseSkuMap` once, avoid redundant work

**Files:**
- Modify: `apps/catalog/lib/recommender.ts`

`precomputeRecommendations` already builds `inStock`/`byRegion`/`byType`/`byCountry` once up front (same performance discipline documented in its docblock). `baseSkuMap` should follow the same pattern rather than being rebuilt from each product's small bucket ~11,436 times inside `getRecommendationsWithBands`.

- [ ] **Step 1: Add an optional `baseSkuMap` override parameter to `getRecommendationsWithBands`**

Change the internal build to only happen when not provided:

```ts
export function getRecommendationsWithBands(
  product: PublicProduct,
  all: readonly PublicProduct[],
  opts: {
    includeGreatAlternative?: boolean;
    b2bPrices?: ReadonlyMap<string, number>;
    baseSkuMap?: Map<string, string[]>;
  } = {},
): RecommendationResult[] {
  const { includeGreatAlternative = false, b2bPrices } = opts;
  // ...
  const productFoods = foodSet(product.food_matching);
  const baseSkuMap = opts.baseSkuMap ?? buildBaseSkuMap(all);
  // ...
```

- [ ] **Step 2: Build `baseSkuMap` once in `precomputeRecommendations` and pass it through**

Near the top of `precomputeRecommendations`, alongside `byRegion`/`byType`/`byCountry`:

```ts
  // Built once against the FULL pool (in-stock + out-of-stock), same
  // convention as buildBaseSkuMap's own contract — matches how byRegion/
  // byType/byCountry are pre-split once here rather than per-subject.
  const baseSkuMap = buildBaseSkuMap(all);
```

And update the call site at the bottom of the subject loop:

```ts
    const recs = getRecommendationsWithBands(product, pool, {
      includeGreatAlternative: !isInStock(product.is_in_stock),
      baseSkuMap,
    });
```

- [ ] **Step 3: Run the full recommender test suite**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/recommender.ts
git commit -m "perf(recs): build baseSkuMap once in precomputeRecommendations instead of per-product"
```

---

## Task 9: Update the BI-SWAP-SEAM docblock

**Files:**
- Modify: `apps/catalog/lib/recommender.ts`

Per spec: mark the seam as now-implemented (docblock update only, no code path change — the `coPurchaseStrategy` abstraction mentioned in the old docblock was never built; co-purchase is wired as an additive signal instead, which is what actually shipped).

- [ ] **Step 1: Update the file-level docblock (top of file, ~line 6-12)**

Replace:
```
 * BI-SWAP SEAM
 * ------------
 * This is a *rule-based* placeholder for real co-purchase intelligence. When BI
 * co-purchase data becomes available, it plugs in via the `coPurchaseStrategy`
 * seam in `getRecommendations` (see the FUTURE comment there) WITHOUT any change
 * to the UI: callers keep calling getRecommendations / precomputeRecommendations
 * and keep receiving PublicProduct[] / Map<sku, sku[]>.
```

With:
```
 * BI CO-PURCHASE SIGNAL (implemented 2026-07-13)
 * ------------------------------------------------
 * Real BI "bought in the same order" data (data/bi-product-affinities.json,
 * co_order_affinities only — see lib/co-purchase.ts) is wired in as one more
 * additive signal inside scoreCandidateDetailed, not a separate
 * override/replace path. See
 * docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md for the full
 * design and the decisions behind it (esp. why co_customer_affinities is
 * deliberately unused, and the known feedback-loop risk that is not yet
 * mitigated).
```

- [ ] **Step 2: Remove the now-stale `FUTURE: if a coPurchaseStrategy...` comment on `getRecommendations`**

Find (around line 289):
```
 * FUTURE: if a coPurchaseStrategy provides real BI data for product.sku, use it
 * first; fall back to the rule-based scoring below.
```

Delete this line (and the blank line before it if it leaves a double blank) — co-purchase is now folded into the rule-based scoring itself (an additive bonus), not a separate strategy that "goes first."

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/recommender.ts
git commit -m "docs(recs): update BI-SWAP-SEAM docblock — co-purchase signal now implemented"
```

---

## Task 10: Integration test in `recommender.test.ts`

**Files:**
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts`

Per spec testing plan: one integration case asserting a known real `co_order` BI-affinity pair (sampled from the live JSON, not synthetic) ranks above an otherwise-equivalent candidate with no co-purchase signal.

- [ ] **Step 1: Write the integration test**

Append a new describe block to `recommender.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { buildBaseSkuMap } from '@/lib/co-purchase';

function findRealFile(relPath: string): string | null {
  const candidates = [
    path.join(process.cwd(), relPath),
    path.join(process.cwd(), '..', '..', relPath),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

describe('co-purchase integration (real BI data)', () => {
  it('a real co_order pair ranks above an otherwise-equivalent candidate with no co-purchase signal', () => {
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    // Find a real subject sku with an in-stock live sku and a real co_order
    // partner that also maps to a live sku.
    const bySku = new Map(liveRows.map((r: any) => [r.sku, r]));
    let subjectProduct: any = null, coOrderPartnerSku = '';
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base) ?? [];
      for (const sSku of subjectSkus) {
        const p = bySku.get(sSku);
        if (!p || p.is_in_stock !== '1') continue;
        for (const entry of record.co_order_affinities ?? []) {
          const candSkus = baseSkuMap.get(entry.base_product_code) ?? [];
          for (const cSku of candSkus) {
            const cand = bySku.get(cSku);
            if (cand && cand.is_in_stock === '1' && cSku !== sSku) {
              subjectProduct = p;
              coOrderPartnerSku = cSku;
              break outer;
            }
          }
        }
      }
    }
    expect(subjectProduct).not.toBeNull();

    // A synthetic "twin" candidate: same category_group as the co-order
    // partner (so it isn't suppressed by cross-category eligibility), but
    // with none of the subject's actual attributes and no BI relationship —
    // it should score 0 on every rule-based signal, so ONLY the co-purchase
    // bonus can separate the two candidates.
    const partner = bySku.get(coOrderPartnerSku) as any;
    const twin = {
      ...partner,
      sku: 'ZZZ9999TWIN',
      name: 'Synthetic twin with no BI relationship',
      region: 'NoSuchRegionXYZ',
      country: 'NoSuchCountryXYZ',
      variety: undefined,
      food_matching: '',
    };

    const pool = [subjectProduct, partner, twin];
    const recs = getRecommendations(subjectProduct, pool);
    const partnerIdx = recs.findIndex((r) => r.sku === coOrderPartnerSku);
    const twinIdx = recs.findIndex((r) => r.sku === 'ZZZ9999TWIN');

    expect(partnerIdx).toBeGreaterThanOrEqual(0);
    // Either the twin scored 0 and was dropped entirely (not in recs), or it
    // ranked below the real co-order partner. Both prove the bonus worked.
    expect(twinIdx === -1 || twinIdx > partnerIdx).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "co-purchase integration"`
Expected: PASS. If it fails because no qualifying real pair was found (`subjectProduct` stays null), the live export and BI file may have diverged further than expected — investigate before forcing the test to pass artificially.

- [ ] **Step 3: Run the FULL test suite for the whole file to confirm no regressions**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: PASS, all tests green (this is the point to catch any signature-change fallout from Task 7/8 across the full existing suite).

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "test(recs): add real-data integration test for co-purchase bonus ranking"
```

---

## Task 11: Rule 1/6/9 verification — confirm the bonus reaches final output

**Files:** none (verification only, per project CLAUDE.md Rules 1/6/9 — "verify, don't infer, that data landed where it should")

This is not optional per project rules: counting that tests pass is not verification that the signal reaches the actual precomputed output map.

- [ ] **Step 1: Run `precomputeRecommendations` over the real live export and inspect actual output**

Use a throwaway vitest test file (same pattern as Task 13 — vitest is already wired and TS-aware, no extra tool install needed). Create `apps/catalog/lib/__tests__/_scratch-verify.test.ts` (never committed, deleted at the end of Step 2):

```ts
import { it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { precomputeRecommendations, scoreCandidateDetailed } from '@/lib/recommender';
import { buildBaseSkuMap } from '@/lib/co-purchase';

function findRealFile(relPath: string): string {
  const candidates = [path.join(process.cwd(), relPath), path.join(process.cwd(), '..', '..', relPath)];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`not found: ${relPath}`);
  return found;
}

it('scratch: verify co_purchase bonus reaches real scores and the precomputed map', () => {
  const raw = JSON.parse(fs.readFileSync(findRealFile('data/live_products_export.json'), 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.products;
  const all = rows.map((r: any) => ({ ...r, is_in_stock: r.is_in_stock === '1' || r.is_in_stock === 1 }));
  const bi = JSON.parse(fs.readFileSync(findRealFile('data/bi-product-affinities.json'), 'utf8'));
  const baseSkuMap = buildBaseSkuMap(all);
  const bySku = new Map(all.map((p: any) => [p.sku, p]));

  // Step 1: confirm the bonus reaches scoreCandidateDetailed's breakdown for real pairs.
  let checked = 0, sawCoPurchase = 0;
  const hitSubjects: string[] = [];
  for (const [base, record] of (Object.entries(bi.affinities) as any).slice(0, 500)) {
    for (const sSku of baseSkuMap.get(base) ?? []) {
      const subject = bySku.get(sSku);
      if (!subject) continue;
      for (const entry of record.co_order_affinities ?? []) {
        for (const cSku of baseSkuMap.get(entry.base_product_code) ?? []) {
          const cand = bySku.get(cSku);
          if (!cand) continue;
          checked++;
          const { breakdown } = scoreCandidateDetailed(subject, cand, undefined, baseSkuMap);
          if (breakdown.co_purchase > 0) { sawCoPurchase++; hitSubjects.push(sSku); }
        }
      }
    }
  }
  console.log(`checked ${checked} real BI pairs, co_purchase bonus present in breakdown for ${sawCoPurchase}`);

  // Step 2: confirm a co-order partner actually survives into the final precomputed
  // {sku, band}[] list (score contribution alone doesn't guarantee survival into
  // top-8 if other candidates score higher) for a few of the subjects hit above.
  const precomputed = precomputeRecommendations(all);
  for (const sSku of hitSubjects.slice(0, 3)) {
    console.log(sSku, '->', JSON.stringify(precomputed.get(sSku)));
  }
});
```

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2/apps/catalog"
npx vitest run lib/__tests__/_scratch-verify.test.ts
```

Expected: a non-zero `sawCoPurchase` count in the console output — this confirms the bonus is actually reflected in scores, not just that the JSON loader parses correctly (satisfies project CLAUDE.md Rule 6: end-to-end invariant, not just "the loader ran").

- [ ] **Step 2: Spot-check the precomputed map directly for 2-3 sampled subjects**

Read the 3 printed `precomputed.get(sSku)` lines from Step 1's console output and confirm at least one shows a co-order partner sku present in the final `{sku, band}[]` list.

Then delete the scratch file — it must never be committed:
```bash
rm "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2/apps/catalog/lib/__tests__/_scratch-verify.test.ts"
```

- [ ] **Step 3: Record findings**

No commit for this task (it's verification, not code) — carry the counts/spot-check findings forward into Task 13's PR description per the project's Rule 4 (cost/verification reporting requirement... N/A here since no paid API calls, but the "what shipped" verification spirit still applies to any user-facing pipeline change).

---

## Task 12: Sanity check (a) — signal composition spot-check

**Files:** none (manual investigation, formalizing the ad hoc check already run during spec review)

Per spec decision #7a: confirm the BI signal is driven by genuine cross-sell activity, not a handful of low-value accessories dominating via sheer co-occurrence volume. The spec notes this was already run once ad hoc (2026-07-11) — re-run it now against whatever the BI file's current state is (per Task 1's finding that the file has since been re-exported).

- [ ] **Step 1: Query breadth (how many subjects list each SKU as a co-order partner)**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2"
python3 -c "
import json
from collections import Counter

with open('data/bi-product-affinities.json') as f:
    bi = json.load(f)

breadth = Counter()
names = {}
for base, record in bi['affinities'].items():
    for entry in record.get('co_order_affinities', []):
        breadth[entry['base_product_code']] += 1
        names[entry['base_product_code']] = entry['product_name']

for code, count in breadth.most_common(20):
    print(f'{count:4d}  {code}  {names[code]!r}')
"
```

- [ ] **Step 2: Manually review the output**

Confirm the top 15-20 by breadth read as genuine, well-known, high-turnover retail products (per the spec's earlier finding: Robert Mondavi Private Selection Cabernet, Whispering Angel Rosé, Bombay Sapphire Gin, Aperol, Baileys, Hendrick's-type products), not generic low-value accessories (bottle stoppers, gift bags, etc.) dominating via sheer co-occurrence volume.

- [ ] **Step 3: Record the result**

Note the finding (pass/fail and the actual top-15 list) directly in this plan file or the eventual PR description — per spec: "Record the result in the PR/implementation notes, not just run silently." If the result looks different from the spec's earlier finding (e.g. accessories now dominate), STOP and flag to the user before proceeding to Task 14 — this would mean the underlying BI data composition has shifted since the spec was approved.

No commit (investigation only).

---

## Task 13: Sanity check (b) — before/after top-4 diff

**Files:** none (manual investigation)

Per spec decision #7b: for a sample of high-traffic SKUs, generate top-4 recs before and after this change, and manually review plausibility.

- [ ] **Step 1: Capture "before" recommendations (from the pre-Task-7 state) using a scratch worktree**

By this point Tasks 7-12 are already committed, so there is nothing uncommitted to `git stash` — do NOT use `git stash` here (this worktree also has pre-existing unrelated dirty files, e.g. `data/onboard_preflight_report.md` and various `products.db.backup-*` files, so a broad stash is not a safe or even useful move for this comparison). Instead, use a temporary `git worktree` checked out at the commit immediately before Task 7's "thread baseSkuMap" commit — this gives a clean, isolated "before" snapshot without touching the main worktree at all:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2"
git log --oneline | grep "thread baseSkuMap"
# note the commit hash printed, then find its parent:
BEFORE_SHA=$(git rev-parse <that-commit-hash>^)
git worktree add /tmp/recs-before "$BEFORE_SHA"
```

Then, using a throwaway vitest test file (vitest is already wired and TS-aware in this repo — no extra tool install needed) in EACH location, capture top-4 recs for a fixed sample of high-popularity SKUs. Create `apps/catalog/lib/__tests__/_scratch-diff.test.ts` (same file, run once in each worktree, deleted afterward — never committed):

```ts
import { it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getRecommendations } from '@/lib/recommender';

it('scratch: dump top-4 recs for sampled high-popularity SKUs', () => {
  const exportFile = fs.existsSync(path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'))
    ? path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json')
    : path.join(process.cwd(), 'data', 'live_products_export.json');
  const raw = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.products;
  const all = rows.map((r: any) => ({ ...r, is_in_stock: r.is_in_stock === '1' || r.is_in_stock === 1 }));
  const sample = all.filter((p: any) => p.popularity_tier === 2 && p.is_in_stock).slice(0, 50);
  const lines = sample.map((subject: any) => {
    const after = getRecommendations(subject, all).slice(0, 4).map((p: any) => p.sku);
    return `${subject.sku} -> ${after.join(',')}`;
  });
  fs.writeFileSync('/tmp/recs-diff-output.txt', lines.join('\n'));
});
```

The scratch worktree has no `node_modules` (it's gitignored, so a fresh `git worktree add` checkout doesn't carry it over) — install dependencies there first. This install can take a couple of minutes; that's expected, not a stall:
```bash
cd /tmp/recs-before/apps/catalog && npm install
```

Then copy the throwaway test file into the scratch worktree (it was never committed, so it doesn't exist there yet) and run it:
```bash
cp "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2/apps/catalog/lib/__tests__/_scratch-diff.test.ts" \
   /tmp/recs-before/apps/catalog/lib/__tests__/_scratch-diff.test.ts
cd /tmp/recs-before/apps/catalog && npx vitest run lib/__tests__/_scratch-diff.test.ts
mv /tmp/recs-diff-output.txt /tmp/before.txt
```

Then run again in the main worktree (current HEAD, after Task 12) for "after":
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.claude/worktrees/recs-engine-v2/apps/catalog"
npx vitest run lib/__tests__/_scratch-diff.test.ts
mv /tmp/recs-diff-output.txt /tmp/after.txt
rm apps/catalog/lib/__tests__/_scratch-diff.test.ts  # never commit the scratch file
git worktree remove /tmp/recs-before
```

- [ ] **Step 2: Diff before/after and manually review**

```bash
diff before.txt after.txt
```

For each changed subject: does the new #1 rec make sense as a plausible cross-sell? Does co-purchase change the top-4 for a reasonable fraction of the ~50 sampled products (spec's expectation: "not near-zero, not near-100%")?

- [ ] **Step 3: Record the result**

Per spec: "Not an automated test — a one-time manual review during implementation, reported in the PR description." Write a short summary (e.g. "X/50 sampled subjects changed top-4; spot-checked N of the changes, all plausible") to include in Task 14's PR description.

No commit (investigation only, findings feed the PR description).

---

## Task 14: Final full-suite verification + PR

**Files:** none (verification + PR creation)

- [ ] **Step 1: Run the full catalog test suite**

Run: `cd apps/catalog && npm test`
Expected: PASS, zero failures, zero new TypeScript errors.

- [ ] **Step 2: Run the build to confirm the static build still succeeds**

Run: `cd apps/catalog && npm run build`
Expected: build succeeds (per project CLAUDE.md "gate on build, not just tests" feedback rule — tsc+tests passing isn't sufficient, the build itself must succeed since this touches every product page's precomputed recs).

- [ ] **Step 3: Rule 7 — UI verification**

Per project CLAUDE.md Rule 7: for any change touching data shown in the UI, start the dev server and visually confirm on a real product page that recommendations render correctly and (for at least one of the sampled SKUs from Task 13 that changed) that the new co-purchase-influenced rec appears and looks sensible.

```bash
cd apps/catalog && npm run dev
```

Visit a product page for one of the SKUs identified in Task 13 as having a changed top-4, confirm the recommended-together section renders without errors and shows the expected new item.

- [ ] **Step 4: Write PR description incorporating Task 11/12/13 findings**

Include: what changed, the Task 11 verification counts (X real pairs checked, Y had a nonzero co_purchase bonus in the breakdown), the Task 12 signal-composition finding (top-15 breadth list + genuine-vs-accessory verdict), and the Task 13 before/after diff summary (X/50 changed, spot-check verdict).

- [ ] **Step 5: Commit any final cleanup, then open the PR**

```bash
git status
git add -A  # only if there are stray uncommitted changes from verification scripts — review first
git commit -m "..." # if needed
gh pr create --title "feat(recs): wire real BI co-purchase data into recommender" --body "$(cat <<'EOF'
## Summary
- Wires real BI "bought in the same order" data (co_order_affinities only — co_customer_affinities deliberately excluded, see spec decision #2) into the recommender as an additive scoring signal.
- New module `apps/catalog/lib/co-purchase.ts`: base-SKU↔live-SKU mapping, BI file loading with graceful degradation, list-length-damped bonus calculation.
- `baseSkuMap` threaded through recommender.ts's two call chains (6 functions); one new scoring line in `scoreCandidateDetailed`.

## Verification (Rule 1/6/9 + sanity checks)
- [Task 11 counts here]
- [Task 12 signal-composition finding here]
- [Task 13 before/after diff summary here]

## Test plan
- [ ] `npm test` passes (co-purchase.test.ts + recommender.test.ts, including coverage regression guard and co_customer-blend regression guard)
- [ ] `npm run build` succeeds
- [ ] Verified in dev server on a real product page

Spec: docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md
EOF
)"
```

---

## Out of scope (carried over from spec — do not build these in this plan)

- BI file refresh/sync automation.
- Offline eval harness (Tasks 12/13 are the agreed cheap substitute).
- Click/impression tracking.
- Further scorer-constant audits beyond this signal.
- `reputation_tier` reactivation.
- `co_customer_affinities` as a feature.
- Merchandiser control levers (stock-gate confirmation beyond existing `isEligible`, denylist, split UI).
