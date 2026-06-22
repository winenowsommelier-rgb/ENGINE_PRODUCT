# /shop "Classification" (Designation) Chip — Design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Surface:** `apps/catalog` public catalog → `/shop` Filters

## Goal

Add a **"Classification"** filter chip rail to the `/shop` page, directly below
the existing **Origin** (Country › Region › Sub-region) section. The chip lets a
shopper filter by product **designation / class** — e.g. *Grand Cru, 1er Cru,
DOCG, DOC, IGT, AOC, Reserva, Brut, Single Malt, XO, VSOP, Limited*.

User-facing label: **"Classification"**. Internal field name: **`designation`**
(deliberately NOT `classification` — see Data Reality).

## Data Reality (verified 2026-06-22)

Verified against `data/live_products_export.json` (11,436 rows):

| Field | Populated | Meaning |
|---|---|---|
| `classification` | 11,436 / 11,436 | product **TYPE** (Red Wine 4,122 / White 1,583 / "Wine product" 1,509 / Whisky 621 / Champagne 463 …). **0** real designations. |
| `wine_classification` | 0 / 11,436 | empty |
| `appellation` | 0 / 11,436 | empty |
| `designation` | 0 / 11,436 | does not exist yet |
| `category_type` | 11,436 / 11,436 | canonical SKU-derived TYPE — already drives the existing **Type** chips |

**Consequence (CLAUDE.md ABSOLUTE RULE 12):** the raw `classification` field is a
stale TYPE duplicate. It MUST NOT be read for the designation chip — doing so
re-introduces the "Wine product" bug. TYPE is owned by `category_type`.

Designations are recoverable from product **`name`** via regex. Two different
counts matter — do not conflate them:
- **Raw per-token name hits** (a name can hit several): DOC 460, Brut 434,
  Reserva/Riserva 320, DOCG 314, IGT 256, Grand Cru 242, Reserve 202, Single Malt
  157, 1er/Premier Cru 151, AOC 151, Limited 141, Gran Reserva 67, XO 33, VSOP 13.
