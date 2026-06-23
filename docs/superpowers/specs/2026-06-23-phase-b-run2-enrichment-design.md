# Phase B Run 2 — Paid LLM Taste-Field Enrichment (Design Spec)

**Date:** 2026-06-23
**Status:** Design — pending spec review + user approval, then writing-plans
**Author:** session continuation (universal-attribute enrichment effort)
**Predecessor:** Phase B Run 1 — variety+body for non-wine drinkables, SHIPPED (PR #37, `6383610`;
reuse-safety fix `a5046ab` on branch `fix/phase-b-reuse-safety`).
**Work branch:** `feat/phase-b-run2` (worktree `.worktrees/phase-b-run2`, based on `a5046ab`).
See memory `project_phase_a_enrichment_promotion`, `project_universal_attributes_enrichment`,
`project_is_in_stock_string_gotcha`, `feedback_catalog_worktree_isolation`.

---

## 1. Problem & Goal

Phase A (free deterministic) and Phase B Run 1 (paid, non-wine variety+body) left the
finder-scoring / shop-filterable taste columns partially filled. Run 2 fills the remaining
gaps in **`variety`, `body`, `acidity`, `tannin`** (finder/shop) plus **`sweetness`** (product-
page display) for **in-stock drinkable** products, completing the wine fields Run 1 deliberately
excluded and widening non-wine coverage. **Each field is requested only for categories where it
is a meaningful sommelier axis** (§4.3 applicability) — body/acidity/tannin are wine-shaped axes
and are NOT forced onto clear spirits.

**Sommelier review (2026-06-23) reshaped the field/category matrix** — see §4.3. Headlines:
body is gated (not requested for clear spirits/whisky where wine-body is noise); acidity is
dropped for sake (sake is expressed by sweetness/dryness — SMV / 日本酒度 nihonshu-do — not
Low/Med/High acidity, and the finder already reads sake sweetness from `taste_profile`);
sweetness is ADDED for dessert/fortified wine + sweet liqueur (display-only, see below).

**A small catalog code change ships with this run (sweetness display).** Verified: flat
`sweetness` is read by NO consumer today — `lib/taste-adapter.ts:112 toStructural()` emits only
body/acidity/tannin, so enriching sweetness without the fix would be a dead column (Rule 1).
Run 2 adds ~4 lines to `toStructural()` to emit `sweetness` on the product-page
`StructuralGauges` (scale `[Dry, Off-Dry, Medium-Sweet, Sweet]`), making sweetness a real
visible win on Port/Sauternes/Moscato/sweet-liqueur pages. This is a UI change → **Rule 7
browser verification required** (§7).

**The "deep-dive expert browse" UX is OUT of scope — its own project.** The user's idea to let
users browse/filter/learn the expert detail (sake SMV, whisky peat/region, wine tannin) is a
real credibility moat, but it is a separate brainstorm→spec sequenced AFTER Run 2 ships the
data. See memory `project_taste_deepdive_browse`. Run 2 is the data foundation it needs.

