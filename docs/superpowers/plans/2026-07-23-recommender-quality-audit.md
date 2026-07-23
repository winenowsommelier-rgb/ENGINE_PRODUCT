# Recommender Quality Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep `apps/catalog/lib/recommender.ts` + `apps/catalog/lib/category-scorer.ts` (the single scoring engine behind every "You might also like" rail) for signals that are currently additive-only but should be hard gates — the same class of bug fixed same-day for wine color — across every product group, and separately review whether the remaining score weights are internally consistent. No fix ships without proof against the real catalog first.

**Architecture:** This is investigate-then-fix work, not a predetermined feature build. The plan has two kinds of tasks: **PROOF tasks** (write a throwaway Node script, run it against `data/live_products_export.json`, record findings — no production code changes) and **FIX tasks** (TDD a gate or weight change, but only for a PROOF task that found a real, user-approved issue). Every PROOF task runs to completion regardless of what it finds — a "no leak found" result is itself the deliverable, not a reason to skip documenting it. FIX tasks are conditional and only exist once a PROOF task's findings are approved.

**Tech Stack:** TypeScript, Vitest, Node (for one-off proof scripts, mirroring the `prove_leak.mjs` pattern already used this session), esbuild (via the existing `gen-recs-cache.mjs` bundling approach for running `.ts` recommender code from a plain `.mjs` script).

**Spec:** `docs/superpowers/specs/2026-07-22-recommender-quality-audit-design.md` — read this first for full rationale; this plan does not repeat it.

---

## Before You Start

Read these once, in this order:
1. `docs/superpowers/specs/2026-07-22-recommender-quality-audit-design.md` (the approved spec — full rationale, non-goals, method)
2. `apps/catalog/lib/recommender.ts` (669 lines) — the scoring engine. Pay attention to `isEligible()` (line 297) and `scoreCandidateDetailed()`.
3. `apps/catalog/lib/category-scorer.ts` (116 lines) — category-specific overrides (`categorySignalPoints`, `regionWeightOverride`).
4. `apps/catalog/lib/co-purchase.ts` (123 lines) — the co-purchase bonus formula.
5. `apps/catalog/lib/__tests__/recommender.test.ts` (733 lines), specifically the `'wine color purity (real catalog, end-to-end invariant)'` block at line 698 — this is the exact pattern every new gate's regression test must follow.

