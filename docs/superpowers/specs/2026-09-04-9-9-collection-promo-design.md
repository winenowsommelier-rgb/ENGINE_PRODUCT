# 9.9 Collection — Design Spec

Date: 2026-09-04
Status: Approved (brainstorming), pending implementation plan

## Summary

A time-boxed promotional collection ("9.9 COLLECTION") featuring ~240 wine/spirit
SKUs at special prices, live until **9 September 2026 23:59:59 ICT**. Surfaced as
a hero card at the top of `/collections` (above the "Icons & Classifications"
group) linking to a dedicated listing page. After the cutoff, the hero disappears
and the listing page shows an "ended" state automatically — no manual step needed.

Source data: two CSVs supplied by the user —
"9.9 Bartender Pick (win award & limited)" (~87 spirits SKUs, prefix `L*`) and
"9.9 Sommelier pick (90+)" (~150 wine SKUs, prefix `W*`).

## Goals

- Ship a promo collection without touching `products.db` or
  `live_products_export.json` (isolated blast radius — Rule 9/10 spirit).
- Enforce the Sep 9 cutoff automatically via a server-side date check, not a
  human remembering to flip a switch.
- Reuse existing catalog patterns (`getProductBySku`, collection page shape)
  rather than inventing new plumbing.

## Non-goals

- Writing `special_price`/`sp_discount_pct` into the canonical product data.
- A cron job / scheduled task to "archive" the page — a live date check on
  every request is sufficient and simpler. (This replaces the need to
  automate *retirement* of the promo; it does not replace the one-time
  manual *generation* step described below, which a human still runs once.)
- Splitting the grid into Sommelier vs Bartender sub-sections (explicitly
  declined — one combined grid).

## Data Model

New standalone file, isolated from canonical product data:

`data/promo_9_9_collection.json`

```json
{
  "slug": "9-9-collection",
  "name": "9.9 COLLECTION",
  "tagline": "Special prices until 9 September 2026",
  "promoEndDate": "2026-09-09T23:59:59+07:00",
  "items": [
    { "sku": "LWH0474ES", "promoPrice": 2349, "regularPrice": 2585, "discountPct": 9 },
    { "sku": "WRW7495CB", "promoPrice": 7799, "regularPrice": 9800, "discountPct": 20 }
  ]
}
```

Fields:
- `promoPrice` / `regularPrice`: THB, integer (source CSVs use comma-formatted
  strings like `"2,349"` — parsed to numbers by the generator script).
- `discountPct`: from the CSV `Discount %` column where present; recomputed
  from `regularPrice`/`promoPrice` when absent or inconsistent, to avoid
  displaying a stale/wrong percentage (mirrors `resolveSale()`'s own
  percent-off calculation rather than trusting an upstream cell).
- Product identity (name, image, brand, stock status) is **not** duplicated
  into this file — always read live from `getProductBySku(sku)` at render
  time, so the promo page reflects current stock/name/image without needing
  regeneration if the canonical catalog changes.
- Items render in a single mixed grid (Bartender Pick and Sommelier Pick rows
  interleaved, no source-based grouping). Default/"Recommended" order is the
  order items appear in this file's `items` array; the user can re-sort via
  the same sort control used on other collection pages (see Sorting below).

## Generation Script

`apps/catalog/scripts/gen-9-9-collection.mjs` (one-off, run manually, not a
build-time step):

1. Parse both source CSVs, saved at:
   - `data/promo_9_9_bartender_pick.csv`
   - `data/promo_9_9_sommelier_pick.csv`

   Confirm these filenames don't match an existing `.gitignore` pattern
   before committing them (this repo carves out exceptions for some one-off
   CSV inputs already — verify rather than assume). The exact source cutoff
   date (`promoEndDate`, "9 Sep 2026 23:59:59 ICT") must also be
   double-checked against the actual promo terms once before generating —
   it's a literal in the output JSON, not derived from anything, so a wrong
   value here is a silent error the code can't catch.
2. Strip comma thousands-separators and quotes from price fields, parse to
   numbers.
3. Handle `#REF!` rows (~14 in the Bartender Pick file, e.g. Auchentoshan,
   Citadelle, Glenfiddich 12yo, Glengoyne, Tamdhu ×2, The Dalmore, The
   Macallan): fall back to the CSV's `price` column as both `promoPrice` and
   `regularPrice` with `discountPct: 0` — included in the collection at
   regular price, no discount badge (per user decision).
