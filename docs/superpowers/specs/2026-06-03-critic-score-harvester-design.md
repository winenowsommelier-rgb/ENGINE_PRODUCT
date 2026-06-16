# Critic Score Harvester — v1 Design (slim, evidence-driven)

> **⚠️ SUPERSEDED (2026-06-16) by [2026-06-16-critic-score-harvester-scrapy-design.md](2026-06-16-critic-score-harvester-scrapy-design.md).**
> The new design rebuilds v1 on **Scrapy** (per CLAUDE.md Rule 11), throwing away
> the hand-rolled HTTP client / rate limiter / retry / resumable-backfill / robots
> cache / 8 bespoke adapters. **This document is retained as the source of truth for
> the recon evidence (§2), the `critic_scores` schema (§6), the regex patterns and
> binding rules (§7), and the UI rules (§9)** — all of which the Scrapy design keeps
> verbatim and references back to here. Read this for the *what*, the new doc for the *how*.
>
> **⏸️ Both specs PAUSED (2026-06-16).** A working CSV-fed critic-score system is
> already in production (`scripts/load_critic_scores_from_csv.py`, 3,144 rows,
> 1,550 products showing badges). The scraper build is on hold pending a
> coverage/ROI call — see the Pause decision banner in the Scrapy doc. Note: the
> §6 schema below is the *proposed* schema; the **live** `critic_scores` table is
> simpler and sku-keyed (see that banner). Do not build from either spec until the
> pause is resolved.

**Date:** 2026-06-03
**Status:** Superseded by the 2026-06-16 Scrapy rebuild (see banner above)
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
| 7 | Master of Malt | Score-only | HTTPS GET | None | Whisky/spirits |
| 8 | Distiller.com | Score-only | HTTPS GET | None | Spirits |

**CellarTracker API access — go/no-go gate (Day 0):**

Email Eric Levine within the first 24 hours of project start. If granted: full CT adapter via API. If denied or no response within 7 days, the project enters CT-fallback mode:

- **CT fallback:** scrape CT's public tasting-note pages (no login required) under the same `facts_only` posture as the editorial sources. URL pattern: `https://www.cellartracker.com/wine.asp?iWine=<id>` — `iWine` ids are discoverable via CT's public search HTML page. Extract score + reviewer name + URL only. No prose persisted.
- **Coverage impact:** API gets us ~16 of the 50 recon SKUs (top domain). HTML scraping gets a subset of that — likely ~10 SKUs — because community notes without numeric scores are skipped. Net coverage drops from ~64% to ~55-58%.
- **No-CT mode (worst case):** if CT also rejects scraping or robots.txt forbids it, drop CT entirely. Net coverage drops to ~48-52%. Spec still survives — Wine Enthusiast + WineAlign + Whiskybase pick up most of the wine and spirits signal independently.

Day-0 outreach email is in `scripts/critic_reviews_cellartracker_outreach.txt` (drafted at project start, sent by operator). Implementation does not start until Day 0's outcome is recorded, even if it's "no response yet" with a documented fallback decision.

**Wine Enthusiast URL caveat:** WE buying-guide URLs are slugged from editorial titles, not deterministically derivable from `(producer, cuvée, vintage)`. The WE adapter therefore runs a two-step fetch:

1. **In-site search**: `GET https://www.wineenthusiast.com/?s=<producer>+<cuvée>+<vintage>` (their public search endpoint), parse the result list for buying-guide URLs.
2. **Detail fetch**: for each candidate URL whose result snippet contains the producer name AND (vintage match OR vintage absent on both sides), fetch the article and extract score.

This makes WE one search + N detail fetches per `(producer, cuvée, vintage)` triplet — roughly 2-3× the request budget vs sources with deterministic URLs. Politeness budget in §8 (1 req / 3s, 4hr / day) absorbs this — the adjusted backfill timing in §8 reflects it.

Same in-site-search pattern is used by adapters for Natalie MacLean, WineAlign, The Real Review (all slug-based article URLs). Whiskybase, CellarTracker (API mode), and Distiller use deterministic URLs / IDs and skip the search step.

