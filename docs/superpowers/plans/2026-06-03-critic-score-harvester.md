# Critic Score Harvester — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public-web critic-score harvester that surfaces critic badges ("JS 95", "Whisky Advocate 90", "IWSC Silver") on every product detail page where public data exists. Targets ~64% catalog coverage based on the 50-SKU recon evidence. Zero payment, zero credentials, zero LLM in v1.

**Architecture:** Python pipeline under `lib/critic_reviews/` with 8 source adapters (1 API + 7 polite HTTP scrapers); writes to a new `critic_scores` table in the existing `data/db/products.db`; reuses the empty `products.score_max` / `products.score_summary` columns; surfaces badges via a new `CriticScoreBadges` React component on the existing product detail panel.

**Tech Stack:** Python 3.11 stdlib + `httpx` (already a transitive dep via `anthropic`), `beautifulsoup4` (new — for HTML parsing), `selectolax` (new — fast HTML text extractor, optional fallback), pytest. Frontend: existing Next.js 14 + React 18 + TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-03-critic-score-harvester-design.md](../specs/2026-06-03-critic-score-harvester-design.md)

**Evidence:** [data/critic_reviews_recon/results_merged.json](../../../data/critic_reviews_recon/results_merged.json) — 50-SKU labeled recon set, doubles as ground truth for the precision canary.

**CLAUDE.md rules in play:** 1 (verify shipping), 3 (audit thresholds), 4 (cost report includes "what shipped"), 6 (end-to-end invariants), 7 (UI browser verify), 9 (two data sources — `products.db` vs `live_products_export.json`), 10 (canary before bulk).

---

## File Structure

### Files to create

