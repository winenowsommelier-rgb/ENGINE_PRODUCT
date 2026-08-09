# Designation/classification linking + description cards

Date: 2026-08-09
Branch: `worktree-designation-classification-linking`
Precursor: PR #106 (merged to `main` 2026-08-09) — `docs/designation-classification-linking-brief.md`

## Problem

The shop page's region knowledge panel can already link a classification
tier (e.g. "Italy DOCG") to `/shop?region=X&designation=Y` (PR #106), but
there is no description copy anywhere explaining what a designation *means*
once a shopper filters by it. Unlike regions (`RegionDescriptionCard`,
PR #104), designations have zero authored copy today.

## Ground truth established during brainstorming (verified against real data, not assumed)

- **`DESIGNATIONS`** (22 canonical, most-specific-first labels) and
  `designationForProduct()` live in `apps/catalog/lib/designation.ts`. This
  is the only source of truth for valid designation tokens.
- **3,015 of 11,934 live products (25.3%) have a designation** —
  confirmed via `data/live_products_export.json`. All 3,015 come from the
  *persisted* `designation` field. The regex-over-`name` fallback in
  `designationForProduct()` currently matches **zero additional products**
  beyond what's already persisted (checked directly: no product with an
  empty persisted field has a name-matchable token like "DOCG" or "Grand
  Cru"). The "gap" is products with no designation signal at all under
  today's patterns — not a broken fallback silently mislabeling anything.
- **Per-designation live counts** (persisted, from `live_products_export.json`):
  DOC 506, DOCG 356, Brut 327, IGT 285, Grand Cru 249, Reserva 176,
  Reserve 170, Single Malt 161, Premier Cru 152, AOC 147, Limited 120,
  Gran Reserva 65, Extra Brut 42, Vintage 44, Classico 39, Crianza 32,
  XO 34, Superiore 17, DOP/IGP 62, Cru Classé 16, VSOP 15, **VS 0**.
- **The region-panel tier-linking work is already complete** — checked
  against the real production source (`data/taxonomy_descriptions_export.json`,
  67 regions, 25 with a `knowledge.tiers` array). Only **11 distinct tier
  strings** exist across all regions (not the large variety speculated in
  the brief): `Bordeaux 1855 First Growth`, `Burgundy Grand Cru`,
  `Burgundy Premier Cru`, `Burgundy Village`, `Burgundy Regional`,
  `Champagne Grand Cru`, `Italy DOCG`, `Spain DOCa`, `Spain DO`,
  `Chile DO`, `American Viticultural Area`. Five of these already map
  correctly via PR #106's `TIER_TO_DESIGNATION`. The other six
  (AVA/DO/Village/Regional) are **not** designation tokens in
  `designation.ts` at all — they're appellation-system labels, a different
  concept — so they correctly render as plain text today. **No linking
  code changes are needed by this plan.**
- No description-copy infrastructure exists for designations.
  `taxonomy_contexts` (`data/taxonomy.db`) is entity/graph-shaped
  (region/subregion/country only); designations aren't graph nodes and
  must not be forced into that table. `classification_scope_map` in the
  same DB is unrelated Magento-`classification`-routing data (CLAUDE.md
  Rule 12) — never reuse it here.
- `RegionDescriptionCard` (`apps/catalog/components/shop/RegionDescriptionCard.tsx`)
  and its data source `findRegionDescription()`
  (`apps/catalog/lib/explore/region-lookup.server.ts`, reading
  `data/taxonomy_descriptions_export.json`) are the pattern to mirror.
  That card does **not** currently render a citation footer even though
  the underlying data has a `citation` field — a pre-existing gap, not
  fixed by this plan (out of scope; noted so it isn't mistaken for new
  behavior).

## Decisions

1. **Scope: all 22 canonical `DESIGNATIONS`, one content pass.** Explicitly
   not limited to the 6 high-stock designations. Rationale (user): thin
   designations (e.g. `VS` at 0 live products) are expected to gain product
   coverage over time via a planned backfill/tagging effort — the copy
   should already exist when that lands, not be a second content pass.
2. **Pages: shop page only.** Mirrors `RegionDescriptionCard`'s exact
   scope. Product detail page (e.g. a bottle's own DOCG badge linking
   through) is an explicit follow-up, not part of this plan.
3. **Backfill/tagging more products into thin designations: separate
   follow-up, after this ships.** This plan does not touch
   `designation.ts`'s regex patterns, does not run a backfill script, and
   does not change `scripts/backfill_designation.py`. It only adds
   description copy + a card keyed off whatever designation data exists
   today.
4. **Zero/low-stock designations still get copy, but the card never links
   to a 0-result page.** `findDesignationDescription()` takes the live
   product count as an input and returns `null` when count is 0 — same
   non-empty guarantee PR #106 established for tier links. `VS` (0
   products) gets copy authored now; it simply won't render until the
   backfill effort gives it stock.
5. **Data shape: new JSON file**, not a DB table.
   `data/designation_descriptions.json`, keyed by the exact `DESIGNATIONS`
   label, shape mirrors `taxonomy_descriptions_export.json`'s region
   entries: `{ "DOCG": { "short": "...", "full": "...", "citation": "..." }, ... }`.
6. **No linking-coverage code changes.** Verified above — PR #106's
   `TIER_TO_DESIGNATION` already correctly covers everything linkable in
   production data. This plan only adds the description card.
7. **No citation UI on the new card**, to stay visually consistent with
   `RegionDescriptionCard` (which also doesn't render one). Citation is
   still stored in the data for provenance/audit.
8. **Copy verification: a spot-check gate, added now as new practice.**
   No evidence either way on whether the 67-region copy was
   human-verified against sources at the time — rather than dig through
   history, this plan introduces an explicit verification step (see
   Testing) and treats it as the standard going forward.

## Architecture

### Data: `data/designation_descriptions.json`

22 entries, one per `DESIGNATIONS` label. Each entry:

```json
{
  "DOCG": {
    "short": "180-260 char teaser, same length target as region 'short' copy",
    "full": "800-1600 char explanation: what it legally means, how it's awarded/regulated, why it ranks where it does among related designations",
    "citation": "Wine Bible 2e, <chapter>" | "INAO, <doc>" | "Consorzio del [X], <doc>" | etc.
  }
}
```

Hand-authored. No fabricated claims — every entry cites a real,
checkable source (Wine Bible, the relevant regulatory body: INAO for
AOC, Comité Interprofessionnel for Champagne tiers, Consorzio bodies for
DOCG/DOC, etc.), same standard as `docs/region-taxonomy-copy-brief.md`.

### Lookup: `apps/catalog/lib/explore/designation-lookup.server.ts`

Mirrors `region-lookup.server.ts`'s shape:

```ts
export interface DesignationDescriptionEntry {
  designation: string;
  description: string;   // "full" copy
  citation?: string;
}

export function findDesignationDescription(params: {
  designation?: string | null;
  productCount: number;
}): DesignationDescriptionEntry | null
```

Returns `null` when: no `designation` param, no copy entry exists for
that label, or `productCount <= 0`. The non-empty check is enforced in
code, not left to the caller to remember.

### UI: `apps/catalog/components/shop/DesignationDescriptionCard.tsx`

Structural copy of `RegionDescriptionCard`: same card chrome, same
`splitSentences` + sentence-per-line body, same Read more/less collapse
threshold (3 sentences). Differences:
- No `KnowledgeSection` (grapes/tiers block is region-specific).
- No citation footer (decision 7).
- Header reads `Classification · <designation>` instead of
  `Region · <country>`.

### Wiring: `apps/catalog/app/shop/page.tsx`

Alongside the existing region-description block, add:

```tsx
{(() => {
  const designationEntry = findDesignationDescription({
    designation: currentParams.designation,
    productCount: facets.designations.find(d => d.value === currentParams.designation)?.count ?? 0,
  });
  return designationEntry ? <DesignationDescriptionCard entry={designationEntry} /> : null;
})()}
```

`facets.designations` is already computed earlier in the page and already
excludes 0-count designations from its own list — reusing it here means
the count check has one source of truth, not a second query.

## Testing

- Unit test: every one of the 22 `DESIGNATIONS` labels has a matching key
  in `designation_descriptions.json` (fails loudly if content is
  incomplete at merge time, same spirit as the parity test between
  `designation.ts` and `backfill_designation.py`).
- Unit test: `findDesignationDescription()` returns `null` when
  `productCount` is 0, even if a copy entry exists (covers the `VS` case
  directly, not just by inference).
- Render test: `DesignationDescriptionCard` renders sentence-per-line, no
  citation footer, matches `RegionDescriptionCard`'s test shape.
- **Content spot-check (new gate, manual)**: before merge, pick 3 random
  designations from the 22 and verify the `full` copy's factual claims
  against the cited source. Not exhaustive, but a floor higher than zero.
- Browser verification (Rule 7): dev server, `curl` the rendered
  `/shop?region=Italy&designation=DOCG` (and a 0-count case) HTML, same
  method used for PR #104–#106 since this environment has no interactive
  browser tool.

## Explicitly out of scope

- Product detail page designation display/linking.
- Backfilling more products into thin designations (`VS`, `Superiore`,
  etc.) — separate follow-up task.
- Extending `DESIGNATIONS` to include appellation-system labels like AVA
  or DO (would require new regex patterns + backfill parity update — a
  different, larger change than this plan).
- Citation footer on `RegionDescriptionCard` (pre-existing gap, unrelated
  to this work).
