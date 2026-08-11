# Handoff: Curation Dossier Library — Phase 2 Readiness Test

## Phase 2 REAL RUN #1 — 20 wine_keys shipped (2026-07-21)

First real Phase 2 production batch, run after both canary gates (mechanism
test + GOLD EXEMPLAR sign-off) closed. Scope: 838 distinct wine_keys across
903 in-stock critic-scored SKUs (verified live count); 15 already covered by
Phase 1 + the two mechanism-test batches; **20 more done this run, 803
remaining**.

**Mechanism**: 5 subagents, 4 wine_keys each, no DB access, sequenced by
critic score descending (famous/well-documented first, per spec §8 "Plan
~40 SKUs per session... Sequence by expected source yield"). Each batch
independently citation-checked by a separate subagent before staging — this
step is now mandatory per batch, not optional, per the prior mechanism-test
finding.

**Yield: 51/60 core fields sourced (85.0%), 9/60 partial, 0/60 model.**
Materially higher than the 73.3%/66.7% mechanism-test yields, consistent
with this batch being famous/well-documented estates (Bordeaux first
growths, cult Amarone, etc.) rather than the deliberately-obscure mechanism-
test set. 4/20 wines carry no Thai pairing — each an explicit, reasoned
capsaicin/tannin-clash call (e.g. Cheval Blanc, Ducru-Beaucaillou, Dal Forno,
Lafleur), not a gap.

**Citation check caught real bugs in every single batch — 0/5 batches were
clean.** This confirms the mechanism-test finding: the check is load-bearing,
not a formality. Findings by batch, all fixed before staging:
- **Batch 1**: Casanova di Neri's expert_note said fermentation happens in
  oak — actually stainless steel (aging, not fermentation, is in oak).
  VIK's producer_history over-attributed the estate's hotel design to the
  same architect as the winery (different architects). Dominus's stated
  winery-completion year (1997) contradicted its own cited Wikipedia source
  (1996) — softened to "mid-to-late 1990s" rather than assert either.
- **Batch 2**: Château Palmer's producer_history contained a **fabricated
  ownership-consortium member — "Ghestem family" does not exist** in any
  source; real members are Ginestet/Miailhe/Mahler-Besse/Sichel. This was
  marked "sourced," the highest confidence tier — the most serious single
  finding across all 5 batches. Also fixed: Palmer's vineyard size (source
  says 66ha, draft said 55ha); a citation that contradicted rather than
  supported Figeac's blend-percentage claim (removed).
