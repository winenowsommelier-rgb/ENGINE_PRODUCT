# WNLQ9 Finder Sommelier Upgrade (v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "sommelier deep-dive" to the finder (acidity/tannin/grape/age/adventurousness, all data-backed) and turn the result into a navigable discovery map (clickable category→country→region→subregion breadcrumb + signature chips + "see all N"), every link into the catalog's EXISTING `/shop` filters.

**Architecture:** Purely ADDITIVE to the shipped v1 finder. New pure modules (`scales.ts`, `shop-links.ts`), additive fields on `Answers`, additive scoring terms, additive deep-dive steps in `question-config.ts`, and an extended `StyleResult` component. Core-only runs score byte-for-byte like v1; the deep-dive degrades to zero contribution when unanswered. No new data dependency, no BI key — uses fields already in `live_products_export.json`.

**Tech Stack:** Next.js 14, TypeScript, Vitest, Tailwind. Extends `apps/catalog/lib/finder/*` + `components/finder/*`. Run all commands from `apps/catalog/`; `@/` = `apps/catalog/`.

**Spec:** `docs/superpowers/specs/2026-06-20-wnlq9-finder-sommelier-upgrade-design.md`

---

## Verified facts (do not re-assume)
- v1 exports: `Answers` (category, occasion, food, budget, axis1, axis2, flavorChips), `encodeAnswers`/`decodeAnswers`, `scoreProducts(a, products) → ScoreResult {products, degraded}`, `bodyLadderDistance`, `StyleProfile {category,name,definingAttributes{body,acidity,tannin,typicalGrapes,typicalRegions},...}`, `StyleResult({profile, products, degraded})`.
- **Real component scales (verified):** body `Light·Medium-Light·Medium·Medium-Full·Full`; acidity `Medium-Light·Medium·Medium-Full·Medium-High·High`(+rare Full); tannin `Low·Light·Medium-Light·Medium·Medium-Full·Medium-High·High`(+rare Full). **Sommelier labels ("Firm","crisp") are NOT data values.**
- **`/shop` filters (exact param names, verified in `shop-query.ts`):** `group, class, country, region, subregion, grape, body, acidity, tannin, price, flavor, sort, page`. `class` = exact-ci on first `classification` segment; `region`/`subregion`/`country` = exact-ci; `grape` = substring-ci; `body/acidity/tannin` = exact-ci on the normalized scale value.
- **typicalRegions field reality:** `Bordeaux`→region; `Médoc`/`Beaujolais`→subregion; `"Barossa"`→neither (data has `Barossa Valley`=subregion); whisky entries often country-level. MUST resolve per-value.
- **Vintage shapes (in-stock red):** `"Current vintage"` (1,079, dominant)→young; `YYYY [**VINTAGE MAY CHANGE]` (631)→year; bare `YYYY` (471)→year; none/NV (18).
- `spirit_style` IS populated (1,274) — whisky cask deep-dive is data-backed.
- Tests: Vitest, files under `lib/finder/__tests__/*.test.ts`, `@/` alias works.

---

## File Structure
**Create:**
- `lib/finder/scales.ts` — token→scale-value maps (body/acidity/tannin) + `bucketForValue`; the ONE shared place scoring + links read scale values
- `lib/finder/shop-links.ts` — pure `/shop?…` URL builders from a style/scope + `resolveOriginField`
- `lib/finder/__tests__/scales.test.ts`, `shop-links.test.ts`

**Modify (additive):**
- `lib/finder/answers.ts` — add optional fields + codec params
- `lib/finder/question-config.ts` — add per-category opt-in deep-dive steps
- `lib/finder/scoring.ts` — add acidity/tannin/grape/age/adventurousness terms (degrade to 0)
- `lib/finder/style-profiles.ts` — normalize archetype `typicalRegions` to real data values (fix "Barossa"→"Barossa Valley" etc.)
- `components/finder/StyleResult.tsx` — add geo breadcrumb links + signature chips + "see all N" + per-bottle reasons
- `components/finder/StepShell.tsx` (or the step page) — add the "Refine like a sommelier →" branch
- existing `__tests__/{answers,scoring,question-config}.test.ts` — extend

---

## Task 1: `scales.ts` — token→scale-value maps (TDD)

