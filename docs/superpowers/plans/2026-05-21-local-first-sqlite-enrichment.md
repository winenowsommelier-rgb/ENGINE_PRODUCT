# Local-First SQLite Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the wine enrichment pipeline from a Supabase-coupled architecture to a local-first SQLite primary store, with a separate idempotent sync-to-Supabase step. Capture parse/validation failures locally so we can diagnose them.

**Architecture:** Single SQLite file at `data/db/products.db` mirrors the Supabase Postgres schema (products + enrichment_cache + critic_scores) plus one new local-only table `enrichment_failures`. Enrichment writes ONLY to SQLite. A separate `scripts/sync_to_supabase.py` pushes deltas. CSV export remains unchanged for compatibility.

**Tech Stack:** Python 3.11 stdlib `sqlite3` (no new deps); existing `anthropic` SDK; existing `pytest 8.4.2`. Zero changes to the AI prompt, validator, scoring, or evidence collection — purely a storage refactor.

**Spec:** [docs/superpowers/specs/2026-05-21-local-first-sqlite-enrichment-design.md](../specs/2026-05-21-local-first-sqlite-enrichment-design.md)

**Prior plan (for context):** [docs/superpowers/plans/2026-05-12-wine-enrichment.md](2026-05-12-wine-enrichment.md)

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `data/migrations/2026-05-21_local_sqlite_schema.sql` | SQLite DDL mirroring `2026-05-19_fresh_project_schema.sql` + new `enrichment_failures` table. |
| `data/lib/enrichment/shared/local_store.py` | SQLite-backed `LocalCache` (drop-in for `CacheClient`) + new `FailureLogger`. |
| `data/lib/enrichment/wine/local_router.py` | SQLite-backed product UPDATE half of the old `OutputRouter`. CSV writing stays in `output.py`. |
| `scripts/seed_sqlite_from_json.py` | One-shot bootstrap: products.json + winesensed JSON + brand CSV → `data/db/products.db`. |
| `scripts/sync_to_supabase.py` | Idempotent local→Supabase push. Dry-run + resume support. |
| `tests/test_local_store.py` | Unit tests for `LocalCache` lookup/write + supersede chain + `FailureLogger`. |
| `tests/test_local_router.py` | Unit tests for product UPDATE routing in SQLite. |
| `tests/test_seed_sqlite_from_json.py` | Unit test: seed populates expected row counts + schema integrity. |
| `tests/test_sync_to_supabase.py` | Unit test: dry-run shows deltas; `last_synced_at` advances; second run is no-op. |
| `tests/fixtures/local_db_seed.sqlite` | Generated at test setup time, not committed. (Use `tmp_path` fixture per existing convention in `conftest.py`.) |

### Files to modify

| Path | Change |
|---|---|
| `data/enrich_wines.py` | Add `--db PATH` flag (default `data/db/products.db`). Swap `CacheClient` → `LocalCache`. Swap Supabase PATCH path in router → `local_router.update_product()`. Wire `FailureLogger` into parse + validation reject paths. Add `--also-push-supabase` transitional flag (default OFF). |
| `data/lib/enrichment/wine/output.py` | Split: keep `CSV_COLUMNS` and `build_csv_row` here; move Supabase HTTP logic out (keep as backwards-compat under `--also-push-supabase`). `OutputRouter` becomes CSV-only; new `local_router.LocalRouter` handles the SQLite product write. |
| `tests/test_wine_enrichment_output.py` | Update tests for split: CSV-only assertions stay; Supabase HTTP assertions move to a new `test_supabase_push.py` (kept under transitional flag testing). |
| `.gitignore` | Add `data/db/products.db` and `data/db/products.db-journal`. |
| `requirements.txt` | No change (stdlib `sqlite3` only). |

### Files NOT touched

- `data/lib/enrichment/wine/evidence.py`, `prompt.py`, `validator.py`, `scoring.py`, `taxonomies.py` — pure logic, unchanged.
- `data/lib/enrichment/shared/client.py` — Anthropic wrapper, unchanged.
- `data/lib/enrichment/shared/taxonomies/` — food-pairing loader, unchanged.
- `app/api/explore/products/route.ts` and other API routes — unchanged. They read from Supabase via the live PostgREST client; once sync runs, they see fresh data.

### Files generated at runtime (not part of implementation)

- `data/db/products.db` — local SQLite store, gitignored.
- `data/exports/wine-enrichment-{timestamp}.csv` — unchanged.

---

## Execution order

```
Task 1: SQLite schema migration
    ↓
Task 2: Seed script (products.json → SQLite)
    ↓
Task 3: LocalCache (replaces Supabase cache.py read/write)
    ↓
Task 4: FailureLogger (NEW — captures parse + validation rejects)
    ↓
Task 5: LocalRouter (replaces Supabase PATCH in output.py)
    ↓
Task 6: Wire into enrich_wines.py CLI
    ↓
Task 7: Sync-to-Supabase script
    ↓
Task 8: 10-SKU smoke test on new architecture
    ↓
Task 9: Diagnostic batch — inspect captured failures
```

Tasks 1-6 are sequential. Task 7 can run in parallel with Tasks 4-6 if dispatched as a subagent (see Execution Handoff at bottom).

---

## Task 1: SQLite schema migration

**Files:**
- Create: `data/migrations/2026-05-21_local_sqlite_schema.sql`
- Test: `tests/test_local_store.py` (just the schema-loads check; full tests in Task 3)

- [ ] **Step 1.1: Write the failing test for schema bootstrap**

Create `tests/test_local_store.py`:

```python
"""Tests for SQLite-backed enrichment store."""
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


def _bootstrap_db(tmp_path: Path) -> sqlite3.Connection:
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    return conn


def test_schema_creates_expected_tables(tmp_path):
    conn = _bootstrap_db(tmp_path)
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    names = {r[0] for r in rows}
    assert {"products", "enrichment_cache", "enrichment_failures", "critic_scores"} <= names


def test_products_has_enrichment_columns(tmp_path):
    conn = _bootstrap_db(tmp_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)").fetchall()}
    required = {
        "id", "sku", "name", "brand", "classification",
        "wine_body", "wine_acidity", "wine_tannin",
        "grape_variety", "grape_blend_type", "wine_production_style",
        "flavor_tags", "food_matching", "full_description", "desc_en_short",
        "score_max", "score_summary",
        "enrichment_confidence", "enriched_at", "enriched_by", "validation_status",
    }
    assert required <= cols, f"missing: {required - cols}"


def test_enrichment_failures_table_shape(tmp_path):
    conn = _bootstrap_db(tmp_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(enrichment_failures)").fetchall()}
    assert cols >= {"id", "sku", "failure_type", "raw_response", "validation_issues", "created_at"}
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
.venv/bin/pytest tests/test_local_store.py -v
```
Expected: FAIL — `FileNotFoundError` on the schema file.