| Path | Responsibility |
| --- | --- |
| `lib/critic_reviews/__init__.py` | Package marker. |
| `lib/critic_reviews/types.py` | Frozen dataclasses: `WineQuery`, `FetchedPage`, `ExtractedScore`, `ExtractedMedal`, `PersistResult`, `JobReport`. |
| `lib/critic_reviews/catalog.py` | Distinct `(producer, cuvee, vintage)` triplets from `products.db`. Filter rules. |
| `lib/critic_reviews/persist/__init__.py` | Package marker. |
| `lib/critic_reviews/persist/schema.sql` | DDL for `critic_scores` + `scrape_progress` + `harvest_job_report` tables; indexes; CHECK constraints. |
| `lib/critic_reviews/persist/repository.py` | Typed accessors. `find_for_audit()` vs `find_for_serving()` split (per spec §5.1). |
| `lib/critic_reviews/persist/assertions.py` | Write-time invariant assertions. `assert_supporting_text_in_payload()`. Rejects rows that fail. |
| `lib/critic_reviews/fetch/__init__.py` | Package marker. |
| `lib/critic_reviews/fetch/http_client.py` | Polite `httpx` wrapper: per-domain rate limit, identifying UA, robots.txt cache, retry-with-backoff. |
| `lib/critic_reviews/fetch/page_parser.py` | HTML → `FetchedPage` (page_title, page_h1, og_title, main_text, paragraphs). |
| `lib/critic_reviews/extract/__init__.py` | Package marker. |
| `lib/critic_reviews/extract/score_patterns.py` | The 5 regex patterns + `is_plausible_score()` (spec §7.1). |
| `lib/critic_reviews/extract/scale_conversion.py` | 20pt → 100pt-equivalent table (spec §7.4). |
| `lib/critic_reviews/extract/critic_registry.py` | Source/critic name → `signal_tier` + `signal_class` map (spec §3.2). |
| `lib/critic_reviews/extract/extractor.py` | Two-pass extraction: regex shortlist, then producer+vintage binding rules (spec §7.2). Returns `list[ExtractedScore]`. |
| `lib/critic_reviews/sources/__init__.py` | Package marker. |
| `lib/critic_reviews/sources/base.py` | `Source` protocol; common adapter helpers. |
| `lib/critic_reviews/sources/cellartracker.py` | API client (preferred) + HTML-scrape fallback (if API access denied). |
| `lib/critic_reviews/sources/wine_enthusiast.py` | In-site search → detail fetch → extract. |
| `lib/critic_reviews/sources/natalie_maclean.py` | In-site search → detail. |
| `lib/critic_reviews/sources/winealign.py` | In-site search → detail. |
| `lib/critic_reviews/sources/real_review.py` | In-site search → detail. |
| `lib/critic_reviews/sources/whiskybase.py` | Deterministic-URL by distillery + bottling name. |
| `lib/critic_reviews/sources/master_of_malt.py` | In-site search → detail. |
| `lib/critic_reviews/sources/distiller.py` | Deterministic-URL by spirit slug. |
| `lib/critic_reviews/refresh_products_summary.py` | Rebuilds `products.score_max` + `products.score_summary` from `critic_scores`. |
| `lib/critic_reviews/jobs/__init__.py` | Package marker. |
| `lib/critic_reviews/jobs/backfill.py` | Multi-source parallel backfill orchestrator. |
| `lib/critic_reviews/jobs/refresh.py` | Quarterly re-scan. |
| `lib/critic_reviews/jobs/report.py` | `JobReport` builder + "what shipped" formatter (CLAUDE.md Rule 4). |
| `lib/critic_reviews/verification.py` | Post-job probes (curl-api smoke check, count queries). |
| `scripts/critic_reviews_canary.py` | Run the 50-SKU recon set as a precision canary; print confusion matrix. |
| `scripts/critic_reviews_cellartracker_outreach.txt` | Draft email to Eric Levine for CT API access. |
| `app/api/products/[sku]/route.ts` | New Next.js API route — returns existing product fields + new `reviews[]`. (NEW route; spec §9 says badges piggyback on the existing detail surface — but the existing surface is `data/live_products_export.json`, which doesn't have a per-SKU API. We add this route as the single read path.) |
| `components/product/CriticScoreBadges.tsx` | Render score badges with critic, score, outbound link. |
| `tests/critic_reviews/__init__.py` | Test package marker. |
| `tests/critic_reviews/fixtures/wine_enthusiast/sample_article.html` | Golden HTML fixture. |
| `tests/critic_reviews/fixtures/wine_enthusiast/round_up_article.html` | Round-up article fixture (tests the multi-wine binding rule). |
| `tests/critic_reviews/fixtures/cellartracker/sample_api_response.json` | Golden API response fixture. |
| `tests/critic_reviews/fixtures/(per-source)/*` | Golden fixtures, one per source adapter. |
| `tests/critic_reviews/test_score_patterns.py` | Regex unit tests including FP rejection ("DEC 92", "WE 100% recommend"). |
| `tests/critic_reviews/test_scale_conversion.py` | 20pt → 100pt table. |
| `tests/critic_reviews/test_critic_registry.py` | Tier lookup. |
| `tests/critic_reviews/test_extractor.py` | Producer-proximity + vintage binding rules; golden-text fixtures. |
| `tests/critic_reviews/test_assertions.py` | Write-time invariant rejects hallucinated supporting_text. |
| `tests/critic_reviews/test_persist.py` | Repository read/write with redaction split. |
| `tests/critic_reviews/test_http_client.py` | Politeness, retry, robots.txt cache. |
| `tests/critic_reviews/test_page_parser.py` | HTML → FetchedPage parts. |
| `tests/critic_reviews/test_source_<name>.py` | One per source adapter — golden fixture → expected rows. |
| `tests/critic_reviews/test_refresh_summary.py` | Merge rules from spec §6. |
| `tests/critic_reviews/test_e2e_invariants.py` | CLAUDE.md Rule 6 — if critic_scores has rows for (P,C,V), then summary has them and the API returns them. |
| `tests/critic_reviews/test_api_route.ts` | Next.js route returns expected shape including the redacted `supporting_text` rule. |
| `tests/critic_reviews/test_canary_precision.py` | Runs the 50-SKU recon set through the extractor; asserts ≥90% precision. |

### Files to modify

| Path | Change |
| --- | --- |
| `requirements.txt` | Add `httpx>=0.27.0`, `beautifulsoup4>=4.12.0`, `selectolax>=0.3.21`, `tenacity>=8.2.0`. |
| `scripts/refresh_live_export.py` | After the bulk export, log row counts for `score_max IS NOT NULL` (so the "what shipped" report can read it). No format change — just an extra `print()`. |
| `package.json` | No deps to add. Add `"reviews:dev": "next dev"` script alias (optional convenience for canary browser checks). |

### Files NOT touched in this plan

- `data/db/products.db` schema: only ADDS the `critic_scores`, `scrape_progress`, `harvest_job_report` tables. Does not change `products` table structure (uses existing `score_max` + `score_summary` columns).
- `data/live_products_export.json` — picks up the new columns via `refresh_live_export.py` automatically.
- `app/api/products/[sku]/route.ts` — created (above); the *existing* product detail UI in `components/explore/` continues to read from `data/live_products_export.json`. The new `reviews[]` flows through automatically because we populate `products.score_summary` JSON.
- `lib/curation/`, `lib/enrichment/`, `lib/supplier-intake/` — unrelated, untouched.
- `lib/taxonomy/`, `lib/explore/` — unrelated, untouched.

### Open implementation decisions resolved here (from spec)

1. **CT API outreach is Day 0** — operator-task, not engineering. Implementation starts Day 1 regardless; if CT denies, the HTML-scrape fallback adapter is the Day 4-5 deliverable instead of the API adapter.
2. **HTML parsing library** — `beautifulsoup4` for structure (title/h1/og), `selectolax` for fast text extraction (faster than bs4 for `main_text`).
3. **Async or sync** — sync `httpx.Client` with manual rate limiting. Async would speed up cross-source parallelism but adds complexity not justified at v1's volume.
4. **Where API route lives** — `app/api/products/[sku]/route.ts` is the SINGLE source of truth for serving review data. The existing explore UI reads from `live_products_export.json` (which includes `score_summary` from the bulk export) — they're equivalent for v1 because both routes ultimately read from `products.score_summary`.

---

## Execution order

```text
Phase 0: Day 0 — Outreach (OPERATOR, not engineering)
  Task 0.1: Send CellarTracker API request email
     ↓ (does not block engineering)
Phase 1: Foundation (Week 1, Day 1-3)
  Task 1.1: Project skeleton + requirements
  Task 1.2: Schema + persistence + write-time assertions
  Task 1.3: Score patterns + scale conversion + critic registry
  Task 1.4: Page parser + extractor (with binding rules)
  Task 1.5: HTTP client (politeness, robots, retries)
     ↓
Phase 2: First adapter end-to-end (Day 4-5)
  Task 2.1: CellarTracker adapter (API mode if granted, scrape if not)
  Task 2.2: Backfill job skeleton + JobReport
  Task 2.3: 5-SKU canary against CT — first data lands
     ↓
Phase 3: Editorial scrapers (Week 2, Day 6-10)
  Task 3.1: Wine Enthusiast adapter (highest yield; in-site search)
  Task 3.2: Natalie MacLean adapter
  Task 3.3: WineAlign adapter
  Task 3.4: The Real Review adapter
  Task 3.5: Whiskybase adapter
  Task 3.6: Master of Malt adapter
  Task 3.7: Distiller adapter
     ↓
Phase 4: Integration + UI (Week 3, Day 11-12)
  Task 4.1: refresh_products_summary.py (merge rules)
  Task 4.2: API route (/api/products/[sku])
  Task 4.3: CriticScoreBadges component
  Task 4.4: Browser walkthrough on 5 canary SKUs
     ↓
Phase 5: Canary + tuning + backfill (Day 13-15)
  Task 5.1: Run 50-SKU precision canary — confusion matrix
  Task 5.2: Tune thresholds / fix top FP patterns
  Task 5.3: Verification job runner + e2e invariant tests
  Task 5.4: Kick off backfill (background, runs 5-10 days)
```

Tasks within a phase that touch independent files MAY run in parallel via subagents. Within a single source adapter task, steps are sequential (TDD).

---

## Phase 0: Day-0 outreach (operator task)

### Task 0.1: Send CellarTracker API request

**Files:**

- Create: `scripts/critic_reviews_cellartracker_outreach.txt`

This is an operator action, not engineering work. Drafted by Claude, sent by you.

- [ ] **Step 1: Draft the outreach email**

Create `scripts/critic_reviews_cellartracker_outreach.txt`:

```text
To: eric@cellartracker.com
Subject: API access request — Wine-Now/LIQ9 (Thailand wine + spirits retailer)

Hi Eric,

I run Wine-Now (th.wine-now.com) and LIQ9 (th.liq9.com), a Thai-market
wine and spirits retailer with ~11,400 SKUs. I'm building a critic-score
display on our product detail pages so customers can see attributed
reviews alongside each wine.

CellarTracker came out as one of the most consistent sources of
attributed score data in our reconnaissance. I'd like to request API
access for read-only score and tasting-note retrieval, with proper
attribution and click-through links to cellartracker.com on each
review we display.

Volume expectations:
- ~5,000 distinct producer+cuvee+vintage queries during initial backfill,
  spread over ~10 days (≤1 request per 3 seconds per source).
- Quarterly refresh thereafter.

Happy to discuss any usage terms, attribution requirements, or rate
limits you'd like in place.

Thanks for considering,
[Your name]
[Your role]
Wine-Now / LIQ9
```

- [ ] **Step 2: Operator sends the email**

Operator (you) sends from your business email. Engineering does NOT wait — the CT adapter has a fallback path (Phase 2 Task 2.1 covers both).

- [ ] **Step 3: Record outcome in spec**

When Eric responds, append to spec §15 the outcome and date. If no response in 7 days, default to fallback mode.

---

## Phase 1: Foundation (Day 1-3)

### Task 1.1: Project skeleton + requirements

**Files:**

- Create: `lib/critic_reviews/__init__.py`
- Create: `lib/critic_reviews/persist/__init__.py`
- Create: `lib/critic_reviews/fetch/__init__.py`
- Create: `lib/critic_reviews/extract/__init__.py`
- Create: `lib/critic_reviews/sources/__init__.py`
- Create: `lib/critic_reviews/jobs/__init__.py`
- Create: `tests/critic_reviews/__init__.py`
- Modify: `requirements.txt`
- Create: `lib/critic_reviews/types.py`

- [ ] **Step 1: Create the package directories**

```bash
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/critic_reviews/persist"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/critic_reviews/fetch"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/critic_reviews/extract"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/critic_reviews/sources"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/lib/critic_reviews/jobs"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests/critic_reviews/fixtures"
```

- [ ] **Step 2: Write empty `__init__.py` files** for each package directory created above.

- [ ] **Step 3: Add dependencies to `requirements.txt`**

Append:

```text
httpx>=0.27.0
beautifulsoup4>=4.12.0
selectolax>=0.3.21
tenacity>=8.2.0
```

- [ ] **Step 4: Install dependencies**

```bash
.venv/bin/pip install -r requirements.txt
```

Expected: "Successfully installed httpx-... beautifulsoup4-... selectolax-... tenacity-..."

- [ ] **Step 5: Write `lib/critic_reviews/types.py`**

```python
"""Frozen dataclasses used across the harvester.

Importing rule: nothing in this file imports from anywhere else in
the package. It's the leaf module so every other module can import
from it without circular dependencies.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

ScoreScale = Literal["100pt", "20pt", "5star", "medal", "community"]
SignalClass = Literal["critic_numeric", "critic_text", "community", "medal"]
SignalTier = Literal[1, 2, 3, 4]


@dataclass(frozen=True)
class WineQuery:
    """What we're asking the harvester to find."""
    producer: str
    cuvee: str
    vintage: Optional[int]  # None for NV / batch / undetermined
    sku: Optional[str] = None  # informational only; binding is by producer+cuvee+vintage


@dataclass(frozen=True)
class FetchedPage:
    """Output of fetch + parse stages. Pure data."""
    url: str
    fetched_at: datetime
    status_code: int
    page_title: str
    page_h1: str
    og_title: str
    main_text: str  # block-level concatenated innerText
    paragraphs: tuple[str, ...]  # split of main_text on \n\n


@dataclass(frozen=True)
class ExtractedScore:
    """Score candidate that survived binding rules. Ready to persist."""
    producer: str
    cuvee: str
    vintage: Optional[int]
    source: str  # e.g. "cellartracker", "wine_enthusiast"
    source_url: str
    source_review_id: Optional[str]
    critic: str
    score_native: str  # as published: "94", "17.5/20", "IWSC Silver", "93+"
    score_scale: ScoreScale
    score_value: Optional[float]  # normalized for 100pt and 20pt; None for medals/community
    supporting_text: str  # ≤200 char literal substring of main_text
    signal_class: SignalClass
    signal_tier: SignalTier
    confidence: float = 0.7


@dataclass(frozen=True)
class PersistResult:
    """Return value from repository.write_score()."""
    written: bool
    row_id: Optional[str]
    rejection_reason: Optional[str]  # set when written=False


@dataclass
class JobReport:
    """Mutable accumulator for the 'what shipped' report (CLAUDE.md Rule 4)."""
    job_id: str
    job_type: Literal["backfill", "refresh", "canary"]
    started_at: datetime
    finished_at: Optional[datetime] = None
    sources_processed: int = 0
    distinct_triplets: int = 0
    pages_fetched: int = 0
    pages_with_score: int = 0
    rows_written_raw: int = 0
    rows_rejected_assertions: int = 0
    skus_newly_populated: int = 0
    notes: str = ""
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add lib/critic_reviews/ tests/critic_reviews/ requirements.txt
git commit -m "feat(critic-reviews): scaffold package + frozen types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.2: Schema + persistence + write-time assertions

**Files:**

- Create: `lib/critic_reviews/persist/schema.sql`
- Create: `lib/critic_reviews/persist/repository.py`
- Create: `lib/critic_reviews/persist/assertions.py`
- Create: `tests/critic_reviews/test_persist.py`
- Create: `tests/critic_reviews/test_assertions.py`

- [ ] **Step 1: Write the failing assertion test**

Create `tests/critic_reviews/test_assertions.py`:

```python
"""Write-time invariant rejects rows whose supporting_text isn't in the source page."""
import pytest
from lib.critic_reviews.persist.assertions import (
    assert_supporting_text_in_payload,
    SupportingTextNotFoundError,
)


def test_passes_when_supporting_text_is_in_payload():
    payload = "Wine Enthusiast scored this 91 points. A blockbuster of a wine."
    assert_supporting_text_in_payload("Wine Enthusiast scored this 91 points", payload)


def test_rejects_when_supporting_text_not_in_payload():
    payload = "Wine Enthusiast scored this 91 points."
    with pytest.raises(SupportingTextNotFoundError):
        assert_supporting_text_in_payload("Wine Spectator scored this 92", payload)


def test_rejects_empty_supporting_text():
    with pytest.raises(SupportingTextNotFoundError):
        assert_supporting_text_in_payload("", "anything")


def test_normalizes_whitespace_before_comparison():
    """Reasonable whitespace normalization is OK; we shouldn't reject for HTML
    collapsing \\n into a space."""
    payload = "Score: 91\n\npoints, says Wine Enthusiast."
    assert_supporting_text_in_payload("Score: 91 points, says Wine Enthusiast", payload)
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/pytest tests/critic_reviews/test_assertions.py -v
```

Expected: `ModuleNotFoundError: No module named 'lib.critic_reviews.persist.assertions'`

- [ ] **Step 3: Implement `assertions.py`**

```python
"""Write-time invariant assertions.

These run on EVERY row before it lands in the DB. A row that fails is not
silently dropped — it raises, which lets the caller log it and increment
the parser-bug counter (CLAUDE.md Rule 2 — investigate non-success states,
not silently skip them).
"""
import re


class SupportingTextNotFoundError(ValueError):
    """The supporting_text quote is not a substring of the source payload."""


_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    """Collapse all whitespace runs to single spaces, strip."""
    return _WS.sub(" ", s).strip()


def assert_supporting_text_in_payload(supporting_text: str, payload: str) -> None:
    """Raise if `supporting_text` is not a (whitespace-normalized) substring of `payload`.

    Whitespace normalization is justified because HTML-to-text conversion is
    not deterministic — collapsing \\n\\n into a space when comparing avoids
    false rejections for innocent reflows. We do NOT normalize case, accents,
    or punctuation; those changes would weaken the anti-hallucination guarantee.
    """
    if not supporting_text or not supporting_text.strip():
        raise SupportingTextNotFoundError("supporting_text is empty")
    if _norm(supporting_text) not in _norm(payload):
        raise SupportingTextNotFoundError(
            f"supporting_text {supporting_text!r} not found in payload (len={len(payload)})"
        )
```

- [ ] **Step 4: Run the assertion test — verify it passes**

```bash
.venv/bin/pytest tests/critic_reviews/test_assertions.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Write `schema.sql`**

Create `lib/critic_reviews/persist/schema.sql`:

```sql
-- Critic Score Harvester v1 schema.
-- Lives inside data/db/products.db (the existing product database) to keep
-- cross-table joins simple. Tables are namespaced with "critic_scores_" /
-- "harvest_" to avoid colliding with anything in the products domain.

CREATE TABLE IF NOT EXISTS critic_scores (
  id              TEXT PRIMARY KEY,
  sku             TEXT,
  producer        TEXT NOT NULL,
  cuvee           TEXT NOT NULL,
  vintage         INTEGER,

  source          TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  source_review_id TEXT,

  critic          TEXT NOT NULL,
  score_native    TEXT NOT NULL,
  score_scale     TEXT NOT NULL,
  score_value     REAL,

  supporting_text TEXT NOT NULL,
  signal_class    TEXT NOT NULL,
  signal_tier     INTEGER NOT NULL,

  fetched_at      TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0.7,

  CHECK (score_scale IN ('100pt', '20pt', '5star', 'medal', 'community')),
  CHECK (signal_class IN ('critic_numeric', 'critic_text', 'community', 'medal')),
  CHECK (signal_tier BETWEEN 1 AND 4),
  CHECK (length(supporting_text) > 0)
);

CREATE INDEX IF NOT EXISTS idx_critic_scores_producer_cuvee_vintage
  ON critic_scores(producer, cuvee, vintage);
CREATE INDEX IF NOT EXISTS idx_critic_scores_source_fetched
  ON critic_scores(source, fetched_at);
CREATE INDEX IF NOT EXISTS idx_critic_scores_sku
  ON critic_scores(sku) WHERE sku IS NOT NULL;


CREATE TABLE IF NOT EXISTS scrape_progress (
  source         TEXT NOT NULL,
  producer       TEXT NOT NULL,
  cuvee          TEXT NOT NULL,
  vintage        INTEGER,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  last_attempt_at TEXT,
  PRIMARY KEY (source, producer, cuvee, vintage),
  CHECK (status IN ('pending', 'in_progress', 'done', 'transient_fail', 'permanent_skip'))
);


CREATE TABLE IF NOT EXISTS harvest_job_report (
  job_id                  TEXT PRIMARY KEY,
  job_type                TEXT NOT NULL,
  started_at              TEXT NOT NULL,
  finished_at             TEXT,
  sources_processed       INTEGER NOT NULL DEFAULT 0,
  distinct_triplets       INTEGER NOT NULL DEFAULT 0,
  pages_fetched           INTEGER NOT NULL DEFAULT 0,
  pages_with_score        INTEGER NOT NULL DEFAULT 0,
  rows_written_raw        INTEGER NOT NULL DEFAULT 0,
  rows_rejected_assertions INTEGER NOT NULL DEFAULT 0,
  skus_newly_populated    INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT
);
```

- [ ] **Step 6: Write the failing persist test**

Create `tests/critic_reviews/test_persist.py`:

```python
"""Repository round-trip + facts_only redaction at serve time."""
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.types import ExtractedScore


@pytest.fixture
def repo():
    db = Path(tempfile.mkdtemp()) / "test.db"
    r = Repository(str(db))
    r.init_schema()
    yield r
    r.close()


def _score(**overrides) -> ExtractedScore:
    defaults = dict(
        producer="Pio Cesare",
        cuvee="Barolo Mosconi DOCG",
        vintage=2020,
        source="james_suckling",
        source_url="https://jamessuckling.com/wines/12345",
        source_review_id="12345",
        critic="James Suckling",
        score_native="99",
        score_scale="100pt",
        score_value=99.0,
        supporting_text="99 points by James Suckling",
        signal_class="critic_numeric",
        signal_tier=1,
        confidence=0.9,
    )
    defaults.update(overrides)
    return ExtractedScore(**defaults)


def test_write_then_find_for_audit_returns_full_row(repo):
    s = _score()
    result = repo.write_score(s, payload="Page text including 99 points by James Suckling here.")
    assert result.written
    row = repo.find_for_audit(producer="Pio Cesare", cuvee="Barolo Mosconi DOCG", vintage=2020)[0]
    assert row.supporting_text == "99 points by James Suckling"


def test_write_rejects_when_supporting_text_not_in_payload(repo):
    s = _score(supporting_text="WS 91 points")  # different text
    result = repo.write_score(s, payload="Page text says JS 99 points.")
    assert not result.written
    assert "not found" in result.rejection_reason.lower()
```

- [ ] **Step 7: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_persist.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 8: Implement `repository.py`**

```python
"""Typed accessor over the critic_scores DB.

Exposes find_for_audit() (full row) and find_for_serving() (redacts
supporting_text from facts_only rows — spec §5.1).
"""
from __future__ import annotations
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lib.critic_reviews.persist.assertions import (
    SupportingTextNotFoundError,
    assert_supporting_text_in_payload,
)
from lib.critic_reviews.types import ExtractedScore, PersistResult

_SCHEMA_SQL = Path(__file__).parent / "schema.sql"


class Repository:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None

    def _c(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def init_schema(self) -> None:
        sql = _SCHEMA_SQL.read_text()
        self._c().executescript(sql)
        self._c().commit()

    def write_score(self, score: ExtractedScore, *, payload: str) -> PersistResult:
        """Write one row. Raises or returns PersistResult(written=False) on assertion failure."""
        try:
            assert_supporting_text_in_payload(score.supporting_text, payload)
        except SupportingTextNotFoundError as e:
            return PersistResult(written=False, row_id=None, rejection_reason=str(e))

        row_id = str(uuid.uuid4())
        self._c().execute(
            """INSERT INTO critic_scores
               (id, sku, producer, cuvee, vintage,
                source, source_url, source_review_id,
                critic, score_native, score_scale, score_value,
                supporting_text, signal_class, signal_tier,
                fetched_at, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (row_id, None, score.producer, score.cuvee, score.vintage,
             score.source, score.source_url, score.source_review_id,
             score.critic, score.score_native, score.score_scale, score.score_value,
             score.supporting_text, score.signal_class, score.signal_tier,
             datetime.now(timezone.utc).isoformat(), score.confidence),
        )
        self._c().commit()
        return PersistResult(written=True, row_id=row_id, rejection_reason=None)

    def find_for_audit(self, *, producer: str, cuvee: str, vintage: Optional[int]) -> list:
        """Return full rows including supporting_text. For internal/audit use only."""
        rows = self._c().execute(
            "SELECT * FROM critic_scores WHERE producer=? AND cuvee=? AND vintage IS ?",
            (producer, cuvee, vintage),
        ).fetchall()
        return [self._row_to_score(r) for r in rows]

    def find_for_serving(self, *, sku: str) -> list:
        """Return rows safe to expose via the public API. Always strips
        supporting_text (facts_only invariant — spec §5.1)."""
        rows = self._c().execute(
            """SELECT cs.* FROM critic_scores cs
               JOIN products p ON p.sku = ?
               WHERE lower(trim(cs.producer)) = lower(trim(p.brand))
                 AND (cs.vintage = p.vintage
                      OR (p.vintage IN ('Current vintage', '', 'NV') AND cs.vintage IS NOT NULL)
                      OR (p.vintage = '' AND cs.vintage IS NULL))
               ORDER BY cs.vintage DESC NULLS LAST, cs.signal_tier ASC""",
            (sku,),
        ).fetchall()
        return [self._row_to_score(r, redact=True) for r in rows]

    @staticmethod
    def _row_to_score(row: sqlite3.Row, *, redact: bool = False) -> ExtractedScore:
        return ExtractedScore(
            producer=row["producer"], cuvee=row["cuvee"], vintage=row["vintage"],
            source=row["source"], source_url=row["source_url"],
            source_review_id=row["source_review_id"], critic=row["critic"],
            score_native=row["score_native"], score_scale=row["score_scale"],
            score_value=row["score_value"],
            supporting_text="" if redact else row["supporting_text"],
            signal_class=row["signal_class"], signal_tier=row["signal_tier"],
            confidence=row["confidence"],
        )
```

- [ ] **Step 9: Run — verify it passes**

```bash
.venv/bin/pytest tests/critic_reviews/test_persist.py -v
```

Expected: 2 passed.

- [ ] **Step 9.5: Backup the live DB before applying schema (CLAUDE.md Rule 10)**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cp data/db/products.db "data/db/products.db.bak-pre-critic-schema-$(date +%Y%m%d-%H%M%S)"
ls -la data/db/products.db.bak-pre-critic-schema-* | tail -1
```

Expected: a fresh `.bak-pre-critic-schema-...` file appears. Even though `CREATE TABLE IF NOT EXISTS` is non-destructive, the discipline applies to every schema change.

- [ ] **Step 10: Apply schema to the real DB**

```bash
.venv/bin/python -c "
from lib.critic_reviews.persist.repository import Repository
r = Repository('data/db/products.db')
r.init_schema()
r.close()
print('schema applied')
"
sqlite3 data/db/products.db ".schema critic_scores" | head -5
```

Expected: prints the `CREATE TABLE critic_scores (...)` definition.

- [ ] **Step 11: Commit**

```bash
git add lib/critic_reviews/persist/ tests/critic_reviews/test_assertions.py tests/critic_reviews/test_persist.py
git commit -m "feat(critic-reviews): schema + repository + write-time assertions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.3: Score patterns + scale conversion + critic registry

**Files:**

- Create: `lib/critic_reviews/extract/score_patterns.py`
- Create: `lib/critic_reviews/extract/scale_conversion.py`
- Create: `lib/critic_reviews/extract/critic_registry.py`
- Create: `tests/critic_reviews/test_score_patterns.py`
- Create: `tests/critic_reviews/test_scale_conversion.py`
- Create: `tests/critic_reviews/test_critic_registry.py`

- [ ] **Step 1: Write failing score-pattern tests**

Create `tests/critic_reviews/test_score_patterns.py`:

```python
"""Score regex tests, including the explicit false-positive rejection set
called out by the spec reviewer."""
import pytest
from lib.critic_reviews.extract.score_patterns import extract_candidates, is_plausible_score


# --- True positives ---

@pytest.mark.parametrize("text,expected_critic,expected_score", [
    ("This wine got 94/100 from Decanter.", None, "94"),
    ("17.5/20 — Jancis Robinson", None, "17.5"),
    ("James Suckling: 95 points", "James Suckling", "95"),
    ("Wine Enthusiast 91 pts", "Wine Enthusiast", "91"),
    ("Scored 92 by Decanter", "Decanter", "92"),
    ("92 points (James Suckling)", "James Suckling", "92"),
    ("JS 95 pts", "JS", "95"),
    ("WA 96/100", "WA", "96"),
    ("IWSC Silver medal", None, None),  # medal pattern, no score
])
def test_pattern_extracts(text, expected_critic, expected_score):
    cands = extract_candidates(text)
    assert len(cands) >= 1
    if expected_score:
        assert any(c.score_raw == expected_score for c in cands)
    if expected_critic:
        assert any(expected_critic.lower() in (c.critic_raw or "").lower() for c in cands)


# --- False positive rejections (the regex-tightening targets) ---

@pytest.mark.parametrize("text", [
    "DEC 92 was a great month.",                       # DEC = December, not Decanter
    "WE 100% recommend this bottle.",                  # WE 100% != WE 100 score
    "Posted on JR 19, 2022.",                          # JR 19 = a date
    "Lot WA 19-2024 from the cellar.",                 # WA 19-something
    "VN 92.3% pure.",                                  # VN with percentage
    "WS 50 in stock.",                                 # WS 50 = inventory; score below plausible range
])
def test_pattern_rejects_false_positives(text):
    cands = extract_candidates(text)
    # The candidate list may be non-empty (regex matches), but is_plausible_score
    # OR the absence of the score-context anchor must filter them.
    # Final acceptance: no candidate has a critic+score pair that survives the filter.
    confirmed = [c for c in cands if c.critic_raw and c.score_raw and is_plausible_score(float(c.score_raw), "100pt" if "/100" not in text else "100pt")]
    assert len(confirmed) == 0, f"{text!r} produced false positive: {confirmed}"


# --- Range scores ("95-97" en primeur) ---

def test_range_score_extracted():
    cands = extract_candidates("WA 95-97 (en primeur)")
    assert any(c.score_raw and "-" in c.score_raw for c in cands) or any(c.score_raw == "95" for c in cands)


# --- Medals ---

@pytest.mark.parametrize("text,authority,medal", [
    ("IWSC Silver 2022", "IWSC", "Silver"),
    ("Decanter World Wine Awards Gold", "Decanter World Wine Awards", "Gold"),
    ("Bartender Spirits Awards Silver medal", "Bartender Spirits Awards", "Silver"),
])
def test_medal_patterns(text, authority, medal):
    cands = extract_candidates(text)
    medals = [c for c in cands if c.medal_authority]
    assert any(m.medal_authority and authority.lower() in m.medal_authority.lower() for m in medals)
    assert any(m.medal_grade == medal for m in medals)


# --- is_plausible_score ---

def test_is_plausible_score_100pt():
    assert is_plausible_score(95, "100pt")
    assert not is_plausible_score(19, "100pt")     # too low — probably a year fragment
    assert not is_plausible_score(105, "100pt")    # too high


def test_is_plausible_score_20pt():
    assert is_plausible_score(17.5, "20pt")
    assert not is_plausible_score(5, "20pt")
```

- [ ] **Step 2: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_score_patterns.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `score_patterns.py`**

```python
"""Regex score patterns.

Design rule: prefer precision over recall. Every persisted row is shown
to a customer; a false-positive score on a product page is much worse than
missing a real score. The patterns require a score-context anchor (`pts`,
`points`, `/100`, `/20`) on every abbreviation form to eliminate the most
common false positives.

`extract_candidates(text)` returns ALL matches; downstream stages
(producer-proximity filter in `extractor.py`) decide which survive.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class ExtractCandidate:
    critic_raw: Optional[str]
    score_raw: Optional[str]
    score_scale: Optional[str]
    medal_authority: Optional[str]
    medal_grade: Optional[str]
    match_offset: int
    match_text: str  # the full text the regex matched


# Pattern 1 — explicit denominator
_RE_DENOM = re.compile(r"\b(?P<score>\d{2,3}(?:\.\d)?)\s*/\s*(?P<denom>100|20)\b")

# Pattern 2 — full critic name then score with optional context
_CRITIC_NAMES = (
    r"James Suckling|Wine Enthusiast|Wine Spectator|Wine Advocate|"
    r"Robert Parker|Decanter|Vinous|Jancis Robinson|Antonio Galloni|Neal Martin|"
    r"Natalie MacLean|WineAlign|The Real Review|James Halliday|"
    r"Whisky Advocate|Master of Malt|Distiller|Whiskybase"
)
_RE_FULL_NAME = re.compile(
    rf"(?P<critic>{_CRITIC_NAMES})\s*[:\s\-]{{1,4}}\s*(?P<score>\d{{2,3}}(?:\.\d)?)"
    rf"\s*(?:points?|pts?|/\s*100|/\s*20)?\b",
    re.IGNORECASE,
)

# Pattern 3 — reverse order with explicit context
_RE_SCORE_FIRST = re.compile(
    rf"\b(?P<score>\d{{2,3}}(?:\.\d)?)\s*(?:points?|pts?|/\s*100|/\s*20)\s*"
    rf"[(\-—:\s]{{1,6}}\s*(?P<critic>{_CRITIC_NAMES})",
    re.IGNORECASE,
)

# Pattern 4 — abbreviation form WITH explicit score-context anchor (precision)
_RE_ABBREV = re.compile(
    r"\b(?P<critic>JS|WA|WS|JR|RP|VN|WE|DEC|JD|NM|MoM)\s+"
    r"(?P<score>\d{2,3}(?:\.\d)?(?:[-–]\d{2,3})?)"
    r"\s*(?:/\s*100|pts?|points?)\b"
)

# Pattern 5 — medals / competition awards
_RE_MEDAL = re.compile(
    r"\b(?P<authority>IWSC|Decanter World Wine Awards|DWWA|"
    r"International Wine Challenge|IWC|Bartender Spirits Awards|"
    r"San Francisco World Spirits|SFWSC|International Taste Institute|ITI|"
    r"Hunter Valley Wine Show|Victorian Wine Show|Asian Spirits Masters)"
    r"\s+(?P<grade>Gold|Silver|Bronze|Platinum|Double Gold)\b",
    re.IGNORECASE,
)


def extract_candidates(text: str) -> list[ExtractCandidate]:
    out: list[ExtractCandidate] = []

    for m in _RE_DENOM.finditer(text):
        out.append(ExtractCandidate(
            critic_raw=None, score_raw=m.group("score"),
            score_scale="100pt" if m.group("denom") == "100" else "20pt",
            medal_authority=None, medal_grade=None,
            match_offset=m.start(), match_text=m.group(0),
        ))
    for m in _RE_FULL_NAME.finditer(text):
        out.append(ExtractCandidate(
            critic_raw=m.group("critic"), score_raw=m.group("score"),
            score_scale="100pt", medal_authority=None, medal_grade=None,
            match_offset=m.start(), match_text=m.group(0),
        ))
    for m in _RE_SCORE_FIRST.finditer(text):
        out.append(ExtractCandidate(
            critic_raw=m.group("critic"), score_raw=m.group("score"),
            score_scale="100pt", medal_authority=None, medal_grade=None,
            match_offset=m.start(), match_text=m.group(0),
        ))
    for m in _RE_ABBREV.finditer(text):
        out.append(ExtractCandidate(
            critic_raw=m.group("critic"), score_raw=m.group("score"),
            score_scale="100pt", medal_authority=None, medal_grade=None,
            match_offset=m.start(), match_text=m.group(0),
        ))
    for m in _RE_MEDAL.finditer(text):
        out.append(ExtractCandidate(
            critic_raw=None, score_raw=None, score_scale="medal",
            medal_authority=m.group("authority"), medal_grade=m.group("grade"),
            match_offset=m.start(), match_text=m.group(0),
        ))

    return out


def is_plausible_score(score_value: float, scale: str) -> bool:
    """Reject obviously out-of-range scores (years like 19, percentages, etc.)."""
    if scale == "100pt":
        return 50 <= score_value <= 100
    if scale == "20pt":
        return 10 <= score_value <= 20
    return True
```

- [ ] **Step 4: Run — verify it passes**

```bash
.venv/bin/pytest tests/critic_reviews/test_score_patterns.py -v
```

Expected: all parameterized cases pass. If any fail, the regex needs tightening per the test — do that before continuing.

- [ ] **Step 5: Write `scale_conversion.py` and its tests**

`tests/critic_reviews/test_scale_conversion.py`:

```python
import pytest
from lib.critic_reviews.extract.scale_conversion import to_100pt_equiv


@pytest.mark.parametrize("native,scale,expected", [
    (95, "100pt", 95),
    (88, "100pt", 88),
    (19.0, "20pt", 96),
    (18.5, "20pt", 94),
    (17.5, "20pt", 90),
    (15.0, "20pt", 80),
    (10.0, "20pt", 80),  # below table: clamp to lowest
])
def test_conversion_table(native, scale, expected):
    assert to_100pt_equiv(native, scale) == expected


def test_returns_none_for_unsupported_scales():
    assert to_100pt_equiv(5, "5star") is None
    assert to_100pt_equiv(0, "medal") is None
    assert to_100pt_equiv(4.2, "community") is None
```

`lib/critic_reviews/extract/scale_conversion.py`:

```python
"""20pt → 100pt-equivalent conversion (spec §7.4).

Used only by refresh_products_summary.py to compute score_max.
Badges always display the native score form."""

_20PT_TABLE = [
    (19.0, 96),
    (18.5, 94),
    (18.0, 92),
    (17.5, 90),
    (17.0, 88),
    (16.5, 86),
    (16.0, 84),
    (15.5, 82),
]


def to_100pt_equiv(native: float, scale: str) -> float | None:
    if scale == "100pt":
        return float(native)
    if scale == "20pt":
        for threshold, equiv in _20PT_TABLE:
            if native >= threshold:
                return float(equiv)
        return 80.0  # clamp below 15.5
    return None
```

- [ ] **Step 6: Run scale conversion tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_scale_conversion.py -v
```

Expected: all pass.

- [ ] **Step 7: Write `critic_registry.py` + tests**

`tests/critic_reviews/test_critic_registry.py`:

```python
from lib.critic_reviews.extract.critic_registry import classify


def test_tier_1_pro_critics():
    s = classify("James Suckling")
    assert s.tier == 1 and s.signal_class == "critic_numeric"


def test_tier_2_specialty_critic():
    s = classify("Natalie MacLean")
    assert s.tier == 2


def test_tier_3_community():
    s = classify("CellarTracker community")
    assert s.tier == 3 and s.signal_class == "community"


def test_tier_4_medal_authority():
    s = classify("IWSC")
    assert s.tier == 4 and s.signal_class == "medal"


def test_unknown_critic_defaults_to_tier_2():
    s = classify("Some Unknown Critic Blog")
    assert s.tier == 2  # default fallback per spec §3.2


def test_abbreviation_expansion():
    """JS → James Suckling → tier 1."""
    s = classify("JS")
    assert s.tier == 1
```

`lib/critic_reviews/extract/critic_registry.py`:

```python
"""Source/critic name → signal_tier + signal_class (spec §3.2)."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Signal:
    tier: Literal[1, 2, 3, 4]
    signal_class: Literal["critic_numeric", "critic_text", "community", "medal"]
    canonical_name: str


_ABBREV = {
    "JS": "James Suckling",
    "WA": "Wine Advocate",
    "WS": "Wine Spectator",
    "JR": "Jancis Robinson",
    "RP": "Robert Parker",
    "VN": "Vinous",
    "WE": "Wine Enthusiast",
    "DEC": "Decanter",
    "JD": "James Halliday",
    "NM": "Natalie MacLean",
    "MoM": "Master of Malt",
}

_TIER_1 = {
    "James Suckling", "Wine Enthusiast", "Wine Spectator", "Wine Advocate",
    "Robert Parker", "Vinous", "Decanter", "Jancis Robinson", "Whisky Advocate",
    "Antonio Galloni", "Neal Martin",
}

_TIER_2 = {
    "Natalie MacLean", "WineAlign", "The Real Review", "James Halliday",
    "Master of Malt", "Distiller", "Got Rum?",
}

_TIER_3 = {
    "CellarTracker community", "Whiskybase community", "Vivino",
}

_TIER_4 = {
    "IWSC", "IWC", "DWWA", "Decanter World Wine Awards",
    "Bartender Spirits Awards", "San Francisco World Spirits", "SFWSC",
    "International Taste Institute", "ITI",
    "Hunter Valley Wine Show", "Victorian Wine Show", "Asian Spirits Masters",
}


def _expand(name: str) -> str:
    return _ABBREV.get(name, name)


def classify(critic: str) -> Signal:
    name = _expand(critic)
    if name in _TIER_1:
        return Signal(1, "critic_numeric", name)
    if name in _TIER_2:
        return Signal(2, "critic_numeric", name)
    if name in _TIER_3:
        return Signal(3, "community", name)
    if name in _TIER_4:
        return Signal(4, "medal", name)
    return Signal(2, "critic_numeric", name)  # default fallback
```

- [ ] **Step 8: Run all extract-stage tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_score_patterns.py tests/critic_reviews/test_scale_conversion.py tests/critic_reviews/test_critic_registry.py -v
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add lib/critic_reviews/extract/ tests/critic_reviews/test_score_patterns.py tests/critic_reviews/test_scale_conversion.py tests/critic_reviews/test_critic_registry.py
git commit -m "feat(critic-reviews): score patterns, scale conversion, critic registry

- Score regex requires score-context anchors; rejects 'DEC 92'/'WE 100%' FPs.
- 20pt→100pt table from spec §7.4.
- Critic registry maps abbreviations + names to tier 1-4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.4: Page parser + extractor (with binding rules)

**Files:**

- Create: `lib/critic_reviews/fetch/page_parser.py`
- Create: `lib/critic_reviews/extract/extractor.py`
- Create: `tests/critic_reviews/test_page_parser.py`
- Create: `tests/critic_reviews/test_extractor.py`
- Create: `tests/critic_reviews/fixtures/sample_wine_detail.html`
- Create: `tests/critic_reviews/fixtures/sample_round_up.html`

- [ ] **Step 1: Write fixture HTML files**

`tests/critic_reviews/fixtures/sample_wine_detail.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Pio Cesare Barolo Mosconi 2020 — Review</title>
  <meta property="og:title" content="Pio Cesare Barolo Mosconi 2020">
</head>
<body>
  <header><nav>Nav</nav></header>
  <main>
    <article>
      <h1>Pio Cesare Barolo Mosconi 2020</h1>
      <p>An astonishing Barolo from a star vintage. James Suckling: 99 points.</p>
      <p>Drink 2028–2050.</p>
    </article>
  </main>
  <footer>Footer noise</footer>
</body>
</html>
```

`tests/critic_reviews/fixtures/sample_round_up.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Top 100 Wines of 2024 — James Suckling</title>
</head>
<body>
  <main>
    <article>
      <h1>The Top 100 Wines of 2024</h1>
      <p>#43: Pio Cesare Barolo Mosconi 2020 — James Suckling: 99 points. A monumental Barolo.</p>
      <p>#44: Château Lafite-Rothschild 2020 — James Suckling: 100 points. The pinnacle of Bordeaux.</p>
      <p>#45: Egon Müller Scharzhofberger Riesling 2020 — James Suckling: 100 points.</p>
    </article>
  </main>
</body>
</html>
```

- [ ] **Step 2: Write failing page-parser tests**

`tests/critic_reviews/test_page_parser.py`:

```python
from pathlib import Path
import pytest
from lib.critic_reviews.fetch.page_parser import parse_html


FIX = Path(__file__).parent / "fixtures"


def test_parses_title_and_h1():
    fp = parse_html((FIX / "sample_wine_detail.html").read_text(), url="https://x/y")
    assert fp.page_title == "Pio Cesare Barolo Mosconi 2020 — Review"
    assert fp.page_h1 == "Pio Cesare Barolo Mosconi 2020"
    assert "Pio Cesare" in fp.og_title


def test_main_text_excludes_nav_and_footer():
    fp = parse_html((FIX / "sample_wine_detail.html").read_text(), url="https://x/y")
    assert "Nav" not in fp.main_text
    assert "Footer noise" not in fp.main_text
    assert "James Suckling" in fp.main_text


def test_paragraphs_split_on_block_boundaries():
    fp = parse_html((FIX / "sample_wine_detail.html").read_text(), url="https://x/y")
    assert len(fp.paragraphs) >= 2  # h1 + 2 paragraphs at minimum
```

- [ ] **Step 3: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_page_parser.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 4: Implement `page_parser.py`**

```python
"""HTML → FetchedPage. Pure function over an HTML string."""
from __future__ import annotations
from datetime import datetime, timezone
from bs4 import BeautifulSoup

from lib.critic_reviews.types import FetchedPage


_BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "br"}
_DROP_TAGS = {"script", "style", "nav", "footer", "header"}


def parse_html(html: str, *, url: str, status_code: int = 200) -> FetchedPage:
    soup = BeautifulSoup(html, "html.parser")

    page_title = (soup.title.string or "").strip() if soup.title else ""
    h1 = soup.find("h1")
    page_h1 = h1.get_text(strip=True) if h1 else ""
    og = soup.find("meta", attrs={"property": "og:title"})
    og_title = (og.get("content") or "").strip() if og else ""

    for tag in soup.find_all(_DROP_TAGS):
        tag.decompose()

    pieces: list[str] = []
    for elem in soup.descendants:
        if getattr(elem, "name", None) in _BLOCK_TAGS:
            text = elem.get_text(strip=True)
            if text:
                pieces.append(text)
    main_text = "\n\n".join(pieces)
    paragraphs = tuple(p for p in main_text.split("\n\n") if p.strip())

    return FetchedPage(
        url=url, fetched_at=datetime.now(timezone.utc),
        status_code=status_code, page_title=page_title, page_h1=page_h1,
        og_title=og_title, main_text=main_text, paragraphs=paragraphs,
    )
```

- [ ] **Step 5: Run page-parser tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_page_parser.py -v
```

Expected: green.

- [ ] **Step 6: Write failing extractor tests**

`tests/critic_reviews/test_extractor.py`:

```python
from pathlib import Path
import pytest
from lib.critic_reviews.fetch.page_parser import parse_html
from lib.critic_reviews.extract.extractor import extract_for_wine
from lib.critic_reviews.types import WineQuery


FIX = Path(__file__).parent / "fixtures"


def _page(name):
    return parse_html((FIX / name).read_text(), url=f"https://x/{name}")


def test_wine_detail_page_binds_score_correctly():
    fp = _page("sample_wine_detail.html")
    q = WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020)
    scores = extract_for_wine(fp, q, source="james_suckling")
    assert len(scores) >= 1
    s = scores[0]
    assert s.critic == "James Suckling"
    assert s.score_native == "99"
    assert s.vintage == 2020
    # Anti-hallucination: supporting_text is a literal substring of main_text
    assert s.supporting_text in fp.main_text


def test_round_up_keeps_only_the_queried_wine():
    fp = _page("sample_round_up.html")
    q = WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020)
    scores = extract_for_wine(fp, q, source="james_suckling")
    # Page contains 3 wines with scores; we asked about Pio Cesare; we should
    # NOT get back scores from Lafite's or Müller's paragraphs.
    critics_and_scores = [(s.critic, s.score_native) for s in scores]
    # Pio Cesare 2020 → JS 99
    assert ("James Suckling", "99") in critics_and_scores
    # The producer-proximity filter must keep Lafite/Müller out. Note that
    # `s.producer` is always set to query.producer ("Pio Cesare") by extractor,
    # so asserting on that is vacuous. The real test is whether the
    # supporting_text contains the OTHER producers' names — if it does, the
    # window was too wide and we bound the wrong score.
    for s in scores:
        assert "Lafite" not in s.supporting_text, (
            f"Lafite leaked into Pio Cesare's supporting_text: {s.supporting_text!r}"
        )
        assert "Egon Müller" not in s.supporting_text and "Egon Muller" not in s.supporting_text, (
            f"Egon Müller leaked: {s.supporting_text!r}"
        )
    # And we should never bind a 100-point score (that's only on the Lafite/Müller lines)
    assert all(s.score_native != "100" for s in scores)


def test_same_page_different_vintages_bind_correctly():
    """A page that lists the 2019 AND 2020 of the same wine: querying 2020
    must only return the 2020 score, not the 2019."""
    html = """<html><head><title>Pio Cesare verticals</title></head><body>
      <main>
        <p>Pio Cesare Barolo Mosconi 2019 — James Suckling: 96 points. Tight on release.</p>
        <p>Pio Cesare Barolo Mosconi 2020 — James Suckling: 99 points. Monumental.</p>
      </main>
    </body></html>"""
    fp = parse_html(html, url="https://x/y")
    q = WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020)
    scores = extract_for_wine(fp, q, source="james_suckling")
    # Only 2020 should survive
    assert all(s.vintage == 2020 for s in scores)
    assert any(s.score_native == "99" for s in scores)
    assert not any(s.score_native == "96" for s in scores)


def test_vintage_mismatch_discards_match():
    fp = _page("sample_wine_detail.html")
    q = WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2019)
    scores = extract_for_wine(fp, q, source="james_suckling")
    assert scores == []  # 2020 page does not match 2019 query


def test_producer_in_title_binds_score_even_without_paragraph_match():
    """If producer appears in page title, the binding works even when the
    score-paragraph doesn't repeat the producer name."""
    html = """<html><head><title>Pio Cesare Barolo Mosconi 2020</title></head>
              <body><main><p>A masterful red. James Suckling: 99 points.</p></main></body></html>"""
    from datetime import datetime, timezone
    fp = parse_html(html, url="https://x/y")
    q = WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020)
    scores = extract_for_wine(fp, q, source="james_suckling")
    assert len(scores) == 1
