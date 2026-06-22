# Universal Product Attribute Model — Design

**Date:** 2026-06-22
**Status:** Design (awaiting implementation plan)
**Author:** brainstormed with the user (Orchestrator)

## Problem

The product schema privileges wine. Sensory and varietal facts live in
wine-named columns (`grape_variety`, `wine_body`, `wine_acidity`, `wine_tannin`,
`wine_color`, `wine_production_style`). But:

- These columns are **already populated on non-wine products** — 223 spirits,
  166 whiskies, 82 sake rows carry `wine_body`/`wine_acidity`/`wine_tannin`; 39
  spirits + 2 sake carry `grape_variety`. The enrichment writers already treat
  them as semi-universal sensory fields; only the *names* say "wine".
- The product page already renders generic labels — `wine_body` → "Body",
  `wine_acidity` → "Acidity", `wine_tannin` → "Tannin" — for every category. The
  one mislabel is `grape_variety` → "Grape", so a Don Julio tequila page reads
  **"Grape: Blue Agave"**.
- The data-validity audit (`scripts/audit_data_validity.py`) flags 417
  "spirit/whisky with wine-only attrs" as warnings. Under a universal model these
  are **correct enrichment, not errors** — the finding's lens is wrong.

The user's framing: attributes should be **universal concepts interpreted per
category** (not "grape variety" but "variety" holding Blue Agave / Ugni Blanc /
Barley / Chardonnay), so any category can carry rich detail, and the catalog can
be **enriched more and more** over time.

## Goals

1. Generalize the wine-named attribute columns into category-neutral names.
2. Establish a small universal sensory model (+ optional category-specific axes)
   that future enrichment fills across all categories.
3. Plan enrichment that backfills the model: free rules/lookups first, paid LLM
   only for the gaps, fully Rule-10 gated.

## Non-Goals

- **Not** adopting the normalized relational tables (`grapes`/`product_grapes`,
  `flavor_profiles`). They exist in Supabase but the grape ones are empty (0 rows)
  and the catalog reads flat JSON. Recorded as a possible future normalization
  phase; out of scope here. (See "Deferred / future".)
- **Not** building the `designation` field. `wine_classification → designation`
  overlaps the already-planned category/classification remodel
  (`project_category_classification_remodel` in memory); folded into that effort,
  not duplicated here.
- **Not** changing the taste_profile / flavor_tags / food_matching pipelines.

## The attribute model

### Renames (universal — type-preserving)

| Current column          | New name           | Holds (examples across categories)                          |
|-------------------------|--------------------|-------------------------------------------------------------|
| `grape_variety`         | `variety`          | Chardonnay · Blue Agave · Ugni Blanc · Barley · Rice        |
| `grape_blend_type`      | `blend_type`       | single varietal / blend / 100% agave / single vs blended    |
| `wine_body`             | `body`             | Light → Full                                                |
| `wine_acidity`          | `acidity`          | (wine-applicable optional axis)                             |
| `wine_tannin`           | `tannin`           | (wine-applicable optional axis)                             |
| `wine_color`            | `color`            | red/white/rosé · amber/gold · blanco/reposado/añejo · stout |
| `wine_production_style` | `production_style` | oak-aged, pot-still, peated, sparkling-method (ARRAY type)  |

**Type note (load-bearing):** `wine_production_style` is a Postgres **`text[]`
ARRAY** (Supabase) and a JSON-encoded string in SQLite/export. The rename MUST
preserve these types; it is a name change only.

### New columns (nullable; enrichment fills over time)

- **Universal core:** `sweetness`, `intensity` (apply to all categories;
  `body` already exists post-rename).
- **Optional category axes:** `smokiness`, `finish` (whisky/spirits-oriented).

### Dropped (dead / duplicate — verified ~0% filled)

- `wine_type` — duplicates the SKU-derived `category_type` (two sources of "type"
  that can disagree); defer to `category_type`.
- `other_type` — vestigial catch-all, 0% everywhere.

### Kept as-is

