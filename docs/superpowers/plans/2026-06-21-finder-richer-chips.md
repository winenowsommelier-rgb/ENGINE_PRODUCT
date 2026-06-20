# Finder Richer Iconed Chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the finder's generic food/flavor chips with richer, grouped, **icon-led** choices (real cuisines + dish groups; 12 flavor families from the canonical taxonomy), add emoji icons to ALL finder chips, and FIX the shipped-broken flavor scoring.

**Architecture:** Additive content change to the shipped finder. Three data maps get richer (`food-chips.ts`, a new `FLAVOR_FAMILY` in `scoring.ts`, icons across `question-config.ts`), the flavor matcher is rewritten to set-intersect canonical notes, `flavor_tags_canonical` is added to the public allowlist, and chip components render `option.icon`. No architecture change; the additive/`degraded` discipline is preserved.

**Tech Stack:** Next.js 14, TypeScript, Vitest, Tailwind. All work in `apps/catalog/`; run commands from there; `@/` = `apps/catalog/`.

**Spec:** `docs/superpowers/specs/2026-06-21-finder-richer-chips-design.md`

---

## Verified facts (do not re-assume)
- `StepOption = { token: string; label: string }` (question-config.ts) — add optional `icon?: string`.
- `ChoiceCards` renders `{opt.label}` (line ~157 multi, ~186 single); `FoodChoice` renders `{opt.label}` (line ~69). Add `{opt.icon}` before label in both. **`StepShell` renders NO chips — do not touch.**
- `FOOD_CHIPS: Record<string, string[]>` (food-chips.ts) — currently key→keywords. The food step (`[step]/page.tsx` FOOD_STEP) builds options as `Object.keys(FOOD_CHIPS).map(key => ({token:key, label:<TitleCase>}))`. So FOOD_CHIPS must now also carry label + icon.
- Flavor scoring (scoring.ts ~216-219) is **BROKEN**: `tags.includes(norm(chip))` against `p.flavor_tags`; chip keys are hyphenated (`red-fruit`) and never equal spaced tags (`red fruit`) → `red-fruit`/`dark-fruit` score 0 today.
- **`flavor_tags_canonical` is NOT in `PUBLIC_FIELDS`** (catalog-data.ts:13-22 has only `flavor_tags`). It MUST be added to the allowlist + `PublicProduct` type before scoring can read it. Canonical values are Title-Case ("Dark Plum", "Minerality").
- Margin-leak chokepoint: `toPublicProduct` copies only `PUBLIC_FIELDS`. Adding `flavor_tags_canonical` (a safe taste field) is fine; the allowlist-subset test must still pass.
- `is_in_stock` is normalized to boolean on PublicProduct. Tests use `vitest`, `@/` alias.

---

## File Structure
**Modify:**
- `lib/types.ts` — add `flavor_tags_canonical?: string[]` to PublicProduct
- `lib/catalog-data.ts` — add `'flavor_tags_canonical'` to PUBLIC_FIELDS
- `lib/finder/food-chips.ts` — FOOD_CHIPS → `Record<key,{label,icon,keywords}>` (the §3 15 chips); `foodChipMatches` reads `.keywords`
- `lib/finder/scoring.ts` — add `FLAVOR_FAMILY` map + rewrite flavor scoring to set-intersect `flavor_tags_canonical`
- `lib/finder/question-config.ts` — `StepOption` gains `icon?`; flavor step → 12 family chips; add icons to all option sets
- `app/finder/[step]/page.tsx` — FOOD_STEP options built from new FOOD_CHIPS (label+icon)
- `components/finder/ChoiceCards.tsx`, `FoodChoice.tsx` — render `opt.icon`
- `app/finder/page.tsx` — category cards get icons
**Test:** extend `lib/finder/__tests__/{food-chips,scoring,question-config}.test.ts`; new data-invariant test for no-dead-chip.

---

## Task 1: Add `flavor_tags_canonical` to the public projection (TDD)

**Files:** Modify `lib/types.ts`, `lib/catalog-data.ts`; extend `lib/finder/__tests__/` or `lib/__tests__/catalog-data.test.ts`

