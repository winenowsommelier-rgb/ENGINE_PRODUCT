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

// MIRROR of SPELLING_ALIASES in lib/geo-aliases.ts (mis-spelling -> canonical form,
// same place at the same level).
const REGION_ALIASES_BY_COUNTRY = {
  scotland: {
    highlands: 'Highland',
    lowlands: 'Lowland',
  },
};

// MIRROR of HIERARCHY_PARENT in lib/geo-aliases.ts (child -> parent NAME, per
// country). A rollup link, NEVER a rewrite — keep it out of the alias table above.
// `?region=California` matches a row at region='Napa Valley' through this chain,
// which is exactly why the hand-off count exceeds a region's own row count.
const HIERARCHY_PARENT_BY_COUNTRY = {
  usa: {
    napa: 'California',
    'napa valley': 'California',
  },
};

/** MIRROR of walkAncestors() in lib/geo-aliases.ts — cycle-safe, bounded at 8. */
function walkAncestors(table, start) {
  const out = [];
  const visited = new Set([start]);
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    const parent = table?.[cursor];
    if (!parent) break;
    const parentKey = normGeo(parent);
    if (visited.has(parentKey)) break;
    visited.add(parentKey);
    out.push(parent);
    cursor = parentKey;
  }
  return out;
}

/** MIRROR of regionMatchesFilter() in lib/geo-aliases.ts. Direct match OR ancestor. */
function regionMatchesFilter(productCountry, productRegion, filterRegion) {
  const want = normGeo(filterRegion);
  const own = normGeo(canonicalRegionForCountry(productCountry, productRegion));
  if (own === want) return true;
  const table = HIERARCHY_PARENT_BY_COUNTRY[normGeo(productCountry)];
  return walkAncestors(table, normGeo(productRegion)).some((a) => normGeo(a) === want);
}

/** MIRROR of isRegionLevelValueForCountry() in lib/geo-aliases.ts (union of BOTH tables). */
function isRegionLevelValueForCountry(country, value) {
  const rawKey = normGeo(value);
  if (!rawKey) return false;
  const countryKey = normGeo(country);
  if (countryKey && countryKey === rawKey) return true;
  const spelling = new Set(Object.values(REGION_ALIASES_BY_COUNTRY[countryKey] ?? {}).map(normGeo));
  const parents = new Set(Object.values(HIERARCHY_PARENT_BY_COUNTRY[countryKey] ?? {}).map(normGeo));
  return spelling.has(rawKey) || parents.has(rawKey);
}

/**
 * THE HAND-OFF COUNT. Mirrors normalizeShopParams() + matchesFilters()' geo clauses
 * from lib/shop-query.ts for the {country, region, subregion} shape shopHref emits.
 *
 * This is what makes `total` true BY CONSTRUCTION: rather than deriving the pin's
 * user-facing number from the node tree (which provably cannot match — /shop's
 * region filter matches ANCESTORS, so `?region=California` returns 620 while the
 * subtree holds 534 and the node itself 191), the generator runs the same predicate
 * the click will run. Returns the count of `rows` a pin's own /shop link would show.
 *
 * The .mjs cannot import the TS module, so this is a hand-mirror; a probe in the
 * invariant test asserts it agrees with the real applyShopQuery at every level.
 */
/**
 * The spelling of `name` as it actually appears in the rows' region/subregion
 * column for this country, or null when the column never carries it. Used to keep
 * the /shop hand-off on the column's spelling rather than the taxonomy's (the two
 * differ by diacritics for Curicó/Limarí Valley). Compared with normGeoName, which
 * is accent-insensitive; returns the raw column value verbatim.
 */
function columnSpelling(rows, level, country, name) {
  const want = normGeoName(name);
  const wantCountry = normGeo(country);
  const field = level === 'subregion' ? 'subregion' : 'region';
  for (const r of rows) {
    if (wantCountry && normGeo(r.country) !== wantCountry) continue;
    const v = String(r[field] ?? '').trim();
    if (v && normGeoName(v) === want) return v;
  }
  return null;
}