**Ground rule (Iron Law of this plan):** A PROOF task's script is written to `apps/catalog/<scratch-name>.mjs` (repo root of the catalog app, NOT the session scratchpad — it must survive between tasks/subagents in this worktree), run, its output captured into the plan's findings log (Task 0's file), then **deleted** before the task is marked complete. `git status --short apps/catalog/*.mjs` must be empty before any commit. Never commit a proof script.

---

## Task 0: Set Up Findings Log

**Files:**
- Create: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (temporary — deleted in Task 9, never committed)

- [ ] **Step 1: Create the findings log**

```markdown
# Recommender Audit Findings (temporary — delete before final commit)

Evidence bar: named subject SKU + candidate SKU + score breakdown, same as
the wine-color proof (92/2,439 red wines, 165 leaked slots).

## PROOF 1: Whisky smokiness/peat_level
(fill in after Task 1)

## PROOF 2: Gin style
(fill in after Task 2)

## PROOF 3: Tequila/Mezcal agave_aging
(fill in after Task 3)

## PROOF 4: Wine sweetness
(fill in after Task 4)

## PROOF 5: Sake & Asian smokiness sufficiency
(fill in after Task 5)

## PROOF 6: 7 ungapped groups (category_type-only reliance)
(fill in after Task 6)

## PROOF 7: Co-purchase K / SUPPORT_FULL_AT sanity
(fill in after Task 7)

## Weight review notes
(fill in after Task 8)
```

- [ ] **Step 2: Confirm the file is untracked (won't be accidentally committed mid-audit)**

Run: `cd apps/catalog && git status --short RECOMMENDER_AUDIT_FINDINGS.md`
Expected: `?? RECOMMENDER_AUDIT_FINDINGS.md`

No commit for this task — the findings log is a working document, not a deliverable.

---

## Task 1: PROOF — Whisky smokiness/peat_level

**Files:**
- Create (temporary): `apps/catalog/prove_whisky_peat.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 1 section)

**Hypothesis (from spec §4):** Does a heavily-peated whisky's rail ever surface an unpeated one purely on region/price, in a way that reads as a mismatch? Or is the `peat_level` +3 category override (in `category-scorer.ts`) already dominant enough that this doesn't happen in practice (unlike wine color, which was only +1)?

- [ ] **Step 1: Write the proof script**

Base this on the exact pattern used to prove the wine-color leak this session (bundle `recommender.ts` with esbuild, run against `data/live_products_export.json`, call `getRecommendationsWithBands` per subject). Adapt the subject/leak-detection filter to whisky peat level instead of wine color:

```javascript
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const catalogRoot = process.cwd(); // run this FROM apps/catalog
const outfile = path.join(catalogRoot, '.next', 'prove-peat-bundle.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(catalogRoot, 'lib', 'recommender.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
});

const { getRecommendationsWithBands } = await import(outfile);

const exportPath = path.join(catalogRoot, '..', '..', 'data', 'live_products_export.json');
const raw = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
function isInStock(v) { return v === 1 || v === '1' || v === true; }
const all = raw.map((p) => ({ ...p, is_in_stock: isInStock(p.is_in_stock) ? '1' : '0' }));

// Subjects: in-stock Whisky with a HEAVY peat_level (the clearest mismatch case).
const heavyPeat = all.filter(
  (p) => p.category_group === 'Whisky' && p.peat_level === 'heavy' && isInStock(p.is_in_stock)
);
console.log(`Testing ${heavyPeat.length} in-stock heavy-peat whisky subjects...`);

let leakCount = 0, subjectsWithLeak = 0;
const examples = [];
for (const subject of heavyPeat) {
  const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
  // "Leak" here = a candidate whose peat_level is populated and is 'none' or 'light'
  // (i.e. NOT within 1 band of 'heavy' on the SMOKINESS_BANDS scale used elsewhere)
  const leaks = recs.filter(
    (r) => r.product.category_group === 'Whisky' &&
           r.product.peat_level &&
           ['none', 'light'].includes(r.product.peat_level)
  );
  if (leaks.length > 0) {
    subjectsWithLeak++;
    leakCount += leaks.length;
    if (examples.length < 10) {
      examples.push({
        subject: `${subject.sku} | ${subject.name} (peat=${subject.peat_level}, region=${subject.region}, price=${subject.price})`,
        leaks: leaks.map(l => `  -> ${l.product.sku} | ${l.product.name} (peat=${l.product.peat_level}, region=${l.product.region}, price=${l.product.price}) score=${l.score} breakdown=${JSON.stringify(l.scoreBreakdown)}`),
      });
    }
  }
}
console.log(`Subjects with >=1 unpeated/light leak: ${subjectsWithLeak} / ${heavyPeat.length}`);
console.log(`Total leaked slots: ${leakCount}`);
for (const ex of examples) { console.log(ex.subject); console.log(ex.leaks.join('\n')); console.log(); }
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_whisky_peat.mjs`

- [ ] **Step 3: Record the exact output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 1"**

Include the subject/leak counts and at least 2 concrete examples (or "0 leaks found, N subjects tested" if clean).

- [ ] **Step 4: Delete the proof script and bundle artifact**

Run: `cd apps/catalog && rm -f prove_whisky_peat.mjs .next/prove-peat-bundle.mjs`

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_whisky_peat.mjs`
Expected: no output (empty)

No commit for this task (findings log is not committed until Task 9 folds approved findings into permanent tests/memory).

---

## Task 2: PROOF — Gin style with region zeroed

**Files:**
- Create (temporary): `apps/catalog/prove_gin_style.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 2 section)

**Hypothesis (from spec §4):** `regionWeightOverride()` returns 0 for gin (`category-scorer.ts:114`), so region contributes nothing to a gin's score. With region zeroed, does anything else (price/food) let a very different `gin_style` dominate a rail with literally zero style overlap — i.e. does a gin ever get recommended a candidate where `gin_style` differs AND `gin_style` was never even in the score breakdown (meaning the match happened on food/price/popularity alone)?

- [ ] **Step 1: Write the proof script**

Same esbuild-bundle-and-run pattern as Task 1. Subjects: in-stock Gin (`category_type === 'Gin'` or SKU prefix `LGN` per `isGin()` in `lib/finder/category-map.ts` — but for this proof, filter on `category_type === 'Gin'` directly since we're testing `recommender.ts`, not the finder). For each subject with a populated `gin_style`, check every rec: does the candidate have a populated `gin_style` that differs from the subject's, with `breakdown.gin_style` absent (meaning the match won on other signals entirely, not a partial/adjacent style credit — there is no partial credit for gin_style, it's exact-match-or-nothing per `matchField()` in `category-scorer.ts`)?

```javascript
// ...same esbuild bundle setup as Task 1...
const gins = all.filter(
  (p) => p.category_type === 'Gin' && p.gin_style && isInStock(p.is_in_stock)
);
console.log(`Testing ${gins.length} in-stock gin subjects with a populated gin_style...`);
let leakCount = 0, subjectsWithLeak = 0;
const examples = [];
for (const subject of gins) {
  const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
  const leaks = recs.filter(
    (r) => r.product.category_type === 'Gin' &&
           r.product.gin_style &&
           r.product.gin_style !== subject.gin_style
  );
  if (leaks.length > 0) {
    subjectsWithLeak++;
    leakCount += leaks.length;
    if (examples.length < 10) {
      examples.push({
        subject: `${subject.sku} | ${subject.name} (style=${subject.gin_style}, price=${subject.price})`,
        leaks: leaks.map(l => `  -> ${l.product.sku} | ${l.product.name} (style=${l.product.gin_style}, price=${l.product.price}) score=${l.score} breakdown=${JSON.stringify(l.scoreBreakdown)}`),
      });
    }
  }
}
console.log(`Subjects with >=1 cross-style leak: ${subjectsWithLeak} / ${gins.length}`);
console.log(`Total leaked slots: ${leakCount}`);
for (const ex of examples) { console.log(ex.subject); console.log(ex.leaks.join('\n')); console.log(); }
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_gin_style.mjs`

- [ ] **Step 3: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 2"**

- [ ] **Step 4: Delete the proof script and bundle artifact**

Run: `cd apps/catalog && rm -f prove_gin_style.mjs .next/prove-gin-bundle.mjs` (adjust bundle filename to whatever `outfile` you used)

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_gin_style.mjs`
Expected: no output

---

## Task 3: PROOF — Tequila/Mezcal agave_aging

**Files:**
- Create (temporary): `apps/catalog/prove_agave_aging.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 3 section)

**Hypothesis (from spec §4):** Does a Blanco ever rail-recommend an Añejo (very different product) purely on brand/price/region? **Reminder from the spec:** 0/11,934 rows have `category_type === 'Mezcal'` — all mezcal-named products are typed `'Tequila'`. Filter subjects on `category_type === 'Tequila'` only; do not waste time hunting for a separate Mezcal bucket.

- [ ] **Step 1: Write the proof script**

Same pattern as Tasks 1–2. Subjects: in-stock Tequila with populated `agave_aging === 'blanco'`. Leak = a candidate with `agave_aging === 'anejo'` or `'extra_anejo'` (the maximally-different aging tier) in the rail.

```javascript
// ...same esbuild bundle setup...
const blancos = all.filter(
  (p) => p.category_type === 'Tequila' && p.agave_aging === 'blanco' && isInStock(p.is_in_stock)
);
console.log(`Testing ${blancos.length} in-stock Blanco tequila subjects...`);
let leakCount = 0, subjectsWithLeak = 0;
const examples = [];
for (const subject of blancos) {
  const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
  const leaks = recs.filter(
    (r) => r.product.category_type === 'Tequila' &&
           ['anejo', 'extra_anejo'].includes(r.product.agave_aging)
  );
  if (leaks.length > 0) {
    subjectsWithLeak++;
    leakCount += leaks.length;
    if (examples.length < 10) {
      examples.push({
        subject: `${subject.sku} | ${subject.name} (aging=blanco, price=${subject.price})`,
        leaks: leaks.map(l => `  -> ${l.product.sku} | ${l.product.name} (aging=${l.product.agave_aging}, price=${l.product.price}) score=${l.score} breakdown=${JSON.stringify(l.scoreBreakdown)}`),
      });
    }
  }
}
console.log(`Subjects with >=1 blanco->anejo leak: ${subjectsWithLeak} / ${blancos.length}`);
console.log(`Total leaked slots: ${leakCount}`);
for (const ex of examples) { console.log(ex.subject); console.log(ex.leaks.join('\n')); console.log(); }
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_agave_aging.mjs`

- [ ] **Step 3: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 3"**

- [ ] **Step 4: Delete the proof script and bundle artifact**

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_agave_aging.mjs`
Expected: no output

---

## Task 4: PROOF — Wine sweetness now that color is gated

**Files:**
- Create (temporary): `apps/catalog/prove_sweetness.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 4 section)

**Hypothesis (from spec §4):** `sweetness` is only +0.5 (within-1-band). Now that wine color is correctly gated (a Dry Red will never see a White or Rosé), check whether a very sweet dessert-adjacent RED wine still leaks into a bone-dry RED wine's rail — since color ≠ sweetness, this is a within-color-bucket check, not a repeat of the color proof.

- [ ] **Step 1: Write the proof script**

Same pattern. Subjects: in-stock Red Wine with `sweetness === 'Dry'`. Leak = a candidate (also Red Wine, so the color gate doesn't interfere) with `sweetness === 'Sweet'` (2+ bands away on `SWEETNESS_BANDS = ['dry', 'off-dry', 'medium-sweet', 'sweet']`) appearing in the rail.

```javascript
// ...same esbuild bundle setup...
const dryReds = all.filter(
  (p) => p.category_type === 'Red Wine' && p.sweetness === 'Dry' && isInStock(p.is_in_stock)
);
console.log(`Testing ${dryReds.length} in-stock Dry Red Wine subjects...`);
let leakCount = 0, subjectsWithLeak = 0;
const examples = [];
for (const subject of dryReds) {
  const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
  const leaks = recs.filter(
    (r) => r.product.category_type === 'Red Wine' && r.product.sweetness === 'Sweet'
  );
  if (leaks.length > 0) {
    subjectsWithLeak++;
    leakCount += leaks.length;
    if (examples.length < 10) {
      examples.push({
        subject: `${subject.sku} | ${subject.name} (sweetness=Dry, price=${subject.price})`,
        leaks: leaks.map(l => `  -> ${l.product.sku} | ${l.product.name} (sweetness=Sweet, price=${l.product.price}) score=${l.score} breakdown=${JSON.stringify(l.scoreBreakdown)}`),
      });
    }
  }
}
console.log(`Subjects with >=1 dry->sweet leak (same color): ${subjectsWithLeak} / ${dryReds.length}`);
console.log(`Total leaked slots: ${leakCount}`);
for (const ex of examples) { console.log(ex.subject); console.log(ex.leaks.join('\n')); console.log(); }
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_sweetness.mjs`

- [ ] **Step 3: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 4"**

- [ ] **Step 4: Delete the proof script and bundle artifact**

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_sweetness.mjs`
Expected: no output

---

## Task 5: PROOF — Sake & Asian smokiness sufficiency

**Files:**
- Create (temporary): `apps/catalog/prove_sake.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 5 section)

**Hypothesis (from spec §4, corrected per spec review):** Sake & Asian has NO `category-scorer.ts` override, but DOES get the generic smokiness signal (+0.5) via `recommender.ts:211`'s `grp` allowlist. Is that alone enough granularity, or does the rail still mix sake classes that matter (e.g. Junmai vs. Ginjo, read from the structured `variety` field per project memory `project_finder_sommelier_redesign.md`, which notes sake class should come from `variety`, NOT text-matching)?

- [ ] **Step 1: Write the proof script**

Subjects: in-stock Sake & Asian products with a populated `variety` containing "Junmai" (case-insensitive). Leak = a candidate whose `variety` contains "Ginjo" but NOT "Junmai" (i.e. a clearly different class) appearing in the rail.

```javascript
// ...same esbuild bundle setup...
const junmai = all.filter(
  (p) => p.category_group === 'Sake & Asian' &&
         typeof p.variety === 'string' &&
         /junmai/i.test(p.variety) &&
         isInStock(p.is_in_stock)
);
console.log(`Testing ${junmai.length} in-stock Junmai-variety Sake subjects...`);
let leakCount = 0, subjectsWithLeak = 0;
const examples = [];
for (const subject of junmai) {
  const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
  const leaks = recs.filter(
    (r) => r.product.category_group === 'Sake & Asian' &&
           typeof r.product.variety === 'string' &&
           /ginjo/i.test(r.product.variety) &&
           !/junmai/i.test(r.product.variety)
  );
  if (leaks.length > 0) {
    subjectsWithLeak++;
    leakCount += leaks.length;
    if (examples.length < 10) {
      examples.push({
        subject: `${subject.sku} | ${subject.name} (variety=${subject.variety}, price=${subject.price})`,
        leaks: leaks.map(l => `  -> ${l.product.sku} | ${l.product.name} (variety=${l.product.variety}, price=${l.product.price}) score=${l.score} breakdown=${JSON.stringify(l.scoreBreakdown)}`),
      });
    }
  }
}
console.log(`Subjects with >=1 Junmai->Ginjo leak: ${subjectsWithLeak} / ${junmai.length}`);
console.log(`Total leaked slots: ${leakCount}`);
for (const ex of examples) { console.log(ex.subject); console.log(ex.leaks.join('\n')); console.log(); }
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_sake.mjs`

**If `junmai.length` is 0 or very small (data coverage may be thin per project memory — sweetness for sake was noted as only ~69/399 in-stock):** note this in the findings log as "insufficient data to prove/disprove" rather than forcing a conclusion. Do not lower the evidence bar to compensate for thin data — an inconclusive result is a valid, honest finding.

- [ ] **Step 3: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 5"**

- [ ] **Step 4: Delete the proof script and bundle artifact**

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_sake.mjs`
Expected: no output

---

## Task 6: PROOF — 7 ungapped groups relying on category_type alone

**Files:**
- Create (temporary): `apps/catalog/prove_ungapped_groups.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 6 section)

**Hypothesis (from spec §4, corrected per spec review):** Sake & Asian, Liqueur, Beer & RTD, Non-Alcoholic, Cigars, Events, Accessories have no `category-scorer.ts` entry — they rely solely on the generic +1 `category_type` match (same flat weight as `country`). Test all 7 groups, not just 1–2. For each group, check whether `category_type` mismatches within the same `category_group` show up in top-8 recs frequently.

- [ ] **Step 1: Write the proof script**

This one differs from Tasks 1–5: instead of a fixed subject filter, loop over all 7 groups and, for each, count how often the top-8 rail contains a candidate whose `category_type` differs from the subject's `category_type` (both non-empty), among IN-STOCK subjects with a non-empty `category_type` for that group.

```javascript
// ...same esbuild bundle setup...
const UNGAPPED_GROUPS = ['Sake & Asian', 'Liqueur', 'Beer & RTD', 'Non-Alcoholic', 'Cigars', 'Events', 'Accessories'];

for (const group of UNGAPPED_GROUPS) {
  const subjects = all.filter(
    (p) => p.category_group === group && p.category_type && isInStock(p.is_in_stock)
  );
  if (subjects.length === 0) {
    console.log(`${group}: 0 in-stock subjects with category_type — SKIP`);
    continue;
  }
  let crossTypeSlots = 0, subjectsWithCrossType = 0;
  const examples = [];
  for (const subject of subjects) {
    const recs = getRecommendationsWithBands(subject, all, { includeGreatAlternative: true });
    const crossType = recs.filter(
      (r) => r.product.category_group === group &&
             r.product.category_type &&
             r.product.category_type !== subject.category_type
    );
    if (crossType.length > 0) {
      subjectsWithCrossType++;
      crossTypeSlots += crossType.length;
      if (examples.length < 3) {
        examples.push(`  ${subject.sku} (${subject.category_type}) -> ${crossType.map(c => `${c.product.sku} (${c.product.category_type})`).join(', ')}`);
      }
    }
  }
  console.log(`${group}: ${subjectsWithCrossType}/${subjects.length} subjects with >=1 cross-type slot, ${crossTypeSlots} total slots`);
  examples.forEach(e => console.log(e));
}
```

- [ ] **Step 2: Run it**

Run: `cd apps/catalog && node prove_ungapped_groups.mjs`

- [ ] **Step 3: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 6"**

For each of the 7 groups, note the count and 1–2 examples (or "SKIP — no data" / "0 leaks").

**Judgment call needed here:** a cross-`category_type` slot within, say, `Accessories` (e.g. a wine fridge recommended alongside a corkscrew) may be perfectly reasonable — unlike wine color, "same category_type" isn't obviously the right bar for every one of these 7 groups. Record what you find, but do NOT propose a gate for any group where a cross-type rec looks sensible on inspection (e.g. glassware + decanter under Accessories). Flag only groups where a cross-type rec looks like a genuine mismatch (analogous to red wine ↔ white wine) for Task 8's decision round.

- [ ] **Step 4: Delete the proof script and bundle artifact**

- [ ] **Step 5: Verify clean**

Run: `git status --short apps/catalog/prove_ungapped_groups.mjs`
Expected: no output

---

## Task 7: PROOF — Co-purchase K / SUPPORT_FULL_AT sanity check

**Files:**
- Create (temporary): `apps/catalog/prove_copurchase_weight.mjs`
- Modify: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md` (fill in PROOF 7 section)
- Read: `apps/catalog/lib/co-purchase.ts` (full file, 123 lines) before writing the script — **critically, read `supportDamping()` (lines 97-99) and `getCoPurchaseBonus()` (lines 107-123) closely.** The damping formula is `Math.min(1, listLength / SUPPORT_FULL_AT)`, where `listLength` is called as `record.co_order_affinities.length` (line 121) — i.e. **the number of co-purchase partners a base SKU has**, NOT any per-pair "order count" or "support" field. There is no per-entry support/order-count field anywhere in the real data (verified during plan review: `AffinityEntry` is `{ rank, base_product_code, product_name, rate }` only — confirm this yourself in Step 1 before writing the script, don't take it on faith).

**Hypothesis (per CLAUDE.md Rule 3 and the spec's explicit callout):** `K` and `SUPPORT_FULL_AT` are inherited magic numbers the code's own comment calls "a rough proxy, not a calibrated confidence threshold." Check: across real `data/bi-product-affinities.json` base records, how many have `co_order_affinities.length` (partner count) near or below `SUPPORT_FULL_AT=5` — meaning damping is actively suppressing the bonus for a large share of real subjects, vs. only a few edge cases? This tells us whether `SUPPORT_FULL_AT=5` is well-calibrated to the actual data distribution or an arbitrary guess that's silently muting most real signal.

- [ ] **Step 1: Inspect the real file shape FIRST, before writing any script**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && node -e "const d=require('./data/bi-product-affinities.json'); const first=Object.values(d.affinities)[0]; console.log(JSON.stringify(first, null, 2).slice(0, 1000))"`

Confirm each entry in `co_order_affinities` has shape `{ rank, base_product_code, product_name, rate }` — no order-count/support field. This confirms the damping formula's input is the **list length**, not a per-entry field — do not design the proof script around a per-entry field, it doesn't exist.

- [ ] **Step 2: Write the proof script (no recommender.ts bundling needed — pure data analysis)**

```javascript
import fs from 'node:fs';
import path from 'node:path';

const biPath = path.join(process.cwd(), '..', '..', 'data', 'bi-product-affinities.json');
const bi = JSON.parse(fs.readFileSync(biPath, 'utf8'));

const SUPPORT_FULL_AT = 5;
const listLengths = [];
for (const [base, record] of Object.entries(bi.affinities)) {
  listLengths.push((record.co_order_affinities ?? []).length);
}

const below = listLengths.filter((n) => n > 0 && n < SUPPORT_FULL_AT).length;
const zero = listLengths.filter((n) => n === 0).length;
const atOrAbove = listLengths.filter((n) => n >= SUPPORT_FULL_AT).length;

console.log(`Total base records: ${listLengths.length}`);
console.log(`Zero co_order_affinities (bonus always 0, damping irrelevant): ${zero} (${(100*zero/listLengths.length).toFixed(1)}%)`);
console.log(`1..${SUPPORT_FULL_AT - 1} partners (damped BELOW full strength): ${below} (${(100*below/listLengths.length).toFixed(1)}%)`);
console.log(`>=${SUPPORT_FULL_AT} partners (full-strength bonus, damping=1): ${atOrAbove} (${(100*atOrAbove/listLengths.length).toFixed(1)}%)`);

// Distribution buckets for a fuller picture
const buckets = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
for (const n of listLengths) {
  const key = n >= 5 ? '5+' : String(n);
  if (key in buckets) buckets[key]++;
}
console.log('Distribution:', JSON.stringify(buckets));
```

**Sanity check (verified during plan review — use to confirm your script is correct, not as a substitute for running it):** on the real file as of 2026-07-22, this should print approximately: total 5,439 base records; 158 with zero partners; distribution `{"0":158,"1":321,"2":330,"3":292,"4":232,"5+":4106}` — meaning ~1,175/5,439 (21.6%) base SKUs are damped below full strength. If your script's output is wildly different from this (e.g. off by an order of magnitude, or shows 0% damped), you likely have a bug — stop and re-check against `supportDamping()`'s actual formula before proceeding. The underlying data may have changed slightly since this review (nightly syncs run), so exact match isn't required — but the shape (a large majority ≥5, a meaningful minority damped, a small zero-partner tail) should hold.

- [ ] **Step 3: Run the proof script**

Run: `cd apps/catalog && node prove_copurchase_weight.mjs`

- [ ] **Step 4: Record output into `RECOMMENDER_AUDIT_FINDINGS.md` under "PROOF 7"**

Include the distribution and your read on whether `SUPPORT_FULL_AT=5` looks well-calibrated (e.g. "~22% of base SKUs are damped below full strength — is that too aggressive, or a reasonable long-tail correction?"). Also note the `K=5` ceiling value separately — this proof only investigates `SUPPORT_FULL_AT`'s calibration; if you think `K` itself also needs scrutiny (e.g. via a distribution of `entry.rate` values across the file), note that as a possible follow-up rather than expanding this proof's scope.

- [ ] **Step 5: Delete the proof script**

Run: `cd apps/catalog && rm -f prove_copurchase_weight.mjs`

- [ ] **Step 6: Verify clean**

Run: `git status --short apps/catalog/prove_copurchase_weight.mjs`
Expected: no output

---

## Task 8: Present Findings, Get Fix Decisions

**Files:** none (decision checkpoint, no code)

- [ ] **Step 1: Read the complete `RECOMMENDER_AUDIT_FINDINGS.md`**

- [ ] **Step 2: Present ALL findings from Tasks 1–7 to the user in a SINGLE `AskUserQuestion` call** (per spec §5 step 5 — batch, not sequential)

For each PROOF that found a real issue (non-zero leak count with concrete examples, or a miscalibrated constant), phrase it as one question with options like "Add a gate", "Leave as-is / soft signal is fine", "Reweight instead of gate". For PROOFs that found zero issues, state that plainly — no question needed for those, just report "PROOF N: no issue found, N subjects tested, 0 leaks."

Multiple questions in one `AskUserQuestion` call are supported (up to 4 per call — if more than 4 PROOFs found real issues, split into two sequential `AskUserQuestion` calls, but keep each call's questions batched by topic, not one call per single finding).

- [ ] **Step 3: Record the user's decisions**

Append a "## Decisions" section to `RECOMMENDER_AUDIT_FINDINGS.md` with exactly what was approved for each proven finding — this becomes the spec for Task 9's fix work. If zero findings were approved (audit came back clean beyond the already-shipped color fix), that's a valid, complete outcome — skip to Task 10.

No commit for this task.

---

## Task 9: FIX — Implement Approved Findings (repeat sub-steps per approved finding)

**Files (exact paths depend on what Task 8 approved — this task template applies once per approved finding):**
- Modify: `apps/catalog/lib/recommender.ts` (for gates in `isEligible()`, mirroring the `WINE_COLOR_TYPES` pattern at lines 41–48 and 297+) OR `apps/catalog/lib/category-scorer.ts` (for weight changes to category overrides) OR `apps/catalog/lib/co-purchase.ts` (if `SUPPORT_FULL_AT`/`K` are being adjusted)
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts`

For EACH approved finding, follow this TDD sub-sequence (do not batch multiple fixes into one commit — one finding, one RED/GREEN/commit cycle):

- [ ] **Step 1: Write the failing unit test(s)** in `recommender.test.ts`, following the exact pattern of the `'cross-category suppression'` describe block (line 473) for a new gate, or the `'scoreCandidateDetailed — taste tiebreakers'` block (line 356) for a weight change. Use small hand-built fixtures, not real data, for this fast unit-level test.

- [ ] **Step 2: Run it, confirm it fails for the right reason**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "<new test name>"`
Expected: FAIL, with the assertion failing because the gate/weight doesn't exist yet — not a syntax error or wrong fixture.

- [ ] **Step 3: Implement the minimal fix**

If a gate: add to `isEligible()` following the exact structure of the existing `WINE_COLOR_TYPES` block (lines 297+) — a new `const <GROUP>_<AXIS>_TYPES = new Set([...])` near the top of the file (mirroring line 41), then a conditional block inside `isEligible()` after the existing gates, with a comment explaining why (mirroring the existing comment style).

If a weight change: adjust the specific `add(...)` call in `scoreCandidateDetailed()` or the relevant constant in `category-scorer.ts`/`co-purchase.ts`. **The new value must be the one carried forward from Task 8's decision** (i.e. what the user approved when shown the corresponding PROOF task's concrete before/after example) — do not invent a new number here. If Task 8's decision didn't pin an exact number (e.g. user said "reweight, use your judgment"), derive it from the same PROOF task's real example the way this session's color-gate fix derived its design from the 92/2,439 evidence, and say so explicitly in the commit message.

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "<new test name>"`
Expected: PASS

- [ ] **Step 5: Add a real-catalog end-to-end invariant test**, following the EXACT pattern of `'wine color purity (real catalog, end-to-end invariant)'` (line 698) — use `precomputeRecommendations()` (the bucketed path, NOT a naive per-subject `getRecommendationsWithBands()` full-pool scan, which took 76s vs. 9s in this session's precedent) against the real `data/live_products_export.json`, asserting the leak count found in the corresponding PROOF task is now 0 (or reduced to the approved/expected residual, e.g. niche-type exceptions).

- [ ] **Step 6: If this finding added a GATE (not a pure weight change), check for pool starvation before/after** — per spec §5's explicit note: a new gate's failure mode is a short/empty rail, not just a leak, and this is NOT covered by Step 5's leak-count test. Write a small script (same bundle-and-run pattern, deleted after use like the PROOF scripts) that runs `precomputeRecommendations()` against the real catalog BEFORE and AFTER the code change (use `git stash`/`git stash pop` to toggle, or just note the pre-fix numbers from the corresponding PROOF task's subject pool sizes) and compares rail-length distribution for the affected category/type — e.g. "% of subjects in the gated category with a rail < 8, < 4, or 0 items." If the gate visibly hollows out a thin category (a meaningful jump in short/empty rails), STOP and raise it with the user before committing — the fix may need the same "niche types stay ungated" carve-out the wine-color fix used for Wine Set/Orange Wine/Sweet-Dessert/Fortified, rather than a blanket gate.

- [ ] **Step 7: Run the full recommender test file**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: all tests pass, including the new ones and the existing wine-color-purity test (must not regress).

- [ ] **Step 8: Commit this one finding's fix**

```bash
cd apps/catalog
git add lib/recommender.ts lib/category-scorer.ts lib/co-purchase.ts lib/__tests__/recommender.test.ts
git commit -m "fix(recommender): <short description of this one finding's fix>

<1-2 sentence what/why, citing the PROOF N finding: N/M subjects
affected, concrete example>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Adjust the `git add` file list to only the files this specific finding actually touched.)

Repeat Steps 1–8 for every approved finding before moving to Task 10.

---

## Task 10: Full Regression Suite + Build

**Files:** none (verification only)

- [ ] **Step 1: Run the full catalog test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all tests pass (baseline from this session: 780/781 passing with 1 pre-existing unrelated `blog-jsonld.test.ts` failure — confirm that failure is still the ONLY failure, or investigate if it's new/different).

- [ ] **Step 2: Run the production build**

Run: `cd apps/catalog && npm run build`
Expected: build succeeds, all pages generate including `/product/[sku]` and `/finder/*`.

- [ ] **Step 3: If any new test failures appear beyond the known pre-existing one, STOP and investigate before proceeding** — do not mark this task complete with unexplained failures.

No commit for this task (verification only, nothing to commit).

---

## Task 11: Browser Verification (Rule 7)

**Files:** none (manual/scripted verification)

- [ ] **Step 1: Start the dev server on port 3100** (per project memory `project_catalog_dev_port.md` — NOT 3212)

Run: `cd apps/catalog && lsof -ti:3100 | xargs -r kill -9; PORT=3100 npm run dev &`

Wait for `✓ Ready` in the output before proceeding.

- [ ] **Step 2: For each group that got a NEW gate in Task 9, find one real subject SKU from that PROOF task's findings and visit its product page**

Example (if whisky peat was gated): visit `http://localhost:3100/product/<a heavy-peat whisky SKU from PROOF 1's examples>` and confirm the "You might also like" rail no longer shows the previously-leaked unpeated candidate.

Use a Playwright script following the exact pattern used this session (`verify_browser3.py` — load the page, extract `a[href^='/product/']` hrefs, confirm none match the pre-fix leaked SKU).

- [ ] **Step 3: Screenshot at least one fixed product page for the record**

- [ ] **Step 4: Stop the dev server**

Run: `lsof -ti:3100 | xargs -r kill -9`

No commit for this task.

---

## Task 12: Clean Up Findings Log, Update Memory, Final Commit

**Files:**
- Delete: `apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md`
- Create: `/Users/admin/.claude/projects/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/memory/project_recommender_quality_audit_2026.md` (or update the existing `project_recommender_wine_color_leak_fix.md` if the findings are small enough to fold in — use judgment based on how much was found)
- Modify: `/Users/admin/.claude/projects/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/memory/MEMORY.md` (add/update index entry)

- [ ] **Step 1: Delete the findings log**

Run: `cd apps/catalog && rm -f RECOMMENDER_AUDIT_FINDINGS.md`

- [ ] **Step 2: Confirm no stray files remain**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git status --short apps/catalog/*.mjs apps/catalog/RECOMMENDER_AUDIT_FINDINGS.md`
Expected: no output

- [ ] **Step 3: Write a memory file summarizing what the audit found** (proven issues fixed, proven-clean signals, any inconclusive/deferred items like thin sake data), following the structure of `project_recommender_wine_color_leak_fix.md` as a template — lead with the fact, then **Why:** and **How to apply:** framing where relevant.

- [ ] **Step 4: Add one line to `MEMORY.md`'s index** pointing to the new/updated memory file.

- [ ] **Step 5: Final full-suite + build sanity check**

Run: `cd apps/catalog && npx vitest run && npm run build`
Expected: same clean result as Task 10.

- [ ] **Step 6: Commit the memory update** (memory files are outside the git repo — this step is a no-op for `git commit` if only memory changed; skip if Task 9 already committed all code changes and nothing in the repo changed since)

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git status --short`
Expected: clean (everything already committed per-finding in Task 9), OR only the doc amendment from Task 9 commits — nothing uncommitted should remain.
