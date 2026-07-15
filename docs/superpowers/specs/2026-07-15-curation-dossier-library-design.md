# Curation Dossier Library — Design

**Date:** 2026-07-15
**Status:** Approved design, pre-implementation
**Owner:** winenowsommelier-rgb
**Depends on:** none (parallel to reputation-v1 scoring fixes, which are a separate scoped effort)

---

## 1. Purpose

Build an expert-reference library ("a team of trustworthy sommeliers in a database"):
per-wine, source-cited curation content — why a bottle is notable, what its
designation means, how to serve it, what to pair it with, when to drink it.

Three downstream consumers, all querying the same records:

1. **Social content** — "why this bottle matters" posts, event/seasonal content.
2. **HoReCa menu design** — pairing menus, by-the-glass programs, B2B wine lists.
3. **Cellar-starter collections** — curated buy-lists from in-stock items.

This is a NEW layer alongside (not replacing) the existing reputation score,
`critic_scores` table, and `/curation` rule engine. The reputation v1 scoring
bug fixes (2026-07-09 review) are Phase 1 of a separate track; this library is
independent of them and does not consume reputation tiers in v1.

## 2. Constraints that shaped the design

- **No in-house sommelier.** All content is LLM-synthesized, so every
  product-specific factual claim must be grounded in a fetched, cited source.
  If no source is found, the field stays NULL — never filled from the model's
  general knowledge.
- **Generation runs in-session (Claude Code / Fable 5), not via paid API.**
  Marginal dollar cost ≈ $0; the constraint becomes session time and
  subscription capacity. Paid API (~$225–405 Sonnet for the full scope) is the
  fallback if in-session throughput proves too slow; the staging/validator
  machinery is identical for both.
- **Thai market.** Pairing content must cover Thai cuisine (heat/capsaicin
  compatibility is the central pairing problem); Thailand's Alcoholic Beverage
  Control Act B.E. 2551 restricts promotional claims — no consumption-benefit
  or investment-return language, ever.

## 3. Scope (verified against live DB 2026-07-15)

- `critic_scores` = 3,205 **rows** = 1,641 distinct SKUs = 1,621 joinable to
  `products` (20 orphans to resolve/purge first).
- Of the 1,621: **903 in stock**, 530 CATALOG-archived, 188 out of stock.
- The scope is **100% wine** by SKU prefix (WRW 1,223 / WWW 184 / WSP 170 /
  WDW 24 / WRS 19 / WOW 1). Zero spirits/sake — the schema is explicitly a
  WINE dossier v1; per-category field contracts are decided before the first
  non-wine row, not after.

**v1 generation scope = the 903 in-stock critic-scored SKUs** (grouped by
wine_key; ~35 multi-vintage families collapse further). Archived SKUs are NOT
generated in v1 — the pipeline is rerunnable on restock.

## 4. Schema

Two-level model: wine-level facts are generated once per wine identity;
vintage/bottling-specific facts live in a per-SKU overlay. (Petrus 1982/2011/
2012/2014 = 4 SKUs, ONE wine_dossier, 4 overlays.)