function handoffCount(rows, { country, region, subregion }) {
  // --- normalizeShopParams(): region absent => subregion is DROPPED entirely -----
  let qRegion = (region ?? '').trim();
  let qSub = (subregion ?? '').trim();
  if (!qRegion) {
    qSub = '';
  } else {
    const canonical = canonicalRegionForCountry(country, qRegion);
    if (!canonical) {
      // region == country (or empty) — BOTH params are stripped, leaving country-only.
      qRegion = '';
      qSub = '';
    } else if (canonical !== qRegion) {
      qRegion = canonical;
      qSub = '';
    } else if (qSub && isRegionLevelValueForCountry(country, qSub)) {
      qSub = '';
    }
  }

  const wantCountry = normGeo(country);
  const wantSub = normGeo(qSub);
  let n = 0;
  for (const r of rows) {
    if (wantCountry && normGeo(r.country) !== wantCountry) continue;
    if (qRegion && !regionMatchesFilter(r.country, r.region, qRegion)) continue;
    if (wantSub && normGeo(r.subregion) !== wantSub) continue;
    n += 1;
  }
  return n;
}

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
export function aggregate(rows, { excludeGroups = EXCLUDE_GROUPS, resolver = null } = {}) {
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

  // ---- 4-level hierarchy (opt-in: only when a resolver is supplied) ----------
  // nodes: nodeKey(country, pinName) -> node. A row lands in EXACTLY ONE node and
  // increments only that node's `ownTotal`. `inclusiveTotal` is NOT touched here —
  // it is DERIVED after the loop by a single subtree fold, which is what makes
  // ancestor double-counting structurally impossible rather than merely avoided.
  const nodes = new Map();
  // Diagnostic counter of geography VALUES that found no taxonomy entry, keyed by
  // the raw value. Note this is deliberately independent of whether the ROW
  // resolved: a row whose subregion is unknown still resolves (the resolver falls
  // back to its region field), yet the unknown subregion name is exactly what a
  // taxonomy-gap report needs to surface. So we record the miss even on a row-level
  // hit — the counter measures missing taxonomy entries, not dropped rows. No row
  // is ever dropped, so this can never be read as a loss count.
  const unresolved = new Map();
  const noteUnresolved = (name) => {
    const k = String(name ?? '').trim();
    if (!k) return;
    unresolved.set(k, (unresolved.get(k) ?? 0) + 1);
  };

  // Mirrors bump() (price range / peeks / countsByGroup) but increments ownTotal
  // and NEVER inclusiveTotal.
  const bumpNode = (key, r, group, meta) => {
    let n = nodes.get(key);
    if (!n) {
      n = {
        key, name: meta.name, country: meta.country, level: meta.level,
        parentKey: meta.parentKey, parentName: meta.parentName,
        latitude: meta.latitude ?? null, longitude: meta.longitude ?? null,
        slug: meta.slug ?? slugify(meta.name),
        ownTotal: 0, inclusiveTotal: 0,
        countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [],
      };
      nodes.set(key, n);
    }
    n.ownTotal += 1;
    n.countsByGroup[group] = (n.countsByGroup[group] ?? 0) + 1;
    if (typeof r.price === 'number') {
      if (n.priceRange.min === null || r.price < n.priceRange.min) n.priceRange.min = r.price;
      if (n.priceRange.max === null || r.price > n.priceRange.max) n.priceRange.max = r.price;
    }
    if (n.peeks.length < PEEK_LIMIT && r.image_url) n.peeks.push(toPeek(r));
    return n;
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

    // --- 4-level node bucketing (skipped entirely when no resolver: back-compat) ---
    if (!resolver) continue;
    const hit = resolver({ country, region: r.region, subregion: r.subregion });
    // Record a taxonomy GAP whenever the row's most specific geography value did
    // not itself produce the pin. This is independent of whether the ROW resolved:
    // a row with an unknown subregion still resolves via its region field, but the
    // unknown subregion is precisely the missing taxonomy entry worth reporting.
    // Comparing against hit.pinName (not just hit === null) is what catches it.
    const finest = String(r.subregion ?? '').trim() || String(r.region ?? '').trim();
    if (finest && (!hit || normGeoName(hit.pinName) !== normGeoName(finest))) {
      noteUnresolved(finest);
    }
    if (hit) {
      // A REGION-level pin's parent is the COUNTRY, which is not a node in this map
      // (countries live in byCountry). Treat it as a root: parentName ''.
      const parentName = hit.pinLevel === 'region' ? '' : hit.parentName;
      const ownKey = nodeKey(country, hit.pinName);
      let parentKey = parentName ? nodeKey(country, parentName) : null;
      // SELF-PARENT GUARD (verified live: France|Beaujolais, 52 rows). Rows can
      // carry the SAME value in region and subregion ('Beaujolais'/'Beaujolais').
      // The resolver pins at subregion level and takes parentName from the ROW's
      // region field, so parentKey comes out equal to the node's own key. The fold
      // would then add the node's inclusiveTotal into ITSELF — 52 silently became
      // 104, with no crash and no dangling key to notice. Root it instead.
      if (parentKey === ownKey) parentKey = null;
      bumpNode(ownKey, r, group, {
        name: hit.pinName, country, level: hit.pinLevel,
        parentKey, parentName: parentKey ? parentName : '',
        latitude: hit.latitude, longitude: hit.longitude, slug: hit.slug,
      });
      // MISSING-PARENT POLICY: materialize the parent as a real node with
      // ownTotal 0 rather than nulling the child's parentKey.
      //
      // Why this way round: the post-loop fold adds each node's inclusiveTotal into
      // its parent. If the parent is absent and we instead null the parentKey, the
      // whole child branch DETACHES — the parent region's inclusiveTotal silently
      // omits it, and the map under-reports with no error. Materializing a
      // zero-ownTotal placeholder keeps the fold total-preserving: the parent's
      // inclusiveTotal correctly equals the sum of its children even when the
      // parent itself has no rows of its own (a childless-parent branch IS counted).
      // ownTotal stays 0 so Σ ownTotal still equals the row count exactly.
      if (parentKey && !nodes.has(parentKey)) {
        nodes.set(parentKey, {
          key: parentKey, name: parentName, country,
          // A parent named by a subregion/appellation hit is a region in practice;
          // depth only orders the fold, and region(1) is above both child levels.
          level: 'region', parentKey: null, parentName: '',
          latitude: null, longitude: null, slug: slugify(parentName),
          ownTotal: 0, inclusiveTotal: 0,
          countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [],
        });
      }
    } else {
      // MISS: roll the row up to its region, else its country. NEVER drop it.
      // (the unresolved gap was already recorded above, for hits and misses alike)
      const rollupName = region || country;
      if (!rollupName) continue; // no geography at all — cannot pin it anywhere
      bumpNode(nodeKey(country, rollupName), r, group, {
        name: rollupName, country, level: region ? 'region' : 'country',
        parentKey: null, parentName: '',
      });
    }
  }

  // --- DERIVE inclusiveTotal (never incremented per-row) -----------------------
  for (const n of nodes.values()) n.inclusiveTotal = n.ownTotal;
  const deepestFirst = [...nodes.values()]
    .sort((a, b) => (LEVEL_DEPTH[b.level] ?? 0) - (LEVEL_DEPTH[a.level] ?? 0));
  for (const n of deepestFirst) {
    // Belt-and-braces: `parentKey === key` is guarded at insert time, but a
    // self-fold is silent (no crash, no dangling key) and doubles a real count, so
    // refuse it here too rather than trust one site.
    if (!n.parentKey || n.parentKey === n.key) continue;
    const parent = nodes.get(n.parentKey);
    if (parent) parent.inclusiveTotal += n.inclusiveTotal;
  }

  return { byRegion, byCountry, byRegionCountry, nodes, unresolved };
}

