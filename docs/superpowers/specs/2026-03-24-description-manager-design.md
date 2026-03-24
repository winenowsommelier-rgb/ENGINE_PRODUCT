# Description Manager — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Internal PIM tool + shared wheel components for future customer catalogue

---

## 1. Overview

A 4-step Description Manager page that lets the operator upload a CSV/XLSX of product descriptions (English + Thai, short + full), match them to existing SKUs (or create new ones), run AI processing to rewrite/validate descriptions and extract structured wheel data, then review and publish changes to the product database.

---

## 2. Data Model

Ten new fields added to every product record in `data/db/products.json` and Supabase.

**Relationship to existing fields:** `wheel_character` and `wheel_flavour` are separate from the existing `flavor_profile` and `character_traits` JSON blobs. The existing blobs are populated by the rules/Claude enrichment pipeline and remain untouched. The new `wheel_*` fields are populated exclusively by the Description Manager and are used only by the wheel components. They coexist — no replacement.

```ts
// Descriptions
desc_en_short:        string | null
desc_en_full:         string | null
desc_th_short:        string | null
desc_th_full:         string | null

// Wheel scores (0–100; individual keys may be null if Claude omits them)
wheel_character: {
  body:        number | null  // Full-bodied vs light
  tannin:      number | null  // Wines only; low for spirits
  acidity:     number | null
  sweetness:   number | null
  finish:      number | null  // Length of aftertaste
  complexity:  number | null  // Overall depth
} | null

wheel_flavour: {
  fruit:    number | null
  spice:    number | null
  floral:   number | null
  earth:    number | null
  oak:      number | null
  mineral:  number | null
} | null

wheel_aromatic: {
  primary:   string[]  // Fruit-forward, fresh aromas
  secondary: string[]  // Fermentation-derived
  tertiary:  string[]  // Aged/developed (cedar, tobacco, leather…)
} | null

// Processing metadata
desc_processed_at:  string | null   // ISO datetime
desc_source:        'upload' | 'manual' | null
desc_confidence:    number | null   // 0–1, AI self-assessment
```

All wheel fields are nullable. Components check for null and render a placeholder ("Awaiting descriptions") rather than an empty chart.

**Supabase migration required:** before this feature is deployed, add these 10 columns to the `products` table. Migration script to be written as part of implementation (step 0 in the plan).

**Supabase sync update required:** `app/api/settings/sync/route.ts` must be updated to include all 10 new fields in its column map, otherwise publish will save locally but sync will silently discard description/wheel data.

---

## 3. Description Manager Page

**Route:** `/description-manager`
**Sidebar label:** Description Manager
**Access:** Internal PIM only

### Step 1 — Upload CSV

- Drag-and-drop or browse for `.csv` or `.xlsx` (max 10 MB, up to 5,000 rows)
- CSV: parsed as UTF-8 with BOM stripping (supports Thai characters in `desc_th_*` columns)
- XLSX: parsed using the `xlsx` (SheetJS) library (add as dependency if not present)
- Required column: `SKU`
- Optional columns auto-detected by header name (case-insensitive, trimmed):
  - `desc_en_short`, `desc_en_full`
  - `desc_th_short`, `desc_th_full`
- Rows beyond 5,000 are hard-rejected with a clear error before parsing continues
- No column-mapping UI — operator must use the exact header names above; a template CSV download link is shown on the upload screen
- On upload: parse client-side, show row count, validate required column exists, then proceed

### Step 2 — Match SKUs

After parsing, each row is matched against `products.json` by SKU (exact, case-insensitive):

| Status | Meaning | Action |
|--------|---------|--------|
| `matched` | SKU exists in DB | Update descriptions on publish |
| `new_sku` | SKU not in DB, format valid (see below) | Create bare record + queue for enrichment |
| `unrecognised` | SKU not in DB, format invalid | Skipped by default; operator can force-include (treated as `new_sku`) |

**Valid SKU format:** matches `/^[A-Z]{3}\d{3,}[A-Z]{2}$/` (e.g. `WRW001FR`, `LGN045EN`). Enforced client-side.

**Duplicate SKUs in upload:** if the same SKU appears more than once, the last row wins and the duplicate count is shown in the summary bar as a warning.

**`desc_source` overwrite policy:** if an existing product already has `desc_source: 'manual'`, the row is shown with a yellow warning badge in the table. The operator must explicitly approve it in Step 4 — it is not auto-approved by "Approve all". Upload always wins on explicit approval.

