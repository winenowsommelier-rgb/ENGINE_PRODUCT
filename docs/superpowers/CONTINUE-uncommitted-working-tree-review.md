# Continue: Uncommitted Working-Tree Review

## Status: mostly resolved 2026-08-28

Reviewed (via subagent, read-only) then acted on with sign-off, on branch
`feat/homepage-trade-copy-refresh`:

- **Committed** (`2d773be1`): `data/brand_lookup.json` +
  `data/live_products_export.json` regen (price/stock/popularity-sync
  timestamps only — verified no `margin_pct`/`b2b_margin_pct` present,
  same 11,934-SKU count both sides) + `scripts/enrich_liqueur_bitterness.py`
  (already-run 2026-06-30 work that was just missing from git — verified
  264/11,934 rows populated in both products.db and the export).
- **Committed** (`8f7a77db`): `scripts/add_image_captions.py`, after fixing
  a real bug found during review — `--dry-run` was still calling the Haiku
  API for every caption (only skipped the file write). Not yet run against
  the 63 posts that still carry attribution text; needs a canary pass
  before a full run (Rule 10).
- **Deleted**: `apps/catalog/app/blog/demo/` and `demo-blog-post.md` — both
  self-labeled "DEMO ONLY — remove before production" with a live debug
  banner, never meant to ship, both untracked so no history lost.
- Original file lists below were stale by the time of this pass — most of
  the "modified tracked"/"untracked" items (`country_description_library.csv`,
  `quality_control_*`, `producer_prestige.json`, several `scripts/*` and
  `tests/*`, `supabase/migrations/004_export_column_parity.sql`,
  `scripts/refresh_live_export*.py`, `scripts/sync_to_supabase.py`) had
  already landed via PRs #115/#117/#118 and via commit `47ba9cc7`/`2f4d54d0`
  before this pass started.
- **Still open / genuinely low-stakes, left untouched on purpose**:
  `data/brand_lookup_server.log`, `data/brand_lookup_sync.log`,
  `data/db/taxonomy.db` (0 bytes, unreferenced), `data/dossier_wine_key_audit.json`,
  `data/explore_geography_audit.json`/`.md`, `data/masterfile_filled_skus.json`,
  `data/onboard_preflight_report.json`,
  `data/live_products_export.json.conflict-backup-20260717-230047`, and the
  ~100+ `.backup-*`/`.db-shm`/`.db-wal` files (expected clutter, not a
  mystery — see ground rules below).
- **Also found and fixed mid-review**: an earlier commit in this same pass
  landed on the wrong branch (`docs/vintage-score-prompt-only` instead of
  `feat/homepage-trade-copy-refresh`) because the checkout had switched
  branches since session start. It was local-only (unpushed), so it was
  reset and re-applied on the correct branch — no shared history affected.

## Why this exists

As of 2026-08-22, the working tree on `feat/homepage-trade-copy-refresh` has
a large amount of uncommitted state that predates recent session work
(confirmed pre-existing — not caused by the Supabase sync fix or the
accounts/lists spec work done that session). Nobody has yet looked at
*what* this actually is or whether it's safe/ready to commit. This doc is
the prompt to do that investigation in a fresh session.

Branch itself is clean relative to origin (`git status --branch` shows no
ahead/behind) — this is purely working-tree (uncommitted) state, separate
from anything already pushed.

## What to do

Start with a READ-ONLY investigation (no staging, no committing, no
deleting) — use an Explore or general-purpose subagent so the main
session's context isn't burned on raw file contents. Then bring findings
back to the user before taking any action; do not commit anything without
explicit sign-off given CLAUDE.md's rule that any code touching
`products.db` or `data/live_products_export.json` is treated as a
payment-path operation.

### Modified tracked files (9) — `git diff` each one

- `data/brand_lookup.json`
- `data/country_description_library.csv`
- `data/live_products_export.json` — **high-stakes**: this is the file the
  live catalog UI actually reads (Rule 9). A diff here needs to be
  understood, not just committed blind.
- `data/onboard_preflight_report.md`
- `data/quality_control_issues.csv`
- `data/quality_control_report.md`
- `data/quality_control_summary.json`
- `scripts/refresh_live_export.py` — **high-stakes**: this is the script
  that produces the file above. A modified version of it means the export
  behavior itself may have changed.
- `tests/critic_reviews/integration/test_critic_db_invariants.py`

For each: is the diff a small/mechanical data refresh, or an in-progress
code change? Does it look complete and correct?

### Untracked new files of interest (ignore `.backup-*`/`.db-shm`/`.db-wal` noise)

- `apps/catalog/app/blog/demo/`
- `data/quarantine/`
- `data/taxonomy/producer_prestige.json`
- `demo-blog-post.md`
- `scripts/add_image_captions.py`
- `scripts/backfill_attr_provenance.py`
- `scripts/enrich_liqueur_bitterness.py`
- `scripts/extract_attrs_from_taste_profile.py`
- `scripts/extract_flavor_from_critic_notes.py`
- `scripts/harvest_producer_notes.py`
- `scripts/migrate_add_attribute_provenance.py`
- `scripts/migrate_add_vintage_year.py`
- `scripts/refresh_products_json.py`
- `tests/test_critic_flavor_provenance.py`
- `tests/test_vintage_year_parsing.py`

For each: what does it do, is it referenced/imported by any already-committed
code (so something depends on it) or does it look orphaned/experimental?

### For every item, classify

**SAFE to commit as-is**, **RISKY** (touches something sensitive, looks
like debug/test output, looks incomplete), or **UNCLEAR** (needs the user's
judgment) — with reasoning, not just a label.

### Then synthesize

Is this one coherent piece of finished work that should land in one commit,
several unrelated pieces of finished work that should be split into
separate commits, or a mix where some things are done and others are
half-finished/experimental and should NOT be committed yet? Be specific
about which files fall in which bucket.

## Ground rules

- Per CLAUDE.md: don't run any bulk paid-API operation, don't assume a
  script "did what it says" from its name alone — actually read it.
- If any of these scripts write to `products.db` or
  `data/live_products_export.json`, verify with a real query afterward if
  asked to run them (Rule 1/6/9) — don't just trust log output.
- There are ~100+ `.backup-*` files (mostly `data/db/products.db.backup-*`
  and `dossier.db.backup-*`) — these are known pre-flight/canary backups
  from many past sessions, not something to investigate individually. Don't
  spend time on those; they're expected clutter, not a mystery.
- Present findings to the user and get explicit direction before staging or
  committing anything — do not commit unilaterally even if everything looks
  "obviously fine."
