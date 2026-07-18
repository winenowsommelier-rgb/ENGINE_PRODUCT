# Next session prompt — catalog print sort/filter step

Paste this to resume:

---

We just shipped the WNLQ9 print catalog feature (`apps/catalog/app/catalogs/*`) —
retail (B2C) catalog browsable by category at `/catalogs/retail/[group]`, each
rendering the full country/region/sub-region tree for that category via
`CatalogDocument`. B2B is gated behind an access key, "Coming soon" on the menu
(no production data source yet).

**New ask**: before a user hits Print, they should be able to narrow down what
gets included — right now the only lever is category (Wine/Whisky/Spirits/etc.),
and even one category can run to hundreds of pages. Add a sort/filter step so
users can print a reasonably sized selection instead of everything.

## Likely scope

- A pre-print options panel (client component) on the category page
  (`apps/catalog/app/catalogs/retail/[group]/page.tsx`) or a new intermediate
  step between the picker and the printable document.
- Filter dimensions to consider: country, region, price range, in-promo-only,
  has-critic-score-only. All of these already exist on `CatalogRow`
  (`apps/catalog/lib/catalog-print.ts`) except promo/score booleans, which are
  derivable from `specialPrice`/`scoreSummary`.
- Sort dimensions: current tree order is always Category > Country > Region >
  Sub-region, sorted by count desc. Decide whether "sort" means (a) reordering
  the grouping/section order, or (b) simple flat sort within a table
  (e.g. by price, by name) — clarify with user before building; the print
  layout is inherently grouped by geography, so a flat re-sort may conflict
  with the current section structure.
- The filter state needs to survive into the print view — likely via query
  params (?country=France&maxPrice=5000) so `generateStaticParams` / SSG
  compatibility gets reconsidered (filtered views probably need to become
  `dynamic` rather than statically generated, similar to how B2B is already
  `force-dynamic`).
- `getB2CCatalogRows(products, categoryGroup)` in catalog-print.ts already
  takes a `categoryGroup` param — natural place to extend with an options
  object (`{ categoryGroup, country, maxPrice, promoOnly }`) rather than
  bolting filtering on separately.

## Relevant files

- `apps/catalog/lib/catalog-print.ts` — `CatalogRow`, `buildCatalogTree`,
  `getB2CCatalogRows` (row-shape + tree-building + scope filter)
- `apps/catalog/app/catalogs/retail/page.tsx` — category picker (counts per
  category, links to `/catalogs/retail/[group]`)
- `apps/catalog/app/catalogs/retail/[group]/page.tsx` — per-category print
  page, currently SSG via `generateStaticParams()` from `GROUP_SLUG`
  (`apps/catalog/lib/seo/jsonld.ts`)
- `apps/catalog/app/catalogs/retail/full/page.tsx` — full unfiltered catalog
- `apps/catalog/components/catalog-print/CatalogDocument.tsx` — renders the
  tree + product table (server component)
- `apps/catalog/components/catalog-print/CatalogToolbar.tsx` — client
  component, currently just the Print button + back link; natural home for
  a "before you print" filter UI, or a new step ahead of it

## Constraints to keep in mind (CLAUDE.md)

- Never let B2B pricing fields leak into B2C-scoped code paths
  (`PUBLIC_FIELDS` allowlist in `catalog-data.ts`).
- Rule 7: any UI change needs an actual browser walkthrough (start dev
  server, click through, verify print/PDF output), not just a type-check.
- Rule 9: `data/live_products_export.json` is the UI source of truth, not
  the DB — no relevance here unless the filter needs a new field not
  currently exported.

## Not yet decided — ask the user first

1. Sort = reorder sections, or flat sort within tables? (see above)
2. Which filters matter most: country/region, price range, promo-only,
   has-score-only — build all, or start with 1-2?
3. Should filtered print views be shareable via URL (bookmarkable query
   params), or is this a client-only "select then print" flow with no
   persisted state?