/** Copy ONLY allowlisted knowledge keys onto a region (never spread the raw object). */
export function mergeKnowledge(region, knowledge) {
  if (!knowledge) return region;
  const k = {};
  if (Array.isArray(knowledge.grapes) && knowledge.grapes.length) k.grapes = knowledge.grapes;
  if (Array.isArray(knowledge.tiers) && knowledge.tiers.length) k.tiers = knowledge.tiers;
  if (knowledge.attributes && typeof knowledge.attributes === 'object') k.attributes = knowledge.attributes;
  if (typeof knowledge.citation === 'string') k.citation = knowledge.citation;
  if (Object.keys(k).length) region.knowledge = k;
  return region;
}

// Unambiguous composite-key delimiter for "country<SEP>region" buckets — a NUL
// byte cannot appear in a country or region name, so split/rejoin is exact even
// when names contain spaces (e.g. "South Africa", "Napa Valley").
const RC_SEP = String.fromCharCode(0);

/** Node key = country + NUL + pin name. NUL cannot appear in a real name. */
function nodeKey(country, name) { return `${country ?? ''}${RC_SEP}${name}`; }

/** Deepest-first, so a child is folded into its parent before the parent is read. */
const LEVEL_DEPTH = { appellation: 3, subregion: 2, region: 1, country: 0 };

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