```sql
CREATE TABLE wine_dossier (
  wine_key TEXT PRIMARY KEY,          -- producer+cuvée normalized
  style_summary TEXT,                 -- one-line sommelier descriptor (social reuse)
  expert_note TEXT,                   -- source-grounded narrative
  producer_history TEXT,              -- separated from bottling-specific notes
  signature_pairings_json TEXT,       -- [{dish, dish_local, cuisine, course,
                                      --   heat_level_ok(0-3), reason, confidence}]
                                      -- >=2 Thai-cuisine entries required per wine
  serve_guidance_json TEXT,           -- {temp_c_min, temp_c_max, glass_code,
                                      --  decant:{type:'none'|'aerate'|'sediment',
                                      --          minutes_min, minutes_max}, notes}
                                      -- EXCEPTIONS ONLY — defaults derived in code
  content_hooks_json TEXT,            -- [{hook, angle}] social retrieval keys
  occasion_tags_json TEXT,            -- gift|celebration|Songkran|CNY|Christmas|...
  course_placement TEXT,              -- aperitif|starter|main|cheese|dessert
  btg_suitable INTEGER,               -- by-the-glass viability flag
  cuisine_tags_json TEXT,             -- thai|japanese|italian|steak|seafood|...
  provenance_json TEXT,               -- per-FIELD {confidence, source_urls[]}
                                      -- confidence: 'sourced'|'partial'|'model'
                                      -- ('model' = generated without product-
                                      --  specific sources; a field that is NULL
                                      --  or 'model' is what §6/§8 call unverified)
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(review_status IN ('unreviewed','ai-cross-checked','human-approved')),
  reviewed_by TEXT, reviewed_at TEXT,
  model_id TEXT, prompt_version TEXT, source_run_id TEXT,
  generated_at TEXT, refresh_due TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  CHECK (signature_pairings_json IS NULL OR json_valid(signature_pairings_json)),
  CHECK (serve_guidance_json IS NULL OR json_valid(serve_guidance_json)),
  CHECK (provenance_json IS NULL OR json_valid(provenance_json))
);

CREATE TABLE sku_dossier_overlay (
  sku TEXT PRIMARY KEY REFERENCES products(sku),
  wine_key TEXT NOT NULL REFERENCES wine_dossier(wine_key),
  vintage_scope TEXT CHECK(vintage_scope IN
    ('exact-vintage','adjacent-vintage','producer-track-record',
     'non-vintage','unknown-stock-vintage')),
  drink_from_year INTEGER, drink_to_year INTEGER,
  peak_from_year INTEGER, peak_to_year INTEGER,
  window_source_url TEXT,
  honors_json TEXT,                   -- NON-score awards ONLY:
                                      -- [{type, awarding_body, award, vintage,
                                      --   applies_to_stock(bool), source_url,
                                      --   supporting_text, retrieved_at}]
  stock_snapshot_json TEXT,           -- {price, vintage, is_in_stock} at generation
  CHECK (honors_json IS NULL OR json_valid(honors_json))
);

CREATE TABLE designation_reference (
  designation TEXT NOT NULL, region TEXT NOT NULL,
  kind TEXT CHECK(kind IN
    ('quality-rank','dosage','aging-class','production-style')),
  explainer TEXT, sources_json TEXT,
  PRIMARY KEY (designation, region)
);
-- ~21 rows; seeded from data/taxonomy/classification_master.json + web checks.
-- Grand Cru differs across Burgundy/Alsace/Champagne; 'Brut' is dosage, not rank.

CREATE TABLE dossier_runs (
  run_id TEXT PRIMARY KEY, started_at TEXT, model_id TEXT, prompt_version TEXT,
  skus_attempted INTEGER, skus_sourced INTEGER, total_cost_usd REAL
);

CREATE TABLE dossier_staging (        -- crash/resume cache (enrichment_cache pattern)
  wine_key TEXT NOT NULL, run_id TEXT NOT NULL,  -- keyed by wine_key: generation
  raw_response_json TEXT, created_at TEXT,       -- and resume operate per wine,
  PRIMARY KEY (wine_key, run_id)                 -- not per SKU (matches §8)
);
```

Writers run `PRAGMA foreign_keys=ON` (off by default in SQLite; most existing
scripts never enable it).

## 5. Data-integrity rules (non-negotiable)

1. **Vintage integrity.** 1,335 critic rows cite a vintage that does not match
   the stocked bottle; ~460 products are flagged "VINTAGE MAY CHANGE"; 481
   scores sit on "Current vintage"/"N/V" products. Every honor carries its
   vintage + `applies_to_stock`. Non-matching acclaim renders as "the 2019
   earned…", NEVER "this bottle earned…". SKUs with mutable vintage cap at
   confidence 'partial'.
2. **No second store of critic scores.** Numeric scores live exclusively in
   `critic_scores`. `honors_json` holds only non-score honors (medals, Top-100
   placements, classification promotions). Newly discovered scores are written
   as `critic_scores` rows (`source='llm_websearch'`) and merged by the
   existing `refresh_products_summary.py` precedence.
3. **No fabrication.** Product-specific claims (expert_note, producer_history,
   honors, drinking windows) require ≥1 fetched source URL in provenance.
   No source → field stays NULL. Category-level knowledge
   (designation_reference explainers, classic pairing theory) may draw on
   general knowledge — it is checkable public consensus, not a product claim.
4. **No price/availability/consumption-benefit/investment language** in any
   generated text (validator-enforced; prices change nightly; Thai ABC Act).
   The former `cellar_role='investment'` concept is deleted; the deliverable
   is the drinking window.
5. **Precedence.** Dossier pairings are a curated subset + narrative of
   existing `food_matching` tokens (validator: each pairing maps to an
   existing token or is flagged as an addition). Dossier never restates taste
   axes. UI precedence: dossier sourced pairings > food_matching_detail >
   inferred.
6. **Clobber guard.** Upsert is
   `ON CONFLICT DO UPDATE ... WHERE review_status != 'human-approved'`;
   unit test asserts a human-approved row survives regeneration.

## 6. Consumer gates

| Consumer | Minimum per-field confidence |
|---|---|
| Social content | `sourced` |
| HoReCa menus/lists | `sourced` or `partial` |
| Internal tooling | any (incl. `model`) |
| `model`/NULL ("unverified") | never leaves internal tooling |