- [ ] **Step 1.3: Write the schema**

Create `data/migrations/2026-05-21_local_sqlite_schema.sql`:

```sql
-- Local SQLite store mirroring 2026-05-19_fresh_project_schema.sql (Supabase Postgres)
-- with mechanical type translations:
--   text             -> TEXT
--   integer          -> INTEGER
--   numeric/...      -> REAL
--   timestamptz      -> TEXT (ISO 8601 UTC)
--   uuid pkey w/ default -> TEXT pkey (caller provides UUID)
--   jsonb            -> TEXT (JSON string)
--   text[]           -> TEXT (JSON-encoded array)
--   gin indexes      -> dropped
--
-- Plus one new local-only table: enrichment_failures.

PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. products
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  sku             TEXT NOT NULL,
  sku_base        TEXT,

  name            TEXT,
  brand           TEXT,
  vintage         TEXT,
  bottle_size     TEXT,
  alcohol         TEXT,

  price           REAL,
  cost            REAL,
  currency        TEXT,
  special_price   REAL,
  sp_discount_pct TEXT,
  b2b_price       REAL,
  b2b_margin_thb  REAL,
  b2b_margin_pct  TEXT,
  b2b_discount_pct TEXT,
  margin_thb      REAL,
  margin_pct      TEXT,
  promotion_price TEXT,
  promotion_tier_price TEXT,
  price_group     TEXT,

  is_in_stock     TEXT,
  custom_stock_status TEXT,
  wn_stock        INTEGER,
  quantity_in_stock INTEGER,
  sold_orders     INTEGER,
  sold_qty        INTEGER,
  consign         TEXT,

  country         TEXT,
  region          TEXT,
  subregion       TEXT,
  appellation     TEXT,
  origin          TEXT,
  origin_source   TEXT,
  manufacturer    TEXT,

  classification  TEXT,
  classification_source TEXT,
  wine_classification TEXT,
  wine_type       TEXT,
  liquor_main_type TEXT,
  other_type      TEXT,

  grape_variety   TEXT,
  grape_blend_type TEXT,
  wine_production_style TEXT,   -- JSON-encoded list
  wine_color      TEXT,
  wine_body       TEXT,
  wine_acidity    TEXT,
  wine_tannin     TEXT,
  flavor_profile  TEXT,
  flavor_tags     TEXT,
  food_matching   TEXT,
  character_traits TEXT,
  full_description TEXT,
  desc_en_short   TEXT,
  producer_notes  TEXT,

  image_url       TEXT,
  image_alt_text  TEXT,
  image_local_path TEXT,
  image_scraped_url TEXT,

  popularity_score         REAL,
  popularity_qty_90d       REAL,
  popularity_orders_90d    INTEGER,
  popularity_revenue_90d   REAL,
  popularity_window_days   INTEGER,
  popularity_synced_at     TEXT,

  score_max       REAL,
  score_summary   TEXT,

  enrichment_source     TEXT,
  enrichment_note       TEXT,
  enrichment_priority   TEXT,
  enrichment_confidence REAL,
  enriched_at           TEXT,
  enriched_by           TEXT,
  overall_confidence    REAL,
  taxonomy_confidence   REAL,
  description_confidence REAL,
  validation_status     TEXT,

  batch_id        TEXT,
  queue_priority  INTEGER,
  source_file     TEXT,
  supplier_code   TEXT,
  synced_at       TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_classification    ON products (classification);
CREATE INDEX IF NOT EXISTS idx_products_country           ON products (country);
CREATE INDEX IF NOT EXISTS idx_products_region            ON products (region);
CREATE INDEX IF NOT EXISTS idx_products_brand             ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_validation_status ON products (validation_status);
CREATE INDEX IF NOT EXISTS idx_products_popularity_score  ON products (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_products_score_max         ON products (score_max DESC);
CREATE INDEX IF NOT EXISTS idx_products_grape_blend_type  ON products (grape_blend_type);

-- ============================================================================
-- 2. enrichment_cache — mirror of Supabase audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id                  TEXT PRIMARY KEY,
  sku                 TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'wine',
  prompt_hash         TEXT NOT NULL,
  evidence_hash       TEXT NOT NULL,
  prompt_text         TEXT NOT NULL,
  response_json       TEXT NOT NULL,    -- JSON string
  response_raw        TEXT,
  model               TEXT NOT NULL,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  cost_thb            REAL,
  confidence          REAL,
  validation_status   TEXT,
  validation_issues   TEXT,             -- JSON-encoded list[str]
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  superseded_at       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_cache_active
  ON enrichment_cache (sku, prompt_hash, evidence_hash)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_created_at
  ON enrichment_cache (created_at);

-- ============================================================================
-- 3. enrichment_failures — NEW (local-only, not synced to Supabase)
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_failures (
  id                  TEXT PRIMARY KEY,
  sku                 TEXT NOT NULL,
  failure_type        TEXT NOT NULL,    -- 'parse' | 'validation_first' | 'validation_retry'
  raw_response        TEXT,
  validation_issues   TEXT,             -- JSON-encoded list[str]
  prompt_hash         TEXT,
  evidence_hash       TEXT,
  model               TEXT,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  cost_thb            REAL,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrichment_failures_sku  ON enrichment_failures (sku);
CREATE INDEX IF NOT EXISTS idx_enrichment_failures_type ON enrichment_failures (failure_type);

-- ============================================================================
-- 4. critic_scores — mirror of Supabase
-- ============================================================================
CREATE TABLE IF NOT EXISTS critic_scores (
  id            TEXT PRIMARY KEY,
  sku           TEXT NOT NULL,
  critic        TEXT NOT NULL,
  score         REAL NOT NULL,
  score_max     REAL NOT NULL DEFAULT 100,
  vintage       TEXT,
  tasting_year  INTEGER,
  source_url    TEXT,
  notes         TEXT,
  added_by      TEXT,
  added_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_critic_scores_sku ON critic_scores (sku);
CREATE INDEX IF NOT EXISTS idx_critic_scores_critic_score ON critic_scores (critic, score DESC);

-- ============================================================================
-- 5. sync_state — tracks last successful local→Supabase push per table
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  table_name      TEXT PRIMARY KEY,
  last_synced_at  TEXT,
  last_synced_id  TEXT
);
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_local_store.py -v
```
Expected: 3/3 PASS.

