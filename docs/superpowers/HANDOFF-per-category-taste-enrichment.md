# HANDOFF — Per-category taste-profile enrichment (the "new gauges" half)

> Paste the **Prompt** section below into a fresh Claude Code session to continue.
> Everything above it is grounding context gathered 2026-06-29.

---

## Where we are (what already shipped)

PR #62 (`12f7609`, merged to `main`, live on `wnlq9.shop`) added a **per-category
axis gate** to the product-page Taste profile. It SUPPRESSES gauges that don't
apply to a category — it did NOT add any new gauges or new data.

- Config: `AXES_BY_GROUP` + `TANNIN_TYPES` in `apps/catalog/lib/taste-adapter.ts`.
- Applied in `toStructural(product)`; category resolved via
  `groupForProduct`/`typeForProduct` (SKU-derived; export carries no group field).
- Tests: `apps/catalog/lib/__tests__/taste-adapter.test.ts` (21 pass incl. 7 gating).
- Gauge component: `apps/catalog/components/product/StructuralGauges.tsx`
  (`SCALE_DEFINITIONS` is the source of truth for which axes a gauge can render).

This handoff is the **second half** of the user's original question
("should each category have its OWN taste profile?"): giving categories the
axes that actually matter for them — whisky Smoke/Peat, liqueur Bitterness,
sparkling Carbonation, plus Intensity.

## What the component already supports vs what the data has (VERIFIED 2026-06-29)

Component `SCALE_DEFINITIONS` axes: body, acidity, tannin, sweetness,
**bitterness, carbonation, intensity** (all on a 4-step scale).

Export field reality (`data/live_products_export.json`, 11,436 rows):

| Axis        | Export field   | State |
|-------------|----------------|-------|
| body/acidity/tannin/sweetness | present | already wired + gated (PR #62) |
| **intensity**   | `intensity`  | key exists, **0 rows populated** → needs enrichment |
| **smokiness**   | `smokiness`  | **1,970 rows** (Spirits 1,148 / Whisky 822) BUT values are Phase-A binary `none` (1,899) / `heavy` (71) — NOT on the gauge's 4-step scale, and ~96% are `none` |
| **bitterness**  | (none)       | **absent** → needs enrichment |
| **carbonation** | (none)       | **absent** → needs enrichment |
| smoke / peat    | (none)       | absent (smokiness is the nearest existing signal) |

### Key implication for scope
- A whisky **Smoke** gauge is *nearly* free to wire from `smokiness`, BUT: (a) the
  scale must be mapped (`none`/`heavy` → gauge steps), and (b) with 96% `none`,
  most whiskies would show an empty/low gauge — possibly worse UX than no gauge.
  Decide: re-enrich smokiness to a graded scale, or only show it for `heavy`?
- **Bitterness, carbonation, intensity** have NO usable data → any of these
  requires a **paid enrichment run** → full CLAUDE.md **Rule 10** pre-flight.

## Hard constraints (from CLAUDE.md — do not skip)
- **Rule 10**: backup → 5-SKU canary → cost estimate → USER SIGN-OFF → run →
  verify in UI with a count query. Paid LLM work.
- **Rule 1/4**: verify the field is populated in the user-facing destination
  (`data/live_products_export.json` → live site), not the cache. Cost report must
  include "rows where the user-facing field is populated".
- **Rule 9**: after any DB write, run `.venv/bin/python scripts/refresh_live_export.py`
  AND add the new column to the EXPORT_COLS allowlist or it's silently dropped.
- **Rule 2/6**: never emit a silent-empty gauge; `toStructural` must only emit an
  axis whose value normalises to the component scale (regression-test it).
- **Rule 5**: don't lock in a bug with a test.
- The new axis must also be added to the relevant category's set in
  `AXES_BY_GROUP` (taste-adapter.ts), or the gate will suppress it even when populated.

## Recommended sequencing (my view)
1. **Free win first**: decide whisky Smoke from existing `smokiness`. Either
   re-grade it (paid, small) or display-rule it (free). Ship that alone, verify.
2. **Then** scope ONE paid axis at a time (suggest: liqueur **Bitterness** —
   smallest catalog slice, 378 rows). Canary, estimate, sign-off, run, verify.
3. Carbonation (sparkling+beer) and Intensity last — broader, more cost.
Don't batch all axes into one run; per-axis canaries keep cost controllable and
each gauge independently verifiable.

---

## Prompt (paste this into a fresh session)

> Continue the **per-category taste-profile enrichment** for the WNLQ9 catalog.
> Read `docs/superpowers/HANDOFF-per-category-taste-enrichment.md` first for full
> context. PR #62 already shipped the per-category *suppression* gate
> (`AXES_BY_GROUP` in `apps/catalog/lib/taste-adapter.ts`); this task adds the
> *new* category-specific gauges the component supports (smoke/peat, bitterness,
> carbonation, intensity) by populating their data and wiring them.
>
> Before proposing anything, re-verify the current data state (the handoff's
> table may have drifted): for each candidate axis, query
> `data/live_products_export.json` for the field's per-category fill rate and
> distinct values. Then come back to me with a **brainstorm**, not code:
> 1. Which axis to do FIRST and why (I lean toward the near-free whisky Smoke
>    from the existing `smokiness` field, then liqueur Bitterness as the first
>    paid axis — challenge this if the data says otherwise).
> 2. For any PAID enrichment: a Rule-10 plan (backup, 5-SKU canary, per-SKU cost
>    estimate extrapolated to the full slice, the exact prompt/schema, and the
>    write path) — and STOP for my sign-off before spending money.
> 3. For the whisky Smoke decision specifically: `smokiness` is ~96% `none`
>    today — recommend whether to re-grade it or only show the gauge for graded
>    values, with the UX tradeoff spelled out.
>
> Follow TDD for the `toStructural`/`AXES_BY_GROUP` changes, verify the gauge in
> the served UI (Rule 7), and remember Rule 9 (refresh_live_export + EXPORT_COLS
> allowlist) for any new DB column.
