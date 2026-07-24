# Bottle-Size Eligibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop "you might also like" from cross-recommending wildly different physical formats of the same category (e.g. a 720ml premium bottled sake recommending a 190ml novelty jelly-sake can) by adding a hard size-comparability gate to `isEligible()`.

**Architecture:** One new pure helper (`parseBottleMl`) parses the existing `bottle_size` string field into milliliters; one new gate function (`sizesComparable`) applies a 0.5x–2x ratio band; `isEligible()` in `apps/catalog/lib/recommender.ts` calls the gate right after the existing wine-color check. Missing/unparseable size data on either side never blocks (fail-open, consistent with the rest of `isEligible()`). No new fields, no schema change — `bottle_size` is already loaded onto `PublicProduct` and 90.6% populated catalog-wide (100% for Sake/Shochu).

**Tech Stack:** TypeScript, Vitest, existing `apps/catalog/lib/recommender.ts` module.

---

## Context for the implementer

`data/live_products_export.json` is the UI-facing data source (see CLAUDE.md Rule 9) — every product already carries a `bottle_size` string like `"750 ml"`, `"1800 ml (1.8 L)"`, `"720ml"` (no space, 13 occurrences), or `"4.5 L"`-style parenthetical. There are 41 distinct string values catalog-wide, all regular EXCEPT one: the empty string `''` (1,124 occurrences, ~9.8% of the catalog) is one of the 41 — `parseBottleMl` must treat it as unparseable/unknown (it does, via the falsy check at the top of the function), same as `null`/`undefined`. This field is currently loaded (`apps/catalog/lib/types.ts:67`, `catalog-data.ts:18`) but never read by any scoring or gating logic.

**The bug this fixes:** `LSK0119AB` (Dassai Junmai Daiginjo, 720ml, ฿4,500) shows `LSK0445FS`/`LSK0446FS`/`LSK0447FS` (Hakutsuru "Purupuru Sparkling Jelly Sake", 190ml novelty cans sold in 30-packs, ฿4,700) in its "You might also like" rail. Nothing in `isEligible()` currently gates on physical size — only `category_group` and (for Wine) color/style are hard-gated. Confirmed via direct read of `data/live_products_export.json`.