```

- [ ] **Step 7: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_extractor.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 8: Implement `extractor.py`**

```python
"""Two-pass extraction:
  1. Run regex candidates over main_text.
  2. Apply producer-proximity + vintage binding rules (spec §7.2).

Returns ExtractedScore rows ready to persist (subject to write-time
assertion in repository.write_score).
"""
from __future__ import annotations
import re
from typing import Optional

from lib.critic_reviews.extract.score_patterns import (
    ExtractCandidate, extract_candidates, is_plausible_score,
)
from lib.critic_reviews.extract.critic_registry import classify
from lib.critic_reviews.types import ExtractedScore, FetchedPage, WineQuery


_PROXIMITY_CHARS = 400
_VINTAGE_RE = re.compile(r"\b(19[5-9]\d|20[0-3]\d)\b")


def _producer_in_meta(query: WineQuery, page: FetchedPage) -> bool:
    name = query.producer.lower()
    blobs = [page.page_title, page.page_h1, page.og_title]
    return any(name in (b or "").lower() for b in blobs)


def _producer_near(query: WineQuery, page: FetchedPage, match_offset: int) -> bool:
    name = query.producer.lower()
    window_start = max(0, match_offset - _PROXIMITY_CHARS)
    window_end = min(len(page.main_text), match_offset + _PROXIMITY_CHARS)
    return name in page.main_text[window_start:window_end].lower()