- [ ] **Step 1.5: Add `.gitignore` entries**

Append to `.gitignore`:
```
data/db/products.db
data/db/products.db-journal
data/db/products.db-wal
data/db/products.db-shm
```

- [ ] **Step 1.6: Commit**

```bash
git add data/migrations/2026-05-21_local_sqlite_schema.sql tests/test_local_store.py .gitignore
git commit -m "feat(enrichment): SQLite schema mirroring Supabase + new enrichment_failures table"
```

---

## Task 2: Seed script (products.json → SQLite)

**Files:**
- Create: `scripts/seed_sqlite_from_json.py`
- Test: `tests/test_seed_sqlite_from_json.py`

- [ ] **Step 2.1: Write the failing test**

Create `tests/test_seed_sqlite_from_json.py`:

```python
"""Tests for the products.json -> SQLite bootstrap."""
import json
import sqlite3
from pathlib import Path

import pytest

from scripts.seed_sqlite_from_json import seed_products_db

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def sample_products():
    return [
        {"id": "row-1", "sku": "WRW0001", "name": "Test Red", "brand": "Foo",
         "classification": "Red Wine", "country": "France",
         "wine_production_style": ["organic", "sustainable"]},
        {"id": "row-2", "sku": "WSP0002", "name": "Test Sparkling", "brand": "Bar",
         "classification": "Sparkling Wine"},
    ]


def test_seed_creates_rows(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert count == 2


def test_seed_encodes_list_columns_as_json(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT wine_production_style FROM products WHERE sku='WRW0001'").fetchone()
    assert json.loads(row[0]) == ["organic", "sustainable"]


def test_seed_is_idempotent(tmp_path, sample_products):
    db_path = tmp_path / "test.db"
    products_json = tmp_path / "products.json"
    products_json.write_text(json.dumps(sample_products))

    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)
    seed_products_db(db_path, products_json, schema_sql=SCHEMA_SQL)  # second run

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert count == 2, "second seed should UPSERT, not duplicate"
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
.venv/bin/pytest tests/test_seed_sqlite_from_json.py -v
```
Expected: FAIL — `ModuleNotFoundError: scripts.seed_sqlite_from_json`.

- [ ] **Step 2.3: Implement the seed script**

Create `scripts/seed_sqlite_from_json.py`:

```python
#!/usr/bin/env python3
"""Bootstrap data/db/products.db from products.json.

Idempotent: re-runs UPSERT by sku. Schema columns are introspected from the
SQLite database; JSON keys not in the schema are silently ignored. List values
(e.g. wine_production_style) are JSON-encoded.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_PRODUCTS_JSON = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_SCHEMA = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


def _ensure_schema(conn: sqlite3.Connection, schema_sql: Path) -> None:
    conn.executescript(schema_sql.read_text())


def _product_columns(conn: sqlite3.Connection) -> list[str]:
    return [r[1] for r in conn.execute("PRAGMA table_info(products)").fetchall()]


def _normalize(value):
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return value


def seed_products_db(
    db_path: Path,
    products_json: Path,
    schema_sql: Path = DEFAULT_SCHEMA,
) -> int:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn, schema_sql)
        cols = _product_columns(conn)
        records = json.loads(products_json.read_text())
        if isinstance(records, dict):
            records = records.get("records", [])

        count = 0
        for rec in records:
            row = {k: _normalize(rec[k]) for k in cols if k in rec}
            if "sku" not in row:
                continue
            names = list(row.keys())
            placeholders = ",".join("?" for _ in names)
            updates = ",".join(f"{n}=excluded.{n}" for n in names if n not in ("id", "sku"))
            sql = (
                f"INSERT INTO products ({','.join(names)}) VALUES ({placeholders}) "
                f"ON CONFLICT(sku) DO UPDATE SET {updates}"
            )
            conn.execute(sql, [row[n] for n in names])
            count += 1
        conn.commit()
        return count
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Seed local SQLite from products.json.")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--products-json", type=Path, default=DEFAULT_PRODUCTS_JSON)
    p.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    args = p.parse_args(argv)

    if not args.products_json.exists():
        print(f"ERROR: {args.products_json} not found.", file=sys.stderr)
        return 1
    n = seed_products_db(args.db, args.products_json, args.schema)
    print(f"Seeded {n} products → {args.db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_seed_sqlite_from_json.py -v
```
Expected: 3/3 PASS.

- [ ] **Step 2.5: Seed the real DB and verify**

```bash
.venv/bin/python scripts/seed_sqlite_from_json.py
sqlite3 data/db/products.db "SELECT COUNT(*) FROM products"
sqlite3 data/db/products.db "SELECT COUNT(*) FROM products WHERE classification IN ('Red Wine','White Wine','Rose Wine','Sparkling Wine','Dessert Wine')"
```
Expected: ~11,436 total rows, ~6,375 wine rows.

- [ ] **Step 2.6: Commit**

```bash
git add scripts/seed_sqlite_from_json.py tests/test_seed_sqlite_from_json.py
git commit -m "feat(enrichment): seed SQLite from products.json (idempotent UPSERT by sku)"
```

---

## Task 3: LocalCache (replaces Supabase cache.py R/W)

**Files:**
- Modify: `data/lib/enrichment/shared/local_store.py` (new file)
- Test: `tests/test_local_store.py` (extend from Task 1)

- [ ] **Step 3.1: Extend the test with cache behavior**

Append to `tests/test_local_store.py`:

