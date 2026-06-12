# Critic Score Harvester — v1 Design (slim, evidence-driven)

**Date:** 2026-06-03
**Status:** Draft — pending spec review + user approval
**Branch:** `feat/critic-score-harvester`
**Catalog size at design time:** 11,436 products (7,954 wine + ~2,000 spirits + accessories)
**Estimated effort:** 2-3 weeks single developer

This spec is the slim version that emerged from a 50-SKU public-web reality check. The earlier ambitious draft (license classes, era-aware critic abbreviation, multi-stage LLM verification, drift canaries, SearxNG fallback) was over-engineered for the evidence: 64% of catalog has public critic data concentrated in ~10 source domains and ~5 critics. This v1 targets that reality directly.

If precision/coverage on a small canary turns out to need more sophistication, we add it deliberately in v2 — guided by the same evidence-driven approach, not the abstract one.

---

## 1. What we're building

For every wine and spirit SKU in `products.db`, find any publicly-published critic score (Wine Enthusiast 91, James Suckling 94, Whisky Advocate 90, IWSC Silver, etc.), persist it with attribution and a click-through URL, and display it as a small badge on the product detail page.

**Goals:**
1. Surface real critic signal on ~60-65% of SKUs (the reality-check evidence number).
2. Honest "no public reviews found" on the remainder, not a fake number.
3. Zero payment, zero credentials, zero proxies, zero LLM cost in v1.
4. Persist enough that we can later add LLM-based extraction quality boosts without re-scraping.

**Non-goals (v1):**
- Wine-Searcher, Vivino, paywalled critics, logged-in scraping.
- LLM verification (defer until we have a regex precision number from the canary).
- Per-vintage / per-release / per-batch UX subtleties beyond "show the vintage we scraped, if any".
- Cross-vintage rollups, cross-scale averages, recommendation_strength labels.
- Critic identity normalization tables (we store critic name as a string; map later if needed).
- Real-time freshness or new-SKU hooks (quarterly manual refresh is fine for v1).

---

## 2. Evidence from the Stage 0 reality check

50 SKUs, stratified across 8 tiers, real web searches. Stored at `data/critic_reviews_recon/results_merged.json`.

| Tier | n | Useful% |
|---|---:|---:|
| Famous wine (≥5000 THB) | 8 | 75% |
| Mid wine (1500-4999 THB) | 10 | 50% |
| Mainstream wine (500-1499 THB) | 8 | 75% |
| Budget wine (<500 THB) | 5 | 40% |
| Champagne / Sparkling | 5 | 60% |
| Whisky | 6 | 83% |
| Sake/Shochu | 4 | 25% |
| Gin/Vodka/Rum | 4 | 100% |
| **OVERALL** | **50** | **64%** |

Top source domains (frequency across the 50-SKU sample):
1. vivino.com (22) — crowd ratings, banned for scraping → SKIP
2. wine-searcher.com (19) — aggregator, anti-bot + legal risk → SKIP
3. **cellartracker.com (16)** — community + critic, has an API, friendly
4. **wineenthusiast.com (10)** — pro critic, free articles
5. wine.com (7) — US retailer, quotes critic scores in product copy
6. **nataliemaclean.com (6)** — pro critic, friendly site
7. **whiskybase.com (6)** — whisky-specific
8. **winealign.com (5)** — multi-critic aggregator (CA)
9. **therealreview.com (4)** — Australia/NZ critics
10. **masterofmalt.com (4)** — whisky retailer, quotes scores
11. **jamessuckling.com (3)** — pro wine critic
12. **gotrum.com (3)** — rum specialty

The 8 boldface domains are the v1 source set. The two excluded (Vivino, Wine-Searcher) carry too much risk for the limited extra coverage they'd add.

Top critics surfaced (across all 50 SKUs):
- Wine Enthusiast (9), Natalie MacLean (6), WineAlign (4), James Suckling (4), Whiskybase community (4), Got Rum? (3), Wine Spectator (2), Decanter (2), Drinkhacker (2), The Real Review (2), Master of Malt (2).

Single most load-bearing critic: **Wine Enthusiast** (~18% of all mentions). Whisky Advocate appears in Whisky Advocate-specific results but didn't surface in the broad sample; should be added as a 9th source.

