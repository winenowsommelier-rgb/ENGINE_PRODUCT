# WineNow PIM — Simplify & Rebuild Design
**Date:** 2026-03-23
**Status:** Approved

---

## Context

The app is a Next.js 14 PIM (Product Information Management) for wine and spirits products. It is still in active development. Over 10,000 SKUs have already been batch-processed into a local SQLite database. The codebase has accumulated significant duplication and structural messiness from iterative development.

The goal is to consolidate the duplicates, fix broken code, and build the remaining workflow features on a clean foundation — without touching the existing data.

---

## Approach: Consolidate then Build (Option C)

Fix the existing mess first, then build new features on the clean base. Schema additions (new tables, new columns) are made to the existing SQLite database.

---

## Section 1 — Cleanup

### Verification before deletion
Before deleting `lib/batch-pipeline.ts`, grep all files for imports of that module to confirm no callers remain. Before deleting `preview/`, confirm nothing in `package.json` or any script references it.

### What gets deleted
- `lib/batch-pipeline.ts` — superseded by `lib/batch-processor.ts` which has the richer data model. All dashboard references updated to `batch-processor.ts`.
- `preview/` folder — static duplicate of the Next.js app.
- Merge conflict markers in `README.md` — resolve by keeping the current working content.

### What gets fixed
- `lib/supabase/client.ts` — duplicate `return` block at lines 130–146 is dead code. Delete lines 130–146; keep only the first return statement.

### Taxonomy consolidation
Four taxonomy files (`lib/taxonomy.ts`, `lib/taxonomy-mappings.ts`, `lib/taxonomy-service.ts`, `lib/taxonomy-loader.ts`) merged into two:
- `lib/taxonomy/maps.ts` — raw data lookups from `data/taxonomy/*.json` (country map, region map, grape aliases, style aliases)
- `lib/taxonomy/service.ts` — normalization, suggestion, and scoring logic

All imports updated to the new paths. Run `npm run typecheck` after to confirm no broken imports.

### What stays untouched
- `lib/db/client.ts` wrapper code (schema additions are appended, existing logic untouched)
- `lib/supabase/config.ts`
- All `data/taxonomy/*.json` files
- All existing API routes (import paths updated only)

---

## Section 2 — App Structure & Navigation

### Problem
`components/dashboard.tsx` is a single ~24K-token component doing everything. It is unmaintainable.

### Solution
Split into focused page components. Dashboard shrinks to sidebar + routing shell.

**Migration strategy:** Migrate one page at a time. The dashboard shell imports old inline sections until each is replaced by a dedicated page component. A section is done when it is extracted into its own file, the old inline code is deleted from dashboard.tsx, and typecheck passes. All six sections must be migrated before the task is complete.

### New navigation

| Nav item | Step | Purpose |
|---|---|---|
| Import | 1–2 | Upload CSV → batch process → save to SQLite |
| Processing Review | 3–4 | Review batch results, approve/reject rows |
| Taxonomy Queue | 5 | Ranked taxonomy validation queue |
| Products | 6 | Browse, edit, view changelog |
| Override Import | 7 | Batch hard-code import with notes |
| Settings | — | Supabase sync + brand list config |

**Removed:** Data Hub, Data Catalog, Overview, Taxonomy editor.