`alcohol` (already universal by definition, just unfilled — enrich, don't rename),
`flavor_tags`, `taste_profile`, `food_matching`.

> **Layer note:** `category_group` and `category_type` are **export-derived**
> (computed by `refresh_live_export.py` from the SKU taxonomy; present in
> `live_products_export.json`, NOT columns in `products.db`). So the `wine_type`
> drop is justified by deferring to the SKU-derived `category_type` *in the
> export* — verify the deprecation against the export, not a sibling DB column.

## Migration architecture — ATTRIBUTE_MAP + 3 stages

The rename touches **three independent systems**: SQLite (`data/db/products.db`),
~20 Python enrichment/export scripts, and **Supabase** (external Postgres,
project `dsyplzckfezcxiuikkfm` "WNLQ9 PI DB", 11,436 rows, same column names).
TypeScript's compiler covers the catalog layer; Python and Postgres have no
compiler, so a stale reference fails silently at runtime (incl. the nightly
Supabase sync and Drive knowledge-base export).

### The seam: one shared rename map

```
data/lib/taxonomy/attribute_map.py   # ATTRIBUTE_MAP = {"grape_variety": "variety", ...}
apps/catalog/lib/attribute-map.ts    # mirror; a parity test guards they match
```

Scripts import the map instead of hardcoding column names — this fixes the
"~20 scattered string literals" problem permanently, and makes the rename *data*
rather than code scattered everywhere.

### Stage 1 — Databases (the coupled pair)

1. Back up SQLite: `cp data/db/products.db data/db/products.db.bak-pre-attr-rename-<ts>` (Rule 10).
2. `ALTER TABLE RENAME COLUMN` on SQLite (3.25+; macOS build supports it) for each
   rename; `ALTER TABLE ... ADD COLUMN` for the 4 new cols.
3. Same RENAME + ADD migration on Supabase via MCP `apply_migration` (one
   **fully-reversible** SQL file — renames and ADDs only).
4. **DROP `wine_type`/`other_type` as a SEPARATE, later migration** (one-way door).
   `DROP COLUMN` is not reversible without re-adding + re-syncing, so it is split
   out so the rename migration stays cleanly reversible. Before the drop, verify
   0-fill on **Supabase specifically** (not just SQLite): `SELECT count(*) FROM
   products WHERE wine_type IS NOT NULL` etc.
5. Update `sync_to_supabase.py` `PRODUCT_SYNC_COLUMNS` (lines ~36–37) to new names.
6. **Verify:** SQLite + Supabase column lists match the new names; a delta sync
   round-trips; `SELECT count(*)` parity per renamed column (data survived);
   `production_style` is still ARRAY in Postgres / JSON in export (type preserved).

### Stage 2 — Pipeline + Python readers

1. `refresh_live_export.py`: `EXPORT_COLS` → new names; emit new field names.
2. **First step of the plan:** produce the exhaustive caller list via
   `grep -rl` for each old column name across `scripts/` + `data/lib/` (the
   spec's "~20" is indicative, not the authority — the grep is). Flip every hit
   via `ATTRIBUTE_MAP` so none is silently missed. Known callers include
   export_ai_knowledge_base[_slim], write_descriptions, fix_data_consistency.
3. Regenerate `live_products_export.json`.
4. **Verify:** per-attribute fill counts in the new export equal the pre-rename
   counts under the old names (no data lost in translation).

### Stage 3 — Catalog (TypeScript)

1. Rename fields in `apps/catalog/lib/types.ts` (the choke point). `tsc` then
   enumerates every consumer.
2. Fix the ~8 consumers: catalog-data, shop-query, shop-facets, finder/scoring,
   recommender, taste-adapter, QuickView, product/[sku]/page.
3. Relabel UI: `AttrRow label="Grape"` → `"Variety"` (product page line ~258).
4. **Gate (Rule on build, not just tests):** `npm run build` green (cross-branch
   prop/type semantic conflicts only surface here), plus a browser walkthrough of
   a spirit product page (Rule 7) confirming "Variety" renders, not "Grape".

## Enrichment plan — rules-first, LLM for gaps, gated

### Phase A — Rules / lookup (free, no spend)

Deterministic backfill, auditable, zero tokens:
- `variety` from product name (extend `data/lib/name_inference`).
- `smokiness` from name keywords ("Islay", "peated", "smoky").
- `color` for spirits from type (blanco/reposado/añejo) and category.
- `sweetness` from style/classification keywords.

Lands and is verified before any paid run.

### Phase B — LLM gap-fill (paid — Rule 10, estimate-first)

Only rows Phase A can't fill. **Spend is estimated and signed off BEFORE running:**
1. Backup target table.
2. 5-SKU canary; verify in the UI.
3. Estimate full-run cost from the canary per-SKU rate; **show the user the number
   and get sign-off** (Rule 10 step 5).
4. Run full job; reuse `enrichment_cache` (533 rows) so re-runs are cheap.
5. Verify shipped: count query on the new columns AND a UI walkthrough (Rule 1/4).

### Verification tooling

`audit_data_validity.py`: **invert** the `WINE_ONLY_ATTRS` check — stop flagging
"spirit has variety/body" as a warning; instead report fill-rate of the universal
axes per category (a coverage dashboard, not a defect list). Update the audit's
companion review-CSV exporter accordingly.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Silent Python/Postgres breakage on stale column name | ATTRIBUTE_MAP single source; staged with per-stage verification; sync round-trip test |
| `production_style` ARRAY type lost in rename | Rename is name-only; explicit type-preservation check in Stage 1 verify |
| Supabase + SQLite drift mid-migration | Stage 1 migrates BOTH before any reader flips; parity check |
| Cross-branch build conflict | `npm run build` gate in Stage 3, not just tsc+vitest |
| Paid enrichment overspend / silent drop | Rule 10 full gate; estimate-first; verify shipped to user-facing export |
| Collision with category/classification remodel | `designation` explicitly deferred to that effort; not built here |

## Deferred / future

- **Relational normalization:** populate `product_grapes` from `variety`, use
  `flavor_profiles` for structured sensory. Richer (synonyms, blend %), but the
  catalog reads flat JSON so it would need a denormalized view; revisit later.
- **`designation`** field — via `project_category_classification_remodel`.

## Success criteria

1. Schema uses category-neutral attribute names across SQLite, Supabase, export,
   and catalog; `npm run build` green; product pages show "Variety" not "Grape".
2. No data lost: per-attribute fill counts identical pre/post rename.
3. Phase A rules backfill lands and is verified (free).
4. Any Phase B spend is estimated, signed off, and verified as shipped per Rule 10.
5. The audit reports universal-axis coverage instead of false "wine attr on
   spirit" warnings.