---

## 3. Source set (v1)

8 source adapters, ranked by expected catalog yield from the recon evidence:

| # | Source | License posture | Fetch method | Auth | Categories covered |
|---|---|---|---|---|---|
| 1 | CellarTracker | Use the documented API (Eric Levine has historically granted research/commercial access for free) | HTTPS API | API key | Wine — community + some pro |
| 2 | Wine Enthusiast | Score-only (`facts_only`, *Feist* fact protection) | HTTPS GET | None | Wine + some spirits |
| 3 | Natalie MacLean | Score-only | HTTPS GET | None | Wine |
| 4 | WineAlign | Score-only | HTTPS GET | None | Wine |
| 5 | The Real Review | Score-only | HTTPS GET | None | Wine (AU/NZ) |
| 6 | Whiskybase | Score-only | HTTPS GET | None | Whisky |
| 7 | Master of Malt | Score-only (their editorial scores; quoted critic scores → attributed to original critic) | HTTPS GET | None | Whisky/spirits |
| 8 | Distiller.com | Score-only | HTTPS GET | None | Spirits |

**CellarTracker API access:** the spec assumes the API can be obtained for free for our use case. If outreach fails or terms become incompatible, CellarTracker falls back to no-source (the spec already plans for 30%+ "no data" on long tail; losing CT shifts a portion to that bucket and we cope).

**Wine Enthusiast as cornerstone:** they have a public review archive with stable URL patterns (`/buying-guide/<wine-slug>/`). Adapter #2 is the highest-yield single source after CellarTracker.

**Why not 10+ sources:** the top 8 cover ~85% of total observed mentions. The long-tail sites (each appearing 1-2 times in the 50-SKU sample) cost a parser to build and yield very little. Cut them.

---

## 4. Architecture (deliberately simple)

Single-language stack (Python), no new infra, reuses existing patterns from `lib/curation/` and `lib/enrichment/`.

```
                ┌──────────────────────────┐
                │ Catalog: distinct        │
                │ (producer, name, vintage)│ ◀── products.db
                │ from products.db         │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ Per-source adapters      │
                │ (8 of them, in parallel  │
                │  per source, sequential  │
                │  across sources)         │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ Regex extractor          │
                │ (score patterns +        │
                │  critic-name patterns)   │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ critic_scores table      │ ◀── new table in products.db
                │ (one row per             │     (NOT a new database)
                │  found score)            │
                └────────────┬─────────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ products.score_max +     │ ◀── reuses existing columns
                │ products.score_summary   │     (currently empty)
                │ are updated from         │
                │ critic_scores            │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │ GET /api/products/<sku>  │
                │ surface adds reviews[]   │
                │ → UI badges              │
                └──────────────────────────┘
```

**Key simplifications vs the original draft:**
- One database, not two. `critic_scores` is a new table in the existing `products.db`.
- No separate license-class table. Each source adapter declares its license posture in code; the policy is in the adapter, not the row.
- No discovery layer. Each adapter constructs URLs deterministically from `(producer_canonical, cuvée, vintage)`. 404 → move on.
- No LLM in v1. Regex only. Add LLM later if precision turns out poor on the canary.
- No `release_id` / `batch_id` columns. The vintage column handles vintage; NV / batch wines just have NULL vintage and we accept the precision loss in v1. Schema upgrade is cheap if evidence later demands it.

---

## 5. Module layout

```
lib/critic_reviews/
├── __init__.py
├── catalog.py                  # distinct (producer, cuvée, vintage) from products.db
├── sources/
│   ├── __init__.py
│   ├── base.py                 # Source protocol
│   ├── cellartracker.py        # API client
│   ├── wine_enthusiast.py
│   ├── natalie_maclean.py
│   ├── winealign.py
│   ├── real_review.py
│   ├── whiskybase.py
│   ├── master_of_malt.py
│   └── distiller.py
├── extract/
│   ├── score_patterns.py       # regex for "JS 95", "Whisky Advocate 90", "91/100", "16.5/20", "IWSC Silver"
│   └── extractor.py            # pure: (html or text, source_meta) → list[ExtractedScore]
├── fetch/
│   └── http_client.py          # polite httpx wrapper: per-domain rate limit, identifying UA, retry-with-backoff, robots.txt check
├── persist/
│   ├── schema.sql              # critic_scores table DDL
│   └── repository.py           # typed accessors
├── refresh_products_summary.py # recompute products.score_max / score_summary from critic_scores
└── jobs/
    ├── backfill.py             # one-shot backfill across all sources
    └── refresh.py              # quarterly re-scan

scripts/
└── critic_reviews_canary.py    # 5-SKU canary harness for tuning per CLAUDE.md Rule 10

app/api/products/[sku]/route.ts # extend existing route to include reviews[] from critic_scores
components/product/CriticScoreBadges.tsx  # new component

tests/critic_reviews/
├── fixtures/<source>/          # golden HTML / API response samples per source
└── unit/                       # per-source parser tests
```

