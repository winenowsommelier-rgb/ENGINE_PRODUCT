# Explore by Region — Catalog Map Feature Design

**Date:** 2026-06-20
**Branch:** feat/wnlq9-catalog
**Status:** Approved design (brainstorming complete) → ready for implementation plan
**Supersedes for the catalog:** the internal PIM `docs/superpowers/specs/2026-04-12-interactive-map-explorer-design.md` is NOT the design of record for the catalog. This document is.

---

## 1. Summary

Replace the catalog's 42-line "coming soon" placeholder at
`apps/catalog/app/explore-map/page.tsx` with **Explore by Region**: a calm,
on-brand, accessible geographic discovery feature for the static WNLQ9 catalog.

It is **not** a port of the internal PIM's interactive WebGL map. The internal
explorer's logic informed this design, but an adversarial product/UX review
(see §9) concluded a pannable WebGL globe is the wrong tool for this catalog's
audience (40+, some eyesight challenges, Thai mobile) and would structurally
hide ~22% of the collection. We keep what's good about the map idea
(geographic browsing, brand story, hand-off to the existing filtered `/shop`)
and shed the WebGL weight, the invisible-product problem, and the
accessibility tar-pit.

**Shape:** a stylized "Maison atlas" — a light, near-white world map with
**large, tappable region hotspots** for the ~15–25 regions where the
collection is deep. A category lens (All / Wine / Whisky / Spirits / Sake)
recolors/refilters the hotspots. Clicking a region opens a **side drawer
(desktop) / bottom sheet (mobile)** with the region name, live bottle count,
price range, and ~4–6 product "peek" thumbnails, plus a **"View all N →"**
button that hands off to the existing filtered `/shop`. Each region is a
**real, indexable URL** (`/explore-map/bordeaux`). A plain high-contrast
**region list** sits below the map as the accessible fallback and SEO surface.

---

## 2. Goals / Non-goals

### Goals
- A discovery surface that *feels* the collection geographically, on-brand
  with the Maison aesthetic (near-white, deep burgundy `#7c2d3a`, 18px base).
- Fully **static / SSG** — no Supabase, no runtime API, consistent with the
  catalog's data convention.
- **Counts and peeks derived from the live export** so the map can never
  disagree with `/shop` (the panel count == the grid total).
- **Accessible-first**: large touch targets, keyboard-navigable, a real region
  list as the primary/fallback experience, high contrast.
- **Deep-linkable + SEO**: each region is an indexable URL that hands off to
  filtered `/shop`.
- **Zero ongoing manual upkeep** for the curated set (auto-selected by depth).

### Non-goals (v1)
- No MapLibre / WebGL / `react-map-gl` / `maplibre-gl`. (Explicitly cut.)
- No subregion or appellation depth. Region is the deepest map level.
- No in-map product browsing / pagination (that's what `/shop` is for).
- No region story blurbs in v1 — the taxonomy has **0/126** descriptions
  (verified), so there is no free copy to reuse. Drawer shows name / count /
  price / thumbnails / CTA only. (Hand-written blurbs are a future option.)
- No theme toggle (light only).
- No deep-linkable category+region combos beyond what `/shop` already supports.

---

## 3. The data architecture (the load-bearing decision)

An adversarial data-engineering review (see §9), corroborated by direct
queries against `data/live_products_export.json` and
`data/taxonomy/explore-taxonomy.json`, **rejected** the original "reuse the
static taxonomy" plan. Verified facts driving the rewrite:

- The live export has **0 coordinates** on all 11,436 products.
- Joining live products → taxonomy by region NAME hides **2,572 region-bearing
  products (~22%)** — and not randomly: ~96% of sake (Niigata, Nagano, Hyogo),
  most whisky (Scotland/Speyside variants), Napa Valley, Languedoc.
- The taxonomy is **stale** (sums to 10,206 vs 11,436 live) — shipping its
  counts would reintroduce the count≠grid bug the catalog already fixed.
- The taxonomy's category buckets `{wine,spirits,beer,sake}` do **not** match
  the catalog's real `category_group` (Wine, Spirits, Whisky, Sake & Asian,
  Liqueur, Beer & RTD, …). Its "sake" bucket = 6 products vs 663 live.

### The inversion (correct approach)