- **Most-specific-wins resolution** (one tag per product — what the code actually
  produces and what the chip counts reflect): **~2,710 / 11,436 rows (≈24%)**
  (measured 2,711 Python / 2,704 JS at plan time; the 7-row delta was an accented
  `Cru Classé` boundary bug, fixed in the plan's regex). Per-designation AFTER
  dedup is lower than the raw hits (e.g. DOC ~427, Brut ~288, DOCG ~304) because
  the more-specific token claims the row. The remaining ~76% have no designation
  and will not appear under any chip — expected, not a bug.

## Decisions (locked with user)

1. **Scope:** full wine + spirits designation set (~14 values).
2. **Persistence:** derive a real `designation` column → `products.db` →
   `live_products_export.json` (durable path, Rule 10 gated). No paid API.
3. **Multi-match:** most-specific-wins, **single tag** per product.
4. **Placement:** new **"Classification"** `FilterAccordion` immediately after
   Origin; selecting filters the grid via the shared `matchesFilters` predicate
   so grid + facet counts never diverge.
5. **Label:** "Classification" (UI) / `designation` (field).

## Components

### 1. Designation resolver — `apps/catalog/lib/designation.ts` (new)
Mirrors the *shape* of `lib/category-groups.ts` but is a **standalone, pure,
fs-free module**. It MUST NOT import `sku-taxonomy` or anything that transitively
pulls `fs`/node built-ins — `category-groups.ts` does (`import { resolve } from
'./sku-taxonomy'`), and that is why `Filters.tsx` (a `'use client'` component)
cannot import it (Filters.tsx:14-17). `designationForProduct` runs inside the
pure `shop-query` module (unit-tested without Next), so the resolver is regex-over-
`p.name` and `p.designation` only — zero I/O, zero node imports.

- An **ordered** priority list `DESIGNATION_PATTERNS: { label: string; re: RegExp }[]`
  where earlier = more specific. Critical orderings:
  - `Extra Brut` before `Brut`
  - `DOCG` before `DOC`
  - `Gran Reserva` before `Reserva` before `Reserve`
  - `Grand Cru` before `Premier/1er Cru` before `Cru Classé`
  - `VSOP` before `VS`
  - plus `IGT, DOP/IGP, AOC/AOP, Single Malt, XO, Limited, Vintage`
- `designationForProduct(p: PublicProduct): string | undefined`
  - If `p.designation` (persisted) is a non-empty string, return it.
  - Else scan `p.name` against `DESIGNATION_PATTERNS` **in order**; return the
    first `label` whose `re` matches; `undefined` if none.
- Regexes use word boundaries and case-insensitive flags; abbreviations
  (DOC/DOCG/IGT/AOC/XO/VSOP) match as upper-token boundaries to avoid matching
  inside ordinary words.
- Export `DESIGNATIONS: readonly string[]` (the ordered label list) for the
  facet/option ordering and tests.

### 2. Python backfill — `scripts/backfill_designation.py` (new)
- Same ordered pattern table as the TS resolver (kept in parity by a fixture test).
- Reads each product `name` ONLY (never the raw `classification` field — RULE 12;
  no `classification` fallback in the parity fixture either), computes the single
  most-specific designation, writes a `designation` column on `products.db`.
- **Rule 10 gated, in order:**
  1. `cp products.db products.db.bak-pre-designation`
  2. 5-SKU canary; print before/after designation for those SKUs
  3. count query on canary; confirm ratio is sane
  4. full run (pure regex — **$0 API spend**)
  5. `.venv/bin/python scripts/refresh_live_export.py` (RULE 9 — the UI reads the
     JSON, not the DB)
  6. verify: `SELECT count(*) FROM products WHERE designation IS NOT NULL AND designation != ''`
     in the DB **and** a matching count in `live_products_export.json`
- DB write must be idempotent (re-runnable) and tolerate a missing column
  (ADD COLUMN if absent). Honor the shared-DB hazard in memory
  (`feedback_shared_db_reverts_between_turns`): re-query PRAGMA before trusting a
  prior ALTER.
- **Cost report line (RULE 4):** "$0 spend; N rows where `designation` is
  populated in the UI-facing export; pure-regex derivation."

### 3. Field plumbing
- `apps/catalog/lib/types.ts`: add `designation?: string;` to `PublicProduct`.
- `apps/catalog/lib/catalog-data.ts`: add `'designation'` to `PUBLIC_FIELDS`.
  (The existing drift-guard type makes the build fail if one is added without the
  other.)

### 4. Filter predicate — `apps/catalog/lib/shop-query.ts`
Add to `matchesFilters`, after the geo block:
```ts
const designation = norm(firstParam(params.designation));
if (designation && norm(designationForProduct(p)) !== designation) return false;
```
Document the new param in the file's header comment block (alongside the existing
`country`/`region` docs).

### 5. Facets — `apps/catalog/lib/facets.ts` + `lib/shop-facets.ts`
- `facets.ts`: `designationsFor(products): FacetOption[]` — tally
  `designationForProduct(p)` over the set, drop empties, order by the canonical
  `DESIGNATIONS` order (not raw count) so the rail reads specific→general
  consistently; each option carries its `count`.
- `shop-facets.ts`: add `designations: FacetOption[]` to `ShopFacets`; compute
  with `omit(params, 'designation')` so each chip's count reflects the OTHER
  active filters and selecting one doesn't zero its siblings — identical to the
  country pattern. `omit` is generic over any string key, so no change to it is
  needed.
- **Edit ordering:** §4 (predicate reads `params.designation`) must land BEFORE
  §5's count guarantee holds — the "count reflects other filters" property is only
  true once `matchesFilters` actually honors the designation param.