4. For each SKU, call `getProductBySku(sku)` to confirm the product exists in
   `live_products_export.json`. Skip (don't include) any SKU with no match.
5. Print a summary report: total rows read, rows included, rows skipped with
   reason (no product match / `#REF!` fallback used), matching the "cost
   report" spirit of Rule 4 even though no paid API call is involved here —
   this is a data-integrity report, not a spend report.
6. Write `data/promo_9_9_collection.json`.

This script is **not idempotent against re-running with updated CSVs** in a
dangerous way — re-running simply regenerates the file from the current CSV
inputs, which is the intended workflow if the user sends corrected prices for
skipped/`#REF!` SKUs later.

## Rendering

### `apps/catalog/lib/promo-9-9.ts` (new)

```ts
export interface Promo99Item {
  sku: string;
  promoPrice: number;
  regularPrice: number;
  discountPct: number;
}

export interface Promo99Collection {
  slug: string;
  name: string;
  tagline: string;
  promoEndDate: string; // ISO 8601
  items: Promo99Item[];
}

export function getPromo99(): Promo99Collection | null // singleton-cached read of the JSON
export function isPromo99Active(now: Date = new Date()): boolean // false if file missing/malformed, else now < promoEndDate
```

Mirrors the defensive pattern already used by `apps/catalog/lib/collections.ts`
(`getCollections()` returns `[]` rather than throwing when
`collections_export.json` is absent, "so the build must not break before the
file is generated"). Concretely: `getPromo99()` returns `null` and
`isPromo99Active()` returns `false` if `promo_9_9_collection.json` doesn't
exist or fails to parse — never throws. `page.tsx` must only call
`getPromo99()` after `isPromo99Active()` has already confirmed the file
loaded, so a deploy that predates the generator running (or a post-promo
world where the file is deleted) never breaks `/collections`.

### `apps/catalog/app/collections/page.tsx` (modified)

Before the existing `sections.map(...)` group-rendering loop, conditionally
render:

```tsx
const promo99 = getPromo99();
// ...
{promo99 && isPromo99Active() && <Promo99HeroCard promo={promo99} />}
```

This guarantees the hero sits above every group, including "Icons &
Classifications" (which is simply `sortOrder: 0` today), without needing to
touch `collections_export.json` or the group-ordering logic.

### `apps/catalog/components/Promo99HeroCard.tsx` (new)

Text + gradient/color-block background (no image sourcing dependency).
Content: "9.9 COLLECTION" title, tagline from the JSON, item count (e.g. "230
bottles"), single CTA linking to `/collections/9-9-collection`. Visually
distinct from the plain-text `CollectionCard` grid items — full-width, larger,
top of page.

The item count is `promo.items.length` — a static count from the JSON, not a
live re-resolution of every SKU via `getProductBySku`. This is a deliberate
tradeoff: re-checking all ~240 SKUs on every `/collections` page load just to
keep a cosmetic count accurate would be wasteful, and the dedicated listing
page (which does resolve live and can skip a handful of SKUs) is the source
of truth for what's actually purchasable. The hero count may drift slightly
(e.g. say "230 bottles" when 225 currently resolve) — acceptable for a
marketing count, not acceptable for the grid itself.

### `apps/catalog/app/collections/9-9-collection/page.tsx` (new)

Dedicated listing page, modeled on the existing `[slug]/page.tsx` pattern:

- If `!isPromo99Active()`: render an "This promotion has ended" state (not a
  hard 404 — friendly message, link back to `/collections`), so any indexed
  or bookmarked link degrades gracefully after Sep 9.
- If active: for each `Promo99Item`, resolve the live product via
  `getProductBySku(item.sku)`; skip any that no longer resolve (defensive —
  shouldn't happen since the generator already filtered, but the live export
  could change between generation and request). Render one combined grid
  (no Sommelier/Bartender sub-split) showing product image/name (from the
  live product) with `promoPrice` and a strikethrough `regularPrice` +
  `discountPct` badge.
- **Out-of-stock handling**: filter out any resolved product where
  `custom_stock_status === 'CATALOG'` (archived) or `!is_in_stock`, the same
  way archived products are already excluded from the recommender/finder
  (`catalog-data.ts`). A promo page pairs urgency messaging ("special price,
  ends soon") with each item, so showing an out-of-stock bottle here is a
  worse UX bug than on an ordinary browse page — it gets filtered out
  entirely rather than shown with a badge. This also means the grid's
  rendered count can be lower than both the JSON's static count and the
  hero's displayed count; that's expected drift, not a bug.
- **Component reuse**: build the grid on the existing `ProductCard` component
  (already used by `[slug]/page.tsx`), not a new bespoke card. Map each
  resolved `PublicProduct` + its `Promo99Item` into the shape `ProductCard`
  already understands — pass `promoPrice`/`regularPrice` through the same
  props it uses for `special_price`/`price` (so `resolveSale()`-driven
  strikethrough/badge rendering "just works") rather than duplicating that
  display logic in a second component.
- **Sorting**: reuse the existing `SortControl` / `sortHref` / `applyShopQuery`
  mechanism from `[slug]/page.tsx` verbatim, with the same 4 options
  (Recommended / Name A–Z / Price low→high / Price high→low) — no new sort
  key, no discount/%-off sort. `applyShopQuery` and its supporting UI have no
  hard dependency on the `[slug]` dynamic route param (confirmed against the
  actual code); they take the collection's product list and a plain string
  slug (here, the literal `'9-9-collection'`) as inputs. The one real
  adaptation needed: `[slug]/page.tsx` builds its fixed product list via
  `getCollectionBySlug(params.slug)` → `collectionToShopParams(def)`, which
  doesn't apply here (this isn't a `CollectionDef`-filtered set, it's an
  explicit list of SKUs from the promo JSON). Instead, build the base product
  list directly: resolve every `Promo99Item.sku` via `getProductBySku`,
  apply the out-of-stock filter above, then pass that array into
  `applyShopQuery` in place of the `CollectionDef`-derived list, so sorting/
  pagination behave identically to every other collection page. "Recommended"
  order is the promo JSON's `items` array order (post out-of-stock filtering).

## Error Handling / Edge Cases

- **SKU not found in live export**: skipped at generation time, logged in the
  script's summary report. Re-checked defensively at render time too (see
  above) in case the live export changes after generation.
- **`#REF!` source rows**: included at regular price, no discount (per user
  decision), never silently dropped.
- **Past the cutoff**: the hero card (via `isPromo99Active()` on
  `/collections`) and the dedicated page each independently enforce the
  cutoff at their own request time — no manual archive step needed on either
  page. This is a per-request guarantee, not a cross-request one: because
  each page checks `isPromo99Active()` separately (potentially on different
  server instances with sub-second clock differences), there's a narrow
  window right at the boundary where a user could see the hero, then land on
  an already-ended dedicated page a moment later, or vice versa. Acceptable
  for a marketing promo; not a correctness issue for pricing since neither
  page can independently serve a stale price past its own check.
- **Missing/malformed promo file**: `isPromo99Active()` returns `false`
  (never throws) if `promo_9_9_collection.json` doesn't exist or fails to
  parse — see `getPromo99()`/`isPromo99Active()` above. This covers both "the
  generator hasn't been run yet" and "the file was deleted after the promo
  ended."
- **Timezone**: `promoEndDate` is stored with an explicit `+07:00` offset
  (Thailand time) so the cutoff is unambiguous regardless of server TZ.

## Testing

- Unit tests for `isPromo99Active()`: before/at/after the boundary instant.
- Unit tests for the generator script's parsing: comma-stripping, `#REF!`
  fallback, discount recomputation, SKU-miss skip-and-report behavior — run
  against small fixture CSVs (not the full 240-row files).
- A smoke check that every SKU written to `promo_9_9_collection.json`
  resolves via `getProductBySku()` (regression guard against a future manual
  hand-edit of the JSON introducing a bad SKU).
- Browser walkthrough (Rule 7): view `/collections` and confirm the hero
  renders above "Icons & Classifications"; click through to
  `/collections/9-9-collection` and confirm the grid renders with correct
  promo/regular prices; exercise each of the 4 sort options and confirm the
  grid re-orders correctly and pagination still works; manually verify the
  ended-state by temporarily pointing `now` past the cutoff (or via a
  test-only override) rather than waiting for Sep 9 in production.