**Derive everything from the live export; use the taxonomy ONLY as a
name → lat/long lookup.**

A prebuild script (`apps/catalog/scripts/gen-explore-map-data.mjs`, wired into
the existing `prebuild` — change `package.json` to
`"prebuild": "node scripts/gen-search-index.mjs && node scripts/gen-explore-map-data.mjs"`)
does the following. Its output must be **provably identical to the
`getAllProducts()` projection**, enforced by tests (§8), NOT by importing it.

1. **Projection (must match `getAllProducts()`, enforced by test — see note).**
   Read the raw export and project each row down to **only** `PUBLIC_FIELDS`,
   then coerce `is_in_stock` with the same `isInStock()` logic (`is_in_stock`
   is a string `"0"/"1"/null`; "0" is truthy — verified 5,683 OOS). This
   mirrors the **existing** `gen-search-index.mjs`, which is a plain Node `.mjs`
   that *cannot* import the TypeScript `catalog-data.ts` (`node scripts/*.mjs`
   runs before Next/tsc, so `.ts` modules aren't importable without a loader).
   It therefore re-reads the raw export and hand-builds the allowlisted object —
   we follow that proven pattern. **The anti-drift / margin-safety guarantee is
   provided by the §8 invariant + margin-leak tests, not by code reuse:** a test
   asserts (a) every emitted object's keys ⊆ `PUBLIC_FIELDS`, and (b) the
   generator's in-stock + count results equal what `matchesFilters` /
   `isInStock` produce for the same inputs. (If a future refactor makes the TS
   loaders importable from a `tsx`-run prebuild, switching to literal reuse is a
   clean follow-up — not required for v1.)
2. Resolve each product's group via `groupForProduct` (imported from
   `apps/catalog/lib/category-groups.ts` — note: NOT `sku-taxonomy.ts`;
   SKU-prefix authoritative). **Exclude** Accessories / Events / Cigars /
   Non-Alcoholic from map counts and peeks (a wine fridge is not a Bordeaux).
3. Aggregate by `country` then `region` NAME from the live data: fresh
   `total`, per-`category_group` counts, `priceRange {min,max}`, and the
   in-stock peek set.
4. **Coordinate resolution**, in priority order:
   - region NAME → `explore-taxonomy.json` lat/long (case-insensitive), else
   - region NAME → a small hand-authored centroid supplement
     `apps/catalog/lib/explore/region-centroids.ts` (~15 entries: all the sake
     regions — Niigata, Nagano, Hyogo, Kumamoto, Kyoto, Yamanashi — plus Napa
     Valley, Languedoc-Roussillon, Maule Valley, etc. — one-time, no API
     spend), else
   - **country roll-up**: a region with no coordinate contributes to its
     COUNTRY hotspot. All 66 taxonomy countries carry lat/long (verified), and
     the vast majority of country-bearing products map to a taxonomy country
     (a handful — Malaysia, South Korea, Singapore — don't; they fall through
     to the escape hatch). Nothing on a known country is ever dropped.
5. **Curate**: auto-select the top regions by **in-stock beverage depth**
   (threshold e.g. ≥30 in-stock bottles), capped at ~20–25, ensuring each
   category lens (Wine/Whisky/Spirits/Sake) has representation. Everything not
   curated remains reachable via the always-present "Browse all 11,000+
   bottles →" escape hatch → `/shop`, and via the region list.
6. Write a compact `apps/catalog/data/explore-map-data.json` (~50–100 KB):
   curated regions [{ name, slug, country, countrySlug, lat, lng, total,
   countsByGroup, priceRange, peeks:[{sku,name,image_url,price}] }], plus the
   full country roll-up for the world view. **Allowlisted fields only** in
   peeks (sku/name/image_url/price) — never margin/popularity.

### Category lens

Defined over the catalog's real `category_group`, mapped to friendly lens
labels: **All / Wine / Whisky / Spirits / Sake** (Sake = "Sake & Asian";
Spirits groups Spirits+Liqueur; Beer & RTD optionally folded or omitted in
v1). Per-hotspot per-lens counts are precomputed at build. The lens value is
passed through to `/shop` as `?group=<CatalogGroup>` on hand-off.

### Hand-off to /shop (verified convention)

