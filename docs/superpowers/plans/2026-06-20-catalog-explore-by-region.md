# Explore by Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the catalog's "coming soon" Explore-by-Map placeholder with a curated, accessible, deep-linkable "Explore by Region" stylized-SVG atlas that hands off to the existing filtered `/shop`.

**Architecture:** Fully static/SSG. A prebuild Node script derives, from `data/live_products_export.json`, a compact `explore-map-data.json` (curated region hotspots with fresh counts, price ranges, peek thumbnails). The taxonomy JSON is used ONLY as a name→lat/long lookup, supplemented by a small hand-authored centroid table. The page renders a plain-DOM/SVG atlas (no WebGL) + an accessible region list; each region is a real URL; "View all" links to `/shop` via the existing `buildQuery` convention so the panel count equals the grid total by construction.

**Tech Stack:** Next.js 14 (App Router, SSG), TypeScript, React 18, Tailwind, vitest. NO maplibre-gl / react-map-gl (explicitly cut). Plain SVG + CSS for the map.

**Spec:** `docs/superpowers/specs/2026-06-20-catalog-explore-by-region-design.md`

---

## Conventions (read before starting)

- All paths are under `apps/catalog` unless noted. Run all commands from `apps/catalog` (`cd "apps/catalog"`).
- Path alias: `@/*` = `apps/catalog/*` (vitest `vitest.config.ts` and tsconfig).
- Tests live in `lib/__tests__/*.test.ts` (vitest, `globals:true`, jsdom). Run a single file: `npx vitest run lib/__tests__/<file>.test.ts`.
- `is_in_stock` is a STRING `"0"/"1"/null` — "0" is truthy. Always coerce via `isInStock` (`lib/utils.ts`).
- Margin-leak rule: peek objects carry ONLY `{sku,name,image_url,price}` — never spread a product.
- The prebuild generator is a plain `.mjs` — it CANNOT import the TS loaders. It re-reads the raw export and hand-builds allowlisted objects, exactly like `scripts/gen-search-index.mjs`. Anti-drift is enforced by tests (Task 7), not code reuse.
- `groupForProduct` is imported from `lib/category-groups.ts` (NOT `sku-taxonomy.ts`).
- The Header nav link `/explore-map` already exists (`components/Header.tsx:29`) — no nav change needed.
- Commit after every task. Branch is `feat/wnlq9-catalog` (already checked out).

---

## File Structure

**Create:**
- `lib/explore/region-centroids.ts` — hand-authored region→{lat,lng,x,y} supplement (~15 entries).
- `lib/explore/types.ts` — `ExploreMapData`, `MapRegion`, `MapCountry`, `MapPeek`, `LensKey` types.
- `lib/explore/map-data.ts` — typed loader for the generated JSON + lens/handoff helpers.
- `scripts/gen-explore-map-data.mjs` — prebuild generator.
- `lib/__tests__/explore-map-data.test.ts` — unit tests for the loader + helpers.
- `lib/__tests__/explore-map.invariant.test.ts` — count==grid invariant + margin-leak guard over the generated file.
- `components/explore/CategoryLens.tsx`
- `components/explore/RegionAtlas.tsx`
- `components/explore/RegionDrawer.tsx`
- `components/explore/RegionList.tsx`
- `components/explore/EscapeHatch.tsx`
- `app/explore-map/ExploreRegionClient.tsx` — client orchestrator.
- `app/explore-map/[region]/page.tsx` — deep-linkable region route (SSG).
- `components/__tests__/RegionDrawer.test.tsx` — render test (margin-safe fields, CTA href).

**Modify:**
- `app/explore-map/page.tsx` — replace placeholder with the server shell.
- `package.json:7` — chain the new generator into `prebuild`.
- `.gitignore` — add the generated data file.

**Generated (gitignored):**
- `data/explore-map-data.json` (written under `apps/catalog/data/`).

---

## Task 1: Region centroid supplement

**Files:**
- Create: `apps/catalog/lib/explore/region-centroids.ts`
- Test: `apps/catalog/lib/__tests__/explore-map-data.test.ts` (created here, extended later)

Provides lat/long (and authored SVG x/y, per spec §10 — placement is authored, not math-derived) for the high-depth regions the taxonomy lacks coords for: all the sake regions + Napa + Languedoc + Maule. Keyed by lowercase region name.

- [ ] **Step 1: Write the failing test**

Create `apps/catalog/lib/__tests__/explore-map-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REGION_CENTROIDS, centroidFor } from '@/lib/explore/region-centroids';

describe('region-centroids', () => {
  it('covers the high-depth no-coord regions (sake + Napa + Languedoc)', () => {
    for (const name of ['Niigata', 'Nagano', 'Hyogo', 'Napa Valley', 'Languedoc-Roussillon']) {
      const c = centroidFor(name);
      expect(c, `${name} must have a centroid`).toBeTruthy();
      expect(typeof c!.lat).toBe('number');
      expect(typeof c!.lng).toBe('number');
    }
  });

  it('lookup is case-insensitive and trims', () => {
    expect(centroidFor('  niigata ')).toEqual(centroidFor('Niigata'));
  });

  it('returns null for an unknown region', () => {
    expect(centroidFor('Nowhere-land')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/explore/region-centroids`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/catalog/lib/explore/region-centroids.ts`:

```ts
/**
 * Hand-authored region centroids — supplements data/taxonomy/explore-taxonomy.json,
 * which lacks coordinates for several high-depth regions (verified: all sake
 * regions, Napa Valley, Languedoc, Maule). lat/lng are real geographic centroids;
 * x/y are AUTHORED positions on the atlas SVG (spec §10: placement is authored, not
 * math-derived from a stylized silhouette). x/y are 0..100 percentage coords on the
 * atlas viewBox; the build picks taxonomy coords first, then this table.
 *
 * No API spend — these are looked up once by hand and committed.
 */
export interface Centroid {
  lat: number;
  lng: number;
  /** authored atlas position, 0..100 % of the SVG viewBox (optional; world fallback if absent) */
  x?: number;
  y?: number;
}

// Keys are lowercased region names (match the live export's `region` values).
export const REGION_CENTROIDS: Record<string, Centroid> = {
  'niigata': { lat: 37.9, lng: 139.0 },
  'nagano': { lat: 36.2, lng: 138.0 },
  'hyogo': { lat: 34.7, lng: 135.0 },
  'kumamoto': { lat: 32.8, lng: 130.7 },
  'kyoto': { lat: 35.0, lng: 135.8 },
  'yamanashi': { lat: 35.7, lng: 138.6 },
  'napa valley': { lat: 38.5, lng: -122.3 },
  'languedoc-roussillon': { lat: 43.6, lng: 3.4 },
  'maule valley': { lat: -35.7, lng: -71.6 },
  // Add others if the curated set surfaces more no-coord regions (Task 6 logs them).
};