**Catalog-wide scope (already surveyed, not this implementer's job to re-derive):** roughly 55 SKUs across nearly every category are extreme size outliers within their `category_type` — miniatures (187–200ml minis/mini-bars), magnums/jeroboams/methuselahs (3–6L), and multi-packs. Examples already verified: Johnnie Walker 200ml mini-bar bottles among 700ml whisky, Absolut/Grey Goose 4.5–6L among 700ml vodka, Moët/Bottega 200ml among 750ml Champagne. This gate fixes all of them in one pass, not just Sake.

**Band choice (0.5x–2x), already validated against real data:**
| Pair | Ratio | Gate result |
|---|---|---|
| Dassai 720ml ↔ Hakutsuru jelly 190ml | 3.79x | blocked (correct — this is the bug) |
| JW mini 200ml ↔ standard whisky 700ml | 3.5x | blocked (correct) |
| Absolut 4.5L ↔ standard vodka 700ml | 6.43x | blocked (correct) |
| Moët 200ml ↔ standard Champagne 750ml | 3.75x | blocked (correct) |
| Wine magnum 1500ml ↔ standard 750ml | 2.0x | **allowed** (legitimate step-up, kept) |
| Sake 1.8L ↔ Sake 720ml | 2.5x | blocked (accepted tradeoff — see below) |

**Known, accepted tradeoff (explicit user decision 2026-07-24):** 720ml↔1.8L is a very common, legitimate Sake pairing (218 in-stock SKUs at 720ml, 66 at 1.8L) that falls just outside the 2x band and will stop cross-recommending under this gate. This is an intentional behavior change, not a bug — do not widen the band to accommodate it. If a future session wants that pairing back, that's a deliberate band-width decision to revisit, not something to "fix" as part of this plan.

**Known, pre-existing gap this may interact with (NOT to be fixed in this plan):** per `project_recommender_quality_audit_2026` memory (2026-07-23 audit), `precomputeRecommendations()`'s bucket-widening logic doesn't know that a fine-grained `isEligible()` gate will filter most of a region bucket back out, which can leave a subject with a thin or empty rail even though compatible candidates exist one bucket-tier away. A check run during design found 12/67 large-format (≥1500ml) in-stock Sake SKUs would have fewer than 2 same-region, same-size-band peers under this new gate. This is the same accepted gap from the prior audit surfacing again, not a new bug — do not attempt to fix `eligibleCount()`/widening as part of this plan. Flag it in the final report exactly as the prior audit did, so a future session can decide whether to tackle the widening algorithm generally.

**Test fixture pattern to follow:** this codebase's existing test file (`apps/catalog/lib/__tests__/recommender.test.ts`) has two relevant precedents — copy their style exactly:
1. The `cross-category suppression` describe block (line ~473) for the isolated-fixture unit tests — use inline `{ ...base, ... }` object fixtures matching that block's own style (Task 3's new tests do this, NOT the `mkProduct` helper at line ~524, which lives further down and isn't used by the block being mirrored).
2. The `wine color purity (real catalog, end-to-end invariant)` describe block (line ~698) for the real-catalog invariant test — it reads `data/live_products_export.json` directly, runs it through `precomputeRecommendations`, and asserts zero leaks. Mirror this exactly for bottle size.

---

## Task 1: `parseBottleMl` helper

**Files:**
- Modify: `apps/catalog/lib/recommender.ts` (add near the other small parsing helpers, e.g. after `similarRange`/`stepUpCeiling`, before `varietiesMatch` — around line 100)
- Test: `apps/catalog/lib/__tests__/recommender.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new describe block (place it near the top of the test file, after the existing imports/fixtures, or directly before the `cross-category suppression` block):

```ts
import { parseBottleMl, sizesComparable } from '@/lib/recommender';
```

(Add these two names to the existing `import { ... } from '@/lib/recommender'` line at the top of the test file rather than a new import statement.)

```ts
describe('parseBottleMl', () => {
  it('parses plain ml', () => {
    expect(parseBottleMl('750 ml')).toBe(750);
  });
  it('parses ml with no space', () => {
    expect(parseBottleMl('720ml')).toBe(720);
  });
  it('parses liters with parenthetical', () => {
    expect(parseBottleMl('1800 ml (1.8 L)')).toBe(1800);
  });
  it('parses a bare liter value with no ml prefix', () => {
    expect(parseBottleMl('1.8 L')).toBe(1800);
  });
  it('parses a bare liter integer', () => {
    expect(parseBottleMl('3 L')).toBe(3000);
  });
  it('returns null for missing/empty input', () => {
    expect(parseBottleMl(undefined)).toBeNull();
    expect(parseBottleMl(null)).toBeNull();
    expect(parseBottleMl('')).toBeNull();
  });
  it('returns null for unparseable input', () => {
    expect(parseBottleMl('N/A')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "parseBottleMl"`
Expected: FAIL — `parseBottleMl` is not exported / not defined.

- [ ] **Step 3: Implement `parseBottleMl`**

Add to `apps/catalog/lib/recommender.ts`, exported (tests import it directly), placed near `similarRange`:

```ts
/**
 * Parse a `bottle_size` string (e.g. "750 ml", "720ml", "1800 ml (1.8 L)",
 * "1.8 L") into milliliters. Handles the ~40 distinct values found catalog-wide
 * (data/live_products_export.json, surveyed 2026-07-24) — all are a plain
 * number followed by "ml" or "l" (case-insensitive, optional space), with an
 * optional parenthetical restating the same value in liters, which this
 * regex ignores by matching the FIRST unit token in the string.
 * Returns null for missing or unparseable input — callers must treat null as
 * "unknown," never as a size of zero.
 */
export function parseBottleMl(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  const mlMatch = s.match(/(\d+(?:\.\d+)?)\s*ml/);
  if (mlMatch) return parseFloat(mlMatch[1]);
  const lMatch = s.match(/(\d+(?:\.\d+)?)\s*l\b/);
  if (lMatch) return parseFloat(lMatch[1]) * 1000;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "parseBottleMl"`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/recommender.ts apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "feat: add parseBottleMl helper to recommender.ts"
```

---

## Task 2: `sizesComparable` gate function

**Files:**
- Modify: `apps/catalog/lib/recommender.ts` (add directly after `parseBottleMl`)
- Test: `apps/catalog/lib/__tests__/recommender.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('sizesComparable', () => {
  it('allows equal sizes', () => {
    expect(sizesComparable('750 ml', '750 ml')).toBe(true);
  });
  it('allows a 2x step-up (magnum)', () => {
    expect(sizesComparable('750 ml', '1500 ml (1.5 L)')).toBe(true);
  });
  it('allows a 0.5x step-down', () => {
    expect(sizesComparable('1500 ml (1.5 L)', '750 ml')).toBe(true);
  });
  it('blocks a novelty-can-sized candidate against a standard bottle (the Dassai/Hakutsuru bug)', () => {
    expect(sizesComparable('720 ml', '190 ml')).toBe(false);
  });
  it('blocks a mini-bar bottle against a standard bottle', () => {
    expect(sizesComparable('700 ml', '200 ml')).toBe(false);
  });
  it('blocks a large-format bottle against a standard bottle', () => {
    expect(sizesComparable('700 ml', '4500 ml (4.5 L)')).toBe(false);
  });
  it('blocks Sake 1.8L against Sake 720ml (accepted tradeoff, ratio 2.5x)', () => {
    expect(sizesComparable('1800 ml (1.8 L)', '720 ml')).toBe(false);
  });
  it('does not gate when either side is missing bottle_size (fail-open)', () => {
    expect(sizesComparable(undefined, '190 ml')).toBe(true);
    expect(sizesComparable('720 ml', null)).toBe(true);
    expect(sizesComparable(undefined, undefined)).toBe(true);
  });
  it('does not gate when either side is unparseable (fail-open)', () => {
    expect(sizesComparable('N/A', '190 ml')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "sizesComparable"`
Expected: FAIL — `sizesComparable` is not exported / not defined.

- [ ] **Step 3: Implement `sizesComparable`**

```ts
// Comparable-size band: candidate must be within 0.5x–2x of the subject's
// bottle_size to be eligible. Mirrors the existing wine-color hard-gate
// pattern in isEligible() (see WINE_COLOR_TYPES above) — physical format is
// treated as a hard eligibility gate, not a soft scoring signal, because no
// amount of shared region/variety/price makes a 190ml novelty can a sensible
// "you might also like" for a 720ml premium bottle (see the Dassai/Hakutsuru
// bug this closes). Missing/unparseable size on EITHER side fails open (never
// blocks) — ~9.4% of the catalog lacks bottle_size and must not be silently
// excluded from every rail.
//
// BAND WIDTH: 0.5x–2x was chosen to keep the classic 750ml->1500ml magnum
// step-up (exactly 2.0x) while blocking every real leak found in the
// 2026-07-24 audit (all >=3.5x). KNOWN, ACCEPTED TRADEOFF: this also blocks
// the common 720ml<->1.8L Sake pairing (ratio 2.5x, just outside the band) —
// a deliberate user decision, not a gap to "fix" by widening the band.
function sizesComparable(a: string | undefined | null, b: string | undefined | null): boolean {
  const mlA = parseBottleMl(a);
  const mlB = parseBottleMl(b);
  if (mlA == null || mlB == null || mlA <= 0 || mlB <= 0) return true;
  const ratio = mlA / mlB;
  return ratio >= 0.5 && ratio <= 2;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "sizesComparable"`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/recommender.ts apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "feat: add sizesComparable gate function to recommender.ts"
```

---

## Task 3: Wire the gate into `isEligible()`

**Files:**
- Modify: `apps/catalog/lib/recommender.ts:297-334` (the `isEligible` function)
- Test: `apps/catalog/lib/__tests__/recommender.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new describe block after the existing `cross-category suppression` block:

```ts
describe('bottle-size eligibility gate', () => {
  const bottle720 = { ...base, sku: 'B720', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', bottle_size: '720 ml', is_in_stock: true };
  const jellyCan190 = { ...base, sku: 'JELLY190', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', bottle_size: '190 ml', is_in_stock: true };
  const bottle700standard = { ...base, sku: 'W700', category_group: 'Wine', category_type: 'Red Wine', bottle_size: '700 ml', is_in_stock: true };
  const magnum1500 = { ...base, sku: 'W1500', category_group: 'Wine', category_type: 'Red Wine', bottle_size: '1500 ml (1.5 L)', is_in_stock: true };
  const noSizeData = { ...base, sku: 'NOSIZE', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', bottle_size: undefined, is_in_stock: true };

  it('a 720ml sake subject never returns a 190ml novelty-can candidate (Dassai/Hakutsuru regression)', () => {
    const recs = getRecommendations(bottle720, [bottle720, jellyCan190]);
    expect(recs.find(r => r.sku === 'JELLY190')).toBeUndefined();
  });
  it('a 700ml wine subject still returns a 1500ml magnum candidate (legitimate step-up preserved)', () => {
    const recs = getRecommendations(bottle700standard, [bottle700standard, magnum1500]);
    expect(recs.find(r => r.sku === 'W1500')).toBeDefined();
  });
  it('does not block a candidate with missing bottle_size data', () => {
    const recs = getRecommendations(bottle720, [bottle720, noSizeData]);
    expect(recs.find(r => r.sku === 'NOSIZE')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "bottle-size eligibility gate"`
Expected: FAIL — `JELLY190` still appears in the first test (gate not wired in yet).

- [ ] **Step 3: Wire the gate into `isEligible()`**

In `apps/catalog/lib/recommender.ts`, inside `isEligible()`, add the new check directly after the existing wine-color block (after the closing `}` of the `if (subjectGroup === 'Wine' && candidateGroup === 'Wine') { ... }` block, before the final `return true;`):

```ts
  // Suppress cross-size-format recommendations: no amount of shared region/
  // variety/price makes a 190ml novelty can a sensible "you might also like"
  // for a 720ml premium bottle (found via a 720ml Dassai Junmai Daiginjo
  // recommending 190ml Hakutsuru "Purupuru Sparkling Jelly Sake" cans, both
  // Sake/Shochu category_type). Applies across ALL category groups, not just
  // Sake — a 2026-07-24 catalog sweep found the same shape of leak in whisky
  // mini-bar bottles, oversized vodka bottles, and Champagne minis. See
  // sizesComparable's docblock for the band-width rationale and the accepted
  // Sake 720ml<->1.8L tradeoff.
  if (!sizesComparable(product.bottle_size, candidate.bottle_size)) return false;

  return true;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "bottle-size eligibility gate"`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the FULL existing test suite to check for regressions**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: ALL tests pass. If any pre-existing test now fails, inspect whether its fixture happens to set mismatched `bottle_size` values that trigger the new gate unintentionally — fix the fixture (add matching or omit `bottle_size` on both sides), do NOT weaken the gate to pass a fixture that isn't testing size behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/lib/recommender.ts apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "feat: gate isEligible() on bottle-size comparability"
```

---

## Task 4: Real-catalog end-to-end invariant test

**Files:**
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts` (add new describe block after `wine color purity (real catalog, end-to-end invariant)`, ~line 730)

This is the CLAUDE.md Rule 6 invariant test: it must prove the fix against the REAL live export, not just synthetic fixtures, and must run after every future bulk data write to this file per the same rule.

- [ ] **Step 1: Write the test**

```ts
describe('bottle-size purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock product has an out-of-size-band candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const inStockSkus = normalized.filter((p) => p.is_in_stock);
    expect(inStockSkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    const precomputed = precomputeRecommendations(normalized as any);

    const leaks: string[] = [];
    for (const subject of inStockSkus) {
      const subjectMl = parseBottleMl(subject.bottle_size);
      if (subjectMl == null) continue; // fail-open subjects have nothing to violate
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        if (!cand) continue;
        const candMl = parseBottleMl(cand.bottle_size);
        if (candMl == null) continue; // fail-open candidates never a violation
        const ratio = subjectMl / candMl;
        if (ratio < 0.5 || ratio > 2) {
          leaks.push(`${subject.sku} (${subject.bottle_size}) -> ${r.sku} (${cand.bottle_size}, ratio ${ratio.toFixed(2)})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  it('the specific Dassai/Hakutsuru bug is fixed', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const dassai = normalized.find((p) => p.sku === 'LSK0119AB');
    if (!dassai || !dassai.is_in_stock) return; // sku may have gone out of stock/renumbered since the bug report; not this test's concern

    const precomputed = precomputeRecommendations(normalized as any);
    const recs = (precomputed.get('LSK0119AB') ?? []).map((r) => r.sku);
    expect(recs).not.toContain('LSK0445FS');
    expect(recs).not.toContain('LSK0446FS');
    expect(recs).not.toContain('LSK0447FS');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts -t "bottle-size purity"`
Expected: PASS, 0 leaks. If leaks appear, they are new real bugs the gate doesn't cover — investigate before considering this task done; do not weaken the assertion to force a pass (CLAUDE.md Rule 5).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "test: add real-catalog invariant for bottle-size eligibility gate"
```

---

## Task 5: Full verification and live rebuild

**Files:** none (verification only)

- [ ] **Step 1: Run the full recommender test suite**

Run: `cd apps/catalog && npx vitest run lib/__tests__/recommender.test.ts`
Expected: all tests pass (baseline was 81/81 as of the 2026-07-23 audit; expect that count plus this plan's ~20 new tests).

- [ ] **Step 2: Run the full catalog test suite and build**

Run: `cd apps/catalog && npm test && npm run build`
Expected: both succeed. Per CLAUDE.md's "gate on build, not just tests" feedback rule, the build must pass, not just `npm test`.

- [ ] **Step 3: Regenerate the precomputed recs cache if one exists**

Check for a prebuild script (referenced in memory as `gen-recs-cache.mjs`):

Run: `find "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" -iname "*gen-recs-cache*"`

If found, run it per its own instructions/README so the live site's precomputed rails reflect the new gate — the invariant test in Task 4 only checks the `precomputeRecommendations()` function output, not whatever cached/serialized artifact the deployed site actually reads.

- [ ] **Step 4: Browser-verify the specific bug is fixed (CLAUDE.md Rule 7 — UI changes require browser verification)**

Start the dev server (catalog runs on port 3100, not 3000 — see memory `project_catalog_dev_port`):

Run: `cd apps/catalog && npm run dev` (or the project's documented dev command)

Then visit `http://localhost:3100/product/LSK0119AB` and confirm:
- The "You might also like" section no longer shows any of LSK0445FS / LSK0446FS / LSK0447FS (Hakutsuru Purupuru Sparkling Jelly Sake).
- The section is not empty (if it IS empty, that's the known accepted architectural gap from the 2026-07-23 audit resurfacing — confirm via the region-bucket math in the "Context" section above before treating it as a new bug; report it plainly either way, do not paper over it).

- [ ] **Step 5: Spot-check 2–3 more subjects from the catalog-wide outlier list**

Using SKUs surfaced during design (e.g. a Johnnie Walker mini-bar SKU, an Absolut/Grey Goose large-format SKU, or a Moët/Bottega 200ml Champagne SKU — re-derive exact SKUs with the same `bottle_size` outlier query used during design if needed), visit their product pages and confirm the rail no longer contains an obviously mismatched size, and is not unexpectedly empty.

- [ ] **Step 6: Write the cost/shipping summary**

Per CLAUDE.md's data-pipeline rules (this touches a user-facing table's derived output, even though no paid API call is involved here): report to the user what shipped — which SKUs' rails changed, the leak count found vs. fixed, and any subjects that went thin/empty as a side effect (the 12 Sake large-format SKUs flagged during design, or others discovered in Step 5).

---

## Not in scope for this plan (explicitly deferred)

- **Fixing `precomputeRecommendations()`'s bucket-widening gap.** Documented as a known, accepted gap in `project_recommender_quality_audit_2026` memory before this plan existed. This plan's gate will likely make it bite slightly more often (any hard gate does). Do not attempt a fix here — surface findings, let the user decide priority.
- **A structured `product_format`/`container_type` field.** The user chose the `bottle_size`-only ratio-band approach over a separate multipack/novelty-detection field. If a future novelty item lands inside the 0.5x–2x band by nominal ml (e.g. a small-format multipack whose printed size happens to match a standard bottle), that's a gap for a future session, not this one.
- **Porting this gate's logic to `apps/catalog/lib/finder/scoring.ts` ("Find Your Match").** The user's stated plan is to fix/verify "You might also like" first, then bring the learnings over to Finder as a separate follow-up. Do not touch Finder code in this plan.
