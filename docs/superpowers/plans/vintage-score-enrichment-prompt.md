# Session Prompt — Enrich Wine Vintage Scores & Grading (bottle + vintage-year)

> Paste the block below the `---` into a fresh Claude Code session running in
> this repo (`/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT`). Everything above the line
> is a note to you (the human).
>
> **What this does:** fetches, validates, and lands two kinds of wine score data
> into the catalog — (A) **per-bottle critic scores** (extends the existing
> `critic_scores` table) and (B) a new **region×year vintage-quality grade** layer.
> Both come from data the CODEX team **already built and cited** — this is a
> *validated-consumption* process, NOT a scraping/build-from-scratch job.
>
> **Why the strict bar:** CODEX's own vintage validation says only **117/521**
> master rows are `aligned` with the live source, **144 are `divergent`**, and
> their policy is *"Audit only. Do not replace master scores automatically."* So
> this process gates hard: only cited + aligned rows write; divergent stays PENDING.
> Verified against both repos 2026-08-08.

---

We are enriching the **WNLQ9 Product Engine** catalog with wine **vintage scores
and grading**, in two layers:

- **Layer A — per-bottle critic scores:** a critic's points for a specific
  wine + vintage (e.g. "Château Montrose 2015 → 94 pts, James Suckling"). Binds
  to a `sku` + `vintage_year`. Extends the existing `critic_scores` table.
- **Layer B — region×year vintage grade:** a quality grade for the *year itself*
  in a region (e.g. "Bordeaux 2015 = 96/100"). Applies to every wine from that
  region + year. This is a **new data layer.**

Both source from the **CODEX data library** (upstream, read-only) at
`/Users/admin/Documents/CODEX Projects`. **Never write to that repo.**

**Read first, in order:**
1. Our `CLAUDE.md` ABSOLUTE RULES. Rules **1, 4, 6, 9, 10, 12** all govern this.
2. `/Users/admin/.claude/projects/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/memory/MEMORY.md`
   — especially `project_critic_scores_csv_system`, `project_critic_scraper_handoff`,
   `feedback_no_inferred_item_level_data`, `feedback_dont_infer_country_from_brand`,
   `project_codex_enrichment_library_sync`, and the **Data Sources & Ownership** block.
3. This repo's critic-score spec: `docs/superpowers/specs/2026-06-16-critic-score-harvester-scrapy-design.md`
   (§15 schema, §16 source precedence). The precedence-merge that rolls critic
   rows up to per-product badges is `lib/critic_reviews/refresh_products_summary.py`.

## 0. Ground truth — what already exists (do not rebuild)

**In THIS repo (`data/db/products.db`, 11,934 products):**
- `critic_scores` table — **3,187 rows**, rich schema, `sku` **nullable** by design
  (scraped/library rows may bind by producer+cuvee+vintage, not sku). Columns incl.
  `sku, critic, score, score_max, vintage, tasting_year, source_url, source,
  score_native, score_scale, signal_class, signal_tier, supporting_text,
  confidence, producer, cuvee, fetched_at`. Current sources: `magento_csv` (3,126),
  `mreport_masterfile` (61). **No web-scraped or library rows yet.**
- Per-product roll-ups: `products.score_max` + `products.score_summary`
  (populated on **1,557 / 11,934**). There is **no** per-product `critic_score` col.
- Vintage columns on `products`: `vintage` (TEXT free-text, 9,505 populated),
  `vintage_year` (INTEGER, machine-usable, **3,000 populated**),
  `vintage_is_provisional` (flag).
- Export allowlist already carries `vintage`, `vintage_year`,
  `vintage_is_provisional`, `score_max`, `score_summary`
  (`scripts/refresh_live_export.py`, `EXPORT_COLS`). **Layer A needs no allowlist
  change. Layer B will need new column(s) added to the allowlist — see §4.**

**In the CODEX repo (already built + cited by them):**
- **Layer A source** — `research_jobs/progress_outputs/reviews_reference_library.csv`
  (~210k rated wine rows). Columns incl. `producer_key, scale, raw_score,
  score_100, ratings_count, vintage, region, appellation, grape_variety,
  flavor_keywords_en, source_file`. `scale` = `vivino_5` (user 1–5) vs
  `critic_100` (critic 80–100) — **NEVER blend scales.** For Layer A critic
  scores, use **`scale == critic_100` rows only.** Vivino user aggregates are not
  critic scores and must not land in `critic_scores`.