`/shop` matches `region` and `country` **exact, case-insensitive**
(`shop-query.ts:24-30`), written via `buildQuery` as
`?group=…&country=…&region=…`. The hand-off MUST emit the region **NAME**
(e.g. `"Barossa Valley"`), **not** the taxonomy slug, and MUST include the
parent **country** so the `/shop` DrillBreadcrumb (`country › region`) renders
coherently. Link built with `buildQuery({}, { country, region, group? })`.
Because the same `matchesFilters` predicate produces both the build-time count
and the `/shop` grid, **panel count == grid total** by construction.

---

## 4. Components & file structure

All under `apps/catalog` (`@/*` = catalog root). No new runtime deps — pure
React + SVG/CSS, no MapLibre.

```
apps/catalog/
  app/explore-map/
    page.tsx                      # server: loads explore-map-data.json, renders shell + region list (SEO/fallback)
    [region]/page.tsx             # server: deep-linkable region route; generateStaticParams from curated set;
                                  #         generateMetadata per region; renders same shell w/ drawer pre-opened
    ExploreRegionClient.tsx       # 'use client': lens state, selected region, drawer open/close
  components/explore/
    RegionAtlas.tsx               # the stylized SVG atlas + hotspot buttons (real <button>/<a>, 44px+, tabbable)
    CategoryLens.tsx              # All/Wine/Whisky/Spirits/Sake chips (recolor + refilter hotspots)
    RegionDrawer.tsx              # side drawer (desktop) / bottom sheet (mobile): name, count, price, peeks, CTA
    RegionList.tsx                # plain high-contrast accessible list of regions (primary fallback + SEO)
    EscapeHatch.tsx               # "Browse all 11,000+ bottles →" → /shop (always visible)
  lib/explore/
    map-data.ts                   # typed loader for explore-map-data.json + lens/coords helpers
    region-centroids.ts           # hand-authored ~15 region→lat/long supplement
    types.ts                      # trimmed types (no benchmarks/contexts/appellations/Supabase shapes)
  data/
    explore-map-data.json         # generated at prebuild (gitignored or committed — see plan)
  scripts/
    gen-explore-map-data.mjs      # prebuild generator (raw read + re-impl allowlist; see §3)
```

`page.tsx` is a server component (SSG). The atlas is interactive but is plain
React DOM/SVG — **no `ssr:false` needed** (no WebGL), so it renders in the
static HTML and is crawlable. The hotspots and region list are real anchors to
`/explore-map/[region]`, giving SEO + working back-button + shareable links.

---

## 5. Page & interaction flow

- **World view** (`/explore-map`): atlas with curated region hotspots
  (label + count), category lens, escape hatch, and the region list below.
- **Hotspot click / region URL** (`/explore-map/bordeaux`): drawer/sheet opens
  with that region's name, count, price range, peek thumbnails, "View all N →".
  URL updates (real navigation, not just state) so it's shareable and
  back-button steps from region → world.
- **Category lens**: filters which hotspots show and recolors by dominant
  group; updates counts to the lens; carried into the `/shop` hand-off.
- **"View all N →"**: navigates to `/shop?group=…&country=…&region=…`.
- **Peek thumbnail click**: navigates to that product's `/product/[sku]`.
- **Escape hatch** (always visible): `/shop` unfiltered.

---

## 6. Accessibility (first-class, not bolted on)

- Hotspots are real `<a>`/`<button>` elements (not SVG paths): keyboard
  focusable in a sensible order, ≥44px hit area, visible burgundy focus ring
  (the global `:focus-visible` already provides this).
- The **RegionList is the primary experience for screen readers / low vision**
  — a plain, large (18px), high-contrast list of regions with counts, each a
  link. The atlas is a visual enhancement layered over the same data, not a
  prerequisite.
- Live region announces drawer open / selected region.
- No reliance on color alone: hotspots carry text labels + counts.
- Respect `prefers-reduced-motion` for any hotspot/drawer transitions.

---

## 7. Edge cases & failure modes

- **Region with no coordinate** → rolls up into its country hotspot; never
  dropped. Logged at build (count of rolled-up regions/products) per CLAUDE.md
  Rule 2 (no silent skips).
- **Lonely countries (1–2 products)** → not curated as region hotspots; remain
  in `/shop`. Avoids "click Norway, see 1 bottle" anti-luxury moments.