**Wine Enthusiast as cornerstone:** they have a public review archive with stable URL patterns (`/buying-guide/<wine-slug>/`). Adapter #2 is the highest-yield single source after CellarTracker.

**Why not 10+ sources:** the top 8 cover ~85% of total observed mentions. The long-tail sites (each appearing 1-2 times in the 50-SKU sample) cost a parser to build and yield very little. Cut them.

### 3.1 Source vs critic attribution (provenance rule)

`critic_scores.source` always records **the page we fetched** (where we got the data). `critic_scores.critic` records **who scored the wine** (attribution). These differ when one site quotes another — e.g., Master of Malt's product page quoting "Whisky Advocate 90."

Rules:

- `source` is **always** the domain of the page that contained the score. This is provenance — the URL we can re-verify.
- `critic` is what the regex captured as the scoring authority. For Master of Malt's own editorial scores, `critic` = `Master of Malt`. For an MoM page that quotes "Whisky Advocate 90," `critic` = `Whisky Advocate` and `source` is still `master_of_malt`.
- This means the same `(producer, cuvee, vintage, critic, score)` row may legitimately appear twice with different `source` values if two sites both quote it. Dedup at display time uses `(critic, score_native, vintage)` — keep the highest-confidence row.

### 3.2 Signal-tier mapping (table referenced by §6 and §9)

| Source | Default `signal_tier` | Default `signal_class` |
| --- | --- | --- |
| Wine Enthusiast, Wine Spectator, Wine Advocate, Vinous, Decanter, James Suckling, Jancis Robinson, Whisky Advocate | 1 | `critic_numeric` |
| Natalie MacLean, WineAlign, The Real Review, James Halliday, Master of Malt (editorial), Distiller (editorial), Got Rum? | 2 | `critic_numeric` |
| CellarTracker community, Whiskybase community, Vivino (if ever ingested) | 3 | `community` |
| IWSC, IWC, DWWA, Bartender Spirits Awards, SFWSC, ITI, regional shows | 4 | `medal` |

If a regex pattern surfaces a critic name not in this table, the adapter assigns `signal_tier = 2` by default and logs the new critic for one-time human review (likely a critic worth promoting or a false positive worth blocking).

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

- `score_max` (REAL) — highest normalized 100pt-equivalent across all `signal_tier ≤ 2` rows (pro critics) bound to this SKU. Community scores and medals are excluded from `score_max` because mixing them produces noise.
- `score_summary` (TEXT) — short JSON with a deterministic shape; populated by `refresh_products_summary.py`.

`score_summary` JSON shape (one entry per signal kind, sorted within each list):

```json
{
  "critics":   [{"abbr":"JS","critic":"James Suckling","score_native":"99","score_value":99,"url":"https://..."},
                {"abbr":"WA","critic":"Wine Advocate","score_native":"94","score_value":94,"url":"https://..."}],
  "community": [{"source":"cellartracker","score_native":"93","score_value":93,"count":12}],
  "medals":    [{"authority":"IWSC","medal":"Silver","year":2022,"url":"https://..."}],
  "primary_source": "wine_enthusiast",
  "rows_total": 4,
  "computed_at": "2026-06-15T08:00:00Z"
}
```

**Merge rules** (deterministic, implemented in `refresh_products_summary.py`):

1. **`score_max`** = `max(score_value)` across rows where `signal_tier ≤ 2` AND `score_scale IN ('100pt','20pt')`. 20pt scores convert to 100pt-equivalent via the table-published mapping (see §7.4). NULL if no qualifying row.
2. **`critics` list** = unique `(critic, score_native)` pairs from `signal_class = 'critic_numeric'` rows, sorted by `score_value` descending then `signal_tier` ascending. Capped at 5 entries.
3. **`community` list** = `signal_class = 'community'` rows, one per source. Aggregated count if the source provides it.
4. **`medals` list** = `signal_class = 'medal'` rows, sorted by `signal_tier` then year desc.
5. **`primary_source`** = `source` of the row that contributed `score_max`. If `score_max` is NULL, the most-recent source by `fetched_at`.
6. Rows where `confidence < 0.5` are excluded from all aggregates (audit trail only).
7. Mixed-scale SKUs (e.g., a 100pt AND a 20pt score) appear as separate entries in `critics`; `score_max` is the higher of the two 100pt-equivalents.