function resolveTaxonomyPath() {
  const c = [
    path.join(process.cwd(), 'data', 'taxonomy', 'explore-taxonomy.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy', 'explore-taxonomy.json'),
  ].find((p) => p && fs.existsSync(p));
  if (!c) throw new Error('gen-explore-map-data: explore-taxonomy.json not found');
  return c;
}

function loadTaxonomyCoords() {
  const t = JSON.parse(fs.readFileSync(resolveTaxonomyPath(), 'utf8'));
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
  const regionKnowledge = new Map(); // region name (lower) -> knowledge block (grapes/tiers/attributes/citation)
  const subsByRegion = new Map(); // parent region (lower) -> Set of subregion names (original case)
  const c = [
    path.join(process.cwd(), 'data', 'taxonomy_descriptions_export.json'),
    path.join(catalogRoot, '..', '..', 'data', 'taxonomy_descriptions_export.json'),
  ].find((p) => p && fs.existsSync(p));
  if (c) {
    const t = JSON.parse(fs.readFileSync(c, 'utf8'));
    for (const [k, v] of Object.entries(t.regions ?? {})) { regionDesc.set(k, v.full); regionKnowledge.set(k, v.knowledge); }
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
  return { regionDesc, subDesc, regionKnowledge, subsByRegion };
}

// Hand-authored centroid supplement, inlined (the .mjs can't import the TS module).
// EXPORTED so a parity test can assert it matches lib/explore/region-centroids.ts.
export const CENTROIDS = {
  'niigata': { lat: 37.9, lng: 139.0 }, 'nagano': { lat: 36.2, lng: 138.0 },
  'hyogo': { lat: 34.7, lng: 135.0 }, 'kumamoto': { lat: 32.8, lng: 130.7 },
  'kyoto': { lat: 35.0, lng: 135.8 }, 'yamanashi': { lat: 35.7, lng: 138.6 },
  'napa valley': { lat: 38.5, lng: -122.3 }, 'languedoc-roussillon': { lat: 43.6, lng: 3.4 },
  'maule valley': { lat: -35.7, lng: -71.6 },

  // --- Added 2026-07-27 from the gap report -----------------------------------
  // ONLY genuine PLACES whose centroid is well established. Legal tiers, styles,
  // countries and cities are deliberately NOT here (see the skip list below).
  // The '<name> Prefecture' keys are the SAME places as the bare Japanese keys
  // above; the export writes the long form, which never matched the short key.
  'niigata prefecture': { lat: 37.9, lng: 139.0 },
  'nagano prefecture': { lat: 36.2, lng: 138.0 },
  'kumamoto prefecture': { lat: 32.8, lng: 130.7 },
  'yamanashi prefecture': { lat: 35.7, lng: 138.6 },
  'hyogo prefecture': { lat: 34.7, lng: 135.0 },
  'kyoto prefecture': { lat: 35.0, lng: 135.8 },
  // Penedès — Catalan DO south-west of Barcelona, the Cava heartland.
  'penedes': { lat: 41.4, lng: 1.7 }, 'penedès': { lat: 41.4, lng: 1.7 },
  // Yarra Valley — cool-climate Victorian region ~50km east of Melbourne.
  'yarra valley': { lat: -37.7, lng: 145.5 },
  // Collio — Friulian white-wine hills on the Slovenian border.
  'collio': { lat: 45.95, lng: 13.5 },
  // Tequila — the municipality in Jalisco, Mexico (a real town, not just the spirit).
  'tequila': { lat: 20.88, lng: -103.84 },
  //
  // DELIBERATELY NOT ADDED (high in the gap report, but not map pins):
  //   Scotland / England / Thailand   — COUNTRIES, not regions
  //   London / Kobe / Turin / Angers  — CITIES
  //   Bourgogne / Bordeaux Supérieur  — legal tiers / alternate spellings of an
  //     / Rosso di Montalcino /         existing region, not distinct places
  //     Valpolicella Ripasso
  //   Caribbean / Other Scotland /    — non-specific buckets
  //     Highlands / Strathspey
  //   Barolo / Chianti Classico /     — APPELLATIONS: pinning deferred this phase
  //     Brunello / Châteauneuf-du-      (the appellation column is 8% populated)
  //     Pape / Salento / Haut-Médoc
  //   Bavaria / Colli Orientali del   — real places, but no centroid I am confident
  //     Friuli                          enough to commit; they stay in the gap report.
};

/**
 * MIRROR of apps/catalog/lib/geo-resolve.ts. This file is plain .mjs (runs before
 * tsc) so it CANNOT import the TS module. Parity is enforced by the parity block in
 * lib/__tests__/geo-resolve.test.ts — UPDATE BOTH TOGETHER.
 */

/** NFKD accent strip + punctuation collapse. 'Chateauneuf-du-Pape' -> 'chateauneuf du pape'. */
export function normGeoName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    // Combining diacritical marks (U+0300-U+036F), written ESCAPED on purpose: the
    // literal characters are invisible in editors and silently corrupt on copy-paste,
    // and this function is hand-mirrored from lib/geo-resolve.ts.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function indexGeo(entries) {
  const m = new Map();
  for (const e of entries ?? []) {
    if (typeof e?.latitude !== 'number' || typeof e?.longitude !== 'number') continue;
    const k = normGeoName(e.name);
    if (k && !m.has(k)) m.set(k, e);
  }
  return m;
}

