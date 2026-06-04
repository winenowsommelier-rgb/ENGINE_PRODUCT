# Critic Score & Tasting Note Harvester — Design

**Date:** 2026-06-03
**Status:** Draft (pending spec review + user approval)
**Scope:** v1 design
**Author:** brainstorming session, codified
**Related:** [taste-taxonomy](2026-05-25-taste-taxonomy-design.md), [curation-engine](2026-05-29-curation-engine-design.md), [unified-product-detail-panel](2026-05-27-unified-product-detail-panel-design.md)

---

## 1. Summary

For every wine and spirit SKU in the WN/LIQ9 catalog, attach the highest-quality critic and community score signal we can defend legally and technically, using only **already-public web content**. No paid APIs, no logins, no proxies, no outreach in v1.

The system harvests pages from the open web that have **already republished** critic scores (`"JS 95"`, `"WA 96"`, `"17.5/20"`) alongside a wine name and vintage — retailers, trade press, blogs, producer sites, vintage reports. It extracts `(critic, score, supporting_quote, source_url)` tuples per `(producer, cuvée, vintage[, release_id, batch_id])`, persists them with full provenance, and aggregates them into per-vintage display rows that the product detail panel reads.

Reviews are **decoupled from SKUs**: one ingest of a producer+cuvée serves every current and future SKU that binds to it. The product detail panel binds each SKU to a producer+cuvée+vintage-policy and renders the matching reviews.

### v1 posture (committed to spec)

- **Display = facts only.** Score, critic name, published date, outbound link. No quoted prose from third-party sources. Quoted prose is only rendered from `first_party` (in-house sommelier notes, supplier tech sheets) or from a future `licensed` class (not in v1).
- **No payment, no credentials, no outreach.** No CellarTracker API key request, no Wine-Searcher API contract, no proxies, no logged-in scraping, no paywalled sources.
- **Anti-hallucination by construction.** Every persisted score must be a literal substring of a source page that we can show on demand.

---

## 2. Goals & non-goals

### Goals

1. Score badge + critic + link on every product detail panel where public data exists.
2. Per-vintage / per-release / per-batch granularity where the source provides it.
3. Producer↔SKU decoupling so one harvest serves many current and future SKUs.
4. Aggregation that honors wine-domain rules: per-scale not cross-scale; per-vintage not cross-vintage; community separate from pro.
5. Verification at the user-facing destination, not at the harvester (CLAUDE.md Rule 1).

### Non-goals (v1)

- Storing or displaying any quoted prose from editorial sources.
- Wine-Searcher, Vivino, paywalled critics. Tracked separately as future commercial-deal work.
- Real-time freshness. Monthly refresh on dynamic sources, quarterly on editorial pages.
- LLM feature extraction (flavor tags, body/acidity/tannin, drinking window) — deferred to v2 once first-party / licensed prose volume is meaningful.

---

## 3. Architecture

### 3.1 Stage diagram

```
       ┌─────────────────────────────────────────────────────────┐
       │ 0. Catalog source                                       │
       │    distinct (producer, cuvée, vintage|release|batch)    │
       │    derived from data/db/products.db                     │
       └────────────────────┬────────────────────────────────────┘
                            │
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 1. Discover                                             │
       │    a) RSS + sitemap harvest of known publications       │
       │       (politest layer; primary)                         │
       │    b) Local SearxNG meta-search fallback for gaps       │
       │       (DDG + Brave + Mojeek + Bing rotation)            │
       │    Output: candidate URLs per query                     │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 2. Fetch + page-class triage                            │
       │    polite HTTP (httpx), per-domain rate limit,          │
       │    robots.txt + TDM Reservation Protocol enforced       │
       │    page classifier: keep wine_detail / round_up /       │
       │    vintage_report / producer_page;                      │
       │    drop nav / tag / listing pages                       │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 3. Extract — two stage                                  │
       │    a) Regex shortlist: find candidate                   │
       │       (critic_pattern, score_pattern, text_window)      │
       │    b) Local LLM verify (Ollama llama3.2): for each      │
       │       candidate, adjudicate whether this candidate is   │
       │       actually FOR the wine being queried, with a       │
       │       quoted supporting span from the page.             │
       │    Output: confirmed (critic, score, span, url) rows    │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 4. Persist                                              │
       │    critic_review_raw — facts only, full provenance      │
       │    (no quoted prose stored from facts_only sources)     │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 5. Aggregate                                            │
       │    rebuild wine_review_summary per                      │
       │    (producer, cuvée, vintage, release_id, batch_id)     │
       │    scores grouped by scale, never collapsed cross-scale │
       │    no cross-vintage rollup                              │
       │    community kept separate from pro                     │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 6. Bind                                                 │
       │    sku_to_cuvee binds each SKU to                       │
       │    (producer, cuvée, vintage_policy, release_policy,    │
       │     batch_policy, match_confidence, matched_by)         │
       └────────────────────┬────────────────────────────────────┘
                            ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 7. Serve                                                │
       │    GET /api/products/<sku>/reviews                      │
       │    rendered as score badges + critic + outbound link    │
       └─────────────────────────────────────────────────────────┘
```

Each stage is idempotent and resumable. Each stage ends with a verification probe against the persisted destination — see §10.

### 3.2 License classes

License class is the single field that drives every downstream behavior — what gets stored, displayed, retained, and read by the LLM.

| License class | Sources in v1 | note_text persisted | Quoted prose displayed | LLM allowed to read prose | Raw HTML retained |
|---|---|---|---|---|---|
| **`facts_only`** | All public-web harvested pages (retailers, blogs, trade press, producer sites) | **No** — null in DB | **No** | **No** | **No** |
| **`first_party`** | In-house sommelier notes, supplier tech sheets | Yes, forever | Yes (own content) | Yes | n/a |
| **`licensed`** | (none in v1; reserved for future API/contract deals) | Per license terms | Per license terms | Per license terms | Per license terms |

The `facts_only` class is the legal foundation. The fetcher reads each page into a transient buffer, runs extraction, persists only the facts (score, critic, URL, supporting span as a short literal quote), and discards the buffer. This eliminates the forever-archival liability flagged in the legal review.

The `licensed` class exists in the schema and code from day one so a future licensed feed plugs in without rework.

---

## 4. Module layout

New top-level package, parallel to existing `lib/curation/`, `lib/enrichment/`, `lib/supplier-intake/`:

```
lib/critic_reviews/
├── catalog.py                       # distinct producer+cuvée+vintage from products.db
├── discovery/
│   ├── __init__.py
│   ├── base.py                      # DiscoveryStrategy protocol
│   ├── sitemap_harvester.py         # primary: RSS + sitemap.xml crawl
│   ├── searxng_client.py            # fallback: local SearxNG meta-search
│   └── publication_registry.py      # list of seeded publications + RSS/sitemap URLs
├── fetch/
│   ├── http_client.py               # polite httpx wrapper, per-domain rate limit, robots/TDM check
│   ├── page_classifier.py           # PageClass values per §4.2
│   └── compliance.py                # robots.txt + TDM Reservation Protocol cache
├── extract/
│   ├── regex_extractor.py           # stage 3a — find candidate (critic, score, window) triples
│   ├── llm_verifier.py              # stage 3b — Ollama adjudication, quoted-span verification
│   ├── critic_patterns.py           # critic name patterns + score patterns (e.g. "JS 95", "WA 96")
│   ├── critic_normalization.py      # critic_id table — Antonio Galloni across Vinous/WA eras, etc.
│   └── prompts.py                   # LLM prompt templates
├── persist/
│   ├── schema.sql                   # tables + indexes + constraints
│   ├── repository.py                # typed accessors over critic_review_raw, features, summary
│   └── assertions.py                # license_class invariants (e.g. facts_only ⇒ note_text IS NULL)
├── aggregate/
│   └── summary_builder.py           # rebuild wine_review_summary deterministically
├── resolver/
│   ├── sku_matcher.py               # SKU → (producer, cuvée, vintage_policy, release_policy, batch_policy)
│   └── normalization.py             # producer / cuvée canonicalization
├── verification.py                  # Rule-1 destination-table verification probes
└── jobs/
    ├── backfill.py                  # one-shot multi-day catalog backfill
    ├── refresh.py                   # scheduled refresh (monthly community / quarterly editorial)
    └── new_sku_hook.py              # supplier-intake hook for newly-arrived producer+cuvée

app/api/products/[sku]/reviews/route.ts   # serving layer (Next.js)
components/product/ReviewBadges.tsx       # display layer

tests/critic_reviews/
├── fixtures/                        # golden HTML samples per page class
├── unit/                            # per-stage tests
└── integration/                     # end-to-end invariants (CLAUDE.md Rule 6)
```

### 4.1 Key interfaces

```python
class DiscoveryStrategy(Protocol):
    name: str                                    # "sitemap" / "searxng"
    def discover(self, query: WineQuery) -> Iterable[CandidateURL]: ...

class WineQuery(BaseModel):
    producer: str
    cuvee: str
    vintage: int | None
    release_id: str | None
    batch_id: str | None

class CandidateURL(BaseModel):
    url: str
    discovered_via: str                          # which DiscoveryStrategy + which seed
    page_class_hint: str | None                  # if known from sitemap structure

class FetchedPage(BaseModel):
    url: str
    fetched_at: datetime
    status_code: int
    page_class: PageClass                        # see §4.2 canonical enum
    main_text: str                               # extracted readable text, not raw HTML
    canonical_url: str | None
    publish_date_hint: date | None

class ExtractedCandidate(BaseModel):
    critic_raw: str                              # "JS" / "Suckling" / "James Suckling"
    score_raw: str                               # "95" / "17.5/20" / "5★"
    score_scale: ScoreScale                      # 100pt / 20pt / 5star
    score_normalized: float                      # to 100pt — used for badging only, NEVER averaged cross-scale
    span_in_text: str                            # exact substring from page, ≤200 chars
    span_offset: int                             # offset into main_text for traceability

class VerifiedReview(BaseModel):
    critic_id: str                               # normalized via critic_normalization
    score_native: str                            # as published
    score_normalized: float
    score_scale: ScoreScale
    supporting_quote: str                        # literal substring of source page
    source_url: str
    page_class: PageClass
    discovered_via: str
    confidence: float                            # see §7

class WineReviewSummary(BaseModel):
    producer: str
    cuvee: str
    vintage: int | None
    release_id: str | None
    batch_id: str | None
    score_by_scale: dict[ScoreScale, ScaleAggregate]   # never one cross-scale average
    community_score: float | None                # never mixed with pro
    community_count: int
    top_pro_reviews: list[TopReview]             # top-N by source_tier then recency
    updated_at: datetime
```

`parse()` over a fetched page is a pure function over text → `list[ExtractedCandidate]`. This lets us re-extract from cached `main_text` without re-fetching, which protects against transient extractor bugs.

### 4.2 Canonical enums

**`PageClass`** — single source of truth for stage 2's page-classifier output and stage 3's confidence model.

| Value | Definition | Kept / dropped | Confidence Δ |
|---|---|---|---|
| `wine_detail` | Page is principally about one specific wine (producer + cuvée, possibly a specific vintage). Retailer product pages, single-wine reviews. | Kept | +0.20 |
| `round_up` | Page covers multiple wines (5+), typically a "Top N" list, vertical tasting, or themed round-up article. | Kept | +0.12 |
| `vintage_report` | Page covers a region+vintage combination (e.g. "Bordeaux 2020 en primeur"); lists many wines with scores. | Kept | +0.15 |
| `producer_page` | Page is about a producer overall, may mention several of their wines. | Kept | +0.08 |
| `nav` | Site navigation, category index, breadcrumb-only page. | Dropped before fetch when classifier can tell from URL; otherwise dropped at stage 2. | n/a |
| `tag` | Taxonomy / tag listing page (`/tag/cabernet-sauvignon`). | Dropped. | n/a |
| `listing` | Generic listing / search-result page on a third-party site. | Dropped. | n/a |
| `unknown` | Classifier could not decide with confidence. Page is still passed to extraction; treated as `round_up` for confidence purposes but flagged. | Kept (with flag) | +0.05 |

**`ScoreScale`**: `100pt`, `20pt`, `5star`. No others in v1. `5star` rows are kept per-source — cross-source 5-star aggregation is explicitly deferred (§17).

**`TastingContext`**: `en_primeur`, `on_release`, `retrospective`, `unknown`.

**`SourceTier`**: `1` (in-house), `2` (pro critic / trade press), `3` (enthusiast platform), `4` (crowd). Derived from the seed registration, not from the page itself.

**`LicenseClass`**: `facts_only`, `first_party`, `licensed`.

**`DiscoveredVia` grammar:**

`discovered_via` is stored as a single string with grammar `"<strategy>:<seed_or_engine>"`:

- `sitemap:<domain>` — e.g. `sitemap:wine.com`
- `rss:<domain>` — e.g. `rss:decanter.com`
- `searxng:<engine>` — e.g. `searxng:duckduckgo`
- `producer_page_discovery:<domain>` — for producer-site auto-discovery
- `manual:<note>` — for any human-curated entry

The yield report (§6.3) parses this column into `strategy` and `domain` columns by splitting on `:` once.

---

## 5. Data model

Stored in a new SQLite database `data/db/critic_reviews.db`, parallel to `products.db`. Cross-db joins happen at the application layer, never in SQL.