The bulk export (`scripts/refresh_live_export.py`) picks `score_max` / `score_summary` up automatically. **No separate API endpoint in v1** — the badges ride the existing product detail surface.

**SKU binding strategy:** keep `critic_scores.sku` nullable. The natural key is `(producer, cuvee, vintage)`. At display/refresh time, the SKU↔row lookup is:

```sql
-- For each SKU, find all critic_scores rows that match its producer+cuvée
-- (canonicalized lower(trim()) on both sides) and vintage policy:
SELECT cs.* FROM critic_scores cs
JOIN products p ON p.sku = :sku
WHERE lower(trim(cs.producer)) = lower(trim(p.brand))
  AND (
    cs.vintage = p.vintage                                -- exact vintage match
    OR (p.vintage IN ('Current vintage','','NV') AND cs.vintage IS NOT NULL)  -- pool all vintages
    OR (p.vintage = '' AND cs.vintage IS NULL)            -- both NV
  )
ORDER BY cs.vintage DESC NULLS LAST, cs.signal_tier ASC;
```

For SKUs whose `vintage = 'Current vintage'`, we pool by producer+cuvée and surface the most-recent-vintage row's data. v1 accepts the precision loss; v2 adds `vintage_policy`.

---

## 7. Extraction (regex only in v1)

### 7.1 Score patterns

A single Python file `lib/critic_reviews/extract/score_patterns.py`. **Patterns are deliberately strict** — favor precision over recall. False positives are worse than misses because every persisted row is shown to a paying customer.

```python
# Anchor tokens that confirm this is a score context, not a stray number
SCORE_CONTEXT = r'(?:points?|pts?|/\s*100|/\s*20|\bscore[d]?\b|\brated\b|\bawards?\b)'

PATTERNS = [
    # Pattern 1 — explicit denominator: "94/100", "17.5/20"
    # Most reliable; no critic context needed since the denom anchors it.
    re.compile(r'\b(?P<score>\d{2,3}(?:\.\d)?)\s*/\s*(?P<denom>100|20)\b'),

    # Pattern 2 — full critic name + score-context word
    # "James Suckling: 95 points", "Wine Enthusiast 91 pts", "Scored 92 by Decanter"
    re.compile(
        r'(?P<critic>James Suckling|Wine Enthusiast|Wine Spectator|Wine Advocate|'
        r'Robert Parker|Decanter|Vinous|Jancis Robinson|Antonio Galloni|Neal Martin|'
        r'Natalie MacLean|WineAlign|The Real Review|James Halliday|'
        r'Whisky Advocate|Master of Malt|Distiller|Whiskybase)'
        r'\s*[:\s\-]{1,4}\s*'
        r'(?P<score>\d{2,3}(?:\.\d)?)'
        r'\s*(?:points?|pts?|/\s*100|/\s*20)?\b',
        re.IGNORECASE,
    ),

    # Pattern 3 — score + critic, reverse order with explicit context
    # "92 points (James Suckling)", "94/100 — Wine Enthusiast"
    re.compile(
        r'\b(?P<score>\d{2,3}(?:\.\d)?)\s*(?:points?|pts?|/\s*100|/\s*20)\s*'
        r'[(\-—:\s]{1,6}\s*'
        r'(?P<critic>James Suckling|Wine Enthusiast|Wine Spectator|Wine Advocate|'
        r'Robert Parker|Decanter|Vinous|Jancis Robinson|Antonio Galloni|Neal Martin|'
        r'Natalie MacLean|WineAlign|The Real Review|James Halliday|'
        r'Whisky Advocate|Master of Malt|Distiller|Whiskybase)',
        re.IGNORECASE,
    ),

    # Pattern 4 — abbreviation form, BUT ONLY when accompanied by /100 or "pts"
    # Rejects "DEC 92" (date) by requiring the score-context anchor.
    re.compile(
        r'\b(?P<critic>JS|WA|WS|JR|RP|VN|WE|DEC|JD|NM|MoM)'
        r'\s+(?P<score>\d{2,3})'
        r'\s*(?:/\s*100|pts?|points?)\b'
    ),

    # Pattern 5 — Medals (competition awards)
    re.compile(
        r'\b(?P<authority>IWSC|Decanter World Wine Awards|DWWA|'
        r'International Wine Challenge|IWC|Bartender Spirits Awards|'
        r'San Francisco World Spirits|SFWSC|International Taste Institute|ITI|'
        r'Hunter Valley Wine Show|Victorian Wine Show|Asian Spirits Masters)'
        r'\s+(?P<medal>Gold|Silver|Bronze|Platinum|Double Gold)\b',
        re.IGNORECASE,
    ),
]

# Score validity constraints (post-match)
def is_plausible_score(score_value: float, scale: str) -> bool:
    if scale == "100pt":
        return 50 <= score_value <= 100   # reject <50 (likely false positive, e.g., "WA 19" = year)
    if scale == "20pt":
        return 10 <= score_value <= 20
    return True
```

