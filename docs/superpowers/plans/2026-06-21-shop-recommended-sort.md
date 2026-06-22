# Shop "Recommended" Default Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/shop` default to a business-optimized "Recommended" order (in-stock → proven sellers → premium), keeping A–Z / price sorts selectable, without ever leaking the raw `popularity_score` to the client.

**Architecture:** The score-aware ranking runs server-side at the data-load chokepoint (`catalog-data.ts`), where the raw `popularity_score` is in scope. A pure, exported comparator (`recommendedRankKey` + `compareRecommended`) operates on RAW rows so it is unit-testable. `load()` becomes two-pass: (1) compute the p75 popularity cutoff over scored rows, (2) sort raw rows by the comparator, then project each via `toPublicProduct(row, tier)`. Products thus leave `getAllProducts()` already in Recommended order. `shop-query.ts` adds a `'recommended'` sort key that is the DEFAULT and a no-op (preserves incoming order); explicit sorts still re-sort. The only popularity-derived value that reaches the browser is a coarse `popularity_tier: 0|1|2`.

**Tech Stack:** TypeScript, Next.js (App Router) server components, Vitest. Test runner: `cd apps/catalog && npm test` (`vitest run`). Single-file runs: `cd apps/catalog && npx vitest run lib/__tests__/<file>`.

**Spec:** `docs/superpowers/specs/2026-06-21-shop-recommended-sort-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/catalog/lib/recommended-rank.ts` | NEW. Pure comparator: `recommendedRankKey(row)` → tuple-ish struct; `compareRecommended(a,b)`; `popularityCutoffP75(rows)`; `popularityTier(score, cutoff)`. Operates on RAW rows (reads raw `popularity_score`, raw `is_in_stock` via `isInStock`, `price`, `name`). No fs, no Next. | Create |
| `apps/catalog/lib/__tests__/recommended-rank.test.ts` | NEW. Unit tests for the comparator + cutoff + tier. | Create |
| `apps/catalog/lib/catalog-data.ts` | Add `popularity_tier` to `PUBLIC_FIELDS`; `toPublicProduct` gains `popularityTier?` param; `load()` becomes two-pass (cutoff → sort raw → project). | Modify |
| `apps/catalog/lib/types.ts` | Add `popularity_tier?: 0 \| 1 \| 2` to `PublicProduct`. | Modify |
| `apps/catalog/lib/__tests__/catalog-data.test.ts` | Add: tier values present & correct; raw score never on public object; recommended order from `getAllProducts()`. | Modify |
| `apps/catalog/lib/shop-query.ts` | Add `'recommended'` to `SortKey`/`SORTS`; default to it; no-op branch preserves order. | Modify |
| `apps/catalog/lib/__tests__/shop-query.test.ts` | Add: default sort key is `recommended`; recommended preserves input order; explicit sorts still reorder. | Modify |
| `apps/catalog/components/Filters.tsx` | Add "Recommended" as first sort option; treat it as the active default label. | Modify |
| `apps/catalog/lib/featured.ts` | Fix stale comment ("popularity_score is 0 for all"). | Modify |

---

## Task 1: Pure comparator module (`recommended-rank.ts`)

**Files:**
- Create: `apps/catalog/lib/recommended-rank.ts`
- Test: `apps/catalog/lib/__tests__/recommended-rank.test.ts`

This is the heart of the ranking. It works on RAW rows (`Record<string, unknown>`), because the raw `popularity_score` is deliberately absent from `PublicProduct`. Keeping it pure makes the score-aware order testable without leaking the score.

- [ ] **Step 1: Write the failing test**

