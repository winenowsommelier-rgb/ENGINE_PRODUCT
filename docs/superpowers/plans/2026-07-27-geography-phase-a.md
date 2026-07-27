# Geography Phase A — 4-Level Map Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the explore map pin wine regions at their real level — Napa Valley, Barolo, Colchagua — instead of collapsing everything into California / Central Valley / South Australia.

**Architecture:** Split the shared geo-alias table into spelling-normalization vs hierarchy-parent (they are different concepts sharing one table today). Add a 4-level resolver reading all three coordinate arrays in `explore-taxonomy.json` with accent normalization. Aggregate into `ownTotal` (per-row, exactly once) + derived `inclusiveTotal`, which is what keeps the existing map-total == shop-grid invariant satisfiable. Read-only: no DB writes anywhere in Phase A.

**Tech Stack:** TypeScript (catalog lib), plain Node `.mjs` (prebuild generator — cannot import TS, so it mirrors logic and is parity-tested), Vitest, Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-07-27-geography-resolution-design.md`

---

## Context an engineer new to this repo needs

**Rule 9 — two data sources.** The catalog UI reads `data/live_products_export.json`, NOT the SQLite DB. Phase A never writes the DB, so no export refresh is needed. But every count you verify must come from the export, not `products.db` — they differ slightly (the DB runs ahead of the last refresh).

**Rule 7 — UI changes need browser verification.** "Tests pass" is necessary but not sufficient. Task 9 is not optional.

**Rule 5 — anti-tests.** If a test asserts the bug, rewrite it and leave a regression-guard comment. Task 2 does exactly this. Do not preserve the old behavior to keep a test green.

**The `.mjs` duplication is deliberate.** `gen-explore-map-data.mjs` runs at prebuild, before `tsc`, so it cannot import from `apps/catalog/lib/*.ts`. It hand-copies logic and a parity test guards the drift. Do not "fix" this by adding a build step.

**The invariant that governs everything.** `explore-map.invariant.test.ts` asserts STRICT equality between each pin's total and `applyShopQuery(...)`. A pin whose `/shop` query cannot reproduce its count fails the build. This is why Task 7 (appellation filter) must land before Task 8 (appellation pins).

**Dev server runs on port 3100**, not 3212. On `Cannot find module` 500s, `rm -rf apps/catalog/.next`.

**Where the numbers come from.** All row counts in this plan are export-derived with four filters: non-empty `sku`, `category_group` not in Accessories/Events/Cigars/Non-Alcoholic, non-empty `subregion`, accent+punctuation normalized. Reproducing without all four gives different numbers.

---

## File Structure

**Modify:**
- `apps/catalog/lib/geo-aliases.ts` — split alias table; add ancestor matching (Tasks 1-2)
- `apps/catalog/lib/geo-resolve.ts` — **CREATE**: the 4-level resolver (Task 3)
- `apps/catalog/scripts/gen-explore-map-data.mjs` — mirror resolver, 4-level aggregation, gap report (Tasks 4, 5, 6, 8)
- `apps/catalog/lib/explore/types.ts` — `ownTotal`/`inclusiveTotal`/`pinLevel` fields (Task 5)
- `apps/catalog/lib/explore/map-data.ts` — `shopHref` emits subregion/appellation (Task 6)
- `apps/catalog/lib/shop-query.ts` — appellation filter clause (Task 7)
- `apps/catalog/lib/drill-query.ts` — appellation descendant (Task 7)
- `apps/catalog/components/DrillBreadcrumb.tsx` — appellation in GEO_STRAND (Task 7)
- `apps/catalog/app/product/[sku]/page.tsx` — un-suppress appellation (Task 10)

**Test:**
- `apps/catalog/lib/__tests__/geo-resolve.test.ts` — **CREATE** (Task 3)
- `apps/catalog/lib/__tests__/geo-aliases.test.ts` — **CREATE** (Task 1)
- `apps/catalog/lib/__tests__/shop-query.test.ts` — rewrite anti-test (Task 2)
- `apps/catalog/lib/__tests__/explore-map-gen.test.ts` — rollup arithmetic (Task 5)
- `apps/catalog/lib/__tests__/explore-map.invariant.test.ts` — per-level hand-off (Task 8)

**Task order is load-bearing.** Task 7 before Task 8 (a pin needs a queryable filter). Task 3 before Task 4 (TS resolver before its `.mjs` mirror).

---

### Task 1: Split the alias table by intent

Today `REGION_ALIASES_BY_COUNTRY` mixes two concepts. `highlands → Highland` is a spelling fix. `napa valley → California` destroys a hierarchy level. Separate them.

**Files:**
- Modify: `apps/catalog/lib/geo-aliases.ts:5-14`
- Test: `apps/catalog/lib/__tests__/geo-aliases.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  canonicalRegionForCountry,
  isRegionLevelValueForCountry,
  regionMatchesFilter,
} from '../geo-aliases';

describe('geo-aliases — spelling vs hierarchy', () => {
  it('still normalizes SPELLING aliases (Scotland)', () => {
    expect(canonicalRegionForCountry('Scotland', 'Highlands')).toBe('Highland');
    expect(canonicalRegionForCountry('Scotland', 'Lowlands')).toBe('Lowland');
  });

  it('NO LONGER collapses Napa Valley into California', () => {
    // Regression guard: napa->California was a HIERARCHY COLLAPSE disguised as a
    // spelling alias. It destroyed the sub-AVA level and is why the explore map
    // showed every USA wine as "California". See spec 2026-07-27.
    expect(canonicalRegionForCountry('USA', 'Napa Valley')).toBe('Napa Valley');
  });

  it('still drops a region value equal to its own country', () => {
    expect(canonicalRegionForCountry('France', 'France')).toBe('');
  });

  it('isRegionLevelValueForCountry reads the UNION of both tables', () => {
    // California comes from HIERARCHY_PARENT values; Highland from SPELLING_ALIASES.
    // Reading only one table regresses the other country.
    expect(isRegionLevelValueForCountry('USA', 'California')).toBe(true);
    expect(isRegionLevelValueForCountry('Scotland', 'Highland')).toBe(true);
    expect(isRegionLevelValueForCountry('USA', 'Napa Valley')).toBe(false);
  });

  it('regionMatchesFilter matches a product via its ANCESTOR', () => {
    // A product at region='Napa Valley' must still match ?region=California.
    expect(regionMatchesFilter('USA', 'Napa Valley', 'California')).toBe(true);
    // Direct match still works.
    expect(regionMatchesFilter('USA', 'California', 'California')).toBe(true);
    // Unrelated region does not match.
    expect(regionMatchesFilter('USA', 'Oregon', 'California')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-aliases.test.ts`
Expected: FAIL — "NO LONGER collapses" gets `'California'`, and the ancestor test fails.

- [ ] **Step 3: Implement the split**

Replace `apps/catalog/lib/geo-aliases.ts:5-47` entirely with:

```ts
/**
 * Geography alias tables. TWO DISTINCT CONCEPTS — do not merge them again.
 *
 * SPELLING_ALIASES rewrites a mis-spelled value to its canonical form. The value
 * still names the SAME place at the SAME level.
 *
 * HIERARCHY_PARENT records that one place sits INSIDE another. It must NOT rewrite
 * the value — doing so destroys a level. `napa valley -> California` lived in the
 * alias table until 2026-07-27 and was the root cause of the explore map showing
 * every USA wine as "California" (spec: 2026-07-27-geography-resolution-design.md).
 */
const SPELLING_ALIASES: Record<string, Record<string, string>> = {
  scotland: {
    highlands: 'Highland',
    lowlands: 'Lowland',
  },
};

