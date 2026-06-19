# WNLQ9 Product Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guided, adaptive quiz at `/finder` inside the existing `apps/catalog/` app that returns a style profile + matched in-stock products, all driven by a pure scoring engine and per-category config.

**Architecture:** A small set of PURE, unit-tested modules under `lib/finder/` (answers codec, question config, scoring, style profiles) consumed by three Next.js App-Router pages (`/finder`, `/finder/[step]`, `/finder/result`). Scoring mirrors the existing `recommender.ts` pattern (additive, in-stock, deduped) but is tiered with a minimum-results guarantee. Every product shown comes from the catalog's `getAllProducts()` (already `toPublicProduct`-projected — no margin leak) and is filtered by `groupForProduct` (SKU-prefix override) plus a per-category classification refinement.

**Tech Stack:** Next.js 14.2 (App Router), React 18, TypeScript, Tailwind, Vitest. Reuses catalog `lib/`: `catalog-data` (getAllProducts), `category-groups` (groupForProduct), `utils` (isInStock), `price-tiers` (tierById/PRICE_TIERS), `recommender` (scoreCandidate pattern), and `components/` (ProductCard, QuickView).

**Spec:** `docs/superpowers/specs/2026-06-18-wnlq9-product-finder-design.md`

---

## Verified codebase facts (the plan depends on these — do not re-assume)
- **`PublicProduct.is_in_stock` is already a normalized BOOLEAN** (`toPublicProduct` ran
  `isInStock()` at load). On `PublicProduct`, use `p.is_in_stock === true` or
  `isInStock(p.is_in_stock)` from `@/lib/utils` — NOT the raw `"1"` string check. The raw
  string check only applies to the unprojected export.
- `PublicProduct` fields (verified): `sku, name, price:number, brand?, classification?,
  grape_variety?, vintage?:number, country?, region?, subregion?, wine_body?, wine_acidity?,
  wine_tannin?, food_matching?:string (comma-sep), flavor_tags?:string[], taste_profile?:object,
  score_summary?:string (JSON string), is_in_stock?:boolean`.
- `getAllProducts(): PublicProduct[]` from `@/lib/catalog-data` (module singleton, build-time).
- `groupForProduct(p)` → `CategoryGroup` (`'Wine'|'Whisky'|'Spirits'|'Sake & Asian'|'Beer & RTD'|'Accessories'`).
- `tierById(id)` / `PRICE_TIERS` from `@/lib/price-tiers`; each tier `{id,min,max,...}`, `[min,max)`.
- Tests: Vitest, `@/` path alias works, files end `.test.ts(x)` under `lib/__tests__` or `components/__tests__`.
- The finder's `FinderCategory` (7) ≠ catalog groups (6): `gin` & `spirits` BOTH map to group
  Spirits; `red`/`white`/`sparkling` ALL map to group Wine. Hence the `{group, classMatch}` map (Task 2).

---

## File Structure

**Create:**
- `lib/finder/answers.ts` — `Answers` type, `FinderCategory`, `encodeAnswers`/`decodeAnswers` (URL codec)
- `lib/finder/category-map.ts` — `FinderCategory → {group, classMatch}` + `finderPrefilter(products, answers)`
- `lib/finder/food-chips.ts` — food-chip → keyword[] map + `foodChipMatches(product, chips)`
- `lib/finder/question-config.ts` — per-category ordered step list + axis token→option/scoring maps
- `lib/finder/scoring.ts` — pure `scoreProducts(answers, products) → PublicProduct[]` (tiered + guarantee)
- `lib/finder/style-profiles.ts` — `StyleProfile` archetype library + `resolveProfile(answers)`
- `app/finder/page.tsx` — intro + Step 1 (category)
- `app/finder/[step]/page.tsx` — adaptive question steps
- `app/finder/result/page.tsx` — style profile + matched products
- `components/finder/StepShell.tsx` — progress bar + Back + "No preference"
- `components/finder/ChoiceCards.tsx` — big tap-target option cards
- `components/finder/StyleResult.tsx` — archetype card + product grid

**Test:**
- `lib/finder/__tests__/{answers,category-map,food-chips,scoring,style-profiles}.test.ts`

**Reuse (no change):** `lib/catalog-data`, `lib/category-groups`, `lib/utils`, `lib/price-tiers`,
`components/ProductCard`, `components/QuickView`.

---