---

## 6. Data model

One new table in the existing `data/db/products.db`:

```sql
CREATE TABLE critic_scores (
  id            TEXT PRIMARY KEY,          -- uuid
  sku           TEXT,                       -- nullable: scores bind to producer+cuvée+vintage, not directly to SKU
  producer      TEXT NOT NULL,              -- canonical (lower(trim))
  cuvee         TEXT NOT NULL,              -- canonical
  vintage       INTEGER,                    -- nullable for NV / batch / undetermined

  source        TEXT NOT NULL,              -- 'cellartracker' / 'wine_enthusiast' / ...
  source_url    TEXT NOT NULL,              -- the page or API row this came from
  source_review_id TEXT,                    -- source's own id when present (for refresh dedup)

  critic        TEXT NOT NULL,              -- 'James Suckling' / 'Wine Enthusiast' / 'community' / 'IWSC' / ...
  score_native  TEXT NOT NULL,              -- as published: '94', '17.5/20', 'IWSC Silver', '93+', etc.
  score_scale   TEXT NOT NULL,              -- '100pt' / '20pt' / '5star' / 'medal' / 'community'
  score_value   REAL,                       -- normalized only when scale ∈ {100pt, 20pt}: nullable for medals/community

  supporting_text TEXT,                     -- ≤200-char literal substring from the source page proving the binding
  signal_class  TEXT NOT NULL,              -- 'critic_numeric' / 'critic_text' / 'community' / 'medal'
  signal_tier   INTEGER NOT NULL,           -- 1=major pro critic, 2=specialty/regional critic, 3=community, 4=medal

  fetched_at    TEXT NOT NULL,              -- ISO datetime
  confidence    REAL NOT NULL DEFAULT 0.7,  -- starting point; tuned on canary, may be 1.0 for licensed (CT) feeds

  CHECK (score_scale IN ('100pt','20pt','5star','medal','community')),
  CHECK (signal_class IN ('critic_numeric','critic_text','community','medal')),
  CHECK (signal_tier BETWEEN 1 AND 4)
);

CREATE INDEX idx_critic_scores_producer_cuvee_vintage ON critic_scores(producer, cuvee, vintage);
CREATE INDEX idx_critic_scores_source ON critic_scores(source, fetched_at);
CREATE INDEX idx_critic_scores_sku ON critic_scores(sku) WHERE sku IS NOT NULL;
```

**Reuse of existing columns in `products`:**
- `score_max` (REAL) — highest normalized 100pt-equivalent across all sources for this SKU.
- `score_summary` (TEXT) — short JSON: `{"critics": ["JS 94", "WE 91"], "medals": ["IWSC Silver"], "community": 4.2, "primary_source": "wine_enthusiast"}`.

Both are populated by `refresh_products_summary.py`, run after each backfill or refresh job. The bulk export (`scripts/refresh_live_export.py`) picks them up automatically — **no separate API endpoint needed for v1** because the score badges can ride along the existing product detail surface.

**SKU binding strategy:** keep `critic_scores.sku` nullable. The natural key is `(producer, cuvee, vintage)`. At display time the product UI looks up the matching row by producer+cuvée+vintage. For SKUs where vintage is "Current vintage" or NV, we display the most recent vintage's row we have, or pool by NULL vintage. No `vintage_policy` column in v1 — that's a v2 sophistication.

---

## 7. Extraction (regex only in v1)

### 7.1 Score patterns

A single Python file `lib/critic_reviews/extract/score_patterns.py` with named-capture regexes:

```python
PATTERNS = [
    # "JS 95", "WA 96", "WS 94" — joined-abbreviation form
    re.compile(r'\b(?P<critic>JS|WA|WS|JR|RP|VN|WE|DEC|JD)\s*(?P<score>\d{2,3})\b'),

    # "James Suckling 95 points", "Wine Enthusiast: 91" — name + number
    re.compile(r'(?P<critic>James Suckling|Wine Enthusiast|Wine Spectator|Wine Advocate|Robert Parker|Decanter|Vinous|Jancis Robinson|Natalie MacLean|WineAlign|The Real Review|James Halliday|Whisky Advocate|Master of Malt|Distiller)\s*[:\s]\s*(?P<score>\d{2,3})\b'),

    # "94/100" / "17.5/20"
    re.compile(r'\b(?P<score>\d{2,3}(?:\.\d)?)\s*/\s*(?P<denom>100|20)\b'),

    # Medals: "IWSC Silver", "Gold Medal", "Decanter Bronze"
    re.compile(r'\b(?P<authority>IWSC|Decanter World Wine Awards|DWWA|International Wine Challenge|IWC|Bartender Spirits Awards|San Francisco World Spirits|SFWSC)\s+(?P<medal>Gold|Silver|Bronze|Platinum)\b'),
]
```

### 7.2 Binding rule (which score is "for the wine we're looking up")

Each source adapter passes its fetched page to the extractor with a `wine_context` describing what we asked for: `(producer, cuvée, vintage)`. The extractor:

1. Runs all patterns against the page text.
2. For each match, captures a 200-char text window (the `supporting_text` column).
3. **Producer-name proximity filter**: keep the match only if the producer name (or any aliasthe brand-curation library knows) appears within the same paragraph (or in the page title / H1 / OG metadata). This is the v1 binding heuristic.
4. **Vintage filter** (when applicable): if the source URL or page title contains a vintage and our `wine_context.vintage` is non-NULL, require match.
5. Emit one `ExtractedScore` per surviving match.

**Anti-hallucination property:** every persisted score's `supporting_text` is a literal substring of the source page. The persistence layer asserts `supporting_text in fetched_html` (or `in fetched_text` for API sources). Rows that fail are rejected as parser bugs, logged, and skipped.

### 7.3 What we explicitly do NOT do in v1

- **No LLM verification.** First measure regex precision on the canary; only add LLM if precision < 90% and the bad cases are clearly LLM-fixable.
- **No multi-source corroboration scoring.** Each row stands alone with its source's confidence.
- **No critic era handling.** "RP" maps to "Robert Parker / Wine Advocate" with no date logic; if Galloni-at-Vinous-vs-WA confusion appears in real data, we add the era logic to v1.1.

---

## 8. Fetch politeness

Per-source defaults (overridable):
- Rate limit: **1 request per 3 seconds** (one source at a time; can run multiple sources in parallel).
- Daily window: 4 hours / source / day.
- Identifying UA: `WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)` (publish the policy page when v1 ships).
- robots.txt check: cached daily; if disallowed, source is paused with a log entry.
- HTTP retry: 3 attempts, exponential backoff 5s → 25s → 125s on 5xx; 1 retry on 429 with `Retry-After`; 0 retries on 4xx (other than 429).
- Backfill is **per-item resumable** via a `scrape_progress` table keyed on `(source, producer, cuvee, vintage)` with status `pending | done | transient_fail | permanent_skip`.

Estimated backfill time at 1 req / 3s × 4hr / day across 8 sources processing ~5,000 distinct (producer, cuvée, vintage) triplets: **~7-10 days of background runs**. Fine.

---

## 9. UI

Smallest viable surface: a `CriticScoreBadges` component on the existing product detail panel.

### 9.1 What ships

For each SKU, after binding, the API returns (already shape, just adding `reviews[]`):

```json
{
  "sku": "WRW5031AD",
  "name": "Pio Cesare Barolo Mosconi DOCG 2020",
  ...existing fields...,
  "reviews": [
    { "critic": "James Suckling", "score_native": "99", "score_scale": "100pt",
      "score_value": 99, "source_url": "https://jamessuckling.com/...",
      "signal_class": "critic_numeric", "signal_tier": 1 },
    { "critic": "Wine Advocate", "score_native": "94", "score_scale": "100pt",
      "score_value": 94, "source_url": "https://...",
      "signal_class": "critic_numeric", "signal_tier": 1 }
  ],
  "score_max": 99,
  "score_summary": "JS 99 · WA 94"
}
```