Create `apps/catalog/lib/__tests__/recommended-rank.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  popularityCutoffP75,
  popularityTier,
  compareRecommended,
} from '@/lib/recommended-rank';

/** Raw-row factory (mirrors the live export shape: is_in_stock as "0"/"1"/bool). */
function r(o: Record<string, unknown>): Record<string, unknown> {
  return { sku: 'x', name: 'x', price: 100, ...o };
}

describe('popularityCutoffP75', () => {
  it('is the 75th-percentile of SCORED (>0) rows only', () => {
    // scores 1..8 scored; zeros/missing ignored. p75 of 1..8 → index ceil(0.75*8)-1 = 5 → value 6
    const rows = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => r({ popularity_score: s })),
      r({ popularity_score: 0 }),
      r({}),
    ];
    expect(popularityCutoffP75(rows)).toBe(6);
  });

  it('falls back to the max when fewer than 4 scored rows', () => {
    const rows = [r({ popularity_score: 0.2 }), r({ popularity_score: 0.9 })];
    expect(popularityCutoffP75(rows)).toBe(0.9);
  });

  it('returns Infinity when nothing is scored (no row reaches tier 2)', () => {
    expect(popularityCutoffP75([r({}), r({ popularity_score: 0 })])).toBe(Infinity);
  });
});

describe('popularityTier', () => {
  const cutoff = 6;
  it('0 for unscored / non-numeric / <= 0', () => {
    expect(popularityTier(undefined, cutoff)).toBe(0);
    expect(popularityTier(0, cutoff)).toBe(0);
    expect(popularityTier('5' as unknown, cutoff)).toBe(0);
  });
  it('2 for scored at/above cutoff', () => {
    expect(popularityTier(6, cutoff)).toBe(2);
    expect(popularityTier(9, cutoff)).toBe(2);
  });
  it('1 for scored below cutoff', () => {
    expect(popularityTier(0.001, cutoff)).toBe(1);
    expect(popularityTier(5.9, cutoff)).toBe(1);
  });
});

describe('compareRecommended (tuple order: stock → scored → score desc → price desc → name)', () => {
  it('in-stock sorts before out-of-stock regardless of score', () => {
    const inStockUnscored = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 10 });
    const outStockTopSeller = r({ sku: 'b', is_in_stock: '0', popularity_score: 1, price: 9999 });
    expect(compareRecommended(inStockUnscored, outStockTopSeller)).toBeLessThan(0);
  });

  it('within in-stock, scored sorts before unscored', () => {
    const scored = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.01, price: 10 });
    const unscored = r({ sku: 'b', is_in_stock: '1', popularity_score: 0, price: 9999 });
    expect(compareRecommended(scored, unscored)).toBeLessThan(0);
  });

  it('within scored, higher popularity sorts first', () => {
    const hi = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.9 });
    const lo = r({ sku: 'b', is_in_stock: '1', popularity_score: 0.1 });
    expect(compareRecommended(hi, lo)).toBeLessThan(0);
  });

  it('within unscored in-stock, higher price (premium) sorts first', () => {
    const premium = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 5000 });
    const cheap = r({ sku: 'b', is_in_stock: '1', popularity_score: 0, price: 100 });
    expect(compareRecommended(premium, cheap)).toBeLessThan(0);
  });

  it('breaks remaining ties by name A–Z (deterministic)', () => {
    const a = r({ sku: 'a', name: 'Alpha', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    const b = r({ sku: 'b', name: 'Beta', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    expect(compareRecommended(a, b)).toBeLessThan(0);
    expect(compareRecommended(b, a)).toBeGreaterThan(0);
  });

  it('a literal 0.0 score is treated as UNSCORED (not scored tier)', () => {
    const zero = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 100 });
    const scored = r({ sku: 'b', is_in_stock: '1', popularity_score: 0.0001, price: 100 });
    expect(compareRecommended(scored, zero)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommended-rank.test.ts`