**Why this is safer than the original regex sketch:**
- Pattern 1 (`/100`, `/20`) is anchored by the denominator — can't false-positive.
- Pattern 4 (abbreviations like "JS 95") *requires* a score-context anchor (`pts`, `points`, `/100`), eliminating the "DEC 92" (date) and "WE 100" (in "WE 100% recommend") collisions the reviewer flagged.
- Pattern 2 and 3 require a full critic name AND a score-context token (or denominator).
- `is_plausible_score` rejects out-of-range matches.

**Precision target on canary**: ≥90%. Measured against the labeled 50-SKU recon set (`data/critic_reviews_recon/results_merged.json`) which doubles as ground truth.

### 7.2 Binding rule (which score is "for the wine we're looking up")

Each source adapter passes its fetched page to the extractor with a `wine_context` describing what we asked for: `(producer, cuvée, vintage)`. The extractor returns one `ExtractedScore` per surviving match.

**Step 1 — Pre-extract page metadata.** Parse the fetched HTML once to extract:

- `page_title` (HTML `<title>`)
- `page_h1` (first `<h1>` if present)
- `og_title` (`<meta property="og:title">` if present)
- `main_text`: the stripped-text body. Algorithm: drop `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`; for the rest, concatenate `innerText` with `\n\n` between block-level elements (`<p>`, `<div>`, `<li>`, `<h*>`, `<section>`, `<article>`).
- `paragraphs`: `main_text.split("\n\n")` — the v1 working definition of "paragraph" (block-level boundary, not strictly HTML `<p>`).

**Step 2 — Run score patterns** (§7.1) against `main_text`. For each match, record `match_offset` (character offset into `main_text`) and `paragraph_index` (which paragraph the match landed in).

**Step 3 — Producer-name proximity filter** (the v1 binding heuristic; favors precision):

Keep a match only if AT LEAST ONE of the following is true:

- (a) The producer name (or any alias from the brand-curation library) appears in `page_title` OR `page_h1` OR `og_title`. This handles single-wine pages (most retailer / review pages).
- (b) The producer name appears in the same `paragraph_index` as the score match (block-level paragraph proximity, as defined in step 1).
- (c) The producer name appears within `±400` characters of the score match in `main_text` (character-distance fallback for sites that use non-standard markup). 400 chars is roughly 80-100 words — typically the same logical section.

If none hold, the match is discarded.

**Step 4 — Vintage filter** (when applicable):

- If `wine_context.vintage IS NULL`, no vintage check; accept the match.
- If `wine_context.vintage` is set, extract candidate vintage tokens from: `page_title`, `page_h1`, `og_title`, the URL path, and the same paragraph as the match.
- **Single-vintage page** (one distinct vintage token across all sources, or all tokens match): require it equals `wine_context.vintage`. If not, discard.
- **Multi-vintage page** (a vintage report like "Brunello 2016–2020 retrospective"): bind the match to the nearest preceding vintage token in `main_text` (scanning backward from `match_offset`). If that nearest vintage equals `wine_context.vintage`, accept. Otherwise discard.
- **No vintage token anywhere**: accept the match, store with `vintage = NULL` and `confidence -= 0.1`.

