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

const REGION_ALIASES_BY_COUNTRY = {
  usa: {
    napa: 'California',
    'napa valley': 'California',
  },
  scotland: {
    highlands: 'Highland',
    lowlands: 'Lowland',
  },
};

function normGeo(value) {
  return String(value ?? '').trim().toLowerCase();
}

function canonicalRegionForCountry(country, region) {
  const raw = String(region ?? '').trim();
  if (!raw) return '';
  const countryKey = normGeo(country);
  const regionKey = normGeo(raw);
  if (countryKey && countryKey === regionKey) return '';
  return REGION_ALIASES_BY_COUNTRY[countryKey]?.[regionKey] ?? raw;
}

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
 * Pure aggregation. Groups non-excluded products (IN-STOCK *and* out-of-stock) by
 * region NAME and by country NAME, computing fresh totals, per-category_group
 * counts, price ranges, and candidate peeks. Uses the row's backfilled
 * category_group (authoritative).
 *
 * Stock note: the map intentionally counts ALL beverages so its totals reflect the
 * full catalogue (~10.3k), not just the in-stock half (~5.1k). The /shop hand-off
 * (shopHref) therefore must NOT pass inStock=1, so the grid total still equals the
 * map total. The isInStockRaw helper is kept (exported + tested) for the peek
 * ordering / future use, but is NOT a filter here. [count == grid, all-stock axis]
 */
export function aggregate(rows, { excludeGroups = EXCLUDE_GROUPS } = {}) {
  const excluded = new Set(excludeGroups);
  const byRegion = new Map();
  const byCountry = new Map();
  // Region buckets scoped to their COUNTRY. The /shop hand-off filters on
  // {country, region} together, so a region's user-facing total must count only
  // rows of its pinned country — NOT every row sharing the region name. Some
  // region names span countries (verified: California has a mis-tagged Irish gin;
  // Highland/Kentucky/Caribbean span countries too). Keying by "countryregion"
  // here lets main() pick the dominant-country bucket so total == grid by
  // construction. Key delimiter is a NUL byte (can't appear in a name).
  const byRegionCountry = new Map();

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
    // NOTE: no in-stock filter — the map counts all beverages (in + out of stock)
    // by design. See aggregate() docstring; shopHref drops inStock=1 to match.
    const country = (r.country || '').trim();
    const region = canonicalRegionForCountry(country, r.region);
    if (country) bump(byCountry, country, r, group);
    if (region) bump(byRegion, region, r, group);
    if (region && country) bump(byRegionCountry, country + RC_SEP + region, r, group);
  }
  return { byRegion, byCountry, byRegionCountry };
}

// Unambiguous composite-key delimiter for "country<SEP>region" buckets — a NUL
// byte cannot appear in a country or region name, so split/rejoin is exact even
// when names contain spaces (e.g. "South Africa", "Napa Valley").
const RC_SEP = String.fromCharCode(0);

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

/**
 * Region/subregion sommelier descriptions. Two sources, merged:
 *  1. data/taxonomy_descriptions_export.json — exported from taxonomy.db (the
 *     Sonnet-backfilled descriptions for entities that exist in the taxonomy),
 *     PLUS the subregion-name → parent-region structure.
 *  2. SUPPLEMENT_DESCRIPTIONS below — the 6 curated regions that aren't taxonomy
 *     entities (sake regions, Napa, Speyside, Languedoc, Khao Yai), inlined here
 *     because the .mjs can't import the TS region-descriptions.ts (kept in sync by
 *     the same author edit). Name-keyed, lowercase.
 * Descriptions are optional — a region/subregion with none renders without a blurb.
 */
const SUPPLEMENT_DESCRIPTIONS = {
  'speyside': 'Speyside, centered on the River Spey, houses over 50 distilleries. Soft water, cool climate, and local barley define the style. Signature malts—Glenfiddich, Macallan, Glenlivet—trend fruity, honeyed, and lightly peated.',
  'languedoc-roussillon': "France's largest AOC region spans Mediterranean coast to Pyrenees foothills. Grenache, Syrah, Mourvèdre dominate reds; Picpoul and Roussanne whites. Schist and limestone soils. Roussillon specializes in fortified Muscat and Grenache-based vins doux naturels.",
  'napa valley': 'Napa Valley, California, produces Cabernet Sauvignon-dominant wines across 16 sub-AVAs. Volcanic, alluvial, and clay soils vary from valley floor to mountain sites. The 1976 Paris Tasting established its global benchmark status.',
  'niigata': "Niigata, Japan's top sake prefecture, uses soft low-mineral snowmelt water and Gohyakumangoku rice to produce tanrei karakuchi—a distinctively dry, clean, light-bodied style. Home to over 80 kuras; Kubota and Hakkaisan are benchmark producers.",
  'nagano': 'Landlocked mountain prefecture at 700–900m elevation. Cold winters and pure snowmelt water produce clean, high-acid sake. Breweries favor junmai ginjo and daiginjo styles using locally grown Miyamanishiki and Hitogokochi rice.',
  'khao yai': "Khao Yai sits at 400m in central Thailand, 150km northeast of Bangkok. A tropical monsoon climate with defined dry season enables Syrah, Chenin Blanc, and Colombard. GranMonte and Silverlake lead production under Thailand's New Latitude Wine movement.",
};

