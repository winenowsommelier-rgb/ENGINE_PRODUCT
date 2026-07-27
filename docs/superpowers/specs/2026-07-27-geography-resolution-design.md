# Geography Resolution — 4-Level Hierarchy + Column Reclassification

**Date:** 2026-07-27
**Status:** Approved (design), implementation not started
**Origin:** "Why are most our USA wine shown as California? Is it all really California?"

---

## 1. Problem

The explore map shows 619 USA products under a single "California" pin. Investigation
found the underlying data is fine — the map discards it. Three independent defects
stack up to produce the symptom.

### Defect 1 — the map aggregates on `region` only

`apps/catalog/scripts/gen-explore-map-data.mjs:106` reads `r.region` and never reads
`r.subregion`. For USA wine, `region` holds the **state** and `subregion` holds the
actual wine region:

| region | subregion | rows |
|---|---|---|
| California | Napa Valley | 296 |
| California | Sonoma County | 71 |
| California | Central Coast | 28 |
| California | Carneros | 15 |
| California | Paso Robles | 8 |

**~78% of the 605 California rows in the export carry a named sub-AVA that the map throws
away.** Only ~134 are genuinely "California, unspecified".

(Export figures per Rule 9. The DB has 619/299 — slightly ahead of the last export
refresh. The export is what the UI and the invariant tests read, so it governs here.)

This is not a USA problem. It is structural and global:

- **Australia** — `South Australia` swallows Barossa Valley (125), McLaren Vale (61),
  Coonawarra (29), Adelaide Hills (17).
- **Chile** — `Central Valley` swallows Colchagua (140), Maipo (96), Maule (63),
  Curico (39). `Central Valley` is a bureaucratic super-zone nobody shops by.

### Defect 2 — a hierarchy collapse disguised as a spelling alias

`apps/catalog/lib/geo-aliases.ts:5-14`:

```ts
const REGION_ALIASES_BY_COUNTRY = {
  usa:      { napa: 'California', 'napa valley': 'California' },
  scotland: { highlands: 'Highland', lowlands: 'Lowland' },
};
```

Two different concepts share one table. `highlands → Highland` is a genuine **spelling
normalization**. `napa valley → California` is a **hierarchy collapse** — it destroys a
level. The taxonomy file already has a Napa pin with real coordinates (lat 38.5) sitting
unused.

This module is shared: `/shop` filtering (`shop-query.ts`) and facets (`facets.ts`) both
import it, and `gen-explore-map-data.mjs` hand-copies it (it is plain `.mjs`, so it cannot
import TS). Any change here has blast radius beyond the map.

Introduced in `c47072f fix(catalog): normalize shop geography filters`. **Pre-existing —
not introduced by the current branch.**

### Defect 3 — `subregion` is a catch-all

Of 6,482 rows carrying a subregion, **682 distinct values are not places**:

| Value | What it actually is | Correct column |
|---|---|---|
| Barolo, Chianti Classico, Châteauneuf-du-Pape | appellation | `appellation` |
| Bordeaux Supérieur | appellation tier | `appellation` |
| Vin de France, Tre Venezie | legal catch-all | (none — clear) |
| Valpolicella Ripasso, Rosso di Montalcino | production method | **no destination exists — leave in place** |

`appellation` (956 populated) is a genuine free-text destination that already holds
Barolo / Chablis / Chianti for some rows, so the same concept is currently split across
two columns depending on the row. That is the migration this spec performs.

**`production_style` is NOT a destination.** Despite the name it is a **closed
7-token viticulture vocabulary stored as a JSON array** — `["Conventional"]` (3,702),
`["Organic"]` (72), `["Orange"]`, `["Biodynamic"]`, `["Vegan"]`, `["Natural"]`,
`["Pet-Nat"]`. Typed `production_style?: string[]` (`lib/types.ts:62`) and
JSON-serialized via `JSON_COLS` (`scripts/refresh_live_export.py:112`). Writing
"Valpolicella Ripasso" into it would be **the same closed-vocabulary violation this spec
forbids for `designation`** (constraint 6). Winemaking-method values therefore have **no
correct column today** and stay in `subregion`, flagged for review (§5 B1).

---

## 2. Coordinate coverage — measured, not assumed

`data/taxonomy/explore-taxonomy.json` has four arrays. The generator reads only two.

| Array | Entries | With coords | Read by generator today |
|---|---|---|---|
| `countries` | — | yes | yes |
| `regions` | 300 | 300 | yes |
| `subregions` | 81 | 81 | **no** |
| `appellations` | 81 | 81 | **no** |

`subregions` carries a real hierarchy (`parentSlug` / `grandparentSlug`) that is
entirely unused.

Measured resolution rate for the 6,482 rows that have a subregion:

