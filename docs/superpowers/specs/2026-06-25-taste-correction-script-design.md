# Taste-Data Correction Script — Design Spec

**Date:** 2026-06-25
**Status:** Design approved (expert-reviewed); spec under review
**Consumes:** `data/audits/taste_audit_findings.json` (from the taste audit, PR #54)
**Writes to:** `data/db/products.db` (payment-path; Rules 1/4/6/9/10 apply)

---

## 1. Problem & goal

The taste audit (PR #54) produced a per-SKU findings file with judge verdicts.
**Goal:** apply ONLY the high-confidence, deterministic, judge-confirmed
corrections to the canonical DB, then refresh the user-facing export. This fixes
real user-visible errors (sparkling sweetness inversion, peated whiskies tagged
not-smoky, grape blends on glassware) with near-zero regression risk.

## 2. Scope — Tier A only (77 rows)

The write set is read FROM `findings.json`, gated on
`rule ∈ TIER_A_RULES ∧ judge_verdict ∈ {wrong_value, not_applicable_null_it}`.
Verified live 2026-06-25 (0 drift vs findings):

| Rule | Column | Write (literal) | N |
|---|---|---|---|
| sparkling_extra_dry_inversion | sweetness | `'Off-Dry'` | 49 |
| nonbeverage_taste_leak | variety | SQL `NULL` | 17 |
| peated_false_negative | smokiness | `'heavy'` | 8 |
| smoky_brand_false_positive | smokiness | `'none'` | 3 |
| **Total** | | | **77** |

All 49 Extra-Dry are genuinely sparkling with a true Extra-Dry dosage (sommelier
confirmed); `Off-Dry` is the correct gauge cell. The 17 nulls are glassware/
bar-tools/event-tickets (the "Champagne blend ghost"); the 3 Billabong de-alc
WINES are EXCLUDED (judge kept their varieties — they're real wine). The 8 peated
are genuinely peated expressions (Talisker, Ledaig, Bunnahabhain-Y&F); the 3 Ole
Smoky are unpeated corn moonshine (brand name).

## 3. Out of scope (explicitly — separate efforts)

- **Tier B** — the judge's per-VALUE rewrites (81 body, 57 variety). One LLM
  vote on debatable values (Lagavulin Full vs Medium); needs multi-vote
  re-verification before any write. NOT in this script.
- **The body_case_dup row (`WRW5696FR`)** — mislabeled: rule intended `full→Full`
  (case-fix) but the judge wants `full→Medium` (a value change). Dropped. Body
  corrections (incl. the lowercase name-leak rows the sommelier found) are their
  own effort.
- **Display-suppression** — body-on-spirits + sweetness-on-Gin/sake should stop
  *displaying* (the catalog gauge), but the values are mostly correct. That's a
  catalog UI gate (`taste-adapter.ts` / `applies()`), NOT a DB write.
- **Deterministic sweetness fills** — ~8 Demi-Sec/Moscato/Asti NULLs + the
  472/896 NULL-sparkling gap the sommelier flagged. Unaudited new scope; its own
  brainstorm.

## 4. The critical correctness rule (from expert review)

**NEVER write `judge.value`.** The judge invented off-scale/wrong replacements on
exactly the rows that matter:
- 8 peated rows: `judge.value = "smoky"` — but the DB scale is strictly
  `none`/`heavy`, and the finder branches on `norm(smokiness)==='heavy'`
  (`apps/catalog/lib/finder/scoring.ts`). Writing "smoky" = a third never-seen
  token the UI IGNORES → the paid fix is invisible (the $56 Rule-1 trap).
- 17 nonbeverage rows: `judge.value = "None"` (the STRING) — writing it injects
  literal text "None" as a variety that RENDERS.

Instead, use a **per-rule literal map** to the real column scale:

```python
WRITE = {
    "sparkling_extra_dry_inversion": ("sweetness", "Off-Dry"),
    "nonbeverage_taste_leak":        ("variety",   None),     # SQL NULL
    "peated_false_negative":         ("smokiness", "heavy"),
    "smoky_brand_false_positive":    ("smokiness", "none"),
}
```

## 5. Architecture

One script `scripts/correct_taste_data.py`, built on the proven
`scripts/normalize_sweetness_case.py` skeleton (`--db`, `--dry-run`, UPDATE,
verify). Pure-helper extraction into the script (small enough not to need a lib).

**Flow:**
1. **Load + build write set** from `findings.json` with the §2 gate. Apply the
   peated **negative guard**: skip any peated_false_negative row whose name
   contains `unpeated`/`non-peated`/`non peated` (none today, but future-proofs
   the lexicon — Bruichladdich Classic Laddie Unpeated, Nikka Yoichi Non-Peated
   are one lexicon-entry away).
2. **WAL-safe timestamped backup** before any write:
   `sqlite3 <db> ".backup <db>.bak-pre-taste-correct-<ts>"` (NOT bare `cp` —
   the DB is WAL-mode and concurrently mutating; `cp` can miss the `-wal`).
3. **Staleness-guarded writes in ONE transaction.** For each row, guard on the
   live value still matching the audit snapshot's `current_value`:
   - If `current_value` is a non-null string (all 77 Tier-A rows today):
     `UPDATE products SET <col> = ? WHERE sku = ? AND <col> = ?`
     params `(literal, sku, current_value)`.
   - If `current_value` is None (defensive — not in today's set):
     `... WHERE sku = ? AND <col> IS NULL` (a literal `IS NULL`, NOT `IS ?` — a
     bound NULL param does equality, not an IS-NULL test, so it would never
     match). Build the WHERE clause conditionally on whether `current_value` is
     None.
   Assert `cursor.rowcount == 1`; if 0, the live value drifted from the audit
   snapshot — **skip and record it in a drift report, do not blind-write.**
   **Tripwire:** assert `len(write_set) == 77` (print prominently) before writing —
   if a regenerated findings.json yields a different count, STOP and re-review
   (a silent count drift is exactly the Rule-1 failure mode).
4. **Commit only if** `applied_count == len(write_set) - drift_count` AND
   `total_rows_changed == applied_count` (no collateral). Else **rollback**.
5. **Post-write assertions** (exit non-zero on any miss):
   - Per-rule effect restricted to the TARGET SKU set (e.g. those 49 SKUs now
     have sweetness='Off-Dry'; those 8 now 'heavy'; those 3 now 'none'; those 17
     variety IS NULL).
   - Off-scale sweep **scoped to target SKUs**: 0 of the target smokiness rows
     NOT IN ('none','heavy'); 0 target sweetness NOT IN the gauge scale.
     (Scope to targets — the whole table has pre-existing off-scale rows like
     `Medium-Light` body that this run doesn't touch.)
6. Print a Rule-4 summary: rows attempted / applied / skipped-drift / per-rule
   counts. **Does NOT auto-refresh the export** — that's a deliberate manual
   step (next).

## 6. variety NULL vs empty-string

Write SQL `NULL` (the literal map's `None`). The DB today is mixed (≈2,797 `''`
vs ≈119 NULL); `refresh_live_export.py` passes both through raw and all catalog
consumers use truthiness, so NULL and `''` render identically as "unpopulated".
NULL is the cleaner semantic for "this attribute does not exist here." Documented
so a future reader doesn't see it as inconsistency.

## 7. Post-run (manual, Rules 1/7/9)

1. `./.venv/bin/python scripts/refresh_live_export.py` — the UI reads the export,
   not the DB. (Verified: all 4 taste columns are in `EXPORT_COLS`, so the writes
   reach users.)
2. **Verify in the export**: the 49 Off-Dry / 8 heavy / 3 none / 17 null-variety
   SKUs show the corrected value (a count query against the JSON).
3. **Browser check** (Rule 7): open a corrected sparkling product page (sweetness
   gauge) and a corrected peated whisky; confirm the taste display is right.

## 8. Testing (TDD)

Unit-testable pure helpers (no DB): `build_write_set(findings)` (gate +
negative-guard), `literal_for(rule)`. Integration tests against a tiny temp-file
SQLite fixture:
- write set is exactly the gated rows; `judge.value` is NEVER used (assert the
  smokiness write is `'heavy'`, not `'smoky'`).
- staleness guard: a row whose live value ≠ findings.current_value is skipped +
  reported, not written.
- idempotency: a second run is a no-op (the guard's `WHERE col=oldvalue` matches
  nothing once corrected).
- transaction: if affected-count ≠ expected, rollback (no partial write).
- NULL semantics: variety write is SQL NULL, not the string "None".
- negative guard: a synthetic "Ardbeg Unpeated"-style row is skipped.

## 9. Hard constraints (CLAUDE.md)

- Canonical DB `data/db/products.db` (never root). Category via SKU taxonomy
  (Rule 12) — though this script keys on findings' rule, not re-resolution.
- This is a payment-path write (Rules 1/4/6/9). No "done" until a count query
  confirms the corrected fields in the EXPORT (not just the DB) + a browser check.
- It spends NO API money (deterministic; the audit already paid). So Rule 10's
  canary/cost-estimate is N/A — but the backup + dry-run + staleness guard +
  rollback are the equivalent safety net for an irreversible DB write.

## 10. Next efforts after this

1. Tier-B re-verification (body/variety per-value, multi-vote) → its own spec.
2. Display-suppression UI gate (body-on-spirits, sweetness-on-Gin/sake).
3. Deterministic sweetness fills (Demi-Sec/Moscato + the 472-NULL sparkling gap).
4. Fix the audit's `nonbeverage` rule (it wrongly includes `Non-Alcoholic`, which
   sweeps up de-alc wine — caught here by the judge gate, but worth fixing).