### 5.1 `critic_review_raw`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `source` | TEXT NOT NULL | publication / domain identifier (`"decanter.com"`, `"first_party"`) |
| `license_class` | TEXT NOT NULL CHECK (`facts_only` / `first_party` / `licensed`) | drives all downstream behavior |
| `source_review_id` | TEXT | source-side id when discoverable (dedup) |
| `producer_canonical` | TEXT NOT NULL | normalized |
| `cuvee_canonical` | TEXT NOT NULL | normalized |
| `vintage` | INTEGER | nullable for NV |
| `release_id` | TEXT | NV Champagne disgorgement / edition / base year |
| `batch_id` | TEXT | cask-strength batch / single-cask number |
| `appellation` | TEXT | when stated |
| `abv` | REAL | when stated |
| `disgorgement_date` | TEXT (ISO date) | Champagne |
| `bottling_date` | TEXT (ISO date) | whisky |
| `cask_type` | TEXT | `"ex-bourbon"`, `"oloroso"`, etc. |
| `score_native` | TEXT | as published (`"18.5/20"`, `"5★"`, `"98+"`) |
| `score_normalized` | REAL | 100-pt for badging only; NEVER averaged cross-scale |
| `score_scale` | TEXT NOT NULL CHECK | `100pt` / `20pt` / `5star` |
| `note_text` | TEXT | NULL when `license_class = 'facts_only'` (invariant, enforced) |
| `note_quote_short` | TEXT | NULL when `license_class = 'facts_only'` |
| `supporting_quote` | TEXT NOT NULL | literal substring of source page, ≤200 chars — the anti-hallucination proof |
| `critic_id` | TEXT | FK to `critic` table |
| `reviewer_raw` | TEXT | as it appeared on the page, before normalization |
| `source_tier` | INTEGER NOT NULL | 1=in-house, 2=pro critic, 3=enthusiast platform, 4=crowd |
| `page_class` | TEXT NOT NULL CHECK | one of `PageClass` (§4.2): `wine_detail`, `round_up`, `vintage_report`, `producer_page`, `unknown` (dropped classes are filtered before insert) |
| `tasting_date` | TEXT (ISO date) | when wine was tasted, distinct from published_at |
| `tasting_context` | TEXT | `en_primeur` / `on_release` / `retrospective` / `unknown` |
| `published_at` | TEXT (ISO date) | when the review/article was published |
| `url` | TEXT NOT NULL | source URL — always required |
| `discovered_via` | TEXT NOT NULL | discovery strategy + seed |
| `fetched_at` | TEXT (ISO datetime) | |
| `confidence` | REAL NOT NULL | see §7 |
| `corroborations` | INTEGER NOT NULL DEFAULT 1 | number of distinct URLs supporting the same (critic_id, score_native, vintage|release|batch) |

**Invariants** (enforced both as DB CHECK constraints and in `persist/assertions.py`):

- `license_class IN ('facts_only','first_party','licensed')`
- `license_class = 'facts_only' ⇒ note_text IS NULL AND note_quote_short IS NULL`
- `supporting_quote` is non-empty for all rows
- `url` non-empty
- `score_normalized` matches the documented mapping from `score_scale` × `score_native`

**`supporting_quote` retention and disclosure rule** (this is the precise legal contract — read carefully):

`supporting_quote` is persisted for **every** row regardless of `license_class`. It is the anti-hallucination proof: at write time the persistence layer asserts `supporting_quote in main_text`; at any future audit the row can be re-verified against a re-fetched page.

**It is internal-only.** The serving layer (§9) strips it from any response when `license_class = 'facts_only'`. The repository layer exposes two read methods:

- `find_for_audit(...)` — returns full row including `supporting_quote`. Used only by verification probes (§10) and internal admin tools.
- `find_for_serving(...)` — returns a redacted row with `supporting_quote = None` whenever `license_class = 'facts_only'`. The API handler in `app/api/products/[sku]/reviews/route.ts` uses only this method.

The component layer (`components/product/ReviewBadges.tsx`) renders no element bound to `supporting_quote` for any `facts_only` review. The TypeScript response type intentionally omits the field for `facts_only` rows (it appears only on the `licensed` and `first_party` variants of the discriminated union), so the compiler refuses to render it.

This separation means: even if a future code change adds a quote-display element, it would have to first change three layers (repository, type, component) before any `facts_only` quote could leak. The redaction is defense-in-depth, not a single check.

### 5.2 `critic`

Critic identity normalization. Handles the era/affiliation problem flagged in expert review.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | stable id (`"galloni_antonio"`) |
| `display_name` | TEXT NOT NULL | `"Antonio Galloni"` |
| `also_known_as` | TEXT (JSON array) | `["AG","Galloni"]` |
| `affiliations` | TEXT (JSON array) | `[{publication, start_year, end_year}, ...]` |
| `default_scale` | TEXT | `100pt` / `20pt` / `5star` |

`also_known_as` is the lookup index used by the regex extractor and the LLM verifier.

### 5.3 `critic_review_features` (table exists, **not populated in v1**)

Same shape as previously specified. Empty in v1. Populated in v2 when first-party / licensed prose volume is meaningful. Schema documented now so the v2 work is additive.

### 5.4 `wine_review_summary`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `producer\|cuvee\|vintage\|release_id\|batch_id` |
| `producer_canonical` | TEXT NOT NULL | |
| `cuvee_canonical` | TEXT NOT NULL | |
| `vintage` | INTEGER | nullable for NV |
| `release_id` | TEXT | nullable |
| `batch_id` | TEXT | nullable |
| `score_by_scale` | TEXT (JSON) | `{"100pt":{avg,count,top:[{critic_id,score,url}…]},"20pt":{…},"5star":{…}}` — never one cross-scale average |
| `community_score` | REAL | strictly separate from pro |
| `community_count` | INTEGER | |
| `community_source` | TEXT | which page class supplied it |
| `top_pro_reviews` | TEXT (JSON) | top-N curated for display, by tier then recency |
| `first_party_notes` | TEXT (JSON) | array of `{author, note, url}` from first-party rows; never used in recommendation_strength |
| `recommendation_strength` | TEXT | `highly_recommended` / `recommended` / `mixed` / `insufficient_data` |
| `updated_at` | TEXT (ISO datetime) | |

**No `cross_vintage_avg` field.** Vintage rollup is forbidden in the data model, not just in the UI.

### 5.5 `sku_to_cuvee`

| Column | Type | Notes |
|---|---|---|
| `sku` | TEXT PK | |
| `producer_canonical` | TEXT NOT NULL | |
| `cuvee_canonical` | TEXT NOT NULL | |
| `vintage_policy` | TEXT NOT NULL | `specific:<year>` / `current` / `nv` |
| `release_policy` | TEXT | for NV Champagne — `specific:<release_id>` / `latest_n:3` / `any` |
| `batch_policy` | TEXT | for whisky batches — same shape |
| `match_confidence` | REAL NOT NULL | |
| `matched_by` | TEXT NOT NULL | `auto-llm` / `manual` |
| `matched_at` | TEXT (ISO datetime) | |

### 5.6 `scrape_progress`

Per-item resumability (not every-50 as originally drafted — expert review flagged that as too coarse).

| Column | Notes |
|---|---|
| `(discovery_strategy, source, producer, cuvee, vintage, release_id, batch_id)` | composite key |
| `status` | `pending` / `in_progress` / `done` / `transient_failure` / `permanent_skip` |
| `attempts` | int |
| `last_error` | text |
| `last_attempt_at` | datetime |

