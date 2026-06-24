# Finder Sommelier Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Extend the proven Phase-1 finder model (plain-language Layer-1 → sommelier brain → archetype → result with band + Buy/Enquire) to the remaining categories — **rosé, sparkling, gin, spirits-by-type, sake** — plus the opt-in **Layer-2 "Refine like a sommelier"**.

**Architecture:** Phase 1 made everything DATA-driven, so Phase 2 is mostly **additive wiring**: populate `FEEL_TO_ARCHETYPE[cat]`, add a `<CAT>_FEEL_STEP` to `question-config.ts`, add a per-category scoring branch. Only **rosé** needs structural additions (new `FinderCategory` member + `CATEGORY_MAP` rule + 2 archetypes + landing card). Build on verified IN-STOCK data (checked 2026-06-24 on current main export).

**Tech Stack:** Next.js + TS + Vitest in `apps/catalog`. Pure data/functions in `lib/finder/`.

**Spec:** `docs/superpowers/specs/2026-06-24-finder-sommelier-redesign-design.md` (§5.3–§5.8 per-category; §11 corrections; §12 phasing).

**VERIFIED in-stock data (current main export):**
- Rosé 95: acidity/body/variety/flavor 95/95; **sweetness 0/95** → lead body/acidity, NOT sweetness.
- Sparkling 411: sweetness 395 but 86% "Dry" → lead on STYLE, dosage = refine only.
- Gin 169: flavor 166, body 120 → classic/modern + botanical leaning.
- Spirits 588: Rum 114, Tequila 101, Vodka 76, Brandy 68, Cognac 15 → branch by `category_type`.
- Sake/Shochu 315: **class in structured `variety` 266/315** (Junmai Ginjo 78, Junmai 70, Junmai Daiginjo 48, Honjozo 27) → read variety; lead on aroma + serve.