| Strategy | Resolvable |
|---|---|
| `regions` only (today) | **19.2%** (1,244 rows) |
| + `subregions` + `appellations`, accent-normalized | **60.5%** (3,924 rows) |

The "before" figure is 19.2%, not the ~51% quoted in an earlier draft — the win is
roughly 3x larger than first stated.

Normalization matters: `Châteauneuf-du-Pape` resolves only by exact-spelling luck today;
`Penedès` does not resolve at all.

**Remaining gap: 682 distinct values / 2,558 rows, with a very flat tail** — the top 25
values account for only 28% of the remainder. Reaching ~85% coverage would require
authoring 300+ coordinates. Decision: do not chase the tail (see §4 A4/A5).

**Measurement method — reproduce it exactly or you will get a different number.** All
counts are over `data/live_products_export.json` (Rule 9: the export is the UI source,
not the DB), filtered by **all four** of:

1. non-empty `sku` — mirrors `gen-explore-map-data.mjs:100`
   (`if (!r || typeof r.sku !== 'string' || !r.sku) continue`).
2. `category_group` not in Accessories / Events / Cigars / Non-Alcoholic
   (`gen-explore-map-data.mjs:18`)
3. non-empty `subregion`
4. NFKD accent stripping **plus** punctuation collapse before name matching

Yielding **6,482 rows / 682 distinct unresolved / 2,558 unresolved rows / 19.2% / 60.5%**
— verified reproducible. The raw DB without exclusions gives 6,511 / 686 / 2,572; that
delta is noise and changes no decision, but quote the four-filter figures for consistency.

The tail is also mostly *not* the wine regions that prompted the question — the largest
gaps are Japanese sake geography (Niigata 74, Kumamoto 38, Kobe 35, Fushimi 22, Nada 16)
and Italian/French appellations.

---

## 3. Constraints

1. **Rule 9** — the UI reads `data/live_products_export.json`, not the DB. Any DB write
   must be followed by `scripts/refresh_live_export.py`.
2. **Rule 10** — Phase B writes to `products.db`: backup → canary → verify → sign-off.
3. **Rule 7** — map changes are UI changes: browser verification required, not just tests.
4. **Rule 12** — do not touch or branch on raw `classification`.
5. **Map total must equal shop grid total.** `gen-explore-map-data.mjs:75-81` keys region
   buckets by country specifically to hold this invariant. Guarded by
   `explore-map-gen.test.ts` and `explore-map.invariant.test.ts`.
6. **`designation` is a closed vocabulary.** `lib/designation.ts:19-42` defines 22
   canonical labels, most-specific-first, parity-guarded against
   `scripts/backfill_designation.py` by `tests/test_designation_parity.py`. **Nothing in
   this work writes a novel string into `designation`.**
7. **UI label vs field name.** `components/Filters.tsx:947-955` labels the `designation`
   facet **"Classification"** — matching user vocabulary per Rule 12. Field name and
   label differ by design; do not "fix" either.

---

## 4. Phase A — 4-level map hierarchy (read-only)

Ships first. No DB writes. Independently valuable — does not depend on Phase B.

### A1. Split the alias table by intent

In `lib/geo-aliases.ts`, replace the single table with two:

```
SPELLING_ALIASES  — { scotland: { highlands: 'Highland', lowlands: 'Lowland' } }
                    rewrite the value (keep current behaviour)

HIERARCHY_PARENT  — { usa: { 'napa valley': 'California' } }
                    a PARENT link used for rollup — NOT a rewrite
```

`canonicalRegionForCountry` stops rewriting Napa.

Three consequences, all of which must be handled together:

**(a) `isRegionLevelValueForCountry` must read the UNION of both tables' values.**
Today it tests membership in `Object.values(REGION_ALIASES_BY_COUNTRY[country])` =
`{california, highland, lowland}` (`geo-aliases.ts:38`). After the split,
`HIERARCHY_PARENT` values = `{california}` and `SPELLING_ALIASES` values =
`{highland, lowland}`. Reading only the former would **regress Scotland**. It must be
the union of both. Call sites: `facets.ts:89`, `shop-query.ts:110`.

**(b) `regionMatchesFilter` must consult `HIERARCHY_PARENT` for ancestor matching.**
`geo-aliases.ts:41-47` is built on `canonicalRegionForCountry` and is what actually
filters the grid (`shop-query.ts:188`). Once Napa stops being rewritten, a product with
`region='Napa Valley'` stops matching `?region=California`. `regionMatchesFilter` must
return true when the filter names either the product's own region **or any of its
ancestors** via `HIERARCHY_PARENT`.

**Scale of this regression, measured: 1 row — not 299.** Only **one** export row has
`region='Napa Valley'`. The 296 Napa products live at
`region='California', subregion='Napa Valley'` and already match `?region=California`
by direct equality; the alias never touched them. An earlier draft of this spec claimed a
299-row cliff here — that was wrong by 300x.

