# Critic Score Harvester — v1 Design (Scrapy rebuild)

**Date:** 2026-06-16
**Status:** Active — scraper greenlit + feed-expansion in scope (2026-06-16). Build sequence: schema migration (§15) → supplier-intake score branch (§17) → scraper. See §15-§17 for the three-feed model.
**Branch:** `feat/critic-score-harvester`
**Supersedes:** [2026-06-03-critic-score-harvester-design.md](2026-06-03-critic-score-harvester-design.md) (the 2-3 week, hand-rolled-infra version)
**Estimated effort:** migration + supplier branch ~2 days; scraper ~6 days + 2-day buffer + background backfill

> **Context (2026-06-16, after pause-and-investigate).** A working critic-score
> system already ships: `scripts/load_critic_scores_from_csv.py` loads the Magento
> "Wine score" CSV into `critic_scores` (3,144 rows / 1,631 SKUs) and populates
> `products.score_max` / `score_summary` — **1,550 products already render badges**.
> The Magento CSV is tapped out (1,631 of 7,260 wine SKUs scored; the rest blank in
> Magento; no unloaded critic columns). **Decision:** the catalog gets critic
> scores from **three feeds into one `critic_scores` table** — (1) the Magento CSV
> loader (exists), (2) **supplier-provided scores** via the supplier-intake match
> path (§17, new), (3) the **Scrapy scraper** scoped to the ~9,886 unscored SKUs
> (§6-§14). Curated feeds (CSV, supplier; confidence 1.0) always beat scraped
> (≤0.7) on overlap (§16). The live table is sku-keyed and simpler than §6's
> schema; **§15 migrates it to the rich schema first** (prerequisite for both the
> supplier branch and the scraper) and preserves the 1,550 live badges.

