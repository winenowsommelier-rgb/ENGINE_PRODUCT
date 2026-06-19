# WNLQ9 Catalog — Dynamic Drill-Down Navigation Design

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Scope:** Add progressive drill-down browsing to the shop page (`apps/catalog/`)
**Builds on:** `2026-06-17-wnlq9-online-catalog-design.md` (the storefront is already live on `feat/wnlq9-catalog`)

---

## 1. Goal

Let users browse the catalog **dynamically** by drilling down two independent hierarchies on the shop page:

- **Category:** top group (Wine) → sub-category/classification (Red Wine, White Wine, Rosé, Sparkling, Champagne…). 2 levels.
- **Geography:** Country (France) → Region (Bordeaux) → Sub-region (Pauillac). 3 levels.

The two hierarchies are **independent and combinable** (AND logic — e.g. "red Bordeaux from Pauillac"). Navigation uses **progressive reveal** (each level appears only after its parent is selected) plus a **clickable breadcrumb** of the active path, to stay calm and uncluttered for the 40+/low-vision audience.

Chosen approach (from brainstorm): **A** (inline filters on /shop) + **A** (independent/combinable) + **C** (progressive reveal + breadcrumb).

---

## 2. Data reality (verified against the live export, 11,436 products)

| Field | Populated | Notes |
|---|---|---|
| `classification` | ~all | already grouped into 6 top groups by `category-groups.ts`; the raw value is the sub-category |
| `country` | 11,406 / 11,436 | 30 missing → absent from geo-filtered views |
| `region` | 10,219 / 11,436 | 1,217 missing |
| `subregion` | 6,307 / 11,436 | many products have no subregion → that level simply won't reveal for them |

**Category sub-levels exist and are meaningful**, e.g. Wine → Red Wine (4,123), White Wine (1,584), Champagne (463), Sparkling Wine (438), Rosé (175), Dessert/Port/Orange/Fruit/Korean. Spirits → Gin/Vodka/Rum/Tequila/Brandy/Liqueur/Mezcal…

**Geography depth exists and is meaningful**, e.g. France → Bordeaux (778) → Pauillac (99), Saint-Émilion (96), Margaux (74), Médoc (71)… 47 of 62 countries have >1 region.

Pipe-delimited classifications (`Red Wine|Fruit Wine`) split on `|`, first segment is the sub-category (consistent with existing `groupForClassification`).

---

## 3. URL model (source of truth — shareable, back-button-safe)

Extends the existing param-driven shop. Param status (VERIFIED against current code):

- `group` (EXISTS) — top category group, e.g. `Wine`
- `class` (NEW) — sub-category/classification, e.g. `Red Wine`
- `country` (EXISTS)
- `region` (**ALREADY EXISTS** — do NOT add a duplicate) — currently a **case-insensitive
  substring** filter (`shop-query.ts`: `norm(p.region).includes(region)`), wired to the
  free-text Region input in "More filters" (`Filters.tsx`). The drill-down **reuses this
  same param**; region chips set the **exact canonical region string** (e.g. `Bordeaux`),
  which the existing substring filter matches correctly. **Keep substring semantics** (don't
  change to exact) so the existing free-text Region input keeps working — a chip value is
  just a precise substring. The drill-down chips and the "More filters" Region text box are
  two writers of the same `region` param; last write wins, breadcrumb reflects whatever value
  is set.
- `subregion` (NEW — genuinely not yet in `applyShopQuery`) — e.g. `Pauillac`. Use the SAME
  case-insensitive substring semantics as `region` for consistency.
- `class` (NEW) — match a product's **first-segment** classification (`split('|')[0]`) to the
  value, case-insensitive exact on that segment.

Example: `/shop?group=Wine&class=Red%20Wine&country=France&region=Bordeaux&subregion=Pauillac`

All combine with AND alongside existing `price`, `sort`, `inStock`, and the "More filters" facets.

**URL encoding:** region/subregion values contain spaces and accents ("Rhône Valley",
"Saint-Émilion"). ALL reads/writes go through `URLSearchParams` / the existing `buildQuery`
helper (never hand-built query strings) so values round-trip correctly. Chip `value` MUST be
the canonical region/subregion string exactly as stored in the data. A unit test asserts an
accented value (e.g. `Saint-Émilion`) round-trips through buildQuery + decode.