- [ ] **Step 1: Write/extend a failing test** — assert the projected PublicProduct exposes `flavor_tags_canonical` AND the allowlist-subset invariant still holds. In the catalog-data test (or a new finder test):
```ts
import { getAllProducts } from '@/lib/catalog-data';
it('exposes flavor_tags_canonical on projected products', () => {
  const withCanon = getAllProducts().find(p => (p as any).flavor_tags_canonical?.length);
  expect(withCanon, 'at least one product has canonical flavor tags').toBeTruthy();
  expect(Array.isArray((withCanon as any).flavor_tags_canonical)).toBe(true);
});
```
- [ ] **Step 2: Run, confirm FAIL** (field stripped by allowlist). `npx vitest run lib/__tests__/catalog-data.test.ts` (or wherever the test lives).
- [ ] **Step 3: Implement** — add `flavor_tags_canonical?: string[];` to `PublicProduct` (types.ts, near `flavor_tags`); add `'flavor_tags_canonical'` to `PUBLIC_FIELDS` (catalog-data.ts). Confirm `toPublicProduct` copies array fields correctly (same handling as `flavor_tags`).
- [ ] **Step 4: Run, confirm PASS.** Also run the existing margin-leak/allowlist-subset test — must still pass (the new field is allowlisted, so the subset invariant holds).
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/lib/types.ts apps/catalog/lib/catalog-data.ts apps/catalog/lib/__tests__/catalog-data.test.ts
git commit -m "feat(catalog): expose flavor_tags_canonical in public projection (for finder flavor scoring)"
```

---

## Task 2: Rich food chips with icons + matcher (TDD)

**Files:** Modify `lib/finder/food-chips.ts`; extend `lib/finder/__tests__/food-chips.test.ts`

- [ ] **Step 1: Add failing tests** (keep existing where still valid; update for the new shape):
```ts
import { FOOD_CHIPS, foodChipMatches } from '@/lib/finder/food-chips';
it('has the 15 grouped cuisine+dish chips with label+icon+keywords', () => {
  expect(Object.keys(FOOD_CHIPS)).toHaveLength(15);
  for (const c of Object.values(FOOD_CHIPS)) {
    expect(c.label).toBeTruthy(); expect(c.icon).toBeTruthy(); expect(c.keywords.length).toBeGreaterThan(0);
  }
});
it('thai chip matches a thai food_matching', () =>
  expect(foodChipMatches({ food_matching: 'Spicy Thai green curry' } as any, ['thai'])).toBe(1));
it('sushi chip matches sashimi', () =>
  expect(foodChipMatches({ food_matching: 'Sushi & sashimi platter' } as any, ['sushi'])).toBe(1));
it('grilled chip matches "Grilled red meat"', () =>
  expect(foodChipMatches({ food_matching: 'Grilled red meat, lamb' } as any, ['grilled'])).toBe(1));
it('counts one per matching chip', () =>
  expect(foodChipMatches({ food_matching: 'Grilled steak, aged cheese' } as any, ['grilled','cheese'])).toBe(2));
```
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** — change FOOD_CHIPS to `Record<string, { label: string; icon: string; keywords: string[] }>` with the §3 15 chips (Thai 🌶️, Sushi 🍣, Dim sum 🥟, Korean BBQ 🍖, Vietnamese 🍜, Spicy 🔥, Grilled 🥩, Roast & duck 🍗, Lamb & game 🐑, Pork 🥓, Seafood 🦪, Cheese 🧀, Pasta 🍝, Salads 🥗, Dessert 🍫). Use distinct icons (Korean 🍖 ≠ grilled 🥩). Update `foodChipMatches` to read `FOOD_CHIPS[chip]?.keywords`.
- [ ] **Step 4: Run, confirm PASS.** Run full finder suite.
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/lib/finder/food-chips.ts apps/catalog/lib/finder/__tests__/food-chips.test.ts
git commit -m "feat(finder): 15 grouped cuisine+dish food chips with icons"
```

---

## Task 3: Fix + enrich flavor scoring (FLAVOR_FAMILY set-intersection) (TDD)

**Files:** Modify `lib/finder/scoring.ts`; extend `lib/finder/__tests__/scoring.test.ts`

