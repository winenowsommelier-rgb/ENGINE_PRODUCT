# Track 4a (Spirits Scraper) — Recon & Spec-Delta, 2026-06-23

Read-only recon for the next session that builds the spirits spiders. The spec
(`specs/2026-06-16-critic-score-harvester-scrapy-design.md` §6–§14, §18.4a) is the
authority; this records what's drifted or needs confirming **before** the build, so
the build doesn't start from stale numbers. Pairs with [[project_critic_scraper_handoff]].

## Prerequisites (verified)
- **scrapy / scrapy-playwright: NOT installed.** Day-0 = `pip install -r requirements-scraper.txt` (to be created; pin `scrapy>=2.11,<3`, `scrapy-playwright>=0.0.40`).
- **`scraper/`, `requirements-scraper.txt`, `config/scraper/` : ABSENT** — fully greenfield, matches spec §7.
- **Python 3.9.6** — matches the spec pin exactly.
- **Canary set present**: `data/critic_reviews_recon/results_merged.json`, 50 records, keys `sku, tier, found, critics, scores, domains, quality`.

## Spirits gap scope (live export, the real numbers — DIFFERS from a raw DB query)
The catalog grouping lives in the **live export `category_group` field (derived at refresh time), NOT a `products` DB column** — the SQLite `products` table has `classification`, `liquor_main_type`, `blend_type`, `wine_classification` but NO `category_group`. So spec §6's "category-aware `catalog.py` reads products.db" must either read the export or re-derive `groupForProduct()`; it CANNOT `SELECT category_group FROM products`. **First build-time delta to resolve.**

Unscored counts by `category_group` (100% of each is unscored — confirms "zero spirits scored today"):
| group | unscored |
|---|---|
| Spirits | 1,177 |
| Whisky | 847 |
| Sake & Asian | 663 |
| Liqueur | 378 |
| (Beer & RTD) | 232 |
| (Wine) | 5,433 |
| (Accessories) | 893 — EXCLUDE |
| (Cigars) | 102 — EXCLUDE |
| (Non-Alcoholic) | 151 — EXCLUDE |

**Spirit-family target ≈ 3,065** (Spirits+Whisky+Sake+Liqueur), in line with the spec's ~3,297. Use the export's `category_group` as the gate — it already separates accessories/cigars/non-alc, cleaner than the `ACCESSORY_PREFIXES` substring approach (still cross-check prefixes per [[project_accessory_sku_prefixes]]).

## Source coverage vs the gap (the real risk)
v1 spirit sources (spec §8): **Whiskybase, Master of Malt, Distiller** — all whisky/general-spirits.
- **Whisky (847)**: well-covered (Whiskybase deterministic-URL + Master of Malt). Highest-ROI, cleanest.
- **Spirits (1,177) + Liqueur (378)**: partial (Master of Malt / Distiller cover some gin/rum/etc.; liqueurs spotty).
- **Sake & Asian (663): NO v1 SOURCE.** Second-largest spirit bucket, entirely uncovered. This is a **documented v1 non-coverage**, not a silent miss (Rule 2) — must be stated in the build's "what shipped" report. ~663 SKUs will get 0 scores no matter what.

## Thin-canary problem (confirmed — spec §18.4a warning is accurate)
Canary spirit strata: **whisky 6 / sake_shochu 4 / gin_vodka_rum 4 = 14 spirit SKUs**.
Spirit-relevant domains in the canary are sparse: whiskybase 6, masterofmalt 4. Sake/shochu (4) can NEVER be validated (no source). So the §11.5 90% precision gate effectively rests on ~10 whisky+gin/rum SKUs.
**Mandatory before the gate certifies the spirits backfill: hand-label ~15–20 more spirit SKUs** (whisky + gin/vodka/rum) so the gate has a real basis — or explicitly accept + log a lower-confidence spirits canary (Rule 2). Sake/shochu = documented non-coverage.

## Hard dependencies / sequencing
- **Track 2 (PR #35) must merge first** — the spirits scraper writes `critic_scores` rows that the §16 merge (`lib/critic_reviews/refresh_products_summary.py`) consumes. Build 4a on top of merged Track 2, not main-without-it.
- **Build in an ISOLATED git worktree** ([[feedback_catalog_worktree_isolation]]) — the shared checkout churned badly on 2026-06-23 (branch flipped main→feature→fix/sale-price-tweaks mid-session, DB reverted, foreign uncommitted files). A worktree is not optional for a multi-day build here. Symlink node_modules; the scraper is Python so it mostly needs the .venv + products.db (read-only for catalog.py).
- Network access required (live scraping); politeness per spec §10 (AutoThrottle, ROBOTSTXT_OBEY, custom RetryAfterMiddleware for 429).

## Day-0 gates still owed (spec §14, per source — NOT yet done)
For each of Whiskybase / Master of Malt / Distiller, record in the job config BEFORE writing the spider:
1. Is the search/detail path **robots-allowed**? (robots-disallowed → deterministic-URL fallback or drop-with-logged-reason; never silent zero rows.)
2. Is the score in **raw HTML or JS-rendered**? (raw → plain Scrapy; JS → scrapy-playwright for that spider only.)
3. **Binding-column gate**: confirm the actual `products` join columns. Spec §6 assumed `producer`/`cuvee`/`vintage`; the DB has `liquor_main_type`/`blend_type` and the rich `critic_scores` now has nullable `sku` + `producer`/`cuvee`. Confirm how a scraped spirit row binds (sku? producer+cuvee?) against the real schema before the precision canary runs (§14).

## Recommended build order for the next session
1. Merge PR #35. Create isolated worktree. `pip install` scraper deps.
2. Scaffold `scraper/` (settings, items, pipelines w/ WAL+retry, catalog.py reading export's category_group).
3. Port `extract/` pure functions (spec §7 verbatim) + unit tests.
4. **Whiskybase spider first** (deterministic URL, cleanest) → canary writes real rows.
5. Master of Malt + Distiller.
6. Hand-label +15–20 spirit SKUs → run §11.5 canary (spirits stratum + no-vintage) + §11 rank-sanity probe. **GATE: ≥90% both strata** before wine (Track 5).
7. Verify at the Layer-3 live export (Rule 1), refresh export (Rule 9), "what shipped" report incl. the Sake & Asian non-coverage line (Rule 2/4).