Display:

- Summary bar: total / matched / new / unrecognised / duplicates counts
- Filterable table: SKU · product name · status badge · EN short preview · TH short preview
- Unrecognised rows shown in red with skip toggle; operator can force-include
- "Continue to AI Process" button enabled only when ≥1 matched or new_sku row exists
- Empty state (zero processable rows): show error, do not allow proceeding

### Step 3 — AI Process

Processing state is persisted in `sessionStorage` — only status flags and SKUs are stored (not full response bodies) to avoid exceeding the ~5 MB browser limit. Full result payloads are held in module-level state and re-fetched if the tab is reloaded. On return from navigation, completed items are not re-sent.

Processes matched + new_sku rows in batches of 20 via `POST /api/descriptions/process`.

For each product, the API sends to Claude:

```
name, sku, country, region, classification,
raw desc_en_short, desc_en_full, desc_th_short, desc_th_full
```

Claude returns:

```json
{
  "desc_en_short": "...",
  "desc_en_full": "...",
  "desc_th_short": "...",
  "desc_th_full": "...",
  "wheel_character": { "body": 90, "tannin": 85, "acidity": 75, "sweetness": 20, "finish": 95, "complexity": 88 },
  "wheel_flavour": { "fruit": 80, "spice": 60, "floral": 55, "earth": 30, "oak": 45, "mineral": 25 },
  "wheel_aromatic": {
    "primary": ["dark cherry", "cassis"],
    "secondary": ["cedar", "violet"],
    "tertiary": ["tobacco", "graphite", "leather"]
  },
  "desc_confidence": 0.92
}
```

UI shows:

- Progress bar (N / total) with a Pause button (halts after current batch completes)
- Live log feed (SKU · product name · outcome)
- Errors shown inline per item with a Retry button (max 2 retries per item, then marked permanent error)
- Error types: `rate_limit` (Claude 429, auto-retry after 2 s), `api_error` (5xx, no retry), `parse_error` (malformed response, no retry)
- "Review & Publish" button unlocks when all non-error rows are done (permanent errors skipped automatically)

### Step 4 — Review & Publish

- State persisted in `sessionStorage` (status flags + SKUs only, same size constraint as Step 3)
- Table of all processed products with expand-to-preview
- Expanded view: before/after for EN short, EN full, TH short, TH full + 3 wheel previews
- Per-row: Approve (default) / Skip toggle
- Bulk: "Approve all" / "Skip errors" — "Approve all" does NOT auto-approve rows with `desc_source: 'manual'` warning
- Skipped rows left entirely unchanged in the database
- "Publish" button shows a loading spinner during write; on complete shows success summary (N updated, N created) or a warning badge if Supabase sync failed (operator can re-sync from Settings)
- `products.json` write uses the existing atomic tmp-rename pattern (`productsFile + '.tmp'` → rename) from `lib/db/client.ts` to prevent concurrent-write corruption. If the write fails at any point, the entire publish is rolled back (tmp file deleted, no partial state committed)
- New SKUs: created as bare product records with `validation_status: 'needs_review'`, `overall_confidence: 0`, `created_at/updated_at` set — the enrichment pipeline polls for `needs_review` records and will pick them up on the next run

**New SKU bare record minimum fields:**

```ts
{
  id:                   <next sequential id>,
  sku:                  string,
  name:                 string,  // from CSV row if present, else sku
  validation_status:    'needs_review',
  overall_confidence:   0,
  taxonomy_confidence:  0,
  enrichment_source:    null,
  created_at:           now,
  updated_at:           now,
  // + all description/wheel fields from the approved row
}
```

---

## 4. Wheel Components

Three reusable React components in `components/wheels/`, shared between PIM and customer catalogue:

### `<CharacterWheel scores={...} />`

- SVG radar/spider chart, 220×220 px viewBox, responsive width
- 6 axes: Body, Tannin, Acidity, Sweetness, Finish, Complexity
- Colour: violet fill (`#6366f1` / `#a78bfa`), dark background
- Hover tooltip shows axis name + score
- Axes extensible — adding a new key renders a new axis automatically
- Renders placeholder card if `scores` is null
- `aria-label` set to "Character wheel for [product name]"

### `<FlavourWheel scores={...} />`