**DEFENSIVE NOTE:** the taste-data audit (PR #54) will later correct sparkling Extra-Dry→Off-Dry + smokiness flips. Build so missing/legacy values degrade to neutral (never crash, never assert from absent data); corrections then slot in with no code change.

**Existing archetypes (reuse):** sparkling: `fresh-festive-sparkling`, `fine-traditional-sparkling`. gin: `classic-juniper-gin`, `contemporary-botanical-gin`. spirits: `clean-versatile-vodka`, `warm-aged-spirit`. sake: `crisp-dry-sake`, `fragrant-sweet-sake`. **NEW needed:** rosé ×2; spirits per-type (rum/tequila/brandy archetypes) as needed.

---

## Task 1: Sparkling Layer-1 (style-led)

**Files:** `lib/finder/taste-feel.ts`, `question-config.ts`, `scoring.ts`, tests.

Sparkling rungs (§5.4): `festive`→`fresh-festive-sparkling` (Prosecco/light/fun), `fine`→`fine-traditional-sparkling` (Champagne-method/fine). Lead on style; dosage is Layer-2.

- [ ] **Step 1: Tests** — `feelToArchetype('sparkling','festive')==='fresh-festive-sparkling'`; sparkling Layer-1 has a no-jargon tasteFeel step (festive/fine/unsure); add to no-jargon.test.ts + taste-feel.test.ts.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — `FEEL_TO_ARCHETYPE.sparkling = { festive:'fresh-festive-sparkling', fine:'fine-traditional-sparkling' }`; add `SPARKLING_FEEL_STEP` (title:'What’s the vibe?', festive='Light & fun' 🎉, fine='Fine & classic' ✨, unsure='Not sure — guide me' 🤷); set `QUESTION_CONFIG.sparkling = [OCCASION, BUDGET, SPARKLING_FEEL_STEP, FLAVOR]`. Scoring: sparkling tasteFeel maps via archetype `definingAttributes` (body/acidity) using the existing `tasteFeelScore` path — confirm sparkling has usable definingAttributes; if thin, score lightly (style is mostly archetype-resolution + flavor/food).
- [ ] **Step 4: GREEN + full `lib/finder` suite.**
- [ ] **Step 5: Commit** `feat(finder): sparkling plain-language Layer-1 (style-led)`

---

## Task 2: Gin Layer-1 (classic/modern + serve)

**Files:** same set.

Gin rungs (§5.6): `classic`→`classic-juniper-gin`, `modern`→`contemporary-botanical-gin`.

- [ ] **Step 1: Tests** — `feelToArchetype('gin','classic')==='classic-juniper-gin'`; gin Layer-1 no-jargon feel step (classic/modern/unsure).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — `FEEL_TO_ARCHETYPE.gin = { classic:'classic-juniper-gin', modern:'contemporary-botanical-gin' }`; `GIN_FEEL_STEP` (title:'Classic or modern?', classic='Classic & junipery' 🍸, modern='Modern & aromatic' 🌿, unsure='Not sure — guide me' 🤷); `QUESTION_CONFIG.gin = [OCCASION, BUDGET, GIN_FEEL_STEP, FLAVOR]`. Scoring: gin already has `ginStyleBump` keyed on `a.axis1` classic/contemporary — REWIRE it to read `a.tasteFeel` (classic/modern) instead, OR map tasteFeel→the tokens it expects. Keep existing gin keyword logic. Update/adapt any existing gin scoring test (Rule 5 comment).
- [ ] **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** `feat(finder): gin plain-language Layer-1 (classic/modern)`

---

## Task 3: Spirits — branch by type + per-type feel

**Files:** same set + maybe new archetypes in `style-profiles.ts`.

Spirits (§5.7): Layer-1 asks TYPE first (rum/tequila/vodka/brandy/cognac via `category_type`), then a plain type feel. Existing `SPIRITS_TYPE_TO_TYPE` (axis1→category_type) is the type gate — keep it.

- [ ] **Step 1: Tests** — spirits Layer-1 first step asks type (tokens rum/tequila/vodka/brandy); a rum + 'aged' feel resolves to an aged-spirit archetype; type scoring still works (read existing spirits scoring test).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — Decide the minimal archetype set: reuse `warm-aged-spirit` (aged rum/tequila/brandy) + `clean-versatile-vodka` (vodka/blanco/light). If a finer split is cheap, add 1–2 archetypes (e.g. `bright-agave-tequila`, `rich-sipping-cognac`) — only if each maps to ≥3 in-stock bottles (Cognac=15, fine). Keep TYPE the first question (axis1, existing `SPIRITS_TYPE_TO_TYPE`). Add ONE generic per-type feel step ("How do you want it?" light/smooth/rich + unsure) writing `tasteFeel` — avoid 5 bespoke steps unless misleading.
  ⚠️ **Spirits feel scoring is NET-NEW** — do NOT reuse `tasteFeelScore` (red/white-only). Write a new `spiritsFeelScore(a, p)` that nudges POSITIVE-only via text age/grade markers (reposado/añejo/vsop/xo/aged/spiced) in `p.name`/`p.desc_en_short` for `light`/`smooth`/`rich`/`aged` feels; missing→neutral. Additive in `deepDiveBump` (rank-only) is fine. Keep `QUESTION_CONFIG.spirits` = [OCCASION, BUDGET, TYPE_STEP, FEEL_STEP, FLAVOR]. Map the generic feel→archetype in `FEEL_TO_ARCHETYPE.spirits` ({ light/smooth:'clean-versatile-vodka', rich/aged:'warm-aged-spirit', + any new ones }).
- [ ] **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** `feat(finder): spirits branch-by-type + plain feel`

---

## Task 4: Sake — aroma + serve, class from structured variety

**Files:** same set.

Sake (§5.8 + §11.2): Layer-1 = sub-type (sake/shochu/umeshu via category_type) then **aroma** (fragrant↔clean) + **serve** (chilled/warm). DROP dry/sweet from Layer-1 (kept as Layer-2 refine — see Task 6). Read CLASS from structured `variety` (Junmai/Ginjo…), NOT text.

- [ ] **Step 1: Tests** — `feelToArchetype('sake','fragrant')==='fragrant-sweet-sake'` (or the aroma-appropriate archetype); sake Layer-1 no-jargon (no 'junmai'/'ginjo' in labels) with aroma tokens; a sake with `variety:'Junmai Ginjo'` scores toward the fragrant archetype.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — `FEEL_TO_ARCHETYPE.sake = { fragrant:'fragrant-sweet-sake', clean:'crisp-dry-sake' }`; `SAKE_FEEL_STEP` (title:'Light & fragrant or clean & dry?', fragrant='Fragrant & fruity' 🌸, clean='Clean & dry' 💧, unsure='Not sure — guide me' 🤷) + a `SAKE_SERVE_STEP` (chilled/warm/either, writes a new optional answer field `serve`).
  ⚠️ **`serve` field needs the FULL 4-site wiring** (same as tasteFeel got): (1) `serve?: string` on the `Answers` interface; (2) `encodeAnswers` `set('sv', a.serve)`; (3) `decodeAnswers` `serve: sp.get('sv') ?? undefined`; (4) **`ChoiceCards.tsx` `applyField` switch — add `case 'serve':`** (omitting this = the step writes NOTHING; this exact omission previously caused a "deep-dive collected zero answers" bug — see the comment in ChoiceCards). Add `'serve'` to `StepField`.
  ⚠️ **Sake aroma scoring is NET-NEW** — do NOT reuse `tasteFeelScore` (it is hard-gated to red/white via `TASTE_FEEL_CATEGORIES` and scores body/tannin/acidity, NOT variety). Write a new `sakeAromaScore(a, p)` that reads structured `variety`: Junmai Ginjo / Junmai Daiginjo / Ginjo / Daiginjo → fragrant; Junmai / Honjozo → clean; boost when it matches `a.tasteFeel`. Wire it into `scoreProducts` (additive, rank-only is fine; or into the taste tier if you want it to gate `degraded` — match how white does it). Confirm `hadTasteSignal` already counts a set `tasteFeel` (it does, generically) and that `serve` is intentionally NOT a taste signal.
  Sub-type step (sake/shochu/umeshu) via existing axis1/category_type. Keep the existing `sakeSweetness` (taste_profile.axes) path for the Layer-2 dry/sweet refine, unchanged.
- [ ] **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** `feat(finder): sake aroma+serve Layer-1 (class from structured variety)`

---

## Task 5: Rosé — NEW category

**Files:** `answers.ts` (add 'rose' to FinderCategory), `category-map.ts` (rule), `style-profiles.ts` (2 archetypes), `taste-feel.ts`, `question-config.ts`, `scoring.ts`, `app/finder/page.tsx` (landing card), tests.

Rosé (§5.3 + §11.3): lead on BODY/ACIDITY (sweetness is 0/95). 2 archetypes: `crisp-dry-rose` (Provence: Dry, High acidity, Light), `fruity-easy-rose` (New-World: riper, fuller).

- [ ] **Step 1: Tests** — `CATEGORY_MAP.rose` matches `category_type==='rosé wine'`; `feelToArchetype('rose','crisp')==='crisp-dry-rose'`; rosé Layer-1 no-jargon (crisp/fruity/unsure); a rosé with body='Light',acidity='High' ranks toward crisp-dry-rose.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — add `'rose'` to `FinderCategory` (answers.ts). ⚠️ Adding it surfaces tsc errors on the 7 TYPED maps, but TWO load-bearing spots are RUNTIME arrays tsc will NOT flag — miss them and `cat=rose` silently dies at decode. Resolve ALL NINE explicitly:
  **Typed (tsc will flag):** 1) `taste-feel.ts` `FEEL_TO_ARCHETYPE` → `{ crisp:'crisp-dry-rose', fruity:'fruity-easy-rose' }`; 2) `taste-feel.ts` `CROWD_PLEASER` → `'fruity-easy-rose'`; 3) `shop-links.ts` `CATEGORY_SCOPE` → `{group:'Wine', classValue:'Rosé Wine'}` (match existing wine entries); 4) `shop-links.ts` `CATEGORY_LABEL` → `'Rosé'`; 5) `question-config.ts` `QUESTION_CONFIG` → `[OCCASION, BUDGET, ROSE_FEEL_STEP, FLAVOR]`; 6) `question-config.ts` `DEEP_DIVE_CONFIG` → rosé deep-dive (e.g. `[WINE_ACIDITY_STEP, ADVENTURE_STEP]` or a small set — keep short); 7) `category-map.ts` `CATEGORY_MAP` → `{ group:'Wine', match:(p)=>ctype(p)==='rosé wine' }` (exact token verified: `category_type` is `'Rosé Wine'`, 182 rows; `ctype` lowercases it).
  **Runtime (tsc will NOT flag — DO NOT skip):** 8) `answers.ts:23` `const CATEGORIES: FinderCategory[]` array → add `'rose'` (else `decodeAnswers` rejects `cat=rose` → undefined → result redirects); 9) `app/finder/page.tsx` landing `CATEGORIES` array → add a rosé card.
  (NOTE: the `ChoiceCards` switch is on the answer FIELD name, NOT FinderCategory — it needs NO change for rosé. Don't hunt it.)
  Then: add 2 archetypes to STYLE_PROFILES (`crisp-dry-rose`, `fruity-easy-rose`) with proper `expertNote`/`definingAttributes`(body/acidity)/`foodGuidance`/`match`. `ROSE_FEEL_STEP` (crisp='Crisp & dry' 🌸, fruity='Fruity & soft' 🍓, unsure='Not sure — guide me' 🤷). Scoring: extend `TASTE_FEEL_CATEGORIES` (scoring.ts:400) to include `'rose'` and ensure `tasteFeelScore` reads body+acidity (rosé archetypes carry those) — verify rosé scores via that path (it's acidity/body, same shape as white, so reuse IS valid here, unlike sake).
- [ ] **Step 4: GREEN + suite + `npx tsc --noEmit` clean (exhaustiveness).**
- [ ] **Step 5: Commit** `feat(finder): add Rosé category (body/acidity-led, 2 archetypes)`

---

## Task 6: Layer-2 "Refine like a sommelier" (opt-in)

**Files:** `question-config.ts` (deepDiveStepsFor already exists!), `components/finder/*` (a "Go deeper" affordance), `scoring.ts` (already scores deep-dive fields), tests.

⚠️ **MOST of this already ships** (verified): `deepDiveStepsFor` exists; `app/finder/[step]/page.tsx` already reads `deep=1`, appends deep-dive steps, and renders a **"Refine like a sommelier →" CTA** (line ~152) at the core→deep transition; scoring already adds deep-dive bumps additively (layers onto Layer-1, doesn't reset). So Task 6 is NARROW: **add + render explainers**, and verify the existing CTA. Do NOT rebuild the CTA/flow.

- [ ] **Step 1: Tests** — a deep-dive `QuestionStep` with a `hint` renders the explainer text; the existing "Refine like a sommelier" CTA is present at the core→deep transition (assert it renders); refining preserves prior answers (already true — assert the query carries them).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — add optional `hint?: string` to the `QuestionStep` interface; populate hints on the deep-dive steps in `DEEP_DIVE_CONFIG` (one plain "what's this?" line each — e.g. tannin: "the grippy, drying feel in big reds"); render `hint` in the step UI (StepShell/ChoiceCards) when present. Confirm the existing `/finder/[step]?...&deep=1` CTA still works and the new Phase-2 categories (which now have `DEEP_DIVE_CONFIG` entries from Task 5 etc.) surface their deep-dive steps. Small, additive.
- [ ] **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** `feat(finder): surface Layer-2 'Refine like a sommelier' with explainers`

---

## Task 7: Coverage + full build green

- [ ] **Step 1:** Extend `coverage.test.ts` — the `FEELS` map currently has empty `[]` placeholders for sparkling/gin/spirits/sake and NO `rose` key, and the loop runs only `['red','white','whisky']`. FILL every Phase-2 category's feel tokens (sparkling: festive/fine/unsure; gin: classic/modern/unsure; spirits: light/smooth/rich/unsure; sake: fragrant/clean/unsure; rose: crisp/fruity/unsure) AND extend the loop to all 8 categories incl `rose`. Assert each → ≥3 in-stock bottles (no dead ends). Without this the "no dead ends" guarantee silently skips the new categories.
- [ ] **Step 2:** `npx vitest run lib/finder components/finder` → all green.
- [ ] **Step 3:** `npm run build` → succeeds (232+ pages).
- [ ] **Step 4: Commit** `test(finder): Phase-2 coverage + full suite green`

---

## Task 8: Rule-7 browser verification (REQUIRED)

- [ ] Start dev (:3100, `rm -rf .next` if needed).
- [ ] Walk EACH new category novice path: rosé crisp, sparkling festive, gin classic, spirits rum/aged, sake fragrant — result renders right archetype + bottles + band + Buy/Enquire.
- [ ] Walk the all-neutral path per category → crowd-pleaser + "Good match".
- [ ] Walk Layer-2 "Refine like a sommelier" → deep-dive steps render with explainers, refine sharpens the result.
- [ ] Mobile viewport sanity. Record findings; fix; re-verify.

---

## Task 9: Code review + ship

- [ ] `/code-review` (or requesting-code-review) on the full diff vs main.
- [ ] Address findings (receiving-code-review — verify, don't blind-apply).
- [ ] PR; Vercel preview green (catalog + new.mgfdev.com); merge.

---

## Notes
- Keep `lib/finder/*` pure. Phase 2 must not regress Phase-1 categories (red/white/whisky) — full suite green each task.
- Adding `'rose'` to FinderCategory will surface exhaustiveness errors — resolve every one (that's the type system doing its job).
- Don't build i18n; EN-first + inline Thai where present. No cart — Buy/Enquire only.
- Spirits: prefer ONE generic per-type feel step over 5 bespoke steps unless misleading.
