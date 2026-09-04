/**
 * gen-9-9-collection.mjs — One-off generator: 9.9 promo CSVs -> data/promo_9_9_collection.json
 *
 * Plain Node .mjs (runs before tsc) so it CANNOT import TS modules.
 * Parsing helpers are exported for unit testing (TDD).
 *
 * Run manually: node scripts/gen-9-9-collection.mjs
 * Re-run whenever corrected source CSVs are supplied (e.g. fixing #REF! rows).
 */
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