### 6. UI — `apps/catalog/components/Filters.tsx` + `app/shop/page.tsx`
- `page.tsx`: pass `designationOptions={facets.designations}` into `<Filters>`.
- `Filters.tsx`: add optional prop `designationOptions?: FacetOption[]` (default
  `[]`). Render a new `FilterAccordion label="Classification"` **immediately
  after** the Origin accordion, containing a `ChipRail` wired exactly like the
  Country rail:
  ```tsx
  {designationOptions.length > 0 ? (
    <ChipRail
      ariaLabel="Classification"
      options={designationOptions}
      active={activeDesignation}
      onSelect={(value) => apply({ designation: value })}
    />
  ) : null}
  ```
  - **Handler uses the leaf-rail idiom** `apply({ designation: value })`, NOT a
    `setParam`/`clearDescendants` helper. `setParam` does not exist; the correct
    precedent is the descendant-free Grape/Flavor rails (Filters.tsx:868, 883),
    not the geo rails. `ChipRail` already calls `onSelect(isActive ? null : value)`
    internally (Filters.tsx:254), so `value` arrives as `string | null`; `buildQuery`
    deletes the key on `null`/`''` (build-query.ts:32), giving correct toggle-off
    for free. So `apply` must accept `{ designation: string | null }` — it already
    does for grape/flavor.
  - `activeDesignation` read from params like the other actives.
  - No `iconFor` (no emoji set for designations); reuse the existing text-chip
    styling unchanged.
  - Empty options → the rail renders nothing (self-hides). NOTE: this hides the
    rail only when the ENTIRE options array is empty. Individual zero-count
    designations are already dropped by `facets.ts` `tally`, so under an active
    non-wine group the rail is sparse-but-correct, not absent — verify in the
    browser step.
  - Accordion `defaultOpen={Boolean(activeDesignation)}` and a `SectionBadge`
    summary showing the active value, matching Origin.

  **Breadcrumb decision (resolved):** `designation` is a **leaf filter**, treated
  exactly like `grape`/`flavor`/`price`/taste — it is NOT a `DrillStrand` and is
  intentionally **excluded from `DrillBreadcrumb`** (DrillBreadcrumb.tsx:26-28,
  closed `DrillStrand` union in drill-query.ts:13). Rationale: it has no
  descendants and adding it to the strand machinery would be scope creep. The
  active value is still visible via the accordion `SectionBadge`, and it is
  cleared by re-clicking the chip (auto-`null`). Consequence to accept: the
  breadcrumb's "Clear all" clears the drill strands (category + geo) but NOT
  designation — same as it already does NOT clear grape/flavor/price/taste. This
  is consistent with existing behavior, not a regression.

## Testing

- **Unit (`designation.ts`):** priority resolution — DOCG-not-DOC, Extra-Brut-
  not-Brut, Gran-Reserva-not-Reserva, VSOP-not-VS, no-match → `undefined`,
  persisted-field-wins-over-name.
- **Parity fixture (RULE 5/6 pattern):** a shared sample list; assert the TS
  `designationForProduct` and the Python backfill produce identical labels — like
  the existing sku-taxonomy parity test. This guards against the two pattern
  tables drifting.
- **Facet/grid sync:** for a given designation, `shopFacets(...).designations`
  count for that label === `applyShopQuery(..., {designation})` total.
- **DB invariant (RULE 6):** every row whose `name` matches a designation has the
  `designation` field populated in `live_products_export.json`. Add to the
  enrichment invariants test pattern.
- **Browser (RULE 7):** dev server on **:3100**; open `/shop`; click a
  Classification chip; confirm the grid filters, the count badge matches the grid
  total, and clearing restores. `rm -rf .next` first if a stale-module 500 hits.

## Non-Goals (YAGNI)

- No multi-tag designations.
- No emoji/icon set for designation chips.
- No new DB tables (one nullable column only).
- No paid enrichment — derivation is pure regex.
- No change to the existing Type chips or `category_type` semantics.

## Risk Notes

- **Shared `products.db` hazard** (memory): a parallel process can revert the
  ALTER/backfill between turns. Mitigation: idempotent backfill, re-query PRAGMA,
  re-verify the export age before declaring done (RULE 9).
- **Two-pattern-table drift:** TS resolver + Python backfill must stay in sync —
  enforced by the parity fixture test, not by hope.
- **24% coverage is expected, not a bug:** most products legitimately have no
  designation; the chip surfaces a real minority slice.
