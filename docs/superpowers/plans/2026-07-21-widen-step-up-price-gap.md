# Widen Step-Up Price Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "step-up" recommendations on product pages a real, noticeable price jump (≥50% above the subject's price, up to 1.6x) instead of the current narrow window that can start as close as +15-16%.

**Architecture:** Single-function change in `apps/catalog/lib/recommender.ts`. `priceBand()` currently treats "step-up" as "anything above the similar-band ceiling, up to a 1.35x cap." We replace that with an explicit floor (`subjectPrice * 1.5`) independent of the similar band's `hi`, and raise the cap to `subjectPrice * 1.6`. Candidates priced between the similar band's `hi` and the new floor (the "dead zone") are excluded from price-band display entirely (return `null`), same as candidates above the ceiling already are — this is a deliberate, approved trade-off, not a bug. No other files change; `RecsCarousel.tsx`, `page.tsx`, and the `SLOT_PREFERENCE`/fallback logic in `getRecommendationsWithBands` already handle a band having fewer/no candidates.

**Tech Stack:** TypeScript, Vitest (existing test file `apps/catalog/lib/__tests__/recommender.test.ts`).

---

## Background for the implementing engineer

- File to modify: `apps/catalog/lib/recommender.ts`. Function `priceBand()` (lines ~92-113) delegates to `similarRange()` (defines the "similar" band per price tier) and `stepUpCeiling()` (defines how far above `hi` a "step-up" candidate may be).
- Current behavior: `step-up` = `candidatePrice > hi && candidatePrice <= stepUpCeiling(subjectPrice, hi)`, where `stepUpCeiling = max(subjectPrice * 1.35, hi * 1.15)`.
- New behavior: `step-up` = `candidatePrice >= subjectPrice * 1.5 && candidatePrice <= subjectPrice * 1.6`. The `hi`-based logic is removed from the step-up calculation (it's still used for `similar`/`great-alternative`).
- This creates a "dead zone": prices strictly between `hi` and `subjectPrice * 1.5` return `null` (excluded), exactly like today's above-ceiling exclusion. This was explicitly approved by the user — do not try to soften it by stretching `similar`'s range.
- **Accepted edge case — budget tier collapse:** for subjects priced below ~฿500 (where `similarRange` uses the absolute ±฿250 band), `[subjectPrice*1.5, subjectPrice*1.6]` sits entirely at or below `hi`, so step-up is unreachable at ANY candidate price for these subjects — not just a wider dead zone, a full band collapse. This was explicitly reviewed and accepted by the user (see Task 2 Step 1): cheap product pages will simply never show a step-up badge, and `getRecommendationsWithBands`'s existing fallback logic fills those slots from other bands instead. Do not try to special-case this with an absolute floor for cheap items — that was considered and rejected.
- `great-alternative` (candidate below `lo`) is unchanged.
- Two existing tests construct fixture data assuming the old ~15-35% step-up window (`describe('alternates similar/step-up...')` and the adjacent fallback test, both around line 519-549). Their fixture prices (subject 1600, step-up candidates 1950-2110) fall in the new dead zone under the new floor (1600*1.5=2400) and must be updated to real step-up prices (≥2400, ≤2560), not just have their expectations changed.
- A third existing test (`'budget tier: lo clamped to 0 (not negative)'`, lines 309-315) asserts the OLD step-up behavior for a ฿200 subject and must be rewritten, not just have its expectation flipped — see Task 2 Step 1.

## File Structure

- Modify: `apps/catalog/lib/recommender.ts` — `priceBand()`, remove/replace `stepUpCeiling()`, update `STEP_UP_CEILING` constant and its doc comment.
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts` — update all `priceBand` step-up/ceiling assertions and the two `getRecommendationsWithBands` fixture-price tests to match the new floor/ceiling.

---

### Task 1: Update `priceBand` step-up logic in `recommender.ts`

**Files:**
- Modify: `apps/catalog/lib/recommender.ts:66-113` (the step-up constant/helper at 66-90, and the `priceBand` docblock + body at 92-113)

- [ ] **Step 1: Replace the `STEP_UP_CEILING` constant, its doc comment, and the `stepUpCeiling` helper**

Replace lines 66-90 (the doc comment above `STEP_UP_CEILING`, the constant itself, the `stepUpCeiling` doc comment, and the `stepUpCeiling` function) with:

```ts
// Step-up is a deliberate, meaningfully-higher price tier — NOT "just above the
// similar band". A candidate must be at least 50% pricier than the subject to
// read as a genuine upsell, capped at 60% so it doesn't feel like an unrelated
// jump. Candidates priced between the similar band's `hi` and this floor (e.g.
// +16% to +49%) are intentionally excluded from price-band display (see
// priceBand) rather than folded into either band — a deliberate gap, not a bug.
const STEP_UP_MIN_RATIO = 1.5;
const STEP_UP_MAX_RATIO = 1.6;
```

- [ ] **Step 2: Update `priceBand()` — including its docblock — to use the new floor/ceiling**

Replace the current `priceBand` docblock AND function body (lines 92-113 — this includes the doc comment directly above the function, which still says "step-up ceiling (stepUpCeiling)" and must not be left stale):

```ts
/**
 * Assign an intent band to a candidate relative to the subject's price.
 * Returns 'similar' when either price is missing/zero — safest default for display.
 * Returns 'step-up' only when the candidate is priced within an explicit tier
 * above the subject: [subjectPrice * STEP_UP_MIN_RATIO, subjectPrice * STEP_UP_MAX_RATIO].
 * Returns null (excluded from price-band display, not mislabeled) in TWO cases:
 * candidate is above the similar band's `hi` but below the step-up floor (a
 * deliberate dead zone — see STEP_UP_MIN_RATIO), or candidate is above the
 * step-up ceiling (too big a jump to read as a natural upsell).
 */
export function priceBand(
  subjectPrice: number | undefined | null,
  candidatePrice: number | undefined | null,
): Band | null {
  if (
    typeof subjectPrice !== 'number' || subjectPrice <= 0 ||
    typeof candidatePrice !== 'number' || candidatePrice <= 0
  ) return 'similar';
  const { lo, hi } = similarRange(subjectPrice);
  if (candidatePrice >= lo && candidatePrice <= hi) return 'similar';
  if (candidatePrice < lo) return 'great-alternative';
  const stepUpFloor = subjectPrice * STEP_UP_MIN_RATIO;
  const stepUpCeiling = subjectPrice * STEP_UP_MAX_RATIO;
  if (candidatePrice >= stepUpFloor && candidatePrice <= stepUpCeiling) return 'step-up';
  return null;
}
```

- [ ] **Step 3: Verify no other reference to the removed `stepUpCeiling` function or `STEP_UP_CEILING` constant remains**

Run: `grep -n "STEP_UP_CEILING\|stepUpCeiling" "apps/catalog/lib/recommender.ts"`
Expected: no output. If this returns a hit inside a comment or elsewhere, Step 1 or Step 2 above was not applied to its full stated line range — go back and check you replaced the ENTIRE docblock-plus-body span, not just the code.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/recommender.ts
git commit -m "feat(recommender): widen step-up price gap to 1.5x-1.6x floor/ceiling"
```

---

### Task 2: Update `priceBand` unit tests

**Files:**
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts:299-347`

- [ ] **Step 1: Fix the budget-tier test (lines 309-315) — step-up is now unreachable below ~฿500**

**Known, approved behavior change:** for subjects priced below ~฿500 (where `similarRange` uses the absolute ±฿250 band, not a percentage), the new `[subjectPrice*1.5, subjectPrice*1.6]` step-up window sits entirely at or below the similar band's `hi` — there is no price at which step-up is reachable at all for these subjects. This was explicitly reviewed and accepted by the user: cheap products simply won't show a step-up badge; `getRecommendationsWithBands`'s existing fallback logic fills those slots from `similar`/other bands instead. This is a full band collapse for that price tier, not just a widened dead zone — worth remembering if a future engineer wonders why budget SKUs never show "Step up ↑".

Replace lines 309-315 (which currently assert `priceBand(200, 480) === 'step-up'` under the old logic):

```ts
  it('budget tier: lo clamped to 0 (not negative); step-up is unreachable below ~฿500', () => {
    // Price 200, band is ±250 absolute → lo = max(0,-50) = 0, hi = 450.
    // floor = 200*1.5 = 300, ceiling = 200*1.6 = 320 — both BELOW hi(450), so
    // the [floor, ceiling] window sits entirely inside/below the similar band's
    // hi and is unreachable: any candidate above hi is automatically also above
    // ceiling(320), so it can only ever land in 'similar' or null, never 'step-up'.
    // This is an accepted consequence of the 1.5x/1.6x floor/ceiling for very
    // cheap products, not a bug — see recommender.ts priceBand.
    expect(priceBand(200, 1)).toBe('similar');   // any positive price is >= 0
    expect(priceBand(200, 480)).toBe(null);      // above hi(450) and above ceiling(320) — no step-up possible here
    expect(priceBand(200, 520)).toBe(null);      // above hi(450) and above ceiling(320)
  });
```

- [ ] **Step 2: Update the tier tests' step-up assertions (originally lines 316-329, before Step 1's edit)**

These tests currently assert `step-up` for candidates just above `hi`. Under the new rule those candidates fall in the dead zone (`null`), and the true step-up examples need new candidate prices at ≥1.5x/≤1.6x. Find and replace the `'mid tier'`, `'high tier'`, and `'premium tier'` blocks (originally lines 316-329):

```ts
  it('mid tier (1000-5000): similar band unaffected by step-up change', () => {
    expect(priceBand(1619, 1900)).toBe('similar');      // within 20%
    expect(priceBand(1619, 2100)).toBe(null);           // above hi(1942.8), below floor(2428.5) — dead zone
    expect(priceBand(1619, 800)).toBe('great-alternative'); // >20% below
  });
  it('high tier (5000-15000): similar band unaffected by step-up change', () => {
    expect(priceBand(8000, 9000)).toBe('similar');
    expect(priceBand(8000, 9300)).toBe(null); // above hi(9200), below floor(12000) — dead zone
  });
  it('premium tier (15000+): similar band unaffected by step-up change', () => {
    expect(priceBand(20000, 21999)).toBe('similar');
    expect(priceBand(20000, 22001)).toBe(null); // above hi(22000), below floor(30000) — dead zone
    expect(priceBand(20000, 17000)).toBe('great-alternative');
  });
```

- [ ] **Step 3: Replace the `describe('step-up ceiling', ...)` block (lines 330-346) with floor/ceiling tests**

```ts
  // Step-up is now an explicit price tier: [subjectPrice*1.5, subjectPrice*1.6].
  // Anything priced between the similar band's `hi` and the 1.5x floor is a
  // deliberate dead zone (excluded, not mislabeled). See recommender.ts priceBand.
  describe('step-up floor and ceiling', () => {
    it('just below the floor is excluded (dead zone), not step-up', () => {
      expect(priceBand(1000, 1499)).toBe(null); // < floor(1500)
    });
    it('at or above the floor and within the ceiling is step-up', () => {
      expect(priceBand(1000, 1500)).toBe('step-up'); // == floor
      expect(priceBand(1000, 1550)).toBe('step-up');
      expect(priceBand(1000, 1600)).toBe('step-up'); // == ceiling
    });
    it('beyond the ceiling is excluded (null), not step-up', () => {
      expect(priceBand(1000, 1601)).toBe(null); // just over ceiling(1600)
      expect(priceBand(1000, 1800)).toBe(null);
    });
    it('a large price jump (real-world example: 3818 -> 10208, ~2.67x) is excluded', () => {
      expect(priceBand(3818, 10208)).toBe(null);
    });
  });
```

- [ ] **Step 4: Run the `priceBand` test suite in isolation**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/recommender.test.ts -t "priceBand"`
Expected: all `priceBand` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "test(recommender): update priceBand tests for 1.5x-1.6x step-up window"
```

---

### Task 3: Fix `getRecommendationsWithBands` fixture tests that assumed the old step-up window

**Files:**
- Modify: `apps/catalog/lib/__tests__/recommender.test.ts:524-549`

- [ ] **Step 1: Update the "alternates similar/step-up" test's fixture prices and comment**

Subject price 1600 → new step-up window is [2400, 2560]. Replace lines 524-537:

```ts
  it('alternates similar/step-up while BOTH pools have candidates', () => {
    // Subject 1600: similar range is 1280-1920 (±20%, mid tier). Step-up window
    // is now [1600*1.5, 1600*1.6] = [2400, 2560] — 5 similar (within ±20% of
    // 1600) + 5 step-up (within the new floor/ceiling) — both pools deep enough
    // that the canonical slot order is never forced into fallback.
    const subject = mkProduct('S', 1600);
    const similar = Array.from({ length: 5 }, (_, i) => mkProduct(`SIM${i}`, 1500 + i * 20));
    const stepUp = Array.from({ length: 5 }, (_, i) => mkProduct(`UP${i}`, 2410 + i * 30));
    const results = getRecommendationsWithBands(subject, [subject, ...similar, ...stepUp]);
    expect(results.map(r => r.band)).toEqual([
      'similar', 'step-up', 'similar', 'step-up',
      'similar', 'step-up', 'similar', 'step-up',
    ]);
  });
```

- [ ] **Step 2: Update the fallback/adjacency test's fixture prices and comment**

Replace lines 538-549:

```ts
  // NOTE: adjacency of two step-up slots IS allowed once the similar pool
  // exhausts — the fallback (popAny) intentionally fills remaining slots from
  // whatever band is left rather than returning fewer items. Pin that too:
  it('falls back to remaining band when preferred band exhausts (adjacency allowed)', () => {
    // Step-up window for subject 1600 is [2400, 2560] — all candidates here
    // stay within it so they band as step-up rather than being excluded (null).
    const subject = mkProduct('S', 1600);
    const stepUpOnly = Array.from({ length: 10 }, (_, i) => mkProduct(`UP${i}`, 2405 + i * 15));
    const results = getRecommendationsWithBands(subject, [subject, ...stepUpOnly]);
    expect(results.length).toBe(8);
    expect(results.every(r => r.band === 'step-up')).toBe(true);
  });
```

- [ ] **Step 3: Run the full `getRecommendationsWithBands` describe block**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/recommender.test.ts -t "getRecommendationsWithBands"`
Expected: all tests PASS, including `'alternates similar/step-up...'` and `'falls back to remaining band...'`.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/lib/__tests__/recommender.test.ts
git commit -m "test(recommender): fix step-up fixture prices for widened floor/ceiling"
```

---

### Task 4: Full test suite + build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire recommender test file**

Run: `cd "apps/catalog" && npx vitest run lib/__tests__/recommender.test.ts`
Expected: all tests PASS (no regressions in scoring, bucketing, or precompute tests, which are untouched by this change).

- [ ] **Step 2: Run the full catalog test suite**

Run: `cd "apps/catalog" && npx vitest run`
Expected: all tests PASS. (If any other test file references `priceBand` step-up prices near the old 15-35% window, e.g. a `page.tsx`/integration-style test, fix its fixture prices the same way as Task 3.)

- [ ] **Step 3: Run the catalog build**

Run: `cd "apps/catalog" && npm run build`
Expected: build succeeds. This regenerates nothing in `data/recs-cache.json` automatically — see Task 5.

- [ ] **Step 4: Commit if any additional fixture fixes were needed**

```bash
git add -A
git commit -m "test: fix remaining step-up fixture prices found during full suite run"
```

(Skip this commit if Step 2 required no changes.)

---

### Task 5: Regenerate the recommendations cache and verify in the UI

**Why this task exists:** `apps/catalog/app/product/[sku]/page.tsx` reads `data/recs-cache.json` (built once by `scripts/gen-recs-cache.mjs`), not live `precomputeRecommendations()` calls, per the existing "Next.js build workers don't share module memoization" pattern. Changing `priceBand()` alone does nothing for users until this cache is regenerated — this is a UI-facing change and requires browser verification per project rules (CLAUDE.md Rule 7).

**Files:**
- Regenerate: `data/recs-cache.json` (or wherever `gen-recs-cache.mjs` writes it — confirm path in that script before running)

- [ ] **Step 1: Locate and confirm the cache generation script**

Run: `find "apps/catalog" -iname "gen-recs-cache*"`
Read the script to confirm its output path and how it's invoked (npm script name, e.g. `npm run gen-recs-cache` — check `apps/catalog/package.json` `scripts` block).

- [ ] **Step 2: Regenerate the cache**

Run whatever command Step 1 identified (e.g. `cd "apps/catalog" && npm run gen-recs-cache` or `node scripts/gen-recs-cache.mjs`).
Expected: script completes, cache file's mtime updates.

- [ ] **Step 3: Confirm the cache file changed**

Run: `git status apps/catalog/data/recs-cache.json` (or correct path) and/or `git diff --stat` on that file.
Expected: file shows as modified.

- [ ] **Step 4: Start the catalog dev server**

Run: `cd "apps/catalog" && npm run dev` (background). Per project memory, catalog dev server runs on port 3100, not 3212 — if you get a "Cannot find module" 500 error, `rm -rf .next` and restart.

- [ ] **Step 5: Browser-verify WRW2139AC's "You might also like" rail**

Open `http://localhost:3100/product/WRW2139AC` in a browser. Confirm:
- The "Step up ↑" badged item(s) are now priced noticeably higher than before (≥50% above WRW2139AC's price, per the design doc's math: for a ฿5,400 product, step-up should sit in ฿8,100-฿8,640, not ฿6,210-฿7,290).
- The rail still renders 8 items (or fewer, gracefully, if the bucket has no qualifying step-up candidate — check console/no crash).
- Spot-check 1-2 other product pages across different price tiers (e.g. a budget item <฿1,000 and a premium item >฿15,000) to confirm step-up badges show a real price jump and the page doesn't crash when a step-up pool is empty.

- [ ] **Step 6: Commit the regenerated cache**

```bash
git add apps/catalog/data/recs-cache.json
git commit -m "chore(data): regenerate recs cache for widened step-up price gap"
```

(Adjust path if Task 5 Step 1 found a different location, e.g. top-level `data/recs-cache.json` instead of under `apps/catalog/`.)

---

## Notes for the implementing engineer

- Do not touch `RecsCarousel.tsx`'s `byPriceAscending` sort or `ProductCard.tsx`'s badge rendering — those are presentation-only and already correct for any band mix.
- Do not "fix" the dead zone by stretching `similarRange`'s `hi` — this was explicitly discussed and rejected by the user; the gap between similar and step-up is intentional.
- If the full test suite (Task 4) surfaces other test files with hardcoded step-up-window prices (e.g. an integration test on `page.tsx` or `precomputeRecommendations`), apply the same fixture-price-update approach: recompute what floor/ceiling those subject prices now imply, and pick candidate prices that clearly land in `similar`, dead-zone, or step-up as the test intends.