**Parent change clears descendants:** changing `group` clears `class`; changing `country`
clears `region` + `subregion`; changing `region` clears `subregion`. **Where this lives:**
NOT in the generic `buildQuery` (it's domain-agnostic and must stay so). Instead, `Filters`
and the breadcrumb construct **multi-key patches** when a parent changes — e.g. selecting a
new group calls `apply({ group: x, class: null })`; a new country calls
`apply({ country: x, region: null, subregion: null })`. A tiny pure helper
`clearDescendants(level, patch)` in **`lib/build-query.ts`** (alongside `buildQuery`, but a
separate exported function — keeps `buildQuery` itself generic) builds the correct null-out
patch for a given level so the logic is unit-testable and not duplicated across Filters and
breadcrumb. (§6 tests import it from there.)

---

## 4. Components & files

All within `apps/catalog/`. Each unit is small, focused, and independently testable.

### 4.1 `lib/facets.ts` (NEW — pure, the heart of "context-aware")
Each facet function takes a **pre-filtered product set** (built by the shop page, §4.5) and
returns the available next-level options **with counts**, sorted, **only options with ≥1
product** (no dead-ends):

- `subCategoriesFor(group: CategoryGroup, products: PublicProduct[]): {value: string; count: number}[]`
  — distinct first-segment classifications within `group` present in `products`.
- `regionsFor(country: string, products: PublicProduct[]): {value: string; count: number}[]`
  — distinct `region` values present in `products`.
- `subRegionsFor(region: string, products: PublicProduct[]): {value: string; count: number}[]`
  — distinct `subregion` values present in `products`.

**Precise input-set rule (the "context-aware" guarantee — REQUIRED, removes ambiguity).**
The shop page builds each function's `products` input by applying **every active filter
EXCEPT the strand level being enumerated**, so option counts equal what the grid would show
if the user picked that option (with all other active filters held). Concretely:

| Facet list | Input `products` = all products filtered by… |
|---|---|
| `subCategoriesFor(group, …)` | everything active EXCEPT `class` (i.e. apply `group`, `country`, `region`, `subregion`, price, inStock) |
| `regionsFor(country, …)` | everything active EXCEPT `region` and `subregion` (apply `group`, `class`, `country`, price, inStock) |
| `subRegionsFor(region, …)` | everything active EXCEPT `subregion` (apply `group`, `class`, `country`, `region`, price, inStock) |

This makes ALL facet lists fully cross-hierarchy aware: "Wine + France" → `regionsFor`
returns only French **wine** regions; sub-category counts reflect an active country/region.
An option yielding 0 results is never returned.

**Implementation:** reuse the existing `applyShopQuery` filter predicate (or factor its
per-product predicate into a shared `matchesFilters(product, params)` so facets and the grid
use IDENTICAL logic — guarantees counts match the grid). Each facet is a single O(n) pass
over the in-memory `getAllProducts()` set (process-cached; no per-request file read). Three
passes total — a few ms, no N+1, on an already-dynamic route (reads `searchParams`).

Reuses `groupForClassification` / `classificationsInGroup` from `category-groups.ts` where helpful.

### 4.2 `lib/shop-query.ts` (EXTEND existing)
`applyShopQuery` already honors `group`, `country`, `region` (substring), price, inStock,
sort, pagination. Changes:
- `class` (NEW) → keep products whose **first-segment** classification (`split('|')[0]`,
  trimmed) case-insensitive-equals the value.
- `region` (ALREADY EXISTS — leave its substring logic; do NOT re-implement or change to
  exact). Drill-down chips reuse it.
- `subregion` (NEW) → case-insensitive **substring** match on `subregion` (same pattern as
  the existing `region` filter, for consistency).
All AND with the rest. Keep the pure-function shape. **Factor the per-product predicate** into
a shared `matchesFilters(product, params): boolean` used by BOTH `applyShopQuery` and
`facets.ts`, so the grid and the facet counts can never diverge.

### 4.3 `components/Filters.tsx` (EXTEND existing)
Progressive reveal:
- **Always visible (calm default):** the 6 top-category chips, the Country dropdown, plus existing Price tiers / Sort / In-stock / "More filters".
- **Revealed on selection:** once a `group` is chosen → a row of **sub-category chips** (with counts) from `subCategoriesFor`. Once a `country` is chosen → **region chips** from `regionsFor`. Once a `region` is chosen → **sub-region chips** from `subRegionsFor`.
- A level with no children renders **no row** (don't show an empty row).
- Each chip shows `value` + `count` (e.g. "Bordeaux 778"), 44px targets, readable 18px, Maison-clean.
- Selecting a chip updates the URL via the existing query builder; selecting a parent clears descendants (multi-key patch, §3).
- **Mobile (≤390px, the 40+/low-vision audience):** progressive reveal limits DEPTH (only the
  current level's row shows), and the breadcrumb collapses the already-chosen upper levels so
  the chosen path never occupies chip rows. Within a single level's row, chips **wrap** (no
  horizontal scroll — wrapping is more discoverable for this audience). At most ~2 active chip
  rows are visible at once (current category level + current geo level), keeping it calm.

The available-option lists (sub-categories, regions, sub-regions for the current selection) are computed **server-side on the shop page** (it already has the full product set + active filters) and passed into `Filters` as props — keeps the heavy compute off the client and the component a thin renderer. `Filters` stays a client component for the URL writes; it receives `availableSubCategories`, `availableRegions`, `availableSubRegions` (each `{value,count}[]`) as props.

### 4.4 `components/Breadcrumb.tsx` (NEW — shop drill-down breadcrumb)
Compact active-path display in the filter area: e.g. `Wine › Red Wine · France › Bordeaux › Pauillac`. (Two visual strands — category and geography — separated clearly.) Each crumb is a link that jumps back to that level (clears all deeper params for that strand). Includes a "Clear all" that resets every drill-down param. 44px targets.

> Naming note: this is the **shop drill-down** breadcrumb, distinct from any product-page breadcrumb. Name the file/component clearly (e.g. `DrillBreadcrumb` or `ShopBreadcrumb`) to avoid collision with the existing product `Breadcrumb` if one exists; verify before naming.

### 4.5 `app/shop/page.tsx` (EXTEND existing)
- Pass `class`/`region`/`subregion` from `searchParams` into `applyShopQuery`.
- Compute the three available-option lists for the current selection (using `facets.ts` against the appropriately-filtered set) and pass to `<Filters>`.
- Render `<DrillBreadcrumb>` with the active path.
- Everything else (grid, pagination, count) unchanged.

---

## 5. Behavior & edge cases

- **Calm default:** only top categories + country dropdown visible; deeper rows appear only as the user commits. Breadcrumb collapses the chosen path so deep navigation never becomes a wall of chips.
- **No dead-ends:** sub-options always come from the live filtered set, so a shown option always returns ≥1 product.
- **Parent change resets descendants** (enforced by Filters/breadcrumb via multi-key patches + the `clearDescendants` helper, §3 — NOT in the generic buildQuery) — pick a new country → region/subregion cleared.
- **Empty levels hidden:** a country with one region, or products lacking subregion, simply don't reveal that row.
- **Stale/invalid params:** a `region` that doesn't match the active `country` (e.g. hand-edited URL) yields 0 matches for that level → it's dropped from the breadcrumb and ignored gracefully; the grid still renders whatever the consistent params select. Don't crash.
- **Missing-geo products:** the 30 no-country / 1,217 no-region / no-subregion products are absent from geo-filtered views, present in unfiltered — expected.
- **Combined with existing facets:** drill-down ANDs with price/sort/in-stock/"More filters".

---

## 6. Testing

- **`facets.ts` (unit):** `subCategoriesFor(Wine, set)` returns wine classifications with correct counts; `regionsFor('France', wineSet)` returns French wine regions only (context-aware) and NOT whisky regions; an option with 0 products is never returned; empty input → `[]`. **Count-accuracy invariant:** a facet option's `count`, computed over "all active filters minus that strand level" (§4.1 table), EQUALS the grid's total after selecting that option with all other active filters held — assert this for a combined category+geo case (e.g. count of "Bordeaux" under group=Wine == number of Wine products in Bordeaux).
- **`shop-query.ts` / `matchesFilters` (unit):** `class` filter (first-segment), `subregion` substring filter, existing `region` substring still works; combined AND (`group=Wine&class=Red Wine&country=France&region=Bordeaux&subregion=Pauillac`) returns exactly the products matching all.
- **`clearDescendants` / patch builder (unit):** new group → `{group, class:null}`; new country → `{country, region:null, subregion:null}`; new region → `{region, subregion:null}`.
- **URL round-trip (unit):** an accented value (`Saint-Émilion`) written via `buildQuery` and read back via `URLSearchParams`/decode is byte-identical.
- **Browser verification (Rule 7):** on the real shop page — select Wine → sub-category chips appear → pick Red Wine; select France → region chips → Bordeaux → sub-region chips → Pauillac; breadcrumb shows the path and each crumb jumps back; combined category+geo narrows correctly; counts match the grid's "Showing N"; no margin/b2b in HTML.
- Keep all existing catalog tests green.

---

## 6.5 Accessories proper sub-categorization (ADDED per user)

The current 6-group map collapses non-beverage items under one **Accessories** group. The user
wants these **separated as proper sub-categories** so accessories are browsable, with **Events
as its own distinct sub-category**. Verified classifications in this group:

| Sub-category | Source classification(s) | Count |
|---|---|---|
| Glassware | `Glassware` | 232 |
| Cigars | `Cigar` | 102 |
| Events | `Events` | 10 |
| Gifts & Other | `Accessories` (generic, 121) + `Others` (85) | ~206 |

(Note: "wine fridge" is only ~2 products and lives under Glassware/Accessories — no own tier
needed. `Non-Alcoholic` (63) + `Mineral Water` (1) belong to the **Beer & RTD** group per the
existing map, NOT Accessories — leave them there.)

**Design:** this is exactly the drill-down (§4): the **Accessories** top group, when selected,
reveals sub-category chips **Glassware · Cigars · Events · Gifts & Other** (via the same
`subCategoriesFor` mechanism). To make the labels friendly and to merge `Accessories`+`Others`
into one "Gifts & Other" chip, add a small **sub-category display map** in `category-groups.ts`
(`SUBCATEGORY_LABELS` / a grouping for the Accessories group) so the raw classifications map to
these clean chip labels — and `class` filtering matches the underlying raw classification(s)
(the "Gifts & Other" chip filters `classification ∈ {Accessories, Others}`). Keep the 6 top
groups unchanged; this only enriches the Accessories drill-down level. Events being its own chip
satisfies "Event as separate."

## 6.6 "More filters" as dropdowns + richer taste/attribute browsing (ADDED per user)

The user wants the advanced facets in "More filters" to be **dropdowns, not free-text inputs**,
and the taste/attribute matrix exposed **as fully as is useful** so users can browse effectively.
Verified value cardinality drives the right control per facet:

| Facet | Distinct values | Control |
|---|---|---|
| Body | 5 (Light…Full) | **Dropdown** (normalized scale order) |
| Acidity | 8 → normalize to 4 (Low/Medium/Medium-High/High) | **Dropdown** (use `normalizeScale` from `taste-adapter.ts` so options are the clean 4-step scale, not raw 8) |
| Tannin | 8 → normalize to 4 | **Dropdown** (normalized) |
| Sweetness (if present in `taste_profile.structural`) | small | **Dropdown** when data exists |
| Country / Region / Sub-region | — | already the §4 drill-down (no free-text) |
| Grape variety | **844** distinct (many blends) | **Searchable select / typeahead** seeded with the **top ~40 single-varietal grapes** + free-type fallback — a flat 844-item dropdown is unusable. Filter = case-insensitive substring on `grape_variety` (matches blends too). |
| Flavor tag | **5,521** distinct | **Searchable select / typeahead** over the tag list (or a dropdown of the **top ~50** tags). NOT a plain dropdown of all 5,521. Filter = product whose `flavor_tags` includes the chosen tag. |
| Critic score | boolean | **Toggle** "Critic-reviewed only" (`hasScore`) — unchanged |

**Implementation notes:**
- Replace the current free-text `region`/`grape` inputs in "More filters" with the above
  controls. Body/acidity/tannin/sweetness use shadcn `Select` (dropdown) populated from the
  normalized scale constants (single source: `taste-adapter.ts` `SCALE_DEFINITIONS`/normalize).
- Dropdown OPTIONS should ideally be **context-aware too** (only show values present in the
  current filtered set, with counts) using the same `facets.ts`/`matchesFilters` machinery —
  e.g. `valuesFor(field, products)`. If full context-awareness for every attribute risks scope,
  the MINIMUM is: real dropdowns with the correct fixed scale for body/acidity/tannin, and a
  searchable control for grape/flavor. Mark context-aware attribute counts as a nice-to-have.
- All write to URL params via `buildQuery` (`body`, `acidity`, `tannin`, `grape`, `flavor`,
  `hasScore`) — `grape`/`flavor` already exist as params; `body`/`acidity`/`tannin` may need
  adding to `applyShopQuery` (normalize the product's value via `normalizeScale` before
  comparing, so a product stored "Medium-Full" acidity matches the "Medium-High" dropdown
  option — consistent with how the gauges render).
- 44px targets, 18px, keyboard-accessible (shadcn Select is accessible by default).

**Tests:** body/acidity/tannin dropdown filter matches normalized values (a "Medium-High"
selection includes products stored "Medium-Full"); grape substring matches a blend; flavor
filter matches a product containing that tag; Accessories drill-down reveals Glassware/Cigars/
Events/Gifts&Other chips with correct counts and "Gifts & Other" matches {Accessories, Others}.

## 7. Out of scope (YAGNI)
- Dedicated browse-tree pages / per-facet landing URLs (the brainstorm "B"/"C-cards" option) — could be added later for SEO; not now.
- Grape-variety / appellation drill-down — only category + geography for this feature.
- Any change to the recommender, product detail, home, or contact flow.