- [ ] **Step 1: Add failing tests** (keep all existing):
```ts
// regression: dark-fruit was DEAD (hyphen vs space) — must now score >0
it('dark-fruit chip scores a product with canonical "Dark Plum"', () => {
  const pool=[P({sku:'WRWdf', flavor_tags_canonical:['Dark Plum','Cedar']})];
  expect(scoreProducts(ans({flavorChips:['dark-fruit']}),pool).products.length).toBe(1);
  // and it ranks above a no-match product
  const pool2=[P({sku:'WRWno', flavor_tags_canonical:['Citrus Zest']}), P({sku:'WRWyes', flavor_tags_canonical:['Black Cherry']})];
  expect(scoreProducts(ans({flavorChips:['dark-fruit']}),pool2).products[0].sku).toBe('WRWyes');
});
it('mineral chip matches "Minerality"', () => {
  const pool=[P({sku:'WRWm', flavor_tags_canonical:['Minerality']}), P({sku:'WRWx', flavor_tags_canonical:['Oak']})];
  expect(scoreProducts(ans({flavorChips:['mineral']}),pool).products[0].sku).toBe('WRWm');
});
it('flavor scoring reads flavor_tags_canonical, not flavor_tags', () => {
  // canonical has the note, legacy field does not → must still match
  const pool=[P({sku:'WRWc', flavor_tags:['something else'], flavor_tags_canonical:['Oak']})];
  expect(scoreProducts(ans({flavorChips:['oak']}),pool).products.length).toBe(1);
});
it('a core-only run (no flavorChips) scores identically (additive)', () => {
  const pool=[P({sku:'WRW1', wine_body:'Full'}), P({sku:'WRW2', wine_body:'Light'})];
  expect(scoreProducts(ans({axis1:'bold'}),pool).products[0].sku).toBe('WRW1');
});
```
- [ ] **Step 2: Run, confirm the dark-fruit/mineral/canonical tests FAIL** (current code reads flavor_tags + tags.includes).
- [ ] **Step 3: Implement** — add a `FLAVOR_FAMILY: Record<string, string[]>` map (the §4 12 families → canonical note sets, lowercased). Replace the broken block:
```ts
// OLD (broken): reads flavor_tags + exact hyphen-vs-space includes
// if (a.flavorChips?.length) { const tags=(p.flavor_tags??[]).map(norm);
//   for (const chip of a.flavorChips) if (tags.includes(norm(chip))) s += 2; }
// NEW: set-intersect the chip's canonical note set against flavor_tags_canonical
if (a.flavorChips?.length) {
  const notes = new Set((p.flavor_tags_canonical ?? []).map(norm));
  for (const chip of a.flavorChips) {
    const fam = FLAVOR_FAMILY[chip];
    if (fam && fam.some((n) => notes.has(n))) s += 2;
  }
}
```
  FLAVOR_FAMILY keys MUST equal the chip tokens the config emits (Task 4): red-fruit, dark-fruit, citrus, stone-fruit, tropical, oak, spice, earthy, floral, mineral, smoky, nutty. Note sets are the §4 canonical notes, lowercased (e.g. dark-fruit → ['dark plum','plum','blackcurrant','blackberry','black cherry']). Keep the `+2`. This term still feeds `tasteScore`/`degraded` exactly as the old (broken) one did — but now it actually works (a correctness improvement, acknowledged in spec §8).
- [ ] **Step 4: Run, confirm ALL pass** (incl. the additive core-only guard + existing degraded tests).
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/lib/finder/scoring.ts apps/catalog/lib/finder/__tests__/scoring.test.ts
git commit -m "fix(finder): flavor scoring reads flavor_tags_canonical via FLAVOR_FAMILY set-intersection (was inert for hyphenated chips)"
```

---

## Task 4: Flavor family chips + icons across all steps (TDD)

**Files:** Modify `lib/finder/question-config.ts`; extend `lib/finder/__tests__/question-config.test.ts`

- [ ] **Step 1: Add failing tests:**
```ts
import { stepsFor, deepDiveStepsFor } from '@/lib/finder/question-config';
it('StepOption supports an optional icon', () => {
  const occ = stepsFor('red').find(s=>s.field==='occasion')!;
  expect(occ.options.every(o=>typeof o.icon==='string' && o.icon.length>0)).toBe(true);
});
it('flavor step has the 12 family chips with icons, tokens match FLAVOR_FAMILY', () => {
  const flavor = stepsFor('red').find(s=>s.field==='flavorChips')!;
  expect(flavor.options).toHaveLength(12);
  const tokens = flavor.options.map(o=>o.token);
  expect(tokens).toEqual(expect.arrayContaining(['red-fruit','dark-fruit','mineral','earthy','smoky','nutty']));
  expect(flavor.options.every(o=>o.icon)).toBe(true);
});
it('category Step-1 + budget + body options all carry icons', () => {
  for (const f of ['budget','axis1'] as const) {
    const step = stepsFor('red').find(s=>s.field===f)!;
    expect(step.options.every(o=>o.icon)).toBe(true);
  }
});
```
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement** — add `icon?: string` to `StepOption`. Replace FLAVOR_STEP's 8 flat chips with the 12 family chips (tokens = FLAVOR_FAMILY keys from Task 3; icons per §4: 🍒🫐🍋🍑🍍🪵🌶️🍂🌸🪨💨🥜). Add icons to every existing option set: occasion (🥂/🍽️/🎁/✨/🧭), budget (💸 or tiered), wine body (🪶/⚖️/🍷), character (🍓/🍂/⚖️), whisky/gin/spirits/sake axis options, and the deep-dive acidity/tannin/age/adventure options. Keep all tokens unchanged — only add icons + swap the flavor option list.
- [ ] **Step 4: Run, confirm PASS.** Full finder suite.
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/lib/finder/question-config.ts apps/catalog/lib/finder/__tests__/question-config.test.ts
git commit -m "feat(finder): 12 flavor-family chips + icons on all question options"
```

---

## Task 5: Render icons in chip components + category cards (typecheck + browser)