Keep the ancestor fix anyway, but for the right reason: it is **correctness insurance for
Phase B**. B3 normalizes swapped/junk region values, which can move rows *into*
`region='Napa Valley'`-shaped states. Without ancestor matching those rows would silently
vanish from the California grid later, far from this change. It is cheap now and
load-bearing then.

**(c) `shop-query.test.ts:148-159` asserts the OLD behaviour and must be rewritten.**
It asserts `{region:'Napa Valley', subregion:'Oakville'}` → `{region:'California'}`.
Phase A necessarily breaks it. Per **Rule 5** this is an anti-test: it locks in the
hierarchy collapse. Rewrite it to assert the new behaviour, with a regression-guard
comment explaining the history. It is a **blocker requiring deliberate rewrite**, not a
passive safety net. (`shop-query.test.ts:167-175` keeps passing under fix (a).)

**This is the riskiest edit in Phase A.** It changes `/shop` filter semantics for Napa
products, and (b) is the specific path that threatens constraint 5.

### A2. One resolver, three coordinate tables

New pure function:

```
resolveGeoNode(country, region, subregion, appellation)
  → { pinName, pinLevel, parentName, latitude, longitude } | null
```

Searches most-specific-first: `appellations` → `subregions` → `regions`. Lookup key is
name normalized for accents and punctuation (NFKD → ASCII → lowercase → collapse
non-alphanumerics). Field names are `latitude`/`longitude` to match the taxonomy source
schema — do not rename to `lat`/`lng`.

Two data hazards this resolver must handle explicitly:

**Appellations have no parent link.** 0/81 appellation entries carry `parentSlug`
(all 81 subregions do). So an appellation cannot look up its own parent from the
taxonomy. **Rule: an appellation inherits its parent from the row it was resolved for**
— i.e. the row's own resolved subregion, else its resolved region. The parent chain is
built from the product row, not from the appellation entry.

**26 names exist at more than one level.** `Barossa Valley`, `California`, `Bordeaux`,
`Alsace`, `Maipo Valley`, `Alexander Valley` and 20 others appear as both region and
appellation (or region and subregion). Naive most-specific-first would resolve
`California` to the parentless *appellation* entry and orphan it. **Rule: the search is
scoped by the field the value came from** — a value in the row's `region` field resolves
against `regions` first, a value in `subregion` against `subregions` first. Cross-level
lookup is a fallback, never the first choice.

**Same name at two levels is expected, not a bug.** Chile has both
`region='Maipo Valley'` (3 rows) and `region='Central Valley', subregion='Maipo Valley'`
(91 rows). Field-scoped lookup resolves these to *different* nodes — a region-level pin
and a subregion-level pin sharing a display name under different parents. That is the
correct outcome (different rows, different provenance) and it neither orphans nor crashes.
The underlying inconsistency is a data problem, addressed by §5 B3's swapped-field
cleanup, not by the resolver.

Lives in the shared TS module. Because `gen-explore-map-data.mjs` is plain `.mjs` and
cannot import TS, it mirrors the logic — matching the existing documented pattern
(`gen-explore-map-data.mjs:1-10`), with a parity test rather than code reuse.

### A3. Aggregate at four levels

`country → region → subregion → appellation`.

Each node carries **two distinct totals**. Conflating them is the single easiest way to
break constraint 5:

| Field | Meaning | California example (export figures) |
|---|---|---|
| `ownTotal` | rows resolving to **this node exactly** | ~134 (unattributed only) |
| `inclusiveTotal` | `ownTotal` + all descendants | ~605 (incl. Napa 296, Sonoma 71…) |

Rules:

- A row produces a pin at its **most specific resolvable node**, and increments that
  node's `ownTotal` — **exactly once, at exactly one node**.
- `inclusiveTotal` is **derived** by summing the subtree afterwards. It is never
  incremented per-row, so ancestor-counting cannot double-count.
- A node that cannot be resolved to coordinates **rolls up to its parent** — the parent's
  `ownTotal` absorbs it. **No row is ever dropped.**

**Which total the invariant compares — and why.**
`explore-map.invariant.test.ts:13-22` asserts `STRICT` equality between the map total and
`applyShopQuery(all, {bev, country, region}).total`, iterating `data.regions`.

The reason a **region** pin compares against `inclusiveTotal` is NOT ancestor matching.
It is that `matchesFilters` tests `p.region` only (`shop-query.ts:188`) and **the child
rows still carry the parent's region value** — all 605 California rows have
`region='California'`, including the 296 whose subregion is Napa Valley. So the grid for
`{country:'USA', region:'California'}` is inherently inclusive of sub-AVAs, before and
after A1(b). The map-side subregion split has **no shop-side counterpart**. Getting this
backwards sends an implementer hunting through ancestor-matching code when the test fails.

**Per-level hand-off — the invariant test must key its query off `pinLevel`:**