Resume = `WHERE status IN ('pending','transient_failure') AND attempts < max_attempts`.

### 5.7 `harvest_job_report`

Every job run writes a report. Used by §10 verification.

| Column | Notes |
|---|---|
| `job_id` | uuid |
| `job_type` | `backfill` / `refresh` / `new_sku_hook` |
| `started_at` / `finished_at` | |
| `discovered_urls` | int |
| `fetched_pages` | int |
| `pages_dropped_classifier` | int |
| `candidates_extracted_regex` | int |
| `candidates_confirmed_llm` | int |
| `rows_written_raw` | int |
| `rows_in_summary_after` | int |
| `skus_newly_reviewable_after` | int |
| `notes` | text — `"what shipped to users"` summary (CLAUDE.md Rule 4) |

---

## 6. Discovery (stage 1) — RSS + sitemaps primary, SearxNG secondary

### 6.1 Primary — RSS + sitemap harvester

A small registry of high-yield publications and retailers is seeded by hand once. For each, we record the sitemap.xml URL (or RSS feed URL) and the URL pattern that identifies a per-wine detail page.

Seed list (initial; grows organically as the system measures yield):

- **Retailers / merchants:** Berry Bros. & Rudd, Wine.com, K&L Wine Merchants, Millesima, Vinatis, Lay & Wheeler, Justerini & Brooks
- **Trade press:** The Drinks Business, Wine Industry Insight
- **Wine publications (free articles, RSS only):** Decanter news section, Wine Enthusiast articles
- **Producer sites:** auto-discovered later from the producer column in the catalog
- **Whisky / spirits:** Master of Malt, The Whisky Exchange (notes section), Whiskybase pages

For each seed, the harvester:

1. Fetches sitemap.xml (or RSS), respecting `robots.txt` and `Crawl-delay`.
2. Filters URLs against the seed's URL pattern (e.g. `wine.com/product/*`).
3. Matches sitemap URLs against the catalog's distinct producer+cuvée list using normalized fuzzy match. The producer-name match is the cheap, high-precision signal; cuvée/vintage are confirmed during extraction.
4. Emits `CandidateURL`s to the fetch queue.

**Politeness defaults** (per seed, overridable):
- 1 request per 3 seconds
- 4-hour daily window (spreads load and avoids IP-reputation decay)
- Identifying UA: `WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)`
- Resume from `If-Modified-Since` when seed supports it

### 6.2 Secondary — local SearxNG fallback

For producer+cuvée+vintage triplets that primary discovery did not surface, query a local SearxNG instance (Docker container) that rotates through DuckDuckGo, Brave, Mojeek, Bing.

- Query format: `"<producer> <cuvée> <vintage>" "score" OR "points" OR "/20" OR "/100"`
- 1 query per 10 seconds, 200 queries/day cap (long-tail volume is naturally bounded by what primary missed)
- SearxNG dedupes results across engines for free
- Output: same `CandidateURL` interface as primary

**Operational gate:** SearxNG fallback only runs after primary harvest has been attempted for a triplet. We measure per-triplet "primary yielded N candidates"; only triplets with N=0 fall through.

### 6.3 Yield observability for v2 promotion

Every `CandidateURL` records `discovered_via`. Every confirmed `VerifiedReview` carries it forward. A nightly report computes per-domain yield:

```
domain                       candidates   confirmed   yield%   strategy
wine.com                          2,109       1,841      87%    sitemap
bbr.com                           1,433       1,205      84%    sitemap
the-drinks-business.com             982         631      64%    rss
some-blog.example                    12           2      17%    searxng
```

This is the input to v2's "promote high-yield sites to a curated crawl" decision. No premature optimization — earn the curation from data.

---

## 7. Extraction (stage 3) — regex shortlist + LLM verify

### 7.1 Stage 3a — regex shortlist

Scans `FetchedPage.main_text` for candidate `(critic_pattern, score_pattern, text_window)` triples.

**Critic patterns** come from `critic` table's `display_name + also_known_as`. The matcher is whole-word, case-insensitive, with abbreviation expansion. Examples: `"JS"` → `"James Suckling"`; `"WA"` → `"Wine Advocate"` (publication, not a person — when accompanied by a score, attributed to `critic_id = wine_advocate_team` for any date and the specific reviewer is read from `also_known_as` matches elsewhere on the page if present).

**Era-aware abbreviation rule** (the resolved ambiguity called out in expert review):

`"RP"` and any other abbreviation that maps to a person who later left or whose publication changed hands is resolved using the page's **`published_at` date** as the era anchor, not the wine's `tasting_date`. Reason: a 2024 retrospective article that says "RP 96" is reporting the author's reading at writing time, not the original 2010 tasting. Specifically:

- `"RP"` published before 2019-08-01 (Parker's retirement) → `critic_id = parker_robert`
- `"RP"` published 2019-08-01 or later → `critic_id = wine_advocate_team` with a flag for ambiguity that the LLM verifier is asked to resolve from page context (the reviewer is often named elsewhere on the page).
- `"AG"` published before 2014-01-01 → `critic_id = galloni_antonio` with `affiliation = "wine_advocate"`
- `"AG"` published 2014-01-01 or later → `critic_id = galloni_antonio` with `affiliation = "vinous"`
- The full set of era boundaries lives in the `critic.affiliations` JSON column, keyed by `also_known_as` token + date range.

When `published_at` cannot be determined for a page, the abbreviation match incurs the `−0.10` ambiguous-abbreviation confidence penalty and the row is flagged for canary review.

**Score patterns** (regex set, with named capture groups):

- `\b(?P<score>\d{2,3})\s*(?:pts?|points?|/100)\b` → 100-pt
- `\b(?P<score>\d{1,2}(?:\.\d)?)\s*/\s*20\b` → 20-pt
- `(?P<stars>★{1,5}|\d(?:\.\d)?\s*stars?)` → 5-star (when accompanied by a critic name)
- `\b(?P<critic_short>JS|WA|RP|JR|VN|WS|WE|DEC)\s*(?P<score>\d{2,3})\b` → joined form
- Edge cases: `"98+"`, `"95-97"` (en primeur barrel range) — both captured, range stored as native

**Text window:** 200 chars around the match, plus the sentence the match is in. This becomes `span_in_text`.

**Round-up filter** (before LLM verify, to control LLM cost on long round-up articles): when the regex returns >5 candidates on a single page (typical of "Top 100" round-ups; threshold tuned on the canary per §12.3), each candidate is pre-filtered by **producer-name proximity**: keep the candidate only if the queried wine's `producer_canonical` (or any of its canonical aliases) appears within the same paragraph as the score-critic match. This is a cheap textual check, not an LLM call.

Candidates that pass the filter go to stage 3b. Candidates that fail are not persisted but their existence is logged for yield analytics.

This filter directly addresses the "Suckling gave Lafite 95 but Margaux 96" failure mode: only the Margaux candidate survives when we're querying Margaux.

**Output:** `list[ExtractedCandidate]` per page, post-filter on round-ups. No semantic verification yet.

### 7.2 Stage 3b — LLM verify (Ollama llama3.2)

For each candidate, the LLM is asked one bounded question with a structured-output schema:

```
Page main text:
{main_text_truncated_to_4000_tokens_around_candidate}

Wine we are looking for:
  Producer: {producer}
  Cuvée: {cuvee}
  Vintage: {vintage}
  Release/batch (if applicable): {release_id_or_batch_id}

Candidate (critic, score) pair found on this page:
  Critic: {critic_normalized}
  Score: {score_native} ({score_scale})
  Surrounding text: "{span_in_text}"

Question: Is this (critic, score) pair, on this page, actually FOR the wine
named above (same producer, same cuvée, same vintage/release/batch)?

Return JSON:
  {
    "is_for_this_wine": true|false,
    "supporting_quote": "<≤200-char literal substring from page text proving it>",
    "reason_if_no": "<short>" | null
  }

Hard constraint: supporting_quote must be a literal substring of the
page main text. If you cannot quote a literal substring, return false.
```

After the LLM returns, **the system verifies `supporting_quote in main_text`**. If the quote is not literally present, the candidate is rejected as hallucination. This is the structural anti-hallucination guarantee.

### 7.3 Confidence model

Each persisted row gets a `confidence` float. Deltas are additive; the final value is clamped to `[0.0, 1.0]`.

**Base** (the LLM has confirmed a binding with a verified literal quote): **0.50**

**Positive deltas — page class:**

| Signal | Δ |
|---|---|
| `page_class = wine_detail` | +0.20 |
| `page_class = round_up` | +0.12 |
| `page_class = vintage_report` | +0.15 |
| `page_class = producer_page` | +0.08 |
| `page_class = unknown` | +0.05 |

**Positive deltas — source quality:**

| Signal | Δ |
|---|---|
| `source_tier = 2` (pro critic publication / trade press) | +0.10 |
| `source_tier = 1` (in-house — does not pass through this pipeline) | n/a |
| Critic identity matched by **full name** (not abbreviation) | +0.10 |
| Critic identity matched by **distinctive abbreviation in joined form** (`JS 95`, `WA 96` — where the score is part of the token) | +0.05 |

**Positive deltas — corroboration** (computed at promotion time, after the row is written; the row's stored `confidence` is recomputed when corroborations change):

| Signal | Δ |
|---|---|
| Same `(critic_id, score_native, vintage)` (or `release_id` / `batch_id` when applicable) confirmed on a 2nd independent URL | +0.15 |
| ... 3rd URL | +0.08 |
| ... 4th+ URL | +0.04 each, capped at +0.10 total |

**Negative deltas:**

| Signal | Δ |
|---|---|
| Critic matched by ambiguous abbreviation only (`"JR"` could be Jancis Robinson or J. Robinson on a wine blog) | −0.10 |
| Score range form (`"95-97"`) — en primeur barrel range | −0.05 |
| Page `published_at` > 5 years before `vintage`'s typical drinking-window opening | −0.10 (likely scoring an older sibling vintage) |
| Page is on a domain that has yielded < 50% confirmed rate historically | −0.05 |

**Single-row maximum** (sanity check): base `0.50` + `wine_detail` `0.20` + source_tier 2 `0.10` + full-name critic `0.10` = **0.90**. A high-quality single-row review reaches the single-row promotion gate.

**Multi-row maximum**: same + 2nd URL `0.15` + 3rd URL `0.08` = **1.13**, clamped to **1.00**.

**Promotion gates** to `wine_review_summary`:

- `confidence ≥ 0.85` from a single row → promote (high-quality `wine_detail` page from a recognized publication with full critic-name match)
- `confidence ≥ 0.70` with ≥1 corroborating row → promote
- Below the gates → row stays in `critic_review_raw` (audit trail) but is excluded from the summary

These thresholds are **tuned on the 5-SKU canary, not inherited** (CLAUDE.md Rule 3). The canary protocol (§12.3) records precision and recall at each gate on the canary set and adjusts the cut-off values before scaling.

**Recomputation rule:** when a new row arrives that shares `(critic_id, score_native, vintage|release|batch)` with an existing row, all matching rows' confidences are recomputed and re-evaluated against the promotion gate. This means a row that was held back at first ingestion can be promoted later when corroboration arrives, without re-running extraction.

**Symmetric corroboration semantics** (deliberately): each matching row's confidence reflects "I am corroborated by N-1 other rows" — every row gets the corroboration delta independently. This is not double-counting: each row's confidence answers the question "should *this* row ship?" independently. The summary's per-scale `count` and `top` lists naturally deduplicate when multiple corroborated rows are picked from a group (top-N selection ranks by confidence and then breaks ties by `source_tier` and `published_at` recency).

---

## 8. Aggregation (stage 5)

`aggregate/summary_builder.py` runs deterministically over `critic_review_raw` to rebuild `wine_review_summary`. Idempotent. Re-runnable at any time.

Rules:

1. **Group by** `(producer_canonical, cuvée_canonical, vintage, release_id, batch_id)`. Each combination becomes one summary row.
2. **Group scores by `score_scale`** inside `score_by_scale`. For `100pt` and `20pt`, compute `avg`, `count`, and a `top` list of `{critic_id, score_native, url, source_tier}` per scale. **Never one cross-scale average.** For `5star`, the shape is `{by_source: {<source>: {avg, count, top}}}` — `avg` is computed per-source not cross-source, because a Vivino 5★ does not mean the same thing as an editorial 5★ (resolved in §17).
3. **Community vs pro:** rows with `source_tier ≥ 3` go to `community_score` / `community_count`; rows with `source_tier ≤ 2` go into the per-scale pro aggregates.
4. **First-party rows with no `score_native`** are stored in a separate `first_party_notes` field on the summary row (JSON array of `{author, note, url}`). They contribute to neither `score_by_scale` nor `recommendation_strength`.
5. **No cross-vintage rollup.** Each vintage stands alone. The product detail panel handles the "current vintage" UX by reading the most recent N vintages and displaying them as separate cards (§9.3).
6. **Filter:** only rows where `confidence ≥` promotion threshold are aggregated. Lower-confidence rows stay in `critic_review_raw` for audit but don't ship.
7. **`recommendation_strength` rule** (intentionally simple — wine people will object to anything fancier).
   This rule is the **only** place in the system where `score_normalized` may be read across scales, and it does not compute an average — it computes a worst-case floor across same-vintage rows. The output is a categorical label, not a number, which keeps the §5.1 "never averaged cross-scale" guarantee intact.
   - Inputs: all rows in the group with `source_tier ≤ 2` (pro reviews). Each contributes a single `score_normalized` value (already constrained to its own scale's mapping).
   - `highly_recommended` if `count(pro reviews) ≥ 2` AND `min(score_normalized) ≥ 92`
   - `recommended` if `count(pro reviews) ≥ 1` AND `min(score_normalized) ≥ 88`
   - `mixed` if `count(pro reviews) ≥ 2` AND `max(score_normalized) − min(score_normalized) ≥ 6`
   - `insufficient_data` otherwise
   `mixed` takes precedence over `recommended` when both fire (a 95 + an 88 signals disagreement, not a recommendation).

---

## 9. API & UI

### 9.1 Endpoint

`GET /api/products/<sku>/reviews` — new Next.js route under `app/api/products/[sku]/reviews/route.ts`.

**This is a separate read path from `data/live_products_export.json`** (the bulk export used by the explore UI per CLAUDE.md Rule 9). The reviews surface intentionally does not bundle into that export — it's independently versioned and refreshed.

### 9.2 Response shape

```json
{
  "sku": "WRW2106AC",
  "binding": {
    "producer": "Coastal Ridge",
    "cuvee": "Cabernet Sauvignon",
    "vintage_policy": "current",
    "release_policy": null,
    "batch_policy": null,
    "match_confidence": 0.92
  },
  "vintages_displayed": [
    {
      "vintage": 2020,
      "release_id": null,
      "batch_id": null,
      "tasting_context": "on_release",
      "score_by_scale": {
        "100pt": {
          "avg": 92.5,
          "count": 4,
          "reviews": [
            {
              "critic_id": "suckling_james",
              "critic_display": "James Suckling",
              "score_native": "93",
              "url": "https://...",
              "source_tier": 2,
              "confidence": 0.91,
              "license_class": "facts_only",
              "displayable_prose": null
              // NOTE: supporting_quote, page_class, and discovered_via are
              // intentionally absent for license_class="facts_only" — see §5.1
              // and §17. The TypeScript discriminated union omits these fields
              // for the facts_only variant so the compiler refuses to render them.
            }
          ]
        },
        "20pt": { "...": "..." }
      },
      "community": { "score": 4.2, "count": 312, "source": "..." },
      "first_party": [
        {
          "author": "WN tasting panel",
          "note": "Full-bodied with blackcurrant…",
          "score_native": null,
          "license_class": "first_party",
          "displayable_prose": "Full-bodied with blackcurrant…"
        }
      ],
      "recommendation_strength": "recommended"
    },
    { "vintage": 2019, "...": "..." },
    { "vintage": 2018, "...": "..." }
  ],
  "data_completeness": "rich" | "partial" | "sparse" | "none"
}
```

### 9.3 UI rules (committed)

- `displayable_prose: null` ⇒ render score badge + critic name + outbound link icon. **No expandable note. No tooltip with quoted text.**
- `license_class IN ('licensed','first_party')` AND `displayable_prose` non-null ⇒ render the actual quote.
- Per-scale columns side by side. Never a cross-scale collapsed number.
- Attribution + outbound link is **mandatory** on every badge — enforced in the component, not by guideline.
- `data_completeness = "none"` ⇒ render a soft empty state, not a "data unavailable" error.

**Vintage / release / batch selector rules** (table form so designers can ship the panel):

| Binding policy | UI behavior |
|---|---|
| `vintage_policy = "specific:<year>"` | Render exactly one card for that vintage. |
| `vintage_policy = "current"` | Render the most recent 3 vintages as separate cards, newest first. Never averaged. Each card shows its vintage prominently. |
| `vintage_policy = "nv"`, `release_policy = "specific:<id>"` | Render exactly one card for that release. |
| `vintage_policy = "nv"`, `release_policy = "latest_n:3"` | Render the 3 most recent releases (by `disgorgement_date` if present else `published_at`) as separate cards. |
| `vintage_policy = "nv"`, `release_policy = "any"` | Render up to 5 most-reviewed releases as separate cards. |
| `batch_policy = "specific:<id>"` | Render exactly one card for that batch. |
| `batch_policy = "latest_n:<N>"` | Render the N most recent batches as separate cards. |
| `batch_policy = "any"` | Render up to 5 most-reviewed batches as separate cards. |
| No binding policy resolves | Render `data_completeness = "none"` empty state. |
| Any combination not explicitly enumerated above | Fall back to `data_completeness = "none"` and log a warning. The new combination is a bug-or-spec-update signal, not a UI improvisation. |

In all cases the **card is the smallest renderable unit** and corresponds 1:1 with a `wine_review_summary` row. No card ever aggregates across vintages/releases/batches.

### 9.4 Existing data-source pattern

This system writes to a new SQLite DB (`data/db/critic_reviews.db`) read by a new API endpoint. It does **not** write into `data/live_products_export.json` or `products.db`.

**CLAUDE.md Rule 9 applies vacuously** — there is no `refresh_live_export.py` analog to maintain for this surface, because the reviews surface is not bundled into the live products export. Future contributors should not add such a step: the reviews API is the canonical read path for review data, just as `live_products_export.json` is the canonical read path for the explore UI. The two paths are independent by design. If a user says "I don't see the new review," the diagnostic is to query `critic_reviews.db` directly and curl the reviews endpoint, not to check the export file's age.

---

## 10. Verification & guardrails (CLAUDE.md compliance)

Every job ends with the **"what shipped to users" report** required by Rule 4. The report is written to `harvest_job_report` and printed at the end of every run:

```
Job: backfill_2026-06-15
  Discovered URLs:               18,432
  Fetched (after dedup):         12,118
  Dropped by page classifier:     2,901  (nav/tag/listing)
  Candidates extracted (regex):  46,221
  Candidates confirmed (LLM):    21,408  (46.3%)
  Rows written to raw:           21,408
  Rows promoted to summary:      18,772  (87.7%)
  Distinct (producer,cuvee,vint) covered:   1,341 / 1,847   (72.6%)
  SKUs now reviewable:           2,711 / 3,807               (71.2%)
  Per-confirmed-row LLM cost:    ~0.00 USD (local Ollama)
```

**Two distinct verification gates** — the spec separates write-time invariants (always-on, 100%) from periodic re-fetch verification (sampled, drift-detection only).

**Write-time invariants** (enforced in `persist/assertions.py` on every row insertion — no row reaches the DB without passing):

- W1. `supporting_quote in main_text` — checked against the in-memory `FetchedPage.main_text` at insert time. A row that fails is rejected, the candidate is logged as a hallucination, and the LLM verifier's batch failure counter increments.
- W2. License-class column invariants (§5.1).
- W3. `score_normalized` matches `score_scale` × `score_native` per the documented mapping.

These run on 100% of rows and are the structural anti-hallucination guarantee. There is no path that bypasses them.

**Post-job verification probes** (run after every job; failure halts the job and surfaces an alert):

1. **Raw row landed:** `SELECT count(*) FROM critic_review_raw WHERE fetched_at > job_started_at` matches the job's `rows_written_raw` tally.
2. **Summary updated:** `SELECT count(*) FROM wine_review_summary WHERE updated_at > job_started_at` non-zero (or zero if no new promotions were expected).
3. **API serves:** `curl /api/products/<canary_sku>/reviews` returns `data_completeness != "none"` for at least one canary SKU.
4. **No invariant violations:** `SELECT count(*) FROM critic_review_raw WHERE license_class = 'facts_only' AND note_text IS NOT NULL` returns 0.

**Periodic re-fetch drift detection** (separate from the per-job probes; runs nightly as a standalone job):

- R1. Sample 1% of `critic_review_raw` rows (stratified by source, weighted toward older rows). Re-fetch the source URL, extract `main_text`, and assert `supporting_quote in main_text` still holds.
- R2. A row whose source page is gone (404) or whose quote no longer matches transitions to `status = 'stale'`. Stale rows are excluded from new summary builds but kept for audit.
- R3. If >5% of sampled rows from a single source go stale in a single sample, the source is flagged for parser review (page structure likely changed).

The 1% sample is **drift detection**, not the anti-hallucination guarantee. The guarantee is W1: 100% of rows are checked at write time against the literal `main_text` we extracted from. The re-fetch only catches cases where the source page was later edited.

**Other guardrails:**

- **Per-source DOM canary** (`tests/critic_reviews/integration/dom_drift.py`): each seeded publication has golden fixtures. A nightly job re-fetches one sample URL from each seed and asserts non-zero extraction. If a seed's extraction rate drops to zero from 20 fetched pages in a window, the seed is auto-paused and a notification fires.
- **Per-source failure thresholds:** 5% over a 50-request window pauses a source. Lower than the original 20% draft because expert review flagged that as too permissive for editorial sources.
- **30-day TTL on archived HTML** — archival only happens for `licensed` (none in v1) and `first_party` (in-house notes, no HTML to archive). `facts_only` never archives raw HTML at any time. In v1 this is effectively a no-op: the cleanup job exists and runs daily but finds nothing to delete. The path is wired up now so v2's licensed feed inherits the retention guarantee automatically.
- **robots.txt + TDM Reservation Protocol check** before every fetch, cached daily. If a source signals reservation, that source is skipped for that domain.
- **Identifying UA + contact + `/scraper-policy` page** with documented 48-hour takedown SLA. Lowest-cost litigation deterrent.
- **`license_class = 'facts_only'` ⇒ `note_text IS NULL`** enforced both as DB CHECK and in `persist/assertions.py`. Persistence layer assertions are part of the contract — bypassing them is a test failure.

---

## 11. Job lifecycle

### 11.1 Backfill

- Input: full distinct producer+cuvée+vintage list from catalog (~1,500-2,000 triplets expected).
- Expected ~20-30 regex candidates per triplet after page-class drops and round-up filtering (so 40-50k total candidates across the backfill — basis for the §13 LLM workload estimate).
- 4-hour daily windows per seed; spread across ~10-14 days.
- Per-item resumable checkpoint in `scrape_progress`.
- Canary first: 5-producer subset before scaling (CLAUDE.md Rule 10).
- Backup before bulk writes: `cp critic_reviews.db critic_reviews.db.bak-pre-backfill-<date>`.

### 11.2 Refresh

- **Editorial / trade press:** quarterly — re-scoring is rare; new articles are caught by new-SKU hook or by sitemap last-modified.
- **Community / dynamic pages:** monthly.
- Skips items where `fetched_at` is within the freshness window.

### 11.3 New-SKU hook

The integration point is **detection via diff**, not a runtime event subscription. Reason: the existing supplier-intake pipeline in `lib/supplier-intake/` and `app/api/supplier-intake/` produces dashboard summaries; actual products.db inserts happen through several scripts under `scripts/` (e.g. `apply_reenrich_sidecar.py`, `sync_to_supabase.py`) and ad-hoc workflows. There is no single function call to subscribe to.

The hook works like this:

1. A nightly job in `lib/critic_reviews/jobs/new_sku_hook.py` derives the current distinct `(producer_canonical, cuvée_canonical)` set from `data/db/products.db`.
2. It compares against a snapshot stored in `data/db/critic_reviews.db.harvest_known_cuvees`.
3. The diff (new producer+cuvée pairs) is enqueued into `scrape_progress` with `status = 'pending'` and a `priority = 'new_sku'` flag.
4. The next refresh window processes them first.
5. After the harvest run, the snapshot is updated.

This is robust to whatever path actually inserts SKUs (CSV import, supplier-intake automation, manual entry, scripts) because it observes the resulting state, not the event. If a future unified persistence layer is introduced in `lib/supplier-intake/`, this can be replaced by a direct event subscription without changing the harvester contract.

Result lands in the UI within ~24 hours of the SKU appearing (one nightly diff + one harvest window).

---

## 12. Testing strategy

### 12.1 Per-stage unit tests

- **Discovery:** mock sitemap.xml / RSS / SearxNG response → assert correct `CandidateURL`s emitted, correct filter behavior, correct producer-match precision.
- **Fetch:** mock httpx → assert robots.txt + TDM check, rate-limit timing, retry-with-backoff, identifying UA.
- **Page classifier:** golden HTML fixtures, asserts correct page_class.
- **Regex extractor:** golden text fixtures with known critic-score patterns (round-up articles, comparison paragraphs, "Suckling gave Lafite 95 but Margaux 96" — the hardest case) → assert candidate list.
- **LLM verifier:** mocked Ollama responses including hallucination attempts → assert literal-substring guard rejects hallucinations.
- **Aggregator:** synthetic raw rows → assert per-scale grouping, no cross-vintage rollup, community vs pro separation.

### 12.2 End-to-end invariants (CLAUDE.md Rule 6)

Lives in `tests/critic_reviews/integration/`:

1. **If `critic_review_raw` has confidence-promoted rows for `(P, C, V)`, then `wine_review_summary` has a corresponding row.**
2. **If `wine_review_summary` has a row for `(P, C, V)` and `sku_to_cuvee` has a binding for SKU `S` to `(P, C, V)`, then `GET /api/products/S/reviews` returns a non-empty `score_by_scale` for `V`.**
3. **No `facts_only` row ever has `note_text` non-null.** (Hard assertion; persistence layer should make this impossible, test guards regression.)
4. **Every `supporting_quote` is a substring of a successfully re-fetched source page.** Run on a sample.
5. **No cross-scale averaging anywhere in the summary.** Schema-level — `score_by_scale` keys must equal the set of scales present in the raw rows for that group.

### 12.3 Canary rollout (CLAUDE.md Rule 10)

Before backfilling at full scale:

1. Pick 5 producer+cuvée+vintage triplets across coverage tiers: one Bordeaux 1er cru (rich data), one mid-tier Napa (medium), one Thai-market specialty (sparse), one whisky cask-strength batch, one NV Champagne with multiple releases.
2. Run end-to-end harvest on those 5 only. Hits real DB writes, real LLM verification.
3. Manual browser walkthrough of each canary SKU's product detail panel (CLAUDE.md Rule 7).
4. Tune confidence thresholds based on observed precision/recall.
5. Compute estimated per-SKU runtime and total backfill duration.
6. User sign-off on the estimate before full backfill (CLAUDE.md Rule 10 step 5).

---

## 13. Cost & operational model

- **No API costs** in v1 (no paid APIs).
- **No proxy costs** in v1 (RSS/sitemap is polite; SearxNG fallback is low volume).
- **LLM cost:** local Ollama llama3.2 — bounded by hardware. Stage 3b runs ~1-3s per candidate. With 40-50k candidates expected from backfill, that's a ~20-40 hour LLM workload over the backfill window. Fits inside the 14-day spread.
- **Engineering:** ~7-9 weeks single-developer based on stage breakdown:
  - Week 1: schema, persistence, verification harness
  - Week 2: discovery (sitemap + SearxNG)
  - Week 3: fetch + page classifier + compliance
  - Week 4: regex extractor + critic normalization
  - Week 5: LLM verifier + confidence model
  - Week 6: aggregator + API endpoint + UI badges
  - Week 7: SKU resolver + canary + manual tuning
  - Week 8-9: backfill execution + buffer
- **Maintenance:** sitemap structures change less often than DOM; expect 1-2 per-seed breakages/year. Each is a fixture update + parser adjustment, ~half-day.

---

## 14. Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Sites change sitemap URL patterns silently | M | DOM-drift / extraction-rate canary; auto-pause + alert |
| 2 | LLM verifier hallucinates a score binding | H | Structural literal-substring guard; rejects any quote not in source text |
| 3 | Wrong critic identity (Parker era vs publication after) | M | `critic` table with affiliations + date ranges; abbreviation expansion is era-aware |
| 4 | Long-tail SKUs (Thai-market brands) have no public data | M | Designed for; `data_completeness = "none"` is a first-class UI state, not an error |
| 5 | Cross-scale or cross-vintage aggregation slips in | H | Forbidden at schema level (no field exists); enforced by invariant test |
| 6 | Confidence thresholds inherited blindly produce false positives | M | CLAUDE.md Rule 3: thresholds tuned on canary, not inherited |
| 7 | Job claims success while data didn't ship to UI | C | CLAUDE.md Rule 1: every job ends with curl-against-API verification probe; "what shipped" report mandatory |
| 8 | Producer+cuvée fuzzy matching binds wrong wine (Pavillon Rouge merged with Grand Vin Margaux) | H | Producer match is exact-canonical; cuvée match has a high-precision step (LLM verify); ambiguous matches require manual confirmation in `sku_to_cuvee.matched_by = 'manual'` |
| 9 | SearxNG instance gets rate-limited by upstream engines | L | Multi-engine rotation handles this naturally; daily cap; fallback role only |
| 10 | New-SKU hook misses some supplier-intake paths | M | Hook is diff-based against `products.db` (§11.3), not event-based — robust to any insertion path; nightly cadence trades freshness for completeness |

---

## 15. Out of scope (explicitly v2+)

- LLM feature extraction (flavor tags, body/acidity/tannin, drinking window) — needs first-party/licensed prose volume to be meaningful; v1 has neither at the volume that would matter.
- Wine-Searcher Pro API, CellarTracker API, any paid/credentialed source.
- Vivino, paywalled critics, logged-in scraping.
- Vintage chart context ("94 in a weak vintage" vs "94 in a great vintage"). Nice-to-have flagged in domain review.
- Price-at-review enrichment.
- Critic-consensus derived scores (your own aggregate IP).
- Drinking-window inference from prose.

---

## 16. Decision log (this design)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Display use of data | Badges + future enrichment | Two-layer storage from day one |
| 2 | Source scope (v1) | Public-web facts only | No payment / no credentials constraint |
| 3 | Matching strategy | Producer+cuvée+vintage, decoupled from SKU | One harvest serves many SKUs; handles "current vintage" gracefully |
| 4 | Refresh cadence | Backfill + scheduled refresh + new-SKU hook | Balanced cost vs freshness |
| 5 | Discovery layer | RSS/sitemap primary + SearxNG fallback | Politest posture; no payment |
| 6 | Extraction layer | Regex shortlist + Ollama LLM verify | Anti-hallucination by construction |
| 7 | License classes | facts_only / first_party / licensed | Legal foundation; future-licensed plug-in path |
| 8 | UI display rule | Score + critic + link only for facts_only | Defensible legal posture, *Feist* fact protection |
| 9 | Schema additions | release_id, batch_id, tasting_date, tasting_context, source_tier, abv, disgorgement_date, bottling_date, cask_type | Wine/spirits domain reality |
| 10 | Aggregation rules | Per-scale only; no cross-vintage; community separate | Domain-expert mandate |
| 11 | Critic identity | Normalized `critic` table with affiliations | Handles Parker → Wine Advocate team → Vinous era shifts |
| 12 | Confidence model | Multi-source corroboration weighted; thresholds tuned on canary | CLAUDE.md Rule 3 |
| 13 | Verification | Curl-against-API probe at end of every job | CLAUDE.md Rule 1 |
| 14 | Storage location | New `data/db/critic_reviews.db` parallel to `products.db` | Independent versioning; no entanglement with live_products_export |

---

## 17. Resolved decisions (previously open)

- **Producer-name canonicalization** — relies on the existing brand-curation library (`data/db/suppliers.json` + the canonicalization passes in `lib/supplier-intake/normalization.ts` and the brand-description-library curation work). The harvester wraps these in `lib/critic_reviews/resolver/normalization.py` as a thin Python adapter — same canonical names, same aliases, no duplicate canonicalization logic. If the brand-curation surface changes shape, this adapter is the single update point.
- **5-star scale handling** — v1 keeps `5star` rows separate per source. Aggregation never crosses sources for `5star`; each source's 5-star scores appear in `score_by_scale.5star` as a per-source breakdown. Cross-source 5-star calibration is deferred to v2 if/when the volume justifies it.
- **Harvest provenance in API** — kept internal. The public `/api/products/<sku>/reviews` response includes `url` (so users can click through) but not `discovered_via` or `page_class`. This keeps the API contract narrow and avoids leaking infrastructure detail.
- **Producer-name fuzzy match** — token-set ratio (RapidFuzz `token_set_ratio`) at threshold 92 for sitemap-URL matching, exact-canonical only for binding rows to producer+cuvée. Threshold tuned on the canary.

## 18. Producer-name match precision (failure mode reference)

The single highest-risk binding error is merging different cuvées from the same producer (Pavillon Rouge vs Margaux Grand Vin; Petit Mouton vs Mouton Rothschild; Forts de Latour vs Latour). Mitigations:

- Producer canonical match is **exact** (not fuzzy) at row binding time.
- Cuvée canonical match is exact when the canonical alias list is populated; fuzzy at `token_set_ratio ≥ 95` only when no exact alias hit and the source page mentions the producer name within 200 chars of the candidate.
- LLM verifier prompt (§7.2) explicitly asks "same cuvée, not a different bottling from the same producer."
- The `cuvée_canonical` aliases for known second-label producers carry an explicit `parent_producer` flag in the brand-curation library; the harvester refuses to bind a Pavillon-Rouge-tagged review to a Margaux-Grand-Vin SKU and vice versa.