All consumer queries join live `products` for price/stock at query time —
dossiers are evergreen; availability is not.

## 7. Export path (Rule 9)

New table is invisible to the UI by itself. Following the proven
`score_summary` pattern:

1. `scripts/refresh_products_dossier.py` (modeled on
   `lib/critic_reviews/refresh_products_summary.py`) derives a denormalized
   `products.curation_dossier` JSON column (suppressing per-field anything
   below the consumer gate).
2. Column added to `EXPORT_COLS` **and** `JSON_COLS` in
   `scripts/refresh_live_export.py`; Rule-1 tally block extended with a
   `has_dossier` count.
3. Then `refresh_live_export.py` as usual.

## 8. Generation process (in-session, resumable)

**Phase 0 — pure code, no LLM (build first regardless):**
- Schema migration + clobber-guard upsert + indexes.
- Resolve/purge the 20 orphan critic SKUs.
- wine_key normalizer (producer+cuvée; groups ~35 multi-vintage families).
- Scope table: in-stock critic-scored SKUs — re-derived at run time (stock
  shifts nightly; the 903 count in §3 is a 2026-07-15 snapshot, not a constant).
- Serve-guidance defaults derived from category_type + body/tannin lookup
  (~30 lines); dossier stores exceptions only.
- Validators (no-price-language, pairing-token mapping, provenance-URL check).
- Invariant tests (§9) + export deriver.

**Phase 0.5 — designation_reference:** authored in-session (~21 rows),
grounded in classification_master.json + web checks.

**Phase 1 — canary (Rule 10 quality steps still apply at $0):**
5–10 wine_keys in-session with WebSearch/WebFetch grounding → staging →
eyeball EVERY citation → invariant tests → UI walkthrough → measure sourced-
field yield against the recon baseline (60% found-rate, 36% sparse/none).

**Phase 2 — batched full run:**
- Fan-out subagents, each taking 5–10 wine_keys: search → fetch → synthesize
  structured dossier JSON with citations.
- Every result lands in `dossier_staging` first, then applies through the
  guarded upsert. Commit per-SKU. Resume = `WHERE wine_key NOT IN (staging
  for this run)`.
- ~903 SKUs (fewer wine_keys) at 40–80 per session ≈ 12–20 sessions, or a
  scheduled routine. Sequence by expected source yield (famous wines first).
- Expect ~35% of items to come back thin ('unverified'/NULL fields) — that is
  correct behavior, not failure.
- Every batch ends with the count query against dossier tables AND the export
  (Rule 1/6) — never "N subagents completed."

**Fallback:** if in-session throughput disappoints, the same staging + prompt
+ validator machinery runs against the paid API (Sonnet, ~$0.25/SKU mid-case;
full-scope ~$225–405) for the remainder. Rule 10 money steps apply then.

## 9. Invariant tests (pattern: tests/test_enrichment_db_invariants.py)

1. Staging→dossier: every staged successful generation has a dossier row with
   ≥1 non-NULL content field.
2. Dossier→export: every wine_dossier row with any 'sourced' field surfaces in
   `live_products_export.json` for its SKUs.
3. Orphan guard: zero overlay SKUs absent from products; zero overlays without
   a wine_dossier parent.
4. Review guard: regenerating over `review_status='human-approved'` is a no-op.
5. Provenance guard: any field marked 'sourced' has ≥1 source_url.
6. Vintage guard: any honor with `applies_to_stock=false` never renders
   "this bottle" phrasing (validator-level).

## 10. Out of scope for v1 (explicit)

- Spirits/sake/champagne-house dossiers (no critic-score coverage; needs a
  different acclaim source — competition medals, age statements. Phase-2.)
- Archived (CATALOG) SKUs — regenerate on restock instead.
- Stock-quantity-based cellar advice ("buy 6 bottles") — `quantity_in_stock`
  is 0 for every row in the DB; no stock-depth signal exists. All quantity
  guidance is generic until a real feed arrives from BI/Magento.
- Entry-tier (<฿1,000) cellar coverage — only 40 in-stock critic SKUs under
  ฿1k; v1 cellar lists are "fine-wine starter" tiers (฿1–2k/2–5k/5–15k/icon).
- Consuming reputation-v1 tiers (on hold pending scoring fixes).

## 11. Review provenance

Design reviewed 2026-07-15 by three adversarial lenses (sommelier, product/
HoReCa, data-architecture) against the live DB; 44 findings consolidated into
this spec. Key corrections that reviews forced: scope 3,205→903, vintage
integrity fields, deletion of 'investment', accolades→critic_scores
unification, designation_explainer→reference table, per-field provenance,
wine-level grain, clobber guard, export path, Thai-cuisine pairing shape.