This is the slim rebuild. The 2026-06-03 spec hand-rolled an HTTP client, rate
limiter, retry logic, resumable-backfill state table, robots.txt cache, and 8
bespoke adapter files — reinventing what a mature scraping framework gives for
free. Per CLAUDE.md **Rule 11** ("build on skeletons, not from scratch; for
scraping assume reuse"), v1 now stands on **Scrapy**. Everything load-bearing
from the recon work survives unchanged; only the infrastructure is replaced.

---

## 1. What survives unchanged from the 2026-06-03 spec

These were validated and are kept verbatim. This document does not re-derive them.

- **50-SKU recon ground truth** — `data/critic_reviews_recon/results_merged.json`.
  Doubles as the precision/recall canary set. (See 2026-06-03 spec §2 for the
  tier table and source-frequency analysis.)
- **`critic_scores` table schema** — 2026-06-03 spec §6, kept as-is.
- **`score_summary` JSON shape + merge rules** — 2026-06-03 spec §6.
- **Regex score patterns + `is_plausible_score()`** — 2026-06-03 spec §7.1.
- **Producer-proximity + vintage binding rules** — 2026-06-03 spec §7.2.
- **20pt → 100pt scale conversion table** — 2026-06-03 spec §7.4.
- **Source-vs-critic provenance rule** + **signal-tier mapping** — §3.1, §3.2.
- **`CriticScoreBadges` UI component** + UI rules — 2026-06-03 spec §9.
- **Anti-hallucination invariant**: every persisted `supporting_text` is a
  literal substring of the fetched payload, asserted at write time.
- **"What shipped" job report** (Rule 4) + **two-stage canary** (Rule 10).

## 2. What is thrown away (replaced by Scrapy primitives)

| Old hand-rolled thing | Replaced by |
| --- | --- |
| `fetch/http_client.py` (httpx wrapper) | Scrapy downloader |
| Custom per-domain rate limiter | `AUTOTHROTTLE_*` + per-spider `DOWNLOAD_DELAY` |
| Custom retry-with-backoff | Scrapy `RetryMiddleware` (`RETRY_*` settings) |
| `scrape_progress` table + resumable `backfill.py` | Scrapy `JOBDIR` (built-in pause/resume + dupe filter) |
| robots.txt cache | `ROBOTSTXT_OBEY = True` (⚠ behavior differs — see note below) |
| 8 bespoke adapter files | Scrapy spiders sharing a `BaseCriticSpider` |
| Backfill CLI / scrapyd ambitions | `scrapy crawl` (scrapyd optional, deferred) |
| ~122-step checklist | ~5-day plan (§8) |
| `[sku]` API route assumption | Extend existing `app/api/products/[id]/route.ts` |

**⚠ `ROBOTSTXT_OBEY` is not a silent drop-in for the old robots cache.** The old
spec *paused a source with a log entry* when robots disallowed it — a loud
operator signal. Scrapy's `RobotsTxtMiddleware` instead **silently filters**
disallowed requests (a `robotstxt/forbidden` stat, DEBUG log only). Risk: a
source whose search path (`/?s=`) is robots-disallowed yields **zero rows that
look identical to "no reviews found"** — a Rule 2 violation (buried skip). Two
mitigations are mandatory and specced below: (a) the §11.3 "what shipped" report
surfaces the per-source `robotstxt/forbidden` count, so a robots-blocked source
is visibly distinct from an empty one; (b) §14 promotes "is the search path
robots-allowed?" to a **day-0 gating check per source**, not an impl-time
surprise, because it directly determines coverage.

## 3. Framework decision (locked)

**Scrapy + scrapy-playwright.** Reasons (per user + Rule 11): 15-year-mature,
huge troubleshooting corpus, project is already Python, zero cloud dependency.
`scrapy-playwright` is added but used **only** for sources whose score content
is JavaScript-rendered (decided per-source during implementation via a
"view-source contains the score?" check — if the score is in the raw HTML, no
Playwright). Default path is plain Scrapy HTTP; Playwright is the exception, not
the rule, to keep the backfill fast and cheap.

**Python pin:** runtime is 3.9.6. Scrapy 2.11+ and scrapy-playwright support
3.9. Pin `scrapy>=2.11,<3` and `scrapy-playwright>=0.0.40` in
`requirements-scraper.txt` (kept separate so the scraper deps don't bloat the
main app env).

## 4. "Generic from day 1" — narrowly defined (locked)

The genericity lives in **Scrapy's architecture**, not in code we write. We do
**not** build a YAML→spider compiler or a plugin DSL in v1 (that is the Rule 11
over-build trap). Concretely:

- **Generic (Scrapy-native, zero critic-specific code):** downloader, throttle,
  retry, robots, dupe-filter, the item pipeline, the feed/DB exporter, the
  job runner. A new scrape *of the same shape* = a new spider + a new config
  block, not a new project.
- **Per-job (thin config + one spider module):** target domains, allowed paths,
  field selectors, and which extraction profile to use. Critic-scores is the
  first job: `config/scraper/jobs/critic_scores.yml` declares the source list,
  per-source delays, and the search-vs-deterministic URL strategy; the
  critic-score spiders read it.

The seam is left open (next same-shape job = config file). We extend the config
schema only when a real job #2 needs a field the critic job didn't — not
speculatively.

## 5. UI scope (locked): CLI-only operator surface

v1 operator surface is **CLI only**:

```
scrapy crawl wine_enthusiast -a skus=WRW5031AD,WRW5400BN   # canary subset
scrapy crawl wine_enthusiast                               # one source, full backfill
scrapy crawl all_critics                                   # canary subset only — sequential, one process; NOT the parallel backfill
```

No Next.js admin page in v1 (deferred to v2 once the engine is proven). The
**product-facing** critic-score badges still ship on the product detail page —
that is the user feature and is independent of the operator console.

## 6. Architecture

```
data/db/products.db ──▶ catalog.py: distinct (producer, cuvee, vintage)
                              │  for BEVERAGE SKUs with NO curated score yet
                              │  (§16 gap scope; category-aware — excludes
                              │  accessories, see §18); start_requests for spiders
                              ▼
        ┌─────────────────────────────────────────────┐
        │ Scrapy project: scraper/                      │
        │   spiders/  (one per source + base)           │
        │   middlewares: AutoThrottle, Retry, Robots    │  ◀── all Scrapy built-ins
        │   playwright (only JS-rendered sources)       │
        └───────────────────────┬───────────────────────┘
                                 │ yields CriticScoreItem
                                 ▼
        ┌─────────────────────────────────────────────┐
        │ Item pipeline:                                │
        │  1. ExtractionPipeline (shared regex/bind)    │  ◀── reuses old §7 logic
        │  2. InvariantPipeline (supporting_text ∈ body)│  ◀── anti-hallucination
        │  3. SqlitePipeline → critic_scores            │
        └───────────────────────┬───────────────────────┘
                                 ▼
        refresh_products_summary.py → products.score_max / score_summary
                                 ▼
        scripts/refresh_live_export.py  (Rule 9 — MUST run after backfill)
                                 ▼
        app/api/products/[id]/route.ts adds reviews[] → CriticScoreBadges.tsx
```

Key points:

- **One database.** `critic_scores` is a new table in the existing
  `data/db/products.db`. No second DB.
- **Extraction logic is framework-agnostic.** The regex + binding code
  (old §7.1/§7.2) lives in `scraper/extract/` as pure functions and is called
  from the `ExtractionPipeline`. This keeps it unit-testable without Scrapy and
  reusable if we ever move off Scrapy.
- **Concurrency model (resolves the JOBDIR / parallel-process trap).** Sources
  run as **separate `scrapy crawl` processes in parallel**, but two things must
  hold for that to be safe — both were under-specified and are now mandated:
  - **Per-source `JOBDIR`, never a shared one.** A single shared `JOBDIR`
    corrupts the request queue / dupe-filter when two processes write it. Each
    spider sets `JOBDIR = .scrapy/jobs/<source_name>` via `custom_settings` (the
    `<source_name>` is the spider name). §10's settings block shows the
    *template*, not a literal shared path. The meta-spider form `all_critics` is
    therefore a convenience that runs the sources **sequentially in one process**
    (one JOBDIR), used only for the canary subset — never for the parallel
    backfill.
  - **Multi-process SQLite writes are real and must be hardened.** Because all
    parallel processes write the one `products.db`, this IS concurrent
    multi-writer SQLite — WAL serializes writers, it does not make them
    contention-free. The `SqlitePipeline` therefore opens the DB with
    `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;` and wraps each insert
    in a bounded retry on `sqlite3.OperationalError: database is locked`
    (5 attempts, 100ms→1.6s backoff). This is the WAL+retry pattern already
    proven in this project ([[feedback_canary_must_match_prod]]). The earlier
    "single-threaded pipeline ⇒ no contention" reasoning was wrong for the
    parallel-process deployment and is removed.

## 7. Module layout

```
scraper/                              # Scrapy project root (new)
├── scrapy.cfg
├── requirements-scraper.txt          # scrapy, scrapy-playwright (pinned, py3.9)
├── settings.py                       # AUTOTHROTTLE, RETRY, ROBOTSTXT_OBEY, UA, JOBDIR
├── catalog.py                        # distinct (producer,cuvee,vintage) from products.db
├── items.py                          # CriticScoreItem
├── extract/                          # framework-agnostic, ported from old §7
│   ├── score_patterns.py             # 5 regex patterns + is_plausible_score (verbatim)
│   ├── scale_conversion.py           # 20pt→100pt table (verbatim)
│   ├── critic_registry.py            # signal_tier / signal_class map (§3.2)
│   └── binder.py                     # producer-proximity + vintage binding (old §7.2)
├── pipelines.py                      # ExtractionPipeline, InvariantPipeline, SqlitePipeline
├── persist/
│   ├── schema.sql                    # critic_scores DDL (verbatim from old §6)
│   └── repository.py                 # typed read accessors (serving vs audit split)
└── spiders/
    ├── base.py                       # BaseCriticSpider: reads job config, common parse
    ├── wine_enthusiast.py            # in-site search → detail
    ├── winealign.py                  # in-site search → detail
    ├── natalie_maclean.py            # in-site search → detail
    ├── real_review.py                # in-site search → detail
    ├── whiskybase.py                 # deterministic URL
    ├── master_of_malt.py             # in-site search → detail
    └── distiller.py                  # deterministic URL

config/scraper/jobs/critic_scores.yml # source list, per-source delay, URL strategy

lib/critic_reviews/
└── refresh_products_summary.py       # critic_scores → products.score_max/score_summary

scripts/
├── critic_reviews_canary.py          # 50-SKU recon set → precision/recall confusion matrix
└── critic_reviews_cellartracker_outreach.txt  # Levine email (sent day 0, CT is v2)

app/api/products/[id]/route.ts        # EXTEND: add reviews[] from critic_scores
components/product/CriticScoreBadges.tsx  # new component (verbatim from old §9)

tests/critic_reviews/
├── fixtures/<source>/                # golden HTML samples per source
├── unit/                             # extraction + binding tests (no network)
└── integration/
    └── test_critic_db_invariants.py  # Rule 6 end-to-end invariant (see §11.7);
                                      # patterned on tests/test_enrichment_db_invariants.py
```

## 8. Source set (v1) — CellarTracker dropped

7 no-auth public sources (CT removed from v1 — see §9):

| # | Source | Spider strategy | Playwright? | Categories |
|---|---|---|---|---|
| 1 | Wine Enthusiast | in-site search → detail | check at impl | wine + some spirits |
| 2 | WineAlign | in-site search → detail | check at impl | wine (CA, multi-critic) |
| 3 | Natalie MacLean | in-site search → detail | check at impl | wine |
| 4 | The Real Review | in-site search → detail | check at impl | wine (AU/NZ) |
| 5 | Whiskybase | deterministic URL | check at impl | whisky |
| 6 | Master of Malt | in-site search → detail | check at impl | whisky/spirits |
| 7 | Distiller | deterministic URL | check at impl | spirits |

Coverage estimate **~50-58%** in v1 (vs ~64% with CT). Honest "no public reviews
found" → invisible empty state on the rest (old §9.2).

## 9. CellarTracker → v2 (locked)

CT is the single highest-yield source but its clean path needs an API grant
(email Eric Levine, historically up to 7-day turnaround) that does not fit a
5-day v1. Decision:

- **v1:** drop CT entirely. Send the Levine outreach email on day 0 (background).
- **v2:** when/if API access lands, CT is just a new spider + config block —
  exactly the reuse model §4 promises. No rework to the schema or pipeline.

## 10. Fetch politeness (Scrapy settings, not hand-rolled)

`scraper/settings.py`:

```python
# Project defaults. JOBDIR is set PER SPIDER (see below), NOT here, because
# parallel processes must not share one JOBDIR (would corrupt the queue).
ROBOTSTXT_OBEY = True
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 3.0          # ≈ old "1 req / 3s"
AUTOTHROTTLE_MAX_DELAY = 30.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0   # polite: one in flight per domain
CONCURRENT_REQUESTS_PER_DOMAIN = 1
RETRY_ENABLED = True
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504]  # NOTE: 429 handled separately, see below
DOWNLOAD_DELAY = 3.0
USER_AGENT = "WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)"
```

Each spider sets its own resumable job dir in `custom_settings`:

```python
class WineEnthusiastSpider(BaseCriticSpider):
    name = "wine_enthusiast"
    custom_settings = {"JOBDIR": f".scrapy/jobs/{name}"}  # per-source, never shared
```

**429 / `Retry-After` (issue from review — stock Scrapy does NOT honor it).**
Scrapy's stock `RetryMiddleware` retries 429 by count but ignores the
`Retry-After` header, and AutoThrottle only reacts to latency/200s, not to 429.
Against a source that returns `429 Retry-After: 120` the stock stack would keep
hammering at the normal delay. v1 therefore adds a tiny custom
`RetryAfterMiddleware` (ordered before the stock retry) that, on 429/503 with a
`Retry-After`, defers the request by that many seconds. This restores the old
§8 "1 retry on 429 with Retry-After" behavior. 429 is removed from
`RETRY_HTTP_CODES` so only the custom middleware handles it.

Per-source overrides (e.g. a gentler delay for a touchy site) live in the YAML
job config and are applied via `custom_settings` on each spider. Circuit-breaker
on sustained 429/403 = the custom retry middleware + a small
`CloseSpider`-on-threshold extension. **On a ban-triggered close, the source is
marked `backoff` (not `permanent_skip`) so the next day's run resumes from its
JOBDIR** — and the close reason is surfaced in the §11.3 report so a half-crawled
source is never mistaken for "no reviews found" (Rule 2).

**Backfill timing:** sources run as separate `scrapy crawl` processes in
parallel, **each with its own JOBDIR**, each polite at ~1 req/3s. Search-based
sources (1 search + ~2 detail fetches/triplet) are the long pole — first pass
~5 days, all stragglers within ~10 days; per-source `JOBDIR` makes each
resumable across days/reboots.
This is the same ~5-day-with-parallel-sources ballpark as the old §8 — and is
only valid *because* the sources run in parallel; the `all_critics` meta-spider
(sequential, one process) is for the canary subset only, never the backfill.

## 11. Verification (CLAUDE.md Rules 1, 2, 4, 6, 7, 9, 10)

The verification design is driven by this project's documented failure history
([[project_phase5_recovery]] — $56 wasted because data was reported "shipped"
based on cache-row counts while the user-facing field was empty). The
load-bearing principle: **the destination is the live export the UI reads, NOT
products.db, and NOT critic_scores.** `critic_scores` row count is the
"counting cache rows" anti-pattern Rule 1 explicitly forbids.

> **⚠️ Critic scores are NOT display-only — they drive product ranking.** As of
> commit `956fa29` (2026-06-20), `lib/curation/scoring_engine.py` consumes
> `products.score_max` (falling back to the `score_summary` critics JSON) as the
> **`web_freshness` signal: weight 0.2 — a fifth of the product's final curation
> score — with an 85-point credibility floor** (scores below 85 contribute
> nothing to rank). Implications the verification MUST cover:
> - **A false-bind doesn't just show a wrong badge — it inflates that product's
>   catalog rank.** The §9 "invisible empty state" framing understated the blast
>   radius. The no-vintage false-bind risk (§11.5) is now a *ranking* risk, not
>   just a display one — another reason the no-vintage canary stratum gates the
>   backfill.
> - **Two gates must agree.** The scraper's `signal_tier`/precedence (§16) and the
>   scoring engine's 85-pt floor are independent. A scraped tier-3/community score
>   < 85 renders as a badge but moves rank by 0.0 — that's intended, but the spec
>   must not assume "badge shown ⇒ rank moved." Verification checks both.
> - **Rule 1 destination test is extended:** beyond "badge present in live export,"
>   the post-backfill check includes a **curation-rank sanity probe** — pick 5
>   newly-scored SKUs with score ≥ 85 and confirm their `scoring_engine` output
>   rose vs the pre-backfill snapshot; pick 2 with score < 85 and confirm rank is
>   unchanged (floor working). Guards against the score landing in the table but
>   never reaching the ranking signal — the same "paid for data the engine never
>   used" failure mode, one layer deeper than the badge.
> - The existing scoring-engine regression tests (`tests/curation/test_scoring_engine.py`,
>   added in `956fa29`) must still pass after the migration changes `score_native`
>   to a string in more rows — the engine already parses `score_native` as a
>   string in its fallback path, but re-run them to confirm.

1. **Pre-flight (Rule 10) — backup before any bulk write.** Both the backfill
   AND the `refresh_products_summary.py` step mutate `products.db` and the live
   export, which CLAUDE.md classifies as irreversible high-risk operations.
   Before the full backfill: `cp data/db/products.db data/db/products.db.bak-pre-critic-<date>`.
   The backfill aborts if the backup step did not produce a file.

2. **Destination probe — three layers, the third is the real one:**
   ```sql
   -- Layer 1 (cache — informational only, NOT success):
   SELECT count(*) FROM critic_scores WHERE fetched_at > :job_start;
   -- Layer 2 (DB column populated):
   SELECT count(*) FROM products WHERE score_summary IS NOT NULL;
   ```
   ```bash
   # Layer 3 (THE number that matters — user-facing live export, post-refresh).
   # NOTE: jq is NOT installed in this env — use python so the load-bearing
   # probe can't fail with 'command not found' (which would misread as 0 shipped):
   python3 -c "import json;print(sum(1 for p in json.load(open('data/live_products_export.json')) if p.get('score_summary')))"
   ```
   The "what shipped" report's **headline number is Layer 3**, computed *after*
   `refresh_live_export.py` runs. If Layer 2 > 0 but Layer 3 = 0, the export
   refresh failed and the run is **NOT done** (this is the exact May-2026 trap).

3. **"What shipped" report** (Rule 4) emitted at crawl close via a Scrapy
   `spider_closed` signal handler. Mandatory lines:
   - rows written to `critic_scores` (cache — informational)
   - per-source `robotstxt/forbidden` count + close reason (Rule 2 — so a
     robots-blocked or banned source is visibly distinct from "no reviews")
   - SKUs with `score_max` populated **in the live export** (the headline)
   - per-successful-SKU cost (zero $ in v1; line kept for Rule 4 shape)

4. **Write-time invariant** (`InvariantPipeline`): `supporting_text in body`
   before the `SqlitePipeline` ever sees the item. Failures increment a
   parser-bug stat and drop the item with a log line, never silently.

5. **Precision canary** (`scripts/critic_reviews_canary.py`): run the 7 spiders
   against the 50-SKU recon set, diff extracted vs `results_merged.json`, print
   a confusion matrix. **Gate: precision ≥ 90%** before any full backfill
   (Rule 10). If < 90%, LLM verification is the v2 escalation (old §12 trigger).
   The canary runs **only after** the binding join column is confirmed against
   the live schema (§14 open item 3) — a wrong join key produces a deceptively
   low precision that would be misblamed on the regex.
   - ⚠️ **No-vintage canary stratum (mandatory — the gate's blind spot).** The
     50-SKU recon set is vintage-rich, but the real backfill target is dominated
     by no-vintage SKUs: of 9,886 unscored products, only ~2,436 have a usable
     vintage; ~7,350 are NV / "Current vintage" / blank. The vintage filter
     (old §7.2) is the main false-bind guard, so a 90% pass on vintage-rich SKUs
     does **not** certify the no-vintage majority. The canary therefore reports
     **two precision numbers**: (a) vintage-rich (the recon set) and (b) a
     no-vintage stratum — a fresh ~25-SKU hand-labeled sample of NV / Current-vintage
     SKUs. The 90% gate applies to **both**. If the no-vintage stratum fails, the
     honest v1 move is to bind+show scores **only where vintage is confident** and
     defer NV/Current-vintage binding to v2 — not to ship a quiet false-bind rate
     across ~7,350 SKUs (risk #2). The all-7-spiders scope is approved *on the
     condition* this stratum gates the backfill.

6. **Rule 9 — refresh the live export.** The backfill job's final step calls
   `scripts/refresh_live_export.py`. Without it the UI reads stale JSON and
   "I don't see the change" recurs. Default-on; `--no-refresh-export` for staging.

7. **Rule 6 — end-to-end invariant test** (`tests/critic_reviews/integration/
   test_critic_db_invariants.py`, patterned on the canonical
   `tests/test_enrichment_db_invariants.py`). Asserts the pipeline invariant, not
   just per-row content: **for every SKU X that binds (producer+cuvée+vintage,
   §6 join) to at least one `critic_scores` row with `signal_tier ≤ 2` and a
   numeric scale, `score_max` is non-NULL for X in the live export.** Run after
   every bulk write. This is the single most load-bearing test given the project
   history and is non-optional.

8. **Rule 7 — browser walkthrough** on 5 canary SKUs: `npm run dev`, open
   `/product/<id>` for each, confirm badges render, attribution correct,
   outbound links open with `rel="noopener nofollow ugc"`.

## 12. Plan (~6 days + buffer; "5-day" is the no-surprises floor)

The headline is ~5 days **only if** every §14 open item resolves cleanly and no
source needs Playwright. That is optimistic given risk #1 and the unknown search
endpoints, so the realistic budget is **6 days + a 2-day buffer**, with the old
day-4 overload split across two days.

| Day | Deliverable | Verification gate |
|---|---|---|
| **0** | Send Levine email (CT→v2, background). `pip install -r requirements-scraper.txt`. Scaffold `scraper/` Scrapy project; `settings.py` politeness; `catalog.py` reads triplets from products.db. **Day-0 gating checks (per source):** (a) is the search path robots-allowed? (b) is the score in raw HTML or JS-rendered? Record both in the job config. **Confirm the binding join columns** (`brand`/`vintage` or actual names) against the live products.db schema. | `scrapy list` runs; catalog prints N triplets; robots + HTML/JS + join-column results recorded for all 7 sources. |
| **1** | Port `extract/` (score_patterns, scale_conversion, critic_registry, binder) verbatim from old §7 as pure functions. `items.py`, `pipelines.py` (Extraction + Invariant + Sqlite with WAL+busy_timeout+write-retry). `persist/schema.sql` applied to products.db. Unit tests for extraction/binding (no network). | `pytest tests/critic_reviews/unit` green; invariant rejects a crafted bad row. |
| **2** | `BaseCriticSpider` (per-source JOBDIR, RetryAfterMiddleware) + **Whiskybase spider first** (spirits, deterministic-URL — simplest strategy, net-new category; §18.4a spirits-before-wine). Golden-fixture parser tests. Canary subset crawl writes real rows. | `SELECT count(*) FROM critic_scores` > 0 after Whiskybase canary crawl. |
| **3** | Remaining **spirits** spiders: Master of Malt, Distiller. Then **§18.4b gate** (precision canary incl. spirits stratum + rank-sanity probe) before wine. Then **wine** spiders: Wine Enthusiast, WineAlign, Natalie MacLean, The Real Review. Per-source fixtures + Playwright per the day-0 decision. | Each spider yields ≥1 row on its canary SKU; spirits gate passes before wine spiders start. |
| **4** | `refresh_products_summary.py` (the 7 deterministic merge rules → score_max/score_summary). **Rule 6 integration test** (`test_critic_db_invariants.py`). Precision canary on 50-SKU set **(both vintage-rich and no-vintage strata, §11.5)**. | Precision ≥ 90% gate on **both** strata; integration invariant test green. |
| **5** | Extend `app/api/products/[id]/route.ts` with `reviews[]`. `CriticScoreBadges.tsx`. Run `refresh_live_export.py`. **Layer-3 destination probe** (python, §11.2). Browser walkthrough (Rule 7) on 5 SKUs. | `curl /api/products/<id>` returns non-empty `reviews`; Layer-3 export count (python probe, §11.2) > 0; browser walkthrough signed off. |
| **6+** | **Backup products.db (Rule 10).** Full backfill kickoff (parallel processes, per-source `JOBDIR`, ~5-10 days wall). Final "what shipped" report (Layer-3 headline) + live-export refresh. | Rule 4 report shows SKUs-newly-populated **in the live export**; UI shows badges. |
| **buffer** | 2 days reserve for per-source parser quirks, a Playwright flip, or a robots-blocked search path forcing a deterministic-URL fallback. | — |

## 13. Risks

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | A source is JS-rendered; plain Scrapy gets empty body | M | Per-source view-source check at impl; flip that spider to scrapy-playwright. Isolated to one spider. |
| 2 | Regex binds wrong score on multi-wine pages | H | Producer-proximity + nearest-vintage binding (old §7.2). Measured on canary; LLM verify is v2. |
| 3 | Precision < 90% on canary | M | Gate blocks backfill (Rule 10). Tune patterns; LLM verify is the documented v2 escalation. |
| 4 | Rate-limit ban from a source | M | AutoThrottle + custom `RetryAfterMiddleware` (honors `Retry-After`) + CloseSpider-on-threshold marking `backoff` not `permanent_skip`; per-source delay override in YAML. |
| 5 | `refresh_live_export.py` not run → stale UI; or run but Layer-3 export still empty | M | Backfill final step runs it by default (Rule 9); §11.2 Layer-3 probe fails the run if export count = 0 while DB count > 0. |
| 6 | Coverage lands below ~50% without CT | L | Honest invisible empty state; CT in v2 restores ~64%. |
| 7 | scrapy-playwright pulls heavy browser deps into env | L | Kept in separate `requirements-scraper.txt`; main app env untouched. |
| 8 | A source's search path (`/?s=`) is robots-disallowed → spider silently yields zero rows, looks like "no reviews" | M | Day-0 robots gate per source (§14); §11.3 report surfaces per-source `robotstxt/forbidden` count; robots-blocked search forces a deterministic-URL fallback for that source or drops it with a logged reason (Rule 2). |
| 9 | Multi-process SQLite `database is locked` during parallel backfill | M | `SqlitePipeline` uses WAL + `busy_timeout=10000` + bounded write-retry (§6). |

## 14. Day-0 gating checks (promoted from "open items" — they determine coverage)

The review correctly flagged that these are not impl-time afterthoughts: each
one can silently zero out a source or invalidate the precision number. All three
are **day-0 gates**, recorded in the job config before any spider is written:

- **Robots gate (per source):** is the search path (`/?s=`) robots-allowed?
  If disallowed, the source either uses a deterministic-URL strategy instead or
  is dropped with a logged reason — it does NOT silently yield zero rows
  (risk #8, Rule 2).
- **HTML-vs-JS gate (per source):** is the score in the raw HTML response
  (plain Scrapy) or JS-rendered (needs scrapy-playwright)? A 2-minute
  view-source check; the answer goes in the job config and picks the spider's
  download path.
- **Binding-column gate:** confirm the actual `products` column names for the
  join (old §6 assumed `brand`/`vintage`; per [[project_taxonomy_masterfile_gotcha]]
  these columns aren't always clean). The precision canary (§11.5) runs only
  after this is confirmed, else a wrong join key fakes a low precision.

These gate the *implementation* (you can't write a correct spider without the
answers) but not the *spec* — the design holds regardless of how each resolves.

---

## 15. Schema migration (prerequisite — runs before supplier branch and scraper)

The **live** `critic_scores` table (3,144 rows, source `magento_csv_2026-06-15`)
is sku-keyed and simpler than the rich schema this design needs for lower-trust
scraped data. We migrate in place, preserving every existing row and all 1,550
live badges.

> **Run-once migration.** The `ALTER ADD COLUMN` steps and the `sku`-nullable
> table rebuild are **not re-runnable** (a second `ADD COLUMN` of an existing
> column errors; the rebuild assumes the old shape). Only the backfill UPDATE is
> idempotent. Take the Rule 10 backup first; if a step fails, restore from backup
> and re-run from the top — do not re-run partway through.

**Live schema (today):**
```
id, sku NOT NULL, critic, score REAL, score_max REAL DEFAULT 100,
vintage, tasting_year, source_url, notes, added_by, added_at
```

**Target additions** (step 1 of the migration — additive `ALTER ADD COLUMN`, no
drops, so existing reads keep working; the `sku`-nullable change is a separate
table-rebuild step, see the notes after the backfill):
```sql
ALTER TABLE critic_scores ADD COLUMN source          TEXT;     -- provenance: where fetched
ALTER TABLE critic_scores ADD COLUMN score_native    TEXT;     -- as published ('94','17.5/20','Silver')
ALTER TABLE critic_scores ADD COLUMN score_scale     TEXT;     -- '100pt'/'20pt'/'5star'/'medal'/'community'
ALTER TABLE critic_scores ADD COLUMN signal_class    TEXT;     -- 'critic_numeric'/'critic_text'/'community'/'medal'
ALTER TABLE critic_scores ADD COLUMN signal_tier     INTEGER;  -- 1..4 (§3.2)
ALTER TABLE critic_scores ADD COLUMN supporting_text TEXT;     -- literal substring (anti-hallucination); NULL for curated feeds
ALTER TABLE critic_scores ADD COLUMN confidence      REAL;     -- 1.0 curated, ≤0.7 scraped
ALTER TABLE critic_scores ADD COLUMN producer        TEXT;     -- canonical, for nullable-sku natural-key binding
ALTER TABLE critic_scores ADD COLUMN cuvee           TEXT;     -- canonical
ALTER TABLE critic_scores ADD COLUMN fetched_at      TEXT;     -- ISO; for curated rows = added_at
```

**Backfill the 3,144 existing CSV rows** (one UPDATE, idempotent):
```sql
UPDATE critic_scores
SET source = 'magento_csv',
    -- score_native must be AS PUBLISHED, never a re-derived integer (old §6).
    -- All 3,144 existing rows are integer-valued, but a future 94.5 must survive:
    -- strip a trailing .0 only, keep fractional scores intact.
    score_native = CASE WHEN score = CAST(score AS INTEGER)
                        THEN CAST(CAST(score AS INTEGER) AS TEXT)  -- 91.0 → '91'
                        ELSE CAST(score AS TEXT) END,              -- 94.5 → '94.5'
    score_scale = '100pt',
    signal_class = 'critic_numeric',
    signal_tier = 1,            -- WE/WA/WS/JS are all major pro critics
    confidence = 1.0,           -- curated → authoritative
    supporting_text = NULL,     -- curated feed; not a scraped substring
    fetched_at = COALESCE(fetched_at, added_at)
WHERE added_by LIKE 'magento_csv%' AND source IS NULL;
```

**Notes:**
- **`sku` becomes nullable** (committed, not punted — matches old §6's natural-key
  design: scraped rows bind by `(producer, cuvee, vintage)` and may legitimately
  have no SKU). ⚠️ **SQLite cannot drop a NOT NULL constraint with `ALTER`** — it
  requires the 12-step table rebuild (`CREATE TABLE critic_scores_new (...nullable
  sku...)`, `INSERT INTO critic_scores_new SELECT * FROM critic_scores`,
  `DROP TABLE critic_scores`, `ALTER TABLE critic_scores_new RENAME TO
  critic_scores`, recreate indexes). So the migration is **not** pure additive
  ALTERs as the block above implies — it is: (1) add the new columns via ALTER,
  (2) backfill the CSV rows, (3) table-rebuild to make `sku` nullable, preserving
  all rows + the new columns. The rebuild runs inside a transaction with
  `PRAGMA foreign_keys=OFF` per the SQLite-documented procedure; a backup (Rule 10)
  is taken first so a failed rebuild is recoverable.
- The existing `score_max` column on `critic_scores` (DEFAULT 100, the
  *denominator*) is unrelated to `products.score_max` (the aggregate). Left as-is.
- `load_critic_scores_from_csv.py` is updated to populate the new columns on
  future runs: `source='magento_csv'`, `signal_tier=1`, `signal_class='critic_numeric'`,
  `confidence=1.0`, `score_scale='100pt'`, `supporting_text=NULL`, and crucially
  **`score_native = clean(raw_cell)`** — the published string, exactly as
  `build_summary` already captures it (loader line 120). Do NOT set `score_native`
  from a re-CAST of the float (`94.5 → '94'` would corrupt it — see the backfill
  CASE above). ~10-line change to its INSERT tuple.
- **Verification (Rules 1, 6, 9):**
  - (a) row count unchanged at **3,144**; (b) every row has non-NULL
    `source`/`signal_tier`/`confidence`. *(Layer-2 DB checks — informational, not
    success, per §11.)*
  - (c) **Snapshot the 1,550 SKU IDs** with non-NULL `products.score_summary`
    BEFORE migration; assert the set is **identical** after (not just the count).
  - (d) **Run `scripts/refresh_live_export.py`** (Rule 9), then assert the
    **Layer-3** live-export `score_summary` count is unchanged at **1,550** (the
    §11.2 destination probe — the number that matters).
  - (e) **Migration invariant test (Rule 6)** — `test_critic_db_invariants.py`
    (the §11.7 file, extended): on a `cp` backup copy, assert the 3,144 rows'
    `(id, sku, critic, score)` are byte-identical pre/post and the 1,550-SKU
    badge set is identical pre/post. Patterned on `tests/test_enrichment_db_invariants.py`.
  - (f) Rule 7 spot-check on 3 known SKUs in the browser.

## 16. Source precedence & merge (three feeds, one badge)

`refresh_products_summary.py` (the §6 merge step) now reconciles rows from three
`source` families when computing `products.score_max` / `score_summary`:

| Source family | `source` values | tier | confidence | Role |
| --- | --- | --- | --- | --- |
| Magento CSV | `magento_csv` | 1 | 1.0 | curated, authoritative |
| Supplier | `supplier_<code>` | 1 | 1.0 | curated, authoritative |
| Scraper | `wine_enthusiast`, `winealign`, … | 1–4 | ≤0.7 | public web, lower trust |

**Precedence rule (deterministic):** for a given SKU + `(critic, score_scale)`,
when more than one source offers a value:
1. Higher `confidence` wins → **curated always beats scraped.**
2. Tie on confidence (two curated, both 1.0) → most recent `fetched_at` wins.
3. Still tied → lower `signal_tier`, then higher `score_value`.

This precedence layer sits **on top of** the old §6 merge rules — it does not
redefine the §6 critics-list dedup key (`(critic, score_native)`). Precedence
runs first (collapse multi-source duplicates per `(critic, score_scale)` to one
winning row), then §6 rule 2 dedups the resulting list. For the curated-vs-scraped
case the keys never conflict because step 1 (confidence) decides before dedup.

A scraped score for a `(critic)` already covered by a curated source is **kept in
the table** (audit/provenance) but **excluded from the badge** — the merge picks
the curated row. A scraped score for a critic NOT in any curated source for that
SKU **is shown** (that is the whole point — filling the gap). This makes the
scraper purely additive to the 1,550 curated SKUs and the source of all-new
coverage on the 9,886 unscored ones. All other §6 merge rules (5-entry cap,
score_max from tier≤2 numeric, confidence<0.5 excluded) are unchanged.

## 17. Supplier-provided scores (feed-expansion track)

Suppliers will provide critic scores alongside the product data they already
submit through the **supplier-intake** subsystem (`lib/supplier-intake/`). That
subsystem is a **pricing/matching pipeline** (register → normalize → match →
price → approve → commit); its `SupplierNormalizedPayload` has cost/RSP/identity
fields but **no score concept**, and its lifecycle gates on price approval.

**Decision: reuse the matching, bypass the pricing.** Scores do not belong in the
margin-approval gate (a valid critic score must not be "blocked" because a price
needs review). So:

- When a supplier file includes score columns (same critic vocabulary as the
  Magento CSV — WE/WA/WS/JS plus any agreed additions), the intake run extracts
  them per row **as an optional side-channel**, independent of the pricing path.
- After the existing **match step** resolves `supplier_item → product SKU`
  (`SupplierMatchProposal.selected_sku`), a new score branch writes
  `(selected_sku, critic, score)` rows to `critic_scores` with
  `source='supplier_<supplier_code>'`, `signal_tier=1`, `confidence=1.0`,
  `score_scale='100pt'`, `supporting_text=NULL` — same shape as curated CSV rows.
- Only rows whose match status is `strong_match` (or operator-approved
  `likely_match`) get scores written — an unmatched/conflicted row has no SKU to
  attach a score to, so its scores are held with the row, not written.
- ⚠️ The writer guards on a **truthy** `selected_sku`, not just `!== undefined`.
  `matching.ts` builds candidate SKUs as `String(p.sku ?? '')`, so a product
  lacking a SKU yields `selected_sku === ''` — which must NOT produce a
  `critic_scores` row with `sku=''`. Write only when `if (selected_sku)` is truthy.
- This reuses the supplier file ingest + matching infrastructure without
  threading scores through `pricing.ts` or the price-approval `IntakeRowStatus`
  flow.

**What this adds to supplier-intake (minimal, non-invasive):**
- An optional score-column map in the supplier definition / normalization
  (off by default; only suppliers who provide scores set it).
- A post-match score-writer that calls the same `critic_scores` repository the
  CSV loader and scraper use. No change to `pricing.ts`, no new `IntakeRunStatus`.

**Verification:** same destination probe as §11 — after a supplier run with
scores, the headline is **SKUs newly populated in the live export**, not rows in
`critic_scores`. CSV/supplier precedence (§16) means a supplier score only
changes a badge where it adds a new critic or is more recent than an existing
curated one.

## 18. Revised build sequence (supersedes §12's day-plan ordering)

§12's day-by-day plan still describes the **scraper** work. The full effort now
sequences three tracks; §12 is the third block:

1. **Schema migration (§15)** — ~1 day. ALTER add-columns + backfill +
   `sku`-nullable table rebuild + the Rule 6 invariant test + live-export
   snapshot/refresh verification. **Run-once** (un-guarded ALTERs + one-shot
   rebuild error on re-run; only the backfill is idempotent). Backup products.db
   first (Rule 10). Prerequisite for everything else.
2. **Source-precedence merge (§16)** — folded into `refresh_products_summary.py`;
   ~0.5 day. Must land before any non-CSV source writes, so curated-wins is
   enforced from the first supplier/scraper row.
3. **Supplier score branch (§17)** — ~1 day. Score-column map + post-match writer
   in supplier-intake. Independent of the scraper; can ship first as the
   lowest-risk new coverage.
4. **Scraper (§6-§14, §12 day-plan)** — ~6 days + 2-day buffer + background
   backfill. Scoped to SKUs with no curated score **and** that are actually
   beverages — the catalog query is **category-aware**, not just
   `score_summary IS NULL`. ⚠️ **Accessories are identified by SKU prefix, NOT by
   classification** ([[project_accessory_sku_prefixes]] — 570 products are
   misclassified as "Wine product"). The catalog filter must reuse the **canonical
   prefix set** `ACCESSORY_PREFIXES` from `lib/enrichment/rules.ts`
   (`ABA, AWC, GWN, GLQ, GBE, GNB, GAC, GDC, GDE`) — the scraper is Python, so
   either port this set to a shared constant or read it from one source of truth;
   do **not** hand-roll a new prefix list or trust the `classification` column.
   Excluding accessories stops spiders from burning politeness budget searching
   Wine Enthusiast for glassware.
   **Scraper build sub-order (spirits before wine):**
   - **4a. Spirits spiders first** (~3,297 SKUs): Whiskybase, Master of Malt,
     Distiller. **100% net-new — zero spirits scored today.** No curated overlap,
     so precedence (§16) and the 85-pt floor barely apply; the cleanest, highest-
     ROI half. Ships an entire category the CSV can never cover.
   - ⚠️ **Spirits canary is thin — harden it before trusting the gate.** The
     50-SKU recon set is **36 wine / 14 spirits** (whisky 6, sake_shochu 4,
     gin/vodka/rum 4), and **no v1 source covers sake/shochu** (the 7 sources are
     whisky/general-spirits only). So the spirits precision gate effectively rests
     on ~10 SKUs, and 4 sake/shochu SKUs can never be validated. Before the §18.4b
     gate certifies the spirits backfill, **hand-label ~15-20 additional spirit
     SKUs** (spanning whisky + gin/vodka/rum) to give the 90% gate a real basis —
     or explicitly accept a lower-confidence canary for spirits and log it (Rule 2:
     don't let a thin gate masquerade as a passed one). Sake/shochu is a documented
     v1 non-coverage, not a silent miss.
   - **4b. GATE on 4a results** — run the §11.5 canary (incl. no-vintage stratum
     AND the hardened spirits stratum above) + the §11 curation-rank sanity probe
     on the spirits data before starting wine.
   - **4c. Wine spiders** (~6,695 SKUs): Wine Enthusiast, WineAlign, Real Review,
     Natalie MacLean. Overlaps the existing 4 wine critics (diminishing returns),
     carries the no-vintage false-bind risk, and has the full ranking blast radius.
     The lower-ROI, higher-risk half — built only after spirits proves the pipeline.

Tracks 3 and 4 are independent after tracks 1-2; track 3 (supplier) and track 4a
(spirits) are the two lowest-risk, highest-net-new wins and either is a reasonable
first ship. Track 4c (wine) is the speculative half.

---

## 19. Assumptions to re-verify at build time (anti-drift)

This spec is a point-in-time snapshot. The codebase is actively developed — in
the days between drafting and approval, the scoring engine began consuming critic
scores (`956fa29`, §11) and a memory landed that invalidated the accessory filter
(§18). To stop the spec silently desyncing, the implementer **re-verifies each
fact below on day 0** (a 15-minute check, output recorded alongside the §14
gates). If any has changed, reconcile before building — do not trust this doc's
numbers blindly.

| # | Assumption (as of 2026-06-20) | How to re-verify |
|---|---|---|
| 1 | `critic_scores` is still sku-keyed/simple, no `source`/`signal_tier` columns | `sqlite3 products.db ".schema critic_scores"` |
| 2 | 3,144 rows / 1,631 SKUs, single source tag `magento_csv_2026-06-15` | `SELECT count(*), count(DISTINCT sku), count(DISTINCT added_by) FROM critic_scores` |
| 3 | 1,550 products have `score_summary` (live badges) | `SELECT count(*) FROM products WHERE score_summary IS NOT NULL` + the §11.2 python Layer-3 probe on the live export |
| 4 | scoring engine consumes critic scores @ weight 0.2 + 85-pt floor | check `_web_freshness` in `lib/curation/scoring_engine.py` is still wired (not reverted) |
| 5 | `ACCESSORY_PREFIXES` set unchanged in `lib/enrichment/rules.ts` | grep the constant; the catalog filter must match it exactly |
| 6 | products join columns are `brand` / `vintage` (no `producer`/`cuvee`) | `PRAGMA table_info(products)` (§14 binding-column gate) |
| 7 | live export and products.db are in sync (Rule 9) | compare mtimes; if export is stale, run `refresh_live_export.py` first |
| 8 | branch `feat/critic-score-harvester` hasn't had a conflicting critic-score change merged | `git log --oneline -- lib/critic_reviews scripts/load_critic_scores_from_csv.py lib/curation/scoring_engine.py` |

Item 8 is not paranoia: this branch's working tree was reset/merged twice during
spec authoring (once orphaning commits, once discarding fixes in a merge). Confirm
the spec's starting state still holds before the migration's irreversible writes.