```python
from data.lib.enrichment.shared.local_store import LocalCache


def _make_cache(tmp_path):
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.close()
    return LocalCache(db_path=db_path)


def test_local_cache_write_then_lookup_returns_row(tmp_path):
    cache = _make_cache(tmp_path)
    cache.write(
        sku="WRW1234", category="wine",
        prompt_hash="ph1", evidence_hash="eh1",
        prompt_text="prompt", response_json={"wine_body": "Medium-Bodied"},
        response_raw='{"wine_body":"Medium-Bodied"}',
        model="claude-haiku-4-5", tokens_in=100, tokens_out=50,
        cost_thb=0.15, confidence=0.82,
        validation_status="passed", validation_issues=[],
    )
    hit = cache.lookup(sku="WRW1234", prompt_hash="ph1", evidence_hash="eh1")
    assert hit is not None
    assert hit["response_json"]["wine_body"] == "Medium-Bodied"
    assert hit["validation_status"] == "passed"


def test_local_cache_write_supersedes_prior_active_row(tmp_path):
    cache = _make_cache(tmp_path)
    cache.write(sku="WRW1", category="wine", prompt_hash="p1", evidence_hash="e1",
                prompt_text="x", response_json={}, response_raw="",
                model="m", tokens_in=1, tokens_out=1, cost_thb=0.0,
                confidence=0.5, validation_status="passed", validation_issues=[])
    cache.write(sku="WRW1", category="wine", prompt_hash="p2", evidence_hash="e2",
                prompt_text="y", response_json={}, response_raw="",
                model="m", tokens_in=1, tokens_out=1, cost_thb=0.0,
                confidence=0.6, validation_status="passed", validation_issues=[])
    # Old row superseded
    import sqlite3
    conn = sqlite3.connect(cache.db_path)
    active = conn.execute(
        "SELECT prompt_hash FROM enrichment_cache WHERE sku='WRW1' AND superseded_at IS NULL"
    ).fetchall()
    assert len(active) == 1
    assert active[0][0] == "p2"


def test_local_cache_lookup_miss_returns_none(tmp_path):
    cache = _make_cache(tmp_path)
    assert cache.lookup(sku="NOPE", prompt_hash="x", evidence_hash="y") is None


def test_failure_logger_records_parse_failure(tmp_path):
    from data.lib.enrichment.shared.local_store import FailureLogger
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.close()

    logger = FailureLogger(db_path=db_path)
    logger.log(
        sku="WRW9999", failure_type="parse",
        raw_response="not json at all", validation_issues=[],
        prompt_hash="ph", evidence_hash="eh", model="m",
        tokens_in=10, tokens_out=20, cost_thb=0.05,
    )
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT failure_type, raw_response FROM enrichment_failures WHERE sku='WRW9999'"
    ).fetchone()
    assert row == ("parse", "not json at all")
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
.venv/bin/pytest tests/test_local_store.py -v
```
Expected: 3 PASS (from Task 1) + 4 NEW FAIL with `ModuleNotFoundError`.

- [ ] **Step 3.3: Implement LocalCache + FailureLogger**

Create `data/lib/enrichment/shared/local_store.py`:

```python
"""SQLite-backed enrichment cache + failure log.

Drop-in replacement for the Supabase HTTP CacheClient. Same `lookup` / `write`
signatures so enrich_wines.py only needs to swap the constructor.

The cache keeps a supersede chain: writing a new row for a SKU marks any
existing active row as superseded (audit trail preserved).
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any


class LocalCache:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def lookup(self, sku: str, prompt_hash: str, evidence_hash: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, sku, category, prompt_hash, evidence_hash, response_json, "
                "model, tokens_in, tokens_out, cost_thb, confidence, "
                "validation_status, validation_issues "
                "FROM enrichment_cache "
                "WHERE sku=? AND prompt_hash=? AND evidence_hash=? AND superseded_at IS NULL "
                "LIMIT 1",
                (sku, prompt_hash, evidence_hash),
            ).fetchone()
        if row is None:
            return None
        out = dict(row)
        out["response_json"] = json.loads(out["response_json"]) if out["response_json"] else {}
        out["validation_issues"] = json.loads(out["validation_issues"] or "[]")
        return out

    def write(
        self,
        sku: str,
        category: str,
        prompt_hash: str,
        evidence_hash: str,
        prompt_text: str,
        response_json: dict,
        response_raw: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost_thb: float,
        confidence: float,
        validation_status: str,
        validation_issues: list,
    ) -> str:
        new_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute(
                "UPDATE enrichment_cache SET superseded_at=CURRENT_TIMESTAMP "
                "WHERE sku=? AND superseded_at IS NULL",
                (sku,),
            )
            conn.execute(
                "INSERT INTO enrichment_cache "
                "(id, sku, category, prompt_hash, evidence_hash, prompt_text, "
                " response_json, response_raw, model, tokens_in, tokens_out, "
                " cost_thb, confidence, validation_status, validation_issues) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id, sku, category, prompt_hash, evidence_hash, prompt_text,
                    json.dumps(response_json, ensure_ascii=False), response_raw,
                    model, tokens_in, tokens_out, cost_thb, confidence,
                    validation_status, json.dumps(validation_issues, ensure_ascii=False),
                ),
            )
            conn.commit()
        return new_id


class FailureLogger:
    """Captures parse + validation failures locally (not synced to Supabase)."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def log(
        self,
        sku: str,
        failure_type: str,                 # 'parse' | 'validation_first' | 'validation_retry'
        raw_response: str | None,
        validation_issues: list,
        prompt_hash: str | None = None,
        evidence_hash: str | None = None,
        model: str | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost_thb: float | None = None,
    ) -> str:
        new_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO enrichment_failures "
                "(id, sku, failure_type, raw_response, validation_issues, "
                " prompt_hash, evidence_hash, model, tokens_in, tokens_out, cost_thb) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id, sku, failure_type, raw_response,
                    json.dumps(validation_issues, ensure_ascii=False),
                    prompt_hash, evidence_hash, model, tokens_in, tokens_out, cost_thb,
                ),
            )
            conn.commit()
        return new_id
```

- [ ] **Step 3.4: Run tests**

```bash
.venv/bin/pytest tests/test_local_store.py -v
```
Expected: 7/7 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add data/lib/enrichment/shared/local_store.py tests/test_local_store.py
git commit -m "feat(enrichment): LocalCache + FailureLogger (SQLite-backed)"
```

---

## Task 4: LocalRouter (replaces Supabase PATCH in output.py)

**Files:**
- Create: `data/lib/enrichment/wine/local_router.py`
- Modify: `data/lib/enrichment/wine/output.py` (split — keep CSV path; mark Supabase HTTP as legacy)
- Test: `tests/test_local_router.py`

- [ ] **Step 4.1: Write the failing test**

Create `tests/test_local_router.py`:

```python
"""Tests for the SQLite-backed product UPDATE half of the output router."""
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def db_with_product(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, name, classification) VALUES (?,?,?,?)",
        ("row-1", "WRW1", "Old name", "Red Wine"),
    )
    conn.commit()
    conn.close()
    return db


