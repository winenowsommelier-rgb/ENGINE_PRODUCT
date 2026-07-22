# Recommender Quality Audit — Gate-vs-Nudge Sweep + Weight Review

**Date:** 2026-07-22
**Status:** Draft
**Scope:** `apps/catalog/lib/recommender.ts` and `apps/catalog/lib/category-scorer.ts` — the single scoring engine powering every "You might also like" rail, across all product groups (Wine, Whisky, Spirits, Sake & Asian, and any others present).

---

## 1. Background

A team report ("finder cat=red shows white/sparkling results") traced to a real bug in `isEligible()`: wine color (Red/White/Rosé/Sparkling & Champagne) was only a soft +1 score nudge in `scoreCandidateDetailed()`, not a gate, so region/country/price signals could out-vote it. Proven against the live catalog: 92/2,439 in-stock Red Wines (3.8%) had at least one non-red Wine-group item in their rail. Fixed same-day by hard-gating the 4 canonical wine colors in `isEligible()` (see `project_recommender_wine_color_leak_fix.md` and the amendment to `2026-07-08-recommendation-engine-v2-design.md` §5b).

That fix reversed a decision the v2 spec had made deliberately ("Same-group recommendations are always allowed"). This raises the question: **are there other signals across the catalog that are currently additive-only but should be gates, following the same pattern?** And separately: **now that color is fixed, do the remaining weights make sense together within an already-correct bucket?**

This is an audit-and-fix task, not new functionality — same shape as the color-gate fix. No new UI, no new fields, no schema changes.

---

## 2. Goals

1. **Gate-vs-nudge sweep.** For every product group (Wine, Whisky, Spirits, Sake & Asian, and whatever `groupForProduct()` returns beyond `'Unknown'`), identify signals that are currently additive-only in `scoreCandidateDetailed()`/`categorySignalPoints()` but plausibly should exclude a candidate outright — the same class of issue as the wine-color bug. For each candidate signal, **prove or disprove it against the real catalog** (`data/live_products_export.json`) before proposing a fix, the same way the 92/2,439 red-wine leak was proven. No fix ships on a hypothetical.
2. **Weight review.** With color now correctly gated, review whether the remaining weights (region +3, subregion +2, variety +2, country +1, food +1/item, category_type +1, price +1, body/acidity/tannin +1.5 each, sweetness/smokiness +0.5, popularity +1, category-specific overrides +3) still produce sensible top-N results *within* an already-correct bucket. Flag any weight that looks miscalibrated, with real before/after examples — not a blind re-weighting exercise. **The co-purchase bonus (`lib/co-purchase.ts`) is explicitly in scope, not just "varies":** it's a formula (`entry.rate * K * damping`, `K=5`, `damping = min(1, listLength / SUPPORT_FULL_AT)`, `SUPPORT_FULL_AT=5`) whose own code comment calls `SUPPORT_FULL_AT` "a rough proxy, not a calibrated confidence threshold... TODO: replace." Per CLAUDE.md Rule 3 (inherited thresholds are not validated by the caller), `K` and `SUPPORT_FULL_AT` must be sanity-checked against real co-purchase data, not skipped because they're not a flat per-signal weight like the others.

---

## 3. Non-Goals