**Step 5 — Supporting text capture.** Store the 200-char window around the match as `supporting_text`. This MUST be a literal substring of `main_text` — the write-time invariant assertion (§10) rejects rows where it isn't.

**Anti-hallucination property:** every persisted score's `supporting_text` is a literal substring of the source page. The persistence layer asserts `supporting_text in fetched_payload` (HTML for scraped sources, text payload for API sources). Rows that fail are rejected as parser bugs, logged, and skipped.

### 7.3 What we explicitly do NOT do in v1

- **No LLM verification.** First measure regex precision on the canary; only add LLM if precision < 90% and the bad cases are clearly LLM-fixable.
- **No multi-source corroboration scoring.** Each row stands alone with its source's confidence.
- **No critic era handling.** "RP" maps to "Robert Parker / Wine Advocate" with no date logic; if Galloni-at-Vinous-vs-WA confusion appears in real data, we add the era logic to v1.1.

### 7.4 Scale conversion (100pt-equivalent for `score_max`)

`score_max` and the "highest critic score" comparison need a single comparable number. Conversions:

- `100pt` scale: identity. `score_value` is the published number.
- `20pt` scale (Jancis Robinson, La Revue du Vin de France): use the conventional industry mapping below. Conversion is for sorting/`score_max` only; the badge display always shows the native form (`17.5/20`, never `90`).

| 20pt | 100pt-equivalent |
| --- | --- |
| ≥ 19.0 | 96 |
| 18.5 | 94 |
| 18.0 | 92 |
| 17.5 | 90 |
| 17.0 | 88 |
| 16.5 | 86 |
| 16.0 | 84 |
| 15.5 | 82 |
| ≤ 15.0 | 80 |

- `5star` scale: not converted to 100pt. Stored separately; not eligible for `score_max`.
- `medal` and `community` scales: not eligible for `score_max`.

---

## 8. Fetch politeness

Per-source defaults (overridable):
- Rate limit: **1 request per 3 seconds** (one source at a time; can run multiple sources in parallel).
- Daily window: 4 hours / source / day.
- Identifying UA: `WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)` (publish the policy page when v1 ships).
- robots.txt check: cached daily; if disallowed, source is paused with a log entry.
- HTTP retry: 3 attempts, exponential backoff 5s → 25s → 125s on 5xx; 1 retry on 429 with `Retry-After`; 0 retries on 4xx (other than 429).
- Backfill is **per-item resumable** via a `scrape_progress` table keyed on `(source, producer, cuvee, vintage)` with status `pending | done | transient_fail | permanent_skip`.

**Backfill timing model** (made explicit so the assumptions can be challenged):

- Sources run **in parallel** (each in its own process/event loop, independent rate limiters).
- Per source, **1 request per 3 seconds** within a 4-hour daily window = 4,800 requests per source per day.
- Adapters using deterministic URLs (CellarTracker API, Whiskybase, Distiller): 1 fetch per triplet.
- Adapters using in-site search (Wine Enthusiast, Natalie MacLean, WineAlign, The Real Review, Master of Malt): 1 search + up to 2 detail fetches per triplet = 3 fetches per triplet on average.
- Failure budget: assume 30% of fetches fail (404, 429, transient 5xx, parser miss). Triplets with `transient_fail` retry the next day.

Worked numbers for the catalog (~5,000 distinct producer+cuvée+vintage triplets, conservative):

| Source kind | Fetches per triplet | Total fetches | Days at 4,800/day | With 30% retry buffer |
| --- | --- | --- | --- | --- |
| Deterministic-URL (CT API, Whiskybase, Distiller) | 1 | 5,000 | ~1.0 | ~1.5 |
| Search-based (WE, NM, WA, TRR, MoM) | 3 | 15,000 | ~3.1 | ~4.5 |

So search-based sources are the long pole. Running all 8 in parallel, the **first backfill completes in ~5 days, with all stragglers (retries, longer-tail SKUs) done within ~10 days**.

