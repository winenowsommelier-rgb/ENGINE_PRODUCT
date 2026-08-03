# Session Prompt — Continue Engine ⇄ CODEX Data Library Sync

> Paste the block below the `---` into a fresh Claude Code session running in
> this repo (`/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT`). Everything above the
> line is a note to you (the human).
>
> **Why this exists:** the prior prompt
> (`docs/superpowers/plans/codex-data-library-connect-prompt.md`, merged as
> PR #96 on 2026-07-27) scoped a read-only reconciliation report as the first
> step. As of 2026-07-29, **that report never ran** — no artifacts, scripts,
> or output files referencing `producer_score_index` / `matches_live_brand`
> exist anywhere in this repo. Meanwhile the CODEX side kept moving: their
> `SESSION_HANDOFF.md` (dated 2026-07-28) describes a large parallel
> `wine_data/` build (`master_catalog.csv`, 122,725 products) that the
> original prompt never covered, and their row counts have drifted from what
> our memory recorded. This prompt re-verifies state on both sides before
> resuming, so the next session doesn't act on stale numbers.

---

We are resuming the sync between this repo (the **WNLQ9 Product Engine**,
catalog owner) and the **CODEX enrichment data library** at:

```
/Users/admin/Documents/CODEX Projects
```

Read our CLAUDE.md ABSOLUTE RULES first (Rules 1, 4, 6, 9, 10, 12 all govern
this work), then read
`/Users/admin/.claude/projects/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/memory/MEMORY.md`
— entries under **Data Sources & Ownership**, **Country / Region**, and
`project_codex_enrichment_library_sync` are directly on point. Then read the
original connect prompt in full:
`docs/superpowers/plans/codex-data-library-connect-prompt.md` — its §1–§5
(orientation, consolidated layers, join model, field-name corrections,
take/never-take list) still apply and are not repeated here. This prompt
only covers what changed and what to do next.

**Still true, still the rule:** the library is upstream read-only reference.
Read from it freely, never write to it. Never take `sku`/`name`/`brand`/
`bottle_size`/`vintage`/`alcohol`/price/cost/stock — we own identity and
commercial data.

## 1. What changed since the original prompt (verify, don't trust these numbers — they're already 2 days stale)

**CODEX side moved fast.** Their `SESSION_HANDOFF.md` (repo root, dated
2026-07-28) describes a *second, larger* build most recent commits went into:

| | Original prompt's scope | New, not yet reconciled |
|---|---|---|
| Source | `research_jobs/progress_outputs/reviews_reference_library.csv` + `producer_score_index.csv` | `wine_data/master_catalog.csv` (71 MB, 37 cols) |
| Scale | ~210K rated rows (per our old memory) — **actual current row count is 51,827, not 210K; re-count, don't trust either number** | 122,725 products, 51,497 wines |
| Producer coverage | via `producer_score_index.csv` `matches_live_brand` flag | 94% (48,318/51,497) via a different producer-backfill pass (`6f8233e`) |
| Their own next step | n/a | vintage-quality-chart ingestion (their `NEXT SESSION FOCUS`) — not our concern, but shows they're actively iterating |

Before doing anything else, read `SESSION_HANDOFF.md`,
`DATA_LIBRARY_AUDIT.md`, `DATA_CLEANUP_REPORT.md`, and
`DATA_LIBRARY_ENHANCEMENT_PLAN.md` (all in the CODEX repo root, all dated
2026-07-27/28) to understand which of the two layers — the original
`research_jobs/progress_outputs/*` library or the newer `wine_data/`
`master_catalog.csv` — is now their **primary recommended source**. Do not
assume; their own docs may have superseded one with the other. If both are
live, ask which one they intend as canonical before building against either.

**Their `PRODUCT_ENGINE_SYNC_FIELD_PLAN.md` already reflects our correction**
— it correctly treats `category_group`/`category_type` as SKU-derived and
`classification` as legacy/advisory only. No further correction needed
there; just confirm on read that it still says this.

## 2. Current state on our side (verified 2026-07-29, re-run before trusting)

```
SELECT COUNT(*) FROM products;   -- 11,934 total
```

Populated counts for the columns this sync would fill:

| Column | Populated | % |
|---|---|---|
| `country` | 11,904 / 11,934 | 99.7% |
| `brand` | 11,832 / 11,934 | 99.1% |
| `food_matching` | 11,404 / 11,934 | 95.6% |
| `region` | 10,532 / 11,934 | 88.3% |
| `variety` | 8,952 / 11,934 | 75.0% |
| `body` | 8,426 / 11,934 | 70.6% |
| `acidity` | 7,813 / 11,934 | 65.5% |
| `tannin` | 7,560 / 11,934 | 63.3% |
| `flavor_tags` | 6,842 / 11,934 | 57.3% |

`flavor_tags`, `tannin`, `acidity`, `body` are the biggest gaps and the
highest-value targets for library-sourced fill, in that order.

**Also note:** this repo's working tree currently has 6 uncommitted modified
files (`data/quality_control_*`, `data/country_description_library.csv`,
`data/onboard_preflight_report.md`, `scripts/refresh_live_export.py`,
`tests/critic_reviews/integration/test_critic_db_invariants.py`) and ~140
untracked files (mostly `.db` backups/logs), all unrelated to this sync and
predating this session. Don't commit over them; if they block a clean run of
`refresh_live_export.py`, stash them first and tell the user what you
stashed.

## 3. What to actually do this session — still NO WRITES

This is the same step 6 from the original prompt, restated because it never
ran:

1. Re-read `data_library_index.json` fresh (don't reuse cached knowledge —
   confirm it still indexes `reviews_reference_library.csv` and
   `producer_score_index.csv`, and check whether it now also indexes
   `wine_data/master_catalog.csv`).
2. Resolve the "which source is canonical" question from §1 above before
   picking one to reconcile against. If CODEX's own docs point to
   `master_catalog.csv` as superseding the `progress_outputs/` library, build
   the reconciliation against that instead — but re-derive the join key and
   field mapping from *its* actual columns; don't assume it's shaped like
   `reviews_reference_library.csv`.
3. Load the producer-level join source, filter to producers matching our
   catalog (`matches_live_brand == True` if using the old library; check the
   new one's equivalent flag/field if using `master_catalog.csv`), and
   reconcile against our catalog `brand` (normalize via their
   `producer_key()` — don't reimplement from prose, mirror the actual
   function).
4. Report back, **writing nothing**:
   - how many of our SKUs sit under a matched producer;
   - for those SKUs, which of the 5 gap columns in §2 above are empty in
     `products.db` — a real COUNT query, not an estimate;
   - where library evidence with `attribute_reliability==consistent` (or the
     new source's equivalent confidence marker) could fill those gaps;
   - any producer whose library region **contradicts** our catalog region —
     list individually; per `feedback_dont_infer_country_from_brand` each
     needs manufacturer verification before it lands, not just source
     agreement.
5. Propose a first batch as a **Rule-10 dry run**: show the diff, cite
   `source_file` + scale per field, map every field to its real `products`
   column name (use the corrections table in the original prompt §4 — those
   field-name mappings are unaffected by this update), and wait for sign-off
   before any DB write.

**Verification is not optional (Rules 1, 4, 6).** After any eventual bulk
write: `cp data/db/products.db data/db/products.db.bak-pre-<batch>` first;
run the write; then `scripts/refresh_live_export.py`; then a direct
`sqlite3` COUNT proving the target column is populated on the intended SKUs
AND that the value appears in `data/live_products_export.json`. Counting
matched rows or log lines is NOT verification. Every published field must
trace to a `source_file`/source row in the library.

Confirm you've read `SESSION_HANDOFF.md` + the other new CODEX root docs,
resolved which source layer is canonical, re-verified the row counts in
§1–§2 (don't trust the numbers printed here — re-run the queries), and
completed the read-only reconciliation report (step 4 above) before
proposing any batch.