export function centroidFor(region: string | null | undefined): Centroid | null {
  if (!region) return null;
  return REGION_CENTROIDS[region.trim().toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/explore/region-centroids.ts apps/catalog/lib/__tests__/explore-map-data.test.ts
git commit -m "feat(catalog): region centroid supplement for explore-map"
```

---

## Task 2: Types for the explore-map data

**Files:**
- Create: `apps/catalog/lib/explore/types.ts`

No test of its own (pure types); consumed by Task 3+.

- [ ] **Step 1: Write the types**

Create `apps/catalog/lib/explore/types.ts`:

```ts
/** Lens keys shown in the UI, mapped to catalog category_group(s) in map-data.ts. */
export type LensKey = 'all' | 'wine' | 'whisky' | 'spirits' | 'sake';

/** A single peek product. ONLY these fields ever leave the server (margin-safe). */
export interface MapPeek {
  sku: string;
  name: string;
  price: number | null;
  image_url?: string;
}

export interface PriceRange {
  min: number | null;
  max: number | null;
}

export interface MapRegion {
  name: string;          // canonical region NAME (handoff value; never a slug)
  slug: string;          // URL slug for /explore-map/[region]
  country: string;       // parent country NAME (handoff value)
  lat: number;
  lng: number;
  x?: number;            // authored atlas % position (0..100), optional
  y?: number;
  total: number;         // in-stock beverage count (fresh, from live export)
  countsByGroup: Record<string, number>; // catalog category_group -> count
  priceRange: PriceRange;
  peeks: MapPeek[];      // up to ~6 in-stock thumbnails
}

export interface MapCountry {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  total: number;
  countsByGroup: Record<string, number>;
}

export interface ExploreMapData {
  _meta: {
    generated: string;
    totalMapped: number;      // products represented on the map
    rolledUpRegions: number;  // regions w/o coords folded into a country pin
    curatedCount: number;
  };
  regions: MapRegion[];   // the curated hotspot set
  countries: MapCountry[]; // full country roll-up (world view + fallback pins)
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/catalog" && npx tsc --noEmit`
Expected: PASS (no errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/explore/types.ts
git commit -m "feat(catalog): explore-map data types"
```

---

## Task 2b: Add `bev=1` opt-in filter to /shop (count==grid prerequisite)

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts` (add one guard in `matchesFilters`)
- Test: `apps/catalog/lib/__tests__/shop-query.test.ts` (extend)

**Why:** the map counts **in-stock beverages**, so the hand-off must filter `/shop` to the same set on BOTH axes. `bev=1` handles the GROUP axis here; the STOCK axis is handled by reusing `/shop`'s existing `inStock=1` flag (composed in `shopHref`, Task 3) — so `bev` stays a pure group filter and nothing is overloaded.

- GROUP axis (this task): a bare `?country&region` query counts a wine fridge in Champagne. For the 5 mixed regions carrying accessories (Champagne, South Australia, Rhône Valley, London, Caribbean — verified), "View all 226 →" would hit a grid of 230.
- STOCK axis (handled by existing `inStock=1`, NOT this flag): `/shop`'s in-stock filter is opt-in/off by default (`shop-query.ts:159`), so a bare query also counts OOS (Bordeaux 323 in-stock vs 753 incl. OOS — the bigger gap). `shopHref` emits `inStock=1` to close it.

Add an opt-in `bev=1` flag (mirroring the `inStock=1`/`hasScore=1` idiom at `shop-query.ts:159-161`) that excludes the non-beverage groups. Purely additive — no existing `/shop` behavior changes.

- [ ] **Step 1: Write the failing test (extend shop-query.test.ts)**

```ts
import { describe, it, expect } from 'vitest';
import { matchesFilters } from '@/lib/shop-query';

describe('bev=1 opt-in filter (beverages only)', () => {
  const fridge = { sku: 'GWN-FRIDGE', name: 'Wine Cooler', category_group: 'Accessories', is_in_stock: '1', region: 'Champagne' } as any;
  const wine = { sku: 'WIN1', name: 'Champ', category_group: 'Wine', is_in_stock: '1', region: 'Champagne' } as any;

  it('bev=1 excludes Accessories/Events/Cigars/Non-Alcoholic', () => {
    expect(matchesFilters(fridge, { bev: '1', region: 'Champagne' })).toBe(false);
    expect(matchesFilters(wine, { bev: '1', region: 'Champagne' })).toBe(true);
  });
  it('without bev, accessories still match (no behavior change)', () => {
    expect(matchesFilters(fridge, { region: 'Champagne' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: FAIL — `bev` not honored (fridge matches when it shouldn't).

- [ ] **Step 3: Add the guard to `matchesFilters`**

In `lib/shop-query.ts`, add near the other opt-in flags (after the `hasScore` block, ~line 161), and add `bev?` to the `ShopParams` type if it's a typed interface (check the top of the file; if params is `Record<string,...>`-ish, no type change needed):

```ts
  // bev=1 — beverages only: exclude non-drink groups. Opt-in (additive), used by
  // the Explore-by-Region hand-off so its "View all N" count == this grid exactly.
  if (firstParam(params.bev) === '1') {
    const NON_BEVERAGE = new Set(['Accessories', 'Events', 'Cigars', 'Non-Alcoholic']);
    if (NON_BEVERAGE.has(productGroup)) return false;
  }
```

(Use the `productGroup` already resolved at the top of `matchesFilters`, line 108.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS (existing shop-query tests still green + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "feat(catalog): bev=1 opt-in beverages-only filter for /shop (explore-map count==grid)"
```

---

## Task 3: Lens map + handoff helpers

**Files:**
- Create: `apps/catalog/lib/explore/map-data.ts`
- Test: `apps/catalog/lib/__tests__/explore-map-data.test.ts` (extend)

`map-data.ts` holds: the `LensKey → category_group[]` mapping, a `lensCount(region, lens)` helper, and `shopHref(region, lens)` that builds the `/shop` URL via the existing `buildQuery`. (The data LOADER is added in Task 5 once the file exists.)

- [ ] **Step 1: Write the failing test (extend the Task 1 file)**

Append to `apps/catalog/lib/__tests__/explore-map-data.test.ts`:

```ts
import { LENS_GROUPS, lensCount, shopHref } from '@/lib/explore/map-data';
import type { MapRegion } from '@/lib/explore/types';

const bordeaux: MapRegion = {
  name: 'Bordeaux', slug: 'bordeaux', country: 'France', lat: 44.8, lng: -0.6,
  total: 323, countsByGroup: { Wine: 321, Liqueur: 2 },
  priceRange: { min: 890, max: 48000 }, peeks: [],
};

describe('lens mapping', () => {
  it('all = total; wine = Wine group; spirits folds Liqueur', () => {
    expect(lensCount(bordeaux, 'all')).toBe(323);
    expect(lensCount(bordeaux, 'wine')).toBe(321);
    expect(lensCount(bordeaux, 'spirits')).toBe(2); // Liqueur counted under Spirits lens
    expect(lensCount(bordeaux, 'whisky')).toBe(0);
  });
  it('LENS_GROUPS maps sake to the catalog "Sake & Asian" group', () => {
    expect(LENS_GROUPS.sake).toContain('Sake & Asian');
  });
});

describe('shopHref', () => {
  it('emits bev=1 + inStock=1 + region NAME + parent country + group (not slug)', () => {
    const href = shopHref(bordeaux, 'wine');
    expect(href.startsWith('/shop?')).toBe(true);
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('bev')).toBe('1');             // beverages only (group axis)
    expect(qs.get('inStock')).toBe('1');         // in-stock only (stock axis) -> grid matches map count
    expect(qs.get('region')).toBe('Bordeaux');   // NAME, never the slug
    expect(qs.get('country')).toBe('France');
    expect(qs.get('group')).toBe('Wine');
  });
  it('lens=all omits the group param but KEEPS bev=1 AND inStock=1', () => {
    const qs = new URLSearchParams(shopHref(bordeaux, 'all').split('?')[1]);
    expect(qs.get('group')).toBeNull();
    expect(qs.get('bev')).toBe('1');
    expect(qs.get('inStock')).toBe('1');
    expect(qs.get('region')).toBe('Bordeaux');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/explore/map-data`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/catalog/lib/explore/map-data.ts`:

```ts
import { buildQuery } from '@/lib/build-query';
import type { LensKey, MapRegion } from './types';

/**
 * UI lens -> catalog category_group(s). The lens is the SHOPPER's mental model
 * (Wine / Whisky / Spirits / Sake); it maps onto the catalog's real 10-group
 * `category_group` (the taxonomy's wine/spirits/beer/sake buckets are NOT used).
 * 'all' has no groups (means "no group filter").
 */
export const LENS_GROUPS: Record<Exclude<LensKey, 'all'>, string[]> = {
  wine: ['Wine'],
  whisky: ['Whisky'],
  spirits: ['Spirits'],
  sake: ['Sake & Asian'],
};

/** The single catalog group a lens hands off to /shop as ?group= (first of its set). */
export function lensPrimaryGroup(lens: LensKey): string | null {
  if (lens === 'all') return null;
  return LENS_GROUPS[lens][0];
}

export function lensCount(region: MapRegion, lens: LensKey): number {
  if (lens === 'all') return region.total;
  return LENS_GROUPS[lens].reduce((n, g) => n + (region.countsByGroup[g] ?? 0), 0);
}

/**
 * Build the /shop handoff URL. Emits the region NAME (never the slug) + parent
 * country so /shop's exact-ci matcher + DrillBreadcrumb work, plus the lens group.
 * Uses the same buildQuery the Filters use, so the resulting grid is computed by
 * the same matchesFilters predicate as the panel count (count == grid by design).
 */
export function shopHref(region: MapRegion, lens: LensKey): string {
  const group = lensPrimaryGroup(lens);
  // bev=1 (beverages only) + inStock=1 (in-stock only) restrict /shop to the SAME
  // in-stock-beverage subset the map counts on BOTH axes, so the resulting grid
  // total == the drawer's "View all N" count exactly. bev is a pure group filter;
  // inStock supplies the freshness axis (reusing /shop's existing opt-in flag).
  const qs = buildQuery({}, {
    bev: '1',
    inStock: '1',
    country: region.country,
    region: region.name,
    group: group ?? null,
  });
  return qs ? `/shop?${qs}` : '/shop';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/explore/map-data.ts apps/catalog/lib/__tests__/explore-map-data.test.ts
git commit -m "feat(catalog): explore-map lens mapping + /shop handoff helpers"
```

---

## Task 4: Prebuild generator — aggregation core (pure, tested)

**Files:**
- Create: `apps/catalog/scripts/gen-explore-map-data.mjs`
- Test: `apps/catalog/lib/__tests__/explore-map-gen.test.ts`

The generator is a `.mjs` (can't import TS). To make its core logic testable, structure it so the pure aggregation function is `export`ed from the `.mjs` and imported by a vitest test, while `main()` does the file IO. (vitest can import `.mjs`.) This task builds + tests the pure core; Task 6 wires IO + curation + coords.

The pure core `aggregate(rows, { excludeGroups })` takes raw export rows and returns `{ byRegion, byCountry }` maps of fresh in-stock counts, per-group counts, price ranges, and candidate peeks — applying the allowlist + in-stock coercion inline.

- [ ] **Step 1: Write the failing test**

Create `apps/catalog/lib/__tests__/explore-map-gen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregate, isInStockRaw } from '@/scripts/gen-explore-map-data.mjs';

const rows = [
  { sku: 'WIN1', name: 'A', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '1', price: 1000, image_url: 'a.jpg' },
  { sku: 'WIN2', name: 'B', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '0', price: 2000 }, // OOS — excluded
  { sku: 'LIQ1', name: 'C', region: 'Bordeaux', country: 'France', category_group: 'Liqueur', is_in_stock: '1', price: 500 },
  { sku: 'ACC1', name: 'Fridge', region: 'Bordeaux', country: 'France', category_group: 'Accessories', is_in_stock: '1', price: 9000 }, // excluded group
];

describe('isInStockRaw (string "0"/"1" gotcha)', () => {
  it('treats "0" as out of stock (NOT truthy)', () => {
    expect(isInStockRaw('0')).toBe(false);
    expect(isInStockRaw('1')).toBe(true);
    expect(isInStockRaw(null)).toBe(false);
  });
});

describe('aggregate', () => {
  const { byRegion } = aggregate(rows, { excludeGroups: ['Accessories', 'Events', 'Cigars', 'Non-Alcoholic'] });
  const bdx = byRegion.get('Bordeaux');

  it('counts only in-stock, non-excluded products', () => {
    expect(bdx.total).toBe(2);                 // WIN1 + LIQ1 (WIN2 OOS, ACC1 excluded)
    expect(bdx.countsByGroup.Wine).toBe(1);
    expect(bdx.countsByGroup.Liqueur).toBe(1);
    expect(bdx.countsByGroup.Accessories).toBeUndefined();
  });
  it('price range over in-stock non-excluded only', () => {
    expect(bdx.priceRange).toEqual({ min: 500, max: 1000 });
  });
  it('peeks carry ONLY allowlisted fields (margin-safe)', () => {
    const ALLOWED = new Set(['sku', 'name', 'price', 'image_url']);
    for (const peek of bdx.peeks) {
      for (const k of Object.keys(peek)) expect(ALLOWED.has(k), `unexpected key ${k}`).toBe(true);
      expect(peek).not.toHaveProperty('margin_pct');
      expect(peek).not.toHaveProperty('cost_price');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-gen.test.ts`
Expected: FAIL — cannot resolve `@/scripts/gen-explore-map-data.mjs`.

- [ ] **Step 3: Write minimal implementation (pure core only)**

Create `apps/catalog/scripts/gen-explore-map-data.mjs` (IO/main added in Task 6):

```js
/**
 * gen-explore-map-data.mjs — prebuild generator for the Explore-by-Region atlas.
 *
 * Plain Node .mjs (runs before tsc) so it CANNOT import the TS catalog loaders;
 * it re-reads the raw export and hand-builds allowlisted objects, exactly like
 * gen-search-index.mjs. Anti-drift/margin-safety is enforced by tests
 * (explore-map-gen.test.ts + explore-map.invariant.test.ts), not by code reuse.
 *
 * Exports the pure `aggregate()` core for unit testing; main() does file IO.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(__dirname, '..');

const EXCLUDE_GROUPS = ['Accessories', 'Events', 'Cigars', 'Non-Alcoholic'];
const PEEK_LIMIT = 6;

/** is_in_stock is a STRING "0"/"1"/null in the export. "0" is truthy in JS — coerce. */
export function isInStockRaw(v) {
  return String(v ?? '').trim() === '1';
}

/** Build a margin-safe peek object — ONLY the 4 allowlisted fields, never spread. */
function toPeek(r) {
  const peek = { sku: r.sku, name: typeof r.name === 'string' ? r.name : '' };
  if (typeof r.price === 'number') peek.price = r.price;
  else peek.price = null;
  if (r.image_url) peek.image_url = r.image_url;
  return peek;
}

/**
 * Pure aggregation. Groups IN-STOCK, non-excluded products by region NAME and by
 * country NAME, computing fresh totals, per-category_group counts, price ranges,
 * and candidate peeks. Uses the row's backfilled category_group (authoritative).
 */
export function aggregate(rows, { excludeGroups = EXCLUDE_GROUPS } = {}) {
  const excluded = new Set(excludeGroups);
  const byRegion = new Map();
  const byCountry = new Map();

  const bump = (map, key, r, group) => {
    let agg = map.get(key);
    if (!agg) {
      agg = { total: 0, countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [] };
      map.set(key, agg);
    }
    agg.total += 1;
    agg.countsByGroup[group] = (agg.countsByGroup[group] ?? 0) + 1;
    if (typeof r.price === 'number') {
      if (agg.priceRange.min === null || r.price < agg.priceRange.min) agg.priceRange.min = r.price;
      if (agg.priceRange.max === null || r.price > agg.priceRange.max) agg.priceRange.max = r.price;
    }
    if (agg.peeks.length < PEEK_LIMIT && r.image_url) agg.peeks.push(toPeek(r));
  };

  for (const r of rows) {
    if (!r || typeof r.sku !== 'string' || !r.sku) continue;
    const group = r.category_group || 'Unknown';
    if (excluded.has(group)) continue;
    if (!isInStockRaw(r.is_in_stock)) continue;
    const region = (r.region || '').trim();
    const country = (r.country || '').trim();
    if (country) bump(byCountry, country, r, group);
    if (region) bump(byRegion, region, r, group);
  }
  return { byRegion, byCountry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-gen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/lib/__tests__/explore-map-gen.test.ts
git commit -m "feat(catalog): explore-map generator aggregation core (in-stock, margin-safe, tested)"
```

---

## Task 5: Data loader (server-side)

**Files:**
- Create: `apps/catalog/lib/explore/map-data.ts` (extend with `loadExploreMapData()`)
- Test: covered indirectly by Task 7 invariant; add a small presence test here.

Adds a server-only loader that reads the generated `data/explore-map-data.json` (probing locations like `catalog-data.ts:exportPath()`), throwing loudly if missing.

> **EXECUTION ORDER (important):** the loader's TEST needs the generated file, which Task 6 produces. Write the loader implementation here (Step 2), but **do NOT run its test until Task 6 Step 3 has generated the file.** A worker executing strictly top-to-bottom should: implement the loader (Task 5 Step 2) → commit (Step 4) → do Task 6 (which generates the file) → then Task 6's test step runs the loader test green. The Task 5 "run test" step is intentionally deferred to Task 6.

- [ ] **Step 1: Write the failing test (extend explore-map-data.test.ts)**

```ts
import { loadExploreMapData } from '@/lib/explore/map-data';

describe('loadExploreMapData', () => {
  it('loads the generated file and returns curated regions + countries', () => {
    const data = loadExploreMapData();
    expect(Array.isArray(data.regions)).toBe(true);
    expect(data.regions.length).toBeGreaterThan(0);
    expect(data.countries.length).toBeGreaterThan(0);
    // every curated region has coords + a country
    for (const r of data.regions) {
      expect(typeof r.lat).toBe('number');
      expect(r.country.length).toBeGreaterThan(0);
    }
  });
});
```

Note: this test depends on the generated file existing — Task 6 generates it. Order: do Task 6 before running this. (Subagent-driven execution: run Task 6's generate step, then this.)

- [ ] **Step 2: Implement the loader (append to map-data.ts)**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { ExploreMapData } from './types';

function dataPath(): string {
  const candidates = [
    path.join(process.cwd(), 'apps', 'catalog', 'data', 'explore-map-data.json'), // repo root cwd
    path.join(process.cwd(), 'data', 'explore-map-data.json'),                     // apps/catalog cwd
    process.env.EXPLORE_MAP_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('explore-map-data.json not found — run the prebuild generator');
  return found;
}

let _cache: ExploreMapData | null = null;
export function loadExploreMapData(): ExploreMapData {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(dataPath(), 'utf8')) as ExploreMapData;
  return _cache;
}
```

- [ ] **Step 3: Run after Task 6 generates the file**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-data.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/explore/map-data.ts apps/catalog/lib/__tests__/explore-map-data.test.ts
git commit -m "feat(catalog): explore-map server-side data loader"
```

---

## Task 6: Generator IO + curation + coordinate resolution + prebuild wiring

**Files:**
- Modify: `apps/catalog/scripts/gen-explore-map-data.mjs` (add `main()`, curation, coords)
- Modify: `apps/catalog/package.json:7` (chain prebuild)
- Modify: `apps/catalog/.gitignore` (ignore generated file)

Adds: raw-export read (probe paths like gen-search-index), coordinate resolution (taxonomy region coords → centroid table → country roll-up), deterministic curation (hard cap, depth desc + name tiebreak, per-lens substitution), and the JSON write. Logs rolled-up region count (Rule 2 — no silent skips).

- [ ] **Step 1: Add main() + helpers to the .mjs**

Append to `gen-explore-map-data.mjs` (key logic — implement per spec §3/§10):

```js
const CURATE_CAP = 22;
const CURATE_MIN_DEPTH = 30;
// Lens -> category_group(s), mirrored from lib/explore/map-data.ts (kept in sync by test).
const LENS_GROUPS = { wine: ['Wine'], whisky: ['Whisky'], spirits: ['Spirits'], sake: ['Sake & Asian'] }; // one group per lens (count==grid); keep in sync with lib/explore/map-data.ts

function resolveExportPath() {
  const c = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
    path.join(catalogRoot, '..', '..', 'data', 'live_products_export.json'),
    process.env.CATALOG_DATA_PATH ?? '',
  ].find((p) => p && fs.existsSync(p));
  if (!c) throw new Error('gen-explore-map-data: live_products_export.json not found');
  return c;
}

function loadTaxonomyCoords() {
  // explore-taxonomy.json: name(lower) -> {lat,lng} for regions AND countries.
  const c = [
    path.join(process.cwd(), 'data', 'taxonomy', 'explore-taxonomy.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy', 'explore-taxonomy.json'),
  ].find((p) => p && fs.existsSync(p));
  if (!c) throw new Error('gen-explore-map-data: explore-taxonomy.json not found');
  const t = JSON.parse(fs.readFileSync(c, 'utf8'));
  const region = new Map(), country = new Map();
  for (const r of t.regions ?? []) if (r.latitude) region.set(r.name.trim().toLowerCase(), { lat: r.latitude, lng: r.longitude, slug: r.slug });
  for (const c2 of t.countries ?? []) if (c2.latitude) country.set(c2.name.trim().toLowerCase(), { lat: c2.latitude, lng: c2.longitude, slug: c2.slug });
  return { region, country };
}

// Hand-authored centroid supplement, inlined (the .mjs can't import the TS module).
// EXPORTED so the parity test (Task 6 Step 4) can assert it matches region-centroids.ts.
export const CENTROIDS = {
  'niigata': { lat: 37.9, lng: 139.0 }, 'nagano': { lat: 36.2, lng: 138.0 },
  'hyogo': { lat: 34.7, lng: 135.0 }, 'kumamoto': { lat: 32.8, lng: 130.7 },
  'kyoto': { lat: 35.0, lng: 135.8 }, 'yamanashi': { lat: 35.7, lng: 138.6 },
  'napa valley': { lat: 38.5, lng: -122.3 }, 'languedoc-roussillon': { lat: 43.6, lng: 3.4 },
  'maule valley': { lat: -35.7, lng: -71.6 },
};

function slugify(s) { return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function curate(regions) {
  // hard cap; fill by depth desc then name; then guarantee >=1 region per non-empty lens.
  const sorted = [...regions].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const picked = sorted.filter((r) => r.total >= CURATE_MIN_DEPTH).slice(0, CURATE_CAP);
  const pickedSet = new Set(picked.map((r) => r.name));
  for (const [lens, groups] of Object.entries(LENS_GROUPS)) {
    const lensCount = (r) => groups.reduce((n, g) => n + (r.countsByGroup[g] ?? 0), 0);
    if (picked.some((r) => lensCount(r) > 0)) continue;             // lens already represented
    const best = sorted.find((r) => lensCount(r) > 0 && !pickedSet.has(r.name));
    if (!best) continue;                                            // lens has zero eligible -> omit
    // substitute: drop the lowest-depth picked region (if at cap), add best
    if (picked.length >= CURATE_CAP) {
      const drop = picked.reduce((lo, r) => (r.total < lo.total ? r : lo), picked[0]);
      picked.splice(picked.indexOf(drop), 1); pickedSet.delete(drop.name);
    }
    picked.push(best); pickedSet.add(best.name);
  }
  return picked;
}

function main() {
  const rows = (() => { const raw = JSON.parse(fs.readFileSync(resolveExportPath(), 'utf8')); return Array.isArray(raw) ? raw : (raw?.products ?? []); })();
  const { byRegion, byCountry } = aggregate(rows);
  const coords = loadTaxonomyCoords();

  // Region -> parent country (most common country among its in-stock products).
  const regionCountry = new Map();
  for (const r of rows) {
    const rg = (r.region || '').trim(), co = (r.country || '').trim();
    if (rg && co && !regionCountry.has(rg)) regionCountry.set(rg, co);
  }

  let rolledUp = 0;
  const regions = [];
  for (const [name, agg] of byRegion) {
    const key = name.toLowerCase();
    const coord = coords.region.get(key) ?? CENTROIDS[key];
    if (!coord) { rolledUp += 1; continue; } // no coord -> represented via its country pin only
    regions.push({
      name, slug: slugify(name), country: regionCountry.get(name) ?? '',
      lat: coord.lat, lng: coord.lng, ...agg,
    });
  }
  const curated = curate(regions);

  const countries = [];
  for (const [name, agg] of byCountry) {
    const coord = coords.country.get(name.toLowerCase());
    if (!coord) continue;
    countries.push({ name, slug: slugify(name), lat: coord.lat, lng: coord.lng, total: agg.total, countsByGroup: agg.countsByGroup });
  }

  const out = {
    _meta: {
      generated: new Date().toISOString(),
      totalMapped: [...byRegion.values()].reduce((n, a) => n + a.total, 0),
      rolledUpRegions: rolledUp, curatedCount: curated.length,
    },
    regions: curated, countries,
  };
  const dir = path.join(catalogRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'explore-map-data.json');
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log(`gen-explore-map-data: ${curated.length} curated regions, ${countries.length} countries, ${rolledUp} regions rolled up to country (no coord) -> ${file}`);
}

// Run main() only when invoked directly (not when imported by vitest).
if (process.argv[1] && process.argv[1].endsWith('gen-explore-map-data.mjs')) main();
```

- [ ] **Step 2: Wire prebuild + gitignore**

Edit `apps/catalog/package.json` line 7:
```json
"prebuild": "node scripts/gen-search-index.mjs && node scripts/gen-explore-map-data.mjs",
```
Append to `apps/catalog/.gitignore`:
```
# generated at prebuild (scripts/gen-explore-map-data.mjs) — regenerated on every build
/data/explore-map-data.json
```

- [ ] **Step 3: Generate the file + sanity-check output**

Run: `cd "apps/catalog" && node scripts/gen-explore-map-data.mjs`
Expected: log line e.g. `gen-explore-map-data: ~20 curated regions, ~60 countries, N regions rolled up... -> .../data/explore-map-data.json`. Verify the file exists and `_meta.rolledUpRegions` is reported (Rule 2 — not silently dropped). Spot-check that Bordeaux, a sake region (e.g. Niigata), and Speyside are in `regions`.

- [ ] **Step 4: Add a centroid-parity guard test (prevents the two copies drifting)**

The `.mjs` inlines `CENTROIDS` because it can't import the TS `region-centroids.ts`. Guard the duplication. The `.mjs` exports its table for the test — add `export const CENTROIDS = {...}` (make the const exported), then append to `lib/__tests__/explore-map-data.test.ts`:

```ts
import { CENTROIDS as MJS_CENTROIDS } from '@/scripts/gen-explore-map-data.mjs';
import { REGION_CENTROIDS } from '@/lib/explore/region-centroids';

describe('centroid parity (TS module vs .mjs inline copy)', () => {
  it('the two hand-maintained centroid tables agree on keys + lat/lng', () => {
    expect(Object.keys(MJS_CENTROIDS).sort()).toEqual(Object.keys(REGION_CENTROIDS).sort());
    for (const k of Object.keys(REGION_CENTROIDS)) {
      expect(MJS_CENTROIDS[k].lat).toBe(REGION_CENTROIDS[k].lat);
      expect(MJS_CENTROIDS[k].lng).toBe(REGION_CENTROIDS[k].lng);
    }
  });
});
```

- [ ] **Step 5: Run the loader + gen + parity tests**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map-gen.test.ts lib/__tests__/explore-map-data.test.ts`
Expected: PASS (incl. the loader test from Task 5 and the parity test). If parity fails, sync the two tables.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/package.json apps/catalog/.gitignore apps/catalog/lib/__tests__/explore-map-data.test.ts
git commit -m "feat(catalog): explore-map generator IO, deterministic curation, coord resolution, prebuild wiring + centroid parity guard"
```

---

## Task 7: Count==grid invariant + margin-leak guard (Rule 6)

**Files:**
- Create: `apps/catalog/lib/__tests__/explore-map.invariant.test.ts`

Asserts the spec's core guarantee: for every curated region, the build-time `total` **strictly equals** (`===`) what `/shop`'s `matchesFilters` produces for the same `{bev:1, inStock:1, country, region}` in-stock-beverage subset (both axes); and no peek leaks a non-allowlisted field. This is the CLAUDE.md Rule 6 end-to-end invariant. (Depends on Task 2b's `bev=1` flag, `/shop`'s existing `inStock=1` flag, and Task 6 having generated the data file.)

- [ ] **Step 1: Write the test**

Create `apps/catalog/lib/__tests__/explore-map.invariant.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { loadExploreMapData, lensPrimaryGroup } from '@/lib/explore/map-data';

const PEEK_KEYS = new Set(['sku', 'name', 'price', 'image_url']);

describe('explore-map invariant: panel count == /shop grid total', () => {
  const data = loadExploreMapData();
  const all = getAllProducts();

  it('every curated region: map total === /shop grid total for {bev:1,inStock:1,country,region} (STRICT)', () => {
    for (const r of data.regions) {
      // bev:1 (group axis) + inStock:1 (stock axis) make /shop count the SAME
      // in-stock-beverage subset the generator counted. getAllProducts() returns
      // in-stock AND OOS, so inStock:1 is REQUIRED — without it grid counts OOS too
      // (Bordeaux 323 in-stock vs 753 incl. OOS) and this strict test fails.
      // applyShopQuery returns { items, total, ... }; total is the full filtered count.
      const grid = applyShopQuery(all, { bev: '1', inStock: '1', country: r.country, region: r.name });
      // STRICT equality — Rule 5: a <= test would green-light the count!=grid bug.
      expect(grid.total, `count mismatch for ${r.name}`).toBe(r.total);
      expect(r.total).toBeGreaterThan(0);
    }
  });

  it('lens handoff group is a real /shop group for a represented lens', () => {
    const r = data.regions.find((x) => (x.countsByGroup['Wine'] ?? 0) > 0)!;
    const grid = applyShopQuery(all, { bev: '1', inStock: '1', country: r.country, region: r.name, group: lensPrimaryGroup('wine')! });
    expect(grid.total).toBeGreaterThan(0);
  });

  it('NO peek carries a non-allowlisted (margin) field', () => {
    for (const r of data.regions) {
      for (const peek of r.peeks) {
        for (const k of Object.keys(peek)) expect(PEEK_KEYS.has(k)).toBe(true);
      }
    }
  });
});
```

If this STRICT test fails for a region, the generator's exclusion/in-stock logic disagrees with `/shop`'s `bev=1` matcher — FIX the generator (or the `bev` filter), NOT the test (Rule 5). `applyShopQuery` returns `{ items, total, page, pageSize, totalPages, pageItems }` (verified `shop-query.ts:63-76`); `.total` is the full filtered count.

- [ ] **Step 2: Run the test**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/explore-map.invariant.test.ts`
Expected: PASS. If a region's `total` exceeds the in-stock grid, the generator's exclusion/in-stock logic disagrees with `/shop` — FIX the generator, not the test (Rule 5).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/__tests__/explore-map.invariant.test.ts
git commit -m "test(catalog): explore-map count==grid invariant + margin-leak guard (Rule 6)"
```

---

## Task 8: CategoryLens + EscapeHatch components

**Files:**
- Create: `apps/catalog/components/explore/CategoryLens.tsx`
- Create: `apps/catalog/components/explore/EscapeHatch.tsx`

Presentational, low-risk. CategoryLens = 5 chips (All/Wine/Whisky/Spirits/Sake) calling `onSelect(lens)`; active chip burgundy. EscapeHatch = an always-visible link to `/shop`. Both follow the Maison tokens (burgundy `--primary`, 44px targets, `:focus-visible` ring inherited).

- [ ] **Step 1: Implement CategoryLens.tsx**

```tsx
'use client';
import type { LensKey } from '@/lib/explore/types';

const LENSES: { key: LensKey; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'wine', label: 'Wine' },
  { key: 'whisky', label: 'Whisky' }, { key: 'spirits', label: 'Spirits' },
  { key: 'sake', label: 'Sake' },
];

export function CategoryLens({ active, onSelect, available }: {
  active: LensKey; onSelect: (l: LensKey) => void; available: Set<LensKey>;
}) {
  return (
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
      {LENSES.filter((l) => l.key === 'all' || available.has(l.key)).map((l) => (
        <button key={l.key} onClick={() => onSelect(l.key)}
          aria-pressed={active === l.key}
          className={`min-h-11 rounded-md border px-4 text-base transition-colors ${
            active === l.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-secondary'
          }`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement EscapeHatch.tsx**

```tsx
import Link from 'next/link';

export function EscapeHatch({ totalProducts }: { totalProducts: number }) {
  return (
    <Link href="/shop" className="inline-flex min-h-11 items-center text-base text-primary underline underline-offset-4 hover:opacity-80">
      Not here? Browse all {totalProducts.toLocaleString()}+ bottles →
    </Link>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd "apps/catalog" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/explore/CategoryLens.tsx apps/catalog/components/explore/EscapeHatch.tsx
git commit -m "feat(catalog): explore-map CategoryLens + EscapeHatch"
```

---

## Task 9: RegionDrawer (the glance panel)

**Files:**
- Create: `apps/catalog/components/explore/RegionDrawer.tsx`
- Test: `apps/catalog/components/__tests__/RegionDrawer.test.tsx`

Side drawer (desktop) / bottom sheet (mobile): region name, lens-aware count, price range, up to 6 peek thumbnails (via `StorefrontImage`), and a "View all N →" CTA whose href is `shopHref(region, lens)`. Peek thumbnails link to `/product/[sku]`.

- [ ] **Step 1: Write the failing render test**

Create `apps/catalog/components/__tests__/RegionDrawer.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { MapRegion } from '@/lib/explore/types';

const region: MapRegion = {
  name: 'Bordeaux', slug: 'bordeaux', country: 'France', lat: 44.8, lng: -0.6,
  total: 323, countsByGroup: { Wine: 321, Liqueur: 2 }, priceRange: { min: 890, max: 48000 },
  peeks: [{ sku: 'WIN1', name: 'Ch. Test', price: 1200, image_url: 'a.jpg' }],
};

describe('RegionDrawer', () => {
  it('shows name, lens count, price range, and a /shop CTA with region NAME', () => {
    render(<RegionDrawer region={region} lens="wine" onClose={() => {}} />);
    expect(screen.getByText('Bordeaux')).toBeInTheDocument();
    expect(screen.getByText(/321/)).toBeInTheDocument();        // wine lens count
    const cta = screen.getByRole('link', { name: /view all/i });
    expect(cta).toHaveAttribute('href', expect.stringContaining('region=Bordeaux'));
    expect(cta).toHaveAttribute('href', expect.stringContaining('country=France'));
  });
  it('peek links to the product page', () => {
    render(<RegionDrawer region={region} lens="all" onClose={() => {}} />);
    expect(screen.getByRole('link', { name: /ch\. test/i })).toHaveAttribute('href', '/product/WIN1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "apps/catalog" && npx vitest run components/__tests__/RegionDrawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RegionDrawer.tsx**

```tsx
'use client';
import Link from 'next/link';
import { StorefrontImage } from '@/components/StorefrontImage';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount, shopHref } from '@/lib/explore/map-data';

function priceLabel(min: number | null, max: number | null): string {
  if (min === null || max === null) return '';
  const f = (n: number) => `฿${n.toLocaleString()}`;
  return min === max ? f(min) : `${f(min)}–${f(max)}`;
}

export function RegionDrawer({ region, lens, onClose }: {
  region: MapRegion; lens: LensKey; onClose: () => void;
}) {
  const count = lensCount(region, lens);
  return (
    <aside aria-label={`${region.name} details`}
      className="flex h-full w-full max-w-sm flex-col gap-4 border-l border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Region · {region.country}</div>
          <h2 className="text-2xl font-semibold text-foreground">{region.name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <p className="text-base text-muted-foreground">
        {count.toLocaleString()} {count === 1 ? 'bottle' : 'bottles'}
        {priceLabel(region.priceRange.min, region.priceRange.max) && ` · ${priceLabel(region.priceRange.min, region.priceRange.max)}`}
      </p>
      {region.peeks.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {region.peeks.map((p) => (
            <li key={p.sku}>
              <Link href={`/product/${p.sku}`} className="block" aria-label={p.name}>
                <StorefrontImage src={p.image_url} alt={p.name} />
                <span className="mt-1 block truncate text-sm text-foreground">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={shopHref(region, lens)}
        className="mt-auto inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90">
        View all {count.toLocaleString()} →
      </Link>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "apps/catalog" && npx vitest run components/__tests__/RegionDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/components/explore/RegionDrawer.tsx apps/catalog/components/__tests__/RegionDrawer.test.tsx
git commit -m "feat(catalog): explore-map RegionDrawer glance panel"
```

---

## Task 10: RegionList (accessible fallback + SEO surface)

**Files:**
- Create: `apps/catalog/components/explore/RegionList.tsx`

A plain, high-contrast list of curated regions (name, country, lens-aware count), each a `<Link>` to `/explore-map/[slug]`. This is the PRIMARY experience for screen readers / low vision and renders in static HTML (crawlable). Server-renderable (no 'use client').

- [ ] **Step 1: Implement RegionList.tsx**

```tsx
import Link from 'next/link';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

export function RegionList({ regions, lens }: { regions: MapRegion[]; lens: LensKey }) {
  const shown = regions
    .map((r) => ({ r, n: lensCount(r, lens) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    <nav aria-label="Browse regions" className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-foreground">All regions</h2>
      <ul className="divide-y divide-border">
        {shown.map(({ r, n }) => (
          <li key={r.slug}>
            <Link href={`/explore-map/${r.slug}`}
              className="flex min-h-12 items-center justify-between py-3 text-base text-foreground hover:text-primary">
              <span>{r.name} <span className="text-muted-foreground">· {r.country}</span></span>
              <span className="text-muted-foreground">{n.toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/catalog" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/explore/RegionList.tsx
git commit -m "feat(catalog): explore-map accessible RegionList fallback"
```

---

## Task 11: RegionAtlas (the stylized SVG map)

**Files:**
- Create: `apps/catalog/components/explore/RegionAtlas.tsx`

A light, on-brand SVG world silhouette with one `<button>` (or `<Link>`) hotspot per curated region, positioned by authored `x/y` (0..100% of viewBox) when present, else by an equirectangular projection of `lat/lng`. Hotspots are real focusable elements with text labels + counts (≥44px), sized by `total`. Calls `onSelect(region)`. Respects `prefers-reduced-motion`.

Implementation notes for the engineer:
- Use a simple equirectangular projection for any hotspot lacking authored x/y: `x% = (lng + 180) / 360 * 100`, `y% = (90 - lat) / 180 * 100`. (The atlas background art must be equirectangular for this to align; otherwise rely on authored x/y from `region-centroids.ts` — spec §10.)
- Background: a soft cream gradient + faint landmass paths (decorative, `aria-hidden`).
- Min-separation: if two hotspots' projected positions are within ~3% of each other, nudge labels (small vertical offset by index) to avoid overlap.
- Each hotspot: `<button>` with burgundy ring/fill scaled by count, an accessible name `"{name}, {count} bottles"`.

- [ ] **Step 1: Implement RegionAtlas.tsx** (presentational; verified visually in Task 13, not unit-tested)

Build per the notes above using Tailwind + inline SVG. Keep it under ~150 lines; no external map libs.

- [ ] **Step 2: Typecheck**

Run: `cd "apps/catalog" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/explore/RegionAtlas.tsx
git commit -m "feat(catalog): explore-map stylized SVG RegionAtlas with accessible hotspots"
```

---

## Task 12: Page shell + client orchestrator + deep-link route

**Files:**
- Modify: `apps/catalog/app/explore-map/page.tsx`
- Create: `apps/catalog/app/explore-map/ExploreRegionClient.tsx`
- Create: `apps/catalog/app/explore-map/[region]/page.tsx`

`page.tsx` (server): loads data, renders `<ExploreRegionClient>` + always renders `<RegionList>` (SEO/fallback) + `<EscapeHatch>`. `ExploreRegionClient` ('use client'): holds `lens` + `selectedRegion` state, renders `<CategoryLens>`, `<RegionAtlas>`, and `<RegionDrawer>` when a region is selected. `[region]/page.tsx`: `generateStaticParams` from curated slugs + `generateMetadata` per region; renders the same shell with that region pre-selected (drawer open).

- [ ] **Step 1: Implement ExploreRegionClient.tsx**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CategoryLens } from '@/components/explore/CategoryLens';
import { RegionAtlas } from '@/components/explore/RegionAtlas';
import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { ExploreMapData, LensKey, MapRegion } from '@/lib/explore/types';
import { LENS_GROUPS } from '@/lib/explore/map-data';

export function ExploreRegionClient({ data, initialRegionSlug }: {
  data: ExploreMapData; initialRegionSlug?: string;
}) {
  const router = useRouter();
  const [lens, setLens] = useState<LensKey>('all');
  const [selected, setSelected] = useState<MapRegion | null>(
    data.regions.find((r) => r.slug === initialRegionSlug) ?? null,
  );
  // lenses that have any represented region
  const available = new Set<LensKey>();
  for (const r of data.regions)
    for (const [lk, groups] of Object.entries(LENS_GROUPS))
      if (groups.some((g) => (r.countsByGroup[g] ?? 0) > 0)) available.add(lk as LensKey);

  return (
    <div className="relative">
      <div className="mb-4"><CategoryLens active={lens} onSelect={setLens} available={available} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <RegionAtlas regions={data.regions} lens={lens}
          onSelect={(r) => { setSelected(r); router.push(`/explore-map/${r.slug}`, { scroll: false }); }} />
        {selected && (
          <RegionDrawer region={selected} lens={lens}
            onClose={() => { setSelected(null); router.push('/explore-map', { scroll: false }); }} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement app/explore-map/page.tsx** (replace placeholder)

```tsx
import type { Metadata } from 'next';
import { loadExploreMapData } from '@/lib/explore/map-data';
import { ExploreRegionClient } from './ExploreRegionClient';
import { RegionList } from '@/components/explore/RegionList';
import { EscapeHatch } from '@/components/explore/EscapeHatch';

export const metadata: Metadata = {
  title: 'Explore by Region — WNLQ9',
  description: 'Browse our wine, whisky and spirits by the regions they come from.',
};

export default function ExploreMapPage() {
  const data = loadExploreMapData();
  const total = data.countries.reduce((n, c) => n + c.total, 0);
  return (
    <section className="container py-10">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Explore by Region</h1>
      <p className="mt-3 text-lg text-muted-foreground">Discover the collection by place — tap a region to see what we carry there.</p>
      <div className="mt-8"><ExploreRegionClient data={data} /></div>
      <div className="mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
    </section>
  );
}
```

- [ ] **Step 3: Implement app/explore-map/[region]/page.tsx**

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadExploreMapData } from '@/lib/explore/map-data';
import { ExploreRegionClient } from '../ExploreRegionClient';
import { RegionList } from '@/components/explore/RegionList';
import { EscapeHatch } from '@/components/explore/EscapeHatch';

export function generateStaticParams() {
  return loadExploreMapData().regions.map((r) => ({ region: r.slug }));
}

export function generateMetadata({ params }: { params: { region: string } }): Metadata {
  const r = loadExploreMapData().regions.find((x) => x.slug === params.region);
  if (!r) return { title: 'Region — WNLQ9' };
  return {
    title: `${r.name} — Explore by Region — WNLQ9`,
    description: `Browse our ${r.total} bottles from ${r.name}, ${r.country}.`,
  };
}

export default function RegionPage({ params }: { params: { region: string } }) {
  const data = loadExploreMapData();
  const region = data.regions.find((r) => r.slug === params.region);
  if (!region) notFound();
  const total = data.countries.reduce((n, c) => n + c.total, 0);
  return (
    <section className="container py-10">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Explore by Region</h1>
      <div className="mt-8"><ExploreRegionClient data={data} initialRegionSlug={params.region} /></div>
      <div className="mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
    </section>
  );
}
```

- [ ] **Step 4: Typecheck + full test run**

Run: `cd "apps/catalog" && npx tsc --noEmit && npx vitest run`
Expected: PASS (all suites, incl. invariant).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/app/explore-map
git commit -m "feat(catalog): explore-map page shell, client orchestrator, deep-linkable region route"
```

---

## Task 13: Build + browser verification (CLAUDE.md Rule 7 — mandatory)

**Files:** none (verification only).

- [ ] **Step 1: Clean prebuild + production build**

Run: `cd "apps/catalog" && npm run build`
Expected: prebuild logs both generators; build succeeds; `/explore-map` and `/explore-map/[region]` appear as static (SSG) routes. No type errors.

- [ ] **Step 2: Start the server + walk the journey**

Run: `cd "apps/catalog" && npm run start` (port 3100). In a browser:
- Open `http://localhost:3100/explore-map` — atlas renders (light Maison), hotspots visible with counts, region list below, escape hatch present.
- Click a region hotspot → drawer opens with count, price, peek thumbnails; URL becomes `/explore-map/<slug>`.
- Switch the category lens → hotspots/counts refilter; an empty lens (if any) is hidden.
- Click "View all N →" → lands on `/shop` filtered; confirm the **grid total matches the drawer count** (the core invariant, visually).
- Open `http://localhost:3100/explore-map/bordeaux` directly → drawer pre-opened (deep link works); browser back returns to the atlas.
- Tab through with the keyboard → hotspots and list links are focusable with a visible burgundy ring; drawer close is reachable.
- Narrow to mobile width → drawer becomes a usable bottom sheet / full-width panel; targets ≥44px.
- Confirm a sake region (e.g. Niigata) is present and clickable (centroid supplement worked).

- [ ] **Step 2b: Verify data shipped (Rule 1/Rule 9 spirit)**

Confirm `apps/catalog/data/explore-map-data.json` exists, `_meta.curatedCount` is ~15–25, `_meta.rolledUpRegions` is reported, and the `/shop` hand-off for one region returns a non-empty grid. Counting the file's existence is not enough — the browser walkthrough above is the proof the data reached the UI.

- [ ] **Step 3: Commit any fixes**

If the walkthrough surfaced issues, fix them, re-run `npm run build`, re-verify, and commit:
```bash
git add -A apps/catalog
git commit -m "fix(catalog): explore-map issues found in browser verification"
```

---

## Task 14: Finalize

- [ ] **Step 1: Full suite + typecheck green**

Run: `cd "apps/catalog" && npx tsc --noEmit && npx vitest run`
Expected: all PASS.

- [ ] **Step 2: Confirm no margin leak in the generated file**

Run: `cd "apps/catalog" && node -e "const d=require('./data/explore-map-data.json');const ok=d.regions.every(r=>r.peeks.every(p=>Object.keys(p).every(k=>['sku','name','price','image_url'].includes(k))));console.log('peek fields safe:',ok)"`
Expected: `peek fields safe: true`.

- [ ] **Step 3: Use superpowers:finishing-a-development-branch** to decide merge/PR/cleanup.