| `pinLevel` | shop query | compare against |
|---|---|---|
| region | `{bev, country, region}` | `inclusiveTotal` |
| subregion | `{bev, country, region, subregion}` | `ownTotal` |
| appellation | *(see A3a — blocked)* | — |

A subregion pin must emit `region=` **and** `subregion=`, because that is where the data
actually lives. Querying `{region:'Napa Valley'}` for the Napa pin would return **1 row**
against an `ownTotal` of 296 and fail strict equality. `shopHref` in the generator must be
extended accordingly — it currently emits `{country, region}` only.

Additional required test case: `inclusiveTotal == ownTotal + Σ children` for every node.

The drawer's "N products here" copy should show `ownTotal` where child pins exist, or the
pin double-reads as containing everything beneath it.

### A3a. Appellation pins are BLOCKED on a shop-side filter

`shop-query.ts` has **no `appellation` clause at all** — verified, zero occurrences of
`params.appellation` in `matchesFilters`. An appellation-level pin therefore has **no
expressible `/shop` query**, and the strict invariant would demand a grid total that
cannot be produced. Constraint 5 cannot validate a pin it cannot query.

Resolve before Phase A ships. Two options, decide at implementation:

- **(i) Pull the `appellation` filter clause out of §6 into Phase A** — add
  `params.appellation` to `matchesFilters` plus `shopHref` support. Small, mirrors the
  existing `subregion` clause exactly, and unblocks 4-level pinning as designed.
- **(ii) Ship Phase A at 3 levels**, using appellation coordinates only to *resolve* a row
  to its parent subregion/region, never to place a pin. Defers all appellation work to §6.

**Recommendation: (i).** It is a handful of lines mirroring `shop-query.ts:190-191`, and
(ii) discards the Barolo/Châteauneuf/Brunello pins that motivated 4-level in the first
place. But (i) **must be explicitly in scope** — it is not free, and Phase A cannot ship
4 levels without it.

**Exact scope of option (i)** — three edits, all small:

1. `matchesFilters` — one clause mirroring `shop-query.ts:190-191` verbatim. Clauses are
   independent ANDs, so this alone makes the grid total correct.
2. `shopHref` (`lib/explore/map-data.ts:51-59`) — add `appellation` to the query object.
   It currently emits `{bev, country, region, group}` only.
3. **`drill-query.ts:19-25` — add `'appellation'` as a descendant of both `region` and
   `subregion`.** Without this a stale `appellation=` **survives a region change**, since
   nothing clears it. This is a functional bug, not cosmetic. `DrillBreadcrumb.tsx:27`
   hardcodes `GEO_STRAND = ['country','region','subregion']` and would also need the
   fourth entry for a crumb to render.

**Explicitly still deferred to §6 even under (i):** `facets.ts` has no `appellationsFor()`,
so no filter *chip* renders. The URL filter works and the invariant passes; the chip is
the deferred part.

### A4. ~30 curated coordinates

Hand-added for **genuine places only**, ranked by row count: Niigata / Kumamoto / Nagano
Prefecture, Kobe, Fushimi, Nada, Komoro, Matsumoto, Aso, Iwakuni, Maule Valley, Penedès,
Collio, Colli Orientali del Friuli, Strathspey, Robertson, Bannockburn, Locorotondo,
Barossa Valley, Colchagua Valley, Sonoma County, McLaren Vale, Margaret River, Hunter
Valley, Clare Valley, Coonawarra, Adelaide Hills, Yarra Valley, Paso Robles, Carneros,
Central Coast.

Each coordinate must carry a source. **Do not estimate lat/lng from memory** — per the
project's no-inferred-data rule, a guessed coordinate is exactly the kind of unsourced
per-item claim that rule forbids.

Expected effect: 60.5% → ~72% resolution.

### A5. Build-time gap report

The generator prints unresolved subregion/appellation values ranked by row count, so the
tail is a visible ordered chore rather than silent loss. Required by Rule 2 — a
non-success state affecting hundreds of rows must not scroll past unexamined.

### A6. Un-suppress `appellation` on the product page

`app/product/[sku]/page.tsx:447-448` suppresses `appellation` on a **stale assumption**:
the comment reads "verified 0/11,436" but the column now holds **899 rows in the export**
(956 in the DB). The data arrived after the decision to ignore it and nothing was
revisited — a Rule 3 case (inherited constants are not validated by the caller). Note
`wine_classification`, listed in the same comment, is genuinely still 0 — leave it
suppressed.

