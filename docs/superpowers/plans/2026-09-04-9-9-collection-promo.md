# 9.9 Collection Promo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a time-boxed "9.9 COLLECTION" promo — a hero card on `/collections` (above every other group) linking to a dedicated `/collections/9-9-collection` listing page — sourced from two supplied CSVs, isolated from `products.db`/`live_products_export.json`, and automatically retired after 9 Sep 2026 23:59:59 ICT via a live date check (no cron, no manual step).

**Architecture:** A generator script parses the two CSVs into a standalone `data/promo_9_9_collection.json` (SKU + promo/regular price only — no duplicated product identity). A new `lib/promo-9-9.ts` loads that file defensively (mirrors `lib/collections.ts`'s "return empty, never throw" pattern) and exposes `getPromo99()` / `isPromo99Active()`. `/collections/page.tsx` conditionally renders a new `Promo99HeroCard` before its existing group loop. A new `/collections/9-9-collection/page.tsx`, modeled directly on the existing `[slug]/page.tsx`, resolves each promo SKU to its live `PublicProduct` via `getProductBySku`, filters out-of-stock/archived items, overrides `price`/`special_price` on a per-item clone so the existing `ProductCard` + `resolveSale()` render the promo discount unmodified, and reuses the existing sort/pagination UI verbatim.

**Tech Stack:** Next.js 14 (apps/catalog), TypeScript, Vitest, Node.js (`.mjs` generator script), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-9-9-collection-promo-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `data/promo_9_9_bartender_pick.csv` (new) | Raw source CSV #1, committed as-is |
| `data/promo_9_9_sommelier_pick.csv` (new) | Raw source CSV #2, committed as-is |
| `apps/catalog/scripts/gen-9-9-collection.mjs` (new) | One-off, manually-run generator: CSV → `data/promo_9_9_collection.json` |
| `data/promo_9_9_collection.json` (new, generated) | Promo data: slug/name/tagline/promoEndDate/items[] |
| `apps/catalog/lib/promo-9-9.ts` (new) | Defensive singleton loader + `isPromo99Active()` |
| `apps/catalog/lib/__tests__/promo-9-9.test.ts` (new) | Unit tests for the loader/active-check |
| `apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs` (new) | Unit tests for CSV-parsing edge cases |
| `apps/catalog/components/Promo99HeroCard.tsx` (new) | Hero card UI |
| `apps/catalog/app/collections/page.tsx` (modify) | Render the hero card above the group loop |
| `apps/catalog/app/collections/9-9-collection/page.tsx` (new) | Dedicated listing page |

---

### Task 1: Save source CSVs into the repo

**Files:**
- Create: `data/promo_9_9_bartender_pick.csv`
- Create: `data/promo_9_9_sommelier_pick.csv`

- [ ] **Step 1: Copy the two CSVs from the scratchpad into `data/`**

The CSVs already exist at:
- `/private/tmp/claude-501/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/1c5cc81e-225e-4484-94b0-e069210a1f55/scratchpad/9.9_bartender_pick.csv`
- `/private/tmp/claude-501/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/1c5cc81e-225e-4484-94b0-e069210a1f55/scratchpad/9.9_sommelier_pick.csv`

Copy their content verbatim into the new repo paths above (same header row, same rows, no reformatting).

- [ ] **Step 2: Confirm they aren't caught by `.gitignore`**

Run: `git check-ignore -v data/promo_9_9_bartender_pick.csv data/promo_9_9_sommelier_pick.csv`
Expected: no output (exit code 1 = not ignored). If either IS matched, report the matching rule before proceeding — do not force-add.

- [ ] **Step 3: Commit**

```bash
git add data/promo_9_9_bartender_pick.csv data/promo_9_9_sommelier_pick.csv
git commit -m "chore(data): add 9.9 promo source CSVs"
```

---

### Task 2: Generator script — parsing helpers (TDD)

**Files:**
- Create: `apps/catalog/scripts/gen-9-9-collection.mjs`
- Create: `apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs`

This task builds the script's pure parsing functions test-first, before wiring up file I/O. Look at `apps/catalog/scripts/gen-explore-map-data.mjs` for this repo's existing `.mjs` script conventions (plain Node, no build step, run via `node scripts/....mjs`).

- [ ] **Step 1: Write failing tests for `parseMoney`, `parsePercent`, and `computeDiscountPct`**

```js
// apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs
import { describe, it, expect } from 'vitest';
import { parseMoney, parsePercent, computeDiscountPct } from '../gen-9-9-collection.mjs';

describe('parseMoney', () => {
  it('strips commas and quotes, returns a number', () => {
    expect(parseMoney('"2,349"')).toBe(2349);
    expect(parseMoney('2349')).toBe(2349);
    expect(parseMoney('959')).toBe(959);
  });

  it('returns null for #REF! or empty', () => {
    expect(parseMoney('#REF!')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('parses "9%" to 9', () => {
    expect(parsePercent('9%')).toBe(9);
    expect(parsePercent('20%')).toBe(20);
  });

  it('returns null for #REF! or empty', () => {
    expect(parsePercent('#REF!')).toBeNull();
    expect(parsePercent('')).toBeNull();
  });
});

describe('computeDiscountPct', () => {
  it('recomputes from regular/promo price, rounded', () => {
    expect(computeDiscountPct(2585, 2349)).toBe(9); // (2585-2349)/2585 = 9.13% -> 9
    expect(computeDiscountPct(9800, 7799)).toBe(20);
  });

  it('returns 0 when promoPrice >= regularPrice or prices missing', () => {
    expect(computeDiscountPct(1000, 1000)).toBe(0);
    expect(computeDiscountPct(1000, 1200)).toBe(0);
    expect(computeDiscountPct(null, 1000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run scripts/__tests__/gen-9-9-collection.test.mjs`
Expected: FAIL — `gen-9-9-collection.mjs` doesn't exist yet / exports undefined.

- [ ] **Step 3: Write the script's parsing helpers**

```js
// apps/catalog/scripts/gen-9-9-collection.mjs
// One-off generator: 9.9 promo CSVs -> data/promo_9_9_collection.json
// Run manually: node scripts/gen-9-9-collection.mjs
// Re-run whenever corrected source CSVs are supplied (e.g. fixing #REF! rows).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** "2,349" / "959" / "#REF!" / "" -> number | null. */
export function parseMoney(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/^"|"$/g, '');
  if (s === '' || s === '#REF!') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "9%" / "#REF!" / "" -> number | null. */
export function parsePercent(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '#REF!') return null;
  const n = Number(s.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/** Recompute % off from regular vs promo price; 0 when not a genuine discount. */
export function computeDiscountPct(regularPrice, promoPrice) {
  if (typeof regularPrice !== 'number' || typeof promoPrice !== 'number') return 0;
  if (regularPrice <= 0 || promoPrice >= regularPrice) return 0;
  return Math.round(((regularPrice - promoPrice) / regularPrice) * 100);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run scripts/__tests__/gen-9-9-collection.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/scripts/gen-9-9-collection.mjs apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs
git commit -m "feat(scripts): add 9.9 promo CSV parsing helpers"
```

---

### Task 3: Generator script — row mapping + `#REF!` fallback (TDD)

**Files:**
- Modify: `apps/catalog/scripts/gen-9-9-collection.mjs`
- Modify: `apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs`

- [ ] **Step 1: Write failing tests for `mapRow`**

`mapRow` takes one parsed CSV row object (already split into fields — the raw CSV parsing itself happens in Task 4) and returns `{ sku, promoPrice, regularPrice, discountPct } | null` (null = unusable row, e.g. missing SKU).

```js
// append to gen-9-9-collection.test.mjs
import { mapRow } from '../gen-9-9-collection.mjs';

describe('mapRow', () => {
  it('maps a normal row using the 9.9 price and price columns', () => {
    const row = { sku: 'LWH0474ES', '9.9 price': '"2,349"', price: '"2,585"' };
    expect(mapRow(row)).toEqual({
      sku: 'LWH0474ES', promoPrice: 2349, regularPrice: 2585, discountPct: 9,
    });
  });

  it('falls back to regular price with 0 discount on #REF! rows', () => {
    const row = { sku: 'LWH0233AA', '9.9 price': '#REF!', price: '"3,719"' };
    expect(mapRow(row)).toEqual({
      sku: 'LWH0233AA', promoPrice: 3719, regularPrice: 3719, discountPct: 0,
    });
  });

  it('returns null when sku is missing', () => {
    expect(mapRow({ sku: '', '9.9 price': '100', price: '200' })).toBeNull();
  });

  it('returns null when regular price cannot be parsed (no usable price at all)', () => {
    expect(mapRow({ sku: 'X', '9.9 price': '#REF!', price: '#REF!' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run scripts/__tests__/gen-9-9-collection.test.mjs`
Expected: FAIL — `mapRow` not exported.

- [ ] **Step 3: Implement `mapRow`**

```js
// add to gen-9-9-collection.mjs, after computeDiscountPct

/**
 * Map one raw CSV row (field names as they appear in the header) to a promo
 * item, or null if the row is unusable. On a #REF! 9.9 price (broken source
 * formula), falls back to the regular price for BOTH promoPrice and
 * regularPrice with discountPct 0 — included at regular price, no discount
 * badge, per user decision (spec: 2026-09-04-9-9-collection-promo-design.md).
 */
export function mapRow(row) {
  const sku = String(row.sku ?? '').trim();
  if (!sku) return null;

  const regularPrice = parseMoney(row.price);
  if (regularPrice === null) return null; // no usable price at all — skip the row

  const rawPromo = parseMoney(row['9.9 price']);
  const promoPrice = rawPromo === null ? regularPrice : rawPromo;
  const discountPct = computeDiscountPct(regularPrice, promoPrice);

  return { sku, promoPrice, regularPrice, discountPct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run scripts/__tests__/gen-9-9-collection.test.mjs`
Expected: PASS (10 tests total)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/scripts/gen-9-9-collection.mjs apps/catalog/scripts/__tests__/gen-9-9-collection.test.mjs
git commit -m "feat(scripts): map 9.9 promo CSV rows with #REF! fallback"
```

---

### Task 4: Generator script — CSV file reading + SKU-match report + JSON output

**Files:**
- Modify: `apps/catalog/scripts/gen-9-9-collection.mjs`

This step wires up real file I/O (CSV parsing, a mirrored SKU lookup, writing
the output JSON) — not unit-tested in isolation (it's I/O glue), verified
instead by actually running it in Task 5.

**Important — do NOT import `lib/catalog-data.ts` from this script.** This is
a plain `.mjs` file run directly via `node scripts/gen-9-9-collection.mjs`
(see `apps/catalog/package.json`'s `prebuild` script for the established
convention: `node scripts/gen-explore-map-data.mjs`, no loader/TS flags).
Node has no TypeScript loader configured in this repo, so `await
import('../lib/catalog-data.ts')` would fail. `gen-explore-map-data.mjs`'s
own header comment states this explicitly ("Plain Node .mjs ... so it CANNOT
import the TS catalog loaders") and instead reads
`data/live_products_export.json` directly with `fs`/`JSON.parse`, mirroring
just the lookup logic it needs. Follow that exact precedent here: mirror a
minimal SKU-lookup map, not a full `getProductBySku` import.

- [ ] **Step 1: Add a minimal CSV line parser (no new dependency)**

The source CSVs have quoted fields containing commas (e.g. `"2,349"`, `"Boozia Distribution Co., Ltd."`). Add a small RFC4180-ish parser — do not reach for a new npm dependency for this one-off script.

```js
// add to gen-9-9-collection.mjs

/** Minimal CSV parser: handles quoted fields with embedded commas/quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse a CSV file into an array of header-keyed row objects. */
function readCsvRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const [header, ...rows] = parseCsv(text);
  return rows
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
```

- [ ] **Step 2: Add a mirrored, minimal SKU-existence lookup**

Mirrors `getProductBySku`'s essential check ("does this SKU exist in the
live export") without importing `lib/catalog-data.ts`. This does not need
the full `toPublicProduct` projection/allowlist — the generator only needs
to know a SKU is present; the actual live product is always re-resolved
properly at render time by the real `getProductBySku` inside the Next.js
app (Task 9). Path-resolution mirrors `resolveExportPath()` in
`gen-explore-map-data.mjs`.

```js
// add to gen-9-9-collection.mjs

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BARTENDER_CSV = path.join(REPO_ROOT, 'data', 'promo_9_9_bartender_pick.csv');
const SOMMELIER_CSV = path.join(REPO_ROOT, 'data', 'promo_9_9_sommelier_pick.csv');
const OUTPUT_JSON = path.join(REPO_ROOT, 'data', 'promo_9_9_collection.json');

const PROMO_END_DATE = '2026-09-09T23:59:59+07:00';

/**
 * Minimal mirror of lib/catalog-data.ts's exportPath()/getProductBySku() —
 * existence-check only, no field projection. This script is a plain .mjs
 * run via `node scripts/gen-9-9-collection.mjs` (see package.json's
 * `prebuild`), and this repo's established convention (gen-explore-map-data.mjs)
 * is that such scripts cannot import the TS lib modules, so this mirrors
 * just the lookup it needs. Keep in sync with catalog-data.ts's SKU field.
 */
function loadKnownSkus() {
  const candidates = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
    path.join(REPO_ROOT, 'data', 'live_products_export.json'),
    process.env.CATALOG_DATA_PATH ?? '',
  ].find((p) => p && fs.existsSync(p));
  if (!candidates) throw new Error('gen-9-9-collection: live_products_export.json not found');

  const raw = JSON.parse(fs.readFileSync(candidates, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.products ?? []);
  return new Set(rows.map((r) => r.sku).filter(Boolean));
}
```

- [ ] **Step 3: Add the main generation flow**

```js
// add to gen-9-9-collection.mjs

function main() {
  const knownSkus = loadKnownSkus();
  const bartenderRows = readCsvRows(BARTENDER_CSV);
  const sommelierRows = readCsvRows(SOMMELIER_CSV);

  const allRows = [...bartenderRows, ...sommelierRows];
  const items = [];
  const skippedNoMatch = [];
  const skippedUnusable = [];
  let refFallbackCount = 0;

  for (const row of allRows) {
    const mapped = mapRow(row);
    if (!mapped) { skippedUnusable.push(row.sku || '(no sku)'); continue; }
    if (mapped.discountPct === 0 && parseMoney(row['9.9 price']) === null) refFallbackCount++;

    if (!knownSkus.has(mapped.sku)) { skippedNoMatch.push(mapped.sku); continue; }

    items.push(mapped);
  }

  const output = {
    slug: '9-9-collection',
    name: '9.9 COLLECTION',
    tagline: 'Special prices until 9 September 2026',
    promoEndDate: PROMO_END_DATE,
    items,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2) + '\n');

  console.log(`9.9 Collection generated: ${OUTPUT_JSON}`);
  console.log(`  Total rows read:        ${allRows.length}`);
  console.log(`  Rows included:          ${items.length}`);
  console.log(`  #REF! fallback used:    ${refFallbackCount}`);
  console.log(`  Skipped (no SKU match): ${skippedNoMatch.length}`);
  if (skippedNoMatch.length) console.log(`    -> ${skippedNoMatch.join(', ')}`);
  console.log(`  Skipped (unusable row): ${skippedUnusable.length}`);
  if (skippedUnusable.length) console.log(`    -> ${skippedUnusable.join(', ')}`);
}