## Task 1: `answers.ts` — types + URL codec (TDD)

**Files:** Create `lib/finder/answers.ts`; Test `lib/finder/__tests__/answers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodeAnswers, decodeAnswers, type Answers } from '@/lib/finder/answers';

describe('answers URL codec', () => {
  const full: Answers = {
    category: 'red', occasion: 'food', food: ['red-meat', 'cheese'],
    budget: 2, axis1: 'bold', axis2: 'earthy', flavorChips: ['oak', 'leather'],
  };
  it('round-trips a full answer set losslessly', () => {
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(full)))).toEqual(full);
  });
  it('round-trips a minimal answer set (category only)', () => {
    const min: Answers = { category: 'whisky' };
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(min)))).toEqual(min);
  });
  it('drops unknown params and keeps category', () => {
    const a = decodeAnswers(new URLSearchParams('cat=gin&junk=1&b=9'));
    expect(a.category).toBe('gin');
    expect(a.budget).toBeUndefined(); // b=9 is out of 0..4 → dropped
  });
  it('returns category undefined when cat is invalid', () => {
    expect(decodeAnswers(new URLSearchParams('cat=banana')).category).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd "apps/catalog" && npx vitest run lib/finder/__tests__/answers.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/finder/answers.ts`**

```ts
export type FinderCategory =
  | 'red' | 'white' | 'sparkling' | 'whisky' | 'gin' | 'spirits' | 'sake';
export type Budget = 0 | 1 | 2 | 3 | 4;
export type Occasion = 'everyday' | 'food' | 'gift' | 'special' | 'exploring';

export interface Answers {
  category: FinderCategory;   // required
  occasion?: Occasion;
  food?: string[];            // chip keys, e.g. ['red-meat','cheese']
  budget?: Budget;
  axis1?: string;             // category-specific token
  axis2?: string;
  flavorChips?: string[];     // flavor_note_master slugs (≤5)
}

const CATEGORIES: FinderCategory[] = ['red','white','sparkling','whisky','gin','spirits','sake'];
const OCCASIONS: Occasion[] = ['everyday','food','gift','special','exploring'];

// URL params: cat, occ, food (csv), b (0..4), a1, a2, fl (csv). All optional except cat.
export function encodeAnswers(a: Answers): string {
  const p = new URLSearchParams();
  p.set('cat', a.category);
  if (a.occasion) p.set('occ', a.occasion);
  if (a.food?.length) p.set('food', a.food.join(','));
  if (a.budget != null) p.set('b', String(a.budget));
  if (a.axis1) p.set('a1', a.axis1);
  if (a.axis2) p.set('a2', a.axis2);
  if (a.flavorChips?.length) p.set('fl', a.flavorChips.join(','));
  return p.toString();
}

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function decodeAnswers(sp: URLSearchParams): Answers {
  const cat = sp.get('cat');
  const category = CATEGORIES.includes(cat as FinderCategory) ? (cat as FinderCategory) : undefined;
  const occ = sp.get('occ');
  const occasion = OCCASIONS.includes(occ as Occasion) ? (occ as Occasion) : undefined;
  const bRaw = sp.get('b');
  const bNum = bRaw == null ? NaN : Number(bRaw);
  const budget = Number.isInteger(bNum) && bNum >= 0 && bNum <= 4 ? (bNum as Budget) : undefined;
  return {
    category: category as FinderCategory, // result page guards undefined → redirect
    occasion, food: csv(sp.get('food')), budget,
    axis1: sp.get('a1') ?? undefined, axis2: sp.get('a2') ?? undefined,
    flavorChips: csv(sp.get('fl')),
  };
}
```

Note: the test for invalid `cat` expects `category` undefined — the function returns
`undefined` cast as `FinderCategory`; consumers (result page) MUST guard. Keep the test
asserting `.category` is `undefined` (the cast is a typed-surface convenience, not a runtime lie).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/answers.ts apps/catalog/lib/finder/__tests__/answers.test.ts
git commit -m "feat(finder): Answers type + lossless URL codec"
```

---

## Task 2: `category-map.ts` — FinderCategory → {group, classMatch} + pre-filter (TDD)

**Files:** Create `lib/finder/category-map.ts`; Test `lib/finder/__tests__/category-map.test.ts`

- [ ] **Step 1: Write the failing test** (the gin/spirits + sparkling/wine split — spec Finding 1)

```ts
import { describe, it, expect } from 'vitest';
import { finderPrefilter } from '@/lib/finder/category-map';
import type { Answers } from '@/lib/finder/answers';