- **`lib/finder/scoring.ts` and the Finder's own matching** are out of scope. The Finder's category filter (`finderPrefilter`) already hard-gates category before any scoring and was verified correct against live data this session. The Finder's soft signals (body/tannin additive-not-AND-filtered) were a deliberate, already-justified design decision from the sommelier redesign (see `project_finder_sommelier_redesign.md`) — revisiting that tradeoff is not part of this audit.
- **No new category-specific fields.** If the sweep finds a gap that needs a new structured field (e.g. something like `peat_level` for a group that doesn't have an equivalent yet), that's a candidate for a future spec, not built here.
- **No UI changes.** Bands, badges, carousel layout, slot algorithm are unchanged.
- **No re-litigating the wine-color fix itself** — that's shipped. This audit looks for *other* instances of the same pattern.

---

## 4. Candidate Signals to Investigate (starting list, not exhaustive)

Each item below gets the same treatment: read the current code, form a hypothesis, prove/disprove against real data, then only propose a fix for what's proven.

| Group | Candidate signal | Current treatment | Hypothesis to test |
|---|---|---|---|
| Whisky | `smokiness`/`peat_level` | `smokiness` +0.5 (within-1-band), `peat_level` +3 (exact match, category override) | Does a heavily-peated whisky's rail ever surface an unpeated one purely on region/price, in a way that reads as a mismatch (same class as the wine-color bug)? Or is +3 already dominant enough in practice? |
| Spirits (Gin) | `gin_style` | +3 category override, region weight forced to 0 | With region zeroed for gin, does anything else (price/food) let a very different gin style dominate a rail with no style overlap at all (score entirely from non-style signals)? |
| Spirits (Tequila/Mezcal) | `agave_aging` | +3 category override | Does a Blanco ever rail-recommend an Añejo (very different product) purely on brand/price/region, the way white wine leaked into red? Note: `category-scorer.ts`'s own comment confirms 0/11,934 live rows have `category_type === 'Mezcal'` — all mezcal-named products are typed `'Tequila'`. Don't waste time hunting for a separate Mezcal bucket; test within the Tequila type. |
| Wine | `sweetness` | +0.5 within-1-band, Wine/Liqueur only | Low weight — check if a very sweet dessert-adjacent wine ever leaks into a bone-dry wine's rail now that color is fixed (color ≠ sweetness). |
| Sake & Asian | No `category-scorer.ts` override (unlike gin/tequila/rum/whisky/sparkling) — but DOES share the generic smokiness signal (+0.5, `recommender.ts:211`'s `grp` allowlist includes `'Sake & Asian'`) | Base signals + smokiness (+0.5), no dedicated style/class field | Is smokiness alone enough granularity, or does the rail still mix classes that matter (e.g. Junmai vs. Ginjo)? Not "zero style signal" — check whether the *existing* smokiness signal is sufficient before assuming a gap. |
| Cross-cutting | `category_type` weight (+1) vs. everything else, for ALL groups without a `category-scorer.ts` entry: Sake & Asian, Liqueur, Beer & RTD, Non-Alcoholic, Cigars, Events, Accessories (full list per `category-constants.ts`, matching §7) | +1 flat, same as country | These 7 groups rely solely on the generic +1 `category_type` match — same structural weakness the wine bug had, just not yet proven to leak. Test all 7, not just 1-2 examples. |

The audit will likely surface signals beyond this table — this is a starting hypothesis list, not a checklist to close out mechanically.

---

## 5. Method

1. **Read** `scoreCandidateDetailed()`, `isEligible()`, and `category-scorer.ts` completely (already done for this doc; will re-verify at implementation time in case of drift).
2. **For each candidate signal:** write a one-off Node/TS script (same pattern as the `prove_leak.mjs` script used for the color bug — run from a scratch location, never committed) that runs `getRecommendationsWithBands()`/`precomputeRecommendations()` against the real `live_products_export.json` and counts how often the hypothesized mismatch actually occurs.
3. **Report findings** with counts and concrete examples (SKU, name, score breakdown) — same evidence bar as the color-leak proof (92/2,439, 165 slots, named examples).
4. **Present findings to the user** via AskUserQuestion before writing any fix code — each proven gap gets its own fix decision (gate vs. reweight vs. leave as-is), since not every finding necessarily warrants the same treatment as color did.
5. **Only implement fixes for proven, user-approved findings.** Follow TDD (failing test against real behavior first, per `superpowers:test-driven-development`) for each fix, same as the color-gate fix. Present proven findings together in one batch (one AskUserQuestion round covering all proven gaps, one decision per gap) rather than one round-trip per finding, to avoid an unnecessarily long back-and-forth across 6+ candidate signals.
6. **Weight review** happens as a separate pass after the gate sweep: with any new gates in place, re-examine the remaining weight table for internal consistency (e.g. "should 4 shared food tags ever outweigh region+variety combined?") using real examples pulled from the same data, not abstract reasoning.

**Note on new gates and pool starvation:** any new hard gate added inside `isEligible()` is automatically covered by the existing bucket-widening safety net in `precomputeRecommendations()` (region → +category_type → +country → global-by-group, counted via `eligibleCount()`) — the same reason the wine-color gate didn't need widening-chain changes. A new gate's failure mode to watch for is different from a wrong-color leak: instead of a mismatched item appearing, a rail could come back unexpectedly short/empty if the gate is too strict for a thin category. Each gate-sweep finding's evidence-gathering step must check rail length (not just leak count) before and after a proposed gate, the same way `coverage.test.ts` checks "no dead ends" for the Finder.

---

## 6. Testing

- Any new gate follows the same pattern as `WINE_COLOR_TYPES`: unit tests in `recommender.test.ts` (or a new `category-scorer.test.ts` case) plus a real-catalog end-to-end invariant test (mirroring `'wine color purity (real catalog, end-to-end invariant)'`) using the bucketed `precomputeRecommendations()` path for speed (~9s, not a naive O(n²) scan).
- Any weight change gets a before/after test showing the specific real-catalog example that motivated it — same evidentiary standard as the color-gate fix: a named subject SKU, its pre-fix leaked/wrong recommendation, and the post-fix corrected result (e.g. that fix's own record: Spy Valley Pinot Noir, SKU `WRW6118FJ`, dropped a White Wine candidate — `WWW5339FP` Dog Point Sauvignon Blanc — from its rail; see `project_recommender_wine_color_leak_fix.md`).
- Full `apps/catalog` test suite + `npm run build` + a browser walkthrough of at least one affected product page per fixed group, per CLAUDE.md Rule 7.

---

## 7. Open Questions

- Should groups without any `category-scorer.ts` entry (Sake & Asian, Liqueur, Beer & RTD, Non-Alcoholic, Cigars, Events, Accessories) get one, or is the generic signal set sufficient for them? This audit will report what it finds but the decision to invest in new category-specific fields is explicitly deferred (see Non-Goals) — flagged here as a likely output of the audit, not a foregone conclusion.
- If the audit finds zero additional real leaks (i.e. the color bug was the only one), the weight-review pass still proceeds — it's independently useful regardless of gate findings.