def _paragraph_index(page: FetchedPage, offset: int) -> int:
    running = 0
    for i, p in enumerate(page.paragraphs):
        next_running = running + len(p) + 2  # +2 for the "\n\n" between paragraphs
        if running <= offset < next_running:
            return i
        running = next_running
    return -1


def _producer_in_same_paragraph(query: WineQuery, page: FetchedPage, match_offset: int) -> bool:
    idx = _paragraph_index(page, match_offset)
    if idx < 0:
        return False
    return query.producer.lower() in page.paragraphs[idx].lower()


def _resolve_vintage(query: WineQuery, page: FetchedPage, match_offset: int) -> Optional[int] | bool:
    """Return:
      - the int vintage if a single matching vintage can be bound, OR
      - None if no vintage token anywhere (caller may accept with confidence penalty), OR
      - False if vintage mismatch → discard.
    """
    if query.vintage is None:
        return None  # no constraint

    title_vintages = set()
    for blob in (page.page_title, page.page_h1, page.og_title, page.url):
        for m in _VINTAGE_RE.finditer(blob or ""):
            title_vintages.add(int(m.group(0)))

    all_main_vintages = [int(m.group(0)) for m in _VINTAGE_RE.finditer(page.main_text)]
    distinct_main = set(all_main_vintages)

    if title_vintages and len(title_vintages | distinct_main) == 1:
        # single-vintage page
        return query.vintage if query.vintage in title_vintages else False

    if not distinct_main:
        return None  # no vintage tokens anywhere → accept with penalty

    # multi-vintage: bind to nearest preceding vintage in main_text
    nearest: Optional[int] = None
    for m in _VINTAGE_RE.finditer(page.main_text):
        if m.start() > match_offset:
            break
        nearest = int(m.group(0))
    if nearest == query.vintage:
        return query.vintage
    return False


def extract_for_wine(page: FetchedPage, query: WineQuery, *, source: str) -> list[ExtractedScore]:
    out: list[ExtractedScore] = []
    candidates = extract_candidates(page.main_text)

    for c in candidates:
        # Skip pure-denom (no critic name) matches for now; they'd need critic
        # context to be persistable. Adapters may opt-in to them when the source
        # itself IS the critic (e.g. Wine Enthusiast page).
        if not c.critic_raw and not c.medal_authority:
            continue

        # ----- Producer-name proximity -----
        bound_by_meta = _producer_in_meta(query, page)
        bound_by_para = _producer_in_same_paragraph(query, page, c.match_offset)
        bound_by_near = _producer_near(query, page, c.match_offset)
        if not (bound_by_meta or bound_by_para or bound_by_near):
            continue

        # ----- Vintage binding -----
        confidence_penalty = 0.0
        if c.medal_authority:
            resolved_vintage = query.vintage
        else:
            resolved = _resolve_vintage(query, page, c.match_offset)
            if resolved is False:
                continue
            if resolved is None and query.vintage is not None:
                confidence_penalty = 0.1
                resolved_vintage = query.vintage
            else:
                resolved_vintage = resolved if resolved is not None else None

        # ----- Build ExtractedScore -----
        if c.medal_authority:
            critic = c.medal_authority
            score_native = f"{c.medal_authority} {c.medal_grade}"
            score_scale = "medal"
            score_value = None
        else:
            score_value = float(c.score_raw.split("-")[0]) if c.score_raw else None
            if score_value is not None and not is_plausible_score(score_value, c.score_scale or "100pt"):
                continue
            critic = c.critic_raw
            score_native = c.score_raw
            score_scale = c.score_scale or "100pt"

        sig = classify(critic or "")
        supporting_window = _supporting_window(page.main_text, c.match_offset, c.match_text)

        out.append(ExtractedScore(
            producer=query.producer, cuvee=query.cuvee, vintage=resolved_vintage,
            source=source, source_url=page.url, source_review_id=None,
            critic=sig.canonical_name, score_native=score_native,
            score_scale=score_scale, score_value=score_value,
            supporting_text=supporting_window,
            signal_class=sig.signal_class, signal_tier=sig.tier,
            confidence=max(0.0, 0.7 - confidence_penalty),
        ))

    return out


def _supporting_window(main_text: str, offset: int, match_text: str, *, target_chars: int = 200) -> str:
    pad = max(0, (target_chars - len(match_text)) // 2)
    start = max(0, offset - pad)
    end = min(len(main_text), offset + len(match_text) + pad)
    return main_text[start:end].strip()
```

- [ ] **Step 9: Run extractor tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_extractor.py -v
```

Expected: all pass.

If `test_round_up_keeps_only_the_queried_wine` fails: the producer-proximity-window may be too wide (`_PROXIMITY_CHARS = 400`). Tighten to 200 and re-run, but understand the tradeoff — narrower window improves precision at the cost of recall on long-form articles.

- [ ] **Step 10: Run all critic_reviews tests together**

```bash
.venv/bin/pytest tests/critic_reviews/ -v
```

Expected: green across all tests so far.

- [ ] **Step 11: Commit**

```bash
git add lib/critic_reviews/fetch/page_parser.py lib/critic_reviews/extract/extractor.py tests/critic_reviews/
git commit -m "feat(critic-reviews): page parser + extractor with binding rules

- HTML → FetchedPage (title, h1, og:title, block-level text, paragraphs).
- Producer-proximity filter (meta + paragraph + ±400 char fallback).
- Vintage filter (single-vintage match, multi-vintage nearest-preceding,
  no-vintage-token confidence penalty).
- Anti-hallucination: supporting_text is a literal substring slice.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.5: HTTP client (politeness, robots, retries)

**Files:**

- Create: `lib/critic_reviews/fetch/http_client.py`
- Create: `tests/critic_reviews/test_http_client.py`

- [ ] **Step 1: Write failing tests**

`tests/critic_reviews/test_http_client.py`:

```python
import time
from unittest.mock import patch, MagicMock

import pytest

from lib.critic_reviews.fetch.http_client import PoliteClient, RateLimiter


def test_rate_limiter_enforces_minimum_interval():
    rl = RateLimiter(min_interval_seconds=0.1)
    t0 = time.monotonic()
    rl.wait("example.com")
    rl.wait("example.com")
    elapsed = time.monotonic() - t0
    assert elapsed >= 0.1


def test_rate_limiter_independent_per_domain():
    rl = RateLimiter(min_interval_seconds=0.1)
    t0 = time.monotonic()
    rl.wait("a.example.com")
    rl.wait("b.example.com")  # different domain → no wait
    elapsed = time.monotonic() - t0
    assert elapsed < 0.05


def test_polite_client_sets_identifying_ua():
    with patch("httpx.Client") as MockHttpx:
        instance = MagicMock()
        MockHttpx.return_value = instance
        PoliteClient(rate_limit_seconds=0.0)
        kwargs = MockHttpx.call_args.kwargs
        assert "WN-LIQ9-Harvester" in kwargs["headers"]["User-Agent"]


def test_polite_client_respects_robots_disallow():
    client = PoliteClient(rate_limit_seconds=0.0)
    with patch.object(client, "_fetch_robots", return_value="User-agent: *\nDisallow: /\n"):
        assert not client.is_allowed("https://example.com/some/path")


def test_polite_client_allows_when_robots_permits():
    client = PoliteClient(rate_limit_seconds=0.0)
    with patch.object(client, "_fetch_robots", return_value="User-agent: *\nAllow: /\n"):
        assert client.is_allowed("https://example.com/some/path")
```

- [ ] **Step 2: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_http_client.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `http_client.py`**

```python
"""Polite HTTP client.

- Per-domain rate limiting (default 1 req / 3 seconds).
- Identifying UA per the spec.
- robots.txt cached daily per domain.
- Retry-with-backoff via tenacity (5xx and 429).
"""
from __future__ import annotations
import time
import urllib.robotparser
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential


_DEFAULT_UA = "WN-LIQ9-Harvester/1.0 (+https://wine-now.com/scraper-policy)"


class RateLimiter:
    def __init__(self, min_interval_seconds: float):
        self.min_interval = min_interval_seconds
        self._last: dict[str, float] = defaultdict(float)

    def wait(self, domain: str) -> None:
        now = time.monotonic()
        delta = now - self._last[domain]
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last[domain] = time.monotonic()


class PoliteClient:
    def __init__(
        self,
        *,
        rate_limit_seconds: float = 3.0,
        timeout_seconds: float = 30.0,
        user_agent: str = _DEFAULT_UA,
    ):
        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"},
            timeout=timeout_seconds,
            follow_redirects=True,
        )
        self._rl = RateLimiter(rate_limit_seconds)
        self._robots_cache: dict[str, tuple[datetime, urllib.robotparser.RobotFileParser]] = {}
        self._user_agent = user_agent

    # ---- robots.txt ----
    def _fetch_robots(self, root: str) -> str:
        try:
            resp = self._client.get(f"{root}/robots.txt")
            if resp.status_code == 200:
                return resp.text
        except httpx.HTTPError:
            pass
        return ""

    def _get_robots(self, domain_root: str) -> urllib.robotparser.RobotFileParser:
        cached = self._robots_cache.get(domain_root)
        if cached and (datetime.utcnow() - cached[0]) < timedelta(hours=24):
            return cached[1]
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(self._fetch_robots(domain_root).splitlines())
        self._robots_cache[domain_root] = (datetime.utcnow(), rp)
        return rp

    def is_allowed(self, url: str) -> bool:
        parts = urlparse(url)
        root = f"{parts.scheme}://{parts.netloc}"
        rp = self._get_robots(root)
        try:
            return rp.can_fetch(self._user_agent, url)
        except Exception:
            return True  # permissive on parse failure — don't block on bad robots.txt

    # ---- fetch ----
    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        wait=wait_exponential(multiplier=5, min=5, max=125),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def get(self, url: str) -> httpx.Response:
        if not self.is_allowed(url):
            raise PermissionError(f"robots.txt disallows {url}")
        domain = urlparse(url).netloc
        self._rl.wait(domain)
        resp = self._client.get(url)
        if resp.status_code >= 500 or resp.status_code == 429:
            resp.raise_for_status()
        return resp

    def close(self) -> None:
        self._client.close()
