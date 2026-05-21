# Local-First SQLite Enrichment — Design Spec

**Date:** 2026-05-21
**Author:** brainstorm with @winenowsommelier
**Status:** Approved (verbally), ready for plan

## Problem

The wine enrichment pipeline (built 2026-05-12, see `2026-05-12-wine-enrichment-design.md`) couples **two unrelated jobs** to Supabase:

1. **Source of truth** for products (replicated from `data/db/products.json`)
2. **Cache + write target** for AI enrichment (`enrichment_cache` table + `products` PATCH writes ≥0.85 confidence)

Consequences observed in the 50-SKU Tier 1 validation batch (2026-05-21):

- **52% validation failures** (26/50 rejected twice). The raw responses are **never written anywhere** — neither CSV nor `enrichment_cache` — so we can't diagnose root causes without burning more API calls.
- **0 direct writes** to `products`. All 24 valid responses scored < 0.85 final confidence, so the catalog wasn't actually updated.
- **2.4× projected cost** because of the retry path. Actual THB 0.36/SKU vs projected 0.15.
- Hard Supabase coupling — if Supabase is flaky or pruned (as happened 2026-05-19), the pipeline stalls and we have no local recovery path.

## Goal

Make local SQLite the **primary write target** for enrichment. Push to Supabase (or any other remote target) as a **separate, idempotent, retryable** step decoupled from enrichment.

**Non-goals:**
- Replace Supabase as the long-term remote of record. Supabase still backs the live `/api/explore/*` endpoints.
- Change the AI prompt, validator, or scoring logic. (Those are addressed in a separate diagnostic task after this migration ships.)

## Architecture

```
┌──────────────────────────┐
│ Enrichment CLI           │
│ data/enrich_wines.py     │
└────────────┬─────────────┘
             │ writes (transactional)
             ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│  data/db/products.db     │ ◄─────► │  Supabase (remote)       │
│  ───────────────────────  │  sync   │  ───────────────────────  │
│  products                │ ─────►  │  products                │
│  enrichment_cache        │ ─────►  │  enrichment_cache        │
│  enrichment_failures*    │   (no   │  (no failures table —    │
│  critic_scores           │  push)  │   local-only diagnostic) │
└──────────────────────────┘         └──────────────────────────┘
   *new — captures every parse + validation failure
```

**Sync is one-way push (local → Supabase).** Reading back from Supabase is out of scope. If something is wrong remotely we'll rebuild it from local.

## Why SQLite (not DuckDB / Postgres / JSON)

| Requirement | SQLite | DuckDB | JSON (today) |
|---|---|---|---|
| Per-row UPDATE (enrichment is one SKU at a time) | Native, transactional | Tolerated | Full-file rewrite, race-prone |
| Schema matches Supabase Postgres 1:1 | Same DDL with minor type tweaks | Mostly | No schema |
| Built into Python stdlib (`sqlite3`) | Yes | Needs `pip install duckdb` | — |
| Single-file backup / version | `products.db` | `.duckdb` | products.json |
| Foreign keys + indexes | Yes | Yes | No |
| ACID | Yes | Yes | No |

The wine catalog is ~6,400 rows. Even DuckDB is overkill; SQLite is the natural fit for OLTP-style row UPDATEs.

## Schema design

Mirror the [2026-05-19_fresh_project_schema.sql](../../../data/migrations/2026-05-19_fresh_project_schema.sql) Postgres DDL to SQLite with these mechanical changes:

| Postgres | SQLite equivalent |
|---|---|
| `text` | `TEXT` |
| `integer` | `INTEGER` |
| `numeric` / `numeric(n,m)` | `REAL` |
| `timestamptz` | `TEXT` (ISO 8601 UTC) |
| `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | `TEXT PRIMARY KEY` (Python-side UUID) |
| `jsonb` | `TEXT` (JSON string) |
| `text[]` | `TEXT` (JSON-encoded list) |
| `USING gin (...)` index | drop (no GIN in SQLite) |
| `DEFAULT now()` | `DEFAULT CURRENT_TIMESTAMP` |

Add one new table not in Supabase:

```sql
CREATE TABLE enrichment_failures (
  id            TEXT PRIMARY KEY,          -- UUID
  sku           TEXT NOT NULL,
  failure_type  TEXT NOT NULL,             -- 'parse' | 'validation_first' | 'validation_retry'
  raw_response  TEXT,                      -- full Haiku text (may be malformed)
  validation_issues TEXT,                  -- JSON-encoded list[str]
  prompt_hash   TEXT,
  evidence_hash TEXT,
  model         TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost_thb      REAL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enrichment_failures_sku ON enrichment_failures (sku);
CREATE INDEX idx_enrichment_failures_type ON enrichment_failures (failure_type);
```

This solves the "we can't diagnose" problem directly.

## Pipeline changes

### `data/enrich_wines.py`
- New flag: `--db PATH` (default `data/db/products.db`)
- Replace `CacheClient` (Supabase HTTP) with `LocalCache` (SQLite)
- Replace `OutputRouter` Supabase PATCH with `LocalRouter.update_product()` (SQLite UPDATE)
- Both old paths gated behind a new `--also-push-supabase` flag for transitional safety. Default OFF — Supabase sync happens via the separate script.
- On every parse/validation failure: write a row to `enrichment_failures` table.

### New: `data/lib/enrichment/shared/local_store.py`
Replacement for `cache.py`. Same `CacheClient` interface (`lookup`, `write`) but backed by SQLite. Plus new `FailureLogger` class.

### New: `data/lib/enrichment/wine/local_router.py`
Replacement for the Supabase write half of `output.py`. CSV writing stays identical.

### New: `scripts/sync_to_supabase.py`
Push `products` updates + `enrichment_cache` rows to Supabase. Idempotent:
- For `products`: PATCH by `id`, comparing `updated_at` to skip unchanged rows.
- For `enrichment_cache`: UPSERT on `(sku, prompt_hash, evidence_hash) WHERE superseded_at IS NULL`.
- Dry-run mode prints planned changes without sending.
- Resumable: tracks `last_synced_at` in a tiny `sync_state` table.

### New: `scripts/seed_sqlite_from_json.py`
One-shot bootstrap: read `data/db/products.json` (~11,436 rows; ~6,375 wines), populate the `products` table in `data/db/products.db`. Run once before first enrichment on new architecture. Winesensed records and the brand library remain as their own JSON/CSV files that the enrichment pipeline reads directly — they're not loaded into SQLite (they're evidence sources, not OLTP data).

## Migration & rollback

- Local DB is gitignored; the JSON seed and Supabase remain authoritative until sync runs cleanly twice.
- To roll back: `rm data/db/products.db`, revert pipeline flag default to `--no-local` (will be added as compatibility shim).
- The 50-SKU validation batch from this morning stays in CSV at `data/exports/wine-enrichment-2026-05-21T033633Z.csv`. No data loss.

## Success criteria

1. `data/db/products.db` exists with 6,375 product rows + same column count as the SQL schema.
2. `data/enrich_wines.py --tier 1 --limit 10` writes to SQLite only, captures any failures in `enrichment_failures`.
3. `scripts/sync_to_supabase.py --dry-run` shows pending changes; without `--dry-run` pushes them. Re-running is a no-op.
4. All existing 57 unit + integration tests still pass.
5. New tests cover the SQLite path (cache R/W, router UPDATE, failure capture, sync deltas).
6. Re-running the 50-SKU validation batch on the new architecture is **idempotent** — second run has 0 API calls and 0 SQLite writes.

## Out of scope (deferred)

- Fixing the 52% validation-failure rate. We now CAPTURE failures locally; diagnosis is a separate task that uses the captured data.
- Lowering the 0.85 write threshold. Same — separate decision after we see what the failures look like.
- DuckDB analytics layer (e.g., for explore-side queries). Possible future enhancement.
