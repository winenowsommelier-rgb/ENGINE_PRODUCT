# Catalog brand/name de-duplication + clickable brand filter

Date: 2026-09-05
Branch: `worktree-catalog-brand-name-dedup`

## Problem

On both the catalog grid card and the product detail page (PDP), the
brand/producer name is shown twice: once as a standalone eyebrow/subtitle
label, and again as the leading words of the full item name (e.g. brand
"Talenti" above the title "Talenti Brunello di Montalcino 'Piero' DOCG").
This wastes horizontal/vertical space, reads as repetitive, and buries the
information that actually differentiates the item (varietal, vineyard,
vintage detail) further down/right than necessary.

## Ground truth established during brainstorming (verified against real data)

- **Rendering sites**, both currently unprocessed (`product.name` and
  `product.brand` rendered as two independent raw strings, no dedup):
  - `apps/catalog/components/ProductCard.tsx:227-234` — grid card title (`h3`)
    + subtitle (`<p>`), where `subtitle = product.brand || product.region`
    (`ProductCard.tsx:109`).
  - `apps/catalog/app/product/[sku]/page.tsx:396-403` — PDP brand eyebrow
    (`<p className="... uppercase ...">`) directly above the `<h1>` title.
  - `apps/catalog/components/QuickView.tsx:72` — the "quick look" modal has
    the identical `subtitle = product.brand || product.region` pattern and
    the identical duplication bug. Not in the original ask, but same root
    cause; fixed as part of this change since it's the same one-line call
    site pattern, not a separate feature.
- **Data model** (`apps/catalog/lib/types.ts`): `PublicProduct.name: string`
  (required), `PublicProduct.brand?: string` (optional). No `manufacturer`/
  `producer` field exists. Both fields sourced from
  `data/live_products_export.json` via the `PUBLIC_FIELDS` allowlist.
- **Overlap pattern**, checked across all 11,832 live records with both
  fields populated (as of the `data/live_products_export.json` snapshot
  read during brainstorming, 2026-09-05; this file is regenerated
  regularly by unrelated pipeline work, so exact counts will drift —
  the percentages below are illustrative of the shape, not a number to
  re-verify against a later snapshot):
  - **90.5%** (10,707) — `name` starts with `brand` as an exact,
    byte-for-byte prefix (module whitespace), e.g. `"Talenti Brunello di
    Montalcino \"Piero\" DOCG"` / `"Talenti"`.
  - **3.2%** (380) — prefix match only after normalizing case/punctuation,
    e.g. name `"VIK Milla Cala"` vs brand `"Vik"`; name `"R.A.W. Really
    Awesome Wine..."` vs brand `"RAW"`.
  - **6.3%** (745) — `name` does not start with `brand` at all, e.g. name
    `"Tournon Victoria Shiraz"` / brand `"M. Chapoutier"` (sub-label under a
    parent house); name `"District Series Napa Valley Cabernet Sauvignon"`
    / brand `"Precision"` (product line name, not the winery); name
    `"El Coto Rioja Crianza"` / brand `"El Coto de Rioja"` (shortened form
    in the name).
- **User decision on the 3.2% fuzzy-match case**: exact prefix match only
  (no case/punctuation normalization). These items keep showing brand +
  full name, same as the 6.3% non-matching group. Simpler, zero
  false-positive risk, accepted trade-off of leaving ~3.2% not fully
  deduped.
- **User decision on the 6.3% non-matching case**: show both, brand first —
  i.e. unchanged from current behavior. There is nothing to strip since the
  name doesn't restate the brand.
- **No existing dedup/strip utility** — grepped for `strip`/`dedupe` near
  `brand`/`name` across `apps/catalog`; none exists. Both render sites call
  `product.name` and `product.brand` directly with no intermediate
  transform.
- **No brand-page or brand-filter infrastructure exists**:
  - `components/Filters.tsx` filter dimensions (verified against
    `matchesFilters()` in `lib/shop-query.ts:163-233`): `group`, `class`,
    `price`, `country`, `region`, `subregion`, `appellation`,
    `designation`, `grape`, `flavor`, `body`, `acidity`, `tannin`, plus
    boolean toggles `inStock`/`hasScore`/`bev`, and `sort`/`page`. No
    `brand` clause.
  - `app/shop/page.tsx` is a server component reading filter state
    exclusively from `searchParams` (URL is the single source of truth,
    confirmed by comment in `Filters.tsx:44-47`); `normalizeShopParams()`
    (`lib/shop-query.ts:90`) passes through arbitrary keys with no
    allowlist that would reject a new `brand` param.
  - `lib/search-index.ts` full-text search (`name`/`brand`/`region`/`sku`)
    is a separate client-side typeahead (`SearchOverlay`) against a static
    `public/search-index.json` — unrelated to the shop grid's URL-driven
    filtering, not reusable as-is for a grid filter.
  - No slugify/encoding utility exists anywhere in the repo; the app relies
    on `URLSearchParams`, which already round-trips brand names containing
    spaces and punctuation (e.g. `"Max Ferd. Richter"`,
    `"R.A.W. Really Awesome Wine"`) correctly via standard
    encode/decodeURIComponent.