function loadDescriptions() {
  // region/subregion/country name(lower) -> full text; plus parent-region -> [subregion names]
  const regionDesc = new Map(), subDesc = new Map();
  const subsByRegion = new Map(); // parent region (lower) -> Set of subregion names (original case)
  const c = [
    path.join(process.cwd(), 'data', 'taxonomy_descriptions_export.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy_descriptions_export.json'),
  ].find((p) => p && fs.existsSync(p));
  if (c) {
    const t = JSON.parse(fs.readFileSync(c, 'utf8'));
    for (const [k, v] of Object.entries(t.regions ?? {})) regionDesc.set(k, v.full);
    for (const [k, v] of Object.entries(t.subregions ?? {})) subDesc.set(k, v.full);
  }
  for (const [k, full] of Object.entries(SUPPLEMENT_DESCRIPTIONS)) {
    if (!regionDesc.has(k)) regionDesc.set(k, full);
  }
  // subregion → parent-region structure comes from the taxonomy coords file (it has
  // the hierarchy via slugs); simpler to read it from explore-taxonomy.json here.
  const tx = [
    path.join(process.cwd(), 'data', 'taxonomy', 'explore-taxonomy.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy', 'explore-taxonomy.json'),
  ].find((p) => p && fs.existsSync(p));
  if (tx) {
    const t = JSON.parse(fs.readFileSync(tx, 'utf8'));
    const regionById = new Map((t.regions ?? []).map((r) => [r.id, r.name]));
    for (const s of t.subregions ?? []) {
      const parent = regionById.get(s.parentId);
      if (!parent) continue;
      const pk = parent.trim().toLowerCase();
      if (!subsByRegion.has(pk)) subsByRegion.set(pk, new Set());
      subsByRegion.get(pk).add(s.name);
    }
  }
  return { regionDesc, subDesc, subsByRegion };
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
  const { byRegion, byCountry, byRegionCountry } = aggregate(rows);
  const coords = loadTaxonomyCoords();
  const { regionDesc, subDesc, subsByRegion } = loadDescriptions();

  // Pin each region NAME to its DOMINANT country (the country with the most
  // in-stock-beverage rows for that region), deterministic tie-break by country
  // name. We then build the region hotspot from the {dominantCountry, region}
  // bucket ONLY, so its `total` counts exactly the rows the /shop hand-off
  // (country=…&region=…) will show — total == grid by construction, immune to
  // region names that span countries / mis-tagged rows.
  const countsByRegionCountry = new Map(); // region -> Map(country -> total)
  for (const [composite, agg] of byRegionCountry) {
    const idx = composite.indexOf(RC_SEP);
    const country = composite.slice(0, idx);
    const region = composite.slice(idx + 1);
    let m = countsByRegionCountry.get(region);
    if (!m) { m = new Map(); countsByRegionCountry.set(region, m); }
    m.set(country, agg.total);
  }
  const dominantCountry = new Map(); // region -> country
  for (const [region, m] of countsByRegionCountry) {
    let bestC = '', bestN = -1;
    // Sort country keys for deterministic tie-break (most rows, then name asc).
    for (const c of [...m.keys()].sort()) {
      const n = m.get(c);
      if (n > bestN) { bestN = n; bestC = c; }
    }
    dominantCountry.set(region, bestC);
  }

  let rolledUp = 0;
  const regions = [];
  for (const [name, agg] of byRegion) {
    const key = name.toLowerCase();
    const coord = coords.region.get(key) ?? CENTROIDS[key];
    if (!coord) { rolledUp += 1; continue; }
    const country = dominantCountry.get(name) ?? '';
    // Use the COUNTRY-SCOPED bucket (not the region-name-wide `agg`) so total
    // counts only this country's rows — matching the {country,region} /shop grid.
    const scoped = byRegionCountry.get(country + RC_SEP + name) ?? agg;
    regions.push({
      name, slug: slugify(name), country,
      lat: coord.lat, lng: coord.lng,
      total: scoped.total, countsByGroup: scoped.countsByGroup,
      priceRange: scoped.priceRange, peeks: scoped.peeks,
    });
  }
  const curated = curate(regions);
  const curatedNames = new Set(curated.map((r) => r.name));

  // Attach descriptions + subregion lists to ALL coord-mapped regions (not just
  // curated). The country drill-down shows every coord-mapped region for that
  // country — limiting to curated left USA with only 2 regions when it has 9+.
  for (const r of regions) {
    const key = r.name.toLowerCase();
    const desc = regionDesc.get(key);
    if (desc) r.description = desc;
    const subNames = subsByRegion.get(key);
    if (subNames && subNames.size > 0) {
      r.subregions = [...subNames].sort().map((sn) => {
        const sd = subDesc.get(sn.trim().toLowerCase());
        return sd ? { name: sn, description: sd } : { name: sn };
      });
    }
    // Mark curated regions so the world-view hotspot logic can filter.
    if (curatedNames.has(r.name)) r.curated = true;
  }

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
    regions, countries,
  };
  const dir = path.join(catalogRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'explore-map-data.json');
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log(`gen-explore-map-data: ${regions.length} regions (${curated.length} curated), ${countries.length} countries, ${rolledUp} regions rolled up to country (no coord) -> ${file}`);
}

// Run main() only when invoked directly (not when imported by vitest).
if (process.argv[1] && process.argv[1].endsWith('gen-explore-map-data.mjs')) main();