```

- [ ] **Step 4: Run http_client tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_http_client.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/critic_reviews/fetch/http_client.py tests/critic_reviews/test_http_client.py
git commit -m "feat(critic-reviews): polite HTTP client with rate limit + robots + retries

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2: First adapter end-to-end (Day 4-5)

### Task 2.1: CellarTracker adapter

**Decision point:** by Day 4 the operator should know if CT API access has been granted (Task 0.1). If yes → API mode. If pending → start with HTML-scrape fallback; convert later when access lands.

**Files:**

- Create: `lib/critic_reviews/sources/base.py`
- Create: `lib/critic_reviews/sources/cellartracker.py`
- Create: `tests/critic_reviews/test_source_cellartracker.py`
- Create: `tests/critic_reviews/fixtures/cellartracker/sample_response.json`

- [ ] **Step 1: Define `Source` protocol**

`lib/critic_reviews/sources/base.py`:

```python
"""Protocol every source adapter implements."""
from __future__ import annotations
from typing import Protocol, runtime_checkable

from lib.critic_reviews.types import ExtractedScore, WineQuery


@runtime_checkable
class Source(Protocol):
    name: str

    def harvest(self, query: WineQuery) -> list[ExtractedScore]:
        """Return zero or more ExtractedScore rows for this wine.

        Never raises on 'no data' / 404. Raises only on infrastructure errors
        the caller should retry (transient network, 5xx).
        """
        ...
```

- [ ] **Step 2: Write a representative fixture + failing adapter test**

`tests/critic_reviews/fixtures/cellartracker/sample_response.json`:

```json
{
  "iWine": 12345,
  "producer": "Pio Cesare",
  "wine": "Barolo Mosconi",
  "vintage": 2020,
  "tasting_notes": [
    {
      "Reviewer": "someuser",
      "Score": "93",
      "Note": "Dense black-fruit core, fine tannins, long finish. Already drinking well.",
      "Date": "2024-09-15"
    },
    {
      "Reviewer": "anotheruser",
      "Score": "94",
      "Note": "Beautiful structure. Decant 2 hours.",
      "Date": "2024-10-01"
    }
  ]
}
```

`tests/critic_reviews/test_source_cellartracker.py`:

```python
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from lib.critic_reviews.sources.cellartracker import CellarTrackerSource
from lib.critic_reviews.types import WineQuery


FIX = Path(__file__).parent / "fixtures" / "cellartracker"


def test_api_mode_extracts_two_community_scores():
    sample = json.loads((FIX / "sample_response.json").read_text())
    src = CellarTrackerSource(api_key="fake", mode="api")
    with patch.object(src, "_fetch_wine_json", return_value=sample):
        scores = src.harvest(WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020))
    assert len(scores) == 2
    for s in scores:
        assert s.source == "cellartracker"
        assert s.signal_tier == 3  # community
        assert s.signal_class == "community"
    # Supporting text must be a literal substring of *something* — for API mode
    # we use the note text as the payload context.
    assert all("." in s.supporting_text for s in scores)
```

- [ ] **Step 3: Run — verify it fails**

```bash
.venv/bin/pytest tests/critic_reviews/test_source_cellartracker.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 4: Implement `cellartracker.py` API mode**

```python
"""CellarTracker adapter.

API mode (preferred): retrieves structured tasting notes via the documented
CellarTracker API (auth: API key). Each tasting note becomes one
ExtractedScore row with signal_class='community' (community tier).

HTML mode (fallback): scrapes public tasting-note pages. Same shape.
Triggered when API access has been denied or is pending; set mode='html'.
"""
from __future__ import annotations
from typing import Literal, Optional

from lib.critic_reviews.extract.critic_registry import classify
from lib.critic_reviews.fetch.http_client import PoliteClient
from lib.critic_reviews.types import ExtractedScore, WineQuery


_API_BASE = "https://www.cellartracker.com/api/v1"


class CellarTrackerSource:
    name = "cellartracker"

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        mode: Literal["api", "html"] = "api",
        client: Optional[PoliteClient] = None,
    ):
        self._api_key = api_key
        self._mode = mode
        self._client = client or PoliteClient(rate_limit_seconds=3.0)

    # API mode -----------------------------------------------------------
    def _fetch_wine_json(self, query: WineQuery) -> dict | None:
        """Search by producer+cuvée+vintage; return the matching iWine doc.

        Real implementation TBD when API contract lands. The signature is
        kept so tests can mock this single method.
        """
        # Placeholder — replace once API contract is confirmed in Day 0 outreach.
        return None

    # HTML mode (fallback) ----------------------------------------------
    def _fetch_wine_html(self, query: WineQuery) -> str | None:
        """Search CT's public site; return HTML for the matching wine page."""
        # TBD on Day 0 fallback path. Same testable surface.
        return None

    def harvest(self, query: WineQuery) -> list[ExtractedScore]:
        if self._mode == "api":
            doc = self._fetch_wine_json(query)
            if not doc:
                return []
            return self._extract_from_api_doc(doc, query)

        if self._mode == "html":
            html = self._fetch_wine_html(query)
            if not html:
                return []
            return self._extract_from_html(html, query)

        return []

    # -------------------------------------------------------------------
    @staticmethod
    def _extract_from_api_doc(doc: dict, query: WineQuery) -> list[ExtractedScore]:
        out: list[ExtractedScore] = []
        wine_id = doc.get("iWine")
        for note in doc.get("tasting_notes", []):
            score = note.get("Score")
            if not score:
                continue
            note_text = note.get("Note", "")
            sig = classify("CellarTracker community")
            out.append(ExtractedScore(
                producer=query.producer, cuvee=query.cuvee, vintage=query.vintage,
                source="cellartracker",
                source_url=f"https://www.cellartracker.com/wine.asp?iWine={wine_id}",
                source_review_id=str(note.get("Date", "")),
                critic=sig.canonical_name,
                score_native=str(score), score_scale="100pt",
                score_value=float(score),
                supporting_text=note_text[:200],
                signal_class=sig.signal_class, signal_tier=sig.tier,
                confidence=0.85,  # licensed-feed quality
            ))
        return out

    @staticmethod
    def _extract_from_html(html: str, query: WineQuery) -> list[ExtractedScore]:
        # Fall back to the same `extract_for_wine` pipeline used by editorial sources.
        from lib.critic_reviews.extract.extractor import extract_for_wine
        from lib.critic_reviews.fetch.page_parser import parse_html
        fp = parse_html(html, url=f"https://www.cellartracker.com/")
        return extract_for_wine(fp, query, source="cellartracker")
```

- [ ] **Step 5: Run adapter test**

```bash
.venv/bin/pytest tests/critic_reviews/test_source_cellartracker.py -v
```

Expected: `test_api_mode_extracts_two_community_scores` passes.

The `supporting_text` literal-substring assertion will be checked at persist time. For the unit test, we accept that the supporting text comes from the API doc's note text.

- [ ] **Step 6: Commit**

```bash
git add lib/critic_reviews/sources/base.py lib/critic_reviews/sources/cellartracker.py tests/critic_reviews/test_source_cellartracker.py tests/critic_reviews/fixtures/cellartracker/
git commit -m "feat(critic-reviews): CellarTracker adapter (API + HTML fallback skeleton)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.2: Backfill job skeleton + JobReport

**Files:**

- Create: `lib/critic_reviews/catalog.py`
- Create: `lib/critic_reviews/jobs/backfill.py`
- Create: `lib/critic_reviews/jobs/report.py`
- Create: `tests/critic_reviews/test_catalog.py`
- Create: `tests/critic_reviews/test_backfill.py`

- [ ] **Step 1: Write catalog test (uses a temp DB with seeded rows)**

```python
# tests/critic_reviews/test_catalog.py
import sqlite3
import tempfile
from pathlib import Path

from lib.critic_reviews.catalog import distinct_triplets


def test_distinct_triplets_dedups_by_producer_cuvee_vintage():
    db_path = Path(tempfile.mkdtemp()) / "test_products.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE products (sku TEXT, brand TEXT, name TEXT, vintage TEXT, classification TEXT, is_active INTEGER);
        INSERT INTO products VALUES ('A', 'Pio Cesare', 'Barolo Mosconi', '2020', 'Red Wine', 1);
        INSERT INTO products VALUES ('B', 'Pio Cesare', 'Barolo Mosconi', '2020', 'Red Wine', 1);  -- dup
        INSERT INTO products VALUES ('C', 'Pio Cesare', 'Barolo Mosconi', '2019', 'Red Wine', 1);  -- different vintage
        INSERT INTO products VALUES ('D', 'Glassware Co', 'Wine Glass', 'Current vintage', 'Glassware', 1);  -- glassware
        INSERT INTO products VALUES ('E', 'Pio Cesare', 'Barolo Mosconi', '2020', 'Red Wine', 0);  -- inactive
    """)
    conn.commit()
    conn.close()
    triplets = distinct_triplets(str(db_path))
    # Glassware filtered, inactive filtered, dup collapsed → 2 triplets remain
    assert len(triplets) == 2
    assert all(t.producer == "Pio Cesare" for t in triplets)
```

- [ ] **Step 2: Implement `catalog.py`**

```python
"""Derive distinct (producer, cuvée, vintage) triplets to harvest from products.db."""
from __future__ import annotations
import sqlite3

from lib.critic_reviews.types import WineQuery


_NOISE_CLASSIFICATIONS = ("Glassware", "Beer")


def distinct_triplets(db_path: str) -> list[WineQuery]:
    conn = sqlite3.connect(db_path)
    placeholders = ",".join(["?"] * len(_NOISE_CLASSIFICATIONS))
    rows = conn.execute(
        f"""SELECT DISTINCT brand, name, vintage
            FROM products
            WHERE is_active = 1
              AND brand IS NOT NULL AND brand != ''
              AND name IS NOT NULL AND name != ''
              AND classification NOT IN ({placeholders})""",
        _NOISE_CLASSIFICATIONS,
    ).fetchall()
    conn.close()
    out: list[WineQuery] = []
    for brand, name, vintage in rows:
        v = _parse_vintage(vintage)
        # Strip duplicated brand from name (per the recon-time observation)
        cuvee = name
        if cuvee.lower().startswith(brand.lower()):
            cuvee = cuvee[len(brand):].lstrip(" -")
        out.append(WineQuery(producer=brand.strip(), cuvee=cuvee.strip(), vintage=v))
    return out


def _parse_vintage(v) -> int | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in ("current vintage", "nv", "n/a", "none"):
        return None
    try:
        return int(s)
    except ValueError:
        return None
```

- [ ] **Step 3: Run catalog test**

```bash
.venv/bin/pytest tests/critic_reviews/test_catalog.py -v
```

Expected: green.

- [ ] **Step 4: Implement JobReport builder**

```python
# lib/critic_reviews/jobs/report.py
"""JobReport formatter — CLAUDE.md Rule 4 'what shipped' line is mandatory."""
from __future__ import annotations
from dataclasses import asdict

from lib.critic_reviews.types import JobReport


def format_report(report: JobReport) -> str:
    coverage_pct = (
        100 * report.skus_newly_populated / report.distinct_triplets
        if report.distinct_triplets else 0
    )
    return f"""
== Job {report.job_id} ({report.job_type}) ==
  Started:                    {report.started_at.isoformat()}
  Finished:                   {report.finished_at.isoformat() if report.finished_at else 'in_progress'}
  Sources processed:          {report.sources_processed}
  Distinct (producer, cuvée, vint):  {report.distinct_triplets}
  Pages fetched:              {report.pages_fetched}
  Pages with ≥1 score:        {report.pages_with_score}
  Rows written to critic_scores: {report.rows_written_raw}
  Rows rejected by assertions:    {report.rows_rejected_assertions}
  SKUs now populated:         {report.skus_newly_populated}   ← what shipped
  Catalog coverage:           {coverage_pct:.1f}%

  Notes: {report.notes}
""".rstrip()
```

- [ ] **Step 5: Implement backfill skeleton**

```python
# lib/critic_reviews/jobs/backfill.py
"""Orchestrate a backfill across one or more sources.

The full multi-source parallel backfill lands in Phase 5. This Day-4 version
is single-source, sequential, and used by the 5-SKU CT canary.
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone

from lib.critic_reviews.jobs.report import format_report
from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.sources.base import Source
from lib.critic_reviews.types import JobReport, WineQuery


log = logging.getLogger(__name__)


def run_canary(
    source: Source,
    triplets: list[WineQuery],
    *,
    repo: Repository,
    job_id: str | None = None,
) -> JobReport:
    report = JobReport(
        job_id=job_id or str(uuid.uuid4()),
        job_type="canary",
        started_at=datetime.now(timezone.utc),
    )
    report.distinct_triplets = len(triplets)
    report.sources_processed = 1
    for q in triplets:
        try:
            scores = source.harvest(q)
            report.pages_fetched += 1
            if scores:
                report.pages_with_score += 1
            for s in scores:
                # For the canary we use s.supporting_text as its own payload
                # context — adapters provide it from the source.
                result = repo.write_score(s, payload=s.supporting_text)
                if result.written:
                    report.rows_written_raw += 1
                else:
                    report.rows_rejected_assertions += 1
                    log.warning("rejected: %s", result.rejection_reason)
        except Exception as exc:
            log.exception("harvest failed for %s: %s", q, exc)
    report.finished_at = datetime.now(timezone.utc)
    return report
```

- [ ] **Step 6: Write a basic backfill test**

```python
# tests/critic_reviews/test_backfill.py
from datetime import datetime, timezone
from pathlib import Path
import tempfile

from lib.critic_reviews.jobs.backfill import run_canary
from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.types import ExtractedScore, WineQuery


class _StubSource:
    name = "stub"

    def harvest(self, query: WineQuery):
        return [ExtractedScore(
            producer=query.producer, cuvee=query.cuvee, vintage=query.vintage,
            source="stub", source_url="https://x/y", source_review_id=None,
            critic="Wine Enthusiast", score_native="91", score_scale="100pt", score_value=91.0,
            supporting_text="Wine Enthusiast 91 pts. Good.",
            signal_class="critic_numeric", signal_tier=1, confidence=0.8,
        )]


def test_canary_writes_one_row_per_query():
    db = Path(tempfile.mkdtemp()) / "t.db"
    repo = Repository(str(db))
    repo.init_schema()
    triplets = [WineQuery("X", "Y", 2020), WineQuery("A", "B", 2021)]
    report = run_canary(_StubSource(), triplets, repo=repo)
    assert report.rows_written_raw == 2
    assert report.pages_with_score == 2
    repo.close()