- **Layer B source** — `wine_data/knowledge/`:
  - `vintage_chart_master.csv` (1,087 rows: `region, vintage_year, score_100pt,
    classification`) — the working grade table.
  - `vintage_chart_consensus.csv` (556 rows) — multi-source consensus with
    `source_count, score_spread, master_delta, replace_master_candidate,
    consensus_status`. **The validation artifact.**
  - `vintage_source_registry.csv` (**only 3 rows; 1 real online source today** =
    Wine Enthusiast 2026 chart, `source_url` present) +
    `vintage_score_sources.csv` (920 observations, each with `source_id`,
    `source_url`, `retrieved_at`) — **the per-row citations your strict gate needs.**
  - `vintage_region_source_map.csv` (33 rows) — how library regions map to source
    chart regions (`mapping_type` exact / proxy).
  - `vintage_quality_enrichment.csv` (30,483 rows: `product_id, name, producer,
    region, chart_region, vintage_year, score_100pt, classification, method`) —
    CODEX's own product-level join. ⚠️ **`method` is load-bearing** (see §3).
  - `vintage_source_validation_summary.json` — **READ THIS FIRST for Layer B.**
    It reports: 117 `aligned`, 147 `near`, 144 `divergent`, 75 `no_online_match`,
    38 `proxy_review` (of 521 mapped master rows across 20 regions). Policy:
    **"Audit only. Do not replace master scores automatically."**

## 1. ⚠️ Hard constraints (read before touching data)

- **Single-source today.** Layer B "consensus" is currently **one online source**
  (Wine Enthusiast). Do not present it as multi-critic consensus. A single-source
  grade is a *reference*, not a verified consensus.
- **Divergent ≠ publishable.** Per CODEX's validation, only `aligned` and `near`
  rows (online match within tolerance) may write. `divergent`, `no_online_match`,
  and `proxy_review` rows stay **PENDING** — surface them in the report, never
  auto-write them.
- **`method` gates Layer B item-level writes.** In `vintage_quality_enrichment.csv`,
  `method == direct_chart_match` = the SKU's own region+year hit the chart (OK to
  consider). `method == parent_region_fallback` (and `vintage_subregion_scores.csv`
  entirely) = the grade was **inferred from a parent region**. Per
  `feedback_no_inferred_item_level_data`, a parent-region fallback is an inferred
  per-item claim → **PENDING/label, never a silent write.**
- **Scales never blend** (Layer A). `critic_100` only into `critic_scores`. If a
  row is `vivino_5`, drop it for this purpose.
- **We own identity + commercial data.** Never take `sku, name, brand, price, cost,
  stock, supplier` from the library. Match on producer/region/vintage; keep our IDs.