Same stale assumption exists in `lib/finder/shop-links.ts:18` ("appellation has 0% data →
it is NEVER linked") with a test asserting it at
`lib/finder/__tests__/shop-links.test.ts:22`. Those are **deferred** (§6) — only the
product-page change happens in Phase A.

Note this is an **addition, not merely an un-suppression**: there is no
`AttrRow label="Appellation"` in that block today, so A6 = add the row + correct the
stale comment. Still small, still no new UI design.

### A7. Verification (Rule 7)

Tests:
- unit — rollup arithmetic in `aggregate()`
- invariant — Σ pins == Σ shop grid, per country
- invariant — no row counted twice at the same level
- invariant — every row lands at exactly one pin
- parity — `.mjs` resolver matches the TS resolver

Browser, dev server on :3100 (per project note, not :3212):
- USA → California → Napa Valley
- Italy → Piedmont → Barolo
- Chile → Central Valley → Colchagua
- at 375px and desktop

---

## 5. Phase B — reclassify misfiled `subregion` values

Ships **after** Phase A. Writes to `products.db` → Rule 10 applies in full.

**Ordering is load-bearing.** Phase A pins appellations, so once B moves Barolo into the
`appellation` column the row is still reachable via the map drawer. If B landed first,
2,558 rows would be genuinely unreachable.

### B1. Classification — rule-based, $0

Deterministic rules over the 682 distinct values produce a **proposed-destination CSV for
human review before any write**. No API spend.

| Rule | Destination |
|---|---|
| matches known appellation list or an existing `appellation` value | `appellation` |
| appellation tier (`Bordeaux Supérieur`) | `appellation` |
| legal catch-all (`Vin de France`, `Tre Venezie`) | clear to empty |
| production-method token (Ripasso, Rosso di) | **leave in `subregion`**, flag |
| otherwise | leave in `subregion`, flag for review |

**Only ONE column is written by Phase B: `appellation`.**

**`designation` is not a destination.** It is a closed 22-label vocabulary (constraint 6).
`Bordeaux Supérieur` goes to `appellation`; its *designation* is separately derivable
from the product name by the existing regex. Two different facts, two different columns.

**`production_style` is not a destination either** — it is a closed 7-token JSON-array
viticulture vocabulary (§1 Defect 3). Winemaking-method values such as
`Valpolicella Ripasso` and `Rosso di Montalcino` have **no correct column in the current
schema**. They stay in `subregion` and are reported in the review CSV as a known
open question. Inventing a column for them is out of scope here; forcing them into
`production_style` would repeat the exact error this spec forbids for `designation`.

**`Bourgogne` is deliberately excluded from the rules** — it is both a real place and a
regional appellation tier. Human decision, not a rule.

### B2. Migration (Rule 10)

1. `cp data/db/products.db data/db/products.db.bak-pre-geo-reclass`
2. 5-SKU canary through the real write path (not a dry run)
3. User reviews the proposed-destination CSV and signs off
4. Full migration
5. `scripts/refresh_live_export.py` (Rule 9)
6. **Verify:** count query proving destination columns are populated and `subregion` no
   longer holds non-place values. Counting processed rows is not verification (Rule 1).

### B3. Data cleanups (folded in)

- **Swapped fields** — `region='New Orleans'/subregion='Louisiana'`,
  `region='Brooklyn'/subregion='New York'`, `region='San Francisco Bay Area'`.
- **Junk placeholders** — `region='USA'` (15), `'Other USA'` (12) → empty, so those rows
  count at country level only.
- **Super-zones** — decide deliberately whether Chile's `Central Valley` and Australia's
  `South Eastern Australia` (162 rows in the export / 170 in the DB — a legal bulk-blend
  zone, not a place) are pinnable places or containers only.

---

## 6. Deferred — full appellation surfacing

Not built here; needs its own design.

- Shop facet chip for appellation, beside "Classification"
- `shop-links.ts` permitted to emit `appellation=`, and its stale 0%-data test updated
- Appellation drill-down in `drill-query.ts`

Consequence of deferring: after Phase B a Barolo product's own page shows "Barolo" (A6
un-suppresses it) but there is **no shop chip to filter by it**. Accepted, and narrower
than the map-invisibility risk that ordering A-before-B removes.

---

## 7. Explicit non-goals

