# Wine Knowledge Ingestion — Design Spec

**Date:** 2026-07-25
**Status:** Draft for review
**Author:** Claude (brainstorming session with user)

## 1. Purpose

Digest two reference books — *The Wine Bible* (Karen MacNeil, 2nd ed.) and *Food
and Wine Pairing* (Robert Harrington) — into the existing knowledge graph at
`data/taxonomy.db`, so that:

1. **Curation & selection** — every taxonomy entity (region, subregion,
   appellation, grape variety, style, classification tier) carries meaningful
   structured data: a short at-a-glance description plus full "dig deeper"
   detail, terroir/climate/soil, classification systems, production methods,
   winemaker/history notes, and typical sensory benchmarks.
2. **UI drill-down** — the shipped explore-map drawer surfaces
   `description_short` at a glance and expands to `description_en` + attributes +
   benchmarks on demand.
3. **Collections (future-facing)** — a dynamic saved-filter product-listing
   feature (`/collections/[slug]`) driven by taxonomy attributes, feeding future
   recommendation/matching. Only a minimal define+resolve+URL slice is built this
   round.

**Constraint:** All extraction is done **in-session by Claude reading the books
directly. No paid LLM API calls.** CLAUDE.md Rule 10 (paid-run pre-flight) does
not apply; however, an adapted verification discipline does (§8).

## 2. Existing target schema (confirmed by inspection)

`data/taxonomy.db` already models the shape we need. Confirmed DDL facts that
the fixes below rely on:

- `taxonomy_entities` — `entity_type` currently: country(51)/region(99)/
  subregion(80)/appellation(81)/**brand(612)**.
  **`parent_id` is already self-referential** (`REFERENCES taxonomy_entities(id)`),
  so recursive nesting (Burgundy climats) needs no schema change.
  `UNIQUE(entity_type, slug)`.
- `taxonomy_contexts` — `(entity_id, scope_id)` unique; has
  `description_short`, `description_en`, `attributes` JSON, `status`
  (draft/validated), `validated_by`, `validated_at`. **No source-citation
  column.**
- `taxonomy_benchmarks` — **EMPTY.** `(context_id, dimension_id)` unique;
  `typical_value` + `range_low`/`range_high`. **No source-citation column.**
- `taxonomy_relationships` — **EMPTY.** `from_entity_id`, `to_entity_id`,
  free-text `relationship`, optional `scope_id`, `metadata` JSON.
  **No controlled vocabulary / CHECK constraint on `relationship`.**
- `character_dimensions` — per-scope (already keyed by `scope_id`), 0–5 scale:
  wine has body/acidity/tannin/sweetness/alcohol/intensity/complexity/finish.
- `scope_attribute_defs` — wine.key_grapes, wine.terroir, wine.climate,
  wine.soil, wine.classification_system, wine.aging_potential,
  wine.production_method (+ spirits.*, sake.*).

`products.db` per-product flat fields exist and are **not modified this round**:
`variety` (free-text, often comma-joined blends), `production_style`,
`classification`/`designation`, `body`/`acidity`/`tannin`/`sweetness`/
`intensity`/`finish`, `food_matching`/`food_matching_detail`, geography fields.

## 3. Expert review outcome (sommelier + data architect)

A two-lens review (Master Sommelier + senior data architect) that inspected the
DB and both books produced seven findings, all folded into this design:

| # | Sev | Finding | Fix (this spec) |
|---|-----|---------|-----------------|
| 1 | CRITICAL | Book treats classification/quality-tier (1855 Growths, Grand/Premier Cru, DOCG/DOC/IGT) as its own axis — schema has nowhere for it | New `classification_tier` entity_type (§4.1) |
| 2 | CRITICAL | No source-citation field; multi-session extraction becomes unauditable | Add `source_citation` + `confidence` to contexts & benchmarks (§4.2) |
| 3 | WARNING | `style` would mostly duplicate `appellation` 1:1 | Narrow `style` to cross-region / extra-legal cases only (§4.3) |
| 4 | WARNING | Burgundy climat / Champagne cru break the fixed 4-level ladder | Use existing recursive `parent_id`; Burgundy is the stress-test (§4.4) |
| 5 | WARNING | Collections can't cleanly join `grape_variety` → `products.variety` | Layer 3 v1 filters clean-join fields only; grape filters blocked (§6) |
| 6 | WARNING | `pairing_rules` captures only Harrington's component-matching layer | Scope explicitly to component-matching; note traditional-pairing gap (§5) |
| 7 | INFO | `relationship` free-text will drift across sessions | Controlled relationship vocabulary defined up front (§4.5) |

Plus INFO: 0–5 dimensions are already `scope_id`-scoped, so wine/spirits/sake
don't collide — invariant: **no cross-scope numeric comparison in UI** (§8).

## 4. Layer 1 — Taxonomy data (schema changes + book digestion)

### 4.1 New `classification_tier` entity_type (fix #1)

Classification/quality tier is a **separate axis** from geography and from style
— exactly the "designation" concept CLAUDE.md Rule 12 flags as structurally
missing on the product side. Model it as a new `entity_type='classification_tier'`
node (e.g. "Bordeaux 1855 First Growth", "Burgundy Grand Cru", "DOCG",
"Champagne Grand Cru village"). The governing appellation/region links **to** the
tier via `classified_under`, in the canonical direction fixed in §4.5
(`from = appellation/region`, `to = classification_tier`). This keeps "how
legally/quality tiered" cleanly separate from "what it tastes like" (benchmarks)
and "what shape it is" (style).

Where one tier node **outranks** another within a nested hierarchy (e.g. a
Burgundy Grand Cru climat outranking its parent village — §4.4), that ordering is
expressed by the `outranks` relationship (§4.5), not by prose. Rank need not be a
separate scalar this round; the directed `outranks` edge is sufficient for UI
ordering.

This is the schema-side twin of the products.db `designation` gap; it does not
attempt to backfill products this round.

### 4.2 Source citation + confidence on data rows (fix #2)

Add to **both** `taxonomy_contexts` and `taxonomy_benchmarks`:

- `source_citation TEXT` — e.g. `"Wine Bible 2e, France/Bordeaux ch."` (book +
  rough location; line-range acceptable since the source is a local md file).
- `confidence TEXT` — enum `high` / `medium` / `low`. Benchmarks derived from
  narrative prose (not lab data) are **at most `medium`**, and their provenance
  is explicitly "derived from narrative tasting description, not measured."

**Invariant (Rule 6-adapted):** every row with `status='validated'` MUST have a
non-null `source_citation`. This is the guardrail that keeps months-later data
auditable when there is no paid-API consistency check.

### 4.3 New `style` and `grape_variety` entity_types — narrowly scoped (fix #3)

- `grape_variety` — first-class node (Nebbiolo, Chardonnay…), seeded from the
  book's "Top 25 Grapes" + A-Z glossary. Linked to regions via `grown_in`.
- `style` — **NOT** minted 1:1 for every appellation. Created **only** where a
  style does not collapse onto an existing appellation:
  - cross-region styles (Rosé, Orange/skin-contact wine),
  - extra-legal / trans-appellation categories (Super Tuscan),
  - quality-tier-driven styles that span appellations.
  Where "style" == the appellation (Chablis, Barolo), the UI drills to the
  **appellation** directly; no pass-through style node is created.

  **Note:** the third bullet ("quality-tier-driven styles that span
  appellations") is a reviewer-judgment heuristic, not a mechanical test — the
  ingesting session decides case-by-case, defaulting to NOT creating a style node
  when in doubt (bias toward appellation drill-down).

Linkages involving these nodes use the controlled vocabulary in §4.5:
`grown_in` (grape → region/appellation), `produces_style` (region/appellation →
style), and `exhibits_style` (grape_variety → style, e.g. Nebbiolo → Barolo
style; also used for classification_tier → style where a tier defines a style).

### 4.4 Recursive appellation nesting (fix #4)

Do **not** assume a fixed country→region→subregion→appellation depth. Use the
existing self-referential `parent_id` so an appellation can nest under another
(Burgundy: climat → village → region). Burgundy and Champagne are the explicit
**stress-test cases** — validate the ingestion pattern on them before
generalizing to other countries. A Grand Cru climat may carry its own
classification_tier relationship, and may `outranks` its parent village (§4.5).

**Authoring rule for hierarchy (single source of truth):** geographic nesting is
authored **via `parent_id` only**. The `sub_appellation_of` relationship in §4.5
is a *derived convenience edge* for graph queries that traverse
`taxonomy_relationships` uniformly — if written at all, it MUST mirror `parent_id`
exactly and is generated from it, never authored independently. When they would
disagree, `parent_id` wins. This prevents two ingestion sessions from recording
the same hierarchy in different places.

### 4.5 Controlled relationship vocabulary (fix #7)

Define the allowed `relationship` values **before any writes** (documented in the
spec; enforced by a small reference constant used by the ingestion scripts, and
optionally a CHECK constraint). Each row is written in the canonical direction
shown (`from_entity_id` → `to_entity_id`); the wrong direction is not
self-correcting under the table's `UNIQUE(from,to,relationship,scope_id)`
constraint, so direction is fixed here and MUST be followed verbatim:

- `grown_in` — grape_variety → region/appellation
- `produces_style` — region/appellation → style
- `exhibits_style` — grape_variety **or** classification_tier → style
- `sub_appellation_of` — appellation → appellation/region. **Redundant with
  `parent_id`; see the authoring rule below.**
- `classified_under` — appellation/region → classification_tier
- `outranks` — classification_tier → classification_tier (Grand Cru climat
  outranks its parent village; §4.4)

This closes every entity linkage the spec relies on: geography↔geography
(`sub_appellation_of`), geography↔tier (`classified_under`), tier↔tier
(`outranks`), grape↔geography (`grown_in`), geography↔style (`produces_style`),
and grape/tier↔style (`exhibits_style`). Any linkage not in this set is out of
scope this round and no prose elsewhere may imply one. No session invents ad-hoc
synonyms (`is_grown_in`, `sourced_from`).

### 4.6 Content deepening (existing tables)

For country/region/subregion/appellation contexts, replace today's thin
synthetic blurbs with book-sourced `description_short` (UI glance) +
`description_en` (full) + `attributes` JSON (terroir, climate, soil,
classification_system, aging_potential, production_method, key_grapes) +
winemaker/history narrative. Populate `taxonomy_benchmarks` with typical
body/acidity/tannin/sweetness values **as ranges with `confidence` and
narrative-derived provenance** — never as false-precision single points implying
lab measurement.

### 4.7 Extraction order

1. **Foundational "Mastering Wine"** chapters (Wine Bible ~lines 360–5900):
   Nine Attributes, terroir/climate/soil, viticulture, winemaking, Top 25 Grapes
   + A-Z glossary. Seeds `grape_variety` entities and grounds
   `character_dimensions`/benchmark vocabulary everything else references.
2. **Country chapters** in catalog-SKU-weighted order: France (2,837) → Italy
   (2,118) → USA (982) → Australia (831) → Chile (489) → Spain (409) → rest.
   Burgundy/Champagne handled as §4.4 stress tests within France.

## 5. Layer 1b — `pairing_rules` table (fix #6)

New `pairing_rules` table extracts Harrington's **component-matching** layer only:
rules keyed on wine `character_dimensions` × food attributes, e.g.
`acidity>=4 AND food.fat=high → +2 ("cuts richness")`. Generalizes to any product
via its existing body/acidity/tannin/sweetness fields — **not** per-SKU tagging.
Each rule carries `source_citation`.

**Explicit scope note (not a silent gap):** Harrington's framework also covers
regional/traditional dish-led pairing and contrast-vs-congruence logic. This
round captures **only** component-matching. Traditional/regional pairing is a
**known, documented limitation** of the rules table, deferred — the table's
design must not imply full pairing coverage.

## 6. Layer 2 — UI surfacing (explore-map drawer)

Reuse the shipped MapLibre explore-map drawer (PR #66). Add `grape_variety`,
`style`, and `classification_tier` as new clickable/searchable nodes alongside the
existing country→region→subregion→appellation drill-down. Drawer shows
`description_short`; "learn more" expands to `description_en` + attributes +
benchmarks. No new standalone pages this round.

**Deliberate asymmetry (grape browse-yes / filter-no):** a user CAN click a
`grape_variety` node here and read its knowledge, but CANNOT build a Collection
filtered by grape variety (§7) — because `products.variety` is free-text and has
no clean join to the grape node yet. This split is intentional, not a bug; it is
resolved only if/when products.db variety normalization happens (out of scope).

## 7. Layer 3 — Collections (minimal slice, fix #5)

New `collections` table: `slug`, `name`, `filter_definition` JSON, `description`.
A resolver turns `filter_definition` → a products query at request time (dynamic
membership; new matching products auto-join). URL `/collections/[slug]` with
in-page sort/filter reflected in the URL.

**Scope boundary (critical):** `filter_definition` v1 filters **only on fields
that already join cleanly as scalars** in products.db: country / region /
subregion / appellation / character-dimension ranges (body/acidity/etc.).
**`grape_variety`-based collections are explicitly BLOCKED** this round —
`products.variety` is free-text and comma-joined for blends, so a taxonomy
`grape_variety` node has no reliable join path without a products.db
normalization decision that is out of scope here. Layer 3 must not be designed as
if that join exists.

Schema leaves room for a future `collection_pins` table (manual add/exclude
overrides layered on the dynamic filter) — **not built this round.**

## 8. Verification & invariants (adapted CLAUDE.md rules)

Because there is no paid API, "verify paid work landed" (Rule 1) is adapted to
"verify **I** did not silently drop or fabricate data":

- **Citation invariant (Rule 6):** every `status='validated'` context/benchmark
  row has a non-null `source_citation`. Integration test asserts this.
- **Benchmark provenance:** narrative-derived benchmarks are `confidence` ≤
  `medium` and stored as ranges, never lab-precision points.
- **Relationship vocabulary invariant:** every `taxonomy_relationships.relationship`
  value ∈ the §4.5 controlled set.
- **No cross-scope numeric comparison** in explore-map UI (wine tannin ≠ spirits
  peat even though both are 0–5).
- **Rule 12 guard:** classification/quality tier lives in `classification_tier`
  entities, never conflated with `style` or with category/type.
- **UI proof (Rule 7):** after each country chunk, load the explore-map drawer
  and confirm new nodes + deepened context actually render.
- **Count check:** after each chunk, a row-count query confirms the expected
  entities/contexts/benchmarks/relationships landed.

## 9. Out of scope (this round)

- Any `products.db` schema change (variety normalization, designation backfill).
- Manual `collection_pins`; recommender integration beyond making data available.
- Collection listing-page visual/UX polish.
- Traditional/regional pairing logic (component-matching only).
- Asia/sake deep chapters (Wine Bible coverage is thin); spirits/whisky books
  are a separate future effort.
- Any paid-API enrichment.

## 10. Build order summary

1. Schema migration: add `classification_tier`/`style`/`grape_variety` entity
   types (data-level, `entity_type` is free-text so no DDL change needed for the
   types themselves); add `source_citation` + `confidence` columns to
   `taxonomy_contexts` and `taxonomy_benchmarks`; document relationship
   vocabulary. Idempotent (per feedback: shared DB reverts between turns).
2. Ingest foundational chapters → grape_variety entities + benchmark grounding.
3. Ingest France (Burgundy/Champagne stress test) → verify → then Italy → etc.
4. Layer 2 drawer wiring for new node types.
5. Layer 3 minimal collections define+resolve+URL (clean-join fields only).
6. Invariant tests (§8) run after each bulk write.