Expected: FAIL — module `@/lib/recommended-rank` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/catalog/lib/recommended-rank.ts`:

```typescript
/**
 * recommended-rank — PURE ranking primitives for the shop's "Recommended" sort.
 *
 * Operates on RAW export rows (Record<string, unknown>), NOT PublicProduct,
 * because the raw `popularity_score` is DELIBERATELY absent from PublicProduct
 * (margin-leak allowlist). Keeping the score-aware comparator here, fed raw rows
 * at the catalog-data load chokepoint, is the only place the score is in scope
 * without it reaching the browser. No fs, no Next, no React — fully unit-tested.
 *
 * Ranking tuple (single source of truth; earlier = nearer the front of the grid):
 *   1. in stock         (in-stock before out-of-stock; null/absent → out)
 *   2. is scored        (scored before unscored; "scored" === number > 0)
 *   3. popularity score  DESC
 *   4. price (premium)   DESC
 *   5. name              A–Z (locale-aware, case-insensitive)
 */

import { isInStock } from './utils';

type Raw = Record<string, unknown>;

/** A number > 0, else null. Defines "scored" precisely (0.0 and non-numeric → unscored). */
function scoreOf(row: Raw): number | null {
  const s = row.popularity_score;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
}

function priceOf(row: Raw): number {
  const p = row.price;
  return typeof p === 'number' && !Number.isNaN(p) ? p : Number.NEGATIVE_INFINITY;
}

function nameOf(row: Raw): string {
  return typeof row.name === 'string' ? row.name : '';
}

/**
 * p75 cutoff over the SCORED (>0) population — the "top seller" boundary for
 * popularity_tier === 2. Only affects the cosmetic tier, NOT sort order.
 *  - < 4 scored rows  → max scored value (so only the max is tier 2; tiny-data guard)
 *  - 0 scored rows    → Infinity (no row can reach tier 2)
 */
export function popularityCutoffP75(rows: Raw[]): number {
  const scores = rows
    .map(scoreOf)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  if (scores.length === 0) return Infinity;
  if (scores.length < 4) return scores[scores.length - 1];
  // index of the 75th percentile (nearest-rank, 1-based ceil → 0-based)
  const idx = Math.ceil(0.75 * scores.length) - 1;
  return scores[idx];
}

/** Coarse, client-safe popularity bucket. 0 = no sales data, 1 = sells, 2 = top seller. */
export function popularityTier(score: unknown, cutoff: number): 0 | 1 | 2 {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return 0;
  return score >= cutoff ? 2 : 1;
}

/**
 * Comparator implementing the ranking tuple above. Returns <0 if `a` ranks ahead
 * of `b`. Stable & deterministic (name is the final tiebreak).
 */
