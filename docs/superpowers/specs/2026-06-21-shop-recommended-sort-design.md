# Shop "Recommended" Default Sort — Design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**Scope:** `apps/catalog` — change the default ordering of the `/shop` grid to a
business-optimized "Recommended" ranking; keep A–Z / price sorts selectable.

---

## 1. Goal

The `/shop` grid currently defaults to alphabetical (A–Z by name). That order is
neutral to the business. The catalog's goal is **more traffic + higher
conversion**, so the grid should lead with the products most likely to convert
and deprioritize the ones that won't:

- **In-stock first** — never lead with something a visitor cannot buy.
- **Proven sellers first** — surface products with real sales-popularity signal.
- **Premium (high-price) first** — within ties, push higher-value inventory up.
- **Slow-movers / out-of-stock / non-premium sink** to the bottom.

This becomes the **new default** order ("Recommended"). A–Z and price sorts
remain available in the existing sort dropdown.

---

## 2. Available data (verified against `data/live_products_export.json`)

11,436 rows. Relevant raw fields (present in the export, NOT all public):

| Field | Coverage | Notes |
|---|---|---|
| `popularity_score` | 3,295 / 11,436 (29%) | numeric, nonzero range 0.0001–1.0, median 0.088; synced 2026-06-20; window = 365d (month-bucketed per BI memo). **71% of products have NO score.** |
| `is_in_stock` | 5,655 in stock | stored as `"0"`/`"1"`/null STRING; normalized to real boolean in `toPublicProduct`. |
| `price` | all | min 40 / median 1,600 / p90 7,000 THB. Drives the "premium" notion. |
| `quantity_in_stock` | partial | not required by this design; `is_in_stock` is the stock signal. |

**Decisions locked with the user:**
- **Premium = high price (top tier).** No explicit premium flag exists; price is
  the agreed signal.
- **Precedence: Stock → Popularity → Premium.**
- **Unscored products sit BELOW scored, ABOVE out-of-stock.**
- **This ranking is the new DEFAULT** ("Recommended" sort option).
- **Safety approach A:** compute the rank server-side; the raw `popularity_score`
  never crosses the public allowlist. Only a coarse `popularity_tier` (0/1/2) may
  reach the client.

---

## 3. Safety constraint (the crux)

`apps/catalog/lib/catalog-data.ts` defines `PUBLIC_FIELDS`, the single margin-leak
chokepoint. It **explicitly forbids** `popularity_*` (line 11). The raw
`popularity_score` is sales intel a competitor could scrape per-SKU, so it must
not ship to the browser.

Therefore:
- The **raw score is read only server-side**, inside `toPublicProduct`, where the
  raw row is still in scope (same place `is_in_stock` is normalized today).
- The grid receives products **already in Recommended order**.
- The only popularity-derived value allowed on the public shape is a **coarse
  `popularity_tier: 0 | 1 | 2`** (`0` = no sales data, `1` = sells, `2` = top
  seller). It leaks no more than a human eyeballing featured products would learn.
  It is added to `PUBLIC_FIELDS` and `PublicProduct` (so the drift guard stays
  green) and is available for optional future "Bestseller" badging — it is NOT
  required by the sort itself.

---

## 4. The ranking (strict tiers)

**The comparison tuple below is the SINGLE SOURCE OF TRUTH for ordering.** Each
product gets this tuple, compared left-to-right (earlier = nearer the front):

1. **In stock** — in-stock (`true`) before out-of-stock (`false`). `is_in_stock`
   is the normalized boolean; `null`/absent → `false` (the 98 null rows sink).
2. **Is scored** — scored before unscored. **"Scored" is defined precisely as
   `typeof popularity_score === 'number' && popularity_score > 0`.** A literal
   `0.0` (the single such row) is treated as UNSCORED, so the boundary is
   deterministic.
3. **Popularity score, DESC** — higher sales first. (Only discriminates within the
   scored tier; unscored rows are equal here.)
4. **Premium, DESC** — `price` descending. Pushes high-value up; also the primary
   ordering of the unscored in-stock tier.
5. **Name A–Z** — final stable, deterministic tiebreaker (locale-aware,
   case-insensitive). Guarantees identical order across runs.

The tuple — **not** the prose below — governs every tier, including out-of-stock.
Because element 1 is stock, the entire scored→popularity→price→name ordering
repeats *within* the out-of-stock block too. Resulting macro-order (illustrative,
not authoritative):
```
in-stock + scored        (popularity desc, then price desc, then name)
in-stock + unscored      (price desc, then name)
out-of-stock + scored    (same internal order)
out-of-stock + unscored  (same internal order)
```
This is exactly the user's "below scored, above out-of-stock" choice, with
out-of-stock as the lowest tier overall.

### `popularity_tier` derivation
- Not "scored" (absent / non-numeric / `<= 0`) → tier **0**.
- Scored (`> 0`) and **>= the p75 cutoff** of the scored population → tier **2**.
- Scored and below p75 → tier **1**.

**The cutoff is FIXED at p75** (top quartile of the scored population), computed
once at load (see §5.1 two-pass). Per CLAUDE.md Rule 3, p75 is a chosen constant,
not inherited — it is reviewed here as the "top seller" boundary and is the value
§6's test asserts against. It only affects the cosmetic `popularity_tier`; it does
NOT affect sort order (the sort uses the raw score, element 3).

---

## 5. Where the code goes

### 5.1 `lib/catalog-data.ts` (server, build-time)