- **Producer/region/vintage joins are reliable; product-level joins are NOT**
  auto-writes. Any bottle-level match is a *review candidate* until the vintage
  and producer both agree. (`feedback_dont_infer_country_from_brand`: 19/24
  brand→geo inferences were wrong — verify, don't infer.)
- **Vivino/Wine Enthusiast ToS:** we consume CODEX's already-fetched, cited data;
  we do **not** re-scrape their charts here. Every landed value must carry the
  `source_url` + `retrieved_at` CODEX already recorded.

## 2. Join model

- **Layer A (critic_100 rows → `critic_scores`):** match `reviews_reference_library`
  `producer_key` to our `brand` (normalize our brand with CODEX's `producer_key()`
  from `research_jobs/build_reviews_reference_library.py` — mirror it, don't
  reinvent), AND require `vintage` to equal our `products.vintage_year`. Producer
  match alone → review candidate. Producer **+ exact vintage** match → eligible row.
- **Layer B (region×year grade):** our `products.region` + `products.vintage_year`
  → CODEX `vintage_chart_master` `(region, vintage_year)`, but only via
  `vintage_region_source_map` `mapping_type == exact`, only where the consensus/
  validation status is `aligned`/`near`, and only where a `source_url` exists in
  `vintage_score_sources`. Store the grade at the **(region, vintage_year) grain**,
  not per-SKU (a region-year grade is not a per-bottle claim).

## 3. What to actually do THIS session — Phase 1 is READ-ONLY, NO WRITES

1. Confirm every CODEX path in §0 resolves. Read
   `vintage_source_validation_summary.json` in full.
2. **Layer A recon (count queries, no writes):**
   - Of `reviews_reference_library.csv` rows with `scale == critic_100`, how many
     `producer_key` values match a `brand` in our catalog?
   - For those, how many have a `vintage` that equals a real `products.vintage_year`
     on a SKU under that brand? (This is the true Layer-A-eligible count.)
   - How many of *those* SKUs currently have **no** `critic_scores` row? (net-new)
3. **Layer B recon (count queries, no writes):**
   - Distinct `(region, vintage_year)` pairs in our catalog that map (via
     `mapping_type==exact`) to a `vintage_chart_master` row that is `aligned`/`near`
     AND has a `source_url`. That's the publishable Layer-B cell set.
   - How many SKUs fall under those cells → the reach of the grade layer.
   - **Separately** list the `divergent` / `no_online_match` / `parent_region_fallback`
     cells as **PENDING** — count only, do not plan to write them.
4. **Write the read-only reconciliation report** covering: Layer-A-eligible count,
   Layer-B publishable cells + SKU reach, PENDING counts by reason, and any place a
   library region **contradicts** our catalog region (list individually — highest-
   value corrections, each needs manufacturer verification before it lands).
5. **Propose the DB shape for Layer B** (choose and justify, get sign-off):
   - **Option (recommended):** a new `vintage_grades` table keyed on
     `(region, vintage_year)` with `score_100pt, classification, source_id,
     source_url, retrieved_at, validation_status, scale='critic_100'` — grade
     stored once per cell; the export join maps it onto SKUs at read time. Keeps
     the region-year fact from masquerading as a per-bottle score.
   - Alternative: two new `products` columns (`vintage_grade_score`,
     `vintage_grade_source`) written per-SKU. Simpler read path, but duplicates a
     region-year fact across thousands of rows and blurs the grain — only if the UI
     genuinely needs it flat.
   Whichever wins, the new field(s) must be added to `EXPORT_COLS` or they are
   **silently dropped from the UI** (`project_export_cols_allowlist`, Rule 9).

**Stop after step 5. Do not write to `products.db` until the report + DB shape are
signed off.**

## 4. Phase 2 — the write (only after sign-off), Rule-10 gated

For each layer, run as a **dry run first**: show the exact diff, cite `source_url`
+ `scale` + `validation_status` (and `method` for Layer B) per row, map every field
to its real destination column, and wait for sign-off. Then, per Rule 10:

1. `cp data/db/products.db data/db/products.db.bak-pre-vintage-<layer>-<date>`
2. Run on a **5-SKU (Layer A) / 5-cell (Layer B) canary**; verify in the UI export.
3. Confirm success/skip ratio matches the recon estimate.
4. Run the full write.
5. `.venv/bin/python scripts/refresh_live_export.py`
6. For Layer A, re-run `lib/critic_reviews/refresh_products_summary.py` so the new
   critic rows roll up into `products.score_max` / `score_summary`.

## 5. Verification is NOT optional (Rules 1, 4, 6, 9)

After each write, prove it landed — do not count matched rows or log lines:
- **Layer A:** `sqlite3` COUNT of new `critic_scores` rows with `source LIKE
  '%reviews_reference%'` AND non-null `source_url`; then confirm the affected SKUs'
  `score_summary` changed; then `grep`/`jq` that the value appears in
  `data/live_products_export.json`.
- **Layer B:** `sqlite3` COUNT proving the grade cells landed with `source_url` +
  `validation_status IN ('aligned','near')`; then confirm a sample SKU under a
  graded cell shows the grade in `data/live_products_export.json`.
- **Cost/shipping line (Rule 4):** this process spends **$0 on APIs** (offline
  consumption of already-fetched CODEX data). The report must still state: rows
  written per layer, **# SKUs where the user-facing field is populated in the
  export**, and # left PENDING with the reason.

Every landed value must trace to a `source_url` in the CODEX registry. A row with
no citation, a `vivino_5` scale, a `divergent`/`no_online_match` status, or a
`parent_region_fallback` method does **not** write — it stays PENDING and is listed
in the report.

## 6. Confirm before proposing any batch

State that you have: read the CLAUDE.md rules + MEMORY entries + the validation
summary; resolved all CODEX paths; produced the read-only reconciliation report
(§3.4) with real COUNT queries; and proposed a signed-off DB shape for Layer B —
BEFORE writing anything.
