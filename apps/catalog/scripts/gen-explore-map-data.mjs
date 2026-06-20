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

const CURATE_CAP = 22;
const CURATE_MIN_DEPTH = 30;
// Lens -> category_group(s), mirrored from lib/explore/map-data.ts. ONE group per
// lens (count==grid). Keep in sync with that module (a parity-style guard exists).
const LENS_GROUPS = { wine: ['Wine'], whisky: ['Whisky'], spirits: ['Spirits'], sake: ['Sake & Asian'] };

function resolveExportPath() {
  const c = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
    path.join(catalogRoot, '..', '..', 'data', 'live_products_export.json'),
    process.env.CATALOG_DATA_PATH ?? '',
  ].find((p) => p && fs.existsSync(p));
  if (!c) throw new Error('gen-explore-map-data: live_products_export.json not found');
  return c;
}

function loadTaxonomyCoords() {
  const c = [
    path.join(process.cwd(), 'data', 'taxonomy', 'explore-taxonomy.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy', 'explore-taxonomy.json'),
  ].find((p) => p && fs.existsSync(p));
  if (!c) throw new Error('gen-explore-map-data: explore-taxonomy.json not found');
  const t = JSON.parse(fs.readFileSync(c, 'utf8'));
  const region = new Map(), country = new Map();
  for (const r of t.regions ?? []) if (r.latitude) region.set(r.name.trim().toLowerCase(), { lat: r.latitude, lng: r.longitude, slug: r.slug });
  for (const c2 of t.countries ?? []) if (c2.latitude) country.set(c2.name.trim().toLowerCase(), { lat: c2.latitude, lng: c2.longitude, slug: c2.slug });
  return { region, country };
}

// Hand-authored centroid supplement, inlined (the .mjs can't import the TS module).
// EXPORTED so a parity test can assert it matches lib/explore/region-centroids.ts.
export const CENTROIDS = {
  'niigata': { lat: 37.9, lng: 139.0 }, 'nagano': { lat: 36.2, lng: 138.0 },
  'hyogo': { lat: 34.7, lng: 135.0 }, 'kumamoto': { lat: 32.8, lng: 130.7 },
  'kyoto': { lat: 35.0, lng: 135.8 }, 'yamanashi': { lat: 35.7, lng: 138.6 },
  'napa valley': { lat: 38.5, lng: -122.3 }, 'languedoc-roussillon': { lat: 43.6, lng: 3.4 },
  'maule valley': { lat: -35.7, lng: -71.6 },
};

function slugify(s) { return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function curate(regions) {
  const sorted = [...regions].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const picked = sorted.filter((r) => r.total >= CURATE_MIN_DEPTH).slice(0, CURATE_CAP);
  const pickedSet = new Set(picked.map((r) => r.name));
  for (const [, groups] of Object.entries(LENS_GROUPS)) {
    const lensCount = (r) => groups.reduce((n, g) => n + (r.countsByGroup[g] ?? 0), 0);
    if (picked.some((r) => lensCount(r) > 0)) continue;
    const best = sorted.find((r) => lensCount(r) > 0 && !pickedSet.has(r.name));
    if (!best) continue;
    if (picked.length >= CURATE_CAP) {
      const drop = picked.reduce((lo, r) => (r.total < lo.total ? r : lo), picked[0]);
      picked.splice(picked.indexOf(drop), 1); pickedSet.delete(drop.name);
    }
    picked.push(best); pickedSet.add(best.name);
  }
  return picked;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(resolveExportPath(), 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw?.products ?? []);
  const { byRegion, byCountry } = aggregate(rows);
  const coords = loadTaxonomyCoords();

  const regionCountry = new Map();
  for (const r of rows) {
    const rg = (r.region || '').trim(), co = (r.country || '').trim();
    if (rg && co && !regionCountry.has(rg)) regionCountry.set(rg, co);
  }

  let rolledUp = 0;
  const regions = [];
  for (const [name, agg] of byRegion) {
    const key = name.toLowerCase();
    const coord = coords.region.get(key) ?? CENTROIDS[key];
    if (!coord) { rolledUp += 1; continue; }
    regions.push({
      name, slug: slugify(name), country: regionCountry.get(name) ?? '',
      lat: coord.lat, lng: coord.lng, ...agg,
    });
  }
  const curated = curate(regions);

  const countries = [];
  for (const [name, agg] of byCountry) {
    const coord = coords.country.get(name.toLowerCase());
    if (!coord) continue;
    countries.push({ name, slug: slugify(name), lat: coord.lat, lng: coord.lng, total: agg.total, countsByGroup: agg.countsByGroup });
  }

  const out = {
    _meta: {
      generated: new Date().toISOString(),
      totalMapped: [...byRegion.values()].reduce((n, a) => n + a.total, 0),
      rolledUpRegions: rolledUp, curatedCount: curated.length,
    },
    regions: curated, countries,
  };
  const dir = path.join(catalogRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'explore-map-data.json');
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log(`gen-explore-map-data: ${curated.length} curated regions, ${countries.length} countries, ${rolledUp} regions rolled up to country (no coord) -> ${file}`);
}

// Run main() only when invoked directly (not when imported by vitest).
if (process.argv[1] && process.argv[1].endsWith('gen-explore-map-data.mjs')) main();