- SVG sunburst / segmented circle, 220×220 px viewBox
- 6 segments: Fruit, Spice, Floral, Earth, Oak, Mineral
- Segment arc width proportional to score; minimum visible arc at score=1 is 5° (prevents invisible slivers)
- Segments with score=0 rendered at 10% opacity (dimmed, not hidden)
- `aria-label` set to "Flavour wheel for [product name]"

### `<AromaticWheel data={...} />`

- SVG concentric ring layout, 220×220 px viewBox
- Inner ring = Primary, mid = Secondary, outer = Tertiary
- Up to 5 aromas per ring as arc labels; overflow shown as "+N more" static text (no interaction)
- `aria-label` set to "Aromatic wheel for [product name]"

**Shared prop interface** (both contexts use the same types):

```ts
interface WheelTheme { background: string; primary: string; secondary: string; text: string }
// PIM default theme provided; customer catalogue passes its own theme via prop
```

**Placement in PIM:** replaces the current flat flavour/character tag blocks in the product detail panel (info tab). Renders only if wheel data exists.

**Placement in customer catalogue (Phase C):** same components imported directly, customer theme passed via `theme` prop.

---

## 5. API Routes

### `POST /api/descriptions/process`

**Request:** max 20 items; requests with >20 items return `400 { error: 'Max 20 items per request' }`. Payload size enforced by Next.js default 4 MB body limit (sufficient for 20 items with bilingual descriptions).

**Request body:**

```ts
{
  items: Array<{
    sku:             string
    name:            string
    country?:        string
    region?:         string
    classification?: string
    desc_en_short?:  string
    desc_en_full?:   string
    desc_th_short?:  string
    desc_th_full?:   string
  }>
}
```

**Response (200):**

```ts
{
  results: Array<{
    sku:              string
    status:           'ok' | 'error'
    error?:           string
    desc_en_short?:   string
    desc_en_full?:    string
    desc_th_short?:   string
    desc_th_full?:    string
    wheel_character?: { body: number|null, tannin: number|null, acidity: number|null, sweetness: number|null, finish: number|null, complexity: number|null }
    wheel_flavour?:   { fruit: number|null, spice: number|null, floral: number|null, earth: number|null, oak: number|null, mineral: number|null }
    wheel_aromatic?:  { primary: string[], secondary: string[], tertiary: string[] }
    desc_confidence?: number
  }>
}
```

- Partial failures allowed; batch does not abort on individual item error
- Claude 429 → auto-retry once after 2 s, then `status: 'error'`
- Claude 5xx → `status: 'error'` immediately
- Malformed/partial Claude response → `status: 'error'`
- Timeout: 60 s per batch

### `POST /api/descriptions/publish`

**Request body:**

```ts
{
  approved: Array<{
    sku:              string
    is_new_sku?:      boolean
    desc_en_short?:   string
    desc_en_full?:    string
    desc_th_short?:   string
    desc_th_full?:    string
    wheel_character?: { ... }
    wheel_flavour?:   { ... }
    wheel_aromatic?:  { ... }
    desc_confidence?: number
  }>
}
```

**Response (200):** `{ updated: number, created: number, sync_triggered: boolean }`

**Response (500):** `{ error: string }` — `products.json` write failed; no partial state committed (tmp file cleaned up)

**Atomicity:** entire `products.json` write is all-or-nothing via tmp-rename. The existing `saveCleanedProduct` in `lib/db/client.ts` uses a plain `writeFile` (no tmp-rename) and is not suitable. A new helper `batchUpdateProducts(updates: Partial<ProductRecord>[])` must be added to `lib/db/client.ts` as part of implementation — it reads the full file, merges updates by SKU, writes to a `.tmp` file, then renames atomically (same pattern as `batchUpdateEnrichment`). The publish route calls this helper. If write succeeds but Supabase sync fails → return 200 with `sync_triggered: false`; UI shows warning. Operator can re-sync from Settings.

---

## 6. Out of Scope (this phase)

- Manual per-product description editing (existing Edit tab covers this)
- Bulk image upload
- Customer catalogue frontend (Phase C — separate spec)
- Translation-only mode (no descriptions provided, Claude translates existing)
- Column-mapping UI for non-standard header names

---

## 7. Implementation Prerequisites

1. **Supabase migration** — add 10 new columns to `products` table before first deploy
2. **Sync route update** — add new fields to `app/api/settings/sync/route.ts` column map
3. **SheetJS dependency** — add `xlsx` package if not already present