After Day 5, the backfill job stays running but most triplets are `done`; refresh windows handle the remainder.

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
4. **Two-stage canary protocol** per CLAUDE.md Rule 10, scoped to keep operator manual-check time bounded:
   - **Per-source canary (automated):** when a new source adapter goes live, run it against the 50-SKU recon set as ground truth. Compare extracted scores to the recon spreadsheet's `critics_found` / `scores_found` columns. Output: precision, recall, false-positive examples. No manual UI checks; this is a Python script that prints a confusion matrix.
   - **Cross-source canary (manual, 5 SKUs only):** after all sources are integrated, pick 5 SKUs spanning tiers (famous wine, mid wine, mainstream wine, whisky, Thai-market). Operator opens each in the dev UI and visually confirms badges render, attribution is right, outbound links work. Total: 5 manual checks, not 40.

**Browser verification steps** (CLAUDE.md Rule 7 — concrete):
   1. `npm run dev` from the repo root (starts Next.js dev server on default port, typically `localhost:3000`).
   2. Open `http://localhost:3000/product/<canary_sku>` (existing product detail route) — each of the 5 canary SKUs.
   3. Verify: `CriticScoreBadges` component renders, each badge shows critic + score + outbound link icon, clicking the link opens the source page in a new tab.
   4. Sign-off recorded in the job report.

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

The slim spec is designed so the next layer of complexity gets added **only if evidence shows we need it**. Each trigger has a measurable threshold so the gate is unambiguous:

| Trigger (measurable) | v2 addition |
| --- | --- |
| Canary regex precision < 90% on the labeled 50-SKU recon set | Add LLM verification (`lib/critic_reviews/extract/llm_verifier.py`) |
| >2% of SKUs surface a score whose `vintage` differs from the SKU's actual vintage (measured by a monthly audit of 100 random SKUs) | Add `vintage_policy` column + per-vintage UI cards |
| Wine-Searcher API priced ≤ $200/mo OR a CellarTracker paid tier announced | Add `license` column, generalize the source interface |
| ≥1 user-reported case per month of community-score being mistaken for pro-critic-score | Promote `signal_class` to a visible UI separator |
| Supplier intake adds > 50 new producer+cuvée pairs per week (measured by diff in `lib/critic_reviews/catalog.py`) | Add the diff-based new-SKU hook |
| Catalog distinct producer+cuvée count exceeds 15,000 | Add the canonical critic identity table |
| ≥3 user reports per quarter of a Champagne NV or whisky batch showing a score from a different release/batch | Add `release_id` / `batch_id` columns |

Each is a clean additive change against the slim schema — no rework.

---

## 13. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | CellarTracker API access not granted | M | Fallback: drop CT, coverage shifts from ~64% to ~50%. Spec survives. |
| 2 | Wine Enthusiast URL pattern changes | M | DOM-canary as part of weekly job. Fixture-based parser update. |
| 3 | Regex binds the wrong score to wrong wine on multi-wine pages (round-ups, vintage reports, comparison articles) | H | Producer-proximity filter + nearest-vintage binding (§7.2 steps 3-4) is the v1 mitigation. Measured on canary; LLM verify is the v2 escalation. |
| 4 | Long-tail Thai/sake SKUs get nothing → user frustration | L | UI empty state is invisible, not "no data" error. Honest non-coverage. |
| 5 | Rate-limit ban from a source | M | Per-source circuit breaker: pause source on >5% 429/403 in a 50-request window. |
| 6 | A scraped score is later removed from the source | L | `fetched_at` lets us age out; quarterly refresh re-validates. |
| 7 | Critic identity collisions ("WA" = Wine Advocate publication vs critic) | L | Store as string in v1; correct in v2 if it becomes painful. |
| 8 | `refresh_live_export.py` not run after backfill → UI doesn't show the change | M | Backfill / refresh jobs invoke `scripts/refresh_live_export.py` at the end automatically (CLAUDE.md Rule 9). Operator can pass `--no-refresh-export` for staging runs but the default is on. |
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
- Wine Enthusiast in-site search endpoint — verify `?s=<query>` returns parseable HTML on 5 known articles before the day-6 implementation. If the public search is JavaScript-only, fall back to the deterministic-URL strategy and accept lower yield.

(`refresh_live_export.py` integration was an open item in the earlier draft; resolved in §13 risk #8 — automatic, default-on, `--no-refresh-export` flag for staging.)

These are intentionally small. None gate the spec.
