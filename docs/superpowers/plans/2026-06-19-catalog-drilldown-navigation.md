# WNLQ9 Catalog — Dynamic Drill-Down Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add progressive category (group → sub-category) and geography (country → region → sub-region) drill-down to the shop, with context-aware option counts, a drill-down breadcrumb, and "More filters" converted from free-text inputs to real dropdowns/searchable selects.

**Architecture:** A single shared pure predicate `matchesFilters(product, params)` becomes the one source of filter truth, used by BOTH the grid (`applyShopQuery`) and the new context-aware facet counts (`facets.ts`). The shop page (already dynamic — it reads `searchParams`) computes the three available-option lists server-side and passes them as `{value,count}[]` props into the existing client `Filters` component, which stays a thin URL-writer. A new `DrillBreadcrumb` shows the active path. "More filters" inputs become shadcn `Select` (body/acidity/tannin from the normalized 4-step scale) and searchable typeaheads (grape/flavor).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, shadcn/ui (Select, Command/Popover), Vitest + @testing-library/react.

---

## Context the implementer MUST know before starting

This is an **extension of already-shipped code**, not a greenfield build. Read these first:

- **`apps/catalog/lib/shop-query.ts`** — the pure `applyShopQuery(products, params)` engine. It ALREADY handles `group`, `price`, `country` (exact, case-insensitive), `inStock`, `region` (**substring**), `grape` (substring), `flavor` (exact-in-array), `body`/`acidity`/`tannin` (**exact** case-insensitive — NOTE: not yet normalized), `hasScore`, `sort`, pagination (`SHOP_PAGE_SIZE = 24`). Helpers `firstParam` and `norm` live here. **Do NOT rewrite this file's behavior — factor its per-product predicate out into `matchesFilters` and have `applyShopQuery` call it.**
- **`apps/catalog/lib/category-groups.ts`** — ALREADY has `groupForProduct(p)` (SKU-prefix override of the unreliable `classification`), `groupForClassification`, `classificationsInGroup`, and `accessoryCategoryForSku(sku)` (returns `'Wine Fridges & Coolers' | 'Glassware' | 'Cigars' | 'Events' | 'Bar Tools & Gifts' | null`). **§6.5 of the spec is already implemented here — do not re-do it.** You only CONSUME these functions.
- **`apps/catalog/lib/taste-adapter.ts`** — `normalizeScale(axis, value)` maps a raw structural value into the 4-step scale. Scales: body `['Light','Medium','Medium-Full','Full']`, acidity & tannin `['Low','Medium','Medium-High','High']`. Returns `null` for empty/unknown. Use this for the body/acidity/tannin dropdown options AND when matching them in the filter (so a product stored "Medium-Full" acidity matches the "Medium-High" option — wait: read the remap; "Medium-Full" is a body value that maps... verify in Task 5).
- **`apps/catalog/lib/build-query.ts`** — `buildQuery(current: URLSearchParams, patch: Record<string,string|null>): string`. A `null` value in the patch DELETES that key. This is how Filters writes the URL. It does NOT clear descendants automatically — that's the new `clearDescendants` helper's job.
- **`apps/catalog/components/Filters.tsx`** — client component, URL is source of truth via `useSearchParams`. Currently renders group chips, price chips, Country dropdown, Sort dropdown, in-stock toggle, "More filters" expander with **free-text `TextFilter` inputs** for region/grape/flavor/body/acidity/tannin. You will EXTEND it (add drill-down chip rows, convert inputs to dropdowns). Keep it a thin renderer — counts/options come in as props.
- **`apps/catalog/app/shop/page.tsx`** — server component. Calls `getAllProducts()`, `applyShopQuery(products, searchParams)`, renders `<Suspense><Filters .../></Suspense>` + grid + pagination. You will EXTEND it to compute facet lists and pass them down, and to render `<DrillBreadcrumb>`.
- **`PublicProduct`** (`lib/types.ts`) has: `sku`, `classification?`, `country?`, `region?`, `subregion?`, `grape_variety?`, `flavor_tags?: string[]`, `wine_body?`, `wine_acidity?`, `wine_tannin?`. **All optional.** Geo coverage is partial (some products have no country/region/subregion) — that is expected; missing-geo products simply don't appear under a geo filter.
- **Tests** live in `apps/catalog/lib/__tests__/*.test.ts` and `apps/catalog/components/__tests__/*.test.tsx`. Run a single file: `cd apps/catalog && npx vitest run lib/__tests__/<file>.test.ts`. Run all: `cd apps/catalog && npx vitest run`. There are ~139 existing tests that must stay green.

**Spec:** `docs/superpowers/specs/2026-06-19-catalog-drilldown-navigation-design.md` — §3 URL model, §4 components, §5 edge cases, §6 tests, §6.6 dropdowns. Read §4.1's input-set table — it is the exact contract for facet counts.

**Run all commands from `apps/catalog/` unless stated otherwise.** Commit after every task. Keep files focused; nothing over ~500 lines.

---

## File structure (what each unit owns)

| File | New/Modify | Responsibility |
|---|---|---|
| `lib/shop-query.ts` | Modify | Factor predicate into exported `matchesFilters(product, params)`; add `class` (first-segment exact) + `subregion` (substring) + normalize body/acidity/tannin matching. `applyShopQuery` calls `matchesFilters`. |
| `lib/drill-query.ts` | **New** | `clearDescendants(strand, value)` pure helper → the multi-key patch that clears descendant params when a parent changes (§3). Small, pure, unit-tested. |
| `lib/facets.ts` | **New** | `subCategoriesFor`, `regionsFor`, `subRegionsFor`, `accessorySubCategoriesFor`, `valuesFor` — context-aware `{value,count}[]`, only options with ≥1 product, sorted. Pure. |
| `components/ui/select.tsx` | **New** | shadcn Select primitive (Radix) — for body/acidity/tannin/sweetness dropdowns. |
| `components/ui/command.tsx` + `popover.tsx` | **New** | shadcn Command (cmdk) + Popover — for the grape/flavor searchable typeahead. |
| `components/SearchableSelect.tsx` | **New** | Thin wrapper: a typeahead built on Command+Popover; props `{label, value, options, onSelect, placeholder}`. Used for grape & flavor. |
| `components/DrillBreadcrumb.tsx` | **New** | Active-path breadcrumb (category strand + geo strand), each crumb a link that jumps back / clears deeper; "Clear all". |
| `components/Filters.tsx` | Modify | Add sub-category / region / sub-region chip rows (progressive reveal, with counts); convert "More filters" text inputs → Select (body/acidity/tannin) + SearchableSelect (grape/flavor); use `clearDescendants` on parent changes. Accepts new props. |
| `app/shop/page.tsx` | Modify | Pass `class`/`subregion` to query; compute facet lists per §4.1 input-set rule; pass option lists into `<Filters>`; render `<DrillBreadcrumb>`. |

