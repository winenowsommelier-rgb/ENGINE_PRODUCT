# Critic Score Harvester — v1 Design (Scrapy rebuild)

**Date:** 2026-06-16
**Status:** Draft — pending spec review + user approval
**Branch:** `feat/critic-score-harvester`
**Supersedes:** [2026-06-03-critic-score-harvester-design.md](2026-06-03-critic-score-harvester-design.md) (the 2-3 week, hand-rolled-infra version)
**Estimated effort:** ~5 focused days + background backfill

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
| robots.txt cache | `ROBOTSTXT_OBEY = True` |
| 8 bespoke adapter files | Scrapy spiders sharing a `BaseCriticSpider` |
| Backfill CLI / scrapyd ambitions | `scrapy crawl` (scrapyd optional, deferred) |
| ~122-step checklist | ~5-day plan (§8) |
| `[sku]` API route assumption | Extend existing `app/api/products/[id]/route.ts` |

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
scrapy crawl wine_enthusiast                               # full source backfill
scrapy crawl all_critics                                   # meta-spider runs the set
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
- **SQLite writes go through one pipeline** with WAL mode + the write-time
  invariant assertion. Scrapy runs spiders concurrently but the item pipeline is
  single-threaded per process, so no concurrent-write contention within a crawl.

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
└── unit/                             # extraction + binding tests (no network)
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
ROBOTSTXT_OBEY = True
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 3.0          # ≈ old "1 req / 3s"
AUTOTHROTTLE_MAX_DELAY = 30.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0   # polite: one in flight per domain
CONCURRENT_REQUESTS_PER_DOMAIN = 1
RETRY_ENABLED = True
RETRY_TIMES = 3                         # 5xx/429 backoff handled by middleware
RETRY_HTTP_CODES = [429, 500, 502, 503, 504]
DOWNLOAD_DELAY = 3.0
USER_AGENT = "WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)"
JOBDIR = ".scrapy/jobs/critic_scores"   # resumable backfill, dupe-filter persisted
```

Per-source overrides (e.g. a gentler delay for a touchy site) live in the YAML
job config and are applied via `custom_settings` on each spider. Circuit-breaker
on sustained 429/403 = Scrapy's `RetryMiddleware` + a small
`CloseSpider`-on-threshold extension.

**Backfill timing:** sources run as separate `scrapy crawl` processes in
parallel, each polite at ~1 req/3s. Search-based sources (1 search + ~2 detail
fetches/triplet) are the long pole at ~5 days for the first pass; `JOBDIR` makes
it resumable so it can run across days/reboots. Same ballpark as the old §8, now
free from Scrapy instead of hand-built.

## 11. Verification (CLAUDE.md Rules 1, 4, 6, 7, 9, 10)

Unchanged in intent from old §10; restated against the Scrapy shape:

1. **Destination-table count probe** after every crawl:
   ```sql
   SELECT count(*) FROM critic_scores WHERE fetched_at > :job_start;
   SELECT count(*) FROM products WHERE score_summary IS NOT NULL;
   ```
2. **"What shipped" report** (Rule 4) emitted at crawl close via a Scrapy
   `spider_closed` signal handler — includes the **SKUs newly populated with
   score_max** line (the number that matters), not just rows written.
3. **Write-time invariant** (`InvariantPipeline`): `supporting_text in body`
   before the `SqlitePipeline` ever sees the item. Failures increment a
   parser-bug stat and drop the item with a log line, never silently.
4. **Precision canary** (`scripts/critic_reviews_canary.py`): run the 7 spiders
   against the 50-SKU recon set, diff extracted vs `results_merged.json`, print
   a confusion matrix. **Gate: precision ≥ 90%** before any full backfill
   (Rule 10). If < 90%, LLM verification is the v2 escalation (old §12 trigger).
5. **Rule 9 — refresh the live export.** The backfill job's final step calls
   `scripts/refresh_live_export.py`. Without it the UI reads stale JSON and
   "I don't see the change" recurs. Default-on; `--no-refresh-export` for staging.
6. **Rule 7 — browser walkthrough** on 5 canary SKUs: `npm run dev`, open
   `/product/<id>` for each, confirm badges render, attribution correct,
   outbound links open with `rel="noopener nofollow ugc"`.

## 12. ~5-day plan

| Day | Deliverable | Verification gate |
|---|---|---|
| **0** | Send Levine email (CT→v2, background). `pip install -r requirements-scraper.txt`. Scaffold `scraper/` Scrapy project; `settings.py` politeness; `catalog.py` reads triplets from products.db. | `scrapy list` runs; catalog prints N triplets. |
| **1** | Port `extract/` (score_patterns, scale_conversion, critic_registry, binder) verbatim from old §7 as pure functions. `items.py`, `pipelines.py` (Extraction + Invariant + Sqlite). `persist/schema.sql` applied to products.db. Unit tests for extraction/binding (no network). | `pytest tests/critic_reviews/unit` green; invariant rejects a crafted bad row. |
| **2** | `BaseCriticSpider` + Wine Enthusiast spider (highest yield). Golden-fixture parser tests. Canary subset crawl writes real rows to `critic_scores`. | `SELECT count(*) FROM critic_scores` > 0 after WE canary crawl. |
| **3** | Remaining spiders: WineAlign, Natalie MacLean, The Real Review, Whiskybase, Master of Malt, Distiller. Per-source fixtures + Playwright decision per site. | Each spider yields ≥1 row on its canary SKU. |
| **4** | `refresh_products_summary.py` (critic_scores → score_max/score_summary). Extend `app/api/products/[id]/route.ts` with `reviews[]`. `CriticScoreBadges.tsx`. Run `refresh_live_export.py`. Precision canary on 50-SKU set. | Precision ≥ 90% gate. `curl /api/products/<id> | jq '.reviews'` non-empty. Browser walkthrough (Rule 7) on 5 SKUs signed off. |
| **5+** | Full backfill kickoff (background, `JOBDIR`-resumable, ~5-10 days wall). Final "what shipped" report + count probe + live-export refresh. | Rule 4 report shows SKUs-newly-populated count; UI shows badges. |

## 13. Risks

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | A source is JS-rendered; plain Scrapy gets empty body | M | Per-source view-source check at impl; flip that spider to scrapy-playwright. Isolated to one spider. |
| 2 | Regex binds wrong score on multi-wine pages | H | Producer-proximity + nearest-vintage binding (old §7.2). Measured on canary; LLM verify is v2. |
| 3 | Precision < 90% on canary | M | Gate blocks backfill (Rule 10). Tune patterns; LLM verify is the documented v2 escalation. |
| 4 | Rate-limit ban from a source | M | AutoThrottle + RetryMiddleware + CloseSpider-on-threshold; per-source delay override in YAML. |
| 5 | `refresh_live_export.py` not run → stale UI | M | Backfill final step runs it by default (Rule 9). |
| 6 | Coverage lands below ~50% without CT | L | Honest invisible empty state; CT in v2 restores ~64%. |
| 7 | scrapy-playwright pulls heavy browser deps into env | L | Kept in separate `requirements-scraper.txt`; main app env untouched. |

## 14. Open items (small, non-blocking)

- Per-source: confirm score is in raw HTML (plain Scrapy) vs JS-rendered
  (Playwright) — a 2-minute view-source check per site at implementation.
- Wine Enthusiast / WineAlign / etc. in-site search endpoint shape — verify the
  `?s=<query>` HTML is parseable on 5 known articles before writing each spider.
- Exact `products` columns for the binding join (`brand`, `vintage`) — confirm
  names against the live products.db schema on day 1 (old §6 assumed `brand`).

None gate the spec.
