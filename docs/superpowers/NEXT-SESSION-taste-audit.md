# NEXT SESSION — Taste-Data Quality Audit (Phase B Run 2 prerequisite)

> Copy-paste the block below to kick off the next session.

---

Start the taste-data quality audit (Phase B Run 2 prerequisite). Read memory
`project_taste_data_quality_audit` first — it has the full scope and findings.

CONTEXT: Run 2 (taste display) is PAUSED. The blocker is that the taste columns
(smokiness/sweetness/body/variety) are systemically unreliable — populated from
5–12 different `enrichment_source`s each, NOT from the free rules. Patching display
keeps surfacing wrong facts on premium pages. So: audit the DATA first, build
display later. The parked v3 display design (sommelier-approved) is on branch
`docs/phase-b-run2-spec`.

THIS IS A FRESH BRAINSTORM→SPEC EFFORT. Use the brainstorming skill (HARD GATE:
no code/scripts until I approve a design). Don't jump to writing a correction
script — scope it with me first.

WHAT THE AUDIT MUST DO (per taste column: smokiness, sweetness, body, variety):
1. Sample rows grouped BY `enrichment_source`; measure an error rate per source.
2. Identify the systematic failure patterns already known (verify, don't assume):
   - smokiness: 4 Botanist Islay GINS tagged heavy; event ticket "ISLAY FC"
     (LWF0018HC, resolves group=Whisky so a naive whisky-gate won't drop it);
     Old Pulteney 1989 unpeated/wrong-region-cell; JW Black Label Islay Origin
     (blend). ~46 match name cues; 61–62 genuinely peated once Bowmore/Smokehead/
     Talisker/Ledaig (real peat, no name cue) are KEPT.
   - sweetness (194 'dry', ~66% wrong): "Dry Gin" (style name), sparkling
     "Extra Dry" (semantically INVERTED — sweeter than Brut), "Dry Creek
     Vineyard" (winery name), "Dry Orange/Curacao". Only ~27 true sake Karakuchi.
   - variety: 12 sources; WE SHIPPED THIS in Run 1 (PR #37). Spot-check that our
     Run-1 Haiku variety values are clean vs the legacy ones in the same column.
   - body: 5 sources, 4,819 rows — least suspect, but sample it.
3. Decide PER COLUMN: trust as-is / correct (source-agnostic correction script,
   group+type gated, explicit blocklist, --dry-run, backup — NOT a rules re-run,
   that fixes nothing) / re-enrich (paid, Rule-10 gated).

HARD CONSTRAINTS (CLAUDE.md): canonical DB = `data/db/products.db` (NOT root);
group≠type (dessert/fortified is a TYPE, all wine = group Wine; Rule 12 — use
`category_group`/`category_type`, never raw Magento `classification`); after any DB
write run `scripts/refresh_live_export.py` + browser-verify (Rules 1/7/9); any paid
re-enrich needs backup→canary→cost estimate→MY sign-off (Rule 10). The sommelier
verdict that still holds: peat = a whisky-only BADGE (suppress 'none'), sweetness
= category-scoped, never a 2-value scale on a premium page.

DELIVERABLE this session: an audit spec (`docs/superpowers/specs/`) with per-column
error rates + a trust/correct/re-enrich decision each. THEN we plan the fix.

---

## Session-start housekeeping (do before brainstorming)

- `git branch --show-current` — the checkout may be on a parallel session's branch
  (`fix/kai-country-vietnam-misclassification` at last close-out). Start the audit
  from a fresh worktree off `origin/main` (worktree-isolation memory), NOT that branch.
- The sibling note `docs/superpowers/NEXT-SESSION-enrichment-kickoff.md` may be STALE
  (it predates the Run 2 pause). Delete it if it still says "just run Run 2".