// Only run when executed directly (not when imported by tests) — the pure
// helpers above (parseMoney/parsePercent/computeDiscountPct/mapRow) stay
// importable by vitest without triggering file I/O.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/scripts/gen-9-9-collection.mjs
git commit -m "feat(scripts): wire up 9.9 promo CSV-to-JSON generation with report"
```

---

### Task 5: Run the generator and verify the output

**Files:**
- Create (generated, then committed): `data/promo_9_9_collection.json`

- [ ] **Step 1: Run the generator from `apps/catalog`**

Run: `cd apps/catalog && node scripts/gen-9-9-collection.mjs`

No special flags needed — Task 4 already avoids importing any `.ts` file
(it reads `live_products_export.json` directly for the SKU-existence
check), matching this repo's plain-`.mjs` `prebuild` script convention.

Expected output: a summary report similar to:
```
9.9 Collection generated: .../data/promo_9_9_collection.json
  Total rows read:        237
  Rows included:          ~220-230
  #REF! fallback used:    ~14
  Skipped (no SKU match): <some number>
    -> SKU1, SKU2, ...
  Skipped (unusable row): 0
```

- [ ] **Step 2: Report the skip list to the user before proceeding**

Read the "Skipped (no SKU match)" list from the console output and surface it verbatim — this is exactly the data-integrity report the spec requires. Do not silently proceed if this list is large (e.g. more than ~10% of rows) — pause and confirm with the user first, since that could indicate a systematic SKU-format mismatch rather than a few genuinely delisted products.

- [ ] **Step 3: Spot-check the generated JSON**

Run: `cd apps/catalog && node -e "const d=require('../../data/promo_9_9_collection.json'); console.log(d.items.length, d.promoEndDate); console.log(d.items.slice(0,3))"`
Expected: item count matches the report, `promoEndDate` is `2026-09-09T23:59:59+07:00`, and the first few items have plausible `sku`/`promoPrice`/`regularPrice`/`discountPct` values matching the source CSVs.

- [ ] **Step 4: Commit**

```bash
git add data/promo_9_9_collection.json
git commit -m "chore(data): generate 9.9 promo collection JSON"
```

---

### Task 6: `lib/promo-9-9.ts` — defensive loader + active-check (TDD)

**Files:**
- Create: `apps/catalog/lib/promo-9-9.ts`
- Create: `apps/catalog/lib/__tests__/promo-9-9.test.ts`

Model the file-loading half of this directly on `apps/catalog/lib/collections.ts`'s `collectionsPath()` / `getCollections()` (dual cwd-candidate probe, cache in a module-level singleton, return a safe empty value rather than throwing when the file is absent).

- [ ] **Step 1: Write failing tests**

```ts
// apps/catalog/lib/__tests__/promo-9-9.test.ts
import { describe, it, expect } from 'vitest';
import { getPromo99, isPromo99Active } from '../promo-9-9';