---

## Task 1: Factor the shared `matchesFilters` predicate + add `class`/`subregion`

**Why first:** Everything else (facets, grid, breadcrumb counts) depends on ONE predicate. Build it before any consumer.

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts`
- Test: `apps/catalog/lib/__tests__/shop-query.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests for the new params + the factored predicate**

Add to `lib/__tests__/shop-query.test.ts`. Build small product fixtures inline (only the fields the filter reads). Use the real `applyShopQuery` (it must keep working) AND the newly-exported `matchesFilters`.

```ts
import { applyShopQuery, matchesFilters } from '../shop-query';

const P = (over: Partial<import('../types').PublicProduct>): import('../types').PublicProduct =>
  ({ sku: 'W1', name: 'x', ...over } as import('../types').PublicProduct);

describe('matchesFilters — class (first-segment classification)', () => {
  it('matches first segment case-insensitively', () => {
    const p = P({ sku: 'W1', classification: 'Red Wine|Fruit Wine' });
    expect(matchesFilters(p, { class: 'red wine' })).toBe(true);
    expect(matchesFilters(p, { class: 'fruit wine' })).toBe(false); // only first segment
  });
  it('no class param → no constraint', () => {
    expect(matchesFilters(P({ classification: 'Gin' }), {})).toBe(true);
  });
});

describe('matchesFilters — Accessories class = accessory sub-category (NOT classification)', () => {
  it('matches accessoryCategoryForSku when group is Accessories', () => {
    // A glassware SKU mislabeled "Wine product" in classification.
    const p = P({ sku: 'GWN1', classification: 'Wine product' });
    expect(matchesFilters(p, { group: 'Accessories', class: 'Glassware' })).toBe(true);
    expect(matchesFilters(p, { group: 'Accessories', class: 'Cigars' })).toBe(false);
  });
  it('an AWC fridge matches the "Wine Fridges & Coolers" accessory class', () => {
    const p = P({ sku: 'AWC100', classification: 'Wine product' });
    expect(matchesFilters(p, { group: 'Accessories', class: 'Wine Fridges & Coolers' })).toBe(true);
  });
  it('for a NON-Accessories group, class still means classification first-segment', () => {
    const p = P({ sku: 'W1', classification: 'Red Wine' });
    expect(matchesFilters(p, { group: 'Wine', class: 'Red Wine' })).toBe(true);
  });
});

describe('matchesFilters — subregion (substring, like region)', () => {
  const p = P({ region: 'Bordeaux', subregion: 'Pauillac' });
  it('substring-matches subregion case-insensitively', () => {
    expect(matchesFilters(p, { subregion: 'pauil' })).toBe(true);
    expect(matchesFilters(p, { subregion: 'margaux' })).toBe(false);
  });
});

describe('matchesFilters — combined drill-down AND', () => {
  it('all of group+class+country+region+subregion must hold', () => {
    const p = P({ sku: 'W1', classification: 'Red Wine', country: 'France',
      region: 'Bordeaux', subregion: 'Pauillac' });
    const params = { group: 'Wine', class: 'Red Wine', country: 'France',
      region: 'Bordeaux', subregion: 'Pauillac' };
    expect(matchesFilters(p, params)).toBe(true);
    expect(matchesFilters(p, { ...params, subregion: 'Margaux' })).toBe(false);
  });
});

describe('applyShopQuery still honors everything via matchesFilters', () => {
  it('class filter narrows the grid', () => {
    const items = [
      P({ sku: 'W1', classification: 'Red Wine' }),
      P({ sku: 'W2', classification: 'White Wine' }),
    ];
    const r = applyShopQuery(items, { class: 'Red Wine' });
    expect(r.total).toBe(1);
    expect(r.pageItems[0].sku).toBe('W1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: FAIL — `matchesFilters` is not exported / `class` & `subregion` not honored.

- [ ] **Step 3: Refactor `shop-query.ts` — extract `matchesFilters`, add `class` + `subregion`**

In `lib/shop-query.ts`, export a new pure predicate and have the filter `.filter()` call it. Add the two new params. Keep `firstParam`/`norm`/`tierById` usage identical. The existing import line `import { groupForProduct, type CategoryGroup } from './category-groups';` must be widened to also import `accessoryCategoryForSku` (used by the Accessories `class` branch):

```ts
import { groupForProduct, accessoryCategoryForSku, type CategoryGroup } from './category-groups';
```

```ts
/**
 * The SINGLE per-product filter predicate. Used by BOTH applyShopQuery (grid)
 * and facets.ts (context-aware counts) so they can never diverge.
 *
 * All params optional; absent = no constraint. AND semantics.
 *   group     → groupForProduct(p) === group (SKU-prefix override)
 *   class     → (a) when the product's group is Accessories: accessoryCategoryForSku(p.sku) === value (ci)
 *               (b) otherwise: first-segment classification (split('|')[0], trimmed) === value (ci)
 *   price     → price in [tier.min, tier.max)
 *   country   → exact (ci)
 *   region    → substring (ci)
 *   subregion → substring (ci)
 *   grape     → substring (ci) on grape_variety
 *   flavor    → flavor_tags includes value (ci)
 *   body/acidity/tannin → normalizeScale(axis, p.value) === value (ci)  [see Task 5]
 *   inStock=1 → isInStock(p.is_in_stock)
 *   hasScore=1→ non-empty score_summary
 */