/**
 * Build a resolver over a taxonomy object. Returns null when nothing resolves —
 * the caller then rolls the row up to its country. NEVER drop the row.
 */
export function makeGeoResolver(taxonomy) {
  const byLevel = {
    region: indexGeo(taxonomy.regions),
    subregion: indexGeo(taxonomy.subregions),
    appellation: indexGeo(taxonomy.appellations),
  };

  const node = (level, entry, parentName) => ({
    pinName: entry.name,
    pinLevel: level,
    parentName,
    latitude: entry.latitude,
    longitude: entry.longitude,
    slug: entry.slug ?? normGeoName(entry.name).replace(/ /g, '-'),
  });

  return function resolveGeoNode(row) {
    const region = (row.region ?? '').trim();
    const subregion = (row.subregion ?? '').trim();
    const regionKey = normGeoName(region);
    const subKey = normGeoName(subregion);

    // APPELLATION PINNING IS DEFERRED (Phase A). The appellation lookups that used
    // to sit at the end of both branches are GONE ON PURPOSE — do not "restore" them.
    //
    // Measured 2026-07-27 against the live export: `appellation` is populated on only
    // 956 / 11,934 rows (8%). The resolver pins a row using its region/SUBREGION
    // value, but shopHref hands an appellation pin off as `?appellation=`, which
    // filters a DIFFERENT, 8%-populated column. The two sets barely intersect, so
    // every appellation pin linked to a wrong or empty grid — 0 of 24 reproduced
    // their own total:
    //   Barolo                 own=99 -> grid=75   (99 via subregion, 75 via appellation)
    //   Chianti Classico       own=58 -> grid=35
    //   Brunello di Montalcino own=61 -> grid=0
    //   Haut-Médoc             own=32 -> grid=0
    //   Châteauneuf-du-Pape    own=62 -> grid=0
    // Falling through to the region/subregion fallbacks pins these on the columns
    // that are actually populated. `PinLevel`'s 'appellation' member and the
    // `appellation` filter in shop-query.ts are both KEPT: they are correct and
    // independently useful, they simply have no pin feeding them until the column
    // is backfilled.

    // 1. The subregion field. Try subregions, THEN regions.
    //
    //    The `regions` fallback is LOAD-BEARING, not a nicety. Many values sitting in
    //    the subregion field are classified as REGIONS in the taxonomy:
    //      Sonoma County    -> regions (parent usa)   + a same-named appellation
    //      Barossa Valley   -> regions (parent au)    + a same-named appellation
    //      Colchagua Valley -> regions (parent chile) , no appellation at all
    //    Skipping regions here makes Sonoma's 71 rows resolve to the APPELLATION
    //    entry, so a later invariant queries `appellation=Sonoma County` — and 0 of
    //    those 71 rows have any appellation value. Hard build failure on exactly
    //    the regions this work exists to fix.
    if (subKey) {
      const sub = byLevel.subregion.get(subKey);
      if (sub) return node('subregion', sub, region || (row.country ?? ''));
      const asRegion = byLevel.region.get(subKey);
      // A region-CLASSIFIED value that physically sits in the row's SUBREGION column
      // pins at SUBREGION level, carrying the row's own region as its parent.
      //
      // Pinning it at 'region' (what this did until 2026-07-27) emits `?region=<name>`,
      // which filters the REGION column — where these values never appear. Every such
      // pin linked to an empty grid while holding hundreds of rows:
      //   Colchagua Valley 140 rows -> grid 0   (all at region='Central Valley')
      //   Barossa Valley   125 rows -> grid 0   (all at region='South Australia')
      //   Sonoma County     71 rows -> grid 0   (all at region='California')
      // Emitting {region: <row's region>, subregion: <name>} recovers 140/125/71
      // exactly. The taxonomy's CLASSIFICATION of the place is irrelevant here; what
      // decides the hand-off shape is which COLUMN the value actually occupies.
      if (asRegion) return node('subregion', asRegion, region || (row.country ?? ''));
    }

    // 2. The region field. Regions first, then subregions.
    if (regionKey) {
      const reg = byLevel.region.get(regionKey);
      if (reg) return node('region', reg, row.country ?? '');
      const sub = byLevel.subregion.get(regionKey);
      if (sub) return node('subregion', sub, row.country ?? '');
    }

    return null;
  };
}

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
  // Build the 4-level resolver over the RAW taxonomy (all three coordinate arrays),
  // then hand it to aggregate() so rows bucket into hierarchy nodes rather than
  // collapsing onto their region field.
  const taxonomyRaw = JSON.parse(fs.readFileSync(resolveTaxonomyPath(), 'utf8'));
  const resolver = makeGeoResolver(taxonomyRaw);
  const { byRegion, byCountry, byRegionCountry, nodes, unresolved } = aggregate(rows, { resolver });
  const coords = loadTaxonomyCoords();
  const { regionDesc, subDesc, regionKnowledge, subsByRegion } = loadDescriptions();

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

  // The SAME row subset aggregate() counted (non-excluded beverages, all stock
  // states). handoffCount must run over this set, not `rows`, or the predicate would
  // count Accessories/Events/Cigars that the map never counted.
  const bevRows = rows.filter((r) => r && typeof r.sku === 'string' && r.sku
    && !new Set(EXCLUDE_GROUPS).has(r.category_group || 'Unknown'));

  let rolledUp = 0;
  let suppressedDegenerate = 0;
  let missingParent = 0;
  const regions = [];
  for (const n of nodes.values()) {
    // (3) DEGENERATE PIN SUPPRESSION. A node whose name equals its country can never
    // produce a working link: normalizeShopParams() strips region==country, so the
    // hand-off collapses to country-only and the pin's total would describe a
    // different grid than the one the user lands on. Measured: France/France (62),
    // Italy/Italy (36), USA/USA (20) all returned grid=0 against their own totals.
    if (n.country && normGeo(n.name) === normGeo(n.country)) { suppressedDegenerate += 1; continue; }
    // Same class of defect: a node with NO country. Its hand-off omits country=, so
    // the query matches that region name in EVERY country. Measured: a stray
    // country-less 'Lombardy' row (own=1) produced a pin claiming total=48 by
    // sweeping up Italy's real Lombardy rows, which belong to the Italy/Lombardy pin.
    if (!n.country) { suppressedDegenerate += 1; continue; }

    const key = n.name.toLowerCase();
    // Prefer the node's own taxonomy coords (this is what unlocks Napa/Barolo/
    // Colchagua); fall back to the region index, then the hand-authored centroids.
    const coord = (typeof n.latitude === 'number' && typeof n.longitude === 'number')
      ? { lat: n.latitude, lng: n.longitude }
      : (coords.region.get(key) ?? CENTROIDS[key]);
    if (!coord) { rolledUp += 1; continue; }

    // A subregion pin with no parentName would emit `?subregion=` with NO `?region=`,
    // which normalizeShopParams DROPS — widening the query to the whole country.
    // Measured before this guard: Islay (59 rows) reported total=612, i.e. every
    // Scottish beverage; Beaujolais (52) reported 2,700 — all of France. These arise
    // from the self-parent guard in aggregate() (a row carrying the SAME value in
    // region and subregion gets rooted). Pin them at REGION level instead: the value
    // does sit in the region column for these rows, so `?region=<name>` is both
    // well-formed and accurate. Downgrading beats emitting a country-wide lie.
    const level = (n.level === 'subregion' && !n.parentName) ? 'region' : n.level;
    if (n.level === 'subregion' && !n.parentName) missingParent += 1;

    // (2) `total` IS THE HAND-OFF COUNT, computed with the same predicate shopHref's
    // URL will run. NOT ownTotal and NOT inclusiveTotal — both provably diverge (see
    // handoffCount's docstring). ownTotal/inclusiveTotal are still emitted: the
    // drawer uses them and the subtree test asserts on them.
    // ACCENT RECONCILIATION. The pin name comes from the TAXONOMY, but the /shop
    // filter compares against the raw COLUMN with a plain lowercase match (no NFKD
    // strip). Where the two spellings differ only by diacritics the link finds
    // nothing: taxonomy 'Curicó Valley' vs column 'Curico Valley' (39 rows -> 0),
    // likewise 'Limarí Valley'. The resolver matches these because normGeoName
    // strips accents for LOOKUP — that tolerance must not leak into the hand-off.
    // Emit the spelling the column actually holds so the URL resolves.
    const emitName = columnSpelling(bevRows, level, n.country, n.name) ?? n.name;
    const geo = level === 'subregion'
      ? { region: n.parentName, subregion: emitName }
      : { region: emitName, subregion: '' };
    const total = handoffCount(bevRows, { country: n.country, ...geo });

    regions.push({
      name: emitName, slug: n.slug ?? slugify(n.name), country: n.country,
      lat: coord.lat, lng: coord.lng,
      total,
      ownTotal: n.ownTotal, inclusiveTotal: n.inclusiveTotal,
      pinLevel: level, parentName: level === 'subregion' ? n.parentName : '',
      countsByGroup: n.countsByGroup,
      priceRange: n.priceRange, peeks: n.peeks,
    });
  }
  // SLUG COLLISIONS. `slug` is the identity key for /explore-map/[region], the map
  // click handler, and the chip active-state — but it was derived from the NAME
  // alone. That was safe at 94 region-level pins; adding subregion pins introduced
  // 6 same-name-different-country pairs (Highland Scotland/Mexico, Cognac
  // France/China, Kentucky USA/Taiwan, Sauternes France/Scotland, Douro
  // Portugal/Spain, Islands Scotland/Japan). Left alone, `.find(x => x.slug === …)`
  // returns first-wins, so the loser's detail page is unreachable and React sees a
  // duplicate key in the all-regions list.
  //
  // Keep the FIRST pin (highest ownTotal — regions are pushed in node order, so
  // sort the tie deterministically by country to stay stable across runs) on the
  // bare slug so existing URLs and SEO canonicals for the 178 non-colliding pins
  // do not move, and qualify only the subsequent ones with their country.
  const bySlug = new Map();
  for (const r of regions) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
    bySlug.get(r.slug).push(r);
  }
  let disambiguated = 0;
  for (const [, group] of bySlug) {
    if (group.length < 2) continue;
    // Deterministic winner: most products, then country name — never insertion order.
    group.sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
    for (const r of group.slice(1)) {
      r.slug = `${r.slug}-${slugify(r.country)}`;
      disambiguated += 1;
    }
  }
  if (disambiguated > 0) {
    console.warn(`gen-explore-map-data: disambiguated ${disambiguated} colliding region slug(s) by country`);
  }
  const stillColliding = new Set();
  const seenSlugs = new Set();
  for (const r of regions) {
    if (seenSlugs.has(r.slug)) stillColliding.add(r.slug);
    seenSlugs.add(r.slug);
  }
  if (stillColliding.size > 0) {
    throw new Error(`gen-explore-map-data: unresolved slug collisions: ${[...stillColliding].join(', ')}`);
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
    mergeKnowledge(r, regionKnowledge.get(key));
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
  const byLevelCount = regions.reduce((m, r) => { m[r.pinLevel] = (m[r.pinLevel] ?? 0) + 1; return m; }, {});
  console.log(`gen-explore-map-data: ${regions.length} pins (${byLevelCount.region ?? 0} region, ${byLevelCount.subregion ?? 0} subregion, ${byLevelCount.country ?? 0} country; ${curated.length} curated), ${countries.length} countries, ${rolledUp} nodes rolled up (no coord), ${suppressedDegenerate} degenerate name==country pins suppressed -> ${file}`);

  // Rule 2 — a non-success state on many rows must be EXPLAINED, not left in a log.
  if (missingParent) {
    console.warn(`\ngen-explore-map-data: WARNING — ${missingParent} subregion pin(s) have NO parentName. ` +
      `Their /shop hand-off emits subregion= with no region=, which normalizeShopParams DROPS, ` +
      `silently widening the query to country-only.`);
  }

  // (4) DATA-QUALITY SIGNAL: pins whose own row count differs from the count their
  // /shop link returns. These are genuine data-TAGGING defects, not code bugs, and
  // `total` is correct either way (it IS the grid count). Two known shapes:
  //   - a row tagged region='Napa Valley' with a BLANK subregion (Napa 300 own/299 grid)
  //   - rows filed under the wrong parent (Chablis: 8 rows sit at region='Beaujolais')
  // Region pins legitimately exceed ownTotal via /shop's ancestor+descendant match,
  // so only report where the hand-off UNDER-counts the node's own rows — that is the
  // direction that means rows are unreachable from their own pin.
  const tagging = regions
    .filter((r) => r.total < r.ownTotal)
    .sort((a, b) => (b.ownTotal - b.total) - (a.ownTotal - a.total));
  if (tagging.length) {
    const shown = tagging.slice(0, 20);
    console.log(`\ngen-explore-map-data: ${tagging.length} pin(s) where the /shop hand-off returns FEWER rows than the pin's own row count ` +
      `(ownTotal != total => mis-tagged region/subregion columns). Top ${shown.length}:`);
    for (const r of shown) {
      console.log(`  ${String(r.ownTotal - r.total).padStart(4)} unreachable  ${r.country}/${r.name} [${r.pinLevel}] own=${r.ownTotal} total=${r.total} parent=${r.parentName || '-'}`);
    }
    if (tagging.length > shown.length) console.log(`  ... and ${tagging.length - shown.length} more`);
  }

  // Rule 2 — taxonomy GAP report. NOTE: `unresolved` counts geography VALUES that
  // have no taxonomy entry, independent of whether the ROW resolved (a row with an
  // unknown subregion still resolves via its region field and is never dropped).
  // It is a TAXONOMY-GAP report, NOT a lost-row count. Every row is still counted
  // somewhere — these entries just pin at a coarser level than they could.
  const gaps = [...unresolved.entries()].sort((a, b) => b[1] - a[1]);
  if (gaps.length) {
    const shown = gaps.slice(0, 40);
    console.log(`\ngen-explore-map-data: ${gaps.length} unresolved geo values covering ` +
      `${gaps.reduce((n, g) => n + g[1], 0)} rows (rolled up to parent). Top ${shown.length}:`);
    for (const [name, n] of shown) console.log(`  ${String(n).padStart(5)}  ${name}`);
    if (gaps.length > shown.length) console.log(`  ... and ${gaps.length - shown.length} more`);
  }
}

// Run main() only when invoked directly (not when imported by vitest).
if (process.argv[1] && process.argv[1].endsWith('gen-explore-map-data.mjs')) main();