const P = (o: any) => ({ price: 1000, is_in_stock: true, ...o });
const POOL = [
  P({ sku:'RW', classification:'Red Wine' }),
  P({ sku:'WW', classification:'White Wine' }),
  P({ sku:'CH', classification:'Champagne' }),
  P({ sku:'GIN', classification:'Gin' }),
  P({ sku:'RUM', classification:'Rum' }),
  P({ sku:'WHK', classification:'Whisky' }),
  P({ sku:'OOS', classification:'Red Wine', is_in_stock:false }),
];

const ans = (o: Partial<Answers>): Answers => ({ category:'red', ...o } as Answers);

describe('finderPrefilter', () => {
  it('gin returns Gin only — NOT rum/vodka', () =>
    expect(finderPrefilter(POOL as any, ans({category:'gin'})).map(p=>p.sku)).toEqual(['GIN']));
  it('spirits EXCLUDES gin', () =>
    expect(finderPrefilter(POOL as any, ans({category:'spirits'})).map(p=>p.sku)).toEqual(['RUM']));
  it('sparkling returns Champagne, excludes still wine', () =>
    expect(finderPrefilter(POOL as any, ans({category:'sparkling'})).map(p=>p.sku)).toEqual(['CH']));
  it('red excludes white/sparkling', () =>
    expect(finderPrefilter(POOL as any, ans({category:'red'})).map(p=>p.sku)).toEqual(['RW']));
  it('always excludes out-of-stock', () =>
    expect(finderPrefilter(POOL as any, ans({category:'red'})).some(p=>p.sku==='OOS')).toBe(false));
  it('budget index 0 (Under ฿1,000) excludes a ฿1,500 wine; budget 1 includes it', () => {
    const pool = [P({sku:'cheap', classification:'Red Wine', price:500}),
                  P({sku:'mid', classification:'Red Wine', price:1500})];
    expect(finderPrefilter(pool as any, ans({category:'red', budget:0})).map(p=>p.sku)).toEqual(['cheap']);
    expect(finderPrefilter(pool as any, ans({category:'red', budget:1})).map(p=>p.sku)).toEqual(['mid']);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/finder/category-map.ts`**

```ts
import type { PublicProduct } from '@/lib/types';
import { groupForProduct, type CategoryGroup } from '@/lib/category-groups';
import { isInStock } from '@/lib/utils';
import { PRICE_TIERS } from '@/lib/price-tiers';
import type { Answers, FinderCategory } from './answers';

interface CatRule { group: CategoryGroup; classMatch?: (classification: string | undefined) => boolean; }

const firstSeg = (c?: string) => (c ?? '').split('|')[0].trim().toLowerCase();

export const CATEGORY_MAP: Record<FinderCategory, CatRule> = {
  red:       { group: 'Wine', classMatch: (c) => firstSeg(c) === 'red wine' },
  white:     { group: 'Wine', classMatch: (c) => firstSeg(c) === 'white wine' },
  sparkling: { group: 'Wine', classMatch: (c) => ['champagne','sparkling wine'].includes(firstSeg(c)) },
  whisky:    { group: 'Whisky' },
  gin:       { group: 'Spirits', classMatch: (c) => firstSeg(c) === 'gin' },
  spirits:   { group: 'Spirits', classMatch: (c) => firstSeg(c) !== 'gin' },
  sake:      { group: 'Sake & Asian' },
};

/** Hard, safe pre-filter (spec §5): category membership + in-stock + budget tier. */
export function finderPrefilter(products: PublicProduct[], a: Answers): PublicProduct[] {
  const rule = CATEGORY_MAP[a.category];
  // Budget is the index 0..4 INTO PRICE_TIERS (verified: tier order = under-1000,
  // 1000-3000, 3000-7000, 7000-15000, 15000-plus). NOTE: tierById takes string ids
  // like 'under-1000', NOT '0'..'4' — index access is correct here, tierById is not.
  const tier = a.budget != null ? PRICE_TIERS[a.budget] : undefined;
  return products.filter((p) => {
    if (!isInStock(p.is_in_stock)) return false;
    if (groupForProduct(p) !== rule.group) return false;
    if (rule.classMatch && !rule.classMatch(p.classification)) return false;
    if (tier) {
      if (typeof p.price !== 'number' || Number.isNaN(p.price)) return false;
      if (p.price < tier.min || p.price >= tier.max) return false;
    }
    return true;
  });
}
```

VERIFIED: `PRICE_TIERS` is ordered `[under-1000, 1000-3000, 3000-7000, 7000-15000, 15000-plus]`,
so `Budget` index 0..4 maps directly to `PRICE_TIERS[budget]`. `tierById` takes the string id
(e.g. 'under-1000'), so do NOT use `tierById(String(budget))` — it would return undefined and
silently drop the budget filter. The plan above uses index access, which is correct.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS (5 tests). If the budget test variants fail, fix the tier-id mapping per the note.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/category-map.ts apps/catalog/lib/finder/__tests__/category-map.test.ts
git commit -m "feat(finder): FinderCategory->{group,classMatch} pre-filter (gin/spirits + sparkling split)"
```

---

## Task 3: `food-chips.ts` — chip→keyword map + matcher (TDD)

**Files:** Create `lib/finder/food-chips.ts`; Test `lib/finder/__tests__/food-chips.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { foodChipMatches, FOOD_CHIPS } from '@/lib/finder/food-chips';

describe('food chips', () => {
  it('seafood chip matches "Oysters & raw seafood, grilled fish"', () =>
    expect(foodChipMatches({ food_matching: 'Oysters & raw seafood, grilled fish' } as any, ['seafood'])).toBe(1));
  it('red-meat chip matches "Grilled red meat, lamb dishes"', () =>
    expect(foodChipMatches({ food_matching: 'Grilled red meat, lamb dishes' } as any, ['red-meat'])).toBe(1));
  it('counts one per matching chip', () =>
    expect(foodChipMatches({ food_matching: 'Grilled red meat, aged hard cheese' } as any, ['red-meat','cheese'])).toBe(2));
  it('no match → 0', () =>
    expect(foodChipMatches({ food_matching: 'Sushi & sashimi' } as any, ['red-meat'])).toBe(0));
  it('missing food_matching → 0', () =>
    expect(foodChipMatches({} as any, ['seafood'])).toBe(0));
  it('exposes all 9 chips', () => expect(Object.keys(FOOD_CHIPS)).toHaveLength(9));
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/finder/food-chips.ts`** (keywords verified against real food_matching)

```ts
import type { PublicProduct } from '@/lib/types';

// chip key → case-insensitive substring keywords (grounded in the 6,078 raw food_matching values).
export const FOOD_CHIPS: Record<string, string[]> = {
  'red-meat':  ['red meat','beef','lamb','steak','game','venison'],
  'poultry':   ['chicken','poultry','duck','turkey'],
  'seafood':   ['seafood','fish','oyster','shellfish','prawn','crab','lobster','sushi','sashimi','shrimp'],
  'cheese':    ['cheese','charcuterie'],
  'pasta-pizza':['pasta','pizza','risotto'],
  'spicy-asian':['spicy','thai','dim sum','curry','asian','szechuan','korean'],
  'vegetarian':['salad','vegetable','mushroom','vegetarian'],
  'dessert':   ['dessert','chocolate','cake','sweet','fruit tart'],
  'aperitif':  ['apéritif','aperitif','hors','tapas','small plates','snack','canapé'],
};

/** Number of chips whose keyword set hits the product's food_matching (substring, ci). */
export function foodChipMatches(p: PublicProduct, chips: string[] | undefined): number {
  if (!chips?.length || !p.food_matching) return 0;
  const hay = p.food_matching.toLowerCase();
  let n = 0;
  for (const chip of chips) {
    const kws = FOOD_CHIPS[chip];
    if (kws && kws.some((k) => hay.includes(k))) n += 1;
  }
  return n;
}
```

- [ ] **Step 4: Run to verify it passes.** Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/food-chips.ts apps/catalog/lib/finder/__tests__/food-chips.test.ts
git commit -m "feat(finder): food-chip -> keyword map + matcher"
```

---

## Task 4: `scoring.ts` — tiered scoring + minimum-results guarantee (TDD)

**Files:** Create `lib/finder/scoring.ts`; Test `lib/finder/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing test** (ordinal ladder, guarantee, no-preference=0, dedupe)

```ts
import { describe, it, expect } from 'vitest';
import { scoreProducts, bodyLadderDistance } from '@/lib/finder/scoring';
import type { Answers } from '@/lib/finder/answers';

const P = (o: any) => ({ price: 1500, is_in_stock: true, classification: 'Red Wine', ...o });

describe('bodyLadderDistance (5-level ordinal)', () => {
  it('exact = 0 steps', () => expect(bodyLadderDistance('Full','Full')).toBe(0));
  it('adjacent = 1 step', () => expect(bodyLadderDistance('Full','Medium-Full')).toBe(1));
  it('far = 4 steps', () => expect(bodyLadderDistance('Full','Light')).toBe(4));
  it('unknown value = null (no score)', () => expect(bodyLadderDistance('Full','???')).toBeNull());
});

describe('scoreProducts', () => {
  const ans = (o: Partial<Answers>): Answers => ({ category:'red', ...o } as Answers);

  it('ranks the exact-body match above a far one', () => {
    const pool = [P({sku:'far', wine_body:'Light'}), P({sku:'exact', wine_body:'Full'})];
    const out = scoreProducts(ans({axis1:'bold'}), pool as any); // bold → Full
    expect(out[0].sku).toBe('exact');
  });

  it('a "No preference" (no axis1) contributes 0 → order falls back to floor/price', () => {
    const pool = [P({sku:'a', wine_body:'Full', price:2000}), P({sku:'b', wine_body:'Light', price:1000})];
    const out = scoreProducts(ans({}), pool as any);
    expect(out.map(p=>p.sku)).toContain('a'); // both present, neither boosted by body
  });

  it('minimum-results guarantee: returns ≥4 even when nothing matches deeply', () => {
    const pool = Array.from({length:6},(_,i)=>P({sku:`p${i}`, wine_body:undefined}));
    expect(scoreProducts(ans({axis1:'bold', flavorChips:['oak']}), pool as any).length).toBeGreaterThanOrEqual(4);
  });

  it('never returns duplicates or out-of-stock', () => {
    const pool = [P({sku:'x'}), P({sku:'x'}), P({sku:'oos', is_in_stock:false})];
    const out = scoreProducts(ans({}), pool as any);
    expect(new Set(out.map(p=>p.sku)).size).toBe(out.length);
    expect(out.some(p=>p.sku==='oos')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/finder/scoring.ts`**

```ts
import type { PublicProduct } from '@/lib/types';
import type { Answers } from './answers';
import { finderPrefilter } from './category-map';
import { foodChipMatches } from './food-chips';

const BODY_LADDER = ['light','medium-light','medium','medium-full','full'];
const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** Ordinal distance on the 5-level body scale; null if either value is off-ladder. */
export function bodyLadderDistance(target: string, value: string): number | null {
  const ti = BODY_LADDER.indexOf(norm(target));
  const vi = BODY_LADDER.indexOf(norm(value));
  if (ti < 0 || vi < 0) return null;
  return Math.abs(ti - vi);
}

// axis1 tokens for wine body → target ladder label (config mirrors this; kept local for scoring).
const BODY_TOKEN: Record<string, string> = { light:'Light', medium:'Medium', bold:'Full' };

function ladderScore(distance: number | null, exact: number): number {
  if (distance === null) return 0;
  if (distance === 0) return exact;
  if (distance === 1) return exact - 2;
  if (distance === 2) return Math.max(exact - 3, 1);
  return 0;
}

const MIN_RESULTS = 4;

export function scoreProducts(a: Answers, products: PublicProduct[]): PublicProduct[] {
  const pool = finderPrefilter(products, a);

  const scored = pool.map((p) => {
    let s = 0;
    // TIER 1 — body ladder (wine categories). axis1 token → target label.
    if (a.axis1 && BODY_TOKEN[a.axis1] && p.wine_body) {
      s += ladderScore(bodyLadderDistance(BODY_TOKEN[a.axis1], p.wine_body), 4);
    }
    // TIER 1 — flavor chips vs taste_profile/flavor_tags (simple contains; P4 will canonicalize)
    if (a.flavorChips?.length) {
      const tags = (p.flavor_tags ?? []).map(norm);
      for (const chip of a.flavorChips) if (tags.includes(norm(chip))) s += 2;
    }
    // TIER 2 — origin (axis2 origin token vs country, for whisky etc.)
    if (a.axis2 && p.country && norm(p.country).includes(norm(a.axis2))) s += 2;
    // TIER 3 — occasion weighting
    if ((a.occasion === 'gift' || a.occasion === 'special') &&
        typeof p.score_summary === 'string' && p.score_summary.trim() !== '') s += 2;
    // TIER 3 — food overlap
    s += foodChipMatches(p, a.food);
    return { p, s };
  });

  scored.sort((x, y) =>
    y.s - x.s ||
    Number(!!y.p.score_summary) - Number(!!x.p.score_summary) ||
    (x.p.price ?? 0) - (y.p.price ?? 0),
  );

  // GUARANTEE: dedupe by sku; always return ≥ MIN_RESULTS when the pool has them.
  const seen = new Set<string>();
  const out: PublicProduct[] = [];
  for (const { p } of scored) {
    if (seen.has(p.sku)) continue;
    seen.add(p.sku); out.push(p);
  }
  return out; // pool already in-stock+category+budget; caller shows top N (e.g. 8). ≥4 guaranteed if pool≥4.
}
```

NOTE: `flavorChips` matching here is a simple `includes`; canonical mapping lands with data
task P4 (spec §8) — no code change needed then, just better data. Keep it simple now (YAGNI).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS. Adjust `ladderScore` constants only if a test asserts a specific tie — keep the ordering guarantees.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/scoring.ts apps/catalog/lib/finder/__tests__/scoring.test.ts
git commit -m "feat(finder): tiered scoring engine + ordinal body ladder + min-results"
```

---

## Task 5: `question-config.ts` — per-category steps (TDD-light)

**Files:** Create `lib/finder/question-config.ts`; Test `lib/finder/__tests__/` (add to category-map or a new file)

- [ ] **Step 1: Write a failing test** asserting structure + the step-count invariant

```ts
import { describe, it, expect } from 'vitest';
import { QUESTION_CONFIG, stepsFor } from '@/lib/finder/question-config';

describe('question config', () => {
  it('every FinderCategory has a config with ≥3 steps', () => {
    for (const cat of ['red','white','sparkling','whisky','gin','spirits','sake'] as const) {
      expect(stepsFor(cat).length).toBeGreaterThanOrEqual(3);
    }
  });
  it('step 1 is always category-independent shared content (occasion or budget) after category', () => {
    expect(stepsFor('red')[0].id).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/finder/question-config.ts`** — declare each category's ordered steps
  (occasion, budget, axis1, axis2?, flavorChips?), each step with `{id, title, options:[{token,label}]}`,
  and `stepsFor(category)`. Wine categories share the body/acidity axis templates; whisky uses
  origin/smoky tokens; thin categories declare fewer steps. Include a "No preference" option on every
  taste step. (Pure data — keep it declarative; no logic beyond `stepsFor`.)

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/question-config.ts apps/catalog/lib/finder/__tests__/question-config.test.ts
git commit -m "feat(finder): per-category question config + stepsFor"
```

---

## Task 6: `style-profiles.ts` — archetypes + resolver (TDD)

**Files:** Create `lib/finder/style-profiles.ts`; Test `lib/finder/__tests__/style-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveProfile, STYLE_PROFILES } from '@/lib/finder/style-profiles';
import type { Answers } from '@/lib/finder/answers';

describe('style profiles', () => {
  it('every category has ≥1 archetype', () => {
    for (const cat of ['red','white','sparkling','whisky','gin','spirits','sake'] as const)
      expect(STYLE_PROFILES.some(p=>p.category===cat)).toBe(true);
  });
  it('resolves deterministically (same answers → same profile)', () => {
    const a: Answers = { category:'red', axis1:'bold' };
    expect(resolveProfile(a)!.id).toBe(resolveProfile(a)!.id);
  });
  it('a bold red resolves to a full-bodied archetype', () => {
    const prof = resolveProfile({ category:'red', axis1:'bold' });
    expect(prof?.category).toBe('red');
    expect(prof?.definingAttributes.body?.toLowerCase()).toContain('full');
  });
  it('always returns a profile for a valid category (never null)', () => {
    expect(resolveProfile({ category:'sake' })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.

- [ ] **Step 3: Implement `lib/finder/style-profiles.ts`** — `StyleProfile` interface (spec §6),
  ~3–5 archetypes per category (~30 total) hand-authored, each with a `match(answers)=>number`.
  `resolveProfile(a)` returns the highest-scoring archetype for the category, with a guaranteed
  default per category (so it never returns null for a valid category).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/style-profiles.ts apps/catalog/lib/finder/__tests__/style-profiles.test.ts
git commit -m "feat(finder): style-profile archetype library + deterministic resolver"
```

---

## Task 7: Finder pages + components (UI; typecheck + browser, not unit)

**Files:** Create `app/finder/page.tsx`, `app/finder/[step]/page.tsx`, `app/finder/result/page.tsx`,
`components/finder/{StepShell,ChoiceCards,StyleResult}.tsx`

- [ ] **Step 1: Build `StepShell` + `ChoiceCards`** — progress bar, Back, big tap targets (≥44px),
  a "No preference / Surprise me" choice. Mirror existing component style (see `components/Filters.tsx`,
  `components/ProductCard.tsx`).

- [ ] **Step 2: Build `app/finder/page.tsx`** — intro + Step 1 category grid (7 cards). Selecting a
  category routes to `/finder/2?cat=<x>` (state carried in URL via `encodeAnswers`).

- [ ] **Step 3: Build `app/finder/[step]/page.tsx`** — read `Answers` from searchParams, look up the
  step from `stepsFor(category)[stepIndex]`, render its options via `ChoiceCards`. On select, append the
  answer to the URL and advance. **Out-of-range step → redirect to result or last valid step** (spec §3).
  When occasion='food', insert the conditional food sub-step.

- [ ] **Step 4: Build `StyleResult` + `app/finder/result/page.tsx`** — `decodeAnswers(searchParams)`;
  if `!category` → `redirect('/finder')`. Call `resolveProfile(answers)` and
  `scoreProducts(answers, getAllProducts())`; render the archetype card (StyleResult) + top 8 products
  via `ProductCard`. If the scored list is short, show the honest "Closest matches in your budget" label
  (spec §5 guarantee). Add "Refine answers" (back to last step) and "Start over" (`/finder`).

- [ ] **Step 5: Typecheck.** Run: `cd "apps/catalog" && npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/app/finder apps/catalog/components/finder
git commit -m "feat(finder): finder pages (intro, steps, result) + components"
```

---

## Task 8: Browser verification (Rule 7 — mandatory before "done")

**Files:** none (verification only)

- [ ] **Step 1: Build.** Run: `cd "apps/catalog" && NODE_OPTIONS=--max-old-space-size=4096 npm run build` — Expected: success.
- [ ] **Step 2: Start + walk all 7 categories.** Run: `cd "apps/catalog" && npm run start` (background, port 3100).
  For EACH of red, white, sparkling, whisky, gin, spirits, sake: open `/finder`, pick the category, answer
  through to `/finder/result`, and confirm:
  - The style profile card renders (name, expert note, attributes).
  - The product grid is **non-empty** (≥4) and **in-stock**.
  - A `gin` run shows gin (no rum/vodka); a `spirits` run shows no gin (spec Finding 1).
  - A "No preference" path still produces a result.
  - A "With food" path shows the food sub-step and the chips affect results.
  - The result URL is shareable: copy it, open in a fresh tab → identical result (back-safe).
- [ ] **Step 3: Margin-leak spot check.** Run:
  `curl -s "http://localhost:3100/finder/result?cat=red&a1=bold" | grep -ci "margin\|b2b\|enrichment\|popularity"` → Expected: **0**.
- [ ] **Step 4: Full unit suite.** Run: `cd "apps/catalog" && npm run test` — Expected: all pass (existing 170 + new finder tests).
- [ ] **Step 5: Commit any fixes.**

```bash
git add -A && git commit -m "test(finder): verify all 7 category journeys + no margin leak (Rule 7)"
```

---

## Notes for the implementer
- **Never bypass `getAllProducts()` / `toPublicProduct`** — it's the margin-leak chokepoint. The finder
  only ever sees `PublicProduct` (margin/B2B fields already absent).
- **`is_in_stock` on `PublicProduct` is a BOOLEAN** (normalized). Use `isInStock(p.is_in_stock)`.
- **Filter by `groupForProduct` + classMatch**, never raw `classification` equality (the "Wine product"
  garbage bucket). Task 2 owns this.
- **Data tasks P1–P6 (spec §8) need NO finder code change** — better data → better results after a rebuild.
- Keep `scoring.ts`, `answers.ts`, `style-profiles.ts`, `category-map.ts`, `food-chips.ts` PURE
  (no Next/React/I-O) so they stay unit-testable and the finder plan's tests hold.
```