- **Stale data** → impossible by construction: counts/peeks recomputed at build
  from the same source as `/shop`.
- **Empty lens** (e.g. Sake before centroids added) → the lens only shows if
  it has ≥1 curated region; otherwise it's omitted, not shown empty.
- **Missing image on a peek** → fall back to the catalog's existing
  `StorefrontImage` placeholder (already handles 110 imageless products).
- **Build with missing data file** → the generator must fail the build loudly
  (mirrors `catalog-data.ts:exportPath()` behavior), never ship an empty map.

---

## 8. Testing & verification

- **Unit (vitest, catalog convention):**
  - `gen-explore-map-data` aggregation: counts exclude Accessories/Events;
    in-stock coercion correct; peeks carry only allowlisted fields; coord
    resolution priority (taxonomy → centroid → country roll-up).
  - `map-data.ts` lens helpers; hand-off URL builder emits NAME + country +
    group and round-trips through `/shop`'s `shop-query` matcher.
  - **Invariant test (CLAUDE.md Rule 6):** for every curated region, the
    build-time count == the count `/shop`'s `matchesFilters` produces for the
    same `{country,region,group}`. Guards the count==grid promise.
- **Margin-leak guard:** assert no peek object contains any non-`PUBLIC_FIELDS`
  key (especially margin_*/popularity_*/cost_price).
- **Browser verification (CLAUDE.md Rule 7 — mandatory):** run the catalog
  dev server, open `/explore-map`, click hotspots, open a region URL directly,
  switch lenses, follow "View all" into `/shop` and confirm the grid total
  matches the drawer count, tab through with keyboard, check mobile bottom
  sheet. A working UI is the only proof.

---

## 9. Review history (why this design, not the obvious one)

Two adversarial subagent reviews challenged the initial "port the WebGL
explorer + reuse the static taxonomy" plan:

- **Data-eng review** (verified): the taxonomy-name join hides 22% of the
  catalog and whole categories (sake); counts are stale; the category buckets
  are wrong. → Inversion: derive from live export, taxonomy = coords only,
  real `category_group` lens, NAME-based hand-off. **Adopted in full.**
- **Product/UX review:** a heavy WebGL map is wrong for a 40+/low-vision/Thai-
  mobile audience and a third redundant browse tool; it breaks "explore the
  whole collection" and (as first scoped) threw away SEO/shareable URLs. →
  Pivot to a **curated, deep-linkable, accessible stylized atlas** with an
  escape hatch and a region-list fallback. **Adopted.**

Direct queries also corrected two of my own assumptions mid-design: the
taxonomy has **0** region descriptions (so no reusable blurbs), and all the
top **sake** regions plus Napa/Languedoc **lack coordinates** (hence the
hand-authored centroid supplement).

---

## 10. Open items for the implementation plan

- **`prebuild` wiring:** chain the new generator —
  `"prebuild": "node scripts/gen-search-index.mjs && node scripts/gen-explore-map-data.mjs"`.
  Lean: `explore-map-data.json` is generated at prebuild (gitignored), like the
  search index — not committed.
- **Curated-set determinism** (affects which static pages exist, so must be
  deterministic for `generateStaticParams`): the cap (~20–25) is a HARD limit.
  Within the cap, fill by in-stock beverage depth descending, ties broken by
  region name (alphabetical). Then guarantee ≥1 region per lens that has any
  eligible region: if a lens (e.g. Sake) is unrepresented within the cap,
  **substitute** its deepest region for the lowest-depth currently-included
  region (never exceed the cap). If a lens has zero eligible regions at all,
  the lens is omitted (per §7), not shown empty. Finalize threshold + the exact
  lens→`category_group` map here.
- The ~15 centroid values for `region-centroids.ts`.
- **Atlas SVG + hotspot placement:** do NOT math-derive positions from a
  stylized (non-projection) silhouette — they'll misplace. Instead store an
  explicit `{ x, y }` per hotspot in `region-centroids.ts` alongside `lat/lng`
  (placement is authored, not computed), OR use a known equirectangular basemap
  with a stated `viewBox`/bounds so lat/long→x/y is exact. Specify a
  min-separation rule (jitter or label-stacking) for near-coincident hotspots
  (e.g. multiple Scotch regions).