### 9.2 UI rules

- Render one badge per `reviews[]` entry, sorted by `signal_tier` then `score_value` descending.
- Badge content: `<critic shortform> <score_native>`, e.g. `JS 99` / `Whisky Advocate 90` / `IWSC Silver`.
- Hover/tap: tooltip showing full critic name + "View source" outbound link.
- Click on link → outbound `target="_blank" rel="noopener nofollow ugc"` to `source_url`.
- **No quoted prose displayed.** Score badges only. (`supporting_text` is stored internally, never rendered.)
- Empty state: when `reviews[]` is empty, the section is hidden, not "no reviews found" — keeps the panel clean for the ~36% of SKUs with no data.

### 9.3 What's deliberately not done in v1

- No vintage selector for "current vintage" SKUs. We display whatever vintage's row we have, with the vintage shown inline. If multiple vintages exist for the same producer+cuvée and the SKU is "Current vintage", we show the most recent. Edge cases are accepted v1 limitations.
- No score history chart.
- No community-vs-pro split visualization.
- No "recommendation strength" label.

---

## 10. Verification (CLAUDE.md compliance)

The two rules that govern this project (1 and 4 in your CLAUDE.md) drive the verification design:

1. **After every job, run a destination-table count probe.**
   ```sql
   SELECT count(*) FROM critic_scores WHERE fetched_at > :job_start;
   SELECT count(*) FROM products WHERE score_summary IS NOT NULL;
   ```
   The job log ends with a "what shipped" report (Rule 4):
   ```
   Backfill 2026-06-15:
     Sources processed:                  8
     Distinct (producer, cuvée, vint):   5,041
     Pages fetched (total):              28,704
     Pages with ≥1 extracted score:      11,883 (41%)
     Critic_scores rows written:         18,221
     SKUs newly populated (score_max):   7,318  ← THIS IS THE NUMBER THAT MATTERS
     Estimated catalog coverage:         64%
   ```
2. **Curl-the-API smoke check** at end of every job:
   ```
   curl /api/products/<canary_sku> | jq '.reviews | length'
   ```
   Returns non-zero for at least one canary SKU per source.
3. **Write-time invariant assertion**: every `critic_scores` insert checks `supporting_text in fetched_payload` before persisting. Failure rejects the row, increments the parser-bug counter, does not silently drop.
4. **5-SKU canary** per CLAUDE.md Rule 10 before any full backfill:
   - One famous wine (high data density)
   - One mid-tier wine
   - One mainstream wine
   - One whisky
   - One Thai-market SKU (low data density expected)
   Run the full pipeline, eyeball the UI, sign off, only then scale.

---

## 11. Implementation plan (the 2-3 weeks)

### Week 1 — Foundation
- **Day 1:** schema + persistence repository + write-time invariant assertion (`critic_scores` table, `repository.py`, `assertions.py`).
- **Day 2:** `score_patterns.py` + `extractor.py` + unit tests with golden fixtures.
- **Day 3:** `http_client.py` with politeness defaults + robots.txt check + retry logic.
- **Day 4-5:** **CellarTracker adapter** (the API one; cleanest, most data, no scraping risk). Includes API-key handling, dedup against `source_review_id`. End of day 5: 5-SKU canary against CT only — first data lands.

### Week 2 — Editorial scrapers
- **Day 6:** Wine Enthusiast adapter (highest yield public source).
- **Day 7:** Natalie MacLean + WineAlign adapters.
- **Day 8:** The Real Review adapter.
- **Day 9:** Whiskybase + Master of Malt adapters.
- **Day 10:** Distiller adapter + per-source canary runs.

