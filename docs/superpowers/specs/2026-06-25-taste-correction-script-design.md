# Taste-Data Correction Script — Design Spec

**Date:** 2026-06-25
**Status:** Design approved; revised after 2nd expert review (74 rows, full ops hardening)
**Consumes:** `data/audits/taste_audit_findings.json` (from the taste audit, PR #54)
**Writes to:** `data/db/products.db` (payment-path; Rules 1/4/6/9/10 apply)

---

## 1. Problem & goal

The taste audit (PR #54) produced a per-SKU findings file with judge verdicts.
**Goal:** apply ONLY the high-confidence, deterministic, judge-confirmed
corrections to the canonical DB, then refresh the user-facing export. This fixes
real user-visible errors (sparkling sweetness inversion, peated whiskies tagged
not-smoky, grape blends on glassware) with near-zero regression risk.

## 2. Scope — Tier A only (74 rows)

The write set is read FROM `findings.json`, gated on
`rule ∈ TIER_A_RULES ∧ judge_verdict ∈ {wrong_value, not_applicable_null_it}`,
THEN passed through a **peated drop-list** (see below). Verified live 2026-06-25
(0 drift vs findings):

| Rule | Column | Write (literal) | N |
|---|---|---|---|
| sparkling_extra_dry_inversion | sweetness | `'Off-Dry'` | 49 |
| nonbeverage_taste_leak | variety | SQL `NULL` | 17 |
| peated_false_negative | smokiness | `'heavy'` | 5 |
| smoky_brand_false_positive | smokiness | `'none'` | 3 |
| **Total** | | | **74** |

All 49 Extra-Dry are genuinely sparkling with a true Extra-Dry dosage (sommelier
confirmed; `Off-Dry` is the correct gauge cell, none belong in Medium-Sweet). The
17 nulls are glassware/bar-tools/event-tickets (the "Champagne blend ghost"); the
3 Billabong de-alc WINES are EXCLUDED (judge kept their varieties). The 5 peated
that ship are sommelier-confirmed: **Talisker 10/14/8** (`LWH0155BU`, `LWH1256BU`,
`LWH1151BU`) + **Ledaig 7/19** (`LWH0091BT`, `LWH1207DG`). The 3 Ole Smoky are
unpeated corn moonshine (brand name).

### Peated drop-list (sommelier last-mile review)

The `peated_false_negative` rule fired on the distillery token "Bunnahabhain"
(in the Islay lexicon) but **core Bunnahabhain is UNPEATED** — only the Staoisha/
Moine/Y&F peated make is smoky. Three rows are DROPPED:
- `LWH0105BT` Old Malt Cask Bunnahabhain 16 — core, unpeated → DROP (its own DB
  description foregrounds malt/sea-salt "over smoke"; `heavy` = false fact).
- `LWH1206DG` Boutique-y Bunnahabhain 27 — core, unpeated → DROP.
- `LWH0089BT` Bunnahabhain Y&F — AMBIGUOUS (name=Douglas Laing peated Staoisha;
  but the product page copy says "rather than the heavy peat smoke") → **HOLD**
  for human spot-check, do not auto-ship.

**Root-cause guard (also patch the audit lexicon):** in
`scripts/audit_taste_lib.py` `triage_smokiness`, only flag a "bunnahabhain"-named
row as peated when the name ALSO contains a peated cue
(`staoisha`/`moine`/`y&f`/`young & feisty`/`ceobanach`/`peat`). Add this so the
audit can't re-introduce the false positives. (The correction script encodes the
3-SKU drop-list directly so it's correct regardless of when the lexicon is
patched.)

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

**The DB is WAL-mode and SHARED via symlink with parallel sessions** (the
worktree DB symlinks to the real one; other sessions write it concurrently and
can even replace the whole file). The procedure is hardened accordingly.

**Flow:**
1. **Load + build write set** from `findings.json` with the §2 gate, the peated
   drop-list (§2), and a **negative guard**: skip any peated_false_negative row
   whose name contains `unpeated`/`non-peated`/`non peated`. **Tripwire:** assert
   `len(write_set) == 74` (print prominently); if a regenerated findings.json
   yields a different count, STOP and re-review (silent count drift = Rule-1
   failure mode).
2. **Pre-flight freshness snapshot.** Open the connection with
   `PRAGMA busy_timeout=10000`. Record `PRAGMA data_version` and the live value of
   each of the 74 target cells. (This is the canary-memory "WAL + busy_timeout +
   retry" pattern — see [[feedback_canary_must_match_prod]].)
3. **WAL-safe timestamped backup** to a gitignored path before any write:
   `sqlite3 <db> ".backup data/db/products.db.bak-pre-taste-correct-<ts>"`
   (consolidates the `-wal`; NOT bare `cp`). The backup is the LAST-RESORT
   same-session rollback only (see §7.4).
4. **Acquire the write lock up front:** `BEGIN IMMEDIATE`, wrapped in a Python
   retry-on-`OperationalError: database is locked` loop with backoff. Re-assert
   `PRAGMA data_version` == the snapshot from step 2; if it changed, another
   writer touched the DB — **abort and retry the whole flow** (don't write into a
   shifted DB).
5. **Staleness-guarded writes** inside that transaction. For each row:
   - `current_value` non-null (all 74 today):
     `UPDATE products SET <col> = ? WHERE sku = ? AND <col> = ?`
     params `(literal, sku, current_value)`.
   - `current_value` None (defensive): build `... WHERE sku = ? AND <col> IS NULL`
     as a LITERAL `IS NULL` (a bound NULL param does equality, never matches).
   Capture each `cursor.rowcount`. **`applied_count = Σ rowcount`** (each is 0 or 1).
   Also write a per-row **undo-journal** entry `(sku, col, old=current_value,
   new=literal)` to `data/audits/taste_correction_undo_<ts>.jsonl` BEFORE commit
   (powers the targeted rollback in §7.4).
6. **0-rowcount disambiguation.** A guarded UPDATE matching 0 rows is classified
   by re-reading the live value: `live == literal` → **already_applied** (safe,
   expected on a re-run); `live == current_value` → logic error; else →
   **external_drift** (unsafe, another session changed it). Report the three
   buckets separately.
7. **Collateral check + commit.** `total_changed = conn.total_changes` measured
   immediately-before-`BEGIN` vs immediately-before-`commit`. Commit ONLY if
   `applied_count == 74 − already_applied − external_drift` AND
   `total_changed == applied_count`. Any `external_drift`, or a mismatch → **ROLLBACK**.
8. **Post-write assertions** (exit non-zero on any miss), scoped to TARGET SKUs:
   the 49 → sweetness='Off-Dry'; 5 → smokiness='heavy'; 3 → 'none'; 17 → variety
   IS NULL. Off-scale sweep **scoped to target SKUs only** (the table has
   pre-existing `Medium-Light`/lowercase rows this run doesn't touch).
9. **Rule-4 summary:** attempted / applied / already_applied / external_drift /
   per-rule counts. **Exit codes:** 0 = all applied OR all skips already_applied;
   non-zero on any external_drift, assertion miss, tripwire≠74, or rollback.
   **Does NOT auto-refresh the export** (deliberate manual step, §7).

**`--dry-run`** still opens `BEGIN IMMEDIATE` + runs the guarded SELECTs (reports
applied/already/drift) and `ROLLBACK`s — so it exercises the real lock-acquisition
path (a dry-run that skips the write path is not a canary — [[feedback_canary_must_match_prod]]).

## 6. variety NULL vs empty-string

Write SQL `NULL` (the literal map's `None`). The DB today is mixed (≈2,797 `''`
vs ≈119 NULL); `refresh_live_export.py` passes both through raw and all catalog
consumers use truthiness, so NULL and `''` render identically as "unpopulated".
NULL is the cleaner semantic for "this attribute does not exist here." Documented
so a future reader doesn't see it as inconsistency.

## 7. Post-run runbook (manual, Rules 1/7/9)

> **CRITICAL export-reach gotcha:** `refresh_live_export.py` defaults its output
> to `REPO_ROOT/data/live_products_export.json`, where `REPO_ROOT` resolves to
> the **current checkout**. Run inside the worktree, it writes the WORKTREE's
> export copy — which the production catalog build never reads. The export is
> git-tracked and the catalog builds from the **committed** copy. So:

1. **Refresh the canonical export with explicit paths:**
   `./.venv/bin/python scripts/refresh_live_export.py --db data/db/products.db`
   — confirm it wrote the export the catalog reads. Because the DB write landed in
   the SHARED DB (via the symlink) and the export is per-checkout, the cleanest
   path is: run the refresh, then **commit the updated `live_products_export.json`
   on this branch** and let it merge to main (the catalog deploys from main's
   committed export — [[reference_ci_and_deploy_gates]]). Do NOT declare "shipped"
   off the worktree's local export.
2. **Verify in the COMMITTED export** (Rule 1): a query against the JSON the
   catalog reads asserts the 49 sparkling SKUs show `sweetness=Off-Dry`, the 5
   whiskies `smokiness=heavy`, the 3 Ole Smoky `smokiness=none`, the 17
   accessories have `variety` empty/null. Show the count.
3. **Browser check** (Rule 7): open a corrected sparkling product page (sweetness
   gauge) and a corrected peated whisky (e.g. Talisker 10); confirm the taste
   display renders the corrected value.

## 7.4 Rollback runbook

**Default rollback = the targeted undo journal, NOT a file restore.** Restoring
`products.db.bak-*` is a full-file snapshot of a SHARED DB; if another session
committed legitimate work (country fixes, image reconciliation, popularity sync)
after our backup, restoring clobbers it. So:

- **Targeted undo (preferred, any time):** replay the inverse of each journal
  entry — `UPDATE products SET <col> = <old> WHERE sku = ? AND <col> = <new>`
  (staleness-guarded, same engine). Then re-run §7 step 1–2 to refresh + re-commit
  the export. Only touches our 74 rows; safe even if other sessions wrote since.
- **Full `.backup` restore (last resort, same-session only):** use ONLY if the
  abort happens with NO intervening external writes (verify `data_version`
  unchanged since backup). Otherwise it destroys concurrent work.

## 8. Testing (TDD)

Unit-testable pure helpers (no DB): `build_write_set(findings)` (gate +
drop-list + negative-guard), `literal_for(rule)`. Integration tests against a
tiny temp-file SQLite fixture:
- write set is exactly the gated rows = **74**; `judge.value` is NEVER used
  (assert the smokiness write is `'heavy'`, not `'smoky'`).
- **drop-list:** the 3 Bunnahabhain SKUs (`LWH0105BT`, `LWH1206DG`, `LWH0089BT`)
  are NOT in the write set even though their rule+verdict pass the gate.
- **count tripwire:** build_write_set asserts/returns 74; a findings file that
  yields a different count makes the script STOP.
- staleness guard: a row whose live value ≠ findings.current_value is classified
  `external_drift`, skipped, reported — not written; the run exits non-zero.
- **already_applied vs external_drift:** a row already at the target literal →
  `already_applied` (safe, exit 0); a row at a third value → `external_drift`
  (exit non-zero). The two buckets are distinct in the summary.
- idempotency: a full second run reports all 74 `already_applied`, writes nothing,
  exits 0.
- transaction/collateral: `total_changes` diff must equal `applied_count`, else
  rollback (no partial write); simulate a mismatch → assert rollback.
- NULL semantics: variety write is SQL NULL, not the string "None".
- negative guard: a synthetic "Bruichladdich ... Unpeated" / "Ardbeg Unpeated"
  row is skipped by the name guard.
- **undo journal:** after a run, replaying the journal's inverse UPDATEs restores
  the original values exactly (round-trip).
- **dry-run** opens BEGIN IMMEDIATE, reports the applied/already/drift split, and
  leaves the DB byte-identical (rolls back).

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