### Component structure
```
components/
  dashboard.tsx          — shell: sidebar + page routing only
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
After batch processing, products sit in a ranked queue for detailed taxonomy assignment. High-priority items surface first. High-confidence items rank first because they are easiest to auto-validate in batch, clearing the easy work so operators can focus on problem rows.

### Ranking formula
`queue_priority` is a sum of weighted signals (0–100 scale), computed per row, stored in `cleaned_products.queue_priority` (INTEGER):

| Signal | Max points | How determined |
|---|---|---|
| Confidence score | 0–40 | `CAST(confidence AS REAL) * 8` (confidence is 0–5 REAL) |
| Has notes or is in stock | 20 | Combined single signal: 20pts if `notes` non-empty **OR** `is_in_stock = 1`; cannot exceed 20pts regardless of how many qualifiers match |
| Reputable brand | 20 | Product name contains a string from the brand list (case-insensitive substring match) |
| Premium price | 0–10 | `price >= 1000` → 5pts; `price >= 3000` → 10pts (prices in THB) |
| Popularity bonus | 0–10 | Defaults to 0 (reserved for future signal) |

Max possible score: 100.

**Performance:** Do not recompute all 10K rows on every page load. Recompute only rows where `queue_priority IS NULL OR queue_priority = 0`. On first load after migration this computes all rows once. Subsequently, new imports arrive with `queue_priority = 0` and get computed on next load. This keeps load times acceptable.

**Brand list:** Stored in a new SQLite table `brand_list (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`. Managed from the Settings page. Brand matching is a case-insensitive `LIKE '%name%'` on `cleaned_products.name`.

### Batch validate top N
- Default N = 50, configurable via number input on the Taxonomy Queue page (session-only, not persisted)
- Eligibility filter applied first: only rows where `CAST(confidence AS REAL) >= 4.0` qualify
- Then take the top N of those eligible rows by `queue_priority DESC`
- Action: sets `validation_status = 'validated'`, writes one `product_changelog` entry per field that was changed
- Triggered server-side: client sends `POST /api/taxonomy-queue/validate` with body `{ batchMode: true, n: number }` — the server selects and processes the top N eligible rows without the client pre-fetching IDs

### Taxonomy validation side panel
Editable fields (taxonomy-specific only; price/cost/SKU/name are edited in Products browser):

| Field | Input type | Source |
|---|---|---|
| `country` | Dropdown | `countries.json` |
| `region` | Dropdown filtered by country | `regions.json` |
| `subregion` | Text input with autocomplete | `subregions.json` (file confirmed present at `data/taxonomy/subregions.json`) |
| `origin` | Text input | Free text |
| `classification` | Dropdown | `classification_master.json` |
| `grape_variety` | Dropdown | `ingredient_master.json` |
| `wine_type` | Dropdown, shown when `mainCategory = 'wine'` | Options: Red Wine, White Wine, Rosé, Sparkling, Dessert |
| `liquor_main_type` | Dropdown, shown when `mainCategory != 'wine'` | Options: Whisky, Rum, Tequila, Gin, Vodka, Brandy, Other |
| `flavor_profile` | Multi-select | `flavor_note_master.json` |

`wine_type` and `liquor_main_type` are mutually exclusive — only the one matching `mainCategory` is shown. Both fields are never shown at the same time.

### Validation status lifecycle
`validation_status` TEXT column on `cleaned_products`:
- `'unvalidated'` — default for all existing and new rows
- `'in_review'` — **UI-only local state**; never written to the database. The queue table shows a visual indicator when a row's side panel is open in the current session, but no DB write occurs on panel open. This avoids spurious changelog entries and extra round-trips.
- `'validated'` — set on save (manual or batch); this is the only transition that writes to the DB

### Data flow
- Reads: SQLite `cleaned_products`, paginated 50 rows/page
- Writes: taxonomy fields + `validation_status` to `cleaned_products`; `product_changelog` entry per changed field on save

---

## Section 4 — Product Browser with Changelog (Step 6)

### Browse view
- Paginated table (50 rows/page) with search (name, SKU) and filters (category, country, validation_status)
- Columns: SKU, name, category, region, country, price, confidence, validation status
- Click any row → opens detail panel

### Detail panel
- All product fields inline-editable (including price, cost, name — unlike taxonomy panel)
- Optional note field shown on save dialog (anonymous; stored as-is)
- Save → writes to SQLite + creates changelog entry with `source = 'manual_edit'`
- **Changelog tab** — full history of all changes to this product:
  - Timestamp (ISO 8601, displayed in local time)
  - Source (`batch_process` | `taxonomy_queue` | `manual_edit` | `override_import`)
  - Field, old value → new value
  - Note (if present)

### Batch process changelog
The initial batch processing step (`batch-processor.ts`) is updated to write `product_changelog` entries with `source = 'batch_process'` for every field it normalizes. This ensures changelog history is complete from first import. This is a required update to `batch-processor.ts`.

### New SQLite table
```sql
CREATE TABLE IF NOT EXISTS product_changelog (
  id          TEXT PRIMARY KEY,      -- crypto.randomUUID()
  product_id  TEXT NOT NULL,         -- value of cleaned_products.id (the existing primary key)
  sku         TEXT NOT NULL,
  changed_at  TEXT NOT NULL,         -- ISO 8601, e.g. "2026-03-23T14:30:00.000Z"
  source      TEXT NOT NULL,         -- batch_process | taxonomy_queue | manual_edit | override_import
  field       TEXT NOT NULL,
  old_value   TEXT,                  -- NULL if field was previously empty
  new_value   TEXT,                  -- NULL if field was cleared
  note        TEXT                   -- NULL except for manual_edit and override_import
)
```

`product_id` references the value of the `id` column already on `cleaned_products`. No new primary key is added to that table.

---

## Section 5 — Override Import (Step 7)

### Purpose
Hard-code import a CSV to override existing database records in batch. Used when corrections are made outside the app.

### CSV format
- Must have a header row
- Must contain a `sku` column (case-insensitive; also accepts `product_sku`)
- Any other column header matching a `cleaned_products` field name (case-insensitive) is treated as an override for that field
- Unknown headers are listed in the preview as ignored columns
- Encoding: UTF-8; delimiter: comma only
- Parsing reuses the existing `parseCsvText` function from `lib/taxonomy/maps.ts` (moved from `lib/taxonomy-mappings.ts`)

### Flow
1. Upload CSV → preview shows: matched rows with diff (old → new per field), unmatched SKUs, ignored columns
2. Enter required **batch note** (non-empty; Confirm button disabled until filled)
3. Confirm → write to SQLite; create `product_changelog` entries per changed field with `source = 'override_import'` and note attached; create one `override_batches` row
4. Summary: rows updated, rows skipped (informational — not an error state)

### Blank cell rule
- Column present in CSV with empty value → no change to that field
- Column absent from CSV → no change to that field

### New SQLite tables
```sql
CREATE TABLE IF NOT EXISTS override_batches (
  id           TEXT PRIMARY KEY,     -- crypto.randomUUID()
  created_at   TEXT NOT NULL,        -- ISO 8601
  source_file  TEXT NOT NULL,
  note         TEXT NOT NULL,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brand_list (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
```

---

## SQLite Schema Additions

Applied via `lib/db/client.ts` initialization. SQLite's `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is not available before SQLite 3.37.0. Use a try/catch pattern instead:

```ts
try { db.exec(`ALTER TABLE cleaned_products ADD COLUMN validation_status TEXT DEFAULT 'unvalidated'`) } catch {}
try { db.exec(`ALTER TABLE cleaned_products ADD COLUMN queue_priority INTEGER DEFAULT 0`) } catch {}
```

| Change | Type | Default for existing rows |
|---|---|---|
| `cleaned_products.validation_status` | TEXT | `'unvalidated'` |
| `cleaned_products.queue_priority` | INTEGER | `0` |
| New table: `product_changelog` | — | Empty |
| New table: `override_batches` | — | Empty |
| New table: `brand_list` | — | Empty |

---

## API Routes (New)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/taxonomy-queue` | Products ranked by queue_priority, 50/page, filter by validation_status |
| POST | `/api/taxonomy-queue/validate` | Single-row: `{ ids: string[], note?: string }`; batch mode: `{ batchMode: true, n: number }` |
| GET | `/api/products` | Products paginated 50/page; query: `search`, `category`, `country`, `validation_status`, `page` |
| GET | `/api/products/[id]` | Single product + its changelog entries |
| PATCH | `/api/products/[id]` | Update fields; body: `{ fields: Record<string,string>, note?: string }` |
| POST | `/api/override-import/preview` | Parse CSV body, return diff + unmatched SKUs + ignored columns |
| POST | `/api/override-import/confirm` | Apply override; body: `{ csvText, note, batchId }` |
| GET | `/api/settings/brands` | List brand_list entries |
| POST | `/api/settings/brands` | Add brand; body: `{ name: string }` |
| DELETE | `/api/settings/brands/[id]` | Remove brand |

All routes return `{ error: string }` with appropriate HTTP status on failure.

---

## Data Layer Summary

| Layer | Role |
|---|---|
| SQLite (`lib/db/client.ts`) | Working database — all processing, editing, changelog |
| Supabase | Final sync target |
| `data/taxonomy/*.json` | Read-only taxonomy reference |

**Supabase sync (Settings page):** Manually triggered. Upserts all `cleaned_products` rows where `validation_status = 'validated'` into the Supabase `products` table, keyed on `sku`. Only the columns already handled by the existing `persistImportToSupabase` function are synced (sku, name, category, type, grape, region, style, price, cost_price, currency, status, oak, country). The new internal columns (`validation_status`, `queue_priority`) are **not** synced to Supabase — they are working-database-only fields. Reuse the existing `supabaseFetch` helper and column mapping from `lib/supabase/client.ts`.

---

## Error Handling
- All API routes return `{ error: string }` with appropriate HTTP status on failure
- UI shows inline error states — no silent failures
- Override import skipped rows (SKU not found) are shown as informational in the summary, not as errors

---

## Out of Scope
- Authentication / user accounts (notes are anonymous)
- Real-time collaboration
- Supabase as primary database (deferred — SQLite first)
- Scraping pipeline (not modified)
- Changelog filtering by batch note (future feature)