### Week 3 — Integration & ship
- **Day 11:** `refresh_products_summary.py` — populates `products.score_max` / `score_summary` from `critic_scores`.
- **Day 12:** API extension (`app/api/products/[sku]/route.ts`) + `CriticScoreBadges.tsx` component. Browser walkthrough on canary SKUs (CLAUDE.md Rule 7).
- **Day 13:** Full 5-source canary (one SKU each per Rule 10), measure precision on the labeled 50-SKU recon set as ground truth.
- **Day 14:** Tune regex thresholds, fix top 5 false-positive patterns surfaced in day 13.
- **Day 15:** Backfill kickoff (background, ~7-10 days to complete on its own).

**Buffer / known unknowns:** add 3-5 days for the inevitable per-source parser quirks. Total honest budget: **2.5-3.5 weeks of focused work**, then a week of background backfill.

---

## 12. Decision gates and v2 triggers

The slim spec is designed so the next layer of complexity gets added **only if evidence shows we need it**:

| Trigger | v2 addition |
|---|---|
| Regex precision on canary < 90% AND mistakes are LLM-fixable | Add LLM verification (`lib/critic_reviews/extract/llm_verifier.py`) |
| Cross-vintage SKU binding produces noticeable user complaints | Add `vintage_policy` column + per-vintage UI cards |
| Wine-Searcher API becomes affordable / paid CellarTracker tier added | Add `license` column, generalize the source interface |
| Crowd-vs-pro signal needs visual separation | Promote `signal_class` to UI rule |
| New-SKU velocity > 50/week | Add the diff-based new-SKU hook |
| Catalog wine count grows past ~15k SKUs | Add the canonical critic identity table |
| Champagne NV / cask-strength batch SKUs get bad reviews from wrong release | Add `release_id` / `batch_id` columns |

Each is a clean additive change against the slim schema — no rework.

---

## 13. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | CellarTracker API access not granted | M | Fallback: drop CT, coverage shifts from ~64% to ~50%. Spec survives. |
| 2 | Wine Enthusiast URL pattern changes | M | DOM-canary as part of weekly job. Fixture-based parser update. |
| 3 | Regex binds the wrong score to wrong wine on round-up pages | H | Producer-proximity filter (§7.2) is the v1 mitigation. Measured on canary; LLM verify is the v2 escalation. |
| 4 | Long-tail Thai/sake SKUs get nothing → user frustration | L | UI empty state is invisible, not "no data" error. Honest non-coverage. |
| 5 | Rate-limit ban from a source | M | Per-source circuit breaker: pause source on >5% 429/403 in a 50-request window. |
| 6 | A scraped score is later removed from the source | L | `fetched_at` lets us age out; quarterly refresh re-validates. |
| 7 | Critic identity collisions ("WA" = Wine Advocate publication vs critic) | L | Store as string in v1; correct in v2 if it becomes painful. |
| 8 | `refresh_live_export.py` not run after backfill → UI doesn't show the change | M | The backfill job calls `refresh_live_export.py` automatically (CLAUDE.md Rule 9). |
| 9 | Effort estimate slips | M | Spec budgets 2.5-3.5 weeks; if week 1 misses CT canary milestone, kill point. |

---

## 14. What changed from the earlier (longer) draft

Everything load-bearing survived. Everything speculative was cut. Specifically:

- **Cut:** SearxNG fallback, RSS+sitemap discovery layer, page-class enum, era-aware critic abbreviation, multi-stage confidence model, drift canary infra, release_id/batch_id columns, separate critic identity table, license_class table, recommendation_strength rule, vintage_policy machinery, per-scale cross-source aggregation, the dedicated `/api/products/<sku>/reviews` route, the separate `critic_reviews.db`, the v2 features extraction table.
- **Kept:** decoupled producer+cuvée binding (no SKU FK), score-only display for editorial sources, anti-hallucination via literal substring, 5-SKU canary, "what shipped" report, robots.txt compliance, identifying UA + outbound link mandatory.
- **Added (from recon evidence):** competition medals as a first-class signal (`signal_class = 'medal'`), specific source list grounded in domain frequency, week-by-week implementation plan.

---

## 15. Open items (small, resolvable during implementation)

- Exact CellarTracker API endpoint path + auth header format — confirm during day-4 implementation.
- Wine Enthusiast URL slug pattern — verify on 5 known articles before the day-6 implementation.
- Whether `data/live_products_export.json` refresh should fire automatically after a backfill or be a manual operator step. Default: automatic; operator can disable in config.

These are intentionally small. None gate the spec.
