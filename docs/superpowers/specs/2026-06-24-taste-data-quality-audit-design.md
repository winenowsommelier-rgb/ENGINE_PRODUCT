# Taste-Data Quality Audit — Design Spec

**Date:** 2026-06-24
**Status:** Design approved; re-baselined against post-#49/#51 `main`
**Relation to Phase B Run 2:** Run 2 has SHIPPED (PR #49) — see §0.
**Parked display design:** branch `docs/phase-b-run2-spec`, `docs/superpowers/specs/2026-06-23-phase-b-run2-taste-display-design.md`

---

## 0. Cross-session reconciliation (2026-06-24)

While this audit spec was being written, two parallel sessions merged to `main`:

- **PR #49 — Phase B Run 2 SHIPPED** ($0.64, ~2,564 rows). It did NOT just
  display taste; it ran a category-gated paid enrichment: type-based gating via
  `resolve()` sub-types (tannin = type∈{Red,Orange}; sweetness =
  type∈{Sweet/Dessert,Fortified} + White/Sparkling), a frozen grape vocab, and a
  catalog **display sweetness gauge** (`taste-adapter.ts`, `normalizeScale`).
  Verified-shipped with a Rule-1 merged-SKU export assertion.
- **PR #51 — lowercase sweetness normalized** (194 `dry`→`Dry`, 85 `sweet`→
  `Sweet`), export refreshed, build-failing invariant test added.

**Why this audit is STILL needed (what #49/#51 did NOT do):** they *added/gated/
normalized* values; they did **not audit pre-existing legacy values for
correctness**. Verified live in the committed export (`live_products_export.json`,
the user-facing source per Rule 9) on 2026-06-24:
- **Sparkling "Extra Dry" → `Dry` inversion: 56 rows still wrong, live to users.**
- **`body` lowercase case-dupes: `light`×6 still present** (#51 only fixed
  *sweetness*, not body).
- smokiness untouched by #49 → the **peated false-negatives** (`none` on
  Talisker/Ledaig) and `heavy` false-positives are still unaudited.
- Non-beverage taste leaks (grape blends on ~22 Accessories/Events) unaddressed.

So the audit's scope **drops** the #51-resolved lowercase-*sweetness* item and
**reframes** from "unblock a paused Run 2" to a **post-Run-2 legacy-correctness
audit** of the four columns as they ship today.

## 1. Problem

The four taste columns — `smokiness`, `sweetness`, `body`, `variety` — carry
legacy values from many enrichment passes (the row-level `enrichment_source`
column shows ~14 distinct values; it is *last-touch*, not per-column provenance).
Run 2 (#49) gated and topped them up but did not vet the legacy values for
correctness. Three earlier spec-review iterations each surfaced a new data bug;
the pattern is the finding: **patching the display layer keeps surfacing wrong
facts on premium pages.** So we audit the DATA, then correct.

The bad values were NOT written by Phase A's free rules (only a handful of rows
carry `enrichment_source = rules`), so re-running the rules backfill corrects
nothing. The fix must be **source-agnostic** and keyed on the *value + category*,
not on the source tag.

## 2. Goal & non-goals

**Goal:** produce, per taste column, a measured error rate and one decision —
**trust / correct / re-enrich** — backed by a per-SKU findings file that a future
correction script can consume as a blocklist.

**Non-goals (explicitly out of scope this session):**
- No writes to `products.db` or `data/live_products_export.json`. The audit is
  read-only (it reads the DB and, in the judge stage, calls Haiku).
- No correction script. No re-enrichment. Those are separate, later efforts,
  each Rule-10 / plan-gated.
- No display work. The parked v3 display design stays parked.

## 3. Ground truth (verified against the committed export + DB, 2026-06-24, post-#49/#51)

> Verified against `data/live_products_export.json` (the user-facing source — the
> UI reads the export, not the DB, per Rule 9) AND the canonical DB
> `data/db/products.db` (NOT root `products.db`); the two agree on these counts.
> Counts were re-queried this session because the shared DB drifts between
> sessions — the memory snapshot's numbers were stale, and one of its headline
> findings (a `Dry` 965 / `dry` 194 sweetness case-duplication) **does not exist**
> and was removed from scope (PR #51 separately normalized the only real lowercase
> *sweetness* dupes). Re-derive counts at implementation time; do not trust these
> as frozen.