- **User decision on brand click-through**: link to the existing
  `/shop` grid filtered by `?brand=...`, reusing `matchesFilters()`
  (same shape as the existing `country` clause). A richer dedicated
  `/brand/[slug]` page (logo, story, description) is explicitly deferred
  as a separate future spec — it needs a brand data model that doesn't
  exist yet (no logo/description/story field on any product or lookup
  file today).

## Decisions

1. **New pure helper, `stripBrandPrefix(name, brand)`.** Lives in
   `apps/catalog/lib/` (colocated with other small display-formatting
   helpers, not a new subsystem). Behavior:
   - If `brand` is falsy or blank (empty/whitespace-only after `trim()`),
     return `name` unchanged.
   - Match against the **original, uncollapsed** `name` — never collapse
     whitespace and re-slice, since that would desync indices between the
     collapsed string used for comparison and the original string being
     sliced. Concretely: if `name.startsWith(brand)` is true, take
     everything in `name` after `brand.length`, then strip any run of
     leading whitespace from that remainder with `remainder.replace(/^\s+/, '')`.
     This handles the common double-internal-space case correctly. Worked
     example, for a clean-match case with two spaces after the brand — name
     `"Talenti  Brunello di Montalcino \"Piero\" DOCG"` + brand `"Talenti"`:
     `name.slice(7)` gives `"  Brunello di Montalcino \"Piero\" DOCG"`;
     stripping the leading whitespace gives
     `"Brunello di Montalcino \"Piero\" DOCG"`. No whitespace collapsing is
     applied anywhere else in the string — only the leading run right after
     the removed prefix is trimmed.
   - This is an exact, case-sensitive prefix check (`String.startsWith`,
     not a normalized/case-insensitive comparison) — matches the "exact
     match only" decision below for the 3.2% fuzzy-case group.
   - Otherwise (`name` does not start with `brand`), return `name`
     unchanged.
   - If stripping would leave an empty string after trimming (defensive:
     `name === brand` exactly, or `name` is `brand` plus only trailing
     whitespace), return the original `name` instead of a blank title.
   - This is a pure string function: no I/O, no async, trivially unit
     testable with the sample pairs captured above.

2. **Apply at three render sites only; leave every other use of
   `product.name` untouched.**
   - `ProductCard.tsx` title: `stripBrandPrefix(product.name, product.brand)`.
     Subtitle (brand/region line) unchanged.
   - `QuickView.tsx`: same change, same call shape.
   - `app/product/[sku]/page.tsx` PDP `<h1>`: same change. Brand eyebrow
     unchanged.
   - Explicitly **not** touched: breadcrumb, `generateMetadata`
     (`<title>`/meta description), `ViewItemTracker` GA4 payload,
     `buildContactLinks` prefill text, `JsonLd` structured data,
     `TasteWheel`'s varietal-label fallback. These are SEO/analytics/
     integration surfaces where the complete, canonical name is required
     and expected — shortening them would be a regression, not an
     improvement.

3. **Brand becomes a link on both card and PDP**, pointing at
   `` `/shop?brand=${encodeURIComponent(product.brand)}` ``. Uses the
   existing Next `Link` component already imported in both files for other
   navigation.

4. **One new filter clause in `matchesFilters()`** (`lib/shop-query.ts`),
   mirroring the existing `country` clause: case-insensitive exact match of
   `params.brand` against `p.brand`. Not substring match — avoids `"Kir"`
   incidentally matching `"Kirkland"`-style collisions. No changes needed
   to `normalizeShopParams()`, `shopFacets()` is out of scope (no "Brand"
   facet UI is being added — the filter is reachable via the link, not via
   a new facet in `Filters.tsx`).

## Explicitly out of scope

- A dedicated `/brand/[slug]` page with logo/description/story. No brand
  data model exists to power it; deferred to a future spec.
- A "Brand" facet/checkbox group inside `components/Filters.tsx`. The
  `?brand=` param is reachable today only via clicking a brand name, not
  via manual facet browsing — adding a full facet UI (with counts) is
  separate scope the user did not ask for.
- Fuzzy/normalized brand-prefix matching for the 3.2% case (VIK/Vik,
  R.A.W./RAW) — user chose exact-match-only.
- Any change to `data/live_products_export.json`, `brand_lookup.json`, or
  any data pipeline. This is a pure display-layer change reading existing
  fields as-is.

## Testing

- Unit tests for `stripBrandPrefix()` covering: clean prefix (Talenti
  case), multi-word brand (Coastal Ridge), brand with internal punctuation
  (Max Ferd. Richter), double-internal-space after the brand (name
  `"Coastal Ridge  Cabernet Sauvignon"`, brand `"Coastal Ridge"` → expect
  `"Cabernet Sauvignon"` with the leading double-space collapsed away, per
  the worked slicing example above), no-match case (Tournon/M. Chapoutier
  — returned unchanged), brand === name exactly (returns original, not
  empty), no brand or blank/whitespace-only brand (returns name
  unchanged), brand not a prefix due to case only (VIK/Vik — returned
  unchanged per exact-match decision).
- Manual browser verification (per project Rule 7): load `/shop`, confirm
  card titles no longer repeat the brand for common cases (Talenti,
  Ardbeg, AnCnoc from the current catalog view) and still show both for a
  known non-matching case (Tournon / M. Chapoutier or similar); click a
  brand name and confirm it navigates to `/shop?brand=...` showing only
  that brand's products; load a PDP and confirm the same title shortening
  and clickable eyebrow.
