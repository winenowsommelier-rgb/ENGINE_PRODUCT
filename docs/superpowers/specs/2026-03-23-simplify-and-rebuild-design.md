# WineNow PIM — Simplify & Rebuild Design
**Date:** 2026-03-23
**Status:** Approved

---

## Context

The app is a Next.js 14 PIM (Product Information Management) for wine and spirits products. It is still in active development. Over 10,000 SKUs have already been batch-processed into a local SQLite database. The codebase has accumulated significant duplication and structural messiness from iterative development.

The goal is to consolidate the duplicates, fix broken code, and build the remaining workflow features on a clean foundation — without touching the existing data.

---

## Approach: Consolidate then Build (Option C)

Fix the existing mess first, then build new features on the clean base. No data migration required.

---

## Section 1 — Cleanup

### What gets deleted
- `lib/batch-pipeline.ts` — superseded by `lib/batch-processor.ts` which has the richer data model (confidence, flavor notes, SQLite integration). All dashboard references updated to use `batch-processor.ts`.
- `preview/` folder — static duplicate of the Next.js app, will always drift from reality.
- Merge conflict markers in `README.md` — resolve by keeping the correct content.

### What gets fixed
- `lib/supabase/client.ts` — has a duplicate `return` block at lines 130–146 creating unreachable code. Delete the dead block.

### Taxonomy consolidation
Four taxonomy files (`lib/taxonomy.ts`, `lib/taxonomy-mappings.ts`, `lib/taxonomy-service.ts`, `lib/taxonomy-loader.ts`) get merged into two:
- `lib/taxonomy/maps.ts` — raw data lookups built from `data/taxonomy/*.json` files
- `lib/taxonomy/service.ts` — normalization and suggestion logic

All existing imports updated to point to the new paths.

### What stays untouched
- `lib/db/client.ts` (SQLite — contains the 10K SKUs)
- `lib/supabase/config.ts`
- All `data/taxonomy/*.json` files
- All existing API routes (updated imports only)

---

## Section 2 — App Structure & Navigation

### Problem
`components/dashboard.tsx` is a single 24K-token component handling all pages, all state, all logic. It is unmaintainable.

### Solution
Split into focused page components. The dashboard shrinks to a shell (sidebar + routing only).

### New navigation

| Nav item | Step | Purpose |
|---|---|---|
| Import | 1–2 | Upload CSV → batch process → save to SQLite |
| Processing Review | 3–4 | Review batch results, approve/reject rows |
| Taxonomy Queue | 5 | Ranked taxonomy validation queue |
| Products | 6 | Browse, edit, view changelog |
| Override Import | 7 | Batch hard-code import with notes |
| Settings | — | Supabase sync config |

**Removed:** Data Hub, Data Catalog, Overview, Taxonomy editor (useful parts folded into Import and Products).

### Component structure
```
components/
  dashboard.tsx          — shell only: sidebar + page routing
  pages/
    ImportPage.tsx
    ProcessingReviewPage.tsx
    TaxonomyQueuePage.tsx
    ProductsPage.tsx
    OverrideImportPage.tsx
    SettingsPage.tsx
```

---

## Section 3 — Taxonomy Queue (Step 5)

### Purpose
After batch processing, products sit in a ranked queue waiting for detailed taxonomy assignment. The queue surfaces the highest-value items first so operators work efficiently.

### Ranking criteria (priority order)
1. High confidence score (already well-validated data rises to top)
2. Items with sales order or note data attached
3. Reputable/commercial items (well-known brands)
4. Premium items (high price tag)
5. Popularity (brand recognition/search signal)

The ranking score is computed on queue load, stored as `queue_priority` integer in SQLite, and the list sorts descending.

### Page features
- Paginated table sorted by priority score
- Per-row: SKU, name, current taxonomy fields, confidence, priority score, status badge
- "Validate" button per row → side panel with all taxonomy fields editable, dropdown-driven from taxonomy JSON files
- "Batch validate top N" button → auto-validates top N high-confidence rows at a configurable threshold
- Filter by status: `unvalidated` / `in_review` / `validated`

### Data flow
- Reads: SQLite `cleaned_products`
- Writes: taxonomy fields + `validation_status = 'validated'` back to SQLite
- Side effect: every save writes a `product_changelog` entry with `source = 'taxonomy_queue'`

---

## Section 4 — Product Browser with Changelog (Step 6)

### Browse view
- Paginated table with search (name, SKU) and filters (category, country, status, validation status)
- Columns: SKU, name, category, region, country, price, confidence, validation status
- Click any row → opens detail panel

### Detail panel
- All product fields displayed and inline-editable
- Save → writes to SQLite + creates changelog entry
- **Changelog tab** — full history of all changes to this product:
  - Timestamp
  - Source (`batch_process` | `taxonomy_queue` | `manual_edit` | `override_import`)
  - Field, old value → new value
  - Optional user note (for manual edits)

### New SQLite table
```sql
product_changelog (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  sku         TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  source      TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  note        TEXT
)
```

All automated processes (batch normalization, taxonomy validation, override import) write to this table so every product has a full audit trail from first import.

---

## Section 5 — Override Import (Step 7)

### Purpose
Hard-code import a CSV to override existing database records in batch. Used when corrections are made outside the app (e.g. supplier data, manual spreadsheet fixes).

### Flow
1. Upload CSV → preview a diff table: per row, per field — old value → new value
2. Enter a required **batch note** describing why this override is happening (e.g. "Manual price corrections from supplier sheet 2024-03")
3. Confirm → write to SQLite, create `product_changelog` entries for every changed field with `source = 'override_import'` and the batch note attached
4. Summary screen: rows updated / rows skipped (no SKU match) / conflicts

### Rules
- Matches on SKU — unmatched rows are skipped and shown in summary
- Only fields present in the CSV are overwritten — blank cells do not clear existing data
- Batch note is stored on every changelog entry from that import run (filterable later)

### New SQLite table
```sql
override_batches (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  source_file  TEXT NOT NULL,
  note         TEXT NOT NULL,
  rows_updated INTEGER,
  rows_skipped INTEGER
)
```

---

## Data Layer Summary

| Layer | Role |
|---|---|
| SQLite (`lib/db/client.ts`) | Working database — all processing, editing, changelog |
| Supabase | Final sync target — push validated products when ready |
| `data/taxonomy/*.json` | Read-only taxonomy reference data |

SQLite is the source of truth during development. Supabase sync is a one-way push from the Settings page.

---

## Error Handling
- All API routes return structured `{ error, message }` on failure
- UI shows inline error states — no silent failures
- Failed override import rows are listed in the summary, never silently skipped

---

## Out of Scope
- Authentication / user accounts
- Real-time collaboration
- Supabase as primary database (deferred — SQLite first)
- Scraping pipeline (exists in codebase, not modified)