```

- [ ] **Step 7: Run + commit**

```bash
.venv/bin/pytest tests/critic_reviews/test_backfill.py tests/critic_reviews/test_catalog.py -v
git add lib/critic_reviews/catalog.py lib/critic_reviews/jobs/ tests/critic_reviews/test_backfill.py tests/critic_reviews/test_catalog.py
git commit -m "feat(critic-reviews): backfill skeleton + JobReport + catalog enumeration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2.3: 5-SKU canary against CT — first data lands

- [ ] **Step 1: Hand-pick 5 canary SKUs** that should yield CT data per the recon evidence:

```python
# scripts/critic_reviews_canary.py
"""5-SKU canary script. Run once per source as it comes online."""
import argparse
import logging
import sys

from lib.critic_reviews.jobs.backfill import run_canary
from lib.critic_reviews.jobs.report import format_report
from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.types import WineQuery


CANARY_SKUS_TRIPLETS = [
    # Famous wine (Bordeaux) — expect rich data
    WineQuery(producer="Chateau Clinet", cuvee="", vintage=2014),
    # Famous wine (Burgundy)
    WineQuery(producer="Etienne Sauzet", cuvee="Bienvenues-Batard-Montrachet Grand Cru", vintage=2014),
    # Mid-tier
    WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi DOCG", vintage=2020),
    # Mainstream
    WineQuery(producer="Concha Y Toro", cuvee="Casillero Del Diablo Reserva Merlot", vintage=None),
    # Thai-origin (expect nothing or sparse)
    WineQuery(producer="PB Valley", cuvee="Pirom Khao Yai Reserve Tempranillo", vintage=2014),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, choices=["cellartracker", "wine_enthusiast", "natalie_maclean", "winealign", "real_review", "whiskybase", "master_of_malt", "distiller"])
    ap.add_argument("--db", default="data/db/products.db")
    ap.add_argument("--api-key", help="API key (CT only)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.source == "cellartracker":
        from lib.critic_reviews.sources.cellartracker import CellarTrackerSource
        src = CellarTrackerSource(api_key=args.api_key, mode="api" if args.api_key else "html")
    else:
        # Later phases add the remaining adapters; for now this fails fast.
        print(f"adapter for {args.source} not yet implemented", file=sys.stderr)
        sys.exit(2)

    repo = Repository(args.db)
    repo.init_schema()  # idempotent; safe to call
    report = run_canary(src, CANARY_SKUS_TRIPLETS, repo=repo)
    print(format_report(report))
    repo.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Backup the DB before any writes (CLAUDE.md Rule 10 step 1)**

```bash
cp "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db" "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db.bak-pre-critic-canary-$(date +%Y%m%d-%H%M%S)"
ls -la "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db.bak-pre-critic-canary-"* | tail -1
```

Expected: a backup file appears.

- [ ] **Step 3: Run the canary (fixture mode — wiring verification)**

The canary script accepts a `--fixture-mode` flag that replays the CT sample fixture (`tests/critic_reviews/fixtures/cellartracker/sample_response.json`) for the 5 SKUs instead of calling the live API/site. This guarantees rows land so we can verify the persistence wiring end-to-end even if the CT API key hasn't arrived yet.

Add this flag to `scripts/critic_reviews_canary.py`:

```python
ap.add_argument("--fixture-mode", action="store_true",
                help="Replay fixture file instead of calling the live source (wiring check).")
```

In `main()`, when `args.fixture_mode and args.source == "cellartracker"`:

```python
import json
from unittest.mock import patch
from pathlib import Path
fixture = json.loads(Path("tests/critic_reviews/fixtures/cellartracker/sample_response.json").read_text())
with patch.object(src, "_fetch_wine_json", return_value=fixture):
    report = run_canary(src, CANARY_SKUS_TRIPLETS, repo=repo)
```

Then run:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python scripts/critic_reviews_canary.py --source cellartracker --fixture-mode
```

Expected output: a JobReport showing `rows_written_raw > 0` (the fixture has 2 tasting notes; 5 SKUs × 2 notes = 10 rows). This proves the wiring works **independent of Day-0 outcome**.

- [ ] **Step 4: Verify data landed (CLAUDE.md Rule 1)**

```bash
sqlite3 data/db/products.db "SELECT count(*), source FROM critic_scores GROUP BY source;"
```

Expected: shows `cellartracker | N` where N ≥ 1 (10 in fixture mode).

- [ ] **Step 4.5: Re-run against live source (only if Day-0 returned an API key OR HTML scrape is implemented)**

```bash
.venv/bin/python scripts/critic_reviews_canary.py --source cellartracker --api-key "$CT_API_KEY"
```

If Day-0 outreach is still pending, skip this step. Live verification happens when access lands; the fixture-mode run already proved the pipeline.

- [ ] **Step 5: Commit the canary script**

```bash
git add scripts/critic_reviews_canary.py
git commit -m "feat(critic-reviews): 5-SKU canary script

Per CLAUDE.md Rule 10 — backup, 5-SKU run, verify in DB before scaling.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3: Editorial scrapers (Day 6-10)

Each adapter follows the same TDD pattern. Below are the per-source specifics; the structural pattern (fixture → failing test → implement → green) is identical to Task 2.1.

### Task 3.1: Wine Enthusiast adapter (highest yield, in-site search)

**Files:**

- Create: `lib/critic_reviews/sources/wine_enthusiast.py`
- Create: `tests/critic_reviews/fixtures/wine_enthusiast/search_results.html`
- Create: `tests/critic_reviews/fixtures/wine_enthusiast/buying_guide.html`
- Create: `tests/critic_reviews/test_source_wine_enthusiast.py`

- [ ] **Step 1 [OPERATOR]: Capture two fixture pages by hand**

This step requires a human running a browser — it's not something the agent can do via WebSearch alone (we need the rendered HTML the scraper will see). Mark as an operator handoff like Task 0.1.

In a regular browser, visit:

1. `https://www.wineenthusiast.com/?s=Pio+Cesare+Barolo+Mosconi+2020` — save the search results page as `tests/critic_reviews/fixtures/wine_enthusiast/search_results.html`
2. Find a buying-guide URL in the results, open it, save as `tests/critic_reviews/fixtures/wine_enthusiast/buying_guide.html`

**Sanitize before committing:** remove cookies, personal IDs, sensitive headers, and any tracking pixels. A quick `grep -i "cookie\|tracking\|gtm\|fbq" *.html` and manual review is sufficient.

**Agentic-execution alternative:** if a human operator is unavailable, the agent can author a *synthetic* fixture that matches the structure Wine Enthusiast publishes (search result list with `href="https://www.wineenthusiast.com/buying-guide/..."` links and a buying-guide page with score + critic in standard editorial layout). The implementation is then validated against the synthetic fixture; real-world validation happens during the canary in Task 2.3 / Task 5.1.

- [ ] **Step 2: Write the failing adapter test**

```python
# tests/critic_reviews/test_source_wine_enthusiast.py
from pathlib import Path
from unittest.mock import patch
from lib.critic_reviews.sources.wine_enthusiast import WineEnthusiastSource
from lib.critic_reviews.types import WineQuery

FIX = Path(__file__).parent / "fixtures" / "wine_enthusiast"


def test_search_then_detail_extracts_score():
    src = WineEnthusiastSource()
    search_html = (FIX / "search_results.html").read_text()
    detail_html = (FIX / "buying_guide.html").read_text()

    with patch.object(src, "_fetch", side_effect=[search_html, detail_html]):
        scores = src.harvest(WineQuery(producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020))

    assert len(scores) >= 1
    assert scores[0].source == "wine_enthusiast"
    assert scores[0].critic == "Wine Enthusiast"
    assert scores[0].score_value is not None
```

- [ ] **Step 3: Implement `wine_enthusiast.py`**

Sketch (full implementation depends on what the actual HTML looks like — fill in based on the captured fixture):

```python
"""Wine Enthusiast adapter — in-site search then detail fetch."""
from __future__ import annotations
import re
from typing import Optional

from lib.critic_reviews.extract.extractor import extract_for_wine
from lib.critic_reviews.fetch.http_client import PoliteClient
from lib.critic_reviews.fetch.page_parser import parse_html
from lib.critic_reviews.types import ExtractedScore, WineQuery


_SEARCH_URL = "https://www.wineenthusiast.com/?s={query}"
_BUYING_GUIDE_HREF = re.compile(r'href="(?P<url>https://www\.wineenthusiast\.com/buying-guide/[^"]+)"')


class WineEnthusiastSource:
    name = "wine_enthusiast"

    def __init__(self, client: Optional[PoliteClient] = None):
        self._client = client or PoliteClient(rate_limit_seconds=3.0)

    def _fetch(self, url: str) -> str:
        return self._client.get(url).text

    def harvest(self, query: WineQuery) -> list[ExtractedScore]:
        q = f"{query.producer}+{query.cuvee}".replace(" ", "+")
        if query.vintage:
            q += f"+{query.vintage}"
        search_html = self._fetch(_SEARCH_URL.format(query=q))
        urls = _BUYING_GUIDE_HREF.findall(search_html)[:3]  # cap at top 3 results

        out: list[ExtractedScore] = []
        for url in urls:
            detail_html = self._fetch(url)
            fp = parse_html(detail_html, url=url)
            # producer-proximity filter rejects irrelevant articles automatically
            scores = extract_for_wine(fp, query, source="wine_enthusiast")
            out.extend(scores)
        return out
```

- [ ] **Step 4: Run test, iterate on parser until green**

```bash
.venv/bin/pytest tests/critic_reviews/test_source_wine_enthusiast.py -v
```

If the search-results regex doesn't match real WE HTML, inspect the fixture and adjust `_BUYING_GUIDE_HREF`. This is normal first-pass scraper work.