export function compareRecommended(a: Raw, b: Raw): number {
  // 1. in stock (true before false)
  const sa = isInStock(a.is_in_stock) ? 0 : 1;
  const sb = isInStock(b.is_in_stock) ? 0 : 1;
  if (sa !== sb) return sa - sb;

  // 2. is scored (scored before unscored)
  const scA = scoreOf(a);
  const scB = scoreOf(b);
  const hasA = scA !== null ? 0 : 1;
  const hasB = scB !== null ? 0 : 1;
  if (hasA !== hasB) return hasA - hasB;

  // 3. popularity score DESC (only meaningful when both scored)
  if (scA !== null && scB !== null && scA !== scB) return scB - scA;

  // 4. price (premium) DESC
  const pa = priceOf(a);
  const pb = priceOf(b);
  if (pa !== pb) return pb - pa;

  // 5. name A–Z
  return nameOf(a).localeCompare(nameOf(b), 'en', { sensitivity: 'base' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommended-rank.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/recommended-rank.ts apps/catalog/lib/__tests__/recommended-rank.test.ts
git commit -m "feat(catalog): pure Recommended-sort comparator (stock→popularity→premium)"
```

---

## Task 2: Public type gains `popularity_tier`

**Files:**
- Modify: `apps/catalog/lib/types.ts`

- [ ] **Step 1: Add the field**

In `apps/catalog/lib/types.ts`, inside the `PublicProduct` interface, add after the `is_in_stock?` field (the last field before the closing brace):

```typescript
  // Coarse, client-SAFE popularity bucket derived server-side from popularity_score
  // (which is itself FORBIDDEN from the public shape). 0 = no sales data, 1 = sells,
  // 2 = top seller (>= p75 of scored population). Used to drive Recommended ordering
  // upstream and available for optional "Bestseller" badging. The raw score never ships.
  popularity_tier?: 0 | 1 | 2;
```

Also update the "DELIBERATELY ABSENT" doc block note: it says `popularity_*` are internal — add a clarifying line that `popularity_tier` is the ONE allowed coarse derivative, while `popularity_score`/`popularity_rank` remain forbidden.

- [ ] **Step 2: Typecheck (no test yet — exercised by Task 3)**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: clean (the `_AssertFieldsAreKnown` drift guard in catalog-data.ts will fail to compile in Task 3 only until `popularity_tier` is added to `PUBLIC_FIELDS` — that's expected and fixed there).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/types.ts
git commit -m "feat(catalog): add client-safe popularity_tier to PublicProduct"
```

---

## Task 3: Two-pass load + tier projection (`catalog-data.ts`)

**Files:**
- Modify: `apps/catalog/lib/catalog-data.ts`
- Test: `apps/catalog/lib/__tests__/catalog-data.test.ts`

This is where the raw rows get sorted (raw score in scope) and the tier is attached. **No rank key is ever written to the public object** — only `popularity_tier`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/catalog/lib/__tests__/catalog-data.test.ts`:

```typescript
import { compareRecommended } from '@/lib/recommended-rank';

describe('toPublicProduct — popularity_tier', () => {
  it('sets popularity_tier from the passed bucket and NEVER leaks popularity_score', () => {
    const pub = toPublicProduct(
      { sku: 'A', name: 'A', price: 100, popularity_score: 0.9, is_in_stock: true } as any,
      2,
    );
    expect(pub.popularity_tier).toBe(2);
    expect((pub as any).popularity_score).toBeUndefined();
  });
  it('defaults popularity_tier to 0 when no bucket passed', () => {
    const pub = toPublicProduct({ sku: 'A', name: 'A', price: 100 } as any);
    expect(pub.popularity_tier).toBe(0);
  });
  it('popularity_tier is in the allowlist (only-allowlisted-keys invariant holds)', () => {
    expect(PUBLIC_FIELDS).toContain('popularity_tier');
  });
});

describe('getAllProducts — Recommended order + no score leak', () => {
  const all = getAllProducts();
  it('NO public product carries popularity_score / popularity_rank', () => {
    for (const p of all) {
      expect((p as any).popularity_score).toBeUndefined();
      expect((p as any).popularity_rank).toBeUndefined();
    }
  });
  it('is globally sorted by the Recommended comparator', () => {
    // The array must already be in compareRecommended order. We can only re-check
    // with the SAFE fields the public product still carries, so we assert the
    // weaker-but-real invariant: in-stock products are never preceded by an
    // out-of-stock product (stock is the top tier and survives projection).
    let seenOutOfStock = false;
    for (const p of all) {
      const inStock = p.is_in_stock === true;
      if (!inStock) seenOutOfStock = true;
      else expect(seenOutOfStock, `in-stock ${p.sku} appears after an out-of-stock product`).toBe(false);
    }
  });
  it('within in-stock, a tier-2 product never appears after a tier-0 product', () => {
    let seenTier0 = false;
    for (const p of all) {
      if (p.is_in_stock !== true) break; // only check the in-stock block
      if (p.popularity_tier === 0) seenTier0 = true;
      if (p.popularity_tier === 2) {
        expect(seenTier0, `tier-2 ${p.sku} appears after a tier-0 in-stock product`).toBe(false);
      }
    }
  });
});
```

> Note: the raw-row comparator itself is exhaustively tested in Task 1. Here we
> assert the *projected* output preserves the tiers that survive projection
> (stock, popularity_tier), which is all the public shape can prove. The full
> score-aware order is covered by Task 1.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/catalog-data.test.ts`
Expected: FAIL — `popularity_tier` not in PUBLIC_FIELDS / not set; `toPublicProduct` has no 2nd param.

- [ ] **Step 3: Implement — allowlist + tier param + two-pass load**

In `apps/catalog/lib/catalog-data.ts`:

(a) Add `'popularity_tier'` to the `PUBLIC_FIELDS` array (end of the list, with a comment):

```typescript
  'category_group','category_type',
  // Coarse client-SAFE popularity bucket (0/1/2). Derived server-side from the
  // FORBIDDEN popularity_score; the raw score itself is never copied. Set by the
  // popularityTier argument below, NOT read from the raw row's popularity_* keys.
  'popularity_tier',
```

(b) Add the import at the top:

```typescript
import { compareRecommended, popularityCutoffP75, popularityTier } from './recommended-rank';
```

(c) Change `toPublicProduct` signature + set the tier (after the `is_in_stock` coercion, before `return`):

```typescript
export function toPublicProduct(
  raw: Record<string, unknown>,
  popularityTierBucket: 0 | 1 | 2 = 0,
): PublicProduct {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  if ('is_in_stock' in out) out.is_in_stock = isInStock(out.is_in_stock);
  // Attach the coarse tier. NOTE: 'popularity_tier' is in PUBLIC_FIELDS, but the raw
  // export does NOT carry that key (it carries popularity_score, which is forbidden),
  // so the allowlist loop above never copies it — we set it explicitly here from the
  // caller-computed bucket. The raw score is never written to `out`.
  out.popularity_tier = popularityTierBucket;
  return out as unknown as PublicProduct;
}
```

(d) Rewrite `load()` as two-pass:

```typescript
function load(): void {
  const file = exportPath();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse catalog export at ${file}: ${(e as Error).message}`);
  }
  const rows: Record<string, unknown>[] = (Array.isArray(raw)
    ? raw
    : ((raw as { products?: unknown[] })?.products ?? [])) as Record<string, unknown>[];

  // PASS 1 — cutoff over the scored population (raw popularity_score in scope).
  const cutoff = popularityCutoffP75(rows);

  // SORT raw rows by the Recommended comparator (raw score still in scope).
  // Shallow copy: do not mutate the parsed array in place beyond our own copy.
  const sortedRows = [...rows].sort(compareRecommended);

  // PASS 2 — project each sorted raw row, deriving the client-safe tier.
  const all: PublicProduct[] = [];
  const bySku = new Map<string, PublicProduct>();
  for (const row of sortedRows) {
    const tier = popularityTier(row.popularity_score, cutoff);
    const p = toPublicProduct(row, tier);
    all.push(p);
    if (p.sku) bySku.set(p.sku, p);
  }
  _all = all;
  _bySku = bySku;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/catalog-data.test.ts`
Expected: PASS. Also run the loader/path sibling tests to ensure no regression:
`cd apps/catalog && npx vitest run lib/__tests__/catalog-data.loader.test.ts lib/__tests__/catalog-data.path.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (drift guard now satisfied)**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: clean — `popularity_tier` is now in both `PUBLIC_FIELDS` and `PublicProduct`.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/lib/catalog-data.ts apps/catalog/lib/__tests__/catalog-data.test.ts
git commit -m "feat(catalog): two-pass load — rank raw rows, attach client-safe popularity_tier"
```

---

## Task 4: `recommended` sort key, default + no-op (`shop-query.ts`)

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts`
- Test: `apps/catalog/lib/__tests__/shop-query.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/catalog/lib/__tests__/shop-query.test.ts`:

```typescript
describe('applyShopQuery — recommended sort (default)', () => {
  // Input order here stands in for the pre-ranked order from getAllProducts().
  const preRanked = [
    p({ sku: 'c', name: 'Cherry', price: 50 }),
    p({ sku: 'a', name: 'Apple', price: 999 }),
    p({ sku: 'b', name: 'Banana', price: 10 }),
  ];

  it('no sort param → preserves incoming (pre-ranked) order, NOT A–Z', () => {
    const r = applyShopQuery(preRanked, {});
    expect(r.items.map((x) => x.sku)).toEqual(['c', 'a', 'b']);
  });

  it('sort=recommended → also preserves incoming order', () => {
    const r = applyShopQuery(preRanked, { sort: 'recommended' });
    expect(r.items.map((x) => x.sku)).toEqual(['c', 'a', 'b']);
  });

  it('explicit sort=name still reorders A–Z (override works)', () => {
    const r = applyShopQuery(preRanked, { sort: 'name' });
    expect(r.items.map((x) => x.sku)).toEqual(['a', 'b', 'c']);
  });

  it('explicit sort=price-asc still reorders cheapest-first', () => {
    const r = applyShopQuery(preRanked, { sort: 'price-asc' });
    expect(r.items.map((x) => x.sku)).toEqual(['b', 'c', 'a']);
  });

  it('unknown sort value falls back to recommended (preserves order)', () => {
    const r = applyShopQuery(preRanked, { sort: 'bogus' });
    expect(r.items.map((x) => x.sku)).toEqual(['c', 'a', 'b']);
  });
});
```

> Heads-up for the implementer: existing tests in this file that relied on the
> OLD default (A–Z) and pass products in non-alpha order WITHOUT a `sort` param
> may now fail because the default changed. If any do, they were asserting the
> incidental old default — update them to pass `sort: 'name'` explicitly (that is
> the behavior they meant). Do NOT weaken the new default to keep them green
> (CLAUDE.md Rule 5: don't lock in the old behavior). Search the file for
> `applyShopQuery(` calls that assert order without a `sort` key.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: the NEW recommended tests FAIL (default still `name`); note any incidental old-default failures to fix in Step 3.

- [ ] **Step 3: Implement**

In `apps/catalog/lib/shop-query.ts`:

(a) Extend the type (line ~58):

```typescript
export type SortKey = 'recommended' | 'name' | 'price-asc' | 'price-desc';
```

(b) Extend the `SORTS` map (line ~89):

```typescript
const SORTS: Record<string, SortKey> = {
  recommended: 'recommended',
  name: 'name',
  'price-asc': 'price-asc',
  'price-desc': 'price-desc',
};
```

(c) Change the default + add the no-op branch in `applyShopQuery` (lines ~187-197):

```typescript
  const sortKey: SortKey = SORTS[firstParam(params.sort) ?? ''] ?? 'recommended';
  const sorted = [...items];
  if (sortKey === 'recommended') {
    // No-op: products arrive PRE-RANKED from getAllProducts() (the Recommended
    // order is computed server-side at load, where the raw popularity_score is in
    // scope). `items` is filter()'d from that array, so it already preserves the
    // Recommended order. Intentionally do NOT sort here.
  } else if (sortKey === 'name') {
    sorted.sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }),
    );
  } else if (sortKey === 'price-asc') {
    sorted.sort((a, b) => priceOf(a) - priceOf(b));
  } else {
    sorted.sort((a, b) => priceOf(b) - priceOf(a));
  }
```

(d) Update the file's top-of-file Sort doc comment (the block listing `name (default)…`) to read:

```
 *   recommended (default) → business order computed at load (in-stock → proven
 *                 sellers → premium); applyShopQuery preserves the pre-ranked order
 *   name           → A–Z by name (locale-aware, case-insensitive)
 *   price-asc      → cheapest first
 *   price-desc     → most expensive first
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS (new tests green; any old-default tests updated to `sort: 'name'`).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "feat(catalog): recommended is the default shop sort (no-op; pre-ranked at load)"
```

---

## Task 5: "Recommended" in the sort dropdown (`Filters.tsx`)

**Files:**
- Modify: `apps/catalog/components/Filters.tsx`

- [ ] **Step 1: Add the option + fix the default label**

In `apps/catalog/components/Filters.tsx`, change `SORT_OPTIONS` (lines ~82-86):

```typescript
const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'price-asc', label: 'Price: low → high' },
  { id: 'price-desc', label: 'Price: high → low' },
];
```

Then make the closed-trigger label show "Recommended" when no `sort` param is set (it is the default). Change the `sortLabel` line (~413):

```typescript
  const sortLabel =
    SORT_OPTIONS.find((s) => s.id === (activeSort || 'recommended'))?.label ?? 'Sort';
```

> Leave the `activeSort ? 'text-primary' : 'text-foreground'` trigger styling as-is:
> with no param the default reads as "Recommended" in the neutral foreground color,
> which correctly signals "you haven't overridden the sort."

- [ ] **Step 2: Typecheck**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/Filters.tsx
git commit -m "feat(catalog): surface 'Recommended' as the default sort option in Filters"
```

---

## Task 6: Fix the stale `featured.ts` comment

**Files:**
- Modify: `apps/catalog/lib/featured.ts`

- [ ] **Step 1: Correct the now-false premise**

In `apps/catalog/lib/featured.ts`, the header comment claims "popularity_score is 0 for all 11,436 products." That is now false (3,294 rows are nonzero post-BI-backfill). Replace the "WHY THIS IS A MANUAL LIST" paragraph's stale sentence with an accurate one, e.g.:

```
 * WHY THIS IS A MANUAL LIST (not auto "best-selling"):
 *   popularity_score now exists for ~29% of products (BI backfill, 2026-06), but
 *   it is sparse and skewed, so it drives the /shop Recommended ORDER rather than a
 *   home-page "best seller" claim. The Featured row stays a hand-picked, confident
 *   set presented honestly as "From the collection" — never as a popularity ranking.
```

Keep the rest of the comment (the per-SKU verification criteria) unchanged.

- [ ] **Step 2: Typecheck + featured tests if any**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: clean. (Comment-only change; no behavior.)

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/featured.ts
git commit -m "docs(catalog): correct stale 'popularity_score is 0' comment in featured.ts"
```

---

## Task 7: Full suite + browser verification (CLAUDE.md Rule 7)

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd apps/catalog && npm test`
Expected: ALL green. If any unrelated test broke, fix the root cause (do not skip).

- [ ] **Step 2: Typecheck whole app**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: clean — proves the leak guard (no `popularity_score` on the public type).

- [ ] **Step 3: Start the dev server**

Run: `cd apps/catalog && npm run dev` (serves on the configured port; the user's is `http://localhost:3212`).

- [ ] **Step 4: Browser walkthrough**

Open `http://localhost:3212/shop` and verify:
- The sort control reads **"Recommended"** by default.
- The first page leads with **in-stock** products; paging toward the end shows **out-of-stock** items sinking to the last pages.
- High-price / known-popular items appear near the front (spot-check a couple of SKUs).
- Switching the dropdown to **Name A–Z** and **Price** visibly reorders the grid; clearing back to Recommended restores the ranked order.
- Apply a filter (e.g. a Category chip) — the grid still leads with in-stock and the count badge still matches the grid (facet counts unaffected).

- [ ] **Step 5: Confirm no score leak in the client payload**

In the browser DevTools (Network/Elements) or via `view-source`, confirm the serialized product data exposes `popularity_tier` but **no** `popularity_score` / `popularity_rank` / `margin_pct`. (The allowlist + drift guard already prove this structurally; this is the Rule-7 visual confirmation.)

- [ ] **Step 6: Final commit (if any verification tweaks)**

```bash
git add -A
git commit -m "test(catalog): verify Recommended sort end-to-end (suite + browser)"
```

---

## Notes for the implementer

- **Do not add `popularity_score` to `PUBLIC_FIELDS`** under any circumstance — that is the exact margin-leak failure the allowlist exists to prevent. Only `popularity_tier` is allowed out.
- **The comparator is the single source of truth** for order. If a test and the prose disagree, the comparator in Task 1 wins.
- **Pre-ranking happens once at load** (process-cached SSG). Popularity syncs daily; the order refreshes on the next cold load / rebuild. No per-request sorting for the default — that's intentional and cheap.
- The popularity signal currently covers ~29% of products and is skewed (median 0.088); the order is correct but the lever is weak until the BI backfill widens. Not a blocker; don't try to "fix" coverage here.
```