| column    | populated (`TRIM(col)<>''`) | distinct values / notes |
|-----------|------|-------------------------|
| smokiness | 1,970 | `none` 1,901 · `heavy` 69. Binary today; lives only on Whisky+Spirits (L-prefix). Untouched by #49. |
| sweetness | 1,547 | `Dry` 1,159 · `Sweet` 273 · `Medium-Sweet` 59 · `Off-Dry` 56. Lowercase dupes fixed by #51; **but Extra-Dry→`Dry` inversion (56 rows) still live in the export.** |
| body      | 5,527 | `Medium-Full` 2,213 · `Medium` 1,328 · `Light` 928 · `Full` 924 … **lowercase `light`×6 still in the export** (#51 fixed sweetness only). Leaks onto Accessories/Non-Alcoholic. |
| variety   | 8,296 | **comma-delimited multi-value** (e.g. `Cabernet Sauvignon, Merlot`); **2,988 empty-string `''` + 152 NULL** rows. Holds non-grape tokens (base material/class) for spirits/sake. |

Rows with ≥1 taste value: **9,429**.

**Confirmed systematic bugs (deterministic, no LLM needed to detect):**
- Sparkling **"Extra Dry" → tagged `Dry`**: all **57** name-match rows. Extra Dry
  (12–17 g/L dosage) is *sweeter* than Brut → correct value is **Off-Dry**.
- **Non-beverage taste leak**: **22** rows resolving to group ∈
  {Accessories, Events, Non-Alcoholic} carry `variety`/`body` (e.g. Champagne
  glasses tagged `Pinot Noir, Chardonnay, Pinot Meunier`; tonic-water tagged
  `body=light`). Root cause: a substring-"Champagne"/flavor-word enrichment pass.
  Correct value is **NULL**.
- **Peated false-negatives** (the dangerous class): genuinely peated whiskies
  tagged `none` — Talisker 10/14/8, Ledaig, Bunnahabhain Y&F, Tomintoul "Peaty
  Tang". A "suppress none" display would silently hide these; the user sees no
  badge and assumes unpeated.
- **`heavy` false-positives**: Islay GINS (~6 rows), Ole Smoky moonshine
  (brand name "Smoky", unpeated corn), event ticket "ISLAY FC" (resolves to
  group=Whisky so a naive whisky-gate does not drop it).

## 4. Category resolution (Rule 12)

Category is **not a stored column**. Resolve `group` / `type` per row at runtime
via `data/lib/taxonomy/sku_taxonomy.py`:
- `group_for(sku)` → browse group (Wine / Whisky / Spirits / Accessories / …)
- `type_for(sku)` → type (Sparkling, Dessert, Fortified, … — a TYPE *within* a group)
- `resolve(product)` → full dict

**Never** read the raw Magento `classification` column (stale TYPE duplicate;
0/11,436 real designations). Resolution is `lru_cache`-backed and fast
(~800k rows/s; 0 Unknown / 0 letter-fallback on taste-bearing rows as of
2026-06-24). Note: `resolve()` returns a *valid* group for Accessories, so it
will not by itself flag the non-beverage leak — the deterministic pre-pass must
group-filter.

## 5. Architecture

One read-only script: `scripts/audit_taste_data.py`. Three stages.

### Stage 1 — Census + category resolve
- Select rows where `TRIM(COALESCE(col,'')) <> ''` for each taste column
  (NOT `IS NOT NULL` — empty-string and NULL both excluded; 2,988 empty `variety`
  rows would otherwise corrupt counts).
- Resolve `group`/`type` per row via the taxonomy module.
- **Split `variety` on `,`** into base/grape tokens before pivoting; normalize
  case for the pivot key only (preserve original for reporting).
- Build a (column × value × group × type) pivot with per-cell counts.

### Stage 2 — Deterministic pre-pass (free, 100% recall on known bugs)
Flag, with explicit rules and an *expected correct value*:
- Sparkling "Extra Dry" (name match, type=Sparkling) → expected **Off-Dry** (57).
- Non-beverage leak: group ∈ {Accessories, Events, Non-Alcoholic} with
  variety/body → expected **NULL** (22).
- **Peated-distillery lexicon** (seed list: Talisker, Ledaig, Caol Ila,
  Kilchoman, Bunnahabhain-Y&F, Springbank-Longrow, Ardbeg, Lagavulin, Laphroaig,
  Bowmore, Smokehead — extensible): smokiness `none`/NULL on these → flagged
  **false-negative suspect** (priority class).
- Brand-name smoky trap: name contains "Smoky/Smokehead/Ole Smoky" but distillery
  not on the peated list → `heavy` is a suspect false-positive.
- Body lowercase case-dupes (`full`/`light`) → normalize-suspect.

Bucket all unflagged rows as "looks-clean."

### Stage 3 — LLM judge (Haiku 4.5), uniform pass
Judges **every suspect row + a stratified control** (see §6). Uniform pass means
deterministic-bug rows are also judged, on purpose: they have a *known expected
verdict* and double as a **judge-calibration check** (see §7). Verdicts cached to
a JSONL sidecar so re-runs are free (reuse Run 1's cache pattern from
`scripts/enrich_phase_b.py` / `merge_phase_b_cache.py`).

**Judge prompt — domain rules carried inline** (without these the judge
rubber-stamps the bug). Each row supplies: `name`, resolved `group`+`type`, the
column, the current value. System prompt rules:
- **Sparkling dosage ladder:** Brut Nature (0–3) < Extra Brut < Brut <
  **Extra Dry (12–17 g/L)** < Sec/Dry < Demi-Sec < Doux. Explicit: *"Extra Dry is
  sweeter than Brut → Off-Dry, NOT Dry."*
- **"Dry" as style-name ≠ palate:** London/Plymouth Dry Gin, Riesling Trocken,
  sake Karakuchi (=dry, correct). Judge palate, not the label word. Vermouth
  Dry/Rosso IS a real palate distinction — keep.
- **Peat is by-distillery:** peated-distillery list supplied; Talisker/Ledaig/
  Caol Ila/Kilchoman = smoky even with no "peat" in the name. But
  "Smoky/Smokehead/Ole Smoky" may be a BRAND → verify actually peated.
- **German Prädikat:** Kabinett/Spätlese default off-dry/sweet **unless
  Trocken/Feinherb present** (then dry). Don't push correct Trocken rows to Sweet.
- **`variety` = base material / class, per category:** wine→grape;
  whisky→Single Malt/Blended/Bourbon/Rye; sake→Junmai/Ginjo/Daiginjo grade;
  gin→botanical; rum→cane/molasses. **Never judge a whisky/sake variety against a
  grape rubric** (would falsely flag ~800 correct rows).

**Verdict enum:** `confirm_correct` / `wrong_value→<X>` / `not_applicable_null_it`
(the third is essential — hardware variety/body should be NULLed, not corrected).

## 6. Sampling & escalation

- **Suspects:** judged 100%.
- **Control:** stratified by `type`, **≥10 judged rows per type** that has ≥20
  populated rows. A flat random control would be ~78% Wine and miss the dirty
  zones (69 heavy, 57 Extra-Dry, 22 hardware).
- **Tiny cells:** cells with <20 rows are **reported but excluded from
  escalation math** (a 3-row cell cannot yield a meaningful error rate; 75% of
  raw cells have ≤3 rows).
- **Auto-escalation:** a control cell with **n≥20** whose error rate exceeds
  **15% by Wilson lower-bound** (not raw point estimate) escalates to a full
  judge of that cell. Bounded and data-driven.
- **Granularity note:** a "cell" is a (column × value × group × type) bucket; a
  "type" is the coarser stratification unit for drawing the control sample. A
  type can clear ≥20 populated rows while all its individual cells are <20.
  The Wilson lower-bound and the n≥20 escalation gate are computed **per cell**;
  control rows are *drawn* per type but *evaluated* per cell. The plan must state
  this explicitly so the implementer does not compute rates over the tiny cells
  §6 excludes.

## 7. Judge-calibration gate

The deterministic-bug rows (Extra-Dry→Off-Dry and the non-beverage leak) have a
known-correct expected verdict written into the findings file. The calibration
set is **whatever Stage 2 actually flags at run time** — NOT the literal 57/22
counts in §3, which may drift. (Re-derive; the spec's frozen numbers are
illustrative.) After the judge runs, compare its verdicts on these rows
to expectation. If the judge returns `confirm_correct` on a row known to be wrong
(or vice-versa) above a small tolerance, the judge is **miscalibrated → the run
is flagged and its verdicts are NOT trusted** until the prompt is fixed. This
converts the "uniform pass" spend on known bugs into judge validation
(addresses Rule 4: don't pay merely to re-confirm a known bug — here the spend
buys calibration).

## 8. Cost & Rule-10 gating

Model: Haiku 4.5 (~$1/M input, ~$5/M output). Per row ≈ ~60 input + ~30 output
tokens, batched, cached.

- Suspects (~150–250) + control (~300–500) ≈ **600–750 rows ≈ $0.03–0.05, ~5 min**.
- Worst case (several cells escalate): ~$0.15.
- **Rule 10:** before the full judge runs — back up the findings sidecar, run a
  **20-row canary** on the real frame, re-estimate per-row cost, and get user
  sign-off on the number. The $0.05 estimate is provisional until the canary
  confirms it on real rows.

This spec covers the audit only. It produces no paid run by itself; the run is a
later, separately-gated step.

## 9. Outputs (committed; no DB writes)

- `docs/superpowers/audits/2026-06-24-taste-audit-report.md` — human-readable:
  per-column error rates by (value × category), the trust/correct/re-enrich
  decision each, judge-calibration result, escalations, and the non-beverage /
  peated-false-negative findings.
- `data/audits/taste_audit_findings.json` — machine-readable per-SKU verdicts
  (`{sku, column, current_value, verdict, expected_value, reason, source}`) →
  the blocklist input for the future correction script.

## 10. Per-column decision framework

For each column the report emits exactly one verdict:
- **trust as-is** — measured error rate negligible; ship to display unchanged.
- **correct** — deterministic, source-agnostic correction script, **group+type
  gated, explicit blocklist, `--dry-run`, table backup**. NOT a rules re-run
  (that fixes nothing — the bad values aren't from the rules).
- **re-enrich** — paid LLM gap-fill, Rule-10 gated (backup → canary → estimate →
  sign-off).

Expected leanings (to be confirmed by the data, not pre-decided):
- **smokiness** → *correct* (3-state by distillery: fix false-positive `heavy`
  + false-negative `none`-on-peated via lexicon).
- **sweetness** → *correct* (deterministic Extra-Dry→Off-Dry; style-name "Dry"
  handling per category).
- **variety** → likely *trust/correct* (base-material semantics; null the 22
  non-beverage leaks; spot-check Run-1 Haiku values vs legacy).
- **body** → likely *trust* after case-normalize + non-beverage null.

## 11. Hard constraints (CLAUDE.md)

- Canonical DB = `data/db/products.db` (never root `products.db`).
- group ≠ type — use `category_group`/`category_type` via the SKU taxonomy; never
  branch on raw `classification` (Rule 12).
- Any DB write (a later effort) → run `scripts/refresh_live_export.py` +
  browser-verify (Rules 1/7/9). The export only includes columns in its
  `EXPORT_COLS` allowlist.
- Any paid run → backup → canary → cost estimate → user sign-off (Rule 10);
  verify paid work landed in the user-facing destination (Rule 1).
- API key loads from `.env.local` (gitignored), same loader as Run 1; the run
  errors out if it's missing.

## 12. Next steps after this spec

1. Spec review loop (spec-document-reviewer).
2. User reviews spec.
3. `writing-plans` → implementation plan for `scripts/audit_taste_data.py`.
4. Run the audit (Rule-10 canary gate before the judge).
5. Review findings → decide correction vs re-enrich per column → that becomes the
   next brainstorm→spec.
