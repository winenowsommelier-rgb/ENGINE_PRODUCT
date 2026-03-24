# Description Manager — Design Spec
**Date:** 2026-03-24
**Status:** Approved
**Scope:** Internal PIM tool + shared wheel components for future customer catalogue

---

## 1. Overview

A 4-step Description Manager page that lets the operator upload a CSV/XLSX of product descriptions (English + Thai, short + full), match them to existing SKUs (or create new ones), run AI processing to rewrite/validate descriptions and extract structured wheel data, then review and publish changes to the product database.

---

## 2. Data Model

Three new field groups added to every product record in `data/db/products.json` and Supabase:

```ts
// Descriptions
desc_en_short:        string | null
desc_en_full:         string | null
desc_th_short:        string | null
desc_th_full:         string | null

// Wheel scores (0–100, all nullable — wheels only render when populated)
wheel_character: {
  body:        number  // Full-bodied vs light
  tannin:      number  // Wines only; low for spirits
  acidity:     number
  sweetness:   number
  finish:      number  // Length of aftertaste
  complexity:  number  // Overall depth
} | null

wheel_flavour: {
  fruit:    number
  spice:    number
  floral:   number
  earth:    number
  oak:      number
  mineral:  number
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

---

## 3. Description Manager Page

**Route:** `/description-manager`
**Sidebar label:** Description Manager
**Access:** Internal PIM only

### Step 1 — Upload CSV

- Drag-and-drop or browse for `.csv` or `.xlsx` (max 10 MB, up to 5,000 rows)
- Required column: `SKU`
- Optional columns auto-detected by header name:
  - `desc_en_short`, `desc_en_full`
  - `desc_th_short`, `desc_th_full`
- Column headers are case-insensitive and trimmed
- On upload: parse client-side, show row count, validate required column exists, then proceed

### Step 2 — Match SKUs

After parsing, each row is matched against `products.json` by SKU (exact, case-insensitive):

| Status | Meaning | Action |
|--------|---------|--------|
| `matched` | SKU exists in DB | Update descriptions on publish |
| `new_sku` | SKU not in DB, format is valid | Create bare product record + queue for enrichment |
| `unrecognised` | SKU not in DB and format invalid | Flag for operator — skipped by default |

Display:
- Summary bar: total / matched / new / unrecognised counts
- Filterable table: SKU · product name · status badge · EN short preview · TH short preview
- Unrecognised rows shown in red with skip toggle; operator can force-include
- "Continue to AI Process" button enabled only when ≥1 matched or new_sku row exists

### Step 3 — AI Process

Processes matched + new_sku rows in batches of 20 via `/api/descriptions/process`.

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
- Progress bar (N / total)
- Live log feed (SKU · product name · outcome)
- Errors shown inline; errored products can be retried or skipped
- "Review & Publish" button unlocks when all non-error rows are done

### Step 4 — Review & Publish

- Table of all processed products with expand-to-preview
- Expanded view: before/after for EN short, EN full, TH short, TH full + 3 wheel previews
- Per-row: Approve (default) / Skip toggle
- Bulk: "Approve all" / "Skip errors"
- "Publish" commits approved rows to `products.json` and triggers Supabase sync
- New SKUs are created as bare records and immediately queued through the existing enrichment pipeline (country, region, classification)

---

## 4. Wheel Components

Three reusable React components, shared between PIM and customer catalogue:

### `<CharacterWheel scores={...} />`
- SVG radar/spider chart
- 6 axes: Body, Tannin, Acidity, Sweetness, Finish, Complexity
- Axes are extensible (add Smokiness, Texture etc. later without schema change — just add key)
- Renders placeholder if `scores` is null

### `<FlavourWheel scores={...} />`
- SVG sunburst / segmented circle
- 6 segments: Fruit, Spice, Floral, Earth, Oak, Mineral
- Segment arc width proportional to score (0–100)
- Active segments highlighted; inactive dimmed

### `<AromaticWheel data={...} />`
- SVG concentric ring layout
- Inner ring = Primary, mid = Secondary, outer = Tertiary
- Aromas placed as arc labels around each ring
- Up to 5 aromas per ring rendered; overflow truncated with "+N more"

**Placement in PIM:** Replaces the current flat flavour/character tag blocks in the product detail panel (info tab). Renders only if wheel data exists.

**Placement in customer catalogue (Phase C):** Same components imported directly, styled with customer-facing theme.

---

## 5. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/descriptions/process` | POST | Accept batch of products + descriptions, call Claude, return structured results |
| `/api/descriptions/publish` | POST | Write approved results to products.json + trigger Supabase sync |

---

## 6. Out of Scope (this phase)

- Manual per-product description editing (existing Edit tab covers this)
- Bulk image upload
- Customer catalogue frontend (Phase C — separate spec)
- Translation-only mode (no descriptions provided, Claude translates existing)

---

## 7. Open Questions

None blocking. Axes for CharacterWheel (Smokiness, Texture, Alcohol Intensity) noted as future additions — schema supports them now.
