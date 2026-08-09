# Next session: full designation/classification linking + description cards

## Where this picks up
Branch: `worktree-fix+region-description-paragraphs`, PR #106 (open, NOT merged —
merge is being held until this work is bundled in). Builds on #104/#105
(already merged: region/subregion copy renders sentence-per-line with proper
spacing).

PR #106 added a **narrow, safe first cut**: in the region knowledge panel
(shop page card + explore-map drawer), a "Classification" tier label (e.g.
"Italy DOCG") is a clickable link to `/shop?region=X&designation=Y` ONLY when
an explicit, hand-verified mapping exists in `TIER_TO_DESIGNATION` inside
`apps/catalog/components/explore/KnowledgeSection.tsx`. Currently mapped:
Bordeaux 1855 First Growth, Burgundy Grand/Premier Cru, Champagne Grand Cru,
Italy DOCG, Spain DOCa. Everything else in `knowledge.tiers` across all
regions renders as plain text (deliberately — see "why substring-matching was
rejected" in that file's comments).

## What the user wants next (verbatim ask)
1. Make **all** designation/classification values properly and validly
   link to the correct filtered catalog items — not just the 6 currently
   mapped tiers.
2. When a classification/designation is selected (i.e. the shop page is
   filtered by `?designation=X`), show a **description card explaining that
   classification** on the catalog page — analogous to the region description
   card (PR #104), but for the designation itself (e.g. select "DOCG" → show
   a card explaining what DOCG means, sourced/cited like region copy is).

## Ground truth already established (verified this session — don't re-derive)
- **Only 3,015 of 11,934 products (25%) have a persisted `designation` field.**
  The rest fall back to `designationForProduct()`'s regex-over-`name` parse
  in `apps/catalog/lib/designation.ts` at read time. Any "make it all valid"
  work needs to reckon with this: either (a) trust the regex fallback is good
  enough, (b) run a backfill to persist `designation` more broadly (there's
  already `scripts/backfill_designation.py` mirroring the same table per that
  file's PARITY comment — check it's still in sync), or (c) scope the linking
  work to only the ~22 canonical `DESIGNATIONS` labels regardless of
  persisted-vs-derived, which is what already happens today.
- `DESIGNATIONS` (the canonical, ordered, most-specific-first vocabulary) and
  `designationForProduct()` live in `apps/catalog/lib/designation.ts`. This
  is the ONLY source of truth for what a valid, filterable designation looks
  like. Do not invent new designation tokens outside this list without adding
  them here first (with a regex + backfill parity update).
- `apps/catalog/lib/facets.ts:designationsFor()` already derives the shop
  sidebar's designation filter facet from real product data — cross-check
  against this for which designations actually have live in-stock products
  right now (a designation with 0 current stock shouldn't get a confident
  "link here" treatment without a stock-count guard, similar to how region
  copy is allowed to exist even when a region temporarily has low stock, but
  a *0-result* link is the one hard rule from PR #106 to keep enforcing).
- There is **no existing description-copy infrastructure for designations**.
  `taxonomy_contexts` (data/taxonomy.db) is scoped to region/subregion/country
  entities only (`taxonomy_entities` + `scope_id='wine'` etc.) — confirmed via
  `.schema` this session. `classification_scope_map` in the same DB is
  UNRELATED (it's Magento `classification`→scope for product TYPE routing,
  per CLAUDE.md Rule 12 — do not confuse the two, do not reuse that table).
  Designation description copy (what DOCG means, why Grand Cru outranks
  Premier Cru, etc.) does not exist anywhere yet and needs to be authored.
- The region-copy sourcing rule applies equally here: **no fabricated
  claims**. Designation/classification facts (legal definitions, hierarchy,
  aging requirements) are stable and well-documented — cite a real source
  (Wine Bible, the relevant regulatory body's official material, e.g. INAO
  for AOC, Comité Interprofessionnel for Champagne, Consorzio for DOCG) same
  as the region-copy brief already scoped in `docs/region-taxonomy-copy-brief.md`.

## Suggested shape of the work (not a mandate — brainstorm/design first)
1. **Data**: decide where designation description copy lives. Likely a new
   small table (`designation_contexts` or similar) or a JSON file
   (`data/designation_descriptions.json`) keyed by the exact `DESIGNATIONS`
   label — do NOT overload `taxonomy_contexts` (that's entity-graph-shaped,
   designations aren't graph nodes with lat/lng/parent relationships).
2. **Content**: ~22 canonical designations need short+full copy (mirror the
   region-copy format: description_short ~180-260 chars, description_en/full
   ~800-1600 chars, source_citation required). This is a bounded, known-size
   task (22 items, not 117 like the region backlog) — probably doable in one
   focused pass.
3. **Linking coverage**: replace/extend `TIER_TO_DESIGNATION`'s hand-picked 6
   entries so every region's `knowledge.tiers` array gets checked against the
   full `DESIGNATIONS` list properly (not substring — same false-positive
   risk as "Spain DOCa" vs "DOC" that PR #106 already hit and worked around).
   May need per-tier explicit mapping still, OR a smarter tokenizer that
   splits "Italy DOCG" into region-name + designation-token safely. Decide
   which after looking at the actual variety of tier strings across all
   ~184 regions (not just the ones with product-heavy regions checked so far).
4. **UI**: a `DesignationDescriptionCard` (or similar), shown on the shop page
   when `params.designation` is set, same visual language as
   `RegionDescriptionCard` (PR #104) — sentence-per-line body, Read more/less
   if long, `gap-1.5 leading-relaxed` spacing (PR #105's fix), citation
   footer. Reuse `splitSentences` from `apps/catalog/lib/explore/split-sentences.ts`
   rather than re-solving that problem.
5. **Verification before claiming done** (Rule 7 + Rule 6 from CLAUDE.md):
   - Every new designation→link mapping must be checked against real product
     counts (same non-empty-result guarantee PR #106 established) before
     going live — a query, not a guess.
   - Browser/dev-server verification of the new card rendering, not just
     `tsc`/tests passing.
   - This session's environment has NO interactive browser tool (confirmed
     twice) — curl the dev server's rendered HTML same way PR #104-#106 did,
     and ask the user to eyeball production after merge (they've done this
     reliably via screenshot before — use that channel again).

## Explicitly NOT decided yet — ask the user
- Scope: all 22 `DESIGNATIONS` in one pass, or prioritize by product-count
  like the region-copy brief did (top designations by stock first)?
- Does "properly and validly link to each item classification" also mean
  linking should appear from the **product page** (a bottle's own DOCG badge
  → click through to the DOCG designation card), not just the region
  knowledge panel? The user's ask says "catalog page" for the description
  card — confirm whether that means shop/listing page only, or also the
  individual product detail page.
- Persisted-vs-derived designation gap (75% of products rely on regex
  fallback): worth a backfill pass to persist `designation` more broadly as
  part of this work, or out of scope / separate task?

## Do NOT do
- Do not touch `classification` (Magento field) for category/type routing —
  Rule 12 is absolute, unrelated to this work.
- Do not substring-match tier strings to designation tokens — already proven
  unsafe (Spain DOCa/DOC false-positive).
- Do not link any designation/classification without confirming non-empty
  real product results first (query, don't assume).
- Do not fabricate designation description copy without a real citable
  source — same standing rule that burned 70 rows before
  (`feedback_no_inferred_item_level_data` memory).
