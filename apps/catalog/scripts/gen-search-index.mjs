/**
 * gen-search-index.mjs — build-time generator for the static search index.
 *
 * WHY (perf): the ~11.4k-row search index (~1.4 MB JSON) used to be embedded in
 * the root layout and therefore shipped in EVERY page's HTML (home, /shop and
 * all 11,436 product pages were each ~1.5 MB). This script instead writes the
 * index ONCE to public/search-index.json — a single cacheable static asset the
 * SearchOverlay fetches on demand the first time a shopper opens search. Pages
 * drop back to tens of KB; the index costs nothing until someone searches.
 *
 * Wired as the npm "prebuild" lifecycle script, so `npm run build` runs it
 * automatically first (Vercel honours the npm prebuild hook).
 *
 * SAFETY — margin-leak chokepoint: each row is built as a NEW object with ONLY
 * the 4 allowlisted fields {sku,name,brand,region}. We never spread the source
 * product, so no internal field (margin_pct, b2b_margin_pct, price, id,
 * enrichment_*, popularity_*) can ride along into the public static file.
 *
 * Reads the same live export the app reads (CLAUDE.md Rule 9: the UI reads
 * data/live_products_export.json, not the SQLite DB). Probes the known
 * locations + CATALOG_DATA_PATH so it works from both apps/catalog and the
 * repo root (Vercel build cwd).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(__dirname, '..'); // apps/catalog

function resolveExportPath() {
  const candidates = [
    path.join(process.cwd(), 'data', 'live_products_export.json'), // cwd = repo root
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'), // cwd = apps/catalog
    path.join(catalogRoot, '..', '..', 'data', 'live_products_export.json'), // relative to this script
    process.env.CATALOG_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error(
      'gen-search-index: live_products_export.json not found in any known location',
    );
  }
  return found;
}

function main() {
  const file = resolveExportPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(
      `gen-search-index: failed to parse ${file}: ${e.message}`,
    );
  }

  const rows = Array.isArray(raw) ? raw : (raw?.products ?? []);

  // Build each entry explicitly with ONLY the 4 allowlisted fields. Do NOT
  // spread the product — nothing else may leak into the public file.
  const index = [];
  for (const r of rows) {
    if (!r || typeof r.sku !== 'string' || r.sku.length === 0) continue;
    const entry = { sku: r.sku, name: typeof r.name === 'string' ? r.name : '' };
    if (r.brand) entry.brand = r.brand;
    if (r.region) entry.region = r.region;
    index.push(entry);
  }

  const publicDir = path.join(catalogRoot, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const out = path.join(publicDir, 'search-index.json');
  fs.writeFileSync(out, JSON.stringify(index), 'utf8');

  const bytes = fs.statSync(out).size;
  console.log(
    `gen-search-index: wrote ${index.length} entries (${(bytes / 1024 / 1024).toFixed(2)} MB) -> ${out}`,
  );
}

main();