def test_local_router_updates_high_conf_row(db_with_product):
    from data.lib.enrichment.wine.local_router import LocalRouter

    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    wrote = router.update_product(
        products_id="row-1",
        response={
            "wine_body": "Full-Bodied",
            "wine_acidity": "Medium",
            "wine_tannin": "Firm",
            "grape_variety": ["Cabernet Sauvignon"],
            "grape_blend_type": "varietal",
            "wine_production_style": ["organic"],
            "flavor_tags": ["dark fruit", "cedar"],
            "food_matching": ["red meat", "aged cheese"],
            "desc_en_short": "Bold Napa Cab",
            "full_description": "<p>Long form.</p>",
        },
        final_confidence=0.9,
        model="claude-haiku-4-5",
        enrichment_note="Haiku/A",
        enriched_at="2026-05-21T10:00:00Z",
        score_max=92.0,
        score_summary="JS 92",
    )
    assert wrote is True

    conn = sqlite3.connect(db_with_product)
    row = dict((k, v) for k, v in zip(
        ["wine_body", "enrichment_confidence", "enrichment_source"],
        conn.execute(
            "SELECT wine_body, enrichment_confidence, enrichment_source FROM products WHERE id='row-1'"
        ).fetchone(),
    ))
    assert row["wine_body"] == "Full-Bodied"
    assert row["enrichment_confidence"] == pytest.approx(0.9)
    assert row["enrichment_source"] == "ai_high_conf"


def test_local_router_skips_below_threshold(db_with_product):
    from data.lib.enrichment.wine.local_router import LocalRouter
    router = LocalRouter(db_path=db_with_product, write_threshold=0.85)
    wrote = router.update_product(
        products_id="row-1", response={"wine_body": "Full-Bodied"},
        final_confidence=0.7, model="m", enrichment_note="n",
        enriched_at="2026-05-21T10:00:00Z",
    )
    assert wrote is False

    conn = sqlite3.connect(db_with_product)
    body = conn.execute("SELECT wine_body FROM products WHERE id='row-1'").fetchone()[0]
    assert body is None  # unchanged
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
.venv/bin/pytest tests/test_local_router.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 4.3: Implement LocalRouter**

Create `data/lib/enrichment/wine/local_router.py`:

```python
"""SQLite-backed product UPDATE (replaces the Supabase PATCH half of OutputRouter)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path


class LocalRouter:
    def __init__(self, db_path: Path, write_threshold: float = 0.85):
        self.db_path = Path(db_path)
        self.write_threshold = write_threshold

    def update_product(
        self,
        products_id: str,
        response: dict,
        final_confidence: float,
        model: str,
        enrichment_note: str,
        enriched_at: str,
        score_max: float | None = None,
        score_summary: str = "",
    ) -> bool:
        """Returns True if a direct UPDATE happened, False if skipped."""
        if final_confidence < self.write_threshold or not products_id:
            return False

        payload = {
            "wine_body": response.get("wine_body"),
            "wine_acidity": response.get("wine_acidity"),
            "wine_tannin": response.get("wine_tannin"),
            "grape_variety": ", ".join(response.get("grape_variety", [])) or None,
            "grape_blend_type": response.get("grape_blend_type"),
            "wine_production_style": json.dumps(response.get("wine_production_style") or []),
            "flavor_tags": json.dumps(response.get("flavor_tags") or []),
            "food_matching": ", ".join(response.get("food_matching", [])) or None,
            "desc_en_short": response.get("desc_en_short"),
            "full_description": response.get("full_description"),
            "score_max": score_max,
            "score_summary": score_summary or None,
            "enrichment_confidence": round(final_confidence, 3),
            "enrichment_source": "ai_high_conf",
            "enrichment_note": enrichment_note,
            "enriched_at": enriched_at,
            "enriched_by": model,
            "updated_at": enriched_at,
        }
        sets = ", ".join(f"{k}=?" for k in payload.keys())
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                f"UPDATE products SET {sets} WHERE id=?",
                list(payload.values()) + [products_id],
            )
            conn.commit()
        return True
```

- [ ] **Step 4.4: Run tests**

```bash
.venv/bin/pytest tests/test_local_router.py -v
```
Expected: 2/2 PASS.

- [ ] **Step 4.5: Verify the existing test suite still passes**

```bash
.venv/bin/pytest tests/ -v
```
Expected: All 57 prior tests + new ones PASS (no regressions).

- [ ] **Step 4.6: Commit**

```bash
git add data/lib/enrichment/wine/local_router.py tests/test_local_router.py
git commit -m "feat(enrichment): LocalRouter — SQLite UPDATE for high-conf product writes"
```

---

## Task 5: Wire local_store + local_router into enrich_wines.py CLI

**Files:**
- Modify: `data/enrich_wines.py`
- Test: `tests/test_enrich_wines.py` (extend)

- [ ] **Step 5.1: Extend the integration test**

Append to `tests/test_enrich_wines.py` (next to the existing fixtures-based tests):

```python
def test_cli_writes_to_local_sqlite(tmp_path, monkeypatch):
    """CLI with --db should write enriched fields to SQLite, not Supabase."""
    import sqlite3, json, sys
    from pathlib import Path

    REPO_ROOT = Path(__file__).resolve().parent.parent
    SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"

    # Seed a tiny DB with one wine
    db_path = tmp_path / "t.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, name, classification, brand) VALUES (?,?,?,?,?)",
        ("row-test", "WRW_TEST", "Test Wine", "Red Wine", "TestBrand"),
    )
    conn.commit()
    conn.close()

    fixtures = REPO_ROOT / "tests" / "fixtures"
    # Build a 1-SKU products fixture file the CLI can load
    skus_file = tmp_path / "skus.json"
    skus_file.write_text(json.dumps([{
        "id": "row-test", "sku": "WRW_TEST", "name": "Test Wine",
        "classification": "Red Wine", "brand": "TestBrand",
        "country": "France", "region": "Bordeaux",
    }]))

    # Mock Anthropic call (the existing test_enrich_wines.py shows the pattern)
    from data.enrich_wines import main
    monkeypatch.setattr("data.lib.enrichment.shared.client.AnthropicClient.generate",
                        lambda self, system, user, max_tokens=1000, temperature=0.1: _stub_high_conf_response())

    rc = main([
        "--skus-file", str(skus_file),
        "--db", str(db_path),
        "--limit", "1",
        "--no-supabase",
        "--csv-output", str(tmp_path / "out.csv"),
    ])
    assert rc == 0

    conn = sqlite3.connect(db_path)
    body = conn.execute("SELECT wine_body FROM products WHERE id='row-test'").fetchone()[0]
    assert body is not None and body != ""
    # Verify the enrichment_cache row was also written locally
    n = conn.execute("SELECT COUNT(*) FROM enrichment_cache WHERE sku='WRW_TEST'").fetchone()[0]
    assert n == 1


def _stub_high_conf_response():
    """Helper — see existing test_enrich_wines.py for the shape."""
    import json
    from data.lib.enrichment.shared.client import GenerationResult
    payload = {
        "wine_body": "Full-Bodied", "wine_acidity": "Medium", "wine_tannin": "Firm",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "varietal",
        "wine_production_style": [], "flavor_tags": ["dark fruit", "cedar", "tobacco", "spice", "vanilla"],
        "food_matching": ["red meat", "aged cheese", "game"],
        "desc_en_short": "A bold Bordeaux Cab.",
        "full_description": "<p>" + ("X" * 300) + "</p>",
        "confidence": 0.95, "confidence_notes": "rich evidence",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None,
                      "grape_source": "products.grape_variety", "critic_scores": []},
    }
    return GenerationResult(
        text=json.dumps(payload), model="claude-haiku-4-5",
        tokens_in=500, tokens_out=400, cost_usd=0.005, cost_thb=0.175,
    )
```

