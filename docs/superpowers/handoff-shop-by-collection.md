# Handoff prompt — "Shop by Collection" page (run in a NEW session)

Paste everything below the line into a fresh Claude Code session in this repo.

---

I want to design and build a new **"Shop by Collection"** page in the WNLQ9 catalog
(`apps/catalog/`, the public storefront). Start with brainstorming → spec → plan; do NOT
build until the design is approved. Use the superpowers brainstorming skill.

## The idea
A browsable **library of "collections"** — curated/grouped product sets (e.g. "Bold Reds
under ฿1,500", "Islay Single Malts", "Champagne for Celebrations", "Natural & Organic",
"Gifts under ฿2,000"). Likely UX: pick a **category first** (like the catalog's category
tiles), then enter to see all collections within it. Each collection links to a
pre-filtered/sorted product set.

**Dual purpose (important):** this collection library is ALSO a source of curated product
sets to recommend during the **"Find Your Match" finder** flow — so design the collection
data model so the finder can reference a collection by id and surface its products.

## The critical design constraint (verified — don't skip)
**There is NO `collection` field in the data.** I checked `data/live_products_export.json`:
the only grouping-ish fields are `brand` (2,811 distinct — too granular), `category_group`/
`category_type` (already the catalog's nav, 10 groups), region, grape, and the taste
attributes. So **collections must be DEFINED**, not read from a field. The core design
decision is HOW:
- **A. Curated config** — a hand-authored `collections.ts` (id, title, blurb, category,
  hero image, + a filter query OR an explicit SKU list). Full editorial control; manual upkeep.
- **B. Rule-based** — collections are saved filter queries (e.g. `{group:Wine, body:Full,
  price:tier0-1}`) that resolve against the live catalog at build. Auto-updating; less editorial.
- **C. Hybrid** — curated metadata (title/blurb/image) + a rule/query that populates products,
  with an optional manual SKU override. (Likely the right answer — brainstorm it.)

## What already exists to build on (reuse, don't reinvent — project Rule 11)
- The catalog's shop filtering is a SINGLE pure predicate: `lib/shop-query.ts`
  `matchesFilters(product, params)` + `applyShopQuery`. Filter params: `group, class,
  country, region, subregion, grape, body, acidity, tannin, price, flavor, sort, page`.
  A collection defined as a query can reuse this verbatim — a collection page IS a
  pre-filtered shop view.
- `lib/category-groups.ts` (shim over `lib/sku-taxonomy.ts`) — the 10-group model +
  `groupForProduct`/`typeForProduct`. Backfilled `category_group`/`category_type` on every row.
- `lib/finder/shop-links.ts` — builds `/shop?…` URLs (collections can reuse this pattern,
  or link to a dedicated `/collection/[id]` route).
- `components/ProductCard`, the catalog's Tailwind/accessibility conventions (18px base,
  ≥44px targets), and the finder's `StyleResult` patterns.
- `data/live_products_export.json` is the data source (SSG, build-time read). Margin-leak
  chokepoint: everything client-bound goes through `toPublicProduct` (catalog-data.ts).

## Things to decide in brainstorming (one question at a time)
1. Collection definition model: A / B / C above.
2. Page structure: category-first-then-collections vs a flat browsable grid of all collections.
3. Route shape: `/collections`, `/collections/[category]`, `/collection/[id]`?
4. How the finder references a collection (by id) and surfaces its set during "Find Your Match".
5. Initial set of collections to ship (validate each resolves to ≥N real in-stock products —
   a collection that returns 0 products is the dead-link trap; guard it like the finder did).
6. Curated images/copy source (and graceful fallback when absent).

## Process expectations (this repo's rules)
- Brainstorm (visual companion is useful here for the page layout) → write spec to
  `docs/superpowers/specs/` → spec review loop → write plan → plan review loop →
  subagent-driven build with per-task spec+quality reviews → Rule 7 browser verification.
- Every collection link must resolve to a NON-EMPTY filtered set (verify against real data —
  this is the same dead-link class of bug the finder's discovery map had; don't repeat it).
- A PARALLEL session is editing the same repo. `git add` ONLY your collection files; never
  `git add -A`. Stay on branch `feat/wnlq9-catalog`.
- Margin-leak invariant: only `PublicProduct` reaches the client.

## Context docs to read first
- `docs/superpowers/specs/2026-06-17-wnlq9-online-catalog-design.md` (catalog architecture)
- `docs/superpowers/specs/2026-06-18-wnlq9-product-finder-design.md` (finder — the consumer)
- `docs/superpowers/specs/2026-06-20-wnlq9-finder-sommelier-upgrade-design.md` (discovery map — same link pattern)
- `apps/catalog/lib/shop-query.ts`, `lib/category-groups.ts`, `lib/finder/shop-links.ts`

Begin by exploring the repo, then brainstorm the collection definition model (the A/B/C
decision) with me before anything else.