export function matchesFilters(p: PublicProduct, params: ShopParams): boolean {
  const productGroup = groupForProduct(p); // resolve once — also drives the class branch

  const group = firstParam(params.group);
  if (group && productGroup !== (group as CategoryGroup)) return false;

  const klass = norm(firstParam(params.class));
  if (klass) {
    if (productGroup === 'Accessories') {
      // In the Accessories group, `class` is an accessory SUB-CATEGORY (Glassware,
      // Cigars, Wine Fridges & Coolers, …) keyed off the SKU prefix — the raw
      // `classification` is unreliable for accessories (§6.5). MUST match the grid
      // and facets, which both use accessoryCategoryForSku.
      if (norm(accessoryCategoryForSku(p.sku)) !== klass) return false;
    } else {
      const first = norm((p.classification ?? '').split('|')[0]);
      if (first !== klass) return false;
    }
  }

  const priceId = firstParam(params.price);
  const tier = priceId ? tierById(priceId) : undefined;
  if (tier) {
    const price = p.price;
    if (typeof price !== 'number' || Number.isNaN(price)) return false;
    if (price < tier.min || price >= tier.max) return false;
  }

  const country = norm(firstParam(params.country));
  if (country && norm(p.country) !== country) return false;

  const region = norm(firstParam(params.region));
  if (region && !norm(p.region).includes(region)) return false;

  const subregion = norm(firstParam(params.subregion));
  if (subregion && !norm(p.subregion).includes(subregion)) return false;

  const grape = norm(firstParam(params.grape));
  if (grape && !norm(p.grape_variety).includes(grape)) return false;

  const flavor = norm(firstParam(params.flavor));
  if (flavor) {
    const tags = p.flavor_tags;
    if (!Array.isArray(tags) || !tags.some((t) => norm(t) === flavor)) return false;
  }

  // body/acidity/tannin: Task 5 swaps these to normalizeScale comparison.
  const body = norm(firstParam(params.body));
  if (body && norm(p.wine_body) !== body) return false;
  const acidity = norm(firstParam(params.acidity));
  if (acidity && norm(p.wine_acidity) !== acidity) return false;
  const tannin = norm(firstParam(params.tannin));
  if (tannin && norm(p.wine_tannin) !== tannin) return false;

  if (firstParam(params.inStock) === '1' && !isInStock(p.is_in_stock)) return false;
  if (firstParam(params.hasScore) === '1' &&
      !(typeof p.score_summary === 'string' && p.score_summary.trim() !== '')) return false;

  return true;
}
```

Then in `applyShopQuery`, replace the inline `products.filter((p) => { ... })` body with:

```ts
const items = products.filter((p) => matchesFilters(p, params));
```

Delete the now-dead local consts that were only used by the old inline filter (group/tier/country/etc.) — but KEEP `sort` and pagination logic untouched. Update the file-top doc comment to mention `class`, `subregion`, and that `matchesFilters` is the shared predicate.

- [ ] **Step 4: Run tests to verify they pass (and nothing regressed)**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS — all new + all pre-existing shop-query tests green.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "feat(catalog): factor matchesFilters predicate; add class + subregion drill-down params"
```

---

## Task 2: `clearDescendants` patch helper (parent change resets children)

> **Approved deviation from spec §3/§6:** the spec places `clearDescendants` inside `lib/build-query.ts`. This plan puts it in its own `lib/drill-query.ts` instead, to keep `buildQuery` a single-purpose generic patch applier and isolate the drill-down strand knowledge. Every consumer in this plan imports it from `@/lib/drill-query`. Spec tests that import it "from build-query" should import from `drill-query`. This is a deliberate design improvement, not an oversight.

**Files:**
- Create: `apps/catalog/lib/drill-query.ts`
- Test: `apps/catalog/lib/__tests__/drill-query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { clearDescendants } from '../drill-query';

describe('clearDescendants', () => {
  it('new group clears class', () => {
    expect(clearDescendants('group', 'Wine')).toEqual({ group: 'Wine', class: null });
  });
  it('new class sets only class', () => {
    expect(clearDescendants('class', 'Red Wine')).toEqual({ class: 'Red Wine' });
  });
  it('new country clears region + subregion', () => {
    expect(clearDescendants('country', 'France'))
      .toEqual({ country: 'France', region: null, subregion: null });
  });
  it('new region clears subregion', () => {
    expect(clearDescendants('region', 'Bordeaux'))
      .toEqual({ region: 'Bordeaux', subregion: null });
  });
  it('new subregion sets only subregion', () => {
    expect(clearDescendants('subregion', 'Pauillac')).toEqual({ subregion: 'Pauillac' });
  });
  it('null value clears the strand AND its descendants (deselect)', () => {
    expect(clearDescendants('country', null))
      .toEqual({ country: null, region: null, subregion: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/drill-query.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `drill-query.ts`**

```ts
/**
 * Drill-down strand helpers. The two strands and their descendant chains:
 *   category: group → class
 *   geography: country → region → subregion
 *
 * When a user changes a parent level, the deeper levels become invalid and MUST
 * be cleared (§3 of the design). buildQuery() does NOT do this — it's a generic
 * patch applier — so callers use clearDescendants to build the multi-key patch.
 *
 * Pure. No Next/React.
 */

export type DrillStrand = 'group' | 'class' | 'country' | 'region' | 'subregion';

/** Descendants cleared when each strand changes. */
const DESCENDANTS: Record<DrillStrand, DrillStrand[]> = {
  group: ['class'],
  class: [],
  country: ['region', 'subregion'],
  region: ['subregion'],
  subregion: [],
};

/**
 * Patch that sets `strand` to `value` (or removes it when value is null) and
 * clears every descendant param. Pass to buildQuery().
 */
