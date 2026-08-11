# CONTINUE PROMPT — Curation Dossier Library, Phase 2, batch 10

**State as of end of batch 9 (2026-08-06). Paste the block at the bottom into a fresh session.**

---

## Where things stand

| | |
|---|---|
| `wine_dossier` rows | **195** |
| `sku_dossier_overlay` rows | **246** |
| In-scope wine_keys (in-stock, critic-scored) | 838 |
| Done in scope | 191 |
| **Remaining** | **647** |
| Last run id | `phase2-realbatch9-20260806` |
| Last backup | `data/db/dossier.db.backup-pre-phase2-realbatch9-20260806-223255` |

Batch 9 shipped clean: gate passed, 21/21 SKUs verified populated in
`data/live_products_export.json` by direct re-query, invariants 7 passed / 1 skipped.

**Full batch-9 write-up:** `docs/superpowers/HANDOFF-curation-dossier-phase2-test.md`,
section "Phase 2 REAL RUN #9". Read that before starting — it carries the process,
not just the result.

---

## Read these first (in this order)

1. `docs/superpowers/HANDOFF-curation-dossier-phase2-test.md` — REAL RUN #9 section,
   then #8 and #7 for the recurring failure modes.
2. `data/dossier_runs/batch9/` — **the working scripts are here and are the template.**
   Copy them for batch 10; do not rewrite from scratch.
3. `CLAUDE.md` — Rules 1, 6, 9, 10 govern every step of this pipeline.

---

## The durability fix — DO NOT UNDO

Run artifacts live in **`data/dossier_runs/batchN/`** inside the repo, gitignored via
the `data/dossier_runs/` rule in `.gitignore` (line ~58, with a comment explaining why).

Batch 9 was drafted once, in full, and **entirely destroyed** by the macOS `/private/tmp`
purge when the session straddled a date boundary. Every draft, script, and audit input
was lost; the task transcripts were 144-byte stubs. Batches 1–8 never hit this only
because each finished inside a single day.

**Never put run state back in `/private/tmp`.** The scratchpad is fine for throwaway
scratch, but anything you'd have to regenerate goes in `data/dossier_runs/`.

---

## The batch-N process (unchanged, this is the contract)

1. **Select** next 20 remaining wine_keys by critic score desc — `select_batch9.py`.
   Use the `|scope| − |done ∩ scope|` count form. **Not** `838 − row_count`
   (4 mechanism-test rows are out of scope and would understate the remainder).
2. **Draft** in 5 sub-batches of 4, parallel background agents, one per sub-batch.
3. **Merge + pre-check** — `merge_batch9.py`. Confirms 20/20 exact set match and
   writes per-sub audit inputs.
4. **MANDATORY independent citation check** — 5 fresh agents, **zero drafting context**,
   each re-fetching every cited URL. This is not optional and has caught real
   fabrications in every batch it has run on. Batch 9: 78 corrections across 18 of 20 wines.
5. **Apply corrections** — `apply_corrections9.py`. Fails loud on any unmatched or
   ambiguous `find` target and writes nothing. A silent no-op correction is how a
   known-bad claim ships anyway.
6. **Gate** — `verify_batch9.py`. wine_key parity re-minted from live `products.db`,
   every pairing carries `confidence`, `sourced` requires non-empty `source_urls`,
   banned-language scan.
7. **Back up** `dossier.db` (Rule 10).
8. **Stage** — `stage_batch9.py`. **Both `wine_dossier` AND `sku_dossier_overlay` in the
   SAME transaction.** Splitting them produces a pipeline that reports success while
   shipping nothing. Guarded upsert protects `human-approved` rows.
9. **Refresh** — `refresh_products_dossier.py` then `refresh_live_export.py` (Rule 9).
10. **Invariants** — `tests/test_dossier_db_invariants.py` (Rule 6).
11. **Rule 1 re-query** — `requery_batch9.py`. Direct read of the live export confirming
    every batch SKU's `curation_dossier` is populated. Counting staged rows is NOT
    verification.
12. **Spot-check packet** — fixed sampling, position 1 of each of the 5 sub-batches.
    Never hand-picked.
13. **Handoff doc** — new "Phase 2 REAL RUN #10" section in the style of #7/#8/#9.

**Then STOP and wait for an explicit "continue"/"batch 11".** Do not auto-proceed.

---

## Carry these into the batch-10 drafting prompts

**Site reachability — correct the record:**
- `petermichaelwinery.com` is **NOT reliably blocked**. Batches 8 and 9 both wrote it off
  as 403; the batch-9 auditor fetched it (200, fully readable) and recovered verbatim
  producer copy the drafter had hedged away. **Do not pre-declare it blocked.**
- `us.penfolds.com` is reachable while `penfolds.com` 403s. Penfolds recurs often in the
  remaining 647.
- Genuinely hostile in batch 9: `sanfelice.com` (403), `vik.cl` (404), Renieri's
  `bacciwines.it`/`castellodibossi.it` (ECONNREFUSED), `travaglinigattinara.it`
  (empty body), `dallaterra.com` (403 to WebFetch, 200 to curl).