- No new column. Phase B writes **only** `appellation`, which already exists.
- No touching `classification` (Rule 12).
- No chasing the full 682-value coordinate tail; the gap report makes it an ordered chore.
- No writes into `designation` (closed 22-label vocabulary).
- No writes into `production_style` (closed 7-token JSON vocabulary).
- No home for winemaking-method values this round — flagged, deferred, left in place.
- No unrelated refactoring of the map renderer.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **Appellation pins have no expressible `/shop` query — constraint 5 cannot validate them** | A3a: add the `appellation` clause to `matchesFilters` (preferred) or ship 3 levels |
| **Subregion pin querying `{region:'Napa Valley'}` returns 1 row vs `ownTotal` 296** | A3 per-level hand-off table; `shopHref` must emit `region=` AND `subregion=` |
| **Invariant fails as designed if `ownTotal`/`inclusiveTotal` are conflated** | A3 defines both; test keys its query off `pinLevel` |
| A1(b): dropping the Napa rewrite loses 1 row from `?region=California` | `regionMatchesFilter` gains ancestor matching — small now, load-bearing after B3 |
| **Appellations have no `parentSlug` (0/81)** | Parent inherited from the product row, not the taxonomy entry |
| **26 cross-level name collisions** (`California`, `Barossa Valley` are both region *and* appellation) | Lookup scoped by source field; cross-level is fallback only |
| `shop-query.test.ts:148-159` asserts the old collapse | Rule 5 rewrite with regression-guard comment — a blocker, not a guard |
| B before A ⇒ ~2,558 rows unreachable | Ordering is mandatory, stated in the plan |
| Pin explosion at 4 levels | Existing MapLibre clustering handles density; verify at 375px |
| Guessed coordinates | Every coordinate carries a source; no estimation |
| `Bourgogne` misrouted by rule | Excluded from rules; human decision |
| Stale 0%-data assumptions elsewhere | A6 fixes the product page; shop-links tracked in §6 |

---

## 9. ADDENDUM (2026-07-27) — full data + structure audit

Added after a request to resolve **all** issues across regions / subregions /
appellations / designation, at both structure and database level. Every figure below is
measured against `products.db` (11,934 rows) and `data/taxonomy/explore-taxonomy.json`.

### 9.1 Field health

| Field | Populated | Distinct | Verdict |
|---|---|---|---|
| `country` | 11,904 (99.7%) | 69 | healthy |
| `region` | 10,532 (88.3%) | 390 | mostly healthy |
| `subregion` | 6,511 (54.6%) | 864 | **grab-bag — root cause** |
| `appellation` | 956 (8.0%) | 52 | under-used, invisible in UI |
| `designation` | 3,015 (25.3%) | 21 | **clean — no data work needed** |
| `wine_classification` | 0 | 0 | dead column |

**`designation` needs no data work.** All 21 values are inside the closed 22-label
vocabulary in `lib/designation.ts`; there is no free text. The only outstanding item is
the UI label rename (§9.6).

### 9.2 `subregion` is four concepts in one column

Where its 864 distinct values actually sit in the taxonomy:

| Classified as | Rows | Share |
|---|---|---|
| not in taxonomy at all | 2,578 | 39.6% |
| appellation *or* subregion (ambiguous) | 1,052 | 16.2% |
| subregion | 1,010 | 15.5% |
| **region** | 893 | 13.7% |
| appellation | 623 | 9.6% |
| appellation *or* region (ambiguous) | 308 | 4.7% |

The column means "geography more specific than region" — not "subregion". This, not the
map code alone, is why the hierarchy collapsed.

### 9.3 Defect inventory (measured, corrected)

| Defect | Rows | Note |
|---|---|---|
| subregion value unknown to taxonomy | **2,578** | Italy 594, Japan 530, France 456, Scotland 175, USA 131 |
| `region` == `country` | 360 | redundant |
| `subregion` == `region` | 165 | redundant |
| non-place values (style / legal tier) | **108** | far smaller than earlier drafts claimed |
| subregion with no region (orphan) | 22 | |
| region with no country | 7 | |
| swapped region/subregion | **1** | earlier drafts materially overstated this |

Two corrections to earlier drafts of this spec: swapped fields and non-place values were
described as significant cleanup. Measured, they are **1 row** and **108 rows**. The real
problem is the taxonomy gap.

### 9.4 The taxonomy file is stale and self-inconsistent

`_meta.generated` = 2026-05-06 against **11,387** products; there are now 11,934.
`_meta.counts.regions` says **126**; the file contains **300**. It has been hand-edited
since generation, so `build_explore_taxonomy.py` would not reproduce it.

It also already contains a `nonGeographicEntries` list naming "Multi-Appellation
California", "Multi-Regional", "Others region", "South Eastern Australia" — this problem
was catalogued in May and never acted on.

Orphaned entries (present in taxonomy, used by zero products): regions 26/300,
subregions 21/81, appellations 36/81.

### 9.5 KEY FINDING — the product rows are right; the taxonomy is wrong

1,205 rows have a `subregion` value the taxonomy classifies as a top-level `region`.
**1,038 of them (86%) are correct as they stand:**

```
region='Central Valley'  subregion='Colchagua Valley'   140 rows   ✓ correct
region='South Australia' subregion='Barossa Valley'     125 rows   ✓ correct
region='California'      subregion='Sonoma County'       71 rows   ✓ correct
```

Colchagua *is* inside Chile's Central Valley; Barossa *is* inside South Australia.
**Migrating these rows would destroy a real hierarchy level and re-create the exact
flattening this project exists to fix.**

**Resolution: fix the TAXONOMY, leave the product rows untouched.** Reclassify the
affected entries from `regions` to `subregions` with a correct `parentSlug`. Zero DB
writes for these 1,038 rows.