export function clearDescendants(
  strand: DrillStrand,
  value: string | null,
): Record<string, string | null> {
  const patch: Record<string, string | null> = { [strand]: value };
  for (const d of DESCENDANTS[strand]) patch[d] = null;
  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/drill-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/drill-query.ts apps/catalog/lib/__tests__/drill-query.test.ts
git commit -m "feat(catalog): clearDescendants helper for drill-down parent/child param resets"
```

---

## Task 3: `facets.ts` — context-aware option lists with counts

**Files:**
- Create: `apps/catalog/lib/facets.ts`
- Test: `apps/catalog/lib/__tests__/facets.test.ts`

**Contract (spec §4.1):** each function takes a **pre-filtered** product set (the shop page builds it by applying every active filter EXCEPT the strand being enumerated) and returns `{value, count}[]`, sorted, with **zero-count options omitted**.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  subCategoriesFor, regionsFor, subRegionsFor, accessorySubCategoriesFor,
} from '../facets';
import type { PublicProduct } from '../types';

const P = (o: Partial<PublicProduct>): PublicProduct => ({ sku: 'W1', name: 'x', ...o } as PublicProduct);

describe('subCategoriesFor', () => {
  it('returns first-segment classifications in the group, with counts, sorted, no zeroes', () => {
    const set = [
      P({ sku: 'W1', classification: 'Red Wine' }),
      P({ sku: 'W2', classification: 'Red Wine|Fruit Wine' }),
      P({ sku: 'W3', classification: 'White Wine' }),
      P({ sku: 'LG1', classification: 'Gin' }), // not Wine → excluded
    ];
    expect(subCategoriesFor('Wine', set)).toEqual([
      { value: 'Red Wine', count: 2 },
      { value: 'White Wine', count: 1 },
    ]);
  });
  it('empty input → []', () => {
    expect(subCategoriesFor('Wine', [])).toEqual([]);
  });
});

describe('accessorySubCategoriesFor', () => {
  it('groups accessories by accessoryCategoryForSku with counts; omits zero-count categories', () => {
    const set = [
      P({ sku: 'AWC100' }), P({ sku: 'AWC200' }), // Wine Fridges & Coolers x2
      P({ sku: 'GWN1' }),                          // Glassware x1
      P({ sku: 'CIG1' }),                          // Cigars x1
      P({ sku: 'W500' }),                          // not an accessory → ignored
    ];
    const out = accessorySubCategoriesFor(set);
    // sorted ascending by value, only present sub-categories
    expect(out).toEqual([
      { value: 'Cigars', count: 1 },
      { value: 'Glassware', count: 1 },
      { value: 'Wine Fridges & Coolers', count: 2 },
    ]);
    // Bar Tools & Gifts has no products here → must not appear at all.
    expect(out).not.toContainEqual(expect.objectContaining({ value: 'Bar Tools & Gifts' }));
  });
});

describe('regionsFor / subRegionsFor', () => {
  const set = [
    P({ country: 'France', region: 'Bordeaux', subregion: 'Pauillac' }),
    P({ country: 'France', region: 'Bordeaux', subregion: 'Margaux' }),
    P({ country: 'France', region: 'Burgundy', subregion: '' }),
  ];
  it('regionsFor returns distinct regions with counts (zeroes omitted)', () => {
    expect(regionsFor('France', set)).toEqual([
      { value: 'Bordeaux', count: 2 },
      { value: 'Burgundy', count: 1 },
    ]);
  });
  it('subRegionsFor returns distinct non-empty subregions with counts', () => {
    expect(subRegionsFor('Bordeaux', set.filter((p) => p.region === 'Bordeaux'))).toEqual([
      { value: 'Margaux', count: 1 },
      { value: 'Pauillac', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/facets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `facets.ts`**

```ts
/**
 * facets.ts — context-aware option lists for the shop drill-down.
 *
 * Each function takes a PRE-FILTERED product set (the shop page applies every
 * active filter EXCEPT the strand being enumerated; see design §4.1 input-set
 * table) and returns the available next-level options WITH counts: only options
 * with >=1 product (no dead-ends), sorted. Pure, O(n) per call.
 */

import type { PublicProduct } from './types';
import {
  type CategoryGroup,
  groupForProduct,
  accessoryCategoryForSku,
} from './category-groups';

export interface FacetOption {
  value: string;
  count: number;
}

/** Tally a key-extractor over products → sorted {value,count}[], dropping empties. */
function tally(
  products: PublicProduct[],
  key: (p: PublicProduct) => string | null | undefined,
): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const raw = key(p);
    const v = (raw ?? '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));
}

/** First-segment classification, but only for products in `group`. */
export function subCategoriesFor(
  group: CategoryGroup,
  products: PublicProduct[],
): FacetOption[] {
  return tally(
    products.filter((p) => groupForProduct(p) === group),
    (p) => (p.classification ?? '').split('|')[0],
  );
}

/** Accessory sub-categories (Glassware / Cigars / Events / Wine Fridges & Coolers / Bar Tools & Gifts). */
export function accessorySubCategoriesFor(products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => accessoryCategoryForSku(p.sku));
}

/** Distinct regions present (caller passes the country-filtered set). */
export function regionsFor(_country: string, products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => p.region);
}

/** Distinct sub-regions present (caller passes the region-filtered set). */
export function subRegionsFor(_region: string, products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => p.subregion);
}
```

> YAGNI: this feature uses **fixed normalized scales** for the body/acidity/tannin dropdowns (spec §6.6 MINIMUM), so a generic `valuesFor(field)` context-aware attribute facet is NOT built. If the §6.6 "nice-to-have" context-aware attribute counts are added later, that's the seam — but don't build it now.

> The `_country`/`_region` args are accepted for call-site clarity/symmetry even though the caller pre-filters; keep them (prefixed `_`) so the shop page reads `regionsFor(country, set)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/facets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/facets.ts apps/catalog/lib/__tests__/facets.test.ts
git commit -m "feat(catalog): context-aware facet option lists (sub-category/region/sub-region/attribute) with counts"
```

---

## Task 4: Count-accuracy invariant test (facets ≡ grid)

**Why a separate task:** This is the spec's REQUIRED cross-check (§6) — a facet option's count must equal the grid total after selecting it. It guards against `matchesFilters` and `facets.ts` ever diverging. It uses REAL data.

**Files:**
- Test: `apps/catalog/lib/__tests__/facets.invariant.test.ts`

- [ ] **Step 1: Write the invariant test (real data via getAllProducts)**

```ts
import { getAllProducts } from '../catalog-data';
import { applyShopQuery, matchesFilters } from '../shop-query';
import { regionsFor, accessorySubCategoriesFor } from '../facets';