**Files:** Create `lib/finder/scales.ts`; Test `lib/finder/__tests__/scales.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { SCALE_VALUES, primaryValue, valuesForToken } from '@/lib/finder/scales';

describe('scale maps (labels are NOT data values)', () => {
  it('body bold → Full primary, [Full,Medium-Full] set', () => {
    expect(primaryValue('body','bold')).toBe('Full');
    expect(valuesForToken('body','bold')).toEqual(['Full','Medium-Full']);
  });
  it('tannin firm → High primary (NOT "Firm")', () => {
    expect(primaryValue('tannin','firm')).toBe('High');
    expect(valuesForToken('tannin','firm')).toContain('Medium-High');
  });
  it('acidity crisp → High primary', () => expect(primaryValue('acidity','crisp')).toBe('High'));
  it('acidity soft → Medium-Light primary', () => expect(primaryValue('acidity','soft')).toBe('Medium-Light'));
  it('unknown token → undefined', () => expect(primaryValue('body','zzz')).toBeUndefined());
  it('SCALE_VALUES lists the real ordinal scales', () => {
    expect(SCALE_VALUES.body).toEqual(['Light','Medium-Light','Medium','Medium-Full','Full']);
  });
});
```
- [ ] **Step 2: Run, confirm FAIL.** `npx vitest run lib/finder/__tests__/scales.test.ts`
- [ ] **Step 3: Implement `lib/finder/scales.ts`**
```ts
export const SCALE_VALUES = {
  body:    ['Light','Medium-Light','Medium','Medium-Full','Full'],
  acidity: ['Medium-Light','Medium','Medium-Full','Medium-High','High'],
  tannin:  ['Low','Light','Medium-Light','Medium','Medium-Full','Medium-High','High'],
} as const;
type Scale = keyof typeof SCALE_VALUES;

// token → ordered scale values (primary first). Primary is used for single-value /shop links;
// the full set is used by scoring buckets. Labels ("Firm"/"crisp") never appear here.
const TOKEN_MAP: Record<Scale, Record<string, string[]>> = {
  body:    { bold:['Full','Medium-Full'], medium:['Medium','Medium-Light'], light:['Light','Medium-Light'] },
  acidity: { crisp:['High','Medium-High'], balanced:['Medium','Medium-Full'], soft:['Medium-Light','Medium'] },
  tannin:  { firm:['High','Medium-High','Medium-Full'], silky:['Low','Light','Medium-Light'], any:[] },
};
export function valuesForToken(scale: Scale, token: string): string[] { return TOKEN_MAP[scale]?.[token] ?? []; }
export function primaryValue(scale: Scale, token: string): string | undefined { return valuesForToken(scale, token)[0]; }
/** ordinal index of a real scale value (for ladder distance), or -1. */
export function bucketForValue(scale: Scale, value: string | undefined): number {
  return value ? (SCALE_VALUES[scale] as readonly string[]).indexOf(value) : -1;
}
```
- [ ] **Step 4: Run, confirm PASS (6).**
- [ ] **Step 5: Commit** `git add apps/catalog/lib/finder/scales.ts apps/catalog/lib/finder/__tests__/scales.test.ts && git commit -m "feat(finder): scale-value maps (sommelier labels → real data values)"`

---

## Task 2: `answers.ts` — add deep-dive fields + codec (TDD, extend existing)

**Files:** Modify `lib/finder/answers.ts`; extend `lib/finder/__tests__/answers.test.ts`

- [ ] **Step 1: Add failing tests** (keep all existing) asserting new fields round-trip:
```ts
  it('round-trips deep-dive fields', () => {
    const a = { category:'red', acidity:'crisp', tannin:'firm', grape:'cabernet', age:'mature', adventure:'discovery' } as any;
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(a)))).toEqual(a);
  });
```
- [ ] **Step 2: Run, confirm the new test FAILS** (fields dropped by codec).
- [ ] **Step 3: Implement** — add to `Answers`: `acidity?, tannin?, grape?, age?, adventure?` (+ `cask?, peat?` for whisky). Add codec params (short keys: `ac, tn, gr, ag, adv`, `ck, pt`). Mirror v1's existing optional-field pattern in `encodeAnswers`/`decodeAnswers` (set only when present; decode validates/passes through).
- [ ] **Step 4: Run, confirm ALL pass.**
- [ ] **Step 5: Commit** `… && git commit -m "feat(finder): add sommelier deep-dive fields to Answers + URL codec"`