describe('getPromo99 (reads the real generated data/promo_9_9_collection.json)', () => {
  it('returns the promo collection with a positive item count', () => {
    const promo = getPromo99();
    expect(promo).not.toBeNull();
    expect(promo!.slug).toBe('9-9-collection');
    expect(promo!.items.length).toBeGreaterThan(0);
  });
});

describe('isPromo99Active', () => {
  it('is true strictly before the cutoff', () => {
    expect(isPromo99Active(new Date('2026-09-09T23:59:58+07:00'))).toBe(true);
  });

  it('is false at and after the cutoff', () => {
    expect(isPromo99Active(new Date('2026-09-09T23:59:59+07:00'))).toBe(false);
    expect(isPromo99Active(new Date('2026-09-10T00:00:00+07:00'))).toBe(false);
  });

  it('is true well before the cutoff (e.g. today)', () => {
    expect(isPromo99Active(new Date('2026-09-04T12:00:00+07:00'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run lib/__tests__/promo-9-9.test.ts`
Expected: FAIL — module `../promo-9-9` doesn't exist.

- [ ] **Step 3: Implement `lib/promo-9-9.ts`**

```ts
/**
 * promo-9-9 — loader for the time-boxed "9.9 COLLECTION" promo.
 *
 * Isolated from products.db / live_products_export.json: this file only
 * carries { sku, promoPrice, regularPrice, discountPct } pairs generated by
 * scripts/gen-9-9-collection.mjs from two source CSVs. Product identity
 * (name, image, stock) is always read live via getProductBySku — never
 * duplicated here — so the promo page reflects current catalog state.
 *
 * DEFENSIVE, mirrors lib/collections.ts: returns null / false rather than
 * throwing when data/promo_9_9_collection.json is absent or malformed, so
 * a deploy before the generator has run (or after the file is deleted once
 * the promo is over) never breaks /collections.
 */
import fs from 'fs';
import path from 'path';

export interface Promo99Item {
  sku: string;
  promoPrice: number;
  regularPrice: number;
  discountPct: number;
}

export interface Promo99Collection {
  slug: string;
  name: string;
  tagline: string;
  promoEndDate: string; // ISO 8601, includes explicit UTC offset
  items: Promo99Item[];
}

function promoPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data', 'promo_9_9_collection.json'),             // cwd = repo root
    path.join(process.cwd(), '..', '..', 'data', 'promo_9_9_collection.json'), // cwd = apps/catalog
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let _promo: Promo99Collection | null | undefined; // undefined = not yet loaded

function load(): Promo99Collection | null {
  if (_promo !== undefined) return _promo;
  const file = promoPath();
  if (!file) { _promo = null; return _promo; }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
      _promo = null;
    } else {
      _promo = raw as Promo99Collection;
    }
  } catch {
    _promo = null;
  }
  return _promo;
}

/** The promo collection, or null if not yet generated / malformed. */
export function getPromo99(): Promo99Collection | null {
  return load();
}

/** True iff the promo file loaded successfully AND `now` is before promoEndDate. */
export function isPromo99Active(now: Date = new Date()): boolean {
  const promo = load();
  if (!promo) return false;
  return now.getTime() < new Date(promo.promoEndDate).getTime();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run lib/__tests__/promo-9-9.test.ts`
Expected: PASS (4 tests) — requires Task 5's generated JSON to exist on disk.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/promo-9-9.ts apps/catalog/lib/__tests__/promo-9-9.test.ts
git commit -m "feat(catalog): add defensive 9.9 promo loader + active-check"
```

---

### Task 7: `Promo99HeroCard` component

**Files:**
- Create: `apps/catalog/components/Promo99HeroCard.tsx`

- [ ] **Step 1: Implement the component**

Follow this repo's Tailwind conventions (see `CollectionCard.tsx` for the border/hover/focus-ring pattern this app uses everywhere). Text + gradient background, no image dependency — item count is `promo.items.length` (static; see spec's rationale for why this doesn't re-resolve every SKU on every `/collections` load).

```tsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Promo99Collection } from '@/lib/promo-9-9';

/**
 * Promo99HeroCard — full-width hero for the time-boxed 9.9 Collection.
 * Rendered above every group section on /collections while isPromo99Active().
 * Item count is promo.items.length (static JSON count) — see
 * docs/superpowers/specs/2026-09-04-9-9-collection-promo-design.md for why
 * this deliberately doesn't re-resolve every SKU just for a cosmetic count.
 */
export function Promo99HeroCard({ promo }: { promo: Promo99Collection }) {
  return (
    <Link
      href={`/collections/${promo.slug}`}
      className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-primary bg-gradient-to-br from-primary/90 to-primary p-6 text-primary-foreground transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {promo.name}
        </h2>
        <ArrowRight
          className="mt-2 h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </div>
      <p className="max-w-xl text-base opacity-90">{promo.tagline}</p>
      <p className="mt-2 text-sm font-medium opacity-80">
        {promo.items.length} {promo.items.length === 1 ? 'bottle' : 'bottles'}
      </p>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/components/Promo99HeroCard.tsx
git commit -m "feat(catalog): add Promo99HeroCard component"
```

---

### Task 8: Render the hero on `/collections`

**Files:**
- Modify: `apps/catalog/app/collections/page.tsx`

- [ ] **Step 1: Add the conditional hero render**

Edit `apps/catalog/app/collections/page.tsx`. Add imports and insert the hero before the `sections.length === 0 ? ... : sections.map(...)` block (around current line 61):

```tsx
import { getPromo99, isPromo99Active } from '@/lib/promo-9-9';
import { Promo99HeroCard } from '@/components/Promo99HeroCard';
```

```tsx
export default function CollectionsIndexPage() {
  const products = getAllProducts();
  const groups = getGroupsWithCollections();
  const promo99 = getPromo99();
  const promo99Active = promo99 !== null && isPromo99Active();
  // ...(sections computation unchanged)...

  return (
    <main className="container flex flex-col gap-6 py-6 sm:gap-8 sm:py-8">
      <header>...(unchanged)...</header>

      {promo99Active ? <Promo99HeroCard promo={promo99!} /> : null}

      {sections.length === 0 ? (
        ...
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/app/collections/page.tsx
git commit -m "feat(catalog): show 9.9 promo hero above collections groups"
```

---

### Task 9: `/collections/9-9-collection` dedicated listing page

**Files:**
- Create: `apps/catalog/app/collections/9-9-collection/page.tsx`

This mirrors `apps/catalog/app/collections/[slug]/page.tsx` closely — same `SortControl`/`Pagination`/`pageHref`/`sortHref`/`pageWindow` helpers (copy them, adapting only the fixed-`slug`-string parts), same `ProductCard` grid, same "showing X-Y of N" header. The real estate:

- [ ] **Step 1: Implement the page**

```tsx
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import { getAllProducts, getProductBySku } from '@/lib/catalog-data';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { applyShopQuery, type ShopParams } from '@/lib/shop-query';
import { buildQuery } from '@/lib/build-query';
import { cn } from '@/lib/utils';
import { ViewItemListTracker } from '@/components/ViewItemListTracker';
import { getPromo99, isPromo99Active } from '@/lib/promo-9-9';
import { createClient } from '@/lib/supabase/server';
import { getUserLists } from '@/lib/lists';
import type { PublicProduct } from '@/lib/types';

const SLUG = '9-9-collection';

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
];

function firstStr(v: string | string[] | undefined): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' && first.trim() !== '' ? first : undefined;
}

/**
 * Build the fixed product list for the 9.9 grid: resolve every promo SKU to
 * its live product, drop unresolvable/out-of-stock/archived items, and
 * override price/special_price so ProductCard's existing resolveSale() path
 * renders the promo discount with zero changes to ProductCard itself.
 */
function buildPromoProducts(): PublicProduct[] {
  const promo = getPromo99();
  if (!promo) return [];
  const out: PublicProduct[] = [];
  for (const item of promo.items) {
    const live = getProductBySku(item.sku);
    if (!live) continue;
    if (live.is_in_stock === false) continue;
    if (live.custom_stock_status === 'CATALOG') continue;
    out.push({ ...live, price: item.regularPrice, special_price: item.promoPrice });
  }
  return out;
}

function mergedParams(searchParams?: ShopParams): ShopParams {
  const merged: ShopParams = {};
  const sort = firstStr(searchParams?.sort);
  const page = firstStr(searchParams?.page);
  if (sort) merged.sort = sort;
  if (page) merged.page = page;
  return merged;
}

export function generateMetadata(): Metadata {
  return {
    title: '9.9 Collection — WNLQ9',
    description: 'Special promo prices on curated wine and spirits, live until 9 September 2026.',
    alternates: { canonical: `https://wnlq9.shop/collections/${SLUG}` },
  };
}

function pageHref(sort: string | undefined, page: number): string {
  const qs = buildQuery({}, { sort: sort ?? null, page: page <= 1 ? null : String(page) });
  return qs ? `/collections/${SLUG}?${qs}` : `/collections/${SLUG}`;
}

function sortHref(sort: string): string {
  const qs = buildQuery({}, { sort: sort === 'recommended' ? null : sort });
  return qs ? `/collections/${SLUG}?${qs}` : `/collections/${SLUG}`;
}

function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | 'gap'> = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push('gap');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total - 1) out.push('gap');
  out.push(total);
  return out;
}

export default async function Promo99Page({
  searchParams,
}: {
  searchParams?: ShopParams;
}) {
  if (!isPromo99Active()) {
    return (
      <main className="container flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-foreground">This promotion has ended</h1>
        <p className="max-w-md text-base text-muted-foreground">
          The 9.9 Collection's special prices are no longer available. Browse our other collections instead.
        </p>
        <Link
          href="/collections"
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to Collections
        </Link>
      </main>
    );
  }

  const promo = getPromo99();
  if (!promo) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);
  const userLists = user ? await getUserLists(supabase, user.id) : [];

  const promoProducts = buildPromoProducts();
  const activeSort = firstStr(searchParams?.sort) ?? 'recommended';
  const result = applyShopQuery(promoProducts, mergedParams(searchParams));
  const { pageItems, total, page, pageSize, totalPages } = result;

  const links = buildContactLinks(getContactEnv());
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <main className="container flex flex-col gap-5 py-6 sm:gap-6 sm:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/collections" className="transition-colors hover:text-primary">Collections</Link>
        <span aria-hidden="true" className="px-2">/</span>
        <span className="text-foreground">{promo.name}</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{promo.name}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{promo.tagline}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> {total === 1 ? 'bottle' : 'bottles'}
        </p>
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-muted/20 px-6 py-16 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-medium text-foreground">Nothing available right now</h2>
          <p className="max-w-md text-base text-muted-foreground">
            This collection has no available bottles at the moment. Browse the full shop instead.
          </p>
          <Link
            href="/shop"
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground',
              'transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            Browse the shop
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="text-base text-muted-foreground" aria-live="polite" role="status">
              Showing <span className="font-medium text-foreground">{first}–{last}</span> of{' '}
              <span className="font-medium text-foreground">{total}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort:</span>
              {SORT_OPTIONS.map((opt) => {
                const isActive = opt.value === activeSort;
                return isActive ? (
                  <span
                    key={opt.value}
                    aria-current="true"
                    className="inline-flex min-h-[36px] items-center rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground"
                  >
                    {opt.label}
                  </span>
                ) : (
                  <Link
                    key={opt.value}
                    href={sortHref(opt.value)}
                    className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {opt.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <ViewItemListTracker
            listName={promo.name}
            items={pageItems.slice(0, 50).map((p, i) => ({
              item_id: p.sku,
              item_name: p.name,
              item_category: promo.name,
              item_category2: p.category_type ?? undefined,
              price: p.price ? Math.round(p.price) : undefined,
              currency: 'THB',
              index: i,
              item_list_name: promo.name,
            }))}
          />

          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {pageItems.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                contactLinks={links}
                isLoggedIn={isLoggedIn}
                userLists={userLists}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {(() => {
                const window = pageWindow(page, totalPages);
                const hasPrev = page > 1;
                const hasNext = page < totalPages;
                const baseLink = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
                return (
                  <>
                    {hasPrev ? (
                      <Link href={pageHref(activeSort, page - 1)} aria-label="Previous page" rel="prev" className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>
                        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(baseLink, 'border-transparent text-muted-foreground/40')}>
                        <ChevronLeft className="h-5 w-5" />
                      </span>
                    )}
                    {window.map((item, i) =>
                      item === 'gap' ? (
                        <span key={`gap-${i}`} aria-hidden="true" className="inline-flex min-h-[44px] items-center px-1 text-muted-foreground">…</span>
                      ) : item === page ? (
                        <span key={item} aria-current="page" aria-label={`Page ${item}, current page`} className={cn(baseLink, 'border-primary bg-primary font-medium text-primary-foreground')}>{item}</span>
                      ) : (
                        <Link key={item} href={pageHref(activeSort, item)} aria-label={`Page ${item}`} className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>{item}</Link>
                      ),
                    )}
                    {hasNext ? (
                      <Link href={pageHref(activeSort, page + 1)} aria-label="Next page" rel="next" className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>
                        <ChevronRight className="h-5 w-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(baseLink, 'border-transparent text-muted-foreground/40')}>
                        <ChevronRight className="h-5 w-5" />
                      </span>
                    )}
                  </>
                );
              })()}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/app/collections/9-9-collection/page.tsx
git commit -m "feat(catalog): add dedicated /collections/9-9-collection page"
```

---

### Task 10: Full test suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full catalog test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all tests pass, including the new `promo-9-9.test.ts` and `gen-9-9-collection.test.mjs`.

- [ ] **Step 2: Run the full typecheck and build**

Run: `cd apps/catalog && npx tsc --noEmit && npm run build`
Expected: build succeeds with no new errors or warnings from the new files.

- [ ] **Step 3: Commit any fixes** (only if Steps 1-2 surfaced issues)

---

### Task 11: Browser verification (Rule 7 — required, not optional)

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `cd apps/catalog && npm run dev` (repo memory notes: catalog dev port is 3100, not 3212 — confirm the actual port from the dev server's own startup output)

- [ ] **Step 2: Visit `/collections`**

Confirm: the "9.9 COLLECTION" hero card renders above every group section, including "Icons & Classifications". Confirm the tagline and bottle count look right, and the card is a full-width, visually distinct block (not just another grid tile).

- [ ] **Step 3: Click through to `/collections/9-9-collection`**

Confirm: the grid renders with a mix of wine and spirits items (not grouped/blocked by source), each showing a strikethrough regular price next to the lower promo price, matching the source CSV numbers for a few spot-checked SKUs.

- [ ] **Step 4: Exercise all 4 sort options and pagination**

Click each of Recommended / Name (A–Z) / Price (low to high) / Price (high to low); confirm the grid visibly re-orders each time and the URL's `sort` param updates accordingly (dropped for "Recommended"). If there's more than one page, click through pagination and confirm items don't repeat or vanish between pages.

- [ ] **Step 5: Verify the ended-state without waiting for Sep 9**

Temporarily edit `data/promo_9_9_collection.json`'s `promoEndDate` to a past timestamp (e.g. `2020-01-01T00:00:00+07:00`), reload both `/collections` (hero should disappear) and `/collections/9-9-collection` (should show the "This promotion has ended" state), then revert the temporary edit (`git checkout -- data/promo_9_9_collection.json`) before finishing.

- [ ] **Step 6: Report results to the user**

Summarize what was verified in the browser, with the actual URLs used, per this repo's Rule 7 ("TypeScript compiles / tests pass is necessary but NOT sufficient — a working UI is the only proof a UI change works").

---

## Notes for the implementer

- This plan was written and should be executed inside the git worktree at `.claude/worktrees/9-9-collection-promo` (branch `worktree-9-9-collection-promo`), isolated from the main checkout's in-progress, unrelated changes.
- Nothing in this plan writes to `products.db` or `data/live_products_export.json` — confirm this stays true throughout (Rule 9/10 spirit, and the spec's explicit Goal).
- If the SKU-match skip list from Task 5 is large, stop and confirm with the user before generating the final JSON — don't silently ship a collection missing a meaningful fraction of the promised items.