describe('facet count consistent with grid total (context-aware invariant)', () => {
  const all = getAllProducts();

  it('every region facet under group=Wine: count subset of grid, and grid >= count', () => {
    // Input set for regionsFor = everything active EXCEPT region/subregion → here just group=Wine.
    const wine = all.filter((p) => matchesFilters(p, { group: 'Wine' }));
    const regions = regionsFor('', wine);
    expect(regions.length).toBeGreaterThan(0);

    // Spot-check the top few regions to keep the test fast.
    for (const { value, count } of regions.slice(0, 5)) {
      const params = { group: 'Wine', region: value };
      const grid = applyShopQuery(all, params);
      // `region` is a SUBSTRING filter; the facet counts EXACT stored values. So
      // grid.total >= count (substring may also catch sibling regions). The strong
      // guard against grid/facet divergence is the SUBSET direction: every product
      // the facet counted must survive the grid predicate.
      expect(grid.total).toBeGreaterThanOrEqual(count);
      const facetCounted = wine.filter((p) => (p.region ?? '').trim() === value);
      expect(facetCounted.length).toBe(count); // facet count is exact-value tally
      for (const p of facetCounted) {
        expect(matchesFilters(p, params)).toBe(true); // ...and all pass the grid
      }
    }
  });

  it('Accessories sub-category facet count EQUALS grid total (exact match, no substring)', () => {
    // class for Accessories matches accessoryCategoryForSku exactly (both grid + facet),
    // so this is a true equality — the strongest form of the §6 invariant.
    const accessories = all.filter((p) => matchesFilters(p, { group: 'Accessories' }));
    const subs = accessorySubCategoriesFor(accessories);
    expect(subs.length).toBeGreaterThan(0);
    for (const { value, count } of subs) {
      const grid = applyShopQuery(all, { group: 'Accessories', class: value });
      expect(grid.total).toBe(count);
    }
  });
});
```

> Naming subtlety the implementer must respect: `region` is a **substring** filter (existing behavior, spec says keep it), while `regionsFor` counts **exact** stored values. So facet-count and grid-total are equal ONLY when no region name is a substring of another. The robust invariant is therefore `grid.total >= facet.count` plus "every facet-counted product passes the grid filter" — assert the direction that always holds. If the implementer finds an exact-equality case is cleaner for a specific fixture, that's fine for the unit test in Task 3; THIS real-data test uses the `>=` form.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/facets.invariant.test.ts`
Expected: PASS (matchesFilters + facets already built in Tasks 1 & 3). If it FAILS, the divergence is a real bug — fix `matchesFilters`/`facets.ts`, not the test.

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/__tests__/facets.invariant.test.ts
git commit -m "test(catalog): real-data invariant — facet counts consistent with grid totals"
```

---

## Task 5: Normalize body/acidity/tannin matching (dropdown values align with stored)

**Why:** The "More filters" dropdowns (Task 8) offer the clean 4-step scale (`Low/Medium/Medium-High/High`). Stored values include off-scale tokens (e.g. body "Medium-Light"→"Medium"). The filter must normalize the PRODUCT's value before comparing, so the dropdown option matches.

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts` (the body/acidity/tannin lines inside `matchesFilters`)
- Test: `apps/catalog/lib/__tests__/shop-query.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

First, the implementer MUST verify the exact remap in `lib/taste-adapter.ts` and pick a fixture that actually exercises a remap (read `REMAP`: body has `Medium-Light→Medium`; acidity/tannin remaps — confirm the real off-scale tokens in the data). Example using the known body remap:

```ts
import { matchesFilters } from '../shop-query';

