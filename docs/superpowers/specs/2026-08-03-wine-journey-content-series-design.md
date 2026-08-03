# The Wine Journey — Content Series Design

Date: 2026-08-03

## Purpose

A structured, start-to-expert content series that teaches wine using knowledge
already ingested into this codebase (`data/taxonomy.db`: 44 grape varieties,
99 regions, 88 subregions, 81 appellations, 25 classification tiers, plus
France and Italy chapters with designation ladders and style entities — see
`docs/superpowers/specs/` wine-knowledge-ingestion history). The series turns
that structured data into a curriculum readers can move through, rather than
a flat pile of blog posts.

**Data dependency note (verified 2026-08-03):** `data/taxonomy.db` is
gitignored local shared state, so region/subregion data for USA, Australia,
Spain, Chile, Argentina, New Zealand, Germany, Portugal, and Austria is
already present on disk today (all validated `taxonomy_contexts`) — it was
produced by the `feat/wine-knowledge-rest-of-world` branch (PR #88), which is
**not yet merged into `main`**. The real gate on those Stage 3 pieces is
shipping/merging that PR, not "chapters not built." Do not re-run ingestion
for those countries before checking PR #88's status.

Scope for this design: wine only. Spirits/sake/beer are a planned later
expansion using the same 4-stage format once the wine track is running.

## Audience model

Two tracks share one spine:

- **Beginner track** enters at Stage 1 (Curious) and moves forward in order.
- **Intermediate track** enters at the Stage 2 "Already know your grapes?
  Start here" orientation post and can skip Stage 1 entirely.

Both tracks converge by Stage 3 (Explorer), where content assumes basic
vocabulary regardless of entry point.

## Product tie-in model

Each piece is tagged as one of:

- **Sells** — links to shoppable SKUs, collections, or the finder tool.
  Reserved for flagship/cornerstone posts with high search or decision intent.
- **Mixed** — light product links where a natural example exists, not the
  main point of the piece.
- **Pure education** — no commerce tie-in; exists to build trust/vocabulary
  and to be linked FROM later sell-oriented posts.

This mirrors the existing Collections work (designation-tier collections,
category-curation) — Stage 4 in particular should link directly into the
already-shipped Icons & Classifications collections rather than duplicating
that curation logic.

## The four stages

### Stage 1 — Curious (beginner entry point, 7 pieces)

1. What Wine Actually Is — grape → fermentation → wine, no jargon. *Pure education.*
2. How to Taste Wine Like You Mean It — the 5 S's. *Pure education.*
3. Reading a Wine Label Without Faking It — **flagship**. Decodes
   country/producer/vintage/appellation/grape. *Sells* → catalog label examples.
4. Red, White, Rosé, Sparkling, Orange — What's the Actual Difference —
   skin-contact explained simply. *Mixed.*
5. The 5 Grapes to Know First (Cabernet Sauvignon, Chardonnay, Pinot Noir,
   Sauvignon Blanc, Merlot) — sourced from `taxonomy_entities`
   (`entity_type='grape_variety'`). *Sells* → per-grape SKU links.
6. Dry vs Sweet: The Most Misunderstood Word in Wine. *Pure education.*
7. Your First Bottle: A No-Wrong-Answer Buying Guide — decision-tree style,
   price-anchored. *Sells hard* → finder tool tie-in.

### Stage 2 — Confident (6 pieces)

1. Old World vs New World — Why It Actually Matters. *Pure education.*
2. Body, Tannin, Acidity: Building Your Tasting Vocabulary. *Pure education.*
3. Grape Personality Profiles — series-within-series, ~8-10 short posts
   covering the remaining major grapes in the 44-grape taxonomy beyond the
   Stage 1 five. *Mixed* → each links to that grape's SKUs.
4. Food Pairing Is Logic, Not Rules — **flagship**. Intended to draw on the
   `pairing_rules` table in `taxonomy.db`, but that table is currently
   **empty (0 rows)** — verified 2026-08-03. This piece is blocked on
   populating pairing rules first, or must be written from prose knowledge
   with the structured tie-in added later. *Sells* → "shop this pairing."
5. Why Two Bottles of the Same Grape Taste Nothing Alike — intro to
   terroir/region, bridges to Stage 3.
6. "Already know your grapes? Start here" — orientation post; this is the
   intermediate-track entry point referenced above.

### Stage 3 — Explorer (region/appellation literacy)

1. Country & Region Personality Profiles — series using `taxonomy_entities`
   region/subregion data. France and Italy chapters are merged and live on
   `main` today. Data for USA, Australia, Spain, Chile, Argentina, New
   Zealand, Germany, Portugal, and Austria already exists in
   `data/taxonomy.db` (validated contexts, produced by unmerged PR #88) —
   these pieces are gated on merging PR #88, not on new ingestion work.
2. Appellation Systems Decoded (AOC, DOCG/DOC, DO) — **flagship**, high
   search intent. *Sells* → appellation-tagged collections.
3. Vintage Variation: Does the Year Really Matter?
4. Style Families Beyond the Grape — uses the `style` entity type, which
   currently has exactly **one row** (Super Tuscan, validated 2026-07-26).
   That's a fine seed example for this single piece, but not enough
   structured data to sustain a recurring pillar — treat as a one-off until
   more style entities are ingested.

### Stage 4 — Connoisseur (expert layer)

1. Classification Ladders Explained (Grand Cru, 1er Cru, Reserva/Riserva,
   DOCG-outranks-DOC, etc.) — uses `classification_tier` entities (25) and
   `classification_scope_map`. *Sells* → links directly to the existing
   Icons & Classifications collections (shipped PRs #89/#91), not a new
   curation layer.
2. Producer Philosophy & Terroir Debates.
3. Collecting & Aging: What's Actually Worth Keeping.
4. Blind Tasting Frameworks — capstone piece, references concepts from all
   three prior stages.

## Cross-cutting structure

- Each stage ends with a short checkpoint (quiz or self-assessment) so the
  path reads as a completable course rather than a tag cloud of posts.
  Checkpoint content is not designed yet — each should be a 5-8 question
  self-assessment recapping that stage's pieces (e.g. Stage 1 checkpoint:
  "can you read a label and name your first 5 grapes?"). Designing the
  actual checkpoint questions is follow-up work, not covered by this spec.
- Content pieces that depend on unmerged/unshipped work (Stage 2's food
  pairing piece on empty `pairing_rules`; Stage 3's non-France/Italy region
  profiles on unmerged PR #88) should be sequenced last within their stage
  or explicitly flagged as blocked in the publishing calendar, rather than
  silently skipped.

## Explicitly out of scope for this design

- Publishing channel/distribution mechanics (blog pipeline vs. social vs.
  email) — deferred; this design covers curriculum content only.
- Spirits/sake/beer tracks — later expansion, same 4-stage format.
- Merging PR #88 (rest-of-world taxonomy chapters) and populating
  `pairing_rules` — both are prerequisites for specific pieces above, but
  are engineering/data-ops work tracked separately from this content design.
- Designing the actual checkpoint quiz questions for each stage.
