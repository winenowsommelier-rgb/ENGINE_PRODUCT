/**
 * gen-explore-map-data.mjs — prebuild generator for the Explore-by-Region atlas.
 *
 * Plain Node .mjs (runs before tsc) so it CANNOT import the TS catalog loaders;
 * it re-reads the raw export and hand-builds allowlisted objects, exactly like
 * gen-search-index.mjs. Anti-drift/margin-safety is enforced by tests
 * (explore-map-gen.test.ts + explore-map.invariant.test.ts), not by code reuse.
 *
 * Exports the pure `aggregate()` core for unit testing; main() does file IO (added later).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(__dirname, '..');

const EXCLUDE_GROUPS = ['Accessories', 'Events', 'Cigars', 'Non-Alcoholic'];
const PEEK_LIMIT = 6;

/** is_in_stock is a STRING "0"/"1"/null in the export. "0" is truthy in JS — coerce. */
export function isInStockRaw(v) {
  return String(v ?? '').trim() === '1';
}

/** Build a margin-safe peek object — ONLY the 4 allowlisted fields, never spread. */
function toPeek(r) {
  const peek = { sku: r.sku, name: typeof r.name === 'string' ? r.name : '' };
  if (typeof r.price === 'number') peek.price = r.price;
  else peek.price = null;
  if (r.image_url) peek.image_url = r.image_url;
  return peek;
}

/**
 * Pure aggregation. Groups IN-STOCK, non-excluded products by region NAME and by
 * country NAME, computing fresh totals, per-category_group counts, price ranges,
 * and candidate peeks. Uses the row's backfilled category_group (authoritative).
 */
export function aggregate(rows, { excludeGroups = EXCLUDE_GROUPS } = {}) {
  const excluded = new Set(excludeGroups);
  const byRegion = new Map();
  const byCountry = new Map();

  const bump = (map, key, r, group) => {
    let agg = map.get(key);
    if (!agg) {
      agg = { total: 0, countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [] };
      map.set(key, agg);
    }
    agg.total += 1;
    agg.countsByGroup[group] = (agg.countsByGroup[group] ?? 0) + 1;
    if (typeof r.price === 'number') {
      if (agg.priceRange.min === null || r.price < agg.priceRange.min) agg.priceRange.min = r.price;
      if (agg.priceRange.max === null || r.price > agg.priceRange.max) agg.priceRange.max = r.price;
    }
    if (agg.peeks.length < PEEK_LIMIT && r.image_url) agg.peeks.push(toPeek(r));
  };

  for (const r of rows) {
    if (!r || typeof r.sku !== 'string' || !r.sku) continue;
    const group = r.category_group || 'Unknown';
    if (excluded.has(group)) continue;
    if (!isInStockRaw(r.is_in_stock)) continue;
    const region = (r.region || '').trim();
    const country = (r.country || '').trim();
    if (country) bump(byCountry, country, r, group);
    if (region) bump(byRegion, region, r, group);
  }
  return { byRegion, byCountry };
}
