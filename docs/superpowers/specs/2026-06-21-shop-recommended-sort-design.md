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

Each product gets a comparison tuple, compared left-to-right (earlier = nearer the
front of the grid):

1. **In stock** — in-stock (`true`) before out-of-stock (`false`).
2. **Has popularity score** — scored before unscored.
3. **Popularity score, DESC** — higher sales first. (Only discriminates within the
   scored tier; unscored rows are equal here.)
4. **Premium, DESC** — `price` descending. Pushes high-value up; also the primary
   ordering of the unscored in-stock tier.
5. **Name A–Z** — final stable, deterministic tiebreaker (locale-aware,
   case-insensitive). Guarantees identical order across runs.

Resulting macro-order:
```
in-stock + scored        (by popularity desc, then price desc)
in-stock + unscored      (by price desc)
out-of-stock             (same internal order: scored→unscored, popularity, price)
```
This is exactly the user's "below scored, above out-of-stock" choice, with
out-of-stock as the lowest tier overall.

### `popularity_tier` derivation
- `popularity_score` absent / not numeric → tier **0**.
- `popularity_score > 0` and **>= top-quartile cutoff** of scored products → tier **2**.
- otherwise (scored, below cutoff) → tier **1**.

The top-quartile cutoff is computed once at load over the scored population. (Exact
percentile to be finalized in the plan; default p75.)

---

## 5. Where the code goes

### 5.1 `lib/catalog-data.ts` (server, build-time)
- Add `'popularity_tier'` to `PUBLIC_FIELDS` and to `PublicProduct` (`types.ts`),
  keeping the compile-time drift guard satisfied.
- In `toPublicProduct`, after the allowlist copy and `is_in_stock` normalization,
  read the **raw** `popularity_score` and compute:
  - `out.popularity_tier` (0/1/2), and
  - an internal, NON-public sort key carried only for ordering — implemented as a
    private numeric `__rank` used by the load step and then **not retained on the
    public object** (or computed in a parallel array). The raw score itself is
    never written to `out`.
- In `load()`, after building the array, **sort it once** by the tuple in §4 so
  `getAllProducts()` returns Recommended order. The top-quartile cutoff is computed
  here (single pass over scored rows) before the sort.

> Rationale for sorting here rather than in `shop-query.ts`: the comparator needs
> the raw `popularity_score`, which is deliberately absent from `PublicProduct`.
> Keeping the score-aware sort at the load chokepoint is the only place it is in
> scope without leaking. The data is process-cached SSG data; popularity syncs
> daily, so a once-at-load sort is correct and cheap.

### 5.2 `lib/shop-query.ts` (pure, unit-tested)
- Add `'recommended'` to `SortKey` and the `SORTS` map.
- Make `'recommended'` the **default**: `SORTS[firstParam(params.sort) ?? ''] ?? 'recommended'`.
- For `sort === 'recommended'`: **preserve the incoming array order** (products
  arrive pre-ranked from `getAllProducts()`); do NOT re-sort. Filtering still runs
  via the shared `matchesFilters` predicate, so facet counts are unaffected.
- For `name` / `price-asc` / `price-desc`: unchanged (explicit user re-sort).

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
  stock/score/price, `getAllProducts()` returns the §4 tier order;
  `popularity_tier` is 0/1/2 as specified; `popularity_score` is ABSENT from every
  public object (leak guard); drift guard still compiles.

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