- [ ] **Step 5.2: Run to verify it fails (CLI doesn't accept --db yet)**

```bash
.venv/bin/pytest tests/test_enrich_wines.py::test_cli_writes_to_local_sqlite -v
```
Expected: FAIL with unrecognized arg `--db`.

- [ ] **Step 5.3: Modify `data/enrich_wines.py`**

Edits needed (showing intent, not full file):

1. **Add `--db` flag**:
   ```python
   p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH,
                  help="Path to local SQLite store (default: data/db/products.db).")
   ```
   Add at top: `DEFAULT_DB_PATH = REPO_ROOT / "data" / "db" / "products.db"`

2. **Add `--also-push-supabase`** flag (default False — transitional safety):
   ```python
   p.add_argument("--also-push-supabase", action="store_true",
                  help="Legacy: also write to Supabase. Default OFF — use sync script instead.")
   ```

3. **Replace cache client construction**:
   ```python
   # Before:
   # cache_client = CacheClient(supabase_url=..., api_key=...) if ... else None
   # After:
   from data.lib.enrichment.shared.local_store import LocalCache, FailureLogger
   cache_client = LocalCache(db_path=args.db) if not args.no_cache else None
   failure_logger = FailureLogger(db_path=args.db)
   ```

4. **Replace product write path** — explicit instructions to avoid double-writes:

   **4a.** Open `data/lib/enrichment/wine/output.py`. In `OutputRouter.route()` (lines 143-162), **remove the Supabase PATCH block** (lines 145-151, the `if final_confidence >= self.write_threshold and products_id:` block that calls `self._write_to_products(...)`). The method should now ONLY write the CSV row. The `_write_to_products` method itself stays in the file but is unused unless `--also-push-supabase` invokes it later — leave it dormant. The method should still return `False` (or change return type to `None`) since there's no Supabase write happening here.

   **4b.** In `data/enrich_wines.py`, add the LocalRouter instantiation alongside the existing OutputRouter:
   ```python
   from data.lib.enrichment.wine.local_router import LocalRouter
   local_router = LocalRouter(db_path=args.db, write_threshold=args.write_threshold)
   ```

   **4c.** Inside the per-SKU loop, BEFORE the existing `router.route(...)` call, invoke the local router:
   ```python
   wrote_local = local_router.update_product(
       products_id=sku_row.get("id", ""),
       response=response, final_confidence=final_conf,
       model=args.model, enrichment_note=f"Haiku/{evidence.quality_tier}",
       enriched_at=enriched_at_iso,
       score_max=score_max, score_summary=score_summary,
   )
   if wrote_local:
       stats["supabase_writes"] += 1  # repurpose this counter to mean "local writes"; rename to "local_writes" in print
   else:
       stats["csv_only"] += 1
   ```

   **4d.** Then call the (now CSV-only) `router.route(...)` as before — it writes the CSV row. **Do NOT increment `stats["supabase_writes"]` based on its return value anymore** (that bookkeeping moves to step 4c above).

   **4e.** If `args.also_push_supabase` is set, after the local write succeeds, additionally call the legacy Supabase PATCH via `OutputRouter._write_to_products(...)` directly. Default is OFF so this path is dormant unless explicitly opted in.

5. **Capture parse failures**:
   ```python
   # Inside the parse-fail except block:
   failure_logger.log(
       sku=sku, failure_type="parse",
       raw_response=gen.text, validation_issues=[str(e)],
       prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
       model=gen.model, tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
       cost_thb=gen.cost_thb,
   )
   ```

6. **Capture validation failures (first attempt and retry)**:
   ```python
   # When `result.outcome == "rejected" and result.can_retry`:
   failure_logger.log(
       sku=sku, failure_type="validation_first",
       raw_response=gen.text, validation_issues=result.issues,
       prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
       model=gen.model, tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
       cost_thb=gen.cost_thb,
   )
   # When retry also fails:
   failure_logger.log(
       sku=sku, failure_type="validation_retry",
       raw_response=gen2.text, validation_issues=result.issues,
       prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
       model=gen2.model, tokens_in=gen2.tokens_in, tokens_out=gen2.tokens_out,
       cost_thb=gen2.cost_thb,
   )
   ```

7. **`--also-push-supabase` path**: only if flag is set, additionally invoke the (existing) Supabase-side `OutputRouter.route()` after the local writes succeed. Default is **OFF**.

- [ ] **Step 5.4: Run new test + full suite**

```bash
.venv/bin/pytest tests/test_enrich_wines.py -v
.venv/bin/pytest tests/ -v
```
Expected: All PASS.

- [ ] **Step 5.5: Smoke test on real data — 1 SKU dry run**

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --limit 1 --dry-run --db data/db/products.db
```
Expected: prints "[dry-run] would call Haiku" for 1 SKU. No API call, no DB change.

- [ ] **Step 5.6: Commit**

```bash
git add data/enrich_wines.py tests/test_enrich_wines.py
git commit -m "feat(enrichment): wire CLI to LocalCache/LocalRouter/FailureLogger; --db flag"
```

---

## Task 6: Sync-to-Supabase script

**Files:**
- Create: `scripts/sync_to_supabase.py`
- Test: `tests/test_sync_to_supabase.py`

- [ ] **Step 6.1: Write the failing test**

Create `tests/test_sync_to_supabase.py`:

```python
"""Tests for the local SQLite → Supabase sync script.

Uses a mocked Supabase HTTP client (urllib.request.urlopen monkeypatch) so
no network call leaves the test.
"""
import json
import sqlite3
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from scripts.sync_to_supabase import (
    plan_product_deltas,
    plan_cache_deltas,
    sync_products,
    sync_cache,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"


@pytest.fixture
def db_with_updates(tmp_path):
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, classification, wine_body, enrichment_confidence, enriched_at, updated_at) "
        "VALUES ('row-1','WRW1','Red Wine','Full-Bodied',0.9,'2026-05-21T10:00:00Z','2026-05-21T10:00:00Z')"
    )
    conn.execute(
        "INSERT INTO enrichment_cache (id, sku, category, prompt_hash, evidence_hash, prompt_text, "
        "response_json, model, tokens_in, tokens_out, cost_thb, confidence, validation_status, validation_issues, created_at) "
        "VALUES ('uuid-1','WRW1','wine','ph','eh','p','{}','m',1,1,0.1,0.9,'passed','[]','2026-05-21T10:00:00Z')"
    )
    conn.commit()
    conn.close()
    return db