**PDFs:** WebFetch reporting "unreadable binary" is not final. The batch-9 auditor
recovered the Montes tech sheet by **reading the saved PDF directly as an image**,
preserving the batch's densest numeric field from a false downgrade. Try that before
accepting a PDF-driven downgrade.

**The two named failure modes (state both explicitly in every drafting prompt):**
- (A) *flag-then-publish-anyway* — recording a doubt in a note while shipping the claim
  as `sourced`.
- (B) *over-caution* — deleting a true, verifiable fact that a fetched page does support.

**The batch-9 auditor named a third, and it is the one to attack next:**
> provenance lists were assembled from where the drafter **looked**, not where the claim
> **came from**.

Three citation-hygiene defects traced to this (a dead URL cited as support; two fields
whose load-bearing claims came from pages absent from their own `source_urls`).
**Suggested prompt change for batch 10: require drafters to attach the URL per-claim
during research, rather than assembling `source_urls` at write-time.** This is the
single highest-value experiment available.

**Unreachable sources are mishandled in BOTH directions.** An uncheckable citation
cannot carry numbers — delete them, don't hedge them. A reachable page's facts must not
be thrown away on an assumed block. Fetch status is a fact to be checked, not a judgment.

---

## Expect a lower "sourced" ratio than batch 8, and don't treat it as regression

Batch 8 reported 71.7% pre-check. Batch 9 was 45.0% pre-check → **51.7% post-audit**
(the audit *raised* it by reversing over-cautious downgrades). The lower number reflects
drafters refusing to launder recalled knowledge through a blocked-site citation. That is
the pipeline working.

---

## Open decisions for the owner (do not start these unasked)

1. **Pairings-only backlog is now 13 wines.** 7 from batch 7 (incl. Château Pétrus) need
   genuine re-research; 3 from batch 8 (both Joseph Phelps Freestone + Louis Roederer
   Blanc de Blancs) are a mechanical dead-source problem; 3 from batch 9 (Peter Michael
   Le Caprice, Penfolds Bin 150, Travaglini Vigna Ronchi). Options: re-research,
   leave as-is, or a partial-confidence UI treatment. **Owner's call.**
   Note: Peter Michael Le Caprice may now be recoverable given the 403 correction above.
2. **Rule 7 (browser verification) was NOT performed for batch 9.** Data was verified in
   the export by direct query, but no one opened the catalog UI. Worth one walkthrough
   covering several batches at once.
3. **Two data-model fixes needing an upstream SKU-name change** (carried since batch 7):
   - `jermann-vintage-tunina-doc` is really a Venezia Giulia **IGT**
   - `le-dragon-de-quintus-grand-cru` must never render as "Grand Cru Classé"

---

## Known gate quirk (already fixed, don't re-break)

The banned-language `investment` pattern was too broad — it failed the gate on two
*sourced facts*: Realm co-founder Wendell Laidley's profession ("investment banker",
the source's own words) and Two Hands' verified "$30,000 investment" of startup capital.
Narrowed in `verify_batch9.py` to catch only financial-asset framings
(`investment-grade|potential|opportunit`, `a/sound/solid/smart/good investment`, bare
`invest`, `store of value`, `appreciates in value`), tested against must-catch and
must-pass fixtures. **The fix belongs in the regex, never in the sourced text.**

---

# CONTINUE PROMPT — paste this into a fresh session

```
Continue the Curation Dossier Library, Phase 2 — run batch 10.

Read docs/superpowers/CONTINUE-curation-dossier-batch10.md first, then the
"Phase 2 REAL RUN #9" section of
docs/superpowers/HANDOFF-curation-dossier-phase2-test.md.

State: 195 wine_dossier / 246 overlay, 647 remaining in scope.
Working scripts to copy as templates: data/dossier_runs/batch9/

Run the standard batch process: select next 20 by critic score desc → draft in
5 sub-batches of 4 via parallel background agents → merge + pre-check → MANDATORY
independent citation check with 5 zero-context agents → apply corrections (fail-loud)
→ gate → back up dossier.db → stage BOTH wine_dossier and sku_dossier_overlay in one
transaction → refresh_products_dossier.py + refresh_live_export.py → invariants test
→ Rule 1 direct live-export re-query → spot-check packet (position 1 of each sub-batch)
→ new "Phase 2 REAL RUN #10" section in the handoff doc.

Put ALL run artifacts in data/dossier_runs/batch10/ — never /private/tmp. A tmp purge
destroyed an entire completed drafting run once already.

Two corrections to carry into the drafting prompts: petermichaelwinery.com is NOT
reliably blocked (do not pre-declare it 403), and us.penfolds.com is reachable while
penfolds.com 403s.

Try this experiment in the batch-10 drafting prompts: require drafters to attach the
source URL per-claim during research, instead of assembling source_urls at write-time.
The batch-9 audit found provenance lists were built from where the drafter looked, not
where the claim came from — that was the most systematic weakness in the batch.

Stop after batch 10 and wait for explicit instruction. Do not auto-proceed to 11.
```