This is **paid work** → governed in full by CLAUDE.md **Rule 10** (canary → estimate →
sign-off → run → verify-shipped) and **Rule 4** (cost report must include a "what shipped to
users" line). No spend occurs during planning or build — only after the canary + your sign-off.

### Honest value framing (do NOT overstate — Rule 1 / Rule 4)

Verified against finder + shop code on 2026-06-23:

- **Finder** (`apps/catalog/lib/finder/scoring.ts`) scores on exactly four product attribute
  fields: `variety` (wine grapes only, `GRAPE_FAMILY`), `body` (wine body ladder), `acidity`,
  `tannin` (acidity/tannin ladder). The non-wine finder flows (whisky/spirits/sake) score on
  **origin/style axes (`axis1`/`axis2`)**, NOT on these universal fields.
- **Shop** (`apps/catalog/lib/shop-query.ts` + `Filters.tsx`) filters on `body`, `acidity`,
  `tannin`, `variety` for **all** products — the "Taste & more" filter chips are shown
  regardless of category (fixed scales in `app/shop/page.tsx`), so filling these fields IS
  user-visible for non-wine via the shop filter.

**Therefore Run 2 delivers:** (a) **wine finder sharpening** (the four fields all score for
wine), and (b) **shop-filter breadth across all drinkables**. It does **NOT** sharpen the
non-wine *finder* — that needs a separate scoring-code change (see §11 follow-up). The spec,
plan, and final cost report must use this framing, not "whole-finder sharpening."

---

## 2. Scope (the binding selection)

**Rows:** `is_in_stock == "1"` AND group ∈ {Wine, Spirits, Whisky, Sake & Asian, Liqueur}
AND **missing at least one APPLICABLE field** — i.e. a field that both (a) `applies` to the
row's group/sub-type per the §4.0 matrix AND (b) is currently empty. **No buying-signal gate**
(unlike Run 1) — the shop filter surfaces all in-stock products, so all are worth filling.

**Sweetness IS an independent selection trigger (resolved):** a dessert wine or sweet liqueur
that is already fully filled on variety/body/acidity/tannin but missing `sweetness` IS selected
(for its sweetness gap alone). Verified: ride-along-only would MISS 72 of 241 sweetness
candidates — exactly the well-enriched dessert wines/liqueurs that most deserve the gauge. So
the selection predicate is "missing any APPLICABLE field including sweetness," not "missing any
of the four finder fields." (The ~1,622 count already includes these sweetness-only rows.)

**Raw in-stock-drinkable gap (2026-06-23): 1,972 rows** missing any of variety/body/acidity/
tannin. After the §4.0 **applicability gating** (a field is requested only where it is a
meaningful axis AND empty), the operative surface is smaller:

**APPLICABILITY-GATED selection (EXACT, type-based gating, root canonical DB, 2026-06-23):**
- **Rows we actually call (≥1 applicable+empty field): 1,606.** (The ~366-row drop from 1,972
  is rows whose only gaps were non-applicable — e.g. a spirit missing only acidity/tannin/body,
  none of which we request for clear spirits.)
- **Per-field request counts (applicable + empty only):** variety **886**, body **949**,
  acidity **710**, tannin **324**, sweetness **216**. (Computed with the clean SKU-taxonomy
  wine sub-types — `Red Wine`/`Orange Wine` → tannin; `Sweet/Dessert`/`Fortified` → sweetness —
  NOT a name-regex. See §4.3/§4.4.)

Raw per-category missingness (pre-gating, for context — NOT the request counts):

| group | rows | miss variety | miss body | miss acidity | miss tannin |
|---|---|---|---|---|---|
| Wine | 655 | 72 | 564 | 566 | 611 |
| Spirits | 455 | 238 | 220 | 404 | 404 |
| Sake & Asian | 381 | 349 | 328 | 329 | 330 |
| Whisky | 317 | 158 | 189 | 289 | 289 |
| Liqueur | 164 | 69 | 57 | 144 | 144 |
| **Total** | **1,972** | | | | |

These counts are exact (type-based, not regex). The binding cost number still comes from the
canary regardless (§6).

**Stock semantics (memory `project_is_in_stock_string_gotcha`):** `is_in_stock` is the STRING
`"0"`/`"1"`/null — truthiness is backwards. Use the Run-1 `_instock()` helper (only
`"1"`/`"True"`/`"true"` = in stock).

**Category derivation (Rule 12):** group comes from `sku_taxonomy.resolve(row)["group"]`,
NEVER from `classification`. `schema_for_group()` is GROUP-keyed (group and type DIVERGE for
non-wine; Run 1's Task-1 fix). Pre-flight: assert `resolve()` returns a group in the drinkable
set for every selected row before spending (0 unresolved verified 2026-06-23).

**Beer & RTD excluded** (in Run 1's NONWINE but dropped here): only ~4% have body/variety and
acidity/tannin are not meaningful axes for beer/seltzer — defer to avoid low-signal spend.

---

## 3. The canonical DB lives at the ROOT, not the worktree (Rule 1 / Rule 9 trap)

The 88 MB canonical `data/db/products.db` is a data artifact, **not** committed to git; git
tracks a 0-byte placeholder. In this worktree `data/db/products.db` is **empty**. The
enrichment + merge + refresh MUST target the root DB by **absolute path**:

```
/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db
```

Always pass `--db <absolute root path>`. This mirrors the Phase A trap
(`project_phase_a_enrichment_promotion`: "DEFAULT_DB points at a STALE worktree DB"). The
plan's pre-flight asserts the target DB is non-empty (`SELECT COUNT(*) FROM products > 0`)
before any spend.

**Shared-checkout hazard (memory `feedback_catalog_worktree_isolation`):** the root checkout
is being branch-flipped by a parallel process this session. All Run 2 work stays in this
worktree; verify `git branch --show-current == feat/phase-b-run2` before every commit.

---

## 4. Fields, scales, validation & category-aware applicability

### 4.0 The field × category applicability matrix (sommelier-reviewed — THE governing table)

A field is sent to the model, validated, and written **only** where it is a meaningful axis.
`schema_for_group()` (extended) returns the `applies` set per group; tannin & sweetness are
further refined by wine sub-type. A non-applicable field is never requested → never fabricated.

Gating keys on the SKU-taxonomy `type` (`resolve(row)["type"]`, Rule-12-clean), NOT name-regex:

| wine type / group | variety | body | acidity | tannin | sweetness |
|---|---|---|---|---|---|
| type `Red Wine` / `Orange Wine` | ✓ grape | ✓ | ✓ | ✓ | ✗ |
| type `White Wine` / `Sparkling & Champagne` / `Rosé Wine` | ✓ grape | ✓ | ✓ | ✗ | ✗ |
| type `Sweet/Dessert` / `Fortified` | ✓ grape | ✓ | ✓ | red→✓ | **✓ display** |
| Spirits (clear: vodka/gin/tequila/rum) | ✓ base | ✗ | ✗ | ✗ | ✗ |
| Whisky | ✓ style | ✗ | ✗ | ✗ | ✗ |
| Sake & Asian | ✓ class | ✓ | ✗ (use existing sweetness) | ✗ | ✗ |
| Liqueur | ✓ family | cream/fortified→✓ | fruit/citrus→✓ | ✗ | sweet→**✓ display** |

Rationale (sommelier): body/acidity/tannin are wine mouthfeel/structure axes; on a 40–60% ABV
clear spirit "body" is alcohol weight, not a comparable signal — so it is not requested.
Sake acidity (酸度 sando) is real but sake is consumer-expressed via sweetness/dryness (SMV);
the finder already reads sake sweetness from `taste_profile`, so flat acidity adds low-confidence
noise → dropped. Sweetness is requested only where it is high-confidence-from-name and visible.

### 4.1 `body` — 4-step scale (Wine, Sake, cream/fortified Liqueur ONLY)
```
["Light", "Medium", "Medium-Full", "Full"]      ← Medium-Light NOT used
```
Strict subset of the finder's 5-step ladder → finder ranks AND shop buckets correctly, no silent
collapse. Reuse Run-1 `validate_body`. **NOT requested for Spirits/Whisky** (§4.0).

### 4.2 `variety` — per-category controlled vocabulary
Non-wine vocab unchanged from Run 1 §4.2 (Whisky style class; Spirits base material; Sake
class; Liqueur family). **Wine grape vocab (NEW):** built from the finder's `GRAPE_FAMILY`
substring tokens (verified 2026-06-23: cabernet, pinot noir, syrah/shiraz, sangiovese,
tempranillo/rioja, merlot, grenache/garnacha, chardonnay, sauvignon blanc, riesling, pinot
grigio/gris, viognier, semillon, glera/prosecco, meunier) so a written value **scores** in
`grapeScore` (substring match).

**Blends (user decision):** the allowlist includes explicit **blend tokens** (e.g. "Bordeaux
Blend", "GSM", "Rhône Blend", "Field Blend") for product-page display. Because `grapeScore`
matches by substring, a blend value that **leads with the dominant grape** still scores
(e.g. "Cabernet Sauvignon Blend" → matches `cabernet`); the prompt instructs: for a blend,
return the dominant grape first, optionally with "Blend". Unknown/obscure grape → null (Rule 5).
The plan freezes the full wine allowlist as a committed artifact and the canary eyeballs that
produced wine varieties land on a recognized grape token.

### 4.3 `sweetness` — display-only, 4-step GAUGE scale (NEW for Run 2)
Requested for **wine `type ∈ {'Sweet/Dessert', 'Fortified'}`** (clean SKU-taxonomy types — 53+32
rows; no name-regex needed) **and sweet Liqueurs** (liqueur uses family/name since liqueur has no
sweet/dry sub-type). Categories where sweetness is high-confidence from the name and is the
defining axis. Write on the **product-page gauge scale** (verified in `StructuralGauges.tsx:21`):
```
["Dry", "Off-Dry", "Medium-Sweet", "Sweet"]
```
**Do NOT use the sake `SWEETNESS_LADDER`** (`["very dry","dry","off-dry","sweet"]`, `scoring.ts:29`)
— it differs, and an off-scale value makes the gauge render ALL-EMPTY silently (the Rule-2
contract comment in `StructuralGauges.tsx:7-11`). `validate_sweetness` accepts ONLY the 4-step
gauge scale → else null. **Consumer:** product-page `StructuralGauges` ONLY (NOT finder, NOT
shop) — and only after the §4.5 `toStructural` change. Honest framing: display win, not a
finder/shop win.

### 4.4 `acidity` / `tannin` — 4-step scale, gated by the §4.0 matrix
Scale: `["Low", "Medium", "Medium-High", "High"]` (matches `ACIDITY_SCALE`/`TANNIN_SCALE` in
`app/shop/page.tsx`). Requested per the §4.0 matrix: acidity for Wine + (fruit/citrus) Liqueur
(NOT Spirits/Whisky/Sake); tannin for **red/structured Wine only**. The validator drops any
value outside the 4-step scale → null.

**Tannin red/white determination — RESOLVED cleanly via SKU taxonomy (no name-regex needed):**
Verified 2026-06-23 — `sku_taxonomy.resolve(row)["type"]` returns clean wine sub-types:
`Red Wine` (4,185), `White Wine` (1,614), `Sparkling & Champagne` (896), `Rosé Wine` (182),
`Sweet/Dessert` (53), `Fortified` (32), `Orange Wine` (13), `Wine Set` (8). So tannin is
requested **iff `type ∈ {'Red Wine', 'Orange Wine'}`** (orange wines are skin-contact → tannic).
White/Sparkling/Rosé/Wine-Set → tannin NOT requested. **No name-regex fallback is required** —
the type is authoritative and Rule-12-clean. (This supersedes the earlier regex approach; the
~16-row residual ambiguity, e.g. a mistyped SKU, defaults to NO tannin = safe.) A fabricated
tannin on a white is a Rule-1 failure; the type gate prevents it by construction.

### 4.5 New code — extend `data/lib/taste_taxonomy/universal_scales.py`
Extend (do NOT rewrite) `schema_for_group()` to return, per group: `variety_vocab`,
`body_scale` (existing), plus **`acidity_scale`**, **`tannin_scale`**, **`sweetness_scale`**
(the §4.3 gauge scale), and an **`applies`** set naming which of {variety, body, acidity, tannin,
sweetness} to request for that group/sub-type (the §4.0 matrix). Add `validate_acidity` /
`validate_tannin` (4-step `[Low,Medium,Medium-High,High]`) and `validate_sweetness` (4-step
`[Dry,Off-Dry,Medium-Sweet,Sweet]`), all drop-else-null, mirroring `validate_body`. Add the
wine grape `variety_vocab` (§4.2, frozen artifact). The Rule-12-violating
`schema_for_classification` (if present) stays untouched and unused.

### 4.6 New code — emit `sweetness` on the product-page gauge (`lib/taste-adapter.ts`)
`toStructural()` (line 112) currently emits only body/acidity/tannin. Without a consumer,
enriched sweetness renders nowhere = dead column (Rule 1). This is the ONLY catalog code change
in Run 2 → **Rule 7 browser verification** (§7).

**The fix is NOT just "read product.sweetness" — `normalizeScale` is hard-gated and MUST be
extended first (verified 2026-06-23):**
- `normalizeScale` (line 80) early-returns `null` for any axis not in its `SCALE` map
  (`if (!(a in SCALE)) return null`, line 83). `type Axis = 'body' | 'acidity' | 'tannin'`
  (line 40) and the `SCALE` (line 67) / `REMAP` (line 45) objects have **no `sweetness` key**.
  So `normalizeScale('sweetness', …)` returns null for EVERY value today — calling it without
  the extension produces a silent dead column.

**Required changes (definite, in order):**
1. Extend `type Axis` to include `'sweetness'`.
2. Add a `sweetness` entry to `SCALE`: `{'Dry','Off-Dry','Medium-Sweet','Sweet'}` (the gauge
   scale — matches `SCALE_DEFINITIONS.sweetness` in `StructuralGauges.tsx:21`, so the COMPONENT
   needs no change).
3. Add a `sweetness` entry to `REMAP` (may be empty `{}` if no aliases needed).
4. In `toStructural()`, add `const sweetness = normalizeScale('sweetness', product.sweetness);
   if (sweetness) out.sweetness = sweetness;` and fix the stale "no flat source" comment.

`PublicProduct.sweetness?: string` already exists (`types.ts:58`) — no type plumbing needed.
The §8 unit test (toStructural emits sweetness) + §7 step 9 browser check guard against the
dead-column failure.

---

## 5. Architecture & data flow (reuses Run-1 skeleton — Rule 11)

```
select ~1,622 rows (§2) from ROOT products.db   (absolute --db path, §3)
   │ per row: group/type = sku_taxonomy.resolve(row)         ← NOT classification (Rule 12)
   │ schema_for_group → which of {variety,body,acidity,tannin,sweetness} APPLY (§4.0 matrix) AND empty
   │ context: name (+ existing flavor_tags)
   ▼
scripts/enrich_phase_b.py  (EXTENDED — but PARAMETERIZE the field set FIRST, see §9)
   │                         add Wine to selection, drive 5 fields off a FIELDS config
   • Haiku 4.5, constrained JSON out → only the requested (applicable) fields
   • validate: variety∈vocab else null; body/acidity/tannin/sweetness∈their 4-step scale else null
   ▼ writes ONLY to (no DB write in this script):
enrichment_cache (Supabase) + local sidecar    sku → {fields, source, model, ts}
   │   source tag: "phase_b_run2_haiku_taste"
   ▼
scripts/merge_phase_b_cache.py  (EXTENDED for the 5 fields; NULL-only, backs up DB first)
   • UPDATE products SET col=? WHERE sku=? AND (col IS NULL OR col='')   ← never clobbers (Rule 5)
   ▼  refresh_live_export.py  ─►  live_products_export.json   (all 5 cols ∈ EXPORT_COLS ✓ verified)
   │  + ONE catalog code change: lib/taste-adapter.ts toStructural() emits sweetness (§4.6)
   ▼
VERIFY-SHIPPED (Rule 1): for the EXACT merged-SKU set, confirm fields populated in the JSON;
   spot-check a previously-empty whisky now shows body in the shop "Taste & more" filter,
   a previously-empty red wine ranks on tannin in the wine finder deep-dive,
   AND a Port/Sauternes product page now shows a Sweetness gauge (Rule 7 browser check, §7).
```

**Two non-negotiable safety controls (carried from Run-1 review):**
1. **Enrichment script makes ZERO DB writes** — paid output lands in the cache first. A bad
   merge never loses paid data and never re-pays (the $56 May-2026 lesson).
2. **`--dry-run` means NO API call** (free preview of prompt + selected rows). The forbidden
   pattern is the original phase_d1 dry-run that still spends. Run 1 already fixed this; Run 2
   inherits the fixed behavior — re-verify it in the canary.

**Do NOT reuse any unconditional-UPDATE write path** (`phase_d1` ~223-235;
`backfill_from_cache.py` ~143-148). The merge is NULL-only via `merge_phase_b_cache.py` only.

---

## 6. Cost (Rule 10 / Rule 4)

**Pre-canary envelope** (~1,622 applicability-gated rows, Haiku 4.5 @ $0.80/$4.00 per Mtok,
~900-tok system prompt cached after first call, Run-1 measured ~$0.00024/row; Run-2 prompt
slightly larger — more fields/scales):

| Scenario | Estimate |
|---|---|
| Haiku, prompt-cached (expected) | **~$0.40** |
| High (1.5× buffer, retries/verbose) | ~$0.60 |
| Canary (5 SKUs) | <$0.01 |

**This is a PRE-CANARY estimate. The BINDING number comes from the 5-SKU canary's measured
per-SKU token rate, shown to the user for sign-off BEFORE the full run.** Canary also decides
model (Haiku vs Sonnet escalation if accuracy is poor on hard rows).

**Cost report at end (Rule 4) must include:** total spend, # API calls, **# rows where each of
variety/body/acidity/tannin/sweetness is populated IN `live_products_export.json`** (not the
cache, not the DB gross count), and per-successful-row cost.

---

## 7. Rule-10 execution gate (the run procedure)

1. Pre-flight: assert root DB non-empty; assert all selected rows resolve to a drinkable group;
   back up the root DB (`cp products.db products.db.bak-pre-run2`).
2. **Canary:** `--limit 5 --dry-run` (FREE — show prompt + rows, zero API calls), then
   `--limit 5` (paid, <$0.01, cache only). Use a MIXED canary set: ≥1 red wine, 1 white/sparkling,
   1 dessert/fortified wine, 1 spirit, 1 sake. Eyeball: variety in-vocab + on a recognized grape
   token for wine; body/acidity/tannin/sweetness on their correct 4-step scales; **tannin only on
   the red; body absent for the spirit; acidity absent for the sake; sweetness on the dessert wine.**
3. Confirm success/skip ratio matches expectation.
4. **Estimate** full-run cost from the canary's measured per-SKU rate; show the user the number.
5. **Get user sign-off on the number.** ← no full-run spend before this.
6. Full run → cache.
7. Merge cache → ROOT DB (NULL-only) → `refresh_live_export.py`. Ship the §4.6 `toStructural`
   code change with the merge (so sweetness has a consumer before it lands).
8. **Verify-shipped (Rule 1):** for the EXACT merged-SKU set, confirm each field populated in
   `live_products_export.json` (compare the merged-SKU set, NOT gross column totals — pre-existing
   values inflate the gross and read as false mismatch). Spot-check finder + shop.
9. **Rule 7 (UI):** start the catalog dev server (port :3100 — memory `project_catalog_dev_port`),
   open a Port/Sauternes product page, confirm the **Sweetness gauge renders populated** (not
   all-empty — the scale-mismatch failure mode), and the page doesn't crash. A working gauge is
   the only proof the §4.6 change works.

---

## 8. Testing

- Unit: extended `schema_for_group` returns correct fields/scales/`applies` per group + wine
  sub-type (Rule-12 clean — never reads `classification`); `validate_acidity`/`validate_tannin`
  accept ONLY `[Low,Medium,Medium-High,High]`; `validate_sweetness` accepts ONLY the GAUGE scale
  `[Dry,Off-Dry,Medium-Sweet,Sweet]` and **rejects the sake ladder values** (`very dry`/`sweet`
  lowercase) — the silent-empty-gauge trap; **body NOT in `applies` for Spirits/Whisky**;
  **acidity NOT in `applies` for Sake** (the §4.0 guards).
- Unit (type-gate, §4.3/§4.4): `applies` includes tannin for `type='Red Wine'`/`'Orange Wine'`
  and EXCLUDES it for `'White Wine'`/`'Sparkling & Champagne'`/`'Rosé Wine'`; includes sweetness
  for `'Sweet/Dessert'`/`'Fortified'` and excludes it for dry wine types — keyed on the literal
  type strings `resolve()` returns (pin them so a taxonomy rename can't silently break the gate).
- Unit (NULL-only merge, Rule-5 guard): a row with `acidity='High'` is NOT overwritten; a NULL
  `tannin` on a red wine IS filled; a NULL `sweetness` on a Port IS filled.
- Unit (§4.6): `toStructural()` emits `sweetness` when the flat column has a gauge-scale value,
  and omits it when null/off-scale (no all-empty gauge).
- Integration (Rule 6 invariant): for a cached row X with fields, after merge the products
  table AND the export JSON have the corresponding columns populated for X.
- Canary acceptance: the mixed 5-SKU set (§7 step 2) produces in-vocab variety + correct-scale
  values with the applicability guards visibly honored, plausible on eyeball.

---

## 9. Reused vs net-new (Rule 11)

**Reused:** `enrich_phase_b.py` harness MECHANICS (`--limit`/`--dry-run` canary, Haiku client,
cost constants, `ThreadPoolExecutor`, `--skip-done` resume, factual-discipline system prompt,
`_instock`/`_empty`/`group_for` helpers); `merge_phase_b_cache.py` NULL-only merge pattern;
`refresh_live_export.py`; the Run-1 test patterns.

**⚠️ PARAMETERIZE FIRST (Rule 11 — memory `project_phase_a_enrichment_promotion` reuse note,
verified 2026-06-23):** the Run-1 script HARDCODES `variety`/`body` at ~8 sites — the SELECT
(line 94), empty-check (109), prompt JSON shape (121-122), parse/validate (185-186), result
dict (191), and counters (300, 317-320) — and `validate_body` is a fixed-scale function that
won't generalize. Copy-pasting 5 fields × ~8 sites would be a duplicated, applicability-tangled
mess. **Task 0: refactor to drive everything off a single `FIELDS` config** (per-field: name,
scale, validator, `applies(group,type)` predicate) that the SELECT, prompt builder, validator,
result dict, counters, and merge all iterate over. The 5-field per-applicability behavior then
falls out cleanly. Do this BEFORE adding the new fields.

**Net-new (in order):**
0. **Parameterize the field set** (above) — the enabling refactor; no behavior change vs Run 1
   when run with just variety/body (a regression test pins this).
1. Add Wine to the selection set + a frozen wine grape+blend `variety_vocab` (§4.2).
2. Extend `schema_for_group` with acidity/tannin/sweetness scales + the §4.0 `applies` matrix
   (keyed on group AND wine `type` for tannin/sweetness) (§4.5).
3. `validate_acidity` / `validate_tannin` / `validate_sweetness` (§4.5).
4. Prompt requests ONLY applicable fields per the matrix + parses them (§4.0/§5).
5. Merge all five fields NULL-only (§4.5 merge).
6. **`toStructural()` + `normalizeScale` emit sweetness** (§4.6) — the one catalog code change; Rule-7.
7. The §8 tests (incl. the Task-0 no-regression test).

---

## 10. Explicitly OUT of scope (Run 2)

- `finish`, `intensity`, `color`, `smokiness`, `blend_type`, `production_style` — NO code reads
  them; display-only and deferred (would be dead-column spend without UI work). NOTE: `sweetness`
  was in this bucket but is now IN scope because Run 2 ships the §4.6 `toStructural` consumer for it.
- `body`/`acidity`/`tannin` for clear spirits & whisky — not meaningful axes there (§4.0); not requested.
- `acidity` for sake — sake uses sweetness/dryness (SMV), not Low/Med/High acidity (§4.0).
- Out-of-stock rows — not surfaced in finder/shop; defer until restocked.
- Beer & RTD — low signal for these axes (§2).
- The **deep-dive expert-browse UX** (sake SMV explainer, whisky peat/region, wine tannin
  browsing + learn cards) — its own brainstorm→spec→plan AFTER Run 2 ships the data. See memory
  `project_taste_deepdive_browse`. Run 2 is the data foundation; do NOT bundle the UX here.
- Teaching the non-wine FINDER to score on body/acidity/tannin — a scoring-code change, not a
  data run (§11). Run 2 is data-only apart from the single §4.6 display fix.

---

## 11. Open follow-ups

- **Non-wine finder scoring:** `scoring.ts` ranks whisky/spirits/sake on `axis1`/`axis2`, not on
  the universal fields. A future code change could make the non-wine finder score on `body`
  (and a non-wine-aware variety match) so Run-2's non-wine data sharpens the finder, not only
  the shop. Track separately; do not bundle into Run 2.
- Reconcile with the parked `project_finder_data_enhancements` plan rather than duplicating.
- `apps/catalog/lib/taste-adapter.ts` stale sweetness comment (noted in Run-1 spec §11).