def test_plan_product_deltas_finds_new_enriched_rows(db_with_updates):
    deltas = plan_product_deltas(db_with_updates, since=None)
    assert len(deltas) == 1
    assert deltas[0]["sku"] == "WRW1"


def test_plan_cache_deltas_finds_new_rows(db_with_updates):
    deltas = plan_cache_deltas(db_with_updates, since=None)
    assert len(deltas) == 1


def test_sync_products_idempotent(db_with_updates):
    """Second sync run should find 0 deltas."""
    mock_resp = MagicMock()
    mock_resp.__enter__.return_value.read.return_value = b'[]'
    with patch("urllib.request.urlopen", return_value=mock_resp) as m:
        n1 = sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=False)
        n2 = sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=False)
    assert n1 == 1
    assert n2 == 0


def test_dry_run_does_not_call_supabase(db_with_updates):
    with patch("urllib.request.urlopen") as m:
        sync_products(db_with_updates, supabase_url="https://x", api_key="k", dry_run=True)
    m.assert_not_called()
```

- [ ] **Step 6.2: Run to verify it fails**

```bash
.venv/bin/pytest tests/test_sync_to_supabase.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 6.3: Implement the sync script**

Create `scripts/sync_to_supabase.py`:

```python
#!/usr/bin/env python3
"""Push local SQLite changes to Supabase. Idempotent.

Strategy:
- For `products`: SELECT rows where updated_at > sync_state.last_synced_at,
  PATCH each row to Supabase by id, advance sync_state.
- For `enrichment_cache`: SELECT rows where created_at > sync_state.last_synced_at,
  UPSERT to Supabase, advance sync_state.

Failures are non-fatal per-row; the script keeps going and reports a count.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

PRODUCT_SYNC_COLUMNS = [
    "wine_body", "wine_acidity", "wine_tannin",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "flavor_tags", "food_matching",
    "desc_en_short", "full_description",
    "score_max", "score_summary",
    "enrichment_confidence", "enrichment_source", "enrichment_note",
    "enriched_at", "enriched_by", "updated_at",
]


def _get_sync_state(conn: sqlite3.Connection, table: str) -> str | None:
    row = conn.execute(
        "SELECT last_synced_at FROM sync_state WHERE table_name=?", (table,)
    ).fetchone()
    return row[0] if row else None


def _set_sync_state(conn: sqlite3.Connection, table: str, ts: str) -> None:
    conn.execute(
        "INSERT INTO sync_state (table_name, last_synced_at) VALUES (?,?) "
        "ON CONFLICT(table_name) DO UPDATE SET last_synced_at=excluded.last_synced_at",
        (table, ts),
    )
    conn.commit()


def plan_product_deltas(db_path: Path, since: str | None) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "WHERE enrichment_confidence IS NOT NULL"
    params: list = []
    if since:
        where += " AND updated_at > ?"
        params.append(since)
    rows = conn.execute(
        f"SELECT id, sku, {', '.join(PRODUCT_SYNC_COLUMNS)} FROM products {where}",
        params,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        # wine_production_style and flavor_tags are JSON-encoded; decode for Supabase array/JSON columns
        if d.get("wine_production_style"):
            d["wine_production_style"] = json.loads(d["wine_production_style"])
        out.append(d)
    return out


def plan_cache_deltas(db_path: Path, since: str | None) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "WHERE 1=1"
    params: list = []
    if since:
        where += " AND created_at > ?"
        params.append(since)
    rows = conn.execute(
        f"SELECT * FROM enrichment_cache {where}", params
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _patch_product(supabase_url: str, api_key: str, row: dict) -> None:
    pid = row.pop("id")
    row.pop("sku", None)
    url = f"{supabase_url.rstrip('/')}/rest/v1/products?id=eq.{urllib.parse.quote(pid)}"
    body = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": api_key, "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json", "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30):
        pass


def _upsert_cache(supabase_url: str, api_key: str, row: dict) -> None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/enrichment_cache"
    # Decode JSON columns to dicts/lists for Supabase jsonb columns
    if isinstance(row.get("response_json"), str):
        row["response_json"] = json.loads(row["response_json"])
    if isinstance(row.get("validation_issues"), str):
        row["validation_issues"] = json.loads(row["validation_issues"])
    body = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": api_key, "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30):
        pass


def sync_products(db_path: Path, supabase_url: str, api_key: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path)
    since = _get_sync_state(conn, "products")
    conn.close()
    deltas = plan_product_deltas(db_path, since=since)
    if dry_run:
        print(f"[dry-run] {len(deltas)} product deltas")
        return len(deltas)
    count = 0
    latest_ts = since
    for d in deltas:
        ts = d.get("updated_at")
        try:
            _patch_product(supabase_url, api_key, dict(d))
            count += 1
            if ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
        except Exception as e:
            print(f"WARN: product {d.get('sku')} sync failed: {e}", file=sys.stderr)
    if latest_ts:
        conn = sqlite3.connect(db_path)
        _set_sync_state(conn, "products", latest_ts)
        conn.close()
    return count


def sync_cache(db_path: Path, supabase_url: str, api_key: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path)
    since = _get_sync_state(conn, "enrichment_cache")
    conn.close()
    deltas = plan_cache_deltas(db_path, since=since)
    if dry_run:
        print(f"[dry-run] {len(deltas)} cache deltas")
        return len(deltas)
    count = 0
    latest_ts = since
    for d in deltas:
        ts = d.get("created_at")
        try:
            _upsert_cache(supabase_url, api_key, dict(d))
            count += 1
            if ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
        except Exception as e:
            print(f"WARN: cache {d.get('id')} sync failed: {e}", file=sys.stderr)
    if latest_ts:
        conn = sqlite3.connect(db_path)
        _set_sync_state(conn, "enrichment_cache", latest_ts)
        conn.close()
    return count


def _load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Push local SQLite changes to Supabase.")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--products-only", action="store_true")
    p.add_argument("--cache-only", action="store_true")
    args = p.parse_args(argv)

    env = _load_env(REPO_ROOT / ".env.local")
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    api_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase_url or not api_key:
        print("ERROR: Supabase env missing.", file=sys.stderr)
        return 1

    n_prod = n_cache = 0
    if not args.cache_only:
        n_prod = sync_products(args.db, supabase_url, api_key, dry_run=args.dry_run)
    if not args.products_only:
        n_cache = sync_cache(args.db, supabase_url, api_key, dry_run=args.dry_run)
    print(f"products synced: {n_prod}  cache synced: {n_cache}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6.4: Run tests**

```bash
.venv/bin/pytest tests/test_sync_to_supabase.py -v
```
Expected: 4/4 PASS.

- [ ] **Step 6.5: Commit**

```bash
git add scripts/sync_to_supabase.py tests/test_sync_to_supabase.py
git commit -m "feat(enrichment): idempotent local→Supabase sync script with dry-run + resume"
```

---

## Task 7: 10-SKU smoke test on the new architecture (REAL API CALL — ~$0.05)

**Files:** none changed; this is an integration verification.

- [ ] **Step 7.1: Seed the real local DB**

```bash
.venv/bin/python scripts/seed_sqlite_from_json.py
sqlite3 data/db/products.db "SELECT COUNT(*) FROM products"
```
Expected: ~11,436 rows.

- [ ] **Step 7.2: Run a 10-SKU Tier-1 batch**

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --limit 10 --priority popularity 2>&1 | tee data/exports/enrich-smoke-task7.log
```