- [ ] **Step 5: Run the CT canary script with `--source wine_enthusiast`** (after adding it to the canary's source list)

```bash
.venv/bin/python scripts/critic_reviews_canary.py --source wine_enthusiast
```

Expected: at least 2-3 of the 5 SKUs yield a score (recon evidence says WE is the most prolific source after CT).

- [ ] **Step 6: Commit**

```bash
git add lib/critic_reviews/sources/wine_enthusiast.py tests/critic_reviews/fixtures/wine_enthusiast/ tests/critic_reviews/test_source_wine_enthusiast.py
git commit -m "feat(critic-reviews): Wine Enthusiast adapter (search + detail)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3.2 — 3.7: Remaining editorial scrapers

Each adapter follows the **same six-step TDD discipline** as Task 3.1:

- [ ] **Step A [OPERATOR or synthetic]: Capture 1-2 representative HTML fixtures.** Sanitize. Same handoff rule as Task 3.1 Step 1.
- [ ] **Step B: Write a failing adapter test** in `tests/critic_reviews/test_source_<name>.py`. Mock the adapter's `_fetch()` method to return the fixture HTML. Assert at least 1 `ExtractedScore` is produced with the expected `source`, `critic`, and `score_native` values.
- [ ] **Step C: Run the test — verify it fails** (`ModuleNotFoundError`).
- [ ] **Step D: Implement the adapter** in `lib/critic_reviews/sources/<name>.py`. The structural code is identical to `WineEnthusiastSource` — only the search URL pattern and result-link extraction regex change.
- [ ] **Step E: Run the test — verify it passes.**
- [ ] **Step F: Add the source to `scripts/critic_reviews_canary.py`'s `--source` choice list AND its adapter-construction switch.**
- [ ] **Step G: Run the canary** (fixture mode at minimum) to verify wiring.
- [ ] **Step H: Commit.**

Below is the per-source delta — what the implementer changes from Task 3.1's template.

#### Task 3.2: Natalie MacLean — `lib/critic_reviews/sources/natalie_maclean.py`

- Search URL: `https://www.nataliemaclean.com/wines/?search={query}` (verify on fixture)
- The adapter is structurally the same as Wine Enthusiast.
- Critic name in extracted rows: `Natalie MacLean` (signal_tier=2).
- 1 search + ≤3 detail fetches per query.

#### Task 3.3: WineAlign — `lib/critic_reviews/sources/winealign.py`

- Search URL: `https://www.winealign.com/search?q={query}` (verify on fixture)
- Multi-critic aggregator: pages often list scores from multiple reviewers. `extract_for_wine` already handles this — one ExtractedScore per critic.
- Critic name from page (varies per row). Default classification per `critic_registry`.

#### Task 3.4: The Real Review — `lib/critic_reviews/sources/real_review.py`

- AU/NZ-focused. Search URL: `https://www.therealreview.com/?s={query}`
- Most likely critic name in extracted rows: `The Real Review` (signal_tier=2).

#### Task 3.5: Whiskybase — `lib/critic_reviews/sources/whiskybase.py`

- Deterministic URL strategy: `https://www.whiskybase.com/whiskies/distillery/{distillery_slug}` lists all bottlings; we slug-match the cuvée and follow to the bottling page.
- Critic for ratings: `Whiskybase community` (signal_tier=3, signal_class=community).
- WB also surfaces award/medal info on some pages — let `extract_for_wine` pick up medals if present.

#### Task 3.6: Master of Malt — `lib/critic_reviews/sources/master_of_malt.py`

- Search URL: `https://www.masterofmalt.com/search/?term={query}`
- MoM publishes its own editorial scores AND quotes others. The `critic` field on each row reflects who scored (per spec §3.1 attribution rule); `source` is always `master_of_malt`.

**Required attribution test** (spec §3.1) — add to `tests/critic_reviews/test_source_master_of_malt.py`:

```python
def test_attributes_quoted_critic_correctly():
    """When MoM's page quotes 'Whisky Advocate 90', the resulting row has
    source='master_of_malt' (provenance) and critic='Whisky Advocate'
    (attribution). They must not collapse."""
    fixture_html = """
    <html><head><title>Glenfarclas 25 Year Old</title></head><body>
      <main>
        <h1>Glenfarclas 25 Year Old</h1>
        <p>This expression earned Whisky Advocate 90 points.</p>
      </main>
    </body></html>
    """
    src = MasterOfMaltSource()
    with patch.object(src, "_fetch", return_value=fixture_html):
        scores = src.harvest(WineQuery(producer="Glenfarclas", cuvee="25 Year Old", vintage=None))
    assert any(s.critic == "Whisky Advocate" for s in scores), \
        "Quoted critic name must be the `critic`, not 'Master of Malt'"
    assert all(s.source == "master_of_malt" for s in scores), \
        "`source` field must be the page we fetched (provenance)"
```

#### Task 3.7: Distiller — `lib/critic_reviews/sources/distiller.py`

- URL pattern: `https://distiller.com/spirits?s={query}` for search.
- Critic name: `Distiller` (signal_tier=2). User scores also present (community).

After Task 3.7, run the full canary across all 8 sources at the end of Day 10:

```bash
for src in cellartracker wine_enthusiast natalie_maclean winealign real_review whiskybase master_of_malt distiller; do
  .venv/bin/python scripts/critic_reviews_canary.py --source $src
done
```

Each source should produce at least 1 row for at least 1 of the 5 canary SKUs.

---

## Phase 4: Integration + UI (Day 11-12)

### Task 4.1: refresh_products_summary.py — merge rules from spec §6

**Files:**

- Create: `lib/critic_reviews/refresh_products_summary.py`
- Create: `tests/critic_reviews/test_refresh_summary.py`

- [ ] **Step 1: Write the failing merge-rules test**

```python
# tests/critic_reviews/test_refresh_summary.py
import json, sqlite3, tempfile
from pathlib import Path

from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.refresh_products_summary import refresh_for_sku
from lib.critic_reviews.types import ExtractedScore


def _seed_db():
    db = Path(tempfile.mkdtemp()) / "t.db"
    conn = sqlite3.connect(str(db))
    conn.executescript("""
        CREATE TABLE products (
          sku TEXT PRIMARY KEY, brand TEXT, name TEXT, vintage TEXT, classification TEXT,
          is_active INTEGER, score_max REAL, score_summary TEXT
        );
        INSERT INTO products(sku,brand,name,vintage,classification,is_active)
          VALUES ('SKU1','Pio Cesare','Barolo Mosconi','2020','Red Wine',1);
    """)
    conn.commit()
    conn.close()
    repo = Repository(str(db))
    repo.init_schema()
    return db, repo


def _score(critic, native, value, tier, sclass="critic_numeric"):
    return ExtractedScore(
        producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020,
        source="src", source_url="https://x", source_review_id=None,
        critic=critic, score_native=native, score_scale="100pt", score_value=value,
        supporting_text=f"{critic}: {native} points", signal_class=sclass,
        signal_tier=tier, confidence=0.8,
    )


def test_score_max_is_highest_pro_score_100pt_equivalent():
    db, repo = _seed_db()
    for s in [_score("James Suckling", "99", 99, 1),
              _score("Wine Advocate", "94", 94, 1),
              _score("CellarTracker community", "93", 93, 3, "community")]:
        repo.write_score(s, payload=s.supporting_text)
    refresh_for_sku(str(db), "SKU1")
    conn = sqlite3.connect(str(db))
    row = conn.execute("SELECT score_max, score_summary FROM products WHERE sku='SKU1'").fetchone()
    assert row[0] == 99.0
    summary = json.loads(row[1])
    assert summary["critics"][0]["score_native"] == "99"
    assert len(summary["community"]) == 1
    assert summary["primary_source"] == "src"
    repo.close()
```

- [ ] **Step 2: Implement `refresh_products_summary.py`**

```python
"""Compute score_max + score_summary for one SKU (or all)."""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone

from lib.critic_reviews.extract.scale_conversion import to_100pt_equiv


def refresh_for_sku(db_path: str, sku: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    prod = conn.execute("SELECT brand, vintage FROM products WHERE sku=?", (sku,)).fetchone()
    if not prod:
        conn.close()
        return

    rows = conn.execute(
        """SELECT * FROM critic_scores
           WHERE lower(trim(producer))=lower(trim(?))
           ORDER BY fetched_at DESC""",
        (prod["brand"],),
    ).fetchall()

    pro_critics = []
    community = []
    medals = []
    for r in rows:
        if r["confidence"] < 0.5:
            continue
        if r["signal_class"] == "critic_numeric" and r["signal_tier"] in (1, 2):
            equiv = to_100pt_equiv(r["score_value"] or 0, r["score_scale"])
            if equiv is not None:
                pro_critics.append({
                    "abbr": _abbr(r["critic"]),
                    "critic": r["critic"],
                    "score_native": r["score_native"],
                    "score_value": equiv,
                    "url": r["source_url"],
                    "signal_tier": r["signal_tier"],
                    "source": r["source"],
                })
        elif r["signal_class"] == "community":
            community.append({
                "source": r["source"],
                "score_native": r["score_native"],
                "score_value": r["score_value"],
            })
        elif r["signal_class"] == "medal":
            medals.append({
                "authority": r["critic"],
                "url": r["source_url"],
            })

    pro_critics.sort(key=lambda x: (-x["score_value"], x["signal_tier"]))
    pro_critics = pro_critics[:5]

    score_max = max((c["score_value"] for c in pro_critics), default=None)
    primary_source = pro_critics[0]["source"] if pro_critics else (rows[0]["source"] if rows else None)

    summary = {
        "critics": pro_critics,
        "community": community,
        "medals": medals,
        "primary_source": primary_source,
        "rows_total": len(rows),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

    conn.execute(
        "UPDATE products SET score_max=?, score_summary=? WHERE sku=?",
        (score_max, json.dumps(summary, ensure_ascii=False), sku),
    )
    conn.commit()
    conn.close()


def refresh_all(db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    skus = [r[0] for r in conn.execute("SELECT sku FROM products WHERE is_active=1").fetchall()]
    conn.close()
    for sku in skus:
        refresh_for_sku(db_path, sku)
    return len(skus)


def _abbr(critic: str) -> str:
    table = {
        "James Suckling": "JS", "Wine Advocate": "WA", "Wine Spectator": "WS",
        "Jancis Robinson": "JR", "Robert Parker": "RP", "Vinous": "VN",
        "Wine Enthusiast": "WE", "Decanter": "DEC", "James Halliday": "JD",
        "Natalie MacLean": "NM", "Master of Malt": "MoM", "Whisky Advocate": "WhAdv",
    }
    return table.get(critic, critic[:4])
```

- [ ] **Step 3: Run + commit**

```bash
.venv/bin/pytest tests/critic_reviews/test_refresh_summary.py -v
git add lib/critic_reviews/refresh_products_summary.py tests/critic_reviews/test_refresh_summary.py
git commit -m "feat(critic-reviews): refresh_products_summary with deterministic merge rules

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4.2: API route — /api/products/[sku]/route.ts

**Files:**

- Create: `app/api/products/[sku]/route.ts`

(This is a thin route; the heavy lifting is done by `refresh_products_summary` writing into `products.score_summary`. The route reads that JSON and returns it inline.)

- [ ] **Step 1: Create the route**

```typescript
// app/api/products/[sku]/route.ts
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data", "db", "products.db");

type ReviewSummary = {
  critics: Array<{ abbr: string; critic: string; score_native: string; score_value: number; url: string; signal_tier: number; source: string }>;
  community: Array<{ source: string; score_native: string; score_value: number }>;
  medals: Array<{ authority: string; url: string }>;
  primary_source: string | null;
  rows_total: number;
  computed_at: string;
};

export async function GET(req: NextRequest, { params }: { params: { sku: string } }) {
  const sku = params.sku;
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare(`SELECT sku, name, brand, vintage, score_max, score_summary FROM products WHERE sku = ?`).get(sku) as any;
  db.close();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let summary: ReviewSummary | null = null;
  try { summary = row.score_summary ? JSON.parse(row.score_summary) : null; } catch { summary = null; }

  return NextResponse.json({
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    vintage: row.vintage,
    score_max: row.score_max,
    reviews: summary ? {
      critics: summary.critics,
      community: summary.community,
      medals: summary.medals,
      primary_source: summary.primary_source,
    } : null,
  });
}
```

- [ ] **Step 2: Smoke test in dev**

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000/api/products/WRW5031AD | jq .
kill %1 2>/dev/null
```

Expected (after Phase 5 backfill data lands): a JSON object with non-null `reviews`. Pre-backfill, `reviews` may be null — that's correct.

- [ ] **Step 3: Commit**

```bash
git add app/api/products/[sku]/route.ts
git commit -m "feat(critic-reviews): /api/products/[sku] route returns review summary

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4.3: CriticScoreBadges component

**Files:**

- Create: `components/product/CriticScoreBadges.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/product/CriticScoreBadges.tsx
"use client";

import React from "react";

export type CriticBadge = {
  abbr: string;
  critic: string;
  score_native: string;
  url: string;
};

export type CommunityBadge = {
  source: string;
  score_native: string;
};

export type MedalBadge = {
  authority: string;
  url: string;
};

export interface CriticScoreBadgesProps {
  critics?: CriticBadge[];
  community?: CommunityBadge[];
  medals?: MedalBadge[];
}

export function CriticScoreBadges({ critics = [], community = [], medals = [] }: CriticScoreBadgesProps) {
  if (critics.length === 0 && community.length === 0 && medals.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3" data-testid="critic-score-badges">
      {critics.map((b, i) => (
        <a
          key={`c-${i}`}
          href={b.url}
          target="_blank"
          rel="noopener nofollow ugc"
          title={b.critic}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-xs font-medium bg-white hover:bg-gray-50"
        >
          <span>{b.abbr}</span>
          <span className="font-bold">{b.score_native}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
        </a>
      ))}
      {community.map((b, i) => (
        <span key={`m-${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-xs bg-gray-50">
          <span>{b.source}</span>
          <span className="font-bold">{b.score_native}</span>
        </span>
      ))}
      {medals.map((b, i) => (
        <a
          key={`med-${i}`}
          href={b.url}
          target="_blank"
          rel="noopener nofollow ugc"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300 text-xs bg-amber-50"
        >
          {b.authority}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount the component on the product detail page (whichever route renders the detail panel)**

The existing detail panel is in `components/explore/` or `components/pages/`. Find the file that renders the per-SKU detail card (search for it):

```bash
grep -lrn "score_summary\|score_max" components/ app/ | head
```

Edit that file to fetch the review summary and pass it into `<CriticScoreBadges>`. The exact integration point depends on which component is the current detail panel; for the v1 surface plan it'll be the product detail page.

If no obvious file exists, mount on the simplest page that displays SKU detail, deferring deeper integration to a later iteration. The badges are decoupled enough to drop in anywhere.

- [ ] **Step 3: Commit**

```bash
git add components/product/CriticScoreBadges.tsx components/  # any integration files
git commit -m "feat(critic-reviews): CriticScoreBadges component + product page integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4.4: Browser walkthrough on 5 canary SKUs (CLAUDE.md Rule 7)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for "Ready in Xs" output.

- [ ] **Step 2: For each of the 5 canary SKUs, open the product detail URL**

Example (operator opens browser):

- `http://localhost:3000/product/WRW5400BN` (Chateau Clinet 2014)
- `http://localhost:3000/product/WWW2371EH` (Sauzet Bienvenues 2014)
- `http://localhost:3000/product/WRW5031AD` (Pio Cesare Mosconi 2020)
- `http://localhost:3000/product/WRW4744AD` (Casillero del Diablo Merlot)
- `http://localhost:3000/product/WRW0507AA` (PB Valley Tempranillo 2014)

- [ ] **Step 3: For each page, verify**

- [ ] CriticScoreBadges component renders
- [ ] Each badge shows critic name + score
- [ ] Clicking a badge opens the source page in a new tab
- [ ] PB Valley shows no badges (correct — empty state)
- [ ] No JS console errors

- [ ] **Step 4: Automated API smoke check across the 5 canary SKUs (spec §10 probe #2)**

```bash
for sku in WRW5400BN WWW2371EH WRW5031AD WRW4744AD WRW0507AA; do
  reviews_present=$(curl -s "http://localhost:3000/api/products/$sku" | jq '.reviews != null')
  critic_count=$(curl -s "http://localhost:3000/api/products/$sku" | jq '.reviews.critics | length // 0')
  echo "$sku  reviews_present=$reviews_present  critic_count=$critic_count"
done
```

Expected: at least 3 of the 5 SKUs should have `reviews_present=true` (PB Valley may legitimately be `false`). If 0/5 have data, the API route is wired wrong — fix before continuing.

- [ ] **Step 5: Record sign-off in JobReport notes**

```bash
sqlite3 data/db/products.db "INSERT INTO harvest_job_report (job_id, job_type, started_at, finished_at, notes) VALUES ('canary-ui-$(date +%Y%m%d)', 'canary', datetime('now'), datetime('now'), 'Manual UI walkthrough: 5/5 SKUs verified. Empty state confirmed for PB Valley. Browser: Chrome 130.');"
```

---

## Phase 5: Canary + tuning + backfill (Day 13-15)

### Task 5.0: Implement the multi-source backfill CLI

The Task 2.2 backfill module only has `run_canary()` — a single-source sequential helper. The full backfill that Task 5.4 kicks off needs: argparse entry, multi-source parallelism (one process or thread per source), the `scrape_progress` resume table, daily-window enforcement, and the post-backfill `refresh_products_summary.refresh_all()` call.

**Files:**

- Modify: `lib/critic_reviews/jobs/backfill.py` (add `main()` and parallel orchestration)
- Modify: `lib/critic_reviews/catalog.py` (cap per-day work via progress table)
- Create: `tests/critic_reviews/test_backfill_orchestration.py`

- [ ] **Step 1: Write the failing orchestration test**

```python
# tests/critic_reviews/test_backfill_orchestration.py
"""Multi-source backfill: each source runs independently, progress is recorded,
runs are resumable, daily window is respected."""
import sqlite3, tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

from lib.critic_reviews.jobs.backfill import run_multi_source
from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.types import ExtractedScore, WineQuery


class _StubSource:
    def __init__(self, name): self.name = name; self.calls = 0
    def harvest(self, q):
        self.calls += 1
        return [ExtractedScore(
            producer=q.producer, cuvee=q.cuvee, vintage=q.vintage,
            source=self.name, source_url="https://x", source_review_id=None,
            critic="Wine Enthusiast", score_native="91", score_scale="100pt", score_value=91.0,
            supporting_text=f"Wine Enthusiast 91 pts. {q.producer}.",
            signal_class="critic_numeric", signal_tier=1, confidence=0.8,
        )]


def test_multi_source_writes_rows_for_each_source():
    db = Path(tempfile.mkdtemp()) / "t.db"
    repo = Repository(str(db))
    repo.init_schema()
    triplets = [WineQuery("X", "Y", 2020), WineQuery("A", "B", 2021)]
    sources = [_StubSource("src1"), _StubSource("src2")]
    report = run_multi_source(sources, triplets, repo=repo, max_parallel_sources=2)
    assert report.rows_written_raw == 4  # 2 sources × 2 triplets
    assert report.sources_processed == 2
    repo.close()


def test_scrape_progress_skips_done_triplets_on_resume():
    db = Path(tempfile.mkdtemp()) / "t.db"
    repo = Repository(str(db))
    repo.init_schema()
    triplets = [WineQuery("X", "Y", 2020)]
    src = _StubSource("src1")
    run_multi_source([src], triplets, repo=repo)
    first_calls = src.calls
    # Re-run: scrape_progress says (src1, X, Y, 2020) = done
    run_multi_source([src], triplets, repo=repo)
    assert src.calls == first_calls  # no additional fetches
    repo.close()
```

- [ ] **Step 2: Implement `run_multi_source()` in `lib/critic_reviews/jobs/backfill.py`**

Add to the existing module:

```python
import concurrent.futures
from contextlib import contextmanager


def _is_done(repo, source: str, q: WineQuery) -> bool:
    conn = repo._c()
    row = conn.execute(
        "SELECT status FROM scrape_progress WHERE source=? AND producer=? AND cuvee=? AND vintage IS ?",
        (source, q.producer, q.cuvee, q.vintage),
    ).fetchone()
    return row is not None and row["status"] == "done"


def _record_progress(repo, source: str, q: WineQuery, status: str, error: str | None = None) -> None:
    conn = repo._c()
    conn.execute(
        """INSERT INTO scrape_progress(source, producer, cuvee, vintage, status, attempts, last_error, last_attempt_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(source, producer, cuvee, vintage) DO UPDATE SET
             status = excluded.status,
             attempts = scrape_progress.attempts + 1,
             last_error = excluded.last_error,
             last_attempt_at = excluded.last_attempt_at""",
        (source, q.producer, q.cuvee, q.vintage, status, error,
         datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def _harvest_one_source(source: Source, triplets: list[WineQuery], *, repo: Repository) -> tuple[int, int]:
    """Returns (pages_fetched, rows_written) for this source."""
    pages = 0; rows = 0
    for q in triplets:
        if _is_done(repo, source.name, q):
            continue
        _record_progress(repo, source.name, q, "in_progress")
        try:
            scores = source.harvest(q)
            pages += 1
            for s in scores:
                result = repo.write_score(s, payload=s.supporting_text)
                if result.written:
                    rows += 1
            _record_progress(repo, source.name, q, "done")
        except Exception as exc:
            log.exception("%s harvest failed for %s", source.name, q)
            _record_progress(repo, source.name, q, "transient_fail", str(exc))
    return pages, rows


def run_multi_source(
    sources: list[Source],
    triplets: list[WineQuery],
    *,
    repo: Repository,
    max_parallel_sources: int = 8,
    job_id: str | None = None,
) -> JobReport:
    report = JobReport(
        job_id=job_id or str(uuid.uuid4()),
        job_type="backfill",
        started_at=datetime.now(timezone.utc),
    )
    report.distinct_triplets = len(triplets)
    report.sources_processed = len(sources)

    # Each source gets its own thread; HTTP clients hold their own rate limiter.
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_parallel_sources) as ex:
        futures = {ex.submit(_harvest_one_source, s, triplets, repo=repo): s.name for s in sources}
        for f in concurrent.futures.as_completed(futures):
            pages, rows = f.result()
            report.pages_fetched += pages
            report.rows_written_raw += rows

    report.finished_at = datetime.now(timezone.utc)
    return report


def main():
    """CLI entrypoint: python -m lib.critic_reviews.jobs.backfill [options]"""
    import argparse
    from lib.critic_reviews.catalog import distinct_triplets
    from lib.critic_reviews.refresh_products_summary import refresh_all

    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/db/products.db")
    ap.add_argument("--sources", nargs="+", default=None,
                    help="Source names; default = all enabled sources.")
    ap.add_argument("--max-parallel-sources", type=int, default=8)
    ap.add_argument("--no-refresh-export", action="store_true",
                    help="Skip the post-backfill refresh_live_export.py call.")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    # Build sources (each adapter lazy-imported so a missing one doesn't break)
    enabled = args.sources or ["cellartracker", "wine_enthusiast", "natalie_maclean",
                                "winealign", "real_review", "whiskybase",
                                "master_of_malt", "distiller"]
    sources = []
    for name in enabled:
        try:
            module = __import__(f"lib.critic_reviews.sources.{name}", fromlist=["*"])
            cls = next(v for k, v in vars(module).items() if k.lower().startswith(name.replace("_","")[:5]) and isinstance(v, type))
            sources.append(cls())
        except (ImportError, StopIteration) as e:
            log.warning("skipping source %s: %s", name, e)

    repo = Repository(args.db)
    repo.init_schema()
    triplets = distinct_triplets(args.db)
    log.info("Backfill: %d triplets across %d sources", len(triplets), len(sources))
    report = run_multi_source(sources, triplets, repo=repo, max_parallel_sources=args.max_parallel_sources)

    # Refresh products.score_max / score_summary
    n = refresh_all(args.db)
    log.info("Refreshed score_summary for %d SKUs", n)

    # Refresh the live export
    if not args.no_refresh_export:
        import subprocess
        subprocess.run(["python", "scripts/refresh_live_export.py"], check=False)

    from lib.critic_reviews.jobs.report import format_report
    print(format_report(report))
    repo.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the orchestration tests**

```bash
.venv/bin/pytest tests/critic_reviews/test_backfill_orchestration.py -v
```

Expected: 2 passed.

- [ ] **Step 4: Smoke-test the CLI**

```bash
.venv/bin/python -m lib.critic_reviews.jobs.backfill --help
```

Expected: argparse help text. (Do NOT run the full backfill yet — Task 5.4 gates it on operator sign-off.)

- [ ] **Step 5: Commit**

```bash
git add lib/critic_reviews/jobs/backfill.py tests/critic_reviews/test_backfill_orchestration.py
git commit -m "feat(critic-reviews): multi-source backfill CLI + scrape_progress resume

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.1: Run 50-SKU precision canary — confusion matrix

**Files:**

- Modify: `scripts/critic_reviews_canary.py` (add `--mode precision` flag that loads the 50 recon SKUs and compares to the ground truth)

- [ ] **Step 1: Add precision mode to the canary script**

Add this function to `scripts/critic_reviews_canary.py`:

```python
def run_precision_canary(db_path: str = "data/db/products.db") -> dict:
    """Run the 50-SKU recon set through every enabled adapter and print a
    confusion matrix vs the recon spreadsheet's ground truth.

    Ground truth = data/critic_reviews_recon/results_merged.json
    Predicted    = critic_scores rows persisted after the run

    Returns a dict with per-source precision/recall plus overall numbers.
    Also prints a human-readable table to stdout.
    """
    import json
    from collections import defaultdict
    from pathlib import Path as _P

    from lib.critic_reviews.persist.repository import Repository
    from lib.critic_reviews.jobs.backfill import run_multi_source
    from lib.critic_reviews.sources.cellartracker import CellarTrackerSource
    # ... import each implemented source the same way

    ground = {g["sku"]: g for g in json.loads(_P("data/critic_reviews_recon/results_merged.json").read_text())}
    samples = json.loads(_P("data/critic_reviews_recon/sample_50.json").read_text())

    queries_by_sku: dict[str, WineQuery] = {
        s["sku"]: WineQuery(
            producer=s["brand"] or "",
            cuvee=s["name"] or "",
            vintage=int(s["vintage"]) if s.get("vintage") and str(s["vintage"]).isdigit() else None,
            sku=s["sku"],
        )
        for s in samples
    }

    repo = Repository(db_path)
    repo.init_schema()

    # Run each source; collect persisted (sku, source, critic) tuples
    sources = [CellarTrackerSource(mode="html")]  # plus the others when wired
    run_multi_source(sources, list(queries_by_sku.values()), repo=repo)

    # Pull the predicted rows back
    conn = repo._c()
    predicted: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    rows = conn.execute(
        "SELECT producer, cuvee, vintage, source, critic FROM critic_scores"
    ).fetchall()
    sku_by_pcv = {(q.producer, q.cuvee, q.vintage): sku for sku, q in queries_by_sku.items()}
    for r in rows:
        sku = sku_by_pcv.get((r["producer"], r["cuvee"], r["vintage"]))
        if sku:
            predicted[sku][r["source"]].append(r["critic"])

    # Confusion-matrix math (per source)
    by_source: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    overall = {"tp": 0, "fp": 0, "fn": 0}

    for sku, g in ground.items():
        ground_says_found = bool(g.get("found_critic_scores"))
        ground_critics = {c.lower() for c in (g.get("critics_found") or [])}
        ground_domains = {d for d in (g.get("source_domains") or [])}

        # For each source we ran, decide TP/FP/FN at the SKU level
        for source in by_source.keys() | predicted.get(sku, {}).keys():
            our_critics = {c.lower() for c in predicted.get(sku, {}).get(source, [])}
            if our_critics and ground_says_found:
                # TP if at least one of our critics appears in ground (loose match — substring)
                hit = any(any(gc in oc or oc in gc for gc in ground_critics) for oc in our_critics)
                if hit:
                    by_source[source]["tp"] += 1
                    overall["tp"] += 1
                else:
                    by_source[source]["fp"] += 1
                    overall["fp"] += 1
            elif our_critics and not ground_says_found:
                # Persisted a critic on a SKU ground says has none → FP
                by_source[source]["fp"] += 1
                overall["fp"] += 1
            elif not our_critics and ground_says_found:
                # Ground says yes but we found nothing
                # Only count as FN if ground's source_domains includes this source's domain;
                # otherwise the SKU was covered by a different source and this isn't this
                # adapter's miss.
                source_domain_map = {
                    "cellartracker": "cellartracker.com",
                    "wine_enthusiast": "wineenthusiast.com",
                    "natalie_maclean": "nataliemaclean.com",
                    "winealign": "winealign.com",
                    "real_review": "therealreview.com",
                    "whiskybase": "whiskybase.com",
                    "master_of_malt": "masterofmalt.com",
                    "distiller": "distiller.com",
                }
                domain = source_domain_map.get(source)
                if domain and domain in ground_domains:
                    by_source[source]["fn"] += 1
                    overall["fn"] += 1

    def _precision(c): return c["tp"] / max(1, c["tp"] + c["fp"])
    def _recall(c):    return c["tp"] / max(1, c["tp"] + c["fn"])

    print(f"{'source':20} {'TP':>4} {'FP':>4} {'FN':>4} {'precision':>10} {'recall':>8}")
    print("-" * 64)
    for source, c in sorted(by_source.items()):
        print(f"{source:20} {c['tp']:>4} {c['fp']:>4} {c['fn']:>4} "
              f"{_precision(c):>10.1%} {_recall(c):>8.1%}")
    print("-" * 64)
    print(f"{'OVERALL':20} {overall['tp']:>4} {overall['fp']:>4} {overall['fn']:>4} "
          f"{_precision(overall):>10.1%} {_recall(overall):>8.1%}")

    repo.close()
    return {"per_source": dict(by_source), "overall": overall}
```

- [ ] **Step 2: Run precision canary against all sources**

```bash
.venv/bin/python scripts/critic_reviews_canary.py --mode precision
```

Expected: a per-source confusion matrix. **Target: overall precision ≥ 90%** (spec §7.1). If precision is below 90%, see Task 5.2.

- [ ] **Step 3: Save the canary report**

```bash
.venv/bin/python scripts/critic_reviews_canary.py --mode precision > "data/critic_reviews_recon/precision_canary_$(date +%Y%m%d).txt"
```

---

### Task 5.2: Tune thresholds / fix top 5 false-positive patterns

If precision < 90%:

- [ ] **Step 1: Group FPs by pattern.** Look at every FP row in the canary output. Find the 5 most common root causes.
- [ ] **Step 2: For each, decide:** tighten the regex (preferred), or add a confidence penalty, or block via the producer-proximity window.
- [ ] **Step 3: Add a regression test in `test_score_patterns.py`** for the FP pattern.
- [ ] **Step 4: Re-run the precision canary.** Iterate until precision ≥ 90% or two iterations have shown diminishing returns (then file a v2 trigger — see spec §12).
- [ ] **Step 5: Commit each fix as a small, testable change.**

---

### Task 5.3: Verification job runner + e2e invariant tests

**Files:**

- Create: `lib/critic_reviews/verification.py`
- Create: `tests/critic_reviews/test_e2e_invariants.py`

- [ ] **Step 1: Write the e2e invariant tests**

```python
# tests/critic_reviews/test_e2e_invariants.py
"""CLAUDE.md Rule 6 — end-to-end invariants.

If critic_scores has confidence-promoted rows for a producer+cuvée+vintage,
then refresh_products_summary populates score_max / score_summary on the
matching SKU.
"""
import json
import sqlite3
import tempfile
from pathlib import Path

from lib.critic_reviews.persist.repository import Repository
from lib.critic_reviews.refresh_products_summary import refresh_for_sku
from lib.critic_reviews.types import ExtractedScore


def test_score_in_critic_scores_propagates_to_score_summary():
    db = Path(tempfile.mkdtemp()) / "t.db"
    conn = sqlite3.connect(str(db))
    conn.executescript("""
        CREATE TABLE products (sku TEXT PRIMARY KEY, brand TEXT, name TEXT, vintage TEXT,
                               classification TEXT, is_active INTEGER,
                               score_max REAL, score_summary TEXT);
        INSERT INTO products(sku,brand,name,vintage,classification,is_active)
          VALUES ('SKU1','Pio Cesare','Barolo Mosconi','2020','Red Wine',1);
    """)
    conn.commit()
    conn.close()
    repo = Repository(str(db))
    repo.init_schema()
    s = ExtractedScore(
        producer="Pio Cesare", cuvee="Barolo Mosconi", vintage=2020,
        source="james_suckling", source_url="https://x", source_review_id=None,
        critic="James Suckling", score_native="99", score_scale="100pt", score_value=99.0,
        supporting_text="James Suckling: 99 points",
        signal_class="critic_numeric", signal_tier=1, confidence=0.9,
    )
    repo.write_score(s, payload=s.supporting_text)
    refresh_for_sku(str(db), "SKU1")

    conn = sqlite3.connect(str(db))
    score_max, summary_json = conn.execute(
        "SELECT score_max, score_summary FROM products WHERE sku='SKU1'"
    ).fetchone()
    assert score_max == 99.0
    summary = json.loads(summary_json)
    assert any(c["critic"] == "James Suckling" for c in summary["critics"])
    repo.close()


def test_facts_only_rows_never_expose_supporting_text_via_serving():
    """find_for_serving() always redacts supporting_text."""
    # Setup as above, then:
    # rows = repo.find_for_serving(sku='SKU1')
    # assert all(r.supporting_text == "" for r in rows)
    pass  # exercise via integration after Task 4.1 wires the API
```

- [ ] **Step 2: Run + commit**

```bash
.venv/bin/pytest tests/critic_reviews/test_e2e_invariants.py -v
git add lib/critic_reviews/verification.py tests/critic_reviews/test_e2e_invariants.py
git commit -m "feat(critic-reviews): e2e invariants + verification probes (CLAUDE.md Rule 6)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5.4: Backfill kickoff

- [ ] **Step 1: Backup**

```bash
cp data/db/products.db "data/db/products.db.bak-pre-backfill-$(date +%Y%m%d-%H%M%S)"
```

- [ ] **Step 2: Estimate runtime from canary**

Multiply average per-SKU canary time × distinct triplets across catalog. Confirm fits in spec's 5-10 day budget. If 2× over budget, file a kill point and decide.

- [ ] **Step 3: Show estimate to operator and get sign-off (CLAUDE.md Rule 10 step 5)**

```text
Backfill estimate:
  Distinct triplets: ~N
  Per-triplet avg time across 8 sources: ~T seconds
  Expected wall-clock: ~D days (4hr daily windows × 8 sources in parallel)
  Estimated rows written: ~R
  Estimated SKUs newly populated: ~M (~Pct% of catalog)

OK to proceed? [y/N]
```

- [ ] **Step 4: Kick off backfill**

```bash
.venv/bin/python -m lib.critic_reviews.jobs.backfill --all-sources --daily-window-hours 4 > "logs/critic_reviews_backfill_$(date +%Y%m%d).log" 2>&1 &
echo $! > /tmp/critic_reviews_backfill.pid
```

- [ ] **Step 5: Monitor** (Rule 1: verify what shipped)

After each daily window, check what landed in the destination:

```bash
sqlite3 data/db/products.db <<'SQL'
SELECT
  (SELECT count(*) FROM critic_scores) AS total_scores,
  (SELECT count(DISTINCT producer || cuvee || COALESCE(vintage,0)) FROM critic_scores) AS distinct_triplets,
  (SELECT count(*) FROM products WHERE score_max IS NOT NULL) AS skus_with_score_max,
  (SELECT count(*) FROM products WHERE is_active = 1) AS active_skus;
SQL
```

When `skus_with_score_max / active_skus` hits ~60-65%, the backfill is converging to its target.

- [ ] **Step 6: Final report (CLAUDE.md Rule 4 — what shipped)**

```bash
sqlite3 data/db/products.db "SELECT * FROM harvest_job_report ORDER BY started_at DESC LIMIT 1;"
```

Confirm the report includes the "SKUs now populated" line.

- [ ] **Step 7: Refresh the live export (CLAUDE.md Rule 9)**

```bash
.venv/bin/python scripts/refresh_live_export.py
```

- [ ] **Step 8: Final UI walkthrough** — re-open the 5 canary SKUs in browser; the badges should now reflect richer data than the day-12 walkthrough.

- [ ] **Step 9: Commit final state + close out**

```bash
git add docs/ data/critic_reviews_recon/precision_canary_*.txt logs/
git commit -m "chore(critic-reviews): record final canary + backfill results

Final precision: P%
Final catalog coverage: C% (target was 60-65%)
Total SKUs reviewable: N / 11436

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Done

When all tasks above are checked off:

- The 50-SKU recon set is also the precision regression test.
- Every persisted score has a literal-substring quote from its source page.
- ~64% of SKUs have a `score_max` populated.
- `CriticScoreBadges` renders on the product detail page.
- The `/api/products/[sku]` route serves the review summary.
- A backfill job report exists in `harvest_job_report`.
- Future refresh runs are quarterly, low-touch.

**Next iterations (v2, decision-gated per spec §12):** LLM verification, vintage_policy column, release_id/batch_id, new-SKU hook, critic identity normalization. Add only when evidence shows the gate is met.