describe('matchesFilters — body/acidity/tannin normalized to the 4-step scale', () => {
  it('a product stored "Medium-Light" body matches the "Medium" dropdown option', () => {
    const p = { sku: 'W1', name: 'x', wine_body: 'Medium-Light' } as any;
    expect(matchesFilters(p, { body: 'Medium' })).toBe(true);
  });
  it('exact in-scale value still matches', () => {
    const p = { sku: 'W1', name: 'x', wine_acidity: 'High' } as any;
    expect(matchesFilters(p, { acidity: 'High' })).toBe(true);
  });
  it('off-scale → null normalize → does not match an unrelated option', () => {
    const p = { sku: 'W1', name: 'x', wine_tannin: 'unknowable' } as any;
    expect(matchesFilters(p, { tannin: 'High' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: FAIL — current code compares raw `norm(p.wine_body)`, so "Medium-Light" ≠ "Medium".

- [ ] **Step 3: Update the body/acidity/tannin comparison in `matchesFilters`**

Add the import and replace the three lines:

```ts
import { normalizeScale } from './taste-adapter';
```

```ts
  const body = norm(firstParam(params.body));
  if (body && norm(normalizeScale('body', p.wine_body)) !== body) return false;
  const acidity = norm(firstParam(params.acidity));
  if (acidity && norm(normalizeScale('acidity', p.wine_acidity)) !== acidity) return false;
  const tannin = norm(firstParam(params.tannin));
  if (tannin && norm(normalizeScale('tannin', p.wine_tannin)) !== tannin) return false;
```

(`normalizeScale` returns `null` for unknown/empty; `norm(null)` → `''`, which never equals a non-empty option, so off-scale products correctly drop.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "feat(catalog): normalize body/acidity/tannin filter to 4-step scale (matches taste gauges + dropdowns)"
```

---

## Task 6: shadcn `Select`, `Command`, `Popover` primitives + deps

**Why:** §6.6 dropdowns need shadcn Select; the grape/flavor typeahead needs Command (cmdk) + Popover. These don't exist yet.

**Files:**
- Create: `apps/catalog/components/ui/select.tsx`
- Create: `apps/catalog/components/ui/command.tsx`
- Create: `apps/catalog/components/ui/popover.tsx`
- Modify: `apps/catalog/package.json` (add deps)

- [ ] **Step 1: Add the dependencies**

Run (from `apps/catalog`):
```bash
cd apps/catalog && npm install @radix-ui/react-select @radix-ui/react-popover cmdk
```
Expected: package.json + lockfile updated, no peer-dep errors (React 18 satisfied).

- [ ] **Step 2: Add the three shadcn primitives**

Use the canonical shadcn/ui source for `select.tsx`, `command.tsx`, `popover.tsx` (Radix + cmdk based), matching the existing `components/ui/` style (they already use `cn` from `@/lib/utils` and the same CVA/Tailwind conventions — mirror `dropdown-menu.tsx`). Theme tokens already exist (`--background`, `--border`, `--ring`, etc.). Keep 18px/44px-friendly sizing consistent with the Maison theme.

> The implementer should copy these from shadcn/ui verbatim (they're standard) and only adjust import paths to `@/components/ui/*` and `@/lib/utils`. No custom logic.

- [ ] **Step 3: Typecheck + smoke render**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no type errors from the new primitives.

Add a trivial render smoke test `components/__tests__/ui-primitives.test.tsx` that mounts an empty `<Select>` and `<Popover>` (open=false) to confirm they import + render under jsdom without throwing. Run it.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/ui/select.tsx apps/catalog/components/ui/command.tsx apps/catalog/components/ui/popover.tsx apps/catalog/components/__tests__/ui-primitives.test.tsx apps/catalog/package.json apps/catalog/package-lock.json
git commit -m "chore(catalog): add shadcn Select, Command, Popover primitives for drill-down dropdowns"
```

---

## Task 7: `SearchableSelect` (typeahead for grape & flavor)

**Files:**
- Create: `apps/catalog/components/SearchableSelect.tsx`
- Test: `apps/catalog/components/__tests__/SearchableSelect.test.tsx`

**Behavior:** a Popover-triggered Command list. Props: `{label, value, options: string[], onSelect: (v: string|null) => void, placeholder?}`. Typing filters the (capped) option list case-insensitively; selecting calls `onSelect(value)`; a "Clear" / re-selecting the active value calls `onSelect(null)`. Free-type submit (Enter on a query with no exact option) calls `onSelect(query)` so blends/long-tail grapes still filter (substring on the backend). 44px targets, accessible (cmdk handles focus/aria).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from '../SearchableSelect';

it('filters options as you type and calls onSelect with the chosen value', async () => {
  const onSelect = vi.fn();
  render(<SearchableSelect label="Grape" value="" options={['Pinot Noir', 'Merlot', 'Syrah']} onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: /grape/i }));
  await userEvent.type(screen.getByRole('combobox'), 'mer');
  await userEvent.click(screen.getByText('Merlot'));
  expect(onSelect).toHaveBeenCalledWith('Merlot');
});

it('Enter on a free-typed query that has no exact match selects the raw query (blend fallback)', async () => {
  const onSelect = vi.fn();
  render(<SearchableSelect label="Grape" value="" options={['Pinot Noir']} onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: /grape/i }));
  const input = screen.getByRole('combobox');
  await userEvent.type(input, 'Touriga{enter}');
  expect(onSelect).toHaveBeenCalledWith('Touriga');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run components/__tests__/SearchableSelect.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SearchableSelect.tsx`** (client component, Popover + Command). Keep it focused (~80 lines). Trigger button shows `value || label`. On select of an option → `onSelect(option)`; on Enter with a non-empty query and no exact case-insensitive match → `onSelect(query.trim())`; selecting the already-active value or a "Clear" item → `onSelect(null)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run components/__tests__/SearchableSelect.test.tsx`
Expected: PASS.

> If a cmdk/jsdom interaction proves flaky (cmdk virtualizes), the implementer may assert behavior via fireEvent on the input + click on rendered items; keep the two behaviors (pick option, free-type Enter) covered.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/SearchableSelect.tsx apps/catalog/components/__tests__/SearchableSelect.test.tsx
git commit -m "feat(catalog): SearchableSelect typeahead (grape/flavor) with free-type fallback"
```

---

## Task 8: `DrillBreadcrumb` component

**Files:**
- Create: `apps/catalog/components/DrillBreadcrumb.tsx`
- Test: `apps/catalog/components/__tests__/DrillBreadcrumb.test.tsx`

**Behavior (spec §4.4):** renders the active path as two strands — category `group › class` and geography `country › region › subregion` — only showing crumbs that are set. Each crumb is a link (`href`) that jumps back to that level by clearing all deeper params for its strand (uses `clearDescendants` + `buildQuery` to build the href). A "Clear all" link resets every drill-down param (`group,class,country,region,subregion`). Returns `null` when no drill-down param is set. 44px targets. **Verify there is no existing product `Breadcrumb` collision** — name this `DrillBreadcrumb` (the spec's note). Props: `{ params: Record<string,string>, pathname: string }` (server passes the current URL params + pathname; the component computes hrefs purely — keep it a server component if possible, or client only if it needs router; prefer plain `<Link href>` so it stays a server component).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { DrillBreadcrumb } from '../DrillBreadcrumb';

it('renders nothing when no drill-down params set', () => {
  const { container } = render(<DrillBreadcrumb params={{}} pathname="/shop" />);
  expect(container).toBeEmptyDOMElement();
});

it('shows category + geo crumbs and a Clear all', () => {
  render(<DrillBreadcrumb params={{ group: 'Wine', class: 'Red Wine', country: 'France', region: 'Bordeaux' }} pathname="/shop" />);
  expect(screen.getByText('Wine')).toBeInTheDocument();
  expect(screen.getByText('Red Wine')).toBeInTheDocument();
  expect(screen.getByText('France')).toBeInTheDocument();
  expect(screen.getByText('Bordeaux')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /clear all/i })).toBeInTheDocument();
});

it('a crumb links back to its level clearing deeper params', () => {
  render(<DrillBreadcrumb params={{ group: 'Wine', class: 'Red Wine', country: 'France', region: 'Bordeaux', subregion: 'Pauillac' }} pathname="/shop" />);
  // The "France" crumb href must drop region+subregion but keep group/class/country.
  const france = screen.getByRole('link', { name: 'France' });
  const href = france.getAttribute('href')!;
  expect(href).toContain('country=France');
  expect(href).not.toContain('region=');
  expect(href).not.toContain('subregion=');
  expect(href).toContain('group=Wine');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run components/__tests__/DrillBreadcrumb.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DrillBreadcrumb.tsx`**

A server component using `next/link`. Build each crumb's href: start from the current params, apply `clearDescendants(strand, params[strand])` for that crumb's strand AND drop everything deeper than the crumb (i.e. the href for the "country" crumb = current params minus region+subregion). For "Clear all", remove all five drill params. Use `buildQuery(new URLSearchParams(params), patch)`. Render category strand then a separator then geo strand; each level `value` shown, separated by `›`. Skip unset levels. Use semantic `<nav aria-label="Active filters">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run components/__tests__/DrillBreadcrumb.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/DrillBreadcrumb.tsx apps/catalog/components/__tests__/DrillBreadcrumb.test.tsx
git commit -m "feat(catalog): DrillBreadcrumb showing active category+geo path with back-links"
```

---

## Task 9: Extend `Filters.tsx` — drill-down chip rows + dropdown "More filters"

**Files:**
- Modify: `apps/catalog/components/Filters.tsx`
- Test: `apps/catalog/components/__tests__/Filters.test.tsx` (create if absent)

**New props** (all option lists computed server-side, passed in):
```ts
interface FiltersProps {
  countries: string[];
  availableSubCategories: FacetOption[]; // for the active group (or accessory subcats)
  availableRegions: FacetOption[];       // for the active country
  availableSubRegions: FacetOption[];    // for the active region
  grapeOptions: string[];                // top ~40 single varietals
  flavorOptions: string[];               // top ~50 tags
  bodyOptions: string[];                 // normalized scale values present (or fixed scale)
  acidityOptions: string[];
  tanninOptions: string[];
  initialParams?: Record<string, string>;
}
```

**Changes:**
1. After the group chips: if `group` is set AND `availableSubCategories.length > 0`, render a **sub-category chip row** (`value count`), each toggling `class` via `clearDescendants('class', value)`-style patch. Group chips themselves now use `clearDescendants('group', value)` (clears `class`).
2. The Country dropdown's selection uses `clearDescendants('country', value)` (clears region+subregion). After it: if `country` set AND `availableRegions.length>0`, render a **region chip row**; if `region` set AND `availableSubRegions.length>0`, a **sub-region chip row**. Region/sub-region chips use `clearDescendants`.
3. Mobile: chips **wrap** (already `flex-wrap`); only current-level rows show (they only render when the parent is set), keeping ≤2 active geo/category rows. No horizontal scroll.
4. "More filters": replace the `TextFilter` region/grape/flavor/body/acidity/tannin inputs with:
   - `body`/`acidity`/`tannin` → shadcn `Select`, options from the normalized scale (`bodyOptions` etc.), with an "Any" option that clears the param.
   - `grape`/`flavor` → `SearchableSelect` (Task 7) seeded with `grapeOptions`/`flavorOptions`.
   - Remove the standalone Region text input from "More filters" (region now lives in the drill-down chips). Keep the `hasScore` toggle.
5. Keep the URL-is-source-of-truth pattern and `apply()`/`buildQuery`. Parent-clearing now routes through `clearDescendants`.

- [ ] **Step 1: Write failing component tests**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Filters } from '../Filters';

const base = {
  countries: ['France'], availableSubCategories: [], availableRegions: [],
  availableSubRegions: [], grapeOptions: [], flavorOptions: [],
  bodyOptions: ['Light','Medium','Medium-Full','Full'],
  acidityOptions: ['Low','Medium','Medium-High','High'],
  tanninOptions: ['Low','Medium','Medium-High','High'],
};

it('shows sub-category chips with counts when a group is active', () => {
  render(<Filters {...base} availableSubCategories={[{ value: 'Red Wine', count: 12 }]} initialParams={{ group: 'Wine' }} />);
  expect(screen.getByRole('button', { name: /Red Wine/ })).toBeInTheDocument();
  expect(screen.getByText(/12/)).toBeInTheDocument();
});

it('does NOT show a region row when no country is selected', () => {
  render(<Filters {...base} availableRegions={[{ value: 'Bordeaux', count: 5 }]} initialParams={{}} />);
  expect(screen.queryByRole('button', { name: /Bordeaux/ })).not.toBeInTheDocument();
});

it('shows region chips when a country is active', () => {
  render(<Filters {...base} availableRegions={[{ value: 'Bordeaux', count: 5 }]} initialParams={{ country: 'France' }} />);
  expect(screen.getByRole('button', { name: /Bordeaux/ })).toBeInTheDocument();
});
```

> These tests assert presence/visibility logic (the deterministic part). URL-write assertions are covered by `clearDescendants`/`buildQuery` unit tests; if the implementer wants, add a router-mock test asserting a sub-category click pushes `class=Red%20Wine`. Keep component tests about what renders.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run components/__tests__/Filters.test.tsx`
Expected: FAIL — new props/rows not implemented.

- [ ] **Step 3: Implement the Filters changes** per the list above. Import `clearDescendants` from `@/lib/drill-query`, `FacetOption` type from `@/lib/facets`, `SearchableSelect`, and the `Select` primitive. Replace `TextFilter` usages for the converted facets. Keep `Chip` for the new chip rows (reuse it, append count: `{value} <span className="ml-1 text-sm opacity-70">{count}</span>`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run components/__tests__/Filters.test.tsx`
Expected: PASS. Also run the full suite to catch regressions: `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/Filters.tsx apps/catalog/components/__tests__/Filters.test.tsx
git commit -m "feat(catalog): drill-down chip rows + dropdown/searchable More-filters in Filters"
```

---

## Task 10: Wire the shop page — compute facets, pass props, render breadcrumb

**Files:**
- Modify: `apps/catalog/app/shop/page.tsx`
- Test: `apps/catalog/lib/__tests__/shop-facets-wiring.test.ts` (pure helper extracted from the page)

**Design:** Keep heavy compute in a small **pure, testable helper** rather than burying it in the JSX. Add to `lib/facets.ts` (or a tiny `lib/shop-facets.ts`) a function that, given `allProducts` + `params`, returns the four option lists per the §4.1 input-set table. The page calls it and spreads into `<Filters>`.

- [ ] **Step 1: Write the failing test for the wiring helper**

```ts
import { shopFacets } from '../shop-facets';
import { getAllProducts } from '../catalog-data';

it('subCategories reflect the active group; regions reflect active country (context-aware)', () => {
  const all = getAllProducts();
  const f = shopFacets(all, { group: 'Wine', country: 'France' });
  // sub-categories: Wine classifications only
  expect(f.subCategories.every((o) => o.count > 0)).toBe(true);
  expect(f.subCategories.length).toBeGreaterThan(0);
  // regions: French (wine) regions only, context-aware (no whisky regions)
  expect(f.regions.length).toBeGreaterThan(0);
  // no region selected yet → no sub-regions
  expect(f.subRegions).toEqual([]);
});

it('Accessories group yields accessory sub-categories (Glassware/Cigars/...)', () => {
  const all = getAllProducts();
  const f = shopFacets(all, { group: 'Accessories' });
  const values = f.subCategories.map((o) => o.value);
  expect(values).toEqual(expect.arrayContaining(['Glassware']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-facets-wiring.test.ts`
Expected: FAIL — `shop-facets` not found.

- [ ] **Step 3: Implement `lib/shop-facets.ts`**

```ts
import type { PublicProduct } from './types';
import type { ShopParams } from './shop-query';
import { matchesFilters } from './shop-query';
import {
  subCategoriesFor, accessorySubCategoriesFor, regionsFor, subRegionsFor, type FacetOption,
} from './facets';
import { type CategoryGroup, CATEGORY_GROUPS } from './category-groups';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Return a SHALLOW COPY of params with the given keys removed. Stays typed as
 * ShopParams (no `as Record<string, unknown>` cast) so matchesFilters keeps its
 * type safety. `class` is a contextual keyword but a perfectly legal object key.
 */
function omit(params: ShopParams, ...keys: string[]): ShopParams {
  const copy: ShopParams = { ...params };
  for (const k of keys) delete copy[k];
  return copy;
}

export interface ShopFacets {
  subCategories: FacetOption[];
  regions: FacetOption[];
  subRegions: FacetOption[];
}

/** Build the three drill-down option lists per design §4.1 input-set table. */
export function shopFacets(all: PublicProduct[], params: ShopParams): ShopFacets {
  const group = first(params.group) as CategoryGroup | undefined;
  const country = first(params.country);
  const region = first(params.region);

  // subCategories: apply everything EXCEPT `class`.
  let subCategories: FacetOption[] = [];
  if (group && (CATEGORY_GROUPS as readonly string[]).includes(group)) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'class')));
    subCategories = group === 'Accessories'
      ? accessorySubCategoriesFor(set)
      : subCategoriesFor(group, set);
  }

  // regions: apply everything EXCEPT region + subregion.
  let regions: FacetOption[] = [];
  if (country) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'region', 'subregion')));
    regions = regionsFor(country, set);
  }

  // subRegions: apply everything EXCEPT subregion.
  let subRegions: FacetOption[] = [];
  if (region) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'subregion')));
    subRegions = subRegionsFor(region, set);
  }

  return { subCategories, regions, subRegions };
}
```

> Note for accessories (RESOLVED in Task 1): when `group === 'Accessories'`, the `class` param holds an accessory sub-category VALUE (e.g. "Glassware"), and `matchesFilters` already branches to `accessoryCategoryForSku(p.sku) === class` for Accessories products (Task 1, Step 3 + its tests). So `shopFacets` routing `group=Accessories` to `accessorySubCategoriesFor` is consistent with the grid by construction — no extra work here, and the Task 4 invariant asserts the equality. Do NOT re-implement the branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-facets-wiring.test.ts`
Expected: PASS. (The Accessories `class` branch already lives in `matchesFilters` from Task 1, so the grid and these facets agree by construction.)