**No rank key is ever attached to the public object.** The sort operates on the
RAW rows (where `popularity_score` is in scope); only the already-sorted, projected
products are retained. This is the fix for the leak risk the spec reviewer flagged:
the drift guard checks `PUBLIC_FIELDS ⊆ keyof PublicProduct` but does NOT assert
`out` has no extra keys, so attaching an internal `__rank` to `out` would silently
ship. We never write any popularity-derived value to `out` except the coarse
`popularity_tier`.

Changes:
- Add `'popularity_tier'` to `PUBLIC_FIELDS` and to `PublicProduct` (`types.ts`),
  keeping the compile-time drift guard satisfied.
- `toPublicProduct` gains an optional second parameter `popularityTier?: 0|1|2`.
  After the allowlist copy and `is_in_stock` normalization, it sets
  `out.popularity_tier = popularityTier ?? 0`. It does NOT read `popularity_score`
  itself and never writes the raw score or any `__rank` to `out`.
- Rewrite `load()` as an explicit **two-pass** over the raw rows:
  1. **Pass 1 — cutoff:** collect `popularity_score` of every scored row
     (`typeof === 'number' && > 0`); compute the **p75** cutoff over that scored
     population. (If <4 scored rows exist, cutoff = max → only the max is tier 2;
     edge-case guard so tiny datasets don't crash.)
  2. **Sort the RAW rows** in place (on a shallow copy) by the §4 tuple, reading
     raw `popularity_score`, raw normalized stock, and `price` directly off each
     raw row. No projection yet.
  3. **Pass 2 — project:** map each sorted raw row → derive its tier from the
     cutoff → `toPublicProduct(row, tier)`; push in order. Build `_bySku` here too.
- `getAllProducts()` is unchanged in signature; it now returns Recommended order.

> Rationale for sorting here rather than in `shop-query.ts`: the comparator needs
> the raw `popularity_score`, which is deliberately absent from `PublicProduct`.
> The load chokepoint is the only place the raw score is in scope without leaking.
> The data is process-cached SSG data; popularity syncs daily, so a once-at-load
> sort is correct and cheap.

### 5.2 `lib/shop-query.ts` (pure, unit-tested)
- Add `'recommended'` to `SortKey` and the `SORTS` map.
- Make `'recommended'` the **default**: `SORTS[firstParam(params.sort) ?? ''] ?? 'recommended'`.
- For `sort === 'recommended'`: **preserve the incoming array order** (products
  arrive pre-ranked from `getAllProducts()`); do NOT re-sort. Concretely, the
  branch still builds `sorted` from the filtered `items` (`Array.prototype.filter`
  preserves input order) and paginates `sorted` — it simply skips the `.sort()`
  call. Every existing branch in `applyShopQuery` sorts, so the no-op branch must
  be added explicitly. Filtering still runs via the shared `matchesFilters`
  predicate, so facet counts are unaffected.
- For `name` / `price-asc` / `price-desc`: unchanged (explicit user re-sort).
- `SortKey` (exported) gains `'recommended'`; adding it is additive, but check no
  consumer exhaustively switches on `SortKey` without a default.

> The pure-comparator unit tests operate on the SAFE fields only
> (`is_in_stock`, `popularity_tier`, `price`, `name`). The score-aware ordering is
> validated at the `catalog-data` layer with a small fixture (raw rows in →
> expected order out), so the real score is exercised in a test without ever being
> public.

### 5.3 `components/Filters.tsx`
- Add **"Recommended"** as the first option in the sort dropdown, selected by
  default (value `recommended` or empty = default).

---

## 6. Testing

- **`lib/__tests__/shop-query.test.ts`**: default sort key is `recommended`;
  recommended preserves input order; explicit sorts still reorder; filtering +
  pagination unchanged.
- **`lib/__tests__/catalog-data.test.ts`** (or new): given raw rows with mixed
  stock/score/price, `getAllProducts()` returns the §4 tier order; `popularity_tier`
  is 0/1/2 against the **p75** cutoff; `popularity_score` and `__rank` are ABSENT
  from every public object (leak guard — assert no extra keys, since the drift guard
  alone does not); a `0.0`-score row is treated as unscored; a `null`-stock row
  sinks to the bottom tier; drift guard still compiles.
- **Stale comment to correct (in scope):** `lib/featured.ts:5–6` asserts
  "popularity_score is 0 for all 11,436 products" — now false (3,294 are nonzero).
  Fix that comment so a future reader does not trust the wrong premise.

---

## 7. Verification (CLAUDE.md Rule 7 — UI changes require browser verification)

1. `npm test` (shop-query + catalog-data) — green.
2. `tsc` — clean (drift guard proves no leak).
3. Start dev server; open `http://localhost:3212/shop`:
   - Grid leads with in-stock items; out-of-stock visibly sinks to the last pages.
   - High-popularity / high-price items appear near the front.
   - Sort dropdown shows "Recommended" selected; switching to A–Z / price still works.
4. Confirm via DevTools/network that no `popularity_score` field appears in the
   client payload (only `popularity_tier`).

---

## 8. Out of scope / YAGNI

- No "Bestseller" badge UI in this change (the `popularity_tier` field is added so
  it CAN be done later, but no badge ships now).
- No new popularity computation — uses the existing BI-backfilled
  `popularity_score`. If/when the BI app re-syncs, the order updates on next load.
- No change to filter semantics, pagination, or facet counting.