/** child (normalized) -> parent NAME, per country. A rollup link, never a rewrite. */
const HIERARCHY_PARENT: Record<string, Record<string, string>> = {
  usa: {
    napa: 'California',
    'napa valley': 'California',
  },
};

function spellingValuesForCountry(country: string | null | undefined): Set<string> {
  const countryKey = normGeo(country);
  return new Set(Object.values(SPELLING_ALIASES[countryKey] ?? {}).map(normGeo));
}

function parentValuesForCountry(country: string | null | undefined): Set<string> {
  const countryKey = normGeo(country);
  return new Set(Object.values(HIERARCHY_PARENT[countryKey] ?? {}).map(normGeo));
}

export function canonicalRegionForCountry(
  country: string | null | undefined,
  region: string | null | undefined,
): string {
  const raw = (region ?? '').trim();
  if (!raw) return '';

  const countryKey = normGeo(country);
  const regionKey = normGeo(raw);
  if (countryKey && countryKey === regionKey) return '';
  // SPELLING only. Hierarchy parents are deliberately NOT applied here.
  return SPELLING_ALIASES[countryKey]?.[regionKey] ?? raw;
}

/**
 * True when `value` names a REGION-level place for this country — i.e. it is the
 * country itself, a canonical spelling target, or a hierarchy parent. Used to drop
 * a redundant subregion (e.g. region='Napa Valley', subregion='California').
 *
 * MUST read the UNION of both tables: reading only HIERARCHY_PARENT regresses
 * Scotland; reading only SPELLING_ALIASES regresses California.
 */
export function isRegionLevelValueForCountry(
  country: string | null | undefined,
  value: string | null | undefined,
): boolean {
  const rawKey = normGeo(value);
  if (!rawKey) return false;
  const countryKey = normGeo(country);
  if (countryKey && countryKey === rawKey) return true;
  return spellingValuesForCountry(country).has(rawKey)
    || parentValuesForCountry(country).has(rawKey);
}

/** The chain of ancestor names above a region, nearest first. Empty when top-level. */
export function regionAncestors(
  country: string | null | undefined,
  region: string | null | undefined,
): string[] {
  const countryKey = normGeo(country);
  const out: string[] = [];
  let cursor = normGeo(region);
  // Bounded walk — the table is shallow, but guard against a future cycle.
  for (let i = 0; i < 8; i += 1) {
    const parent = HIERARCHY_PARENT[countryKey]?.[cursor];
    if (!parent) break;
    out.push(parent);
    cursor = normGeo(parent);
  }
  return out;
}

/**
 * Does a product's region satisfy `?region=` ? True on a direct (canonical) match
 * OR when the filter names any ANCESTOR of the product's region.
 *
 * Ancestor matching costs ~1 row today (only one export row sits at
 * region='Napa Valley'). It is correctness insurance for Phase B3, which normalizes
 * swapped/junk region values and can move rows onto child regions — without this,
 * such rows would silently vanish from the parent's grid.
 */
