# Critic-Score Badge — Design Spec

**Date:** 2026-06-20
**Branch:** feat/wnlq9-catalog (critic-reviews work)
**Status:** Approved design, pre-implementation
**Depends on:** critic-score data load (committed `70b5476`; 1,550 products carry `score_max` + `score_summary`)

## 1. What we're building

A presentational React component, `CriticScoreBadge`, that renders the critic scores
already present on every product (`score_max` + `score_summary`) in two forms:

- **`detail`** — a segmented "data strip" for the product detail panel. One cell per
  critic; the cell that contributed `score_max` carries a gold accent.
- **`compact`** — a small blurred-glass pill pinned to the top-right of a product
  thumbnail in grid/card views. Shows the lead score + critic abbreviation + `+N`
  overflow count.

No new data, no API change, no DB write. This is **render-only** — it consumes fields
that already ship in `live_products_export.json` and the explore products API.

### Out of scope (v1)
- Click-through to the critic's source page (no `url` in current `score_summary`).
- `community` and `medals` arrays (always empty in current data; render nothing).
- Tooltip with full tasting notes (the prose lives in `critic_scores.notes`, not in
  `score_summary`; defer to v2 if wanted).
- Any change to `score_summary` shape or the loader.

## 2. Data contract (verified against live export)

`score_max` arrives as a `number` (e.g. `100.0`). `score_summary` arrives as a **JSON
string** that must be parsed:

```json
{
  "critics": [
    {"abbr":"JS","critic":"James Suckling","score_native":"100","score_value":100.0},
    {"abbr":"WA","critic":"Wine Advocate","score_native":"99","score_value":99.0}
  ],
  "community": [], "medals": [],
  "primary_source": "magento_csv_2026-06-15",
  "rows_total": 3, "computed_at": "..."
}
```

- `critics[]` is **already sorted** `score_value` descending (loader guarantees this).
- `score_native` is the display string ("100", "94"); `score_value` is numeric for math.
- The **lead critic** = the first entry whose `score_value === score_max`. If none
  matches (shouldn't happen), fall back to `critics[0]`.

Both fields are already declared on `ExploreProduct` (`lib/explore/types.ts:141-142`).

## 3. Component API

```ts
// components/product/CriticScoreBadge.tsx
export interface CriticScoreBadgeProps {
  scoreMax?: number | null;
  scoreSummary?: string | null;   // JSON string from the export
  variant: "detail" | "compact";
  theme?: "dark" | "light";        // default "dark"
  maxCritics?: number;             // detail only; default 4
}
```

**Render-nothing contract:** if `scoreMax` is null/undefined OR the parsed
`critics[]` is empty, the component returns `null`. Callers can render it
unconditionally — no scored product, no badge, no empty box.

### Parsing safety
`score_summary` is parsed inside a `try/catch`. Malformed JSON → treat as no critics →
render `null`. A single bad row must never throw and blank a product card. There is one
parse helper, unit-tested, shared by both variants.

## 4. Visual design (approved)

Palette: luxury gold accent `#A16207`-family (matches existing `wine_classification`
amber chips; WCAG-checked ≥3:1 for the large score glyph, ≥4.5:1 for labels).

### detail variant
- A small uppercase label "Critic Scores", then a segmented strip:
  `inline-flex`, `rounded-[10px]`, hairline divider between cells.
- Each cell: critic abbr (`text-[9.5px]` uppercase, muted) over score
  (`text-base font-bold`, **tabular-nums**).
- Lead cell: subtle gold vertical gradient background + gold-tinted text.
- Caps at `maxCritics` (default 4); the lead is always included.

### compact variant
- Pill positioned `absolute top-2 right-2` over the thumbnail; parent must be
  `relative`. `backdrop-blur`, semi-opaque surface, gold hairline border.
- Content: lead `score_native` (`text-[13px] font-extrabold`) + lead `abbr` +
  `+N` where N = remaining critic count (omit if 0).
- min tap/hit area respected; non-interactive in v1 (no onClick), so no 44px rule,
  but kept ≥24px tall for legibility.

### Accessibility
- Wrapper carries an `aria-label`: e.g. `"Critic scores: Wine Advocate 100, James
  Suckling 98, Wine Spectator 97"` built from the parsed list, so screen readers get
  the full set even in the compact `+N` form.
- Color is never the sole signal — every score is paired with its critic abbr/name.
- `title` attr on compact pill mirrors the aria-label for mouse hover.

## 5. Integration points

1. **Detail panel** — `components/product/ProductDetailPanel.tsx`. Insert a
   `<CriticScoreBadge variant="detail" .../>` block immediately after the stats grid
   (after the Confidence tile / `ConfBar`), inside Card 1. Passes `theme` through.
   Renders nothing for unscored products, so no layout placeholder.

2. **Compact / grid** — the badge is self-contained and drop-in for any tile whose
   image wrapper is `position:relative`. v1 wires it into the product thumbnail in the
   explore grid surface. Because most tile components don't yet pass the full product,
   integration is limited to surfaces that already have `score_max`/`score_summary` on
   their product object; others are a follow-up (noted, not silently skipped).

## 6. Testing

**Runner reality:** the root PIM app (where `ProductDetailPanel` lives) has **no**
test runner. `vitest` + `@testing-library/react` exist only under `apps/catalog`.
Root-app component-render tests are therefore **not runnable** here. We do not pretend
otherwise.

- **Unit (parse helper) — runnable:** the parse helper is a pure function in its own
  module (`lib/explore/critic-score.ts`, no React import), exercised by a standalone
  `tsx` script (`scripts/check_critic_badge_parse.ts`) asserting: valid summary →
  sorted critics; malformed JSON → `[]`; empty critics → `[]`; lead selection picks the
  `score_max` match; `+N` overflow count correct. Runs and must pass before commit.
- **Component render — manual, not automated** (no runner): covered by the browser
  walkthrough below, not a unit test. Stated plainly per the no-fake-green rule.
- **Browser verification (Rule 7) — the real proof:** dev server, open known scored
  SKUs (`WRW1766AE`, `WRW2301BN`) in the detail panel; confirm strip renders, gold lead
  is the WA/JS 100, light + dark both legible. Confirm an unscored SKU shows no badge
  and **no empty gap**. Screenshot both states.

## 7. Files

```
lib/explore/critic-score.ts                  # new — pure parse helper (no React), unit-testable
components/product/CriticScoreBadge.tsx       # new — the component (both variants)
components/product/ProductDetailPanel.tsx     # edit — insert detail badge after stats grid
scripts/check_critic_badge_parse.ts           # new — standalone tsx assertions for the parse helper
```

The parse helper is split out specifically so it can be tested without a React runner.
Visual proof of the component is the Rule 7 browser walkthrough, screenshotted.