---

## Task 3: `shop-links.ts` — discovery-map URL builder + origin resolver (TDD)

**Files:** Create `lib/finder/shop-links.ts`; Test `lib/finder/__tests__/shop-links.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { resolveOriginField, breadcrumbLinks, signatureChips, styleShopUrl } from '@/lib/finder/shop-links';
import type { PublicProduct } from '@/lib/types';

// minimal in-memory catalog for field resolution
const cat = [
  { region:'Bordeaux' }, { subregion:'Médoc' }, { subregion:'Barossa Valley' }, { country:'Japan' },
] as any as PublicProduct[];

describe('resolveOriginField', () => {
  it('Bordeaux → region', () => expect(resolveOriginField('Bordeaux', cat)).toEqual({ field:'region', value:'Bordeaux' }));
  it('Médoc → subregion', () => expect(resolveOriginField('Médoc', cat)).toEqual({ field:'subregion', value:'Médoc' }));
  it('Japan → country', () => expect(resolveOriginField('Japan', cat)).toEqual({ field:'country', value:'Japan' }));
  it('Barossa (absent) → null (dropped, no dead link)', () => expect(resolveOriginField('Barossa', cat)).toBeNull());
});

describe('link builders', () => {
  it('breadcrumb uses class= exact + resolved geo fields, omits appellation', () => {
    const links = breadcrumbLinks({ category:'red', country:'France', typicalRegion:'Médoc' } as any, cat);
    const url = links.find(l => l.label==='Médoc')!.href;
    expect(url).toContain('class=Red+Wine'); // or Red%20Wine — accept either encoding
    expect(url).toContain('subregion=M'); // Médoc encoded
    expect(url).not.toContain('appellation');
  });
  it('signature chip body=bold → body=Full (scale value, not "bold")', () => {
    const chips = signatureChips({ category:'red', axis1:'bold', tannin:'firm' } as any);
    expect(chips.some(c => c.href.includes('body=Full'))).toBe(true);
    expect(chips.some(c => c.href.includes('tannin=High'))).toBe(true);
    expect(chips.some(c => c.href.includes('tannin=firm'))).toBe(false); // never the label/token
  });
  it('styleShopUrl (see all N) has no region constraint', () => {
    const url = styleShopUrl({ category:'red', axis1:'bold' } as any);
    expect(url).toContain('body=Full');
    expect(url).not.toContain('region=');
  });
});
```
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement `lib/finder/shop-links.ts`** — pure functions:
  - `resolveOriginField(value, catalog)`: exact-ci match against `region`, then `subregion`, then `country`; return `{field,value}` or null.
  - `breadcrumbLinks(scope, catalog)`: build ordered levels [category→ `class=`; country→`country=`; resolved typicalRegion→ its field]; URL-encode; NEVER appellation; drop unresolved levels.
  - `signatureChips(answers)`: chips for body/tannin/acidity (via `primaryValue` from scales.ts), grape family (substring token), region. Each `{label, href}`.
  - `styleShopUrl(answers)`: the "see all N" broad filter (taste params only, NO geo).
  - All build on a `FinderCategory → {group, classValue}` map (reuse v1 category-map's mapping; `group=Wine&class=Red Wine` etc.). Use the same param NAMES as `shop-query.ts` verbatim.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** `… && git commit -m "feat(finder): shop-link builder + origin field resolver for discovery map"`

---

## Task 4: `style-profiles.ts` — normalize typicalRegions to real data values (TDD)

**Files:** Modify `lib/finder/style-profiles.ts`; extend its test

- [ ] **Step 1: Add a failing test** asserting every archetype's `typicalRegions`/`typicalGrapes` resolve against the REAL export (load `getAllProducts`), so none are dead:
```ts
import { getAllProducts } from '@/lib/catalog-data';
import { resolveOriginField } from '@/lib/finder/shop-links';
it('every archetype typicalRegion resolves to a real field (no dead geo links)', () => {
  const cat = getAllProducts();
  for (const p of STYLE_PROFILES) for (const r of (p.definingAttributes.typicalRegions ?? []))
    expect(resolveOriginField(r, cat), `${p.id}:${r}`).not.toBeNull();
});
```
- [ ] **Step 2: Run, confirm FAIL** (e.g. "Barossa", whisky labels like "Worldwide"/"Cognac" won't resolve).
- [ ] **Step 3: Fix the archetype data** — replace each non-resolving `typicalRegions` value with the real data value (`"Barossa"`→`"Barossa Valley"`), or drop values that genuinely don't exist in any field (e.g. promotional labels). Use the export to find the correct strings. Do NOT invent values.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** `… && git commit -m "fix(finder): normalize archetype typicalRegions to real catalog values (no dead geo links)"`

---

## Task 5: `scoring.ts` — add deep-dive scoring terms (TDD, extend)

**Files:** Modify `lib/finder/scoring.ts`; extend `lib/finder/__tests__/scoring.test.ts`

- [ ] **Step 1: Add failing tests** (keep all existing):
```ts
  it('acidity crisp ranks High-acidity above Soft', () => {
    const pool=[P({sku:'WRWs',wine_acidity:'Medium-Light'}),P({sku:'WRWc',wine_acidity:'High'})];
    expect(scoreProducts(ans({acidity:'crisp'}),pool).products[0].sku).toBe('WRWc');
  });
  it('grape cabernet boosts a Cabernet blend; surprise does not constrain', () => {
    const pool=[P({sku:'WRWo',grape_variety:'Merlot'}),P({sku:'WRWc',grape_variety:'Cabernet Sauvignon, Merlot'})];
    expect(scoreProducts(ans({grape:'cabernet'}),pool).products[0].sku).toBe('WRWc');
  });
  it('age young buckets "Current vintage" as young', () => {
    const pool=[P({sku:'WRWm',vintage:'2005'}),P({sku:'WRWy',vintage:'Current vintage'})];
    expect(scoreProducts(ans({age:'young'}),pool).products[0].sku).toBe('WRWy');
  });
  it('adventurousness=discovery boosts a non-famous region over Bordeaux', () => {
    const pool=[P({sku:'WRWf',region:'Bordeaux'}),P({sku:'WRWd',region:'Swartland'})];
    expect(scoreProducts(ans({adventure:'discovery'}),pool).products[0].sku).toBe('WRWd');
  });
  it('a core-only Answers scores identically with the new code (additive)', () => {
    const pool=[P({sku:'WRW1',wine_body:'Full'}),P({sku:'WRW2',wine_body:'Light'})];
    const out=scoreProducts(ans({axis1:'bold'}),pool);
    expect(out.products[0].sku).toBe('WRW1'); // unchanged v1 behavior
  });
```
- [ ] **Step 2: Run, confirm new tests FAIL.**
- [ ] **Step 3: Implement** the new TIER terms in the per-product score (all gated on the answer being present, all 0 when absent):
  - acidity/tannin: ordinal-ladder distance via `bucketForValue` (scales.ts) against the token's primary bucket — exact +3 / ±1 +1 / else 0.
  - grape: +2 if `grape_variety` (lowercased) contains any family token (family→token map in config); `surprise`/absent → 0.
  - age: parse vintage → young|mature (handle "Current vintage" any-casing → young; strip `[**VINTAGE MAY CHANGE]`; bare year; mature if `currentYear - year >= AGE_THRESHOLD`); +1 on match.
  - adventurousness: `classic` +2 if `region ∈ FAMOUS_REGIONS`; `discovery` +2 if not; else 0.
  - **CRITICAL:** add these ONLY to the sort/`rankScore`. `degraded` MUST stay computed from the v1 taste-tier score (do not let deep-dive terms enter `wellMatched`). Mirror the BI-spec two-score discipline if needed; simplest: keep a `tasteScore` for the degraded test and `rankScore = tasteScore + deepDiveTerms` for sorting.
- [ ] **Step 4: Run, confirm ALL pass** (incl. the "core-only identical" + existing degraded tests).
- [ ] **Step 5: Commit** `… && git commit -m "feat(finder): sommelier deep-dive scoring (acidity/tannin/grape/age/adventurousness)"`

---

## Task 6: `question-config.ts` — opt-in deep-dive steps (TDD, extend)

**Files:** Modify `lib/finder/question-config.ts`; extend its test

- [ ] **Step 1: Add failing tests** — a `deepDiveStepsFor(category)` returns the sommelier steps; wine has acidity/tannin/grape/age/adventure; thin categories fewer; core `stepsFor` unchanged; every deep-dive step is `optional:true`.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** `deepDiveStepsFor(category)` (separate from core `stepsFor`) with the sommelier-voice titles + tokens from spec §3. Wine: acidity, tannin (reds), grape, age, adventure. Whisky: cask (`spirit_style`), peat, age, adventure. Gin/spirits/sake: shorter per spec. Each step `optional:true`, `field` = the new Answers field.
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** `… && git commit -m "feat(finder): per-category opt-in sommelier deep-dive steps"`

---

## Task 7: UI — deep-dive branch + discovery-map result (typecheck + browser)

**Files:** Modify `components/finder/StyleResult.tsx`, `StepShell.tsx`, `app/finder/[step]/page.tsx`, `app/finder/result/page.tsx`

- [ ] **Step 1: Add the "Refine like a sommelier →" branch** — after the core steps complete, the step page offers the opt-in deep-dive (append `deepDiveStepsFor(category)` to the effective step list when the user chooses to refine; otherwise go to result). Carry all answers in the URL as today.
- [ ] **Step 2: Extend `StyleResult.tsx`** — add, above the existing grid: (a) geo breadcrumb from `breadcrumbLinks(scope, allProducts)` (resolve scope from the profile's `definingAttributes.typicalRegions[0]` + category + country), each a `<Link>`; (b) signature chips from `signatureChips(answers)`; (c) a "See all N in your style ↗" link from `styleShopUrl(answers)`; (d) per-bottle "why" reason strings (derive from which signals matched — a small pure helper). Label geo "Classically found in". Render nothing for a level that resolves to null (no dead links).
- [ ] **Step 3: Pass `answers` + `allProducts` into `StyleResult`** from `result/page.tsx` (it already has both: `decodeAnswers` + `getAllProducts`).
- [ ] **Step 4: Typecheck.** `npm run typecheck` — must pass.
- [ ] **Step 5: Commit** `git add apps/catalog/app/finder apps/catalog/components/finder && git commit -m "feat(finder): sommelier deep-dive branch + navigable discovery-map result"`

---

## Task 8: Browser verification (Rule 7 — mandatory)

- [ ] **Step 1: Build.** `NODE_OPTIONS=--max-old-space-size=4096 npm run build` — succeeds.
- [ ] **Step 2: Start + walk** (kill stale :3100 first: `lsof -ti:3100 | xargs kill -9`). On the live site:
  - Core path still works for all 7 categories (no regression).
  - Wine: choose "Refine like a sommelier" → all deep-dive questions render in sommelier voice.
  - Result shows the geo breadcrumb + signature chips + "See all N"; **click each → lands on the correctly-filtered `/shop`** (verify the grid is non-empty and matches the filter, e.g. tannin link shows high-tannin reds).
  - Appellation never appears as a link.
  - **Margin-leak grep = 0** on the result page and the linked shop pages: `curl -s "<url>/finder/result?cat=red&ac=crisp" | grep -ci "margin\|b2b\|enrichment"`.
- [ ] **Step 3: Full suite.** `npm run test` — all pass (existing + new finder tests).
- [ ] **Step 4: Commit any fixes** `git add -A && git commit -m "test(finder): verify sommelier deep-dive + discovery map end-to-end (Rule 7)"`

---

## Notes for the implementer
- **Additive only** — a core-only run MUST score & render exactly as v1 (tests enforce). The deep-dive is opt-in; every new field defaults to "no contribution."
- **Labels are never filter values** — always go through `scales.ts` (`primaryValue`) for body/acidity/tannin links/scoring. A link with a sommelier label = a dead filter.
- **Every geo link must resolve to a real field** via `resolveOriginField` — drop unresolved, never emit a dead link. Never link appellation (0% data).
- **`degraded` stays a taste-tier-only computation** — deep-dive terms affect sort order, not the honest-label flag.
- Reuse `shop-query.ts` param names verbatim; the finder link builder and the shop must never drift.
- BI "Customers also bought" (separate spec) will later enhance the matches grid — leave the grid's per-bottle reason rendering extensible.
