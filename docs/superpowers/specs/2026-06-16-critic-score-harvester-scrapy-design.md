# Critic Score Harvester — v1 Design (Scrapy rebuild)

**Date:** 2026-06-16
**Status:** ⏸️ PAUSED (2026-06-16) — review-approved, but build on hold pending a coverage/ROI call. See "Pause decision" below.
**Branch:** `feat/critic-score-harvester`
**Supersedes:** [2026-06-03-critic-score-harvester-design.md](2026-06-03-critic-score-harvester-design.md) (the 2-3 week, hand-rolled-infra version)
**Estimated effort:** ~6 focused days + 2-day buffer + background backfill

> **⏸️ Pause decision (2026-06-16).** Investigation found a working critic-score
> system already in production: `scripts/load_critic_scores_from_csv.py` loads the
> Magento "Wine score" CSV into `critic_scores` (3,144 rows / 1,631 SKUs) and
> populates `products.score_max` / `score_summary` — **1,550 products already
> render badges** with the exact JSON shape this spec proposed to build. The
> Magento CSV is effectively tapped out (only 1,631 of 7,260 wine SKUs carry any
> score; the rest are blank in Magento). The scraper's real job is the **~9,886
> unscored products** (the recon suggests ~4-5k have findable public scores). That
> is a real gap, but the build is paused to decide whether 6 days + ongoing scrape
> maintenance is the best way to close it, versus expanding the existing CSV /
> supplier-intake feeds (`lib/supplier-intake/`) which are zero-risk and already
> built. **Do not start implementation from this spec until that call is made.**
> If the scraper is greenlit, this spec ALSO needs schema-reconciliation work: the
> live `critic_scores` table is **sku-keyed and simpler** than §6's schema
> (`id, sku, critic, score, score_max, vintage, tasting_year, source_url, notes,
> added_by, added_at` — no `signal_tier` / `score_scale` / `supporting_text` /
> `confidence` / nullable-SKU natural key). Migrating it and making CSV win on
> overlap is a prerequisite, not covered in the day-plan below.

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
mitigations are mandatory and specced below: (a) the §11.2 "what shipped" report
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
                              │  (start_requests source for spiders)
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
JOBDIR** — and the close reason is surfaced in the §11.2 report so a half-crawled
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
   # Layer 3 (THE number that matters — user-facing live export, post-refresh):
   jq '[.[] | select(.score_summary != null)] | length' data/live_products_export.json
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
| **2** | `BaseCriticSpider` (per-source JOBDIR, RetryAfterMiddleware) + Wine Enthusiast spider. Golden-fixture parser tests. Canary subset crawl writes real rows. | `SELECT count(*) FROM critic_scores` > 0 after WE canary crawl. |
| **3** | Remaining spiders: WineAlign, Natalie MacLean, The Real Review, Whiskybase, Master of Malt, Distiller. Per-source fixtures + Playwright per the day-0 decision. | Each spider yields ≥1 row on its canary SKU. |
| **4** | `refresh_products_summary.py` (the 7 deterministic merge rules → score_max/score_summary). **Rule 6 integration test** (`test_critic_db_invariants.py`). Precision canary on 50-SKU set. | Precision ≥ 90% gate; integration invariant test green. |
| **5** | Extend `app/api/products/[id]/route.ts` with `reviews[]`. `CriticScoreBadges.tsx`. Run `refresh_live_export.py`. **Layer-3 destination probe** (jq on live export). Browser walkthrough (Rule 7) on 5 SKUs. | `curl /api/products/<id> \| jq '.reviews'` non-empty; Layer-3 export count > 0; browser walkthrough signed off. |
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
| 8 | A source's search path (`/?s=`) is robots-disallowed → spider silently yields zero rows, looks like "no reviews" | M | Day-0 robots gate per source (§14); §11.2 report surfaces per-source `robotstxt/forbidden` count; robots-blocked search forces a deterministic-URL fallback for that source or drops it with a logged reason (Rule 2). |
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
