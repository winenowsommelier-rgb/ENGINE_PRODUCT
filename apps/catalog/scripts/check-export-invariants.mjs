/**
 * check-export-invariants.mjs — build-time data guard (runs in Vercel prebuild).
 *
 * WHY: special_price reaches the storefront ONLY via data/live_products_export.json.
 * A stale/parallel refresh that regenerates the export WITHOUT special_price would
 * silently remove every sale price from the live catalog with no warning — the
 * CLAUDE.md Rule 1/6 failure class. This actually happened in dev (a parallel
 * process produced a 0-sale export).
 *
 * This is the CI we have: GitHub Actions runners won't start on this account, but
 * EVERY deploy runs the Vercel build, and `prebuild` runs first. If this guard
 * throws, the build fails and the bad export NEVER reaches production. It mirrors
 * tests/test_special_price_export_invariant.py::test_committed_export_has_sale_prices.
 *
 * Reads the same export the app reads (CLAUDE.md Rule 9), with the same path
 * probing as gen-search-index.mjs so it works from the repo root (Vercel cwd)
 * and apps/catalog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(__dirname, '..'); // apps/catalog

// Floor for genuine sale rows in the committed export. The export currently
// carries 1,028; require well above zero but tolerant of normal promo churn, so
// a dropped column (→ ~0) fails the build while routine promo changes do not.
const MIN_SALE_ROWS = 100;

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
      'check-export-invariants: live_products_export.json not found in any known location',
    );
  }
  return found;
}

// Genuine sale = a positive special_price strictly below the regular price.
// Matches the storefront's resolveSale(), so we count the SAME rows the UI would
// actually render a discount for.
function isGenuineSale(p) {
  const price = Number(p.price);
  const special = Number(p.special_price);
  if (!Number.isFinite(price) || !Number.isFinite(special)) return false;
  return special > 0 && special < price;
}

function main() {
  const file = resolveExportPath();
  let rows;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows = Array.isArray(raw) ? raw : (raw?.products ?? []);
  } catch (e) {
    throw new Error(`check-export-invariants: failed to parse ${file}: ${e.message}`);
  }

  const saleRows = rows.filter(isGenuineSale).length;
  if (saleRows < MIN_SALE_ROWS) {
    throw new Error(
      `check-export-invariants: export has only ${saleRows} genuine sale prices ` +
        `(expected >= ${MIN_SALE_ROWS}). A refresh likely dropped special_price — ` +
        `sale prices would vanish from the storefront. Re-run ` +
        `scripts/refresh_live_export.py against data/db/products.db and re-commit ` +
        `the export. (${file})`,
    );
  }

  console.log(
    `check-export-invariants: OK — ${saleRows} genuine sale prices in the export.`,
  );
}

main();