export function regionMatchesFilter(
  productCountry: string | null | undefined,
  productRegion: string | null | undefined,
  filterRegion: string,
): boolean {
  const want = normGeo(filterRegion);
  const own = normGeo(canonicalRegionForCountry(productCountry, productRegion));
  if (own === want) return true;
  return regionAncestors(productCountry, productRegion).some((a) => normGeo(a) === want);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-aliases.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/geo-aliases.ts apps/catalog/lib/__tests__/geo-aliases.test.ts
git commit -m "refactor(geo): split spelling aliases from hierarchy parents

napa->California was a hierarchy collapse living in the spelling-alias table.
Splitting them stops the map flattening every USA sub-AVA into California.
isRegionLevelValueForCountry now reads the UNION of both tables so Scotland
keeps working; regionMatchesFilter gains ancestor matching."
```

---

### Task 2: Rewrite the anti-tests that lock in the collapse

**SCOPE CORRECTION (found during Task 1 execution).** This plan originally named ONE
anti-test. There are **three** tests encoding the pre-split behaviour:

1. `shop-query.test.ts:148-159` — "canonicalizes region aliases and clears stale
   subregion": asserts `{region:'Napa Valley', subregion:'Oakville'}` → `{region:'California'}`,
   dropping Oakville entirely.
2. `facets.test.ts:71-78` — "regionsFor canonicalizes known region aliases": asserts
   `regionsFor('USA', …)` returns `California`, not `Napa Valley`.
3. `facets.invariant.test.ts:22-23` — **already fixed during Task 1**, because it was not
   an anti-test but a live contradiction: lines 21 and 23 demanded 604 and 603 from the
   same variable once ancestor matching existed. See the Task 1 commits.

**Also note:** `facets.test.ts:76-78` asserts Scotland `Highlands → Highland` but sits
AFTER the failing USA assertion inside the same `it` block, so it never executes. Split
that `it` in two so the Scotland path is actually exercised.

**Files:**
- Modify: `apps/catalog/lib/__tests__/shop-query.test.ts:148-159`
- Modify: `apps/catalog/lib/__tests__/facets.test.ts:71-78` (split the `it`)

- [ ] **Step 1: Run the suite to see the expected failure**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: FAIL on "canonicalizes region aliases and clears stale subregion" — receives `{region:'Napa Valley', subregion:'Oakville'}`.

- [ ] **Step 2: Replace the anti-test**

Replace the `it('canonicalizes region aliases and clears stale subregion', ...)` block with:

```ts
  it('PRESERVES a sub-AVA region + its subregion (no hierarchy collapse)', () => {
    // REGRESSION GUARD (2026-07-27): this test previously asserted
    //   {region:'Napa Valley', subregion:'Oakville'} -> {region:'California'}
    // i.e. it locked in the hierarchy collapse that made the explore map show
    // every USA wine as "California", discarding Oakville outright. The collapse
    // was removed in spec 2026-07-27-geography-resolution-design.md; both levels
    // must now survive normalization.
    expect(normalizeShopParams({
      bev: '1',
      country: 'USA',
      region: 'Napa Valley',
      subregion: 'Oakville',
    })).toEqual({
      bev: '1',
      country: 'USA',
      region: 'Napa Valley',
      subregion: 'Oakville',
    });
  });

  it('still normalizes SPELLING aliases (Scotland Highlands -> Highland)', () => {
    expect(normalizeShopParams({ bev: '1', country: 'Scotland', region: 'Highlands' }))
      .toEqual({ bev: '1', country: 'Scotland', region: 'Highland' });
  });
```

- [ ] **Step 3: Run the full shop-query suite**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS. `'drops subregion values that are canonical regions'` (region='Lodi', subregion='California') must still pass — it depends on the UNION fix from Task 1.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "test(geo): rewrite anti-test that locked in the Napa hierarchy collapse

Per CLAUDE.md Rule 5 — the old assertion encoded the bug (Oakville silently
dropped). Now asserts both levels survive, with a regression-guard comment."
```

---

### Task 3: The 4-level resolver (TS)

**Files:**
- Create: `apps/catalog/lib/geo-resolve.ts`
- Test: `apps/catalog/lib/__tests__/geo-resolve.test.ts`

Two data hazards this must handle, both verified: appellations have **0/81 `parentSlug`** (subregions have 81/81), and **26 names exist at two levels** (`California`, `Barossa Valley`, `Bordeaux`, `Maipo Valley`… are both region AND appellation).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { normGeoName, makeGeoResolver } from '../geo-resolve';

// FIXTURE MIRRORS THE REAL data/taxonomy/explore-taxonomy.json SHAPES — verified
// 2026-07-27. Do not "tidy" these into a neater hierarchy; the awkwardness IS the
// test. In particular: Sonoma County / Barossa Valley are REGIONS that also have a
// same-named appellation entry, and Napa Valley's parentSlug is 'napa' (a separate
// region), NOT 'california'.
const TAXONOMY = {
  regions: [
    { name: 'California', latitude: 37.3, longitude: -119.0, slug: 'california' },
    { name: 'Piedmont', latitude: 44.9, longitude: 8.2, slug: 'piedmont' },
    { name: 'Central Valley', latitude: -34.5, longitude: -71.0, slug: 'central-valley' },
    // Real: a REGION, despite living in the subregion field on 71 product rows.
    { name: 'Sonoma County', latitude: 38.4, longitude: -122.8, slug: 'sonoma-county' },
    // Real: a REGION with NO appellation twin.
    { name: 'Colchagua Valley', latitude: -34.6, longitude: -71.1, slug: 'colchagua-valley' },
  ],
  subregions: [
    // Real parentSlug is 'napa', NOT 'california'. The resolver must take the parent
    // from the product ROW, never from parentSlug.
    { name: 'Napa Valley', latitude: 38.5, longitude: -122.3, slug: 'napa-valley', parentSlug: 'napa' },
    { name: 'Langhe', latitude: 44.6, longitude: 8.0, slug: 'langhe', parentSlug: 'piedmont' },
  ],
  appellations: [
    // NOTE: no parentSlug — mirrors the real file (0/81 have one).
    { name: 'Barolo', latitude: 44.6, longitude: 7.9, slug: 'barolo' },
    { name: 'Châteauneuf-du-Pape', latitude: 44.0, longitude: 4.8, slug: 'chateauneuf-du-pape' },
    // Collides with the region of the same name — must NOT win for a region value.
    { name: 'California', latitude: 36.0, longitude: -120.0, slug: 'california-ava' },
    // Collides with the REGION Sonoma County. If this wins, 71 rows pin as
    // appellation and the strict invariant queries appellation='Sonoma County'
    // against 0 matching rows -> build failure.
    { name: 'Sonoma County', latitude: 38.5, longitude: -122.8, slug: 'sonoma-county-ava' },
  ],
};

describe('normGeoName', () => {
  it('strips accents and collapses punctuation', () => {
    expect(normGeoName('Châteauneuf-du-Pape')).toBe('chateauneuf du pape');
    expect(normGeoName('Penedès')).toBe('penedes');
    expect(normGeoName('  Napa  Valley ')).toBe('napa valley');
  });
});

describe('makeGeoResolver', () => {
  const resolve = makeGeoResolver(TAXONOMY);

  it('pins at SUBREGION when the row has one with coords', () => {
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Napa Valley' });
    expect(n).toMatchObject({
      pinName: 'Napa Valley', pinLevel: 'subregion',
      parentName: 'California', latitude: 38.5, longitude: -122.3,
    });
  });

  it('pins at APPELLATION and inherits its parent FROM THE ROW', () => {
    // Appellations carry no parentSlug, so the parent must come from the product row.
    const n = resolve({ country: 'Italy', region: 'Piedmont', subregion: 'Barolo' });
    expect(n).toMatchObject({
      pinName: 'Barolo', pinLevel: 'appellation', parentName: 'Piedmont',
    });
  });

  it('scopes lookup by SOURCE FIELD so cross-level collisions do not orphan', () => {
    // 'California' exists as BOTH region and appellation. A value arriving in the
    // region field must resolve against regions, not the parentless appellation.
    const n = resolve({ country: 'USA', region: 'California', subregion: '' });
    expect(n).toMatchObject({ pinName: 'California', pinLevel: 'region', latitude: 37.3 });
  });

  it('a REGION-classified value in the subregion field pins at REGION level', () => {
    // Sonoma County is a REGION in the taxonomy but sits in the subregion field on
    // 71 product rows, AND has a same-named appellation entry. Without the regions
    // fallback it resolves to the appellation, the invariant queries
    // appellation='Sonoma County', and 0 of those 71 rows carry any appellation
    // value -> hard build failure. This test is that guard.
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Sonoma County' });
    expect(n).toMatchObject({ pinName: 'Sonoma County', pinLevel: 'region', latitude: 38.4 });
  });

  it('Colchagua Valley (region, no appellation twin) pins at REGION level', () => {
    const n = resolve({ country: 'Chile', region: 'Central Valley', subregion: 'Colchagua Valley' });
    expect(n).toMatchObject({ pinName: 'Colchagua Valley', pinLevel: 'region' });
  });

  it('takes a subregion parent from the ROW, never from parentSlug', () => {
    // Napa Valley's real parentSlug is 'napa' (a separate region). Using it would
    // make shopHref emit region=Napa, which matches 1 row instead of ~299.
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Napa Valley' });
    expect(n!.parentName).toBe('California');
    expect(n!.parentName).not.toBe('Napa');
  });

  it('falls back to REGION when the subregion resolves to nothing', () => {
    const n = resolve({ country: 'Chile', region: 'Central Valley', subregion: 'Unknown Valley' });
    expect(n).toMatchObject({ pinName: 'Central Valley', pinLevel: 'region' });
  });

  it('returns null when nothing resolves (row rolls up to country)', () => {
    expect(resolve({ country: 'Thailand', region: 'Nowhere', subregion: 'Nope' })).toBeNull();
  });

  it('normalizes accents when matching', () => {
    const n = resolve({ country: 'France', region: '', subregion: 'Chateauneuf-du-Pape' });
    expect(n).toMatchObject({ pinName: 'Châteauneuf-du-Pape', pinLevel: 'appellation' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-resolve.test.ts`
Expected: FAIL — "Cannot find module '../geo-resolve'".

- [ ] **Step 3: Implement the resolver**

Create `apps/catalog/lib/geo-resolve.ts`:

```ts
/**
 * geo-resolve — resolve a product row to its most specific PINNABLE geography node.
 *
 * Reads all THREE coordinate arrays of explore-taxonomy.json (regions, subregions,
 * appellations). The generator historically read only `regions`, which is why 81
 * subregion + 81 appellation coordinate sets sat unused and Napa/Barolo/Colchagua
 * were invisible. Spec: 2026-07-27-geography-resolution-design.md.
 *
 * PURE + fs-free so it can be unit-tested without Next and mirrored by the .mjs
 * prebuild generator (which cannot import TS). Parity-guarded.
 */

export type PinLevel = 'region' | 'subregion' | 'appellation';

export interface GeoNode {
  pinName: string;
  pinLevel: PinLevel;
  parentName: string;
  latitude: number;
  longitude: number;
  slug: string;
}

interface TaxonomyEntry {
  name: string;
  latitude?: number;
  longitude?: number;
  slug?: string;
  parentSlug?: string;
}

export interface TaxonomySource {
  regions?: TaxonomyEntry[];
  subregions?: TaxonomyEntry[];
  appellations?: TaxonomyEntry[];
}

export interface GeoRow {
  country?: string | null;
  region?: string | null;
  subregion?: string | null;
}

/** NFKD accent strip + punctuation collapse. 'Châteauneuf-du-Pape' -> 'chateauneuf du pape'. */
export function normGeoName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function indexOf(entries: TaxonomyEntry[] | undefined): Map<string, TaxonomyEntry> {
  const m = new Map<string, TaxonomyEntry>();
  for (const e of entries ?? []) {
    if (typeof e?.latitude !== 'number' || typeof e?.longitude !== 'number') continue;
    const k = normGeoName(e.name);
    if (k && !m.has(k)) m.set(k, e);
  }
  return m;
}

/**
 * Build a resolver over a taxonomy object. Returns null when nothing resolves —
 * the caller then rolls the row up to its country. NEVER drop the row.
 */
export function makeGeoResolver(taxonomy: TaxonomySource) {
  const byLevel: Record<PinLevel, Map<string, TaxonomyEntry>> = {
    region: indexOf(taxonomy.regions),
    subregion: indexOf(taxonomy.subregions),
    appellation: indexOf(taxonomy.appellations),
  };

  const node = (level: PinLevel, entry: TaxonomyEntry, parentName: string): GeoNode => ({
    pinName: entry.name,
    pinLevel: level,
    parentName,
    latitude: entry.latitude as number,
    longitude: entry.longitude as number,
    slug: entry.slug ?? normGeoName(entry.name).replace(/ /g, '-'),
  });

  return function resolveGeoNode(row: GeoRow): GeoNode | null {
    const region = (row.region ?? '').trim();
    const subregion = (row.subregion ?? '').trim();
    const regionKey = normGeoName(region);
    const subKey = normGeoName(subregion);

    // 1. The subregion field. Try subregions, THEN regions, THEN appellations.
    //
    //    The `regions` fallback is LOAD-BEARING, not a nicety. Many values sitting in
    //    the subregion field are classified as REGIONS in the taxonomy:
    //      Sonoma County    -> regions (parent usa)   + a same-named appellation
    //      Barossa Valley   -> regions (parent au)    + a same-named appellation
    //      Colchagua Valley -> regions (parent chile) , no appellation at all
    //    Skipping regions here makes Sonoma's 71 rows resolve to the APPELLATION
    //    entry, so the invariant queries `appellation=Sonoma County` — and 0 of
    //    those 71 rows have any appellation value. Hard build failure on exactly
    //    the regions this work exists to fix. Appellations are tried LAST because
    //    they are the parentless level (0/81 carry parentSlug).
    if (subKey) {
      const sub = byLevel.subregion.get(subKey);
      if (sub) return node('subregion', sub, region || (row.country ?? ''));
      const asRegion = byLevel.region.get(subKey);
      // A region-classified value in the subregion field still pins at REGION level,
      // so its /shop hand-off uses region= (where the invariant can actually find it).
      if (asRegion) return node('region', asRegion, row.country ?? '');
      const app = byLevel.appellation.get(subKey);
      // Appellations carry NO parentSlug (0/81) — inherit the parent from the ROW.
      if (app) return node('appellation', app, region || (row.country ?? ''));
    }

    // 2. The region field. Regions first, so a region-field value never loses to a
    //    same-named appellation.
    if (regionKey) {
      const reg = byLevel.region.get(regionKey);
      if (reg) return node('region', reg, row.country ?? '');
      const sub = byLevel.subregion.get(regionKey);
      if (sub) return node('subregion', sub, row.country ?? '');
      const app = byLevel.appellation.get(regionKey);
      if (app) return node('appellation', app, row.country ?? '');
    }

    return null;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-resolve.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/geo-resolve.ts apps/catalog/lib/__tests__/geo-resolve.test.ts
git commit -m "feat(geo): add 4-level resolver reading all 3 coordinate tables

Reads regions + subregions + appellations with accent normalization, taking
resolvable subregion rows from 19.2% to 60.5%. Handles the two data hazards:
appellations have 0/81 parentSlug (parent inherited from the row) and 26 names
exist at two levels (lookup scoped by source field)."
```

---

### Task 4: Mirror the resolver into the `.mjs` generator + parity test

**Files:**
- Modify: `apps/catalog/scripts/gen-explore-map-data.mjs`
- Test: `apps/catalog/lib/__tests__/geo-resolve.test.ts` (append parity block)

- [ ] **Step 1: Write the failing parity test**

Append to `geo-resolve.test.ts`:

```ts
import { normGeoName as mjsNorm, makeGeoResolver as mjsMake } from
  '../../scripts/gen-explore-map-data.mjs';

describe('parity — .mjs mirror matches the TS resolver', () => {
  // gen-explore-map-data.mjs runs at prebuild, BEFORE tsc, so it cannot import TS.
  // It hand-copies the resolver; this test is the only thing preventing drift.
  const probes = [
    'Châteauneuf-du-Pape', 'Penedès', 'Napa Valley', 'CENTRAL  VALLEY', 'Côtes du Rhône', '',
  ];

  it('normGeoName agrees on every probe', () => {
    for (const p of probes) expect(mjsNorm(p)).toBe(normGeoName(p));
  });

  it('resolveGeoNode agrees on every probe row', () => {
    const rows = [
      { country: 'USA', region: 'California', subregion: 'Napa Valley' },
      { country: 'Italy', region: 'Piedmont', subregion: 'Barolo' },
      { country: 'USA', region: 'California', subregion: '' },
      { country: 'Chile', region: 'Central Valley', subregion: 'Colchagua Valley' },
      { country: 'Nowhere', region: 'Nope', subregion: 'Nada Land' },
    ];
    const ts = makeGeoResolver(TAXONOMY);
    const mjs = mjsMake(TAXONOMY);
    for (const r of rows) expect(mjs(r)).toEqual(ts(r));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-resolve.test.ts`
Expected: FAIL — `mjsNorm` / `mjsMake` are not exported.

- [ ] **Step 3: Add the mirror to the generator**

In `gen-explore-map-data.mjs`, after the `CENTROIDS` block (~line 214), add:

```js
/**
 * MIRROR of apps/catalog/lib/geo-resolve.ts. This file is plain .mjs (runs before
 * tsc) so it CANNOT import the TS module. Parity is enforced by the parity block in
 * lib/__tests__/geo-resolve.test.ts — UPDATE BOTH TOGETHER.
 */
export function normGeoName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function indexGeo(entries) {
  const m = new Map();
  for (const e of entries ?? []) {
    if (typeof e?.latitude !== 'number' || typeof e?.longitude !== 'number') continue;
    const k = normGeoName(e.name);
    if (k && !m.has(k)) m.set(k, e);
  }
  return m;
}

export function makeGeoResolver(taxonomy) {
  const byLevel = {
    region: indexGeo(taxonomy.regions),
    subregion: indexGeo(taxonomy.subregions),
    appellation: indexGeo(taxonomy.appellations),
  };
  const node = (level, entry, parentName) => ({
    pinName: entry.name,
    pinLevel: level,
    parentName,
    latitude: entry.latitude,
    longitude: entry.longitude,
    slug: entry.slug ?? normGeoName(entry.name).replace(/ /g, '-'),
  });
  return function resolveGeoNode(row) {
    const region = (row.region ?? '').trim();
    const subregion = (row.subregion ?? '').trim();
    const regionKey = normGeoName(region);
    const subKey = normGeoName(subregion);
    if (subKey) {
      const sub = byLevel.subregion.get(subKey);
      if (sub) return node('subregion', sub, region || (row.country ?? ''));
      // regions fallback is LOAD-BEARING — see the TS original for why.
      const asRegion = byLevel.region.get(subKey);
      if (asRegion) return node('region', asRegion, row.country ?? '');
      const app = byLevel.appellation.get(subKey);
      if (app) return node('appellation', app, region || (row.country ?? ''));
    }
    if (regionKey) {
      const reg = byLevel.region.get(regionKey);
      if (reg) return node('region', reg, row.country ?? '');
      const sub = byLevel.subregion.get(regionKey);
      if (sub) return node('subregion', sub, row.country ?? '');
      const app = byLevel.appellation.get(regionKey);
      if (app) return node('appellation', app, row.country ?? '');
    }
    return null;
  };
}
```

- [ ] **Step 4: Run to verify parity passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/geo-resolve.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/lib/__tests__/geo-resolve.test.ts
git commit -m "feat(geo): mirror resolver into .mjs generator with parity test"
```

---

### Task 5: `ownTotal` / `inclusiveTotal` aggregation

The critical correctness step. `ownTotal` increments per row exactly once; `inclusiveTotal` is **derived** by summing the subtree afterwards — never incremented — so ancestor rollup cannot double-count.

**Files:**
- Modify: `apps/catalog/scripts/gen-explore-map-data.mjs` (`aggregate()` ~line 71, `main()` ~line 268)
- Modify: `apps/catalog/lib/explore/types.ts:17-34`
- Test: `apps/catalog/lib/__tests__/explore-map-gen.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `explore-map-gen.test.ts`:

```ts
import { makeGeoResolver } from '../geo-resolve';

// Node key = country + NUL byte + name. MUST match nodeKey() in the generator.
// (Written as an explicit escape so this plan file stays plain text.)
const SEP = String.fromCharCode(0);
const K = (country: string, name: string) => `${country}${SEP}${name}`;

// Minimal taxonomy: California + Oregon are regions, Napa Valley a subregion.
const TEST_RESOLVER = makeGeoResolver({
  regions: [
    { name: 'California', latitude: 37.3, longitude: -119.0, slug: 'california' },
    { name: 'Oregon', latitude: 44.0, longitude: -120.5, slug: 'oregon' },
  ],
  subregions: [
    { name: 'Napa Valley', latitude: 38.5, longitude: -122.3, slug: 'napa-valley', parentSlug: 'napa' },
  ],
  appellations: [],
});

describe('4-level aggregation — ownTotal vs inclusiveTotal', () => {
  const ROWS = [
    { sku: 'A', category_group: 'Wine', country: 'USA', region: 'California', subregion: 'Napa Valley', price: 100 },
    { sku: 'B', category_group: 'Wine', country: 'USA', region: 'California', subregion: 'Napa Valley', price: 200 },
    { sku: 'C', category_group: 'Wine', country: 'USA', region: 'California', subregion: '', price: 50 },
    { sku: 'D', category_group: 'Wine', country: 'USA', region: 'Oregon', subregion: '', price: 75 },
  ];

  it('a row increments ownTotal at EXACTLY ONE node', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const sumOwn = [...nodes.values()].reduce((n, a) => n + a.ownTotal, 0);
    expect(sumOwn).toBe(ROWS.length); // 4 — no row counted twice
  });

  it('California ownTotal excludes Napa; inclusiveTotal includes it', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const ca = nodes.get(K('USA', 'California'));
    expect(ca.ownTotal).toBe(1);        // only row C
    expect(ca.inclusiveTotal).toBe(3);  // + Napa's A and B
  });

  it('the Napa node is parented to California BY KEY', () => {
    // Guards the subtree assertion below from being vacuous: with a wrong parentKey
    // the children filter matches nothing and every node trivially passes.
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const napa = nodes.get(K('USA', 'Napa Valley'));
    expect(napa.parentKey).toBe(K('USA', 'California'));
    expect(napa.ownTotal).toBe(2);
  });

  it('inclusiveTotal === ownTotal + sum(children) for every node', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    for (const [, n] of nodes) {
      const kids = [...nodes.values()].filter((c) => c.parentKey === n.key);
      const expected = n.ownTotal + kids.reduce((s, c) => s + c.inclusiveTotal, 0);
      expect(n.inclusiveTotal, `subtree mismatch at ${n.name}`).toBe(expected);
    }
  });

  it('an unresolvable subregion rolls up to its parent — no row is dropped', () => {
    const rows = [...ROWS, {
      sku: 'E', category_group: 'Wine', country: 'USA',
      region: 'California', subregion: 'Nonexistent AVA', price: 10,
    }];
    const { nodes, unresolved } = aggregate(rows, { resolver: TEST_RESOLVER });
    const sumOwn = [...nodes.values()].reduce((n, a) => n + a.ownTotal, 0);
    expect(sumOwn).toBe(rows.length);              // 5 — E is still counted
    expect(nodes.get(K('USA', 'California')).ownTotal).toBe(2); // C and E
    expect(unresolved.get('Nonexistent AVA')).toBe(1);          // and it is reported
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/explore-map-gen.test.ts`
Expected: FAIL — `aggregate` does not return `nodes`.

- [ ] **Step 3: Implement**

**3a.** Add the shared node-key helper next to `RC_SEP` in `gen-explore-map-data.mjs`:

```js
/** Node key = country + NUL + pin name. NUL cannot appear in a real name. */
function nodeKey(country, name) { return `${country ?? ''}${RC_SEP}${name}`; }

/** Deepest-first, so a child is always folded into its parent before the parent is read. */
const LEVEL_DEPTH = { appellation: 3, subregion: 2, region: 1, country: 0 };
```

**3b.** Change the `aggregate()` signature to accept a resolver, defaulting to null (existing call sites pass nothing and must keep working):

```js
export function aggregate(rows, { excludeGroups = EXCLUDE_GROUPS, resolver = null } = {}) {
```

**3c.** Inside `aggregate()`, before the row loop, add the node map and its bump helper:

```js
  const nodes = new Map();
  /** name -> unresolved row count, for the Task 8 gap report. */
  const unresolved = new Map();

  const bumpNode = (n, r, group) => {
    let agg = nodes.get(n.key);
    if (!agg) {
      agg = {
        key: n.key, name: n.name, level: n.level, country: n.country,
        parentKey: n.parentKey, parentName: n.parentName,
        latitude: n.latitude, longitude: n.longitude, slug: n.slug,
        ownTotal: 0, inclusiveTotal: 0,
        countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [],
      };
      nodes.set(n.key, agg);
    }
    // ownTotal increments EXACTLY ONCE per row, at EXACTLY ONE node. inclusiveTotal
    // is never touched here — it is derived after the loop (3e).
    agg.ownTotal += 1;
    agg.countsByGroup[group] = (agg.countsByGroup[group] ?? 0) + 1;
    if (typeof r.price === 'number') {
      if (agg.priceRange.min === null || r.price < agg.priceRange.min) agg.priceRange.min = r.price;
      if (agg.priceRange.max === null || r.price > agg.priceRange.max) agg.priceRange.max = r.price;
    }
    if (agg.peeks.length < PEEK_LIMIT && r.image_url) agg.peeks.push(toPeek(r));
  };
```

**3d.** Inside the existing row loop, after the current `bump(...)` calls, add:

```js
    if (resolver) {
      const hit = resolver({ country, region: r.region, subregion: r.subregion });
      if (hit) {
        // A resolved node's parent is its region for a subregion/appellation pin,
        // else the country. parentName comes from the ROW (taxonomy parentSlug is
        // unusable: appellations have none, and Napa Valley's points at 'napa').
        const parentName = hit.pinLevel === 'region' ? '' : hit.parentName;
        bumpNode({
          key: nodeKey(country, hit.pinName), name: hit.pinName, level: hit.pinLevel,
          country, parentName,
          parentKey: parentName ? nodeKey(country, parentName) : null,
          latitude: hit.latitude, longitude: hit.longitude, slug: hit.slug,
        }, r, group);
      } else {
        // Unresolvable -> roll up to the row's region if it has one, else country.
        // The row is ALWAYS counted somewhere; it is never dropped.
        const fallback = region || country;
        if (fallback) {
          bumpNode({
            key: nodeKey(country, fallback), name: fallback,
            level: region ? 'region' : 'country', country,
            parentName: '', parentKey: null,
            latitude: null, longitude: null, slug: slugify(fallback),
          }, r, group);
        }
        const missName = (r.subregion || '').trim() || (r.region || '').trim();
        if (missName) unresolved.set(missName, (unresolved.get(missName) ?? 0) + 1);
      }
    }
```

**3e.** After the row loop, derive `inclusiveTotal` deepest-first and return the new maps:

```js
  // DERIVE inclusiveTotal. Start every node at its own count, then fold each node
  // into its parent, deepest level first. Because this is a single pass over a
  // sorted list — not a per-row increment — a row can never be counted twice.
  for (const n of nodes.values()) n.inclusiveTotal = n.ownTotal;
  const deepestFirst = [...nodes.values()]
    .sort((a, b) => (LEVEL_DEPTH[b.level] ?? 0) - (LEVEL_DEPTH[a.level] ?? 0));
  for (const n of deepestFirst) {
    if (!n.parentKey) continue;
    const parent = nodes.get(n.parentKey);
    if (parent) parent.inclusiveTotal += n.inclusiveTotal;
  }

  return { byRegion, byCountry, byRegionCountry, nodes, unresolved };
```

Keep `byRegion` / `byCountry` / `byRegionCountry` — other call sites still read them; this is purely additive.

**3f.** In `main()`, pass the resolver through. `loadTaxonomyCoords()` (line ~136) already
reads the taxonomy file; load the raw JSON alongside it and build the resolver:

```js
  const taxonomyRaw = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
  const resolveGeoNode = makeGeoResolver(taxonomyRaw);
  const { byRegion, byCountry, byRegionCountry, nodes, unresolved } =
    aggregate(rows, { resolver: resolveGeoNode });
```

Then emit `nodes` (those with coordinates) into the output `regions` array, carrying
`ownTotal`, `inclusiveTotal`, `pinLevel`, `parentName`, and `total: inclusiveTotal`.

**3g.** In `types.ts`, add the four new fields to `MapRegion`. **Add them to the existing
interface — do not retype it from scratch**, or you will drop `x`, `y`, `lat`, `lng`,
`slug`, `total`, `countsByGroup`, `priceRange`, `peeks`, and the undeclared-but-assigned
`curated` flag:

```ts
  /** Rows resolving to THIS node exactly (excludes descendants). */
  ownTotal: number;
  /** ownTotal + every descendant. DERIVED by subtree sum — never incremented per-row. */
  inclusiveTotal: number;
  /** Which taxonomy level this pin sits at — drives the /shop hand-off shape. */
  pinLevel?: 'region' | 'subregion' | 'appellation';
  /** Parent node NAME (a region, for a subregion pin). '' or undefined at top level. */
  parentName?: string;
```

Also **delete the now-false comment at `types.ts:30-33`** ("taxonomy has no subregion
coords, so they are a text list in the drawer, not map pins"). There are 81 subregions
and 81 appellations with coordinates; that assumption is exactly what this work fixes.

Keep `total` populated as `inclusiveTotal` so existing consumers keep working — but see
Step 3h, because `total` is load-bearing elsewhere.

**3h. Check the `total` consumers before moving on.** `total` now means *inclusive*, and
~200 new pins enter the array. These read it and must be eyeballed:

- `app/explore-map/[region]/page.tsx:30,57,59,71` — page title, "top 50" threshold,
  JSON-LD `CollectionPage`
- `lib/explore/country-pins.ts:32,61` — pin visibility thresholds

Adding subregion/appellation pins changes the `allTotals` distribution, so `isTop50`
shifts for existing regions. Decide deliberately: either compute those thresholds from
**region-level pins only**, or accept the shift. Note which you chose in the commit.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/explore-map-gen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/lib/explore/types.ts apps/catalog/lib/__tests__/explore-map-gen.test.ts
git commit -m "feat(map): ownTotal/inclusiveTotal 4-level aggregation

ownTotal increments once per row at exactly one node; inclusiveTotal is derived
by subtree sum, so ancestor rollup cannot double-count. Unresolvable nodes roll
up to parent — no row is ever dropped, preserving map-total == grid-total."
```

---

### Task 6: Per-level `/shop` hand-off

A subregion pin querying `{region:'Napa Valley'}` returns **1 row** against an `ownTotal` of 296. It must emit `region=California&subregion=Napa Valley`.

**Files:**
- Modify: `apps/catalog/lib/explore/map-data.ts:51-59`
- Test: `apps/catalog/lib/__tests__/explore-map-gen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('shopHref — per-level hand-off', () => {
  it('region pin emits country + region', () => {
    const href = shopHref({ name: 'California', country: 'USA', pinLevel: 'region' } as any, 'all');
    expect(href).toContain('country=USA');
    expect(href).toContain('region=California');
    expect(href).not.toContain('subregion=');
  });

  it('subregion pin emits parent region AND subregion', () => {
    // Querying {region:'Napa Valley'} alone returns 1 row vs an ownTotal of 296 —
    // the data lives at region='California', subregion='Napa Valley'.
    const href = shopHref(
      { name: 'Napa Valley', country: 'USA', pinLevel: 'subregion', parentName: 'California' } as any,
      'all',
    );
    expect(href).toContain('region=California');
    expect(href).toContain('subregion=Napa+Valley');
  });

  it('appellation pin emits appellation', () => {
    const href = shopHref(
      { name: 'Barolo', country: 'Italy', pinLevel: 'appellation', parentName: 'Piedmont' } as any,
      'all',
    );
    expect(href).toContain('appellation=Barolo');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/explore-map-gen.test.ts -t shopHref`
Expected: FAIL — every pin emits `region=<name>`.

- [ ] **Step 3: Implement**

Replace `shopHref` in `map-data.ts`:

```ts
/**
 * Build the /shop handoff URL, shaped by the pin's LEVEL.
 *
 * A subregion pin MUST emit its parent region too: `matchesFilters` tests p.region
 * and p.subregion as independent ANDs, and the rows live at
 * region='California', subregion='Napa Valley'. Emitting subregion alone returns 1
 * row against an ownTotal of 296 and fails the strict invariant.
 *
 * bev=1 restricts /shop to the same all-stock beverage subset the map counts, and
 * we deliberately DO NOT pass inStock=1 (the map counts in-stock AND out-of-stock).
 */
export function shopHref(region: MapRegion, lens: LensKey): string {
  const group = lensPrimaryGroup(lens);
  const level = region.pinLevel ?? 'region';
  const geo: Record<string, string | null> =
    level === 'region'
      ? { region: region.name, subregion: null, appellation: null }
      : level === 'subregion'
        ? { region: region.parentName ?? null, subregion: region.name, appellation: null }
        : { region: null, subregion: null, appellation: region.name };

  const qs = buildQuery({}, {
    bev: '1',
    country: region.country,
    ...geo,
    group: group ?? null,
  });
  return qs ? `/shop?${qs}` : '/shop';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/explore-map-gen.test.ts -t shopHref`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/explore/map-data.ts apps/catalog/lib/__tests__/explore-map-gen.test.ts
git commit -m "feat(map): shape the /shop hand-off by pin level

A subregion pin now emits its parent region + subregion; an appellation pin emits
appellation. Emitting the bare name returned 1 row against an ownTotal of 296."
```

---

### Task 7: Appellation filter — unblocks appellation pins

`shop-query.ts` has **zero** occurrences of `params.appellation`. Without this an appellation pin has no expressible query and the strict invariant cannot validate it. **Must land before Task 8.**

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts` (~line 190, after the subregion clause)
- Modify: `apps/catalog/lib/drill-query.ts:13-25`
- Modify: `apps/catalog/components/DrillBreadcrumb.tsx:27`
- Test: `apps/catalog/lib/__tests__/shop-query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('appellation filter', () => {
  const P = (over: Partial<PublicProduct>) => ({
    sku: 'X', name: 'n', country: 'Italy', region: 'Piedmont', ...over,
  }) as PublicProduct;

  it('filters on appellation (exact, case-insensitive)', () => {
    const rows = [P({ sku: 'A', appellation: 'Barolo' }), P({ sku: 'B', appellation: 'Chianti' })];
    expect(applyShopQuery(rows, { appellation: 'barolo' }).total).toBe(1);
  });

  it('changing region CLEARS a stale appellation', () => {
    // Without appellation in DRILL_DESCENDANTS an appellation= survives a region
    // change and silently filters the grid to nothing.
    expect(clearDescendants('region', 'Tuscany')).toEqual({
      region: 'Tuscany', subregion: null, appellation: null,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts -t appellation`
Expected: FAIL — filter ignored (total 2), and `clearDescendants` omits `appellation`.

- [ ] **Step 3: Implement all three edits**

`shop-query.ts` — after the subregion clause (line 190-191):

```ts
  const appellation = norm(firstParam(params.appellation));
  if (appellation && norm(p.appellation) !== appellation) return false;
```

Add `appellation` to the documented param list in the module header (~line 30).

`drill-query.ts`:

```ts
export type DrillStrand = 'group' | 'class' | 'country' | 'region' | 'subregion' | 'appellation';

export const DRILL_DESCENDANTS: Record<DrillStrand, DrillStrand[]> = {
  group: ['class'],
  class: [],
  country: ['region', 'subregion', 'appellation'],
  region: ['subregion', 'appellation'],
  subregion: ['appellation'],
  appellation: [],
};
```

Update the header comment to `geography: country → region → subregion → appellation`.

`DrillBreadcrumb.tsx:27`:

```ts
const GEO_STRAND: DrillStrand[] = ['country', 'region', 'subregion', 'appellation'];
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/shop-query.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/drill-query.ts apps/catalog/components/DrillBreadcrumb.tsx apps/catalog/lib/__tests__/shop-query.test.ts
git commit -m "feat(shop): add appellation filter + drill descendant

Unblocks appellation-level map pins: without a filter clause an appellation pin
has no expressible /shop query and the strict invariant cannot validate it.
Adding it to DRILL_DESCENDANTS stops a stale appellation= surviving a region change.

Note: the appellation FACET CHIP stays deferred (facets.ts has no appellationsFor).
The URL filter works and the invariant passes; the chip is separate work."
```

---

### Task 8: Curated coordinates, gap report, and the real invariant

**Files:**
- Modify: `apps/catalog/scripts/gen-explore-map-data.mjs` (`CENTROIDS` ~line 207, `main()`)
- Test: `apps/catalog/lib/__tests__/explore-map.invariant.test.ts`

⚠️ **Coordinates must be sourced, not recalled.** Per the project's no-inferred-data rule, a guessed lat/lng is an unsourced per-item claim. Look each one up and note the source in the commit body. If you cannot source one, leave it out — it rolls up to its parent and appears in the gap report, which is a correct outcome, not a failure.

- [ ] **Step 1: Extend the invariant test to be level-aware**

Replace the region loop in `explore-map.invariant.test.ts`:

```ts
it('every pin: map total === /shop grid total, keyed by pinLevel (STRICT)', () => {
  for (const r of data.regions) {
    // The query SHAPE depends on the level — see shopHref. A region pin compares
    // against inclusiveTotal because child rows still carry the parent's region
    // value (all California rows have region='California', including Napa's), and
    // matchesFilters tests p.region. This is NOT ancestor matching — do not go
    // looking there when this fails.
    const level = r.pinLevel ?? 'region';
    const q =
      level === 'region'
        ? { bev: '1', country: r.country, region: r.name }
        : level === 'subregion'
          ? { bev: '1', country: r.country, region: r.parentName!, subregion: r.name }
          : { bev: '1', country: r.country, appellation: r.name };

    const expected = level === 'region' ? r.inclusiveTotal : r.ownTotal;
    expect(applyShopQuery(all, q).total, `count mismatch for ${r.name} (${level})`).toBe(expected);
  }
});

it('inclusiveTotal === ownTotal + sum(children) for every node', () => {
  for (const r of data.regions) {
    const kids = data.regions.filter((c) => c.parentName === r.name && c.country === r.country);
    expect(r.inclusiveTotal, `subtree mismatch at ${r.name}`)
      .toBe(r.ownTotal + kids.reduce((s, c) => s + c.inclusiveTotal, 0));
  }
});
```

- [ ] **Step 2: Run to see real failures**

Run: `cd apps/catalog && npx vitest run lib/__tests__/explore-map.invariant.test.ts`
Expected: FAIL, listing specific pins. Read each mismatch — this is the real signal for Tasks 5-7.

- [ ] **Step 3: Add sourced coordinates + the gap report**

Extend the existing `CENTROIDS` table (it already holds 9, including `napa valley` and `maule valley`). Add sourced entries for the highest-volume genuine places: Niigata / Kumamoto / Nagano Prefecture, Kobe, Fushimi, Nada, Komoro, Matsumoto, Aso, Iwakuni, Penedès, Collio, Colli Orientali del Friuli, Strathspey, Robertson, Bannockburn, Locorotondo, Barossa Valley, Colchagua Valley, Sonoma County, McLaren Vale, Margaret River, Hunter Valley, Clare Valley, Coonawarra, Adelaide Hills, Yarra Valley, Paso Robles, Carneros, Central Coast.

Do **not** add: `Vin de France`, `Tre Venezie`, `Bourgogne`, `Rosso di Montalcino`, `Valpolicella Ripasso`, `Bordeaux Supérieur`. These are legal tiers / styles, not places — pinning them would put a non-place on the map. They are Phase B's problem.

At the end of `main()`, emit the ranked gap report (Rule 2 — a non-success state affecting thousands of rows must not scroll past unexamined):

```js
  // `unresolved` is returned by aggregate() — see Task 5 step 3e.
  const gaps = [...unresolved.entries()].sort((a, b) => b[1] - a[1]);
  if (gaps.length) {
    const shown = gaps.slice(0, 40);
    console.log(`\ngen-explore-map-data: ${gaps.length} unresolved geo values covering ` +
      `${gaps.reduce((n, g) => n + g[1], 0)} rows (rolled up to parent). Top ${shown.length}:`);
    for (const [name, n] of shown) console.log(`  ${String(n).padStart(5)}  ${name}`);
    if (gaps.length > shown.length) console.log(`  ... and ${gaps.length - shown.length} more`);
  }
```

- [ ] **Step 4: Regenerate and verify**

```bash
cd apps/catalog && node scripts/gen-explore-map-data.mjs
npx vitest run lib/__tests__/explore-map.invariant.test.ts
```
Expected: generator prints the gap report; invariant PASSES.

- [ ] **Step 5: Verify Napa is actually pinned**

```bash
cd apps/catalog && node -e "
const d=require('./data/explore-map-data.json');
for (const n of ['Napa Valley','Sonoma County','Barolo','Colchagua Valley','Barossa Valley']) {
  const r=d.regions.find(x=>x.name===n);
  console.log(n.padEnd(18), r ? \`level=\${r.pinLevel} own=\${r.ownTotal} incl=\${r.inclusiveTotal}\` : 'MISSING');
}
const ca=d.regions.find(x=>x.name==='California');
console.log('California       ', \`own=\${ca.ownTotal} incl=\${ca.inclusiveTotal}\`);
"
```
Expected: Napa Valley present with `ownTotal` ~299; California `ownTotal` ~134,
`inclusiveTotal` ~619. Sonoma County must appear with `pinLevel: 'region'` (NOT
`appellation`). **If California's ownTotal is still ~619, the aggregation did not split —
stop and fix Task 5. If Sonoma County shows `pinLevel: 'appellation'`, the regions
fallback in Task 3 step 1 is missing.**

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/lib/__tests__/explore-map.invariant.test.ts apps/catalog/data/explore-map-data.json
git commit -m "feat(map): sourced coordinates + ranked gap report + level-aware invariant

Coordinate sources noted per entry. Non-places (Vin de France, Bourgogne,
Bordeaux Superieur) deliberately excluded — Phase B reclassifies those."
```

---

### Task 9: Browser verification (Rule 7 — NOT optional)

Tests passing is necessary but not sufficient. A working UI is the only proof.

- [ ] **Step 1: Build and start**

```bash
cd apps/catalog && npm run build && npm run dev -- -p 3100
```
On `Cannot find module` 500s: `rm -rf .next` and retry.

- [ ] **Step 2: Walk the journeys** at `http://localhost:3100/explore-map`

- [ ] USA → California → **Napa Valley pin exists** and opens a drawer
- [ ] Napa drawer count matches its "View all N"; clicking through lands on a `/shop` grid with the **same total**
- [ ] Italy → Piedmont → **Barolo** pin; hand-off carries `appellation=Barolo`
- [ ] Chile → Central Valley → **Colchagua Valley** pin
- [ ] Australia → South Australia → **Barossa Valley** pin
- [ ] Breadcrumb shows country → region → subregion; jumping back to region **clears** the subregion
- [ ] No non-places pinned (no "Vin de France", no "Bourgogne")

- [ ] **Step 3: Responsive check at 375px** — pins tappable, drawer readable, no horizontal scroll.

- [ ] **Step 4: Record the result.** If any journey fails, fix before proceeding. Do not report Phase A complete on green tests alone.

---

### Task 10: Un-suppress `appellation` on the product page

`page.tsx:447-448` hides appellation on a stale "verified 0/11,436" comment. The column now holds **956 rows in the export** (verified 2026-07-27). Rule 3: inherited assumptions are not validated by the caller.

**Files:**
- Modify: `apps/catalog/app/product/[sku]/page.tsx:447-448`

- [ ] **Step 1: Add the row and correct the comment**

Remove `appellation` from the suppression list and add an `AttrRow` for it, matching the surrounding rows' style. **Leave `wine_classification` suppressed** — it is genuinely still 0/11,904.

- [ ] **Step 2: Verify in the browser**

Find a product with an appellation:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -c "
import json
rows=json.load(open('data/live_products_export.json'))
rows=rows['products'] if isinstance(rows,dict) else rows
for r in rows:
    if (r.get('appellation') or '').strip(): print(r['sku'], '|', r.get('appellation')); break
"
```
Visit `http://localhost:3100/product/<that-sku>` and confirm the Appellation row renders. Check a product **without** one renders no empty row.

- [ ] **Step 3: Commit**

```bash
git add "apps/catalog/app/product/[sku]/page.tsx"
git commit -m "fix(product): surface appellation — stale 0%-data assumption

The suppression comment said 'verified 0/11,436'; the column now holds 956 rows
in the export. Data arrived after the decision to ignore it (Rule 3).
wine_classification stays suppressed — genuinely still 0."
```

---

### Task 11: Full gate before handoff

- [ ] **Step 1: Full test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all PASS. Investigate every failure — do not skip.

- [ ] **Step 2: Build gate** (Rule: gate on build, not just tests)

Run: `cd apps/catalog && npm run build`
Expected: success. Cross-branch conflicts surface only here.

- [ ] **Step 3: Python parity tests** (Task 7 touched no Python, but confirm nothing drifted)

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -m pytest tests/test_designation_parity.py tests/test_image_url_invariants.py -q`
Expected: PASS.

- [ ] **Step 4: Confirm no DB writes happened**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git status --porcelain data/db/ data/live_products_export.json
```
Expected: **empty**. Phase A is read-only; any change here means something wrote data it shouldn't have.

- [ ] **Step 5: Report honestly.** State which browser journeys were verified, the before/after resolution rate, and how many values remain in the gap report. If any step was skipped, say so.

---

## Deferred follow-up — NOT part of this plan

**Rename the UI label "Classification" → "Designation"** (user decision, 2026-07-27).

The code already calls this field `designation` everywhere. Only the visible label says
"Classification" — 3 lines in `components/Filters.tsx:947-955` (`label`, `ariaLabel`, and
the explanatory comment). Renaming them makes UI and code use one word.

Ship as its **own commit after Phase A** — it is unrelated to the geography hierarchy and
should not be folded into that diff.

Two things the implementer must know:

1. **This is NOT the Magento `classification` column.** That is a different field entirely
   — raw product TYPE (Red Wine / Whisky / Gin), referenced in 74 scripts and a live DB
   column. Rule 12 says stop *using* it, not rename it. Touch only `Filters.tsx`.
2. **Update CLAUDE.md Rule 12 and the memory note in the same commit.** Both currently
   record that the user says "Classification" for this concept and that the label is
   deliberately "Classification" per product. After this rename that guidance is stale and
   would send the next engineer to revert it.

---

## Definition of done

- Napa Valley, Sonoma County, Barolo, Colchagua Valley and Barossa Valley are pins on
  the map, each at the correct `pinLevel` (Sonoma/Colchagua/Barossa are REGIONS)
- California's `ownTotal` is ~134, not ~619
- Every pin's `/shop` hand-off reproduces its count exactly (strict invariant green)
- No row is lost: `Σ ownTotal` equals the beverage row count
- The gap report lists what still needs coordinates, ranked
- No non-places pinned
- Browser journeys verified at 375px and desktop
- `products.db` and `live_products_export.json` untouched

---

## Execution log — corrections found while running the plan

**Task 1 commit message overclaims.** `cf7b979` says the split "stops the map flattening
every USA sub-AVA into California." It does not — not yet. `gen-explore-map-data.mjs:21`
still holds the OLD merged alias table including `napa valley -> California`, and the
generated `explore-map-data.json` still has **no Napa Valley pin** (94 regions, Napa
absent). The `.mjs` side is replaced by Tasks 3-5 and the map is only actually fixed at
Task 8. Task 1 changes the TS/shop side only. Do not read that commit message as evidence
the map works.

**A .mjs/TS parity gap exists between Task 1 and Task 4.** During that window the two
alias tables genuinely disagree — TS has the split, `.mjs` has the merged original. This
is expected and temporary, but nothing asserts it, so a reviewer looking at Task 1 alone
will reasonably call it a divergence. Task 4's parity test closes it.

**Deferred design question — the `own` gate in `regionsFor`** (`facets.ts`). An ancestor
only receives a rolled-up count if it already has products of its OWN. So a parent region
with zero direct products gets no chip, while `?region=<parent>` still returns its
children's rows.

Latent today (California has 605 direct rows). It becomes live in Phase B3, which
normalizes region values and can move rows off a parent onto its children — exactly the
Chile `Central Valley` shape. **Decide before B3:** either drop the `own` gate and let a
pure-container region show a chip, or keep it and accept that such a region is
reachable by URL but not by chip. Not a Phase A blocker.
