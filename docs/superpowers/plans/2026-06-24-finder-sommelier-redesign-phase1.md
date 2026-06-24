# Finder Sommelier Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the "Find Your Match" finder for **red, white, and whisky** so a novice answers plain-language questions, a deterministic "sommelier brain" maps them to the correct archetype, and the result page proves the match and lets them buy — with verified-correct taste logic.

**Architecture:** Build on the existing pure-function finder (`lib/finder/*`). Questions, plain→technical mappings, and archetypes are DATA (config tables) so Phase 2 categories drop in without a rewrite. The brain reads structured fields the spec verified reach the export (`body`, `acidity`, `tannin`, `smokiness`, `variety`, `region`). No paid enrichment. No i18n framework (EN-first, inline Thai kept where present).

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest, in `apps/catalog`. Pure data + pure functions in `lib/finder/`; React in `components/finder/` + `app/finder/`.

**Spec:** `docs/superpowers/specs/2026-06-24-finder-sommelier-redesign-design.md` (esp. §11 corrections + §12 locked decisions).

**Scope (Phase 1 only):** red, white, whisky. Conversion essentials IN: Buy/Enquire (LINE/WhatsApp/Messenger — no cart), all-neutral "crowd-pleaser" path, banded match labels, out-of-stock fallback, "see more" → /shop. Phase 2 (rosé/sparkling/gin/spirits/sake + Layer-2 refine) is OUT.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/finder/taste-feel.ts` | NEW. The "sommelier brain": plain taste-feel token → category archetype id + axis hints. Pure data + resolver. | Create |
| `lib/finder/question-config.ts` | Layer-1 plain-language steps (red/white/whisky). Strip jargon. | Modify |
| `lib/finder/answers.ts` | Add `tasteFeel` field + encode/decode. | Modify |
| `lib/finder/scoring.ts` | Fix peat (smokiness, positive-only + allow-list); gate grape to wine; remove classification from ginStyleBump; emit match band + reason. | Modify |
| `lib/finder/style-profiles.ts` | Correct red mapping (smooth=Supple, not Bright); add crowd-pleaser archetype per category. | Modify |
| `lib/finder/match-band.ts` | NEW. Raw score → band label ("Great/Strong/Good match") with honesty floor. Pure. | Create |
| `lib/finder/peated-distilleries.ts` | NEW. Allow-list of known-peated distillery name tokens (Talisker/Ledaig/Laphroaig/Ardbeg/Lagavulin…). | Create |
| `components/finder/StyleResult.tsx` | Result hero: archetype + plain why + gauges + banded bottles + Buy/Enquire (ContactButtons) + "see more". | Modify |
| `app/finder/page.tsx` | Cross-category entry for novices ("not sure what" → suggest). | Modify |
| `lib/finder/__tests__/*` | Unit tests for every mapping + no-jargon + coverage + regression. | Create/Modify |

---

## Task 1: `tasteFeel` answer field

**Files:**
- Modify: `apps/catalog/lib/finder/answers.ts`
- Test: `apps/catalog/lib/finder/__tests__/answers.test.ts`

- [ ] **Step 1: Write failing test** — `tasteFeel` round-trips through encode/decode.

```typescript
import { encodeAnswers, decodeAnswers } from '../answers';

test('tasteFeel round-trips via URL params', () => {
  const enc = encodeAnswers({ category: 'red', tasteFeel: 'bold' });
  const dec = decodeAnswers(new URLSearchParams(enc));
  expect(dec.tasteFeel).toBe('bold');
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run lib/finder/__tests__/answers.test.ts` → fails (no `tasteFeel`).

- [ ] **Step 3: Implement** — in `answers.ts`: add `tasteFeel?: string;` to `Answers`; in `encodeAnswers` add `if (a.tasteFeel) p.set('tf', a.tasteFeel);`; in `decodeAnswers` add `tasteFeel: sp.get('tf') ?? undefined` to the returned object.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(finder): add tasteFeel answer field"`

---

## Task 2: The sommelier brain — `taste-feel.ts` (red)

**Files:**
- Create: `apps/catalog/lib/finder/taste-feel.ts`
- Test: `apps/catalog/lib/finder/__tests__/taste-feel.test.ts`

Implements spec §11.1: body and tannin are SEPARATE; map feel to body primarily, tannin as soft nudge. Three red rungs:
`light` → `bright-elegant-red`; `smooth` → `supple-everyday-red`; `bold` → `bold-structured-red`.

- [ ] **Step 1: Write failing test**

```typescript
import { feelToArchetype } from '../taste-feel';

test('red taste-feel maps to the CORRECT archetype (smooth != light)', () => {
  expect(feelToArchetype('red', 'light')).toBe('bright-elegant-red');
  expect(feelToArchetype('red', 'smooth')).toBe('supple-everyday-red'); // NOT bright/light
  expect(feelToArchetype('red', 'bold')).toBe('bold-structured-red');
});

test('unknown / not-sure feel returns null (caller falls back to crowd-pleaser)', () => {
  expect(feelToArchetype('red', 'unsure')).toBeNull();
  expect(feelToArchetype('red', undefined)).toBeNull();
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — pure data + lookup:

```typescript
import type { FinderCategory } from './answers';

// Plain taste-feel token → archetype id. Body and tannin are SEPARATE axes (spec §11.1):
// 'smooth' is soft-tannin/medium-full (Supple), NOT light-bodied (Bright). 'unsure'/missing
// is intentionally absent → resolver returns null → caller uses the crowd-pleaser (§11.7).
const FEEL_TO_ARCHETYPE: Record<FinderCategory, Record<string, string>> = {
  red:   { light: 'bright-elegant-red', smooth: 'supple-everyday-red', bold: 'bold-structured-red' },
  white: {},     // Task 6
  whisky: {},    // Task 7
  sparkling: {}, gin: {}, spirits: {}, sake: {}, // Phase 2
};

export function feelToArchetype(cat: FinderCategory, feel: string | undefined): string | null {
  if (!feel) return null;
  return FEEL_TO_ARCHETYPE[cat]?.[feel] ?? null;
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(finder): sommelier brain — red taste-feel→archetype (smooth=Supple, body/tannin decoupled)"`

---

## Task 3: Crowd-pleaser archetype + all-neutral fallback (§11.7)

**Files:**
- Modify: `apps/catalog/lib/finder/style-profiles.ts`
- Modify: `apps/catalog/lib/finder/taste-feel.ts`
- Test: `apps/catalog/lib/finder/__tests__/taste-feel.test.ts`

- [ ] **Step 1: Write failing test** — when feel is null, resolver returns the category's crowd-pleaser with an honest "why".

```typescript
import { resolveArchetypeId, CROWD_PLEASER } from '../taste-feel';

test('all-neutral red resolves to crowd-pleaser, not arbitrary', () => {
  expect(resolveArchetypeId('red', undefined)).toBe(CROWD_PLEASER.red);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — in `taste-feel.ts`:

```typescript
// Honest default when no taste signal (§11.7): a broadly-liked style per category.
export const CROWD_PLEASER: Record<FinderCategory, string> = {
  red: 'supple-everyday-red', white: 'aromatic-balanced-white', whisky: 'smooth-irish-whiskey',
  sparkling: 'fresh-festive-sparkling', gin: 'classic-juniper-gin',
  spirits: 'clean-versatile-vodka', sake: 'crisp-dry-sake',
};
export function resolveArchetypeId(cat: FinderCategory, feel: string | undefined): string {
  return feelToArchetype(cat, feel) ?? CROWD_PLEASER[cat];
}
```

In `style-profiles.ts`, ensure each crowd-pleaser archetype's `expertNote` reads acceptably as a default ("a crowd-pleasing, easy-to-love style"). No new archetypes needed for P1 — reuse existing supple/aromatic/smooth-irish.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(finder): all-neutral crowd-pleaser fallback (honest default)"`

---

## Task 4: Red Layer-1 plain questions (no jargon)

**Files:**
- Modify: `apps/catalog/lib/finder/question-config.ts`
- Test: `apps/catalog/lib/finder/__tests__/no-jargon.test.ts` (create)

Replace red's `WINE_BODY_STEP`/`WINE_CHARACTER_STEP` with ONE plain taste-feel step writing `tasteFeel` (light/smooth/bold + "not sure"). Keep occasion/budget/flavor/food shared.

- [ ] **Step 1: Write failing no-jargon test**

```typescript
import { stepsFor } from '../question-config';
const BANNED = ['tannin','acidity','dosage','junmai','ginjo','vsop','peat','body-'];
test('red Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('red').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('red Layer-1 has a taste-feel step with light/smooth/bold + not sure', () => {
  const feel = stepsFor('red').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['light','smooth','bold','unsure']));
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — add a `tasteFeel` to `StepField`; add:

```typescript
const RED_FEEL_STEP: QuestionStep = {
  id: 'taste-feel', field: 'tasteFeel', title: 'How do you like your reds?',
  optional: true,
  options: [
    { token: 'light',  label: 'Light & delicate', icon: '🪶' },
    { token: 'smooth', label: 'Smooth & easygoing', icon: '🍷' },
    { token: 'bold',   label: 'Bold & rich', icon: '🔥' },
    { token: 'unsure', label: "Not sure — guide me", icon: '🤷' },
  ],
};
const RED_STEPS: QuestionStep[] = [OCCASION_STEP, BUDGET_STEP, RED_FEEL_STEP, FLAVOR_STEP];
```
Wire `QUESTION_CONFIG.red = RED_STEPS`.

**Food handling — IMPORTANT (there is NO `FOOD_STEP` constant today):** Food is captured by
the existing inline `FoodChoice.tsx` sub-step, triggered when `occasion==='food'` and written
to `answers.food` by `ChoiceCards.tsx` — NOT by a step in `QUESTION_CONFIG`. Do NOT invent a
`FOOD_STEP`. Phase 1 keeps the existing food mechanism as-is; the brain/scoring reads
`answers.food` where present (it already does via the food-pairing path). The cross-category
entry (Task 11) is where food explicitly routes a novice to a category. So red's journey is
the 4 steps above; food flows through the existing conditional sub-step.

- [ ] **Step 4: Run, verify PASS** (no-jargon + taste-feel tests).

- [ ] **Step 5: Commit** — `git commit -m "feat(finder): red plain-language Layer-1 (no jargon, taste-feel)"`

---

## Task 5: Wire red scoring to the brain + archetype resolution

**Files:**
- Modify: `apps/catalog/lib/finder/scoring.ts`
- Test: `apps/catalog/lib/finder/__tests__/scoring.test.ts`

Make the resolved-archetype path drive ranking: a `tasteFeel='bold'` red should rank Full-body/Med-High-tannin bottles above Light ones; `smooth` should rank soft-tannin medium-full above gripping ones. Read `body`/`tannin` from the product (already available).

- [ ] **Step 1: Write failing test** with 3 fixture reds (light, supple, bold) asserting order per feel. (Mirror existing scoring.test.ts fixtures.)
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3a: Verify `definingAttributes` carries comparable tokens** — open `style-profiles.ts` and confirm the red archetypes' `definingAttributes.body`/`.tannin` are scale tokens ("Full"/"Medium-High"), not prose. If prose-only, instead add an explicit `RED_FEEL_TARGET: Record<string,{body:string;tannin?:string}>` table in `taste-feel.ts` and score against THAT (don't depend on prose).
- [ ] **Step 3: Implement** — translate `tasteFeel` → target body/tannin (via `definingAttributes` or the explicit target table from 3a); add to the score using existing `ladderScore`/`bodyLadderDistance`. Do NOT intersect Light-body AND Low-tannin (§11.1 — only 10 low-tannin reds in stock); body primary, tannin soft nudge.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(finder): red scoring driven by taste-feel→archetype (body primary, tannin nudge)"`

---

## Task 6: White category (plain feel + correct mapping)

**Files:** `taste-feel.ts`, `question-config.ts`, `scoring.ts`, tests.

White rungs (§11.2 + somm note): `crisp`→`crisp-zesty-white` (High acidity/Light); `rounded`→`rich-textured-white` (Full/oak) — NOT steely Riesling; `aromatic`→`aromatic-balanced-white`. Lead on **acidity**, not sweetness.

- [ ] **Step 1: Test** — `feelToArchetype('white','crisp')==='crisp-zesty-white'`; white Layer-1 has no-jargon feel step (crisp/rounded/aromatic/unsure); scoring orders by acidity/body.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — populate `FEEL_TO_ARCHETYPE.white`; add `WHITE_FEEL_STEP`; wire `QUESTION_CONFIG.white`; extend scoring (white reads `acidity`+`body`).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(finder): white plain-language journey (acidity-led, correct mapping)"`

---

## Task 7: Whisky — plain feel + smokiness positive-only + allow-list (§11.8)

**Files:**
- Create: `apps/catalog/lib/finder/peated-distilleries.ts`
- Modify: `taste-feel.ts`, `question-config.ts`, `scoring.ts`
- Test: `__tests__/peat.test.ts` (create), `scoring.test.ts`

Whisky rungs: `smooth`→`smooth-irish-whiskey`/`refined-japanese-whisky`; `rich`→`sweet-bold-bourbon`; `smoky`→`peated-coastal-whisky`. Origin question stays.

- [ ] **Step 1: Write failing test (the false-negative guard)**

```typescript
import { isLikelyPeated } from '../peated-distilleries';
test('known peated distilleries detected by name even when smokiness=none', () => {
  expect(isLikelyPeated('Talisker  10 Years (700 ml)')).toBe(true);   // export tags this 'none'
  expect(isLikelyPeated('Provenance  Ledaig 7 Years')).toBe(true);
  expect(isLikelyPeated('Glenfiddich 12')).toBe(false);
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** `peated-distilleries.ts`:

```typescript
const PEATED = ['talisker','ledaig','laphroaig','ardbeg','lagavulin','caol ila','kilchoman','octomore','bowmore','bunnahabhain'];
export function isLikelyPeated(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return PEATED.some(d => n.includes(d));
}
```

Then in `scoring.ts` `peatScore` (currently `region==='islay'`): for `tasteFeel==='smoky'`, boost when `p.smokiness==='heavy' || isLikelyPeated(p.name)`. Do NOT penalize/exclude on `smokiness==='none'` (it has false negatives). Do NOT assert "smooth" from `none`. Never fall back to `region`.

- [ ] **Step 4: Run, verify PASS** (peat + scoring).

- [ ] **Step 5: Commit** — `git commit -m "feat(finder): whisky smoky = real smokiness + peated allow-list (fixes Talisker/Ledaig false-neg)"`

---

## Task 8: Grape gate to wine + remove classification from ginStyleBump (§6.3, §6.5)

**Files:** `scoring.ts`, `__tests__/scoring.test.ts`

- [ ] **Step 1: Test** — `grapeScore` returns 0 for a spirit whose `variety` looks grape-like (e.g. Vodka variety "Ugni Blanc"); ginStyleBump no longer reads `classification`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — gate grape scoring on `category_group==='Wine'` (via `groupForProduct`); in `ginStyleBump` change `[p.name, p.classification, ...]` → `[p.name, p.desc_en_short, ...]`.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "fix(finder): gate grape to wine; drop classification from ginStyleBump (Rule 12)"`

---

## Task 9: Match bands (§11.9)

**Files:**
- Create: `apps/catalog/lib/finder/match-band.ts`
- Test: `__tests__/match-band.test.ts`

- [ ] **Step 1: Test** — top raw score → 'Great match'; mid → 'Strong'; low/all-neutral → 'Good match' (never 'Great' when no taste signal contributed).

```typescript
import { matchBand } from '../match-band';
test('bands map score + signal honestly', () => {
  expect(matchBand({ score: 9, maxScore: 10, hadTasteSignal: true })).toBe('Great match');
  expect(matchBand({ score: 5, maxScore: 10, hadTasteSignal: true })).toBe('Strong match');
  expect(matchBand({ score: 9, maxScore: 10, hadTasteSignal: false })).toBe('Good match'); // no taste signal → capped
});
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — pure function: ratio = score/maxScore; if `!hadTasteSignal` cap at 'Good match'; else ≥0.75→Great, ≥0.45→Strong, else Good.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(finder): honest banded match labels (no fake %)"`

---

## Task 10: Result hero — archetype + why + bands + Buy/Enquire + see-more (§11.5, §7)

> **CRITICAL — there is NO cart in this catalog.** Verified: zero cart/`addToCart` code in
> `apps/catalog`. The storefront converts via **contact deep-links** (LINE / WhatsApp /
> Messenger): `lib/contact.ts` `buildContactLinks(env, {name, sku})` → `<ContactButtons
> links={...} />` (used on `ProductCard`/`QuickView`). WhatsApp pre-fills *"I'm interested in
> {name} — {sku}"*. The result's primary per-bottle CTA is **"Buy / Enquire"** using THIS
> mechanism — NOT a cart. Do not build a cart (out of scope; large).

**Files:**
- Modify: `apps/catalog/components/finder/StyleResult.tsx`
- Modify: `apps/catalog/app/finder/result/page.tsx`
- Reuse (read, don't modify): `apps/catalog/lib/contact.ts`, `apps/catalog/lib/contact-env.ts`, `apps/catalog/components/ContactButtons.tsx`
- Test: `components/finder/__tests__/StyleResult.test.tsx` (create if absent; else extend)

- [ ] **Step 0: Read the contact mechanism** — `lib/contact.ts` (`buildContactLinks`, `ContactProduct={name,sku}`, `ContactLinks={line,whatsapp,facebook}`), `contact-env.ts` (how env handles are read server-side), and how `ProductCard.tsx`/`QuickView.tsx` render `<ContactButtons>`. Mirror that exact pattern.
- [ ] **Step 1: Write failing test** — StyleResult renders: archetype name; a "Why this fits you" line; for each of up to 3 bottles a **band label** (from Task 9) + a **Buy / Enquire** affordance (assert the bottle exposes contact links — e.g. a WhatsApp `wa.me` href containing the SKU, or a ContactButtons render); a "See more like this" link to /shop; out-of-stock bottles filtered or labelled; **<3 in-stock bottles does not crash** (renders what exists + see-more).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — for each result bottle build `buildContactLinks(env, {name, sku})` (env passed down from the result page server component, same as ProductCard) and render `<ContactButtons links={...} size="sm" />` as the primary CTA; render the band; add a `See more like this` link to `/shop?<archetype facet>` (reuse `shop-links.ts`). Empty/thin pool → render what's in stock + "see more"; never throw.
- [ ] **Step 4: PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(finder): result hero — why + bands + Buy/Enquire (ContactButtons) + see-more"`

---

## Task 11: Cross-category entry for novices (§11.6)

**Files:** `apps/catalog/app/finder/page.tsx`, test.

- [ ] **Step 1: Test** — finder landing offers a "Not sure what you want? Help me choose" path that routes via moment+food to a suggested category.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — add an entry option; simplest viable: a short "what's the moment + what are you eating" → map to a category (e.g. steak→red, oysters→white/sparkling, nightcap→whisky) then enter that category's journey. Keep it data-driven.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(finder): cross-category novice entry (help me choose)"`

---

## Task 12: Full-suite green + coverage test (§9, §11.11)

**Files:** `__tests__/coverage.test.ts` (create), all finder tests.

- [ ] **Step 1: Coverage test** — for red/white/whisky, every plain taste-feel answer (incl. 'unsure') resolves to an archetype with **≥3 in-stock bottles** using the live export (in-stock numbers). Load `data/live_products_export.json`.
- [ ] **Step 2: Run full finder suite** — `npx vitest run lib/finder components/finder` → all PASS.
- [ ] **Step 3: Build** — `npm run build` (catalog) → succeeds (Rule: gate on build, not just tests).
- [ ] **Step 4: Commit** — `git commit -m "test(finder): coverage + full Phase-1 suite green"`

---

## Task 13: Rule-7 browser verification (REQUIRED — not optional)

**Files:** none (manual/automated walkthrough).

- [ ] **Step 1:** Start catalog dev (`npm run dev`, port 3100; `rm -rf .next` if module errors).
- [ ] **Step 2:** Walk each category novice path: red "bold & rich" + steak → result shows Bold & Structured, real bottles, band, Buy/Enquire (WhatsApp pre-fills name+SKU) works, "see more" links to /shop.
- [ ] **Step 3:** Walk the **all-neutral** path (pick "not sure" everywhere) → crowd-pleaser result, honest "why", band = "Good match" (not Great), no crash.
- [ ] **Step 4:** Walk whisky "smoky" → Talisker/Ledaig APPEAR (false-neg fix), no unpeated drams labelled smoky.
- [ ] **Step 5:** Verify mobile viewport (Thailand): steps/result readable, chips wrap, Buy/Enquire tappable.
- [ ] **Step 6:** Record findings; fix any breakage; re-verify. Commit fixes.

---

## Task 14: Code review + finish

- [ ] **Step 1:** Run `/code-review` (or requesting-code-review skill) on the diff vs main.
- [ ] **Step 2:** Address findings (receiving-code-review skill — verify, don't blindly apply).
- [ ] **Step 3:** Open PR; confirm Vercel preview green (catalog + new.mgfdev.com) — the authoritative gate.
- [ ] **Step 4:** Merge; verify the finder live on the preview/prod URL.

---

## Notes for the implementer
- All `lib/finder/*` stays pure (no I/O, no React) — keep it testable.
- Re-confirm export field availability at build time (Rule 1/9): `smokiness`, `body`, `acidity`, `tannin`, `variety` present in `data/live_products_export.json`.
- Phase 2 is additive: populating `FEEL_TO_ARCHETYPE[cat]` + a `<CAT>_FEEL_STEP` + scoring branch per new category. Don't build Phase-2 categories now.
- Existing Thai labels in `question-config.ts` — keep; new copy EN-first.