- [ ] **Step 7.3: Verify SQLite state**

```bash
sqlite3 data/db/products.db "SELECT COUNT(*) FROM enrichment_cache"
sqlite3 data/db/products.db "SELECT COUNT(*) FROM enrichment_failures"
sqlite3 data/db/products.db "SELECT sku, failure_type, length(raw_response) FROM enrichment_failures LIMIT 5"
sqlite3 data/db/products.db "SELECT sku, enrichment_confidence FROM products WHERE enrichment_confidence IS NOT NULL LIMIT 5"
```
Expected: `enrichment_cache` has rows ≤10 (only successes); `enrichment_failures` captures all the validation rejects we saw this morning; some `products` rows have populated `enrichment_confidence`.

- [ ] **Step 7.4: Verify idempotency — re-run identical batch**

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --limit 10 --priority popularity 2>&1 | tail -20
```
Expected summary: `Cache hits: 10`, `API calls: 0`, `Cost: THB 0.00`.

- [ ] **Step 7.5: Verify sync dry-run**

```bash
.venv/bin/python scripts/sync_to_supabase.py --dry-run
```
Expected: prints "[dry-run] N product deltas" + "[dry-run] M cache deltas" where N+M > 0.

- [ ] **Step 7.6: Commit the smoke-test log**

```bash
git add data/exports/enrich-smoke-task7.log
git commit -m "test(enrichment): 10-SKU smoke test on local-first architecture"
```

---

## Task 8: Diagnose 52% validation-failure rate (now with local capture)

**Files:** read-only investigation; no code changes in this task unless the diagnosis warrants them.

- [ ] **Step 8.1: Inspect failure distribution**

```bash
sqlite3 data/db/products.db "SELECT failure_type, COUNT(*) FROM enrichment_failures GROUP BY failure_type"
sqlite3 data/db/products.db "SELECT sku, failure_type, substr(raw_response, 1, 500) AS preview, validation_issues FROM enrichment_failures LIMIT 10"
```

- [ ] **Step 8.2: Categorize the failures**

For each of the ~10 failures, classify into:
- (a) Haiku returning extra prose before/after JSON (parse failures)
- (b) Vocab/length violations the validator can't repair
- (c) Wrong food-matching labels (taxonomy drift)
- (d) Schema-incomplete responses (missing required fields)

- [ ] **Step 8.3: Decide remediation**

Based on the categorization, propose ONE of:
- Tighten the prompt's "JSON only, no preamble" instruction.
- Loosen the validator's strictest rules (e.g., flavor_tags 5-10 → 4-12).
- Add an extracted-JSON pre-parser that handles wrapped responses.

Write the proposal as a follow-up spec at `docs/superpowers/specs/2026-05-21-enrichment-failure-remediation.md`. **Do not implement the fix in this plan — that's a separate plan after we agree on the approach.**

---

## Pre-flight checklist before scaling

After all 8 tasks complete, before running full Tier 1 (~1,708 SKUs, ~$17.50):

- [ ] All 57+ tests still pass: `.venv/bin/pytest tests/ -v`
- [ ] `data/db/products.db` exists, ~11,436 rows
- [ ] Smoke test cache-hit rate is 100% on re-run
- [ ] `sync_to_supabase.py --dry-run` produces sensible deltas
- [ ] Failure remediation spec exists and is reviewed

Then, the actual full-tier runs (NOT part of this plan, they're separate operational steps):

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --limit 1708 --priority popularity
.venv/bin/python scripts/sync_to_supabase.py
# review
.venv/bin/python data/enrich_wines.py --tier 2 --limit 3382 --priority popularity
.venv/bin/python scripts/sync_to_supabase.py
```

---

## Notes on TDD discipline

- Each task starts with the failing test (Step .1 always).
- Each task ends with a commit (last step always).
- Run `.venv/bin/pytest tests/` after every task to catch regressions early.
- No task is "done" until its dedicated tests pass AND the full suite still passes.

## Notes on cost

- Tasks 1–6 = $0 (no API calls, mocked tests only).
- Task 7 = ~$0.05 (10 real API calls on Haiku 4.5).
- Total plan execution = ~$0.05, ~3 hours of focused work.
- This plan pays for itself the first time we re-run a failed Tier batch (saves the ~$8 we'd otherwise lose).