**Auto-reclassify — 24 entries / 775 rows.** Single unambiguous parent, ≥5 rows, no
reciprocal conflict:

Colchagua Valley→Central Valley, Barossa Valley→South Australia, Maipo Valley→Central
Valley, Sonoma County→California, McLaren Vale→South Australia, Margaret
River→Western Australia, Yarra Valley→Victoria, Coonawarra→South Australia, Casablanca
Valley→Aconcagua, Cachapoal Valley→Central Valley, Paarl→Western Cape, Adelaide
Hills→South Australia, Åhus→Skåne, Aconcagua Valley→Aconcagua, Paso Robles→California,
Grampians→Victoria, Lodi→California, Clare Valley→South Australia, Eden Valley→South
Australia, Murray Darling→Victoria, Great Southern→Western Australia,
Languedoc→Languedoc-Roussillon, Lowlands→Lowland, Willamette Valley→Oregon.

**Manual review — 58 entries / 263 rows.** Held back because a blanket rule would encode
garbage. Three failure modes found:

- **Reciprocal pairs** (each claims the other as parent — one direction is bad product
  data): `Hokkaido`↔`Yoichi`, `Piedmont`↔`Turin`, `Alto Adige`↔`Trentino-Alto Adige`,
  `Louisiana`↔`New Orleans`, `Jalisco`↔`Tequila`, `Highland`↔`Highlands`
- **Multiple conflicting parents**: `Sauternes` (5 different parents), `Rueda` (5),
  `Rías Baixas` (3)
- **Outright wrong country**: `Cognac→Charente` filed under **China**;
  `London→England` under **Netherlands**; `Denmark→Copenhagen` under **USA**

These are product-data defects surfaced by the audit, not taxonomy defects. They need
per-entry human judgement and are **out of scope for Phase A**.

### 9.6 Authorised work

**Structure (taxonomy file) — no DB risk:**
- S1. Reclassify the 24 auto entries `regions` → `subregions` with correct `parentSlug`
- S2. Expand the taxonomy for Italy / Japan / France / Scotland / Spain (~1,856 of the
  2,578 unknown rows), each entry classified, parented, coordinated, and **sourced**
- S3. Correct `_meta` so it matches the file's actual contents

**Database (`products.db`) — Rule 10 applies: backup → canary → verify → export refresh:**
- D1. Clear `region` where `region == country` (360 rows)
- D2. Clear `subregion` where `subregion == region` (165 rows)
- D3. Non-places (108): `Vin de France` / `Tre Venezie` → clear;
  `Bordeaux Supérieur` → `appellation`; `Valpolicella Ripasso` / `Rosso di Montalcino`
  → flag only (no valid destination — `production_style` is a closed vocabulary)
- D4. Orphans (29): backfill parent from taxonomy where derivable, else clear the child

**Explicitly NOT authorised:**
- Moving the 1,038 correct rows (§9.5) — would destroy hierarchy
- Any write to `designation` (clean) or `production_style` (closed vocabulary)
- The 58 manual-review entries (§9.5) — separate, human-judgement work

**Sequencing:** S1-S3 are read-only and must land **before** Phase A's coordinate work,
because they change what the resolver can resolve. D1-D4 follow Phase A as a separate
reviewed migration.

### 9.7 Deferred — UI label rename

`components/Filters.tsx:947-955` labels the `designation` facet "Classification". User
decision 2026-07-27: rename the visible label to **"Designation"** so UI and code agree.
Three lines. **Not** the Magento `classification` column (different field, 74 scripts,
Rule 12 says stop using it rather than rename it). Update CLAUDE.md Rule 12 and the
memory note in the same commit or the guidance goes stale.

---

## 10. CORRECTION (2026-07-27) — measurements were taken against a STALE taxonomy

Task 3's implementer reported a discrepancy that turned out to invalidate several
figures in this document. Root cause identified and confirmed.

**What happened.** All §1-§9 measurements were taken in the `feat/image-item-url-refresh`
checkout, whose `data/taxonomy/explore-taxonomy.json` has **300 regions**, a `Napa` region,
and `Napa Valley.parentSlug = 'napa'`. That file is **stale**. Commit `be36591`
*"fix(taxonomy): collapse fake 'Napa' region into California; repair 6 failing tests (#92)"*
landed on `main` and corrected it. The version on `main` — which this worktree uses — has
**125 regions**, no `Napa` region, and `Napa Valley.parentSlug = 'california'`.

Someone had already fixed the exact defect §9.5 independently rediscovered.