**Files:** Modify `components/finder/ChoiceCards.tsx`, `FoodChoice.tsx`, `app/finder/[step]/page.tsx` (FOOD_STEP), `app/finder/page.tsx`

- [ ] **Step 1: ChoiceCards + FoodChoice** — render `{opt.icon ? <span aria-hidden>{opt.icon}</span> : null} {opt.label}` (both the multi and single branches in ChoiceCards; the map in FoodChoice). Keep spacing/accessibility (icon decorative → `aria-hidden`).
- [ ] **Step 2: FOOD_STEP** (`[step]/page.tsx`) — build options from the new FOOD_CHIPS carrying label+icon: `Object.entries(FOOD_CHIPS).map(([token,{label,icon}]) => ({token,label,icon}))`. (Drop the old TitleCase-from-key labelling.)
- [ ] **Step 3: Category cards** (`app/finder/page.tsx`) — add a leading icon to each of the 7 category cards (🍷 Red, 🥂 Sparkling, etc.). These are bespoke `<Link>` cards, not StepOptions — add the emoji inline.
- [ ] **Step 4: Typecheck.** `npm run typecheck` — must pass.
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/components/finder apps/catalog/app/finder
git commit -m "feat(finder): render chip icons in ChoiceCards/FoodChoice + category cards"
```

---

## Task 6: No-dead-chip data invariant + browser verification (Rule 7)

**Files:** Create `lib/finder/__tests__/chip-coverage.test.ts`; verification

- [ ] **Step 1: Write the data-invariant test** (the dead-chip guard, against the REAL export):
```ts
import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { FOOD_CHIPS, foodChipMatches } from '@/lib/finder/food-chips';
import { FLAVOR_FAMILY } from '@/lib/finder/scoring'; // export it for the test
import { isInStock } from '@/lib/utils';

const inStock = getAllProducts().filter(p => isInStock(p.is_in_stock));
describe('no dead chips — every chip returns ≥1 in-stock product', () => {
  it('every food chip', () => {
    for (const key of Object.keys(FOOD_CHIPS)) {
      const n = inStock.filter(p => foodChipMatches(p, [key]) > 0).length;
      expect(n, `food chip ${key}`).toBeGreaterThan(0);
    }
  });
  it('every flavor family', () => {
    for (const [key, notes] of Object.entries(FLAVOR_FAMILY)) {
      const set = new Set(notes);
      const n = inStock.filter(p => (p.flavor_tags_canonical ?? []).some(t => set.has(t.toLowerCase()))).length;
      expect(n, `flavor chip ${key}`).toBeGreaterThan(0);
    }
  });
});
```
  (Export `FLAVOR_FAMILY` from scoring.ts if not already, for this test.)
- [ ] **Step 2: Run, confirm PASS** (proves no chip is a credible dead end). `npx vitest run lib/finder/__tests__/chip-coverage.test.ts`
- [ ] **Step 3: Full suite + build.** `npx vitest run` (all pass) then `NODE_OPTIONS=--max-old-space-size=4096 npm run build` (succeeds).
- [ ] **Step 4: Browser (Rule 7).** Kill stale :3100 (`lsof -ti:3100 | xargs kill -9`), `npm run start`, then on `http://localhost:3100`:
  - Finder food sub-step (occasion=food) shows the iconed cuisine+dish chips (Thai 🌶️, Sushi 🍣, …).
  - Deep-dive flavor step shows the 12 iconed family chips.
  - Picking **Thai** → non-empty result; picking **dark-fruit** flavor → non-empty result (was dead before).
  - Category cards + occasion/budget/body chips show icons.
  - Margin-leak grep on a result page = 0: `curl -s ".../finder/result?cat=red&fl=dark-fruit" | grep -ci "margin\|b2b\|enrichment"`.
- [ ] **Step 5: Commit**
```bash
git add apps/catalog/lib/finder/__tests__/chip-coverage.test.ts apps/catalog/lib/finder/scoring.ts
git commit -m "test(finder): no-dead-chip data invariant + verify richer iconed chips end-to-end (Rule 7)"
```

---

## Notes for the implementer
- **Tokens are the contract.** A flavor chip's `token` (question-config) MUST equal its `FLAVOR_FAMILY` key (scoring) MUST equal what the codec stores in `Answers.flavorChips`. Food chip `token` = `FOOD_CHIPS` key = what `Answers.food` stores. Any drift = a dead/inert chip.
- **Read `flavor_tags_canonical`, never `flavor_tags`, for flavor scoring** (Task 1 adds it to the allowlist; Task 3 uses it).
- **Additive discipline:** the flavor term still feeds tasteScore/degraded exactly as before — fixing it makes more products well-matched (a correctness improvement), verified by the existing degraded tests staying green + the core-only guard.
- **Icons are decorative** → `aria-hidden`; never the only label.
- `git add` ONLY the listed files per task (a parallel session edits this repo); never `git add -A`.