- [ ] **Step 5: Wire `app/shop/page.tsx`**

- Pass `searchParams` (already includes `class`/`subregion`) straight into `applyShopQuery` — it now honors them via `matchesFilters`. No change needed there beyond confirming `class`/`subregion` flow through (they do — `applyShopQuery` takes the whole params record).
- Compute `const facets = shopFacets(products, searchParams)`.
- Compute `grapeOptions`/`flavorOptions` (top ~40/~50) and `body/acidity/tannin` option lists. Add small helpers (can live in `shop-facets.ts`): top-N distinct grape varietals (single-word/no-blend heuristic ok) and top-N flavor tags by frequency; body/acidity/tannin = the fixed normalized scales.
- Pass all into `<Filters {...facets} grapeOptions={...} flavorOptions={...} bodyOptions={...} .../>`.
- Render `<DrillBreadcrumb params={currentParams} pathname="/shop" />` above the grid (inside the existing layout, near the filters).

- [ ] **Step 6: Typecheck + full test suite + production build**

Run:
```bash
cd apps/catalog && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: typecheck clean, ALL tests pass, build succeeds. (Per CLAUDE.md Rule 7, build success is necessary but not sufficient — browser verification is Task 11.)

- [ ] **Step 7: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/shop/page.tsx apps/catalog/lib/shop-facets.ts apps/catalog/lib/__tests__/shop-facets-wiring.test.ts
git commit -m "feat(catalog): wire drill-down facets + breadcrumb into shop page"
```