**Corrected figures (measured on `main`'s taxonomy, 11,934 products):**

| Figure | Stale claim (§2) | Actual on `main` |
|---|---|---|
| taxonomy regions | 300 | **125** |
| subregion rows resolvable | 60.5% | **82.9%** (5,395 / 6,511) |
| unresolved subregion rows | 2,558 | **1,116** |
| `Napa Valley.parentSlug` | `napa` | `california` |
| a `Napa` region exists | yes | **no** |

pinLevel breakdown of the 5,395 resolved: region 2,604 · subregion 2,149 · appellation 642.

The five motivating places all resolve correctly: Sonoma County → **region** (71 rows),
Napa Valley → **subregion** (299), Barolo → **appellation** (99), Colchagua Valley →
**region** (140), Barossa Valley → **region** (125).

**What still holds.** The design is unaffected — every architectural decision survives:

- The `regions`-fallback for a value in the `subregion` field is still load-bearing
  (Sonoma County / Colchagua / Barossa are still region-classified).
- Parent-from-the-row is still correct. The justification is the **0/81 appellation
  `parentSlug` gap** plus cross-level name collisions — NOT the Napa example, which is
  no longer valid on `main`.
- §9.5's core finding stands: the product rows are right and the taxonomy was wrong.
  `be36591` already fixed one instance of it.

**What this changes for the remaining work.** The §9.6 taxonomy expansion (S2) is
**smaller than scoped** — 1,116 unresolved rows, not 2,578. Re-measure per country before
authoring entries. The 24-entry auto-reclassify list in §9.5 must also be re-derived
against `main`'s taxonomy; some entries may already be fixed by `be36591`.

**Process lesson.** Analysis was run in a different checkout from the one the work
executes in. Measure in the worktree, or confirm the analysed file matches what the
branch actually contains.

---

## 11. Task 5 findings — a real double-count, and corrected expectations

### 11.1 The `region == subregion` self-parent double-count (FIXED)

Real-data verification during Task 5 caught a bug **no unit test with clean fixtures
would find**. When a row carries the same value in both `region` and `subregion`
(e.g. `region='Beaujolais', subregion='Beaujolais'`), the resolver pins at subregion
level and takes `parentName` from the row's region field — so the node became **its own
parent**. The subtree fold then added the node into itself, silently turning 52 into 104.

No crash. No dangling key. Just a wrong number — precisely the failure mode §9 warned
this task was most exposed to.

**Scope is wider than the one case found:** **165 rows** have `region == subregion` —
Speyside 55, Islay 31, Cognac 27, Beaujolais 14, Campbeltown 5, Ribera del Duero 5,
Schiedam 4, Yamazaki 4, and others. Every one would have double-counted.

Fixed at insert time (`gen-explore-map-data.mjs:180`) plus a belt-and-braces check in the
fold (`:228`). Verified: 0 cycles of any length, 0 dangling parents, 0 subtree mismatches.

**Note this is the same 165 rows §9.3 listed as merely "redundant".** They are not
cosmetic — they cause a counting bug. D2 (clear `subregion` where it equals `region`)
is therefore more valuable than the audit implied.

### 11.2 Corrected expectations — the plan's estimates were wrong, the code is right

Two figures in the Task 5 brief did not match reality. Both were investigated rather than
assumed, and the implementation is correct in both cases:

**California `ownTotal` = 191, not ~134.** It is 134 blank-subregion rows **plus 57 rows
whose subregion has no taxonomy entry** (Carneros 15, Alameda County 8, Livermore Valley 6,
SF Bay Area 5, Adelaida District 5, …), which correctly fall back to California rather
than being dropped. 134 + 57 = 191.

**California `inclusiveTotal` = 534, not ~605.** Sonoma County (71), Paso Robles (8) and
Lodi (7) pin at **region** level, so they are *siblings* of California, not children —
the deliberate behaviour §A2's regions-fallback exists to produce. 534 + 71 + 8 + 7 = 620,
which reconciles with the 619 `region='California'` rows plus one cross-region Napa row.

**Implication for §A3's invariant table:** a region-level pin's `/shop` hand-off must be
checked against the total that its query actually reproduces. Because region-classified
values in the subregion field become siblings rather than children, `inclusiveTotal` for a
parent region does NOT equal the `?region=<parent>` grid. Task 8 must verify this
empirically per level rather than assuming the §A3 table.

### 11.3 `unresolved` semantics

The counter records **geography values with no taxonomy entry**, independent of whether
the row itself resolved (a row can fall back to its region and still contribute its
unknown subregion to the gap report). It is a **taxonomy-gap report, never a lost-row
count**. A consumer reading it as "rows that failed" would be wrong.

870 distinct values. Top entries include country/city names sitting in the region field —
Scotland 67, London 49, England 43, Tequila 43 — which are data-quality defects (§9.3),
not missing taxonomy entries.

### 11.4 Row accounting

Σ `ownTotal` = 10,776 against 10,778 eligible rows. The delta is exactly **2 rows that
have no country, region OR subregion** — nowhere to pin them. No row lost, none
double-counted.