- **Batch 3**: La Landonne AND La Turque (Guigal's two "La La" wines) both
  contained an **identical fabricated claim, "Philippe joined in 1973"**
  — impossible, since Philippe Guigal was born in 1975. Same error, same
  "sourced" tag, copy-pasted across two independently-drafted dossiers in
  the same batch (the vineyard was replanted in 1975 to mark his birth —
  likely source of the model's confusion). Fixed to "joined early 1990s,
  winemaker from 1997" in both.
- **Batch 4**: Château L'Évangile's producer_history compressed two real
  events 60+ years apart (renaming ~1800, purchase 1862) into "purchased
  and renamed... that same year." Also omitted that DBR's 1990 purchase was
  a majority stake, with full ownership only completed in 1999. Cheval
  Blanc's blend-dominance claim stated as fixed fact when the actual bottled
  blend varies by vintage (2022 was Merlot-majority despite Cab-Franc-led
  vineyard planting) — softened with an explicit vintage-variance caveat.
- **Batch 5**: Bertani had three separate wrong numbers (Savoy emblem
  license year 1928→1923; first Amarone vintage compressed to a specific
  wrong year; appassimento duration overstated ~120 days vs. sourced ~78
  days; aging duration range overstated). Trotanoy's "second only to Petrus"
  ranking claim is actually contested by sources (one has Vieux Château
  Certan ranked above both) — softened to "top tier alongside." Angélus had
  its classification-founding year wrong by one (1954→1955) and described
  itself as "retaining status" through the 2022 classification when it
  actually withdrew from that review rather than being reassessed.

**Pattern across all 5 fabrication/error findings**: none were wrong-
producer citations (the failure mode the mechanism test worried about most)
— these were more subtle: compressed/conflated timelines, one invented
proper noun, contested rankings stated as settled fact, and specific
numbers drifting from what the actual cited source says. All would have
shipped as "sourced" (i.e., presented to users as verified fact) without
the independent check.

**Pipeline verification (Rule 1/6/9, same discipline as every prior run)**:
- `wine_key_for()` parity: 20/20 fresh-mint keys matched real SKU/name pairs
  from `products.db` before staging (0 typos this run, unlike Phase 2's
  first mechanism-test batch which caught one).
- Guarded upsert → `refresh_products_dossier.py` (62 products re-derived,
  15 prior + this run's 20 × their SKU counts) → `refresh_live_export.py`
  (11,934 products) → **direct query against `live_products_export.json`**
  confirmed all 20 representative SKUs show populated `curation_dossier`
  (20/20, not sampled) → `tests/test_dossier_db_invariants.py`: 7 passed,
  1 skipped (invariant 6 still vacuous, no `honors_json` data anywhere yet).
- Backup taken before write: `data/db/dossier.db.backup-pre-phase2-realbatch1-*`.

**Cost/shipped report (Rule 4)**: this batch ran in-session (Claude Code),
not paid API — marginal dollar cost ≈$0 per the spec's stated Phase 1/2
economics. Calls: 5 drafting subagents + 5 citation-check subagents = 10
agent calls for 20 wine_keys (2 calls/wine_key). Rows where user-facing
fields are actually populated: **20/20 confirmed via direct live-export
query**, not inferred from log lines or cache-row counts.

## Spot-check cadence — DEFINED 2026-07-21 (mandatory going forward)

Two consecutive real batches (this run + the earlier mechanism test) each
hit a genuine, ship-blocking error caught only by the independent citation
check — including one fabricated fact ("Ghestem family," Palmer) and one
fabricated date repeated across two dossiers ("Philippe joined in 1973,"
Guigal), both tagged "sourced." That error rate (~1 real bug per 4-wine
batch so far) means owner review can't be deferred to "eventually," the
way the original GOLD EXEMPLAR sign-off was — it needs a fixed, small,
recurring checkpoint baked into every batch from here on.

**The rule**: after every drafting batch (5 subagents × 4 wine_keys, or
whatever the batch shape is), before moving to the next batch, produce a
**spot-check packet**:
- Sample **1 wine per 4-wine drafting sub-batch**, chosen by a **fixed rule**
  (e.g. "position 1 of each sub-batch"), never hand-picked for cleanliness —
  a cherry-picked sample defeats the purpose.
- For each sampled wine: what the citation check found and fixed (or "found
  nothing" if genuinely clean — don't manufacture findings), plus 2-3 of its
  "sourced" claims specific enough that the owner could spot-check them
  personally in under a minute (a name, a date, a number — not vague
  tasting-note prose, which can't be fact-checked by inspection).
- Show this to the owner. Do not proceed to the next batch until it's been
  looked at. If something looks wrong, that batch's rows stay
  `review_status='unreviewed'` (already the default — nothing here has been
  marked `human-approved`, so nothing needs unwinding to fix it).
- This does NOT replace the mandatory per-batch independent citation-check
  subagent step (that still runs on all 20-40 wine_keys, every batch,
  no sampling) — it adds a lightweight owner-facing checkpoint on top,
  sized so it doesn't become the bottleneck the full GOLD EXEMPLAR review
  would be at this volume.

First packet under this rule: `spotcheck_packet_batch1.md` (scratchpad,
covers this run's 20 wine_keys) — samples `vik-millahue`,
`chateau-palmer-margaux` (the Ghestem fabrication), `e-guigal-cote-rotie-
la-landonne` (the Philippe-1973 fabrication), `bodega-aleanna-gran-
enemigo-gualtallary` (clean), `bertani-amarone-della-valpolicella-classico`
(3 wrong numbers, fixed). Deliberately includes both of this run's real
bugs, since the fixed sampling rule landed on them — a sign the rule
surfaces real problems rather than laundering them.

## Phase 2 REAL RUN #2 — 20 more wine_keys shipped (2026-07-21)

Second real batch, first one run under the new spot-check cadence. Same
mechanism: 5 sub-batches of 4, mandatory per-batch citation check, fixed
end-to-end verification. 55 wine_keys now done total (35 prior + 20 batch 1
+ 20 batch 2); **787 remain** of the 838-key scope.

**Yield: 56/60 core fields sourced (93.3%), 4/60 partial, 0/60 model** —
the highest of any batch so far. But yield and error rate are NOT the same
thing: **4 of the 5 sub-batches still had at least one real, citation-check-
caught error**; only one sub-batch (Ornellaia/Shafer/Taittinger/Henschke)
came back completely clean. 11 corrections applied in total:

- **Sub-batch 1**: Domaine Huet's producer_history named **Gaston Huet**
  as founder — the drafting agent's own notes show it had actually *seen*
  a source naming Victor Huet (Gaston's father) as founder and chose to
  write Gaston anyway ("majority framing"). Every source the citation
  check found credits Victor as founder, Gaston taking over only in 1937.
  **This is a new failure pattern, distinct from outright fabrication**:
  the model noticed conflicting source information and actively resolved
  it wrong, rather than fabricating from nothing. Also fixed: an
  unverifiable specific blend percentage and an unconfirmed family-member
  claim in the Peter Michael dossier.
- **Sub-batch 2**: Bélair-Monange's Moueix stake-acquisition date drifted
  (2007 stated vs. 2003 in its own cited source). Two Lynch-Bages dates
  were wrong (an invented "1966" takeover year with no supporting source;
  "2006" vs. the estate's own site's "2007"). **Most serious finding of
  this batch**: Château Péby Faugères had BOTH its founder's death year
  wrong (1998 → actually 25 Oct 1997) AND the cuvée's first vintage year
  wrong (2000 → actually 1998, the vintage immediately following his
  death) — in the exact wine where the drafting agent's own notes claimed
  it had "deliberately verified every fact against the Péby-specific
  source." Getting two chronologically-linked facts wrong in the wine
  flagged for extra care is a strong signal that self-reported diligence
  claims cannot be taken at face value.
- **Sub-batch 3**: No wrong facts, but the drafting agent's own justification
  for downgrading As Bravas Malbec to "partial" confidence cited a source
  conflict that, on independent check, doesn't actually exist between the
  two sources it named — the real (different) blend-ratio figure it was
  likely confusing belongs to a *different* As Bravas bottling entirely.
  The "partial" confidence level itself was still correct (a genuine
  altitude conflict independently justified it), but the stated reasoning
  was wrong. Fixed the note to reflect the real justification.
- **Sub-batch 4**: Clean. Notably included two deliberately hard cases —
  Ornellaia's artist-label theme (changes every vintage; citing the wrong
  year's theme was a real risk) and Henschke's family generation count
  (a real "4th vs 5th generation" conflict across sources) — both
  correctly resolved and independently confirmed correct.
- **Sub-batch 5**: Two minor imprecisions (Château Canon's "Fournier family
  held it for over a century" should be ~77 years; Tenuta Sette Ponti's
  founder's surname dropped "Cuseri" inconsistently, and cited a named
  viticulture consultant not actually supported by either source). **Also
  contained a deliberate test**: this sub-batch's prompt told the drafting
  agent Castello Romitorio was founded by singer-songwriter Francesco
  Guccini (false — real founder is painter Sandro Chia) and that Tenuta
  Sette Ponti's "Oreno" is a Merlot/Cabernet Sauvignon/Sangiovese blend
  (false — it's Merlot/Cabernet Sauvignon/Petit Verdot, no Sangiovese).
  **The drafting agent correctly researched and corrected both rather than
  repeating the wrong prompt, and the independent citation check confirmed
  both corrections were right** — good evidence the verification discipline
  is real rather than pattern-matching on in-prompt warnings.

**Pipeline verification**: wine_key parity 20/20 (0 typos), guarded upsert
→ `refresh_products_dossier.py` (87 products re-derived) →
`refresh_live_export.py` (11,934 products) → direct live-export query
confirmed 20/20 representative SKUs populated → invariant suite: 7 passed,
1 skipped (unchanged). Backup: `dossier.db.backup-pre-phase2-realbatch2-*`.

**Spot-check packet**: `spotcheck_packet_batch2.md` (scratchpad), same
fixed-position sampling rule as batch 1. Shown to and reviewed per the
cadence defined above before batch 3 starts.

**Running totals across both real batches**: 21 individual corrections
across 40 wine_keys (roughly 1 per 2 wine_keys) — none were caught by the
drafting agent's own self-review; all were caught by the independent
citation-check subagent. Zero exceptions to "run the check every batch."

**Next real batch**: continue down the critic-score-ranked remaining-787
list, same batch shape (5×4), same mandatory per-batch citation check,
plus a spot-check packet before starting batch 4. Scripts/data to
reuse: `data/lib/dossier/wine_key.py` for parity checks, the `stage.py`
guarded-upsert pattern in this run's scratchpad (not committed — recreate
from this handoff's staging code shape if the scratchpad is gone).


## North star (the actual goal, don't lose this)

The user wants the curation dossier library to become a **trustworthy virtual
team of professional sommeliers and product experts** — content that lets the
site suggest and explain wine/spirits picks to **both B2C and B2B users** with
the credibility of a real expert, not generic marketing copy. Every mechanical
step below (yield %, batch size, citation checks) exists to serve that bar:
would a real sommelier be comfortable putting their name on this recommendation?
Keep decisions anchored to that, not just to pipeline throughput.

Spec: `docs/superpowers/specs/2026-07-15-curation-dossier-library-design.md`

## Where things stand

**Phase 1 canary (10 wine_keys) — COMPLETE.** All 10 were deliberately the
most famous wines in the catalog (Château Margaux, Lafite, Sassicaia, Masseto,
Opus One, Penfolds Grange, Vega Sicilia Valbuena 5, Dom Pérignon, Veuve
Clicquot Yellow Label, Louis Roederer Cristal), drafted by me directly
(single-threaded, full context) in-session, to prove the mechanics work before
spending real effort:
- DB write → `refresh_products_dossier.py` → `refresh_live_export.py` →
  invariant suite → live export re-query, all verified end to end.
- `tests/test_dossier_db_invariants.py`: 7 passed, 1 skipped (invariant 6,
  vacuous — no `honors_json` data yet).
- Citation spot-check (independent subagent) and Thai `dish_local`
  spot-check (independent subagent, since I'm not a Thai speaker) both run.
  Thai check caught one real bug: Sassicaia's English pairing gloss
  ("Grilled beef skewers, moo yang style") didn't match its own Thai text
  เนื้อย่าง (grilled, not skewered; "moo yang" literally names a pork dish).
  Fixed the English to "Neua yang (Thai grilled beef, no chili marinade)" —
  traced through dossier.db → derive script → export → invariants → live
  export re-verification for all 3 affected in-stock SKUs.
- Yield measurement: **30/30 core fields (100%) came back `sourced`**,
  flat across all 10 draft positions (no thinning at all).

**This 100% number is not usable for Phase 2 planning as-is** — flagged
explicitly, not glossed over:
1. Selection bias: these 10 were cherry-picked as the most-documented wines
   in the entire ~988-wine_key catalog. The spec's own recon baseline
   (**60% found-rate / 36% sparse-or-none**) was presumably measured on a
   representative sample, not famous wines. 100% here tells us little about
   typical wines.
2. No real batch-thinning test: Phase 1 was drafted by me in one continuous
   session with full context, not through the actual Phase 2 mechanism (a
   subagent independently taking a batch of 3-5 wine_keys, doing its own
   search→fetch→synthesize, returning JSON to me as sole DB writer — I never
   touch the DB directly in real Phase 2). The spec explicitly warns "later
   wines in a batch get systematically thinner sourcing" and says this must
   be **measured, not assumed**, since it sets the Phase 2 batch size.

## Phase 2 mechanism test — COMPLETE (2026-07-21)

Ran the real Phase 2 mechanism exactly as specified below: one subagent,
one batch of 5, no direct DB access, JSON handed back to me as sole writer.

**Result — honest yield: 11/15 core fields (73.3%) sourced**, well below
Phase 1's 100% (as expected, since Phase 1 was famous-wine selection bias)
and closer to, but still above, the spec's 60%/36% recon baseline. Per-item
breakdown (order = batch position):
1. `catena-zapata-catena-alta-melbec`: 2/3 sourced (after correction, see below)
2. `louis-jadot-volnay`: 2/3 sourced (own honest "partial" hedge held up)
3. `sartori-di-verona-regolo-...`: 3/3 sourced
4. `talisker-18-years-700-ml`: 3/3 sourced — cleanest of all 5, zero issues found
5. `chiyomusubi-junmai-goriki-60-1-8-l`: 1/3 sourced — the deliberately-hardest
   case behaved as predicted; drafting subagent correctly self-rated
   `expert_note` as "model" confidence rather than inflating it

**Batch-position thinning: NOT confirmed as a smooth effect.** Position 5
(sake) is the thinnest, but that tracks with subject difficulty (least
English-language web presence), not position per se — position 2 (Volnay)
also dipped to 2/3 while position 3 (Sartori, later in the batch) came back
3/3. One batch of 5 is not enough data to fully separate "position" from
"subject difficulty" as causes; if this matters for setting batch size,
it needs a same-position-different-subject or same-subject-different-position
control, not assumed from this run alone.

**Independent citation + Thai spot-check (separate subagent) caught 3 real
issues — all fixed, verified end-to-end (DB → derive → export → invariants
→ direct export re-query), same discipline as the Sassicaia fix:**
1. Catena Alta: the "sourced" citation for `expert_note`
   (catenazapata.com/catena-malbec-2023) actually described a *different*,
   entry-level Catena bottling, not Catena Alta — a wrong-product citation
   propping up an unconfirmed "18mo/high-new-oak" claim. Removed the claim
   and the bad citation, downgraded `expert_note` confidence from
   "sourced" to "partial".
2. Sartori Regolo: the drafting agent's own `_notes` hedge ("this SKU might
   not be the same wine as the Falstaff-reviewed Classico Superiore
   variant") was itself likely backwards — every source checked shows
   Regolo is always Classico Superiore; corrected the note rather than
   leaving a wrong self-doubt in place.
3. **Real Thai gloss/script mismatch, same bug class as Sassicaia**:
   Chiyomusubi's Thai pairing was labeled "Neua yang (Thai grilled beef
   salad)" over เนื้อย่าง — but เนื้อย่าง literally just means "grilled beef,"
   not a salad (the actual salad dish would be ยำเนื้อย่าง or เนื้อย่างน้ำตก,
   neither of which was in `dish_local`). Fixed English to "Neua yang (Thai
   grilled beef, plain)" to match the Thai exactly, same pattern as the
   Sassicaia correction. Notably, the drafting subagent's own `_notes` had
   already flagged extra uncertainty on this exact field ("less certain...
   extra scrutiny recommended") — its self-doubt was well-calibrated.

Validator pass (banned marketing phrases, price/investment language) was
run against every field before AND after the corrections — one banned-
phrase false-positive-but-still-fixed hit ("notes of" used literally as
tasting language in Catena's expert_note, reworded to "tones of" rather
than relying on a judgment call).

**wine_key normalizer parity: 5/5 fresh-mint matches** — computing
`wine_key_for(sku, name)` for all 5 real SKUs reproduced the subagent's
wine_keys exactly (one typo was caught and corrected before staging:
subagent returned `chiyomusudi-...` instead of `chiyomusubi-...` for item 5).

Full raw batch (post-correction) and staging script are in
`/private/tmp/.../scratchpad/canary_phase2/batch.json` and `stage.py` —
scratchpad, not committed; if this needs to survive past the session,
copy it into the repo first.

**What this means for Phase 2 go/no-go:**
- 73.3% yield is workable but confirms real (non-famous) wines source
  noticeably worse than icons — budget for a meaningful "partial"/"model"
  tail at scale, not near-100%.
- The citation-check step is NOT optional — it caught 2 sourcing
  correctness bugs and 1 real user-facing language bug in a batch of just
  5. At Phase 2 scale this step must be built into the pipeline, not run
  ad hoc per-batch by a human.
- Position-based batch-size thinning is still an open question — don't
  set batch size off this run alone (see caveat above).

## Immediate next step (was about to execute when this session ended)

Run a **second, harder canary**: 5 non-famous wine_keys, drafted through the
**real Phase-2 mechanism** (one subagent, one batch of 5, no direct DB
access — returns JSON, I validate/stage/guarded-upsert), to get an honest
read on (a) real-world sourcing yield vs. the 60%/36% baseline and (b)
whether batch position causes real quality thinning.

**5 wine_keys already selected** (stratified across categories, deliberately
avoiding Phase 1's all-famous-icon bias):
1. `catena-zapata-catena-alta-melbec` — Argentina, Mendoza. Known producer,
   mid-tier bottling (not their icon wine).
2. `louis-jadot-volnay` — France, Burgundy. Négociant appellation wine, no
   named vineyard/cru — tests whether generic appellation wines source worse
   than named single-vineyard icons.
3. `sartori-di-verona-regolo-valpolicella-ripasso-superiore-doc` — Italy,
   Veneto. Smaller producer, ordinary shelf wine — genuinely typical case.
4. `talisker-18-years-700-ml` — Scotland. Known distillery, non-flagship
   age statement — tests whisky as a distinct content domain from wine.
5. `chiyomusubi-junmai-goriki-60-1-8-l` — Japan, sake. Small regional
   producer, expected minimal English-language web presence — deliberately
   the hardest case in the set, to stress-test the low end of the yield
   distribution.

**To do next session:**
1. Dispatch ONE subagent (general-purpose or a dedicated dossier-drafter
   type) with all 5 wine_keys as a single batch — this must mirror the real
   Phase 2 mechanism, not repeat Phase 1's single-threaded-me approach.
   Subagent does NOT touch `dossier.db` or `products.db` directly; it
   returns structured JSON (same schema as the 10 canary dossiers in
   `/private/tmp/.../scratchpad/canary/*.json` from Phase 1, if that
   scratchpad still exists — otherwise rebuild the schema from
   `wine_dossier` table columns: `style_summary`, `expert_note`,
   `producer_history`, `signature_pairings_json`, `provenance_json`).
2. I (orchestrator) validate the JSON, stage it, apply via the guarded
   upsert pattern (`WHERE review_status != 'human-approved'`), run
   `refresh_products_dossier.py` → `refresh_live_export.py` → invariant
   suite → direct export re-query (Rule 1/Rule 9 discipline, same as the
   Sassicaia fix).
3. Independent citation spot-check + Thai dish_local check (if any Thai
   pairings appear) via separate subagent(s), same pattern as Phase 1.
4. Measure and report, honestly caveated:
   - Sourced-field yield vs. 60%/36% baseline — near 60% validates the
     baseline; near 100% again would mean the baseline itself needs
     re-examination; well below 60% flags a drafting-quality problem to fix
     before scaling.
   - Per-position yield (position 1 vs. position 5 in this one real batch)
     — confirms or refutes the "later items thinner" hypothesis with actual
     batched-subagent data, which is what should set the Phase 2 batch size
     per the spec (not assumption).
5. Only after both data points are in hand: make the Phase 2 go/no-go and
   batch-size call, and only then request the owner's GOLD EXEMPLAR sign-off
   on 3-5 of the Phase 1 dossiers ("reads as one sommelier's voice across
   all 10" — spec-named pass/fail criterion, still outstanding).

## GOLD EXEMPLAR sign-off — PASSED (2026-07-21)

Owner reviewed all 10 Phase 1 dossiers side-by-side (style_summary → expert_note
→ producer_history → pairings → provenance, laid out for a voice-consistency
read) against the spec's named pass/fail bar — "reads as one sommelier's voice
across all 10." Verdict: **pass, no notes** ("I think the quality are all ok").
This was the one canary exit criterion that could not be self-certified; it's
now cleared.

## Batch-position control test — RESOLVED, reverses the earlier conclusion (2026-07-21)

Ran the exact same 5 wine_keys from the Phase 2 mechanism test again, through
a fresh subagent, in **reversed order** (Chiyomusubi/Talisker/Sartori/Jadot/
Catena instead of Catena/Jadot/Sartori/Talisker/Chiyomusubi). Same no-DB-access,
JSON-only mechanism; same citation spot-check discipline applied afterward.

**Raw (self-reported) result looked like a clean position effect**: Chiyomusubi
(the sake) went from 1/3 sourced at position 5 last time to 3/3 sourced at
position 1 this time — a complete flip that looked like strong evidence for
"position causes thinning, not subject difficulty."

**That result did not survive the citation check.** The independent spot-check
found the position-1 Chiyomusubi's "sourced" upgrade was **mostly inflated
labeling, not real improvement**: one citation was a dead/password-gated page,
and the expert_note's claim that Goriki rice was revived through "the
brewery's own cultivation efforts" was contradicted by independent sources —
the revival was a multi-brewery, multi-institution collaborative effort
(Chiyomusubi was a founding participant and first to commercialize it, which
*is* a real, citable claim, but is a narrower claim than the drafted text
made). Separately, the same run's Catena Alta entry repeated the **exact same
mis-citation bug from the original batch**: a "sourced" style_summary citing
a James Suckling review that is confirmed to be for a *different* sibling
wine ("Angelica Zapata Alta," not "Catena Alta").

After applying the same corrections used on the original batch (downgrade
unsupported/mis-cited fields, don't take self-reported confidence at face
value), **the corrected yield is 10/15 (66.7%) for the reversed batch vs.
11/15 (73.3%) for the original** — nearly flat, and the per-wine position
pattern does not repeat in either direction once corrected. Chiyomusubi is
1/3 in BOTH orderings after correction.

**Conclusion: batch position is NOT a confirmed driver of sourcing thinness.**
What actually varies is (a) genuine subject difficulty (obscure producers/
sake still source worse, consistently, regardless of position) and (b) how
carefully the drafting subagent self-labels confidence on a given pass — which
appears to vary run-to-run for reasons unrelated to position (this run's
subagent was, if anything, LESS careful early in the batch, the opposite of
the "later items get sloppier" hypothesis). **This means the independent
citation-check step is not a nice-to-have QA layer — it is load-bearing for
Phase 2's core accuracy claims**, since self-reported "sourced" labels were
wrong or overstated in both test batches, at different positions, for
different reasons (wrong-product citations, dead links, overstated
attribution). Do not ship a Phase 2 pipeline that trusts confidence labels
without this check.

**Batch-size implication**: no evidence found that smaller batches reduce
thinning (since thinning wasn't shown to be position-driven at all). 3-5
wine_keys/subagent per the spec's original reasoning (context/token limits,
not quality decay) remains a fine default — just don't expect batch-size
tuning alone to fix yield. The lever that actually matters is the citation
check, every batch, no exceptions.

## Phase 2 REAL RUN #3 — 20 more wine_keys shipped, first content-thinness flag (2026-07-22)

Third real batch. Same mechanism (5×4, mandatory per-batch citation check,
fixed spot-check sampling), but this run surfaced two things worth flagging
prominently rather than folding quietly into the usual per-batch summary.

**75 wine_keys done total (55 prior + 20 this batch); 763 remain** of 838.

**A real pipeline bug caught by this run's own verification (not the
citation check) — first live-export re-query came back 0/20, not 20/20.**
Root cause: staging wrote to `wine_dossier` but never touched
`sku_dossier_overlay`, the actual SKU→wine_key join table
`refresh_products_dossier.py` reads to know which SKUs get a derived
`curation_dossier` at all. Backfilled the 27 in-stock SKUs across these 20
wine_keys into the overlay table, re-ran the pipeline, re-queried — this is
exactly the failure Rule 1 exists to catch (a "looks done" state a direct
query proved false). Separately found and fixed: none of this batch's
`signature_pairings` entries carried the per-pairing `"confidence"` key
Phase 1's schema used (`"pairing-theory"`), so pairings gated out of the
public export for all 20 wines until patched. **Lesson for batch 4+: verify
the direct live-export query BEFORE writing the spot-check packet, every
time — do not assume the guarded-upsert pattern alone is sufficient just
because it worked in batches 1-2.**

**Yield dropped sharply after correction: 18/60 core fields sourced (30.0%),
31/60 partial, 11/60 model** — well below batch 1 (85.0%) and batch 2
(93.3%). This is NOT a sign the drafting agents did worse research; it's a
downstream consequence of the citation check finding confidence-inflation
issues on nearly every "sourced" claim it touched this batch and correctly
downgrading them. **Concrete user-facing consequence: 7 of the 20 wines
(Beaulieu Georges de Latour, Fonterutoli Siepi, Yquem "Y", La Conseillante,
Montrose, Pichon Comtesse de Lalande, Dom Pérignon P2) now ship with ONLY
`signature_pairings` visible — no expert_note/producer_history/style_summary
at all** — because every text field on those seven got corrected to
"partial"/"model" and the consumer gate only surfaces "sourced" text. The
gate is working as designed; this is a real content gap, not a bug. **Not
yet decided**: re-research these 7 to try to earn "sourced" confidence,
leave them as pairings-only, or add a UI treatment for "partial"-confidence
content. Flagged for the owner, not decided unilaterally — see spot-check
packet for the specific decision framing.

**Citation check findings, all fixed before staging (5/5 sub-batches had at
least one issue — continuing the unbroken "check finds something every
batch" pattern, though this batch's issues were mostly confidence inflation
rather than outright fabrication):**
- **Ata Rangi**: Phyll Pattie's join year was wrong (draft said 1986, the
  year she and Clive Paton *met*; her own cited source says she joined in
  1987) — same "compressed adjacent events into one date" bug shape as
  earlier batches, just lower-stakes subject matter.
- **Yquem "Y"** (most serious finding this batch): LVMH acquisition timeline
  was garbled — draft asserted "controlling stake in 1999... majority
  finalized mid-2000s," a date its own cited source never mentions. Source
  actually says ~half the shares in 1996, full control by 2004. Corrected.
- **Fonterutoli Siepi, Pichon Comtesse, Le Pupille Saffredi, Fontodi
  Flaccianello**: true facts marked "sourced" where the specific cited URL
  didn't actually contain the claim (citation-support inflation, not
  fabrication) — all downgraded to "partial."
- **Cos d'Estournel, d'Esclans The Pale**: specific numbers/dates (Merlot %,
  acquisition year) stated as settled fact when the draft's own sources
  disagreed with each other — reworded as ranges/hedges.
- **La Conseillante, Haut-Bailly, Vieille Julienne**: minor overstatements
  (generation count, "rival First Growths," case-count cherry-picked from a
  self-contradicting source) — trimmed or downgraded.
- **Two stress-test pairs deliberately included and BOTH passed clean**:
  Pichon Baron vs. Pichon Comtesse de Lalande (sibling estates split from
  one property in 1850 — no fact bled between them) and Leflaive
  Bâtard-Montrachet vs. Chevalier-Montrachet (sibling Grand Crus — terroir
  data correctly and distinctly assigned, no swap/duplication).

**Pipeline verification (Rule 1/6/9)**: wine_key parity 20/20 (0 typos) →
guarded upsert → overlay backfill (the fix above) → pairings-confidence
patch (the other fix above) → `refresh_products_dossier.py` (114 products
re-derived, up from 87) → `refresh_live_export.py` (11,934 products) →
direct live-export query confirmed 20/20 representative SKUs populated,
checked individually with field-level output, not sampled → invariant suite:
7 passed, 1 skipped (unchanged). Backups:
`dossier.db.backup-pre-phase2-realbatch3-20260721-192742` (before any
writes) and `dossier.db.backup-post-phase2-realbatch3-20260722-141350`
(after corrections + overlay fix).

**Spot-check packet**: `spotcheck_packet_batch3.md` (scratchpad) — samples
`antinori-solaia-igt` (clean), `castello-di-fonterutoli-siepi-toscana-igt`
(citation-mismatch fix), `chateau-d-yquem-y-bordeaux-blanc` (the LVMH
timeline fix, most serious this batch), `chateau-pichon-longueville-baron`
(clean, one of the stress-test pairs), `domaine-leflaive-batard-montrachet-
grand-cru` (clean, the other stress-test pair). Includes the full content-
thinness writeup above for owner review before batch 4 starts.

## Batch 3 thin-content follow-up — RESOLVED (2026-07-22)

Owner chose to re-research the 7 pairings-only wines rather than leave them
as-is or ship a UI treatment for partial content. Ran 4 fresh research
subagents (2 wines each, one solo) instructed to find sources that ACTUALLY
support each claim — not just re-word the same text — then ran a SECOND
independent citation check on the revised output (treating it exactly like
a new drafting batch, not trusting the re-research agents by default).

**The second check earned its keep**: it caught a real date-conflation bug
even in the "upgraded" content — Dom Pérignon P2's producer_history claimed
the Plénitude/P1-P2-P3 naming system "launched publicly around 2008," but
independent sources (Decanter's own headline, thedrinksbusiness.com dated
May 2014) converge on **2014** as the actual Oenothèque-to-Plénitude rebrand
year; 2008 was only ever a vintage year that received P2 treatment, not the
launch year of the naming system itself. Same failure shape as every prior
batch's worst bugs (a plausible-sounding date substituted for the real one)
— just resurfacing in supposedly-corrected content. Also caught: Beaulieu's
"cold fermentation for red wines" claim overreached its own citation (which
ties a cool fermentation room to WHITE wines only); La Conseillante's
"Leperche family" 1871-seller detail wasn't actually in the official site
that was cited for it; Château Montrose's producer_history was flagged as
genuinely single-sourced despite carrying a "sourced" label (Wikipedia has
zero relevant content, contrary to what would let a second source
corroborate). Yquem's revised 1999 timeline ("working majority") was
imprecise versus the actual ~64% figure found in Wine Spectator — corrected
to state the number directly rather than a vaguer paraphrase.

**Net result — batch 3 yield rose from 30.0% to 51.7% sourced** (31/60 core
fields now sourced, 20/60 partial, 9/60 model) after re-research and a second
correction pass. Still below batches 1-2 (85-93%), but all 7 previously
pairings-only wines now carry real text content:
- **Full house (style_summary + expert_note + producer_history all
  "sourced")**: Yquem "Y", Pichon Comtesse de Lalande.
- **Partial improvement (expert_note or style+expert_note sourced,
  producer_history correctly held at "partial")**: Beaulieu Georges de
  Latour, Fonterutoli Siepi, Montrose (all three have a genuine,
  irreducible sourcing gap — BV's own materials contradict themselves on
  the 1940/1941 release year, Fonterutoli's Merlot-planting year is
  disputed across independent sources, Montrose's producer_history is
  still effectively single-sourced), La Conseillante, Dom Pérignon P2.

Re-verified end-to-end after this second correction pass: guarded update
(7 wine_keys, `review_status != 'human-approved'` guard) →
`refresh_products_dossier.py` (114 products, unchanged count — same SKU
set, richer content) → `refresh_live_export.py` (11,934 products) → direct
live-export query confirmed all 7 wines now show additional fields beyond
`signature_pairings` (checked individually, field lists shown, not
sampled) → invariant suite: 7 passed, 1 skipped (unchanged). Backup:
`dossier.db.backup-post-thin7-reresearch-20260722-182659`.

**Lesson for future re-research passes**: don't skip the second independent
check just because the content already went through one round of
correction — "corrected once" is not the same as "verified." The riskiest
claims in this pass (a launch year, a percentage, a named seller) all
sounded MORE confident after re-research, which is exactly when a second
check matters most.

**Next real batch**: continue down the critic-score-ranked remaining-763
list, same batch shape (5×4), same mandatory per-batch citation check, plus
"verify direct live-export query before writing the spot-check packet" as
an explicit step in the batch checklist (this batch nearly shipped a false
"20/20 done" claim without it).

## Phase 2 REAL RUN #4 — 20 more wine_keys shipped, batch-3 overlay lesson applied cleanly (2026-07-22)

Fourth real batch. Same mechanism (5×4, mandatory per-batch citation check,
fixed spot-check sampling). **95 wine_keys done total (75 prior + 20 this
batch); 747 remain** of 838.

**The batch-3 overlay-table lesson held**: this batch's staging script
populated `sku_dossier_overlay` in the SAME script as the `wine_dossier`
upsert, rather than as a separate remembered step. Direct live-export
re-query came back 20/20 populated on the FIRST try — no repeat of batch
3's false "done" state. This confirms the fix needs to be structural
(same script, same transaction shape), not just a checklist reminder.

**Yield: 40/60 core fields sourced (66.7%), 17/60 partial, 3/60 model** —
back in the range of batches 1-2, well above batch 3's post-correction
51.7%. Only 1 of 20 wines (Morlet Cœur de Vallée) has both text fields at
"partial" rather than sourced, and it still ships a populated
style_summary plus pairings — no repeat of batch 3's "text-fields-zero,
pairings-only" problem for any wine this batch.

**Citation check found issues in all 5 sub-batches (4 batches running,
zero exceptions), but this batch's dominant failure mode was different
from batch 3's**: mostly **citation-integrity problems** (true facts
attached to citations that don't actually contain them) rather than
fabrication or garbled timelines, plus two specific date errors:
- **Massolino Vigna Rionda**: vineyard-acquisition years were wrong against
  the estate's OWN cited source (draft said 1985/1987; source says 1986/
  1990) — a real, specific error, not a citation gap. Also omitted a real
  family member (Paola Massolino) from the current generation.
- **Montes Purple Angel**: "Montes Alpha first released 1988" conflated the
  winery's founding year with the wine's actual first vintage (1987).
- **Poggio di Sotto**: maceration/aging numbers weren't in the cited
  source; worse, "University of Milan" contradicted the estate's own
  more-detailed cited source, which says University of **Florence**.
- **Te Mata Coleraine**: a real compressed-timeline bug — implied
  continuous Havelock-Hills sourcing since the wine's 1982 debut, but
  independent sources show Coleraine was a single-vineyard wine from a
  *different* site through 1988, only becoming a Havelock-Hills blend from
  1989 on. Same "true-today-false-at-the-start" shape as prior batches'
  worst bugs, caught before shipping this time.
- **Le Macchiole, Torbreck, VIK, Tignanello, Bibi Graetz, Castello di Ama
  Bellavista, Bertinga**: smaller citation-integrity or unsupported-detail
  issues (true facts wrongly attributed, or specific unconfirmed details
  inserted) — all corrected or downgraded to "partial," none fabricated.

**Two stress-test pairs deliberately included, both passed cleanly**:
Peter Michael's two single-vineyard Chardonnays (La Carrière/Ma Belle-
Fille — elevation/exposure/planting-year figures correctly and distinctly
assigned) and Castello di Ama's two Gran Selezione wines (San Lorenzo's
4-vineyard/Merlot-inclusive blend vs. Bellavista's single-vineyard/no-
Merlot blend — correctly distinct, no swap). The two Ornellaia artist-
label vintages (2022 "La Determinazione"/Tayou, 17th edition; 2020 "La
Proporzione"/Kosuth, 15th edition) also passed a specific edition-
arithmetic sanity check (15th→16th→17th across 2020→2021→2022, annual
since the program's 2006 start) — no theme/artist swap.

**Pipeline verification (Rule 1/6/9)**: wine_key parity 20/20 (0 typos) →
guarded upsert to `wine_dossier` AND `sku_dossier_overlay` in one script →
`refresh_products_dossier.py` (134 products, up from 114) →
`refresh_live_export.py` (11,934 products) → direct live-export query
confirmed 20/20 representative SKUs populated on the first re-query →
invariant suite: 7 passed, 1 skipped (unchanged). Backups:
`dossier.db.backup-pre-phase2-realbatch4-20260722-202956` and
`dossier.db.backup-post-phase2-realbatch4-20260722-205344`.

**Spot-check packet**: `spotcheck_packet_batch4.md` (scratchpad) — samples
`le-macchiole-paleo-rosso`, `penfolds-bin-707-cabernet-sauvignon`,
`renieri-brunello-di-montalcino-riserva-docg` (clean), `torbreck-the-
factor` (citation-integrity fix), `bertinga-volta-di-bertinga-tuscany-igt`
(citation-attribution fix).

**Next real batch**: continue down the critic-score-ranked remaining-747
list, same batch shape (5×4), same mandatory per-batch citation check. Keep
using the same-script overlay-population pattern from this batch as the
template — do not regress to staging `wine_dossier` alone.

## Phase 2 REAL RUN #5 — 20 more wine_keys shipped, best yield yet (2026-07-24)

Fifth real batch, mostly top-tier Bordeaux classified growths (Margaux,
Pauillac, Saint-Julien, Pomerol, Saint-Émilion, Pessac-Léognan) plus DAOU,
Dom Pérignon Rosé, Bonneau du Martray, Donnafugata, Guigal La Mouline,
Glaetzer, Haras de Pirque, John Duval. Same mechanism (5×4, mandatory
per-batch citation check, fixed spot-check sampling). **115 wine_keys done
total (95 prior + 20 this batch); 727 remain** of 838.

**The batch-4 overlay-in-same-script fix held for a third straight batch**:
direct live-export re-query came back 21/21 populated (21 in-stock SKUs
across the 20 wine_keys) on the FIRST try. wine_key parity and the
per-pairing `confidence` key (batch 3's other bug) were both verified
clean via script before staging.

**Yield: 43/60 core fields sourced (71.7%), 17/60 partial, 0/60 model** —
the best of all five real batches, and the first batch with ZERO fields
left at unsourced "model" confidence. No thin wines: every one of the 21
SKUs ships with at least 2 of 3 text fields plus pairings.

**Citation check found issues in all 5 sub-batches (5 batches running,
zero exceptions). This batch had more standalone factual errors than
batch 4's mostly-citation-integrity mix, including two real
fabrication/inversion bugs**:
- **Château Pavie-Macquin**: draft listed a phantom fourth owner — "Marie
  and Jacques Charpentier" is actually **one person**, Marie-Jacques
  Charpentier (hyphenated first name). Corrected.
- **Dom Pérignon Rosé**: a real factual INVERSION — draft claimed the wine
  is made via skin-contact/saignée and does NOT blend in still red wine,
  "unlike" other rosé Champagnes. Backwards: Dom Pérignon Rosé is
  specifically known for blending in a separately vinified still red
  Pinot Noir (up to ~27% of the Pinot Noir portion in some vintages).
  Rewrote to state the correct method.
- **Château Haut-Bages-Libéral**: Claire Villars-Lurton's estate-management
  takeover was dated to "1992" (when her parents died, prompting her
  broader entry into the family business) but she didn't take over THIS
  estate until **2000** — corrected.
- **Château Branaire-Ducru**: an invented-sounding precise date ("adopted
  the Branaire-Ducru name in 1857") wasn't backed by either cited source,
  and independent sources disagree (1857 vs. 1875) — rewrote to reflect
  genuine uncertainty instead of false precision.
- **E. Guigal La Mouline**: "nine vintages rated perfect, 1976–2005" was
  wrong on both the count AND the end-year — the cited source lists 11
  vintages spanning 1976–2010. Corrected to the verifiable list.
- **Domaine Bonneau du Martray**: DRC's Corton-Charlemagne lease was framed
  as starting "with the 2018 vintage," but the lease began November 2018
  with DRC's first actual harvest in 2019 — corrected.
- **Chateau Gazin, Grand-Puy-Lacoste, Hosanna, Kirwan, Pape Clément, Smith
  Haut Lafitte, La Gaffelière, Castello di Bossi**: citation-integrity
  fixes (true facts attributed to sources that don't actually contain
  them) — downgraded to "partial" and re-attributed where a correct
  source was found, none fabricated.
- **DAOU, Donnafugata Fragore, Glaetzer, Haras de Pirque, John Duval,
  Château d'Issan**: PASS clean (or upgraded on stronger independent
  confirmation).

**Pipeline verification (Rule 1/6/9)**: wine_key parity 20/20 (0 typos),
pairings-confidence key present on all pairing entries (both checked by
script pre-staging) → guarded upsert to `wine_dossier` (0 guarded-skips)
AND `sku_dossier_overlay` (21 SKUs) in one script →
`refresh_products_dossier.py` (155 products, up from 134) →
`refresh_live_export.py` (11,934 products) → direct live-export query
confirmed 21/21 representative SKUs populated on the first re-query →
invariant suite: 7 passed, 1 skipped (unchanged). Backups:
`dossier.db.backup-pre-phase2-realbatch5-20260724-125226` and
`dossier.db.backup-post-phase2-realbatch5-20260724-125429`.

**Spot-check packet**: `spotcheck_packet_batch5.md` (scratchpad) — samples
`castello-di-bossi-chianti-classico-riserva-berardo-docg`,
`chateau-gazin-pomerol`, `chateau-la-gaffeliere-saint-emilion` (all
citation-integrity fixes), `daou-soul-of-a-lion` (clean), `e-guigal-cote-
rotie-la-mouline` (real factual error, count+date wrong).

**Next real batch**: continue down the critic-score-ranked remaining-727
list, same batch shape (5×4), same mandatory per-batch citation check,
same same-script overlay-population pattern.

## Phase 2 REAL RUN #6 — 20 more wine_keys shipped, highest yield yet (2026-07-26)

Sixth real batch, a mix of Burgundy Grand Cru whites (two Corton-Charlemagnes
from Drouhin and Louis Latour), Piedmont Barolo, Napa icons (Larkmead,
Silver Oak, Robert Mondavi To Kalon), Australian icons (Penfolds RWT/
Yattarna, Torbreck Run Rig), Tuscan Super Tuscans (Luce, Orma, Biserno,
Matarocchio), Brunello (Massolino, San Filippo, Siro Pacenti ×2), Sicily
(Tasca d'Almerita), Margaret River (Leeuwin Estate), and Piper-Heidsieck
Champagne. Same mechanism (5×4, mandatory per-batch citation check, fixed
spot-check sampling). **135 wine_keys done total (115 prior + 20 this
batch); 703 remain** of 838 (scope re-confirmed at 838, not drifted).

**The batch-4 overlay-in-same-script fix held for a fourth straight batch**:
direct live-export re-query came back 22/22 populated (22 in-stock SKUs
across the 20 wine_keys) on the FIRST try. wine_key parity and the
per-pairing `confidence` key were both verified clean via script before
staging. Some individual fields showed as unpopulated at the per-field
level in the re-query output — traced to source and confirmed these are
`"partial"`-confidence fields correctly suppressed by the
`_PUBLIC_CONFIDENCE` gate, not a bug (the wine's `"sourced"` fields shipped
normally on the same SKU).

**Yield: 51/60 core fields sourced (85.0%), 9/60 partial, 0/60 model** —
the best of all six real batches (surpassing batch 5's 71.7%), and the
second consecutive batch with ZERO fields left at unsourced "model"
confidence.

**Citation check found issues in all 5 sub-batches (6 batches running,
zero exceptions). One finding stands out as more consequential than a
typical citation-integrity gap** — a case of a draft absorbing one party's
disputed marketing claim in an active dispute as if it were neutral fact:
- **Robert Mondavi To Kalon Reserve**: expert_note restated Constellation's
  DISPUTED claim that Mondavi's ~328-acre holding sits within Hamilton
  Crabb's historic 19th-century To Kalon parcel, as settled fact. The
  cited Wine Spectator source — the actual article about this controversy
  — states those acres descend from the separate "Stelling Extension" and
  were never part of Crabb's original parcel; this is live, contested
  litigation with Beckstoffer, not resolved fact. Rewrote to state this is
  genuine Mondavi estate fruit while accurately flagging the historical
  connection as disputed. Also fixed a planting-date error (Crabb began
  planting in the early-to-mid 1870s, not "the 1880s"; renamed the
  property "To Kalon" in 1886).
- **Siro Pacenti Pelagrilli**: real cross-bottling contamination — the
  style_summary's tasting descriptors didn't match the cited review of
  THIS bottling; they appear to have been pulled from the sibling Vecchie
  Vigne bottling instead. Rewrote to match the verified source.
- **Silver Oak Cabernet Sauvignon**: fabricated citation — expert_note
  claimed specific James Suckling (97) and Decanter (95) scores that
  appear in neither cited source. Removed/downgraded.
- **Massolino Barolo Vigna Rionda Riserva**: real generation/attribution
  error — draft credited the wrong generation (4th-gen cousins Franco and
  Roberto) with acquiring vineyard parcels actually acquired by their
  father's generation decades earlier. Corrected.
- **Torbreck Run Rig**: two real errors — the cited critic-score source
  actually contradicts the claimed "no lower than 95 points" floor (it
  shows 92 for the 2003 vintage), and the Viognier blend was overstated as
  "co-fermented at 95-98%" when Torbreck's own page states it's ADDED at
  roughly 1%. Both corrected.
- **Larkmead Solari**: stale-fact error — draft presented a winemaker who
  left the estate in 2021 as the CURRENT winemaker in present tense.
  Corrected to name the actual current winemaker (Avery Heelan).
- **Tenuta Guado al Tasso Matarocchio**: genealogy error — draft implied
  Piero Antinori was a contemporary in a 1930 marriage that was actually
  his parents'. Corrected.
- **Tenuta di Biserno**: fabricated blend detail removed (unsupported
  Sangiovese/Syrah claim); an internal cousin/nephew inconsistency fixed.
- **La Spinetta Barolo Campe, Piper-Heidsieck Rare Rosé, Penfolds RWT,
  Penfolds Yattarna, San Filippo DOCG**: citation-integrity fixes (wrong
  vintage-specific URLs, a wrong date, unsupported superlatives) — none
  fabricated.
- **Joseph Drouhin Corton-Charlemagne, Louis Latour Corton-Charlemagne,
  Luce della Vite, Orma, Leeuwin Estate, Tasca d'Almerita, Siro Pacenti
  Vecchie Vigne**: PASS clean or minor precision-only fixes.

**Pipeline verification (Rule 1/6/9)**: wine_key parity 20/20 (0 typos),
pairings-confidence key present on all 60 pairing entries (both checked by
script pre-staging) → guarded upsert to `wine_dossier` (0 guarded-skips)
AND `sku_dossier_overlay` (22 SKUs) in one script →
`refresh_products_dossier.py` (177 products, up from 155) →
`refresh_live_export.py` (11,934 products) → direct live-export query
confirmed 22/22 representative SKUs populated on the first re-query →
invariant suite: 7 passed, 1 skipped (unchanged). Backups:
`dossier.db.backup-pre-phase2-realbatch6-20260726-145602` and
`dossier.db.backup-post-phase2-realbatch6-20260726-145707`.

**Spot-check packet**: `spotcheck_packet_batch6.md` (scratchpad) — samples
`joseph-drouhin-corton-charlemagne-grand-cru` (clean),
`louis-latour-corton-charlemagne-grand-cru` (clean),
`penfolds-rwt-bin-798-shiraz` (unsupported-superlative fix),
`san-filippo-brunello-di-montalcino-docg` (citation-integrity fix, correctly
kept Le Lucère cru's acclaim distinct from this DOCG bottling),
`tasca-d-almerita-tascante-contrada-sciaranuova-vv` (citation-access
downgrade, facts confirmed correct).

**Next real batch**: continue down the critic-score-ranked remaining-703
list, same batch shape (5×4), same mandatory per-batch citation check,
same same-script overlay-population pattern.

## Phase 2 REAL RUN #7 — 20 more wine_keys shipped, content thinness recurred (2026-07-26)

Seventh real batch, heavily Bordeaux (Pomerol, Pauillac, Margaux, Pessac-Léognan,
Saint-Émilion) plus three Australians (Two Hands, Vasse Felix, Xanadu), two
Brancaia Super Tuscans, Castello di Bossi Girolamo and an André Clouet grower
Champagne. Same mechanism (5×4, mandatory per-batch citation check, fixed
spot-check sampling). **155 wine_keys in `wine_dossier` total; 151 of them in
scope; 687 remain** of 838.

**COUNT CORRECTION — prior runs' "remaining" arithmetic was off by 4.** Runs #1-#6
computed remaining as `838 − (wine_dossier row count)`. That undercounts, because
4 rows are the Phase 2 **mechanism-test** wines — `chiyomusubi-junmai-goriki-60-1-8-l`,
`louis-jadot-volnay`, `sartori-di-verona-regolo-...`, `talisker-18-years-700-ml` —
which are NOT in the in-stock critic-scored wine scope (they include a whisky and
a sake, deliberately chosen as stratified non-famous test cases). The correct
formula is `838 − |done ∩ scope|`. Batch 6 reported 703 remaining; the true figure
at that point was **707**. Not data loss — an arithmetic bug in the writeups. Use
the intersection form from here on; `scripts`-side selection already did.

**The batch-4 overlay-in-same-script fix held for a fifth straight batch**: direct
live-export re-query came back **26/26 populated on the FIRST try** (26 in-stock
SKUs across the 20 wine_keys — note Clerc Milon has 4, Le Clarence 3, Certan de
May 2). wine_key parity (26 SKU checks) and the per-pairing `confidence` key (60
pairing entries) were both verified clean by script before staging.

**Yield: 21/60 core fields sourced (35.0%), 39/60 partial, 0/60 model** — the
second-lowest of the seven real batches, above only batch 3's post-correction
30.0%. Drafters' self-labelled pre-check was 36/60 (60.0%); the independent check
removed 15 "sourced" labels net. **This is not evidence of worse drafting** — it
reflects this batch's auditors strictly applying "a claim is only 'sourced' if a
*fetched* URL states it," including against true-but-thinly-cited facts. Third
consecutive batch with ZERO fields at unsourced "model" confidence.

**⚠️ CONTENT THINNESS RECURRED — 7 of 20 wines ship pairings-only**, exactly the
batch-3 pattern (coincidentally also 7). No text field survives the `"sourced"`
export gate for: **Baron de Brane, André Clouet 'Un Jour de 1911', Brane-Cantenac,
Certan de May, La Mission Haut-Brion, Pétrus, Quintus.** Text-field distribution:
0 fields → 7 wines, 1 → 7, 2 → 4, 3 → 2. That **Château Pétrus** shows customers
nothing but three food pairings is the sharpest illustration. The gate is working
as designed; this is a real content gap, not a bug. **Owner decision pending
before batch 8** — same three options as batch 3 (re-research / leave as-is / UI
treatment for partial content). Recommendation in the spot-check packet is
re-research, with the batch-3 lesson attached: the second pass needs its OWN
independent citation check, since "corrected once" ≠ "verified."

**Citation check found real defects in all 5 sub-batches — 20/20 dossiers required
corrections, 60 applied (7 batches running, zero exceptions).** Highlights:
- **Château Certan de May — most serious finding: the history was INVERTED.** Draft
  said the medieval fief of Certan was "broken up after the French Revolution" into
  three estates. Actually **Vieux Château Certan was created by an 1858 SALE** to
  Paris banker Charles de Bousquet; the Revolution left the de Mays a parcel then
  called *Petit-Certan*, which became Certan de May. The draft compressed two events
  decades apart AND misattributed the origin of a neighbouring estate inside this
  dossier. The drafter's note claiming "both sources independently confirm the
  three-way split" was false — one source contradicts it.
- **TWO cases of "suspected the problem, then resolved it the wrong way"** — now a
  named recurring failure mode (batch 2's Domaine Huet was the first). (a) **Xanadu
  Reserve**: drafter found a retailer stating the Reserve is 100% Lagan Estate fruit,
  *distrusted it*, and described two vineyards — the retailer was right; the draft
  implied a dual-vineyard blend that does not exist. (b) **Pontet-Canet**: drafter
  flagged 1725/1750 as coming only from search snippets, then published them anyway.
  The estate's OWN history gives **1705 / 1757 / 1781**; the cited source has no
  years at all and attributes the Canet purchase to Pontet's *descendants*.
- **Château de Fieuzal — broken ownership chain**: the **Griffon family** sat between
  the de Fieuzals and the Ricards, and it was Griffon who sold in 1851, to Abel
  Ricard. Both oak numbers also wrong (draft "half new, 12-18 months" vs source
  "35-50% new, 16-24 months"). Notably, material the drafter OMITTED as
  unreconcilable (post-WWII Erik Bocké) turned out not to conflict — over-caution
  left the history incomplete; now folded in.
- **Two Hands — NEITHER cited URL supported ANY claim** in `producer_history` (one
  was a typo'd path, `sercretblockshiraz`). Re-sourced page both verified the facts
  and corrected one: Marananga dates from **2002**, not the 1999 founding. Also a
  real misreading: "18 months in 30% French oak puncheons" is a VESSEL proportion,
  which the draft turned into "(30% new)" oak.
- **Baron de Brane — a genuine grand-vin leak** (the exact guarded risk): "aged in
  barrel in the same manner as the grand vin" is false — ~12 months/~20% new vs the
  grand vin's ~18 months/60-70%. Also "formerly bottled as Château Notton" is wrong:
  Notton is STILL a separate current label and the 13ha plot belongs to it.
- **Brancaia Ilatraia — FABRICATION**: "farmed without irrigation" appears in no
  source, and it was load-bearing for a second fabricated sentence in `expert_note`.
  Its soil citation was also a DEAD link (HTTP 521), and the re-sourced producer page
  corrected the soil to sandy loam, not "decomposed sandstone."
- **Brancaia Il Blu — both vintage ranges wrong, an entire era missing**: real ranges
  are 2001-2012, **2013-2017 (70/25/5, omitted entirely)**, 2018-2022. The draft's
  "2016" start for the 80/10/10 era is flatly wrong — 2016 sits in the 70/25/5 era.
  Also a quote-integrity fix on a Monica Larner line.
- **Pétrus — internal contradiction**: draft had Jean-Claude Berrouet working "until
  his retirement in 2008" AND Olivier taking over "from the 2008 vintage" — mutually
  exclusive, and inconsistent with the sources' "45 vintages." Loubat's sole-ownership
  date is genuinely contested (1929 vs 1945) and was silently resolved.
- **Castello di Bossi — a tech-sheet template artefact**: draft claimed 20,000 bottles
  "is the estate's entire stated production," conflating the wine-level field with a
  producer-block field that coincidentally shares the value. A 370-acre multi-label
  estate cannot total 20,000 bottles.
- **La Mission Haut-Brion**: La Tour Haut-Brion was NOT folded into La Mission from
  2006 — its fruit goes into **La Chapelle**, the second wine.
- **Stale-fact bug of the batch-6 Larkmead shape recurred**: Certan de May presented
  Michel Rolland as a current consultant; his involvement **ended in 2012**
  (Jean-Claude Berrouet since 2013).

**Auditors corrected in BOTH directions — evidence of source-reading, not
hedge-pattern-matching.** **Vasse Felix was UPGRADED** partial→sourced: the drafter
downgraded the eleven-trophies claim reasoning it was "the producer's own assertion,"
which is not the test — it is verbatim on the fetched page and already attributed
in-text. Two Hands' and La Fleur-Pétrus' `producer_history` were also upgraded after
re-citation. The Coleridge naming that Xanadu's drafter called "least certain" is
among the best-supported facts in that dossier.

**The La Fleur-Pétrus 1950-vs-1953 conflict is ADJUDICATED — 1950 is correct.** The
secondary source's 1953 is exactly the cross-contamination the drafter suspected: it
is **Trotanoy's** acquisition year in Moueix's own timeline (1950 La Fleur-Pétrus →
1952 Magdelaine → 1953 Trotanoy). Wikipedia, independent of Moueix, confirms 1950.
Upgraded to sourced.

**Three deliberate omissions reviewed and UPHELD** — do not reinsert: (1) André
Clouet's "1911" name refers to found Belle Époque bottles, NOT the April 1911
Champagne revolt (producer makes no such claim); (2) André Clouet's lees ageing has
irreconcilable sources (6 vs 12 vs 16 years) — the vague phrasing must stand, no
number may be inserted downstream; (3) Quintus carries only base Saint-Émilion Grand
Cru despite all three constituent estates having held Grand Cru Classé — adding a
rank would introduce an error. **Compliance check on Pétrus came back clean** (no
price/rarity/collectibility/investment language in any field).

**Three stress-test pairs deliberately planted, all handled correctly at drafting
time**: Brancaia Ilatraia vs Il Blu (same producer, different wines — no bleed),
Certan de May vs Vieux Château Certan/Certan-Giraud and La Fleur-Pétrus vs
Pétrus/Lafleur (routinely conflated estates — no attribute imported), and the two
second wines Baron de Brane and Le Clarence. The second-wine guard **split**: Le
Clarence held the line cleanly, Baron de Brane leaked the grand vin's oak regime —
the guard works but is not self-enforcing.

**Pipeline verification (Rule 1/6/9)**: wine_key parity 26/26 SKU checks (0 typos),
pairings-`confidence` key present on all 60 pairing entries, banned-language scan
clean (all checked by script pre-staging) → guarded upsert to `wine_dossier` (20
upserted, 0 guarded-skips) AND `sku_dossier_overlay` (26 SKUs) in one transaction →
`refresh_products_dossier.py` (**203 products**, up from 177) →
`refresh_live_export.py` (11,934 products) → direct live-export query confirmed
**26/26** SKUs populated on the first re-query, with per-SKU field lists shown →
invariant suite: **7 passed, 1 skipped** (unchanged). Backups:
`dossier.db.backup-pre-phase2-realbatch7-20260726-154041` and
`dossier.db.backup-post-phase2-realbatch7-20260726-154242`.

**Spot-check packet**: `spotcheck_packet_batch7.md` (scratchpad) — samples
`two-hands-secret-block-shiraz-barossa` (unsupported citations + oak misreading),
`brancaia-ilatraia-igt-rosso-toscana` (the fabrication + dead link),
`chateau-bourgneuf-pomerol` (mildest; date-separation adjudicated in the drafter's
favour), `chateau-de-fieuzal` (broken ownership chain),
`chateau-la-mission-haut-brion-grand-cru-classe` (second-wine misdirection). The
fixed position-1 rule again landed on two of the batch's most serious findings.
Full per-sub-batch audit notes are in `scratchpad/audit/sub{1..5}_findings.md`.

**Next real batch**: resolve the 7-wine thinness decision FIRST, then continue down
the critic-score-ranked remaining-687 list, same batch shape (5×4), same mandatory
per-batch citation check, same same-script overlay-population pattern. Use the
`|done ∩ scope|` count form, not `838 − row count`.

## Phase 2 REAL RUN #8 — 20 more wine_keys, best yield yet but for a cautionary reason (2026-07-27)

Eighth real batch, the most geographically spread so far: two Margaux (Rauzan-Ségla,
Siran), two Cordero di Montezemolo single-vineyard Barolos, two Henschke Eden Valley,
two Joseph Phelps Freestone, two second wines (Le Petit Mouton, Le Dragon de Quintus),
plus Dana Estates, Domaine Giraud, Donnafugata, Errázuriz, Giuseppe Cortese, Heitz,
Jermann, Louis Latour, Louis Roederer and Martin Ray. All 20 sat at critic 96.0.
Same mechanism (5×4, mandatory per-batch citation check, fixed spot-check sampling).
**175 wine_keys in `wine_dossier`; 171 in scope; 667 remain** of 838.

**Yield: 38/60 core fields sourced (63.3%), 22 partial, 0 model — the BEST of the
eight real batches**, ahead of batch 6 and nearly double batch 7's 35.0%. Fourth
consecutive batch with ZERO fields at unsourced "model" confidence.

**⚠️ DO NOT read that yield as "the drafting improved."** The drafters' own
pre-check was 44/60 (73.3%), the highest self-labelled figure yet, and the
independent check removed 6 net. The yield rose mainly because **three separate
auditors found the drafters had OMITTED true, verifiable facts out of excess
caution**, and restoring them added sourced content. The honest quality signal for
this batch is the **correction count: 62, the highest of any batch** — not the yield.

**The batch-4 overlay-in-same-script fix held for a sixth straight batch**: direct
live-export re-query came back **22/22 populated on the FIRST try** (22 in-stock SKUs
across 20 wine_keys — Rauzan-Ségla and Le Petit Mouton have 2 each). wine_key parity
(22 SKU checks) and the per-pairing `confidence` key (60 pairing entries) both
verified clean by script before staging.

**⚠️ CONTENT THINNESS LARGELY RESOLVED — only 3 of 20 wines ship pairings-only**,
down from 7 in batch 7: **Joseph Phelps Freestone Chardonnay, Joseph Phelps Freestone
Pinot Noir, Louis Roederer Blanc de Blancs.** Distribution: 3 fields → 6 wines, 2 → 9,
1 → 2, 0 → 3. **All three are thin for a mechanical, fixable reason, not a research
one**: josephphelps.com returned HTTP 503 for the entire session (confirmed
independently by both the drafter and the auditor), and Roederer's official tech-sheet
PDF would not parse. These are the cleanest re-research candidates the project has
produced — the content exists, the sites were down. Recommend re-running just these 3
when the domains recover, separately from the batch-7 backlog decision.

**Batch-7's 7-wine thinness decision remains OPEN and was NOT acted on.** Running
total of pairings-only wines is now **10** (7 from batch 7 incl. Pétrus + 3 here).

**TWO SITE-SIDE BLOCKS, both handled correctly (no fabrication):** errazuriz.com
returned HTTP 429 on four drafter attempts — **independently re-probed from the
orchestrator session and also 429** on both the homepage and the Don Maximiano path,
confirming a real block rather than drafter error. josephphelps.com 503 as above.
In both cases the drafter refused to cite an unfetched page. That is the correct
behaviour and should be preserved.

**Citation check found real defects in all 5 sub-batches — 20/20 dossiers required
corrections, 62 applied, zero failed replace-targets (8 batches running, zero
exceptions).** The findings that matter:

- **Dana Estates — FABRICATED ATTRIBUTION TO A NAMED LIVING PERSON, the most
  serious finding of the run.** The draft had winemaker **Maura Johnson** describing
  the wine's philosophy. The auditor fetched the cited retailer page: **no quote from
  her exists on it.** Two adjacent unattributed sentences had been welded into an
  attributed statement. This is a distinct and worse class of error than a wrong date.
- **Dana Estates — a false "since 1883", verified by the orchestrator directly.**
  The draft repeated the producer's own slogan "Crafting World-Class Wines Since 1883".
  1883 is a **pre-Prohibition ghost winery BUILDING** founded by H.W. Helms; **Dana
  Estates was founded in 2005** by Hi Sang Lee (Livingston owned the site 1976-2005).
  The citation was honest — the slogan really is on danaestates.com — but the CLAIM
  was false. **The clearest demonstration yet that `sourced` ≠ true.**
- **Joseph Phelps Chardonnay — TASTING NOTE FROM THE WRONG WINE.** The entire note
  was lifted from a page for the **Pastorale Vineyard designate**, a different
  single-block bottling. A customer would have read another wine's profile.
- **FLAG-THEN-PUBLISH-ANYWAY RECURRED FIVE TIMES** (now the defining failure mode of
  this project, 8 batches running): Enrico VI's "Villero area" (drafter wrote that the
  producer page "names only the municipality, not the cru", then published the cru
  inside a `sourced` field citing only that page — and it is probably wrong on the
  merits, as Villero is east/southeast-facing while the producer describes a southwest
  site); Errázuriz's Max I/II/V block names and 1960s/1983 dates (self-flagged as "the
  weakest claims here"); Jermann's Antinori sentence (`_notes` literally said "an
  auditor should treat it as partial", shipped as sourced); Quintus's "stepped away"
  from the classification (the one fetched source says the opposite — absorbed through
  merger, explicitly distinguished from the Ausone/Cheval Blanc withdrawals); Henschke's
  "crafted continuously since" (a softened paraphrase of the prestige claim the drafter
  had just recorded excluding).
- **EXCESSIVE CAUTION COST REAL CONTENT — the mirror-image failure, three times.**
  Mount Edelstone's oak regime was omitted because the drafter distrusted a retailer
  snippet and checked only the *vineyard* page; the *product* page states it verbatim
  ("8% new and 92% seasoned French oak hogsheads for 20 months") and **the distrusted
  snippet was accurate**. Julius's naming story was dropped over a non-existent
  conflict (Albert Julius Henschke = "great-uncle Julius", full vs familiar name).
  Latour's **December 1898** acquisition was deleted for vagueness when the
  "conflicting" 1900 timeline entry does not even name Romanée-Saint-Vivant.
- **Auditors corrected in BOTH directions.** UPGRADES: Rauzan-Ségla `expert_note`
  (wrongly downgraded — every claim was on a fetched page); Errázuriz
  `producer_history` (once the unverifiable dates came out, the remainder was fully
  supported); Le Petit Mouton `producer_history` (the famous 1853/1855/1973/artist-label
  facts turned out to be published on Mouton's own key-date pages). DOWNGRADES worth
  noting: Roederer `style_summary`, where the drafter justified `sourced` by claiming
  two pages "agree exactly on all four figures" — the auditor fetched both and found
  **the ageing durations are entirely absent from the second page**. The drafter's
  stated *evidence* was wrong, not just its conclusion.
- **Rauzan-Ségla 1984-vs-1994 adjudicated properly.** 1994 is right, but the drafter
  reached it by majority vote, which would have failed if the count went the other way.
  The real proof is chronological: Holt owned the estate until 1989, then Brent Walker,
  so an April 1984 Wertheimer purchase is impossible. The "1984" is a digit typo.

**Guards TESTED AND PASSED** (each was actively challenged, not assumed):
Henschke ↔ **Hill of Grace** — the auditor confirmed Wikipedia does return Hill of
Grace material (1860s vines, first produced 1958, Gnadenberg/Paul Gotthard 1891) and
that **none of it** reached the Mount Edelstone dossier; Cordero di Montezemolo
siblings — no vineyard fact bled either way, and the Gattera altitude/exposure/soil
omission was judged **correct** (the producer page genuinely states none of it);
**both second wines** — neither Le Petit Mouton nor Le Dragon de Quintus claims
grand-vin-equivalent ageing, so the batch-7 Baron de Brane over-claim did NOT recur;
**Martin Ray "Reserve" — false alarm** raised by the orchestrator, disproved by
downloading the PDF and grepping the body (zero hits for "reserve"; it exists only in
the filename slug); Quintus classification — base Saint-Émilion Grand Cru only.

**TWO DATA-MODEL ISSUES, not fixed here (they need a SKU-name change upstream):**
`jermann-vintage-tunina-doc` — the wine is a Venezia Giulia **IGT**, not a DOC; the
dossier text correctly never asserts a DOC, but the wine_key carries one.
`le-dragon-de-quintus-grand-cru` — "grand-cru" is correct as an APPELLATION and must
never render in the UI as "Grand Cru Classé".

Spot-check packet (fixed position-1 sampling): `scratchpad/spotcheck_packet_batch8.md`,
sampling `chateau-rauzan-s-gla-margaux`, `dana-estates-onda-cabernet-sauvignon-napa-valley`,
`giuseppe-cortese-barbaresco-riserva-rabaja`, `jermann-vintage-tunina-doc`,
`le-petit-mouton-de-mouton-rothschild-...`. The fixed rule again landed on the batch's
worst finding (Dana, position 1 of sub-batch 2). Full per-sub-batch audit notes are in
`scratchpad/audit8/sub{1..5}_findings.md`.

**Next real batch**: the thinness decision now covers **10 wines** — but the 3 from
this batch are a different problem (dead source sites, not missing content) and should
be re-run on their own once josephphelps.com and the Roederer PDF are reachable.
Then continue down the critic-score-ranked remaining-667 list, same batch shape (5×4),
same mandatory per-batch citation check, same same-script overlay-population pattern.
Keep using the `|done ∩ scope|` count form, not `838 − row count`.

## Phase 2 REAL RUN #9 — destroyed by a tmp purge, rebuilt from zero; the audit pass earned its keep (2026-08-06)

**Result: 20 wine_keys / 21 SKUs staged. 175 → 195 wine_dossier, 225 → 246 overlay.
Remaining in scope: 647.** Run id `phase2-realbatch9-20260806`.

### What happened first: total loss of a completed drafting run

Batch 9 was drafted once on 2026-07-28 and never staged. The session straddled a
date boundary (Jul 28 → Aug 3) and macOS purged `/private/tmp`, destroying the
entire scratchpad: all 20 drafts, the selection, the audit inputs, and every batch
script. Directories survived; every file inside was gone. Nothing was recoverable —
the stopped auditors' task transcripts were all 144-byte stubs, despite a system
notification claiming their progress was saved.

**The DB was untouched (175/225, 0 batch-9 rows), because the citation gate never
passed, so nothing was ever eligible to stage.** The gate did its job: the failure
cost time, not data integrity.

**DURABILITY FIX (do not undo):** run artifacts now live in `data/dossier_runs/batchN/`
inside the repo, gitignored via a `data/dossier_runs/` rule whose comment records why.
Batches 1–8 never hit this because each finished inside a single day. Do NOT put run
state back in `/private/tmp`.

### The rebuild

Selection re-ran and reproduced the original batch 9 **exactly** — same 20 wine_keys,
same 21 SKUs, confirming the rebuilt `select_batch9.py` was faithful. All five scripts
(select / merge / verify / apply_corrections / stage / requery) were rewritten from
the batch-8 patterns preserved in the handoff and in a live batch-8 DB row.

### Yield: lower sourced ratio, and that is the honest number

| | pre-audit | post-audit |
|---|---|---|
| core fields `sourced` | 27/60 (45.0%) | **31/60 (51.7%)** |

Batch 8 reported 71.7% pre-check. **Do not read 51.7% as a regression.** The drafters
downgraded aggressively instead of laundering recalled knowledge through a
blocked-site citation, and the audit then *raised* the ratio by reversing
over-cautious downgrades. Two fields were upgraded to `sourced` on evidence
(Renieri `producer_history`, Shafer `style_summary`), plus Peter Michael Ma Danseuse
and Poliziano `style_summary`.

### The audit pass found real defects — 78 corrections, 18 of 20 wines touched

61 `replace`, 12 `set_source_urls`, 5 `set_confidence`. All 78 applied with zero
unmatched or ambiguous `find` targets. Highlights:

- **Outright fabrications inside `sourced` fields:** Troye Sivan called an "actor"
  (no cited page); Peter Michael "above the fog line"; three of five Renieri soil
  components (limestone, rock, tuff) invented against a page naming neither;
  Antinori's "Albiera … first woman to lead the house after twenty-five generations"
  on no fetched page.
- **A cited page that does not contain the fact, and the fact was wrong:**
  `italianwineselection.com` was cited for Querciabella's biodynamic conversion
  "since the late 1990s". Fetched, it contains neither that nor the founding year.
  Real conversion year: **2000**. This is the defect class that only fetching catches.
- **Fabricated quotation:** Realm's style_summary welded two separate producer
  sentences into one continuous quote with an invented colon.
- **Geography error:** Travaglini "hills *north of* the province of Vercelli" (outside
  the province) vs the source's "in the north of the province".
- **Unsourced sensory claims that contradicted the only fetchable tasting note**
  (Travaglini pale/iron/tar; Two Hands "firm mineral-edged tannin" against the
  producer's published "very soft and elegant").

### THE BIG ONE — `petermichaelwinery.com` is NOT reliably blocked

Batch 8 and batch 9's drafting both wrote it off as 403. **The auditor fetched
`petermichaelwinery.com/wines/ma-danseuse/` and got 200, fully readable**, recovering
verbatim producer copy ("Sixteen months in 50% new French oak barrels") that the
drafter had hedged away. The earlier 403s were transient or path-specific.

**Correct the standing assumption:** do not pre-declare Peter Michael blocked in
batch-N prompts. Same for `us.penfolds.com`, which is reachable while `penfolds.com`
403s — worth remembering, as Penfolds recurs often in the remaining 647.

The auditor named the underlying pattern precisely: **unreachable sources mishandled
in BOTH directions** — one live page written off as blocked (losing real producer
copy), and one genuinely-403 page (Poliziano/Dalla Terra) whose five numbers were
*kept behind a hedge* rather than deleted. An uncheckable citation cannot carry
numbers. Both are the same error: treating fetch status as judgment, not fact.

### Recurring weakness worth a prompt change next batch

Sub-batch 3's auditor named it best: **provenance lists were assembled from where the
drafter looked, not where the claim came from.** Three separate citation-hygiene
defects (a dead URL cited as support; two fields whose load-bearing claims came from
pages absent from their own `source_urls`). Consider asking drafters to attach the
URL per-claim during research rather than assembling `source_urls` at write-time.

### PDFs: `WebFetch` "unreadable binary" is not final

Four unparseable PDFs this batch (Montes, Shafer 2022-OPF, Astrum, two Siran sheets).
The sub-1 auditor recovered the Montes Alpha M tech sheet by **reading the saved PDF
directly as an image**, preserving the batch's densest numeric field from a false
downgrade. Try that before accepting a PDF-driven downgrade. The others were
correctly left uncited (Shafer's is a corrupted XFA form — see run #8 notes).

### Gate change: the `investment` banned-word regex was too broad

A bare `\binvestment\b` failed the gate on two *sourced facts*: Realm co-founder
Wendell Laidley's profession ("investment banker" — the source's own words) and Two
Hands' verified "$30,000 investment" of startup capital. The rule exists to stop wine
being pitched as a financial asset, not to strike biography. Narrowed to catch
`investment-grade|potential|opportunit`, `a/sound/solid/smart/good investment`,
bare `invest`, `store of value`, `appreciates in value`; verified against both
must-catch and must-pass fixtures. **This was a gate bug, not a content problem —
the fix was to the regex, never to the sourced text.**

### Verification (Rule 1 / 6 / 9 / 10)

- Rule 10 backup: `dossier.db.backup-pre-phase2-realbatch9-20260806-223255`
- Gate passed: 20 drafts, wine_key parity clean, **60/60 pairings carry `confidence`**
- Staged both tables in ONE transaction (guarded upsert, `human-approved` protected)
- `refresh_products_dossier.py` → 246 products; `refresh_live_export.py` → 11,934
- `tests/test_dossier_db_invariants.py`: **7 passed, 1 skipped**
- **Rule 1 direct re-query: 21/21 batch SKUs carry a populated `curation_dossier`
  in `live_products_export.json`.** Zero empty, zero absent.
- Post-ship spot verification: all six audited defects confirmed GONE from the
  shipped export; both upgrades confirmed PRESENT.

Three wines ship pairings-only publicly (Peter Michael Le Caprice, Penfolds Bin 150,
Travaglini) because their prose is `partial`/`model` and `_PUBLIC_CONFIDENCE` gates
it. That is the design working, not a failure — but it takes the **pairings-only
backlog to 13** (7 from batch 7 incl. Ch. Pétrus, 3 from batch 8, 3 here).

### Spot-check packet

`data/dossier_runs/batch9/batch9_spotcheck.md` — fixed sampling, position 1 of each
sub-batch: montes-alpha-m, peter-michael-pinot-noir-ma-danseuse,
renieri-brunello-di-montalcino-docg, talenti-…-pian-di-conte, vik-milla-cala.

### One drafting-brief error to note against myself

The batch-9 brief described Two Hands Yacca Block as "Single Vineyard/Garden Series".
The producer places it in the **Single Vineyard Series**, a distinct tier from the
Garden Series. The drafter caught and corrected the brief. Verify tier claims before
putting them in a prompt.

## Also still outstanding (lower priority, don't start without checking)

- Batch-position thinning still unconfirmed as a clean effect (see Phase 2
  mechanism test results above) — one batch of 5 couldn't separate "later
  position" from "harder subject" as the cause of thinner sourcing. A
  same-subject-different-position or same-position-different-subject control
  would settle this before batch size gets locked for the real Phase 2 run.
- `data/dossier_wine_key_audit.json` is stale — missing `opus-one-vintage`
  and `penfolds-grange-bin-95` as legitimate wine_keys. Needs a fix before
  Phase 2 treats that audit file as authoritative.
- Masseto's citation stands in Wikipedia's `Ornellaia` article (no dedicated
  Masseto page exists) — citation-check agent flagged this; may need a
  caveat/relabel in provenance metadata. Not acted on, low priority.

## Standing rules that apply throughout (from CLAUDE.md)

- Rule 1: verify data actually lands in the live export / UI via direct
  query — never trust log lines or cache-row counts.
- Rule 9: any bulk DB write to `dossier.db`/`products.db` must be followed
  by `refresh_live_export.py`, since the catalog UI reads
  `data/live_products_export.json`, not the DB directly.
- Rule 6: re-run `tests/test_dossier_db_invariants.py` after any write.
- Rule 5's spirit: the Thai-pairing bug was fixed as a real bug (changed the
  English to match the correct Thai), not glossed over or test-patched.
- This is a B2C **and B2B** facing feature — sourcing quality and voice
  consistency matter for both audiences; don't optimize only for consumer
  tone.