---

## Task 11: Browser verification (CLAUDE.md Rule 7 — non-negotiable for UI)

**Files:** none (verification only)

UI changes are not "done" until the real user journey renders correctly in a browser.

- [ ] **Step 1: Start the production server on a unique port**

```bash
cd apps/catalog && npm run build && PORT=3187 npm run start
```
(Run in background. If `EADDRINUSE`, `lsof -ti tcp:3187 | xargs kill -9` and retry, or pick another port.)

- [ ] **Step 2: Walk the drill-down journey** at `http://localhost:3187/shop`:
  - Click **Wine** → sub-category chips (Red Wine, White Wine, …) appear with counts.
  - Click **Red Wine** → grid narrows; breadcrumb shows `Wine › Red Wine`.
  - Pick **France** in Country → region chips (Bordeaux, Burgundy, …) appear with counts.
  - Click **Bordeaux** → sub-region chips appear; breadcrumb shows the geo strand.
  - Click the **France** crumb → region/sub-region clear, country stays.
  - Open **More filters** → Body/Acidity/Tannin are **dropdowns**; Grape/Flavor are **searchable**; pick values, confirm grid narrows.
  - Click **Accessories** → sub-categories are Glassware/Cigars/Events/Wine Fridges & Coolers/Bar Tools & Gifts (NOT wine classes); confirm the 94 AWC fridges live under "Wine Fridges & Coolers", none under Wine.
  - Confirm counts on chips equal the result count after selecting them.
  - Reload a deep URL (`/shop?group=Wine&class=Red%20Wine&country=France&region=Bordeaux`) → state restored from URL.

- [ ] **Step 3: Mobile check** — narrow the viewport to ~390px: chips wrap (no horizontal scroll), breadcrumb collapses the chosen path, only current-level rows show.

- [ ] **Step 4: Report findings to the user** with what worked and any screenshots/observations. If the heavy image pages hang the headless screenshot tool (known issue, see project memory), verify via DOM/CSS inspection + recommend a real-phone glance.

- [ ] **Step 5: Stop the server**

```bash
lsof -ti tcp:3187 | xargs kill -9
```

---

## Task 12: Final full-suite + build gate + margin-leak recheck

**Files:** none (gate)

- [ ] **Step 1: Full test suite green**

Run: `cd apps/catalog && npx vitest run`
Expected: all tests pass (≥139 prior + new).

- [ ] **Step 2: Production build green**

Run: `cd apps/catalog && npm run build`
Expected: success.

- [ ] **Step 3: Margin-leak chokepoint still clean** (CLAUDE.md Rule 1) — the new code only READS `PublicProduct` fields and never widens `toPublicProduct`'s allowlist. Confirm no margin_*/enrichment_*/popularity_* field name appears in any new file:

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
grep -rnE "margin_pct|b2b_margin_pct|enrichment_|popularity_" apps/catalog/lib/facets.ts apps/catalog/lib/shop-facets.ts apps/catalog/lib/drill-query.ts apps/catalog/components/Filters.tsx apps/catalog/components/DrillBreadcrumb.tsx apps/catalog/components/SearchableSelect.tsx || echo "CLEAN — no leak-prone fields referenced"
```
Expected: `CLEAN`.

- [ ] **Step 4: Commit any final touch-ups, then summarize for the user**

Report: tasks done, tests added/passing, build status, and the browser-verified user journey (Rule 7). Do NOT claim done without the browser walkthrough from Task 11.

---

## Notes for the implementer
- **DRY:** `matchesFilters` is the ONLY filter predicate — facets, grid, and wiring all call it. Never re-implement a per-field check elsewhere.
- **YAGNI:** No per-facet landing pages, no grape/appellation drill-down, no recommender/home/product changes (spec §7).
- **TDD:** every task is test-first. Real-data tests (Tasks 4, 10) use `getAllProducts()` — they're the Rule-6-style invariants guarding against grid/facet divergence.
- **Region stays substring** (existing behavior, spec §4.2). Don't switch it to exact. The drill-down chips set exact canonical values; substring is a deliberate, accepted superset.
- **Accessories `class`** means the accessory sub-category (via `accessoryCategoryForSku`), NOT a classification — handle that branch in `matchesFilters` (Task 10 note) and keep grid+facets consistent.
- Reference skills: @superpowers:subagent-driven-development (recommended) or @superpowers:executing-plans.
