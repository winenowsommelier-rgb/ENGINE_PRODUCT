/**
 * GET /api/content-bundle/{type}/{slug}
 *
 * Returns a landing-page-ready content bundle for a taxonomy entity.
 * Merges data from: Supabase products + SQLite taxonomy + expert library
 * + explore-taxonomy.json coordinates.
 *
 * Types: country, region, subregion, classification
 * Slug: e.g., "france", "bordeaux", "red-wine"
 *
 * Designed for:
 * - Cloud Claude to generate landing page content grounded in real data
 * - Next.js pages to render SEO-optimized region/country pages
 * - External projects building collection/recommendation features
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const EXPLORE_PATH = join(process.cwd(), 'data/taxonomy/explore-taxonomy.json');
const EXPERT_PATH = join(process.cwd(), 'data/expert_knowledge_library.csv');

// ── Helpers ──────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

let _exploreTax: any = null;
function getExploreTax() {
  if (!_exploreTax && existsSync(EXPLORE_PATH)) {
    _exploreTax = JSON.parse(readFileSync(EXPLORE_PATH, 'utf-8'));
  }
  return _exploreTax;
}

let _expertCache: Map<string, any> | null = null;
function getExpertEntry(type: string, name: string): any | null {
  if (!_expertCache) {
    _expertCache = new Map();
    if (existsSync(EXPERT_PATH)) {
      const lines = readFileSync(EXPERT_PATH, 'utf-8').split('\n');
      const headers = parseCSVLine(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = parseCSVLine(lines[i]);
        const entry: any = {};
        headers.forEach(function (h, idx) { entry[h] = vals[idx] || ''; });
        _expertCache.set(entry.pack_type + '|' + entry.canonical_name.toLowerCase(), entry);
      }
    }
  }
  return _expertCache.get(type + '|' + name.toLowerCase()) || null;
}

async function sbQuery(path: string): Promise<any[]> {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: SB_HEADERS });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function sbCount(filter: string): Promise<number> {
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/products?select=id&' + filter + '&limit=1',
      { headers: { ...SB_HEADERS, Prefer: 'count=exact' } }
    );
    return Number(res.headers.get('content-range')?.split('/')[1] || 0);
  } catch { return 0; }
}

// ── Main handler ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { type: string; slug: string } }
) {
  try {
    const { type, slug } = params;
    const tax = getExploreTax();

    if (type === 'country') return handleCountry(slug, tax);
    if (type === 'region') return handleRegion(slug, tax);
    if (type === 'subregion') return handleSubregion(slug, tax);
    if (type === 'classification') return handleClassification(slug);

    return NextResponse.json({ error: 'type must be country, region, subregion, or classification' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Country bundle ──────────────────────────────────────────

async function handleCountry(slug: string, tax: any) {
  const entity = tax?.countries?.find(function (c: any) { return c.slug === slug; });
  if (!entity) return NextResponse.json({ error: 'Country not found' }, { status: 404 });

  const expert = getExpertEntry('country', entity.name);
  const regions = (tax?.regions || [])
    .filter(function (r: any) { return r.parentId === entity.id && !r.nonGeographic; })
    .sort(function (a: any, b: any) { return b.counts.total - a.counts.total; });

  // Top products
  const products = await sbQuery(
    'products?country=eq.' + encodeURIComponent(entity.name) +
    '&select=sku,name,brand,classification,grape_variety,region,price,vintage' +
    '&order=price.desc.nullslast&limit=10'
  );

  // Grape distribution
  const grapeRows = await sbQuery(
    'products?country=eq.' + encodeURIComponent(entity.name) +
    '&grape_variety=not.is.null&grape_variety=neq.' +
    '&select=grape_variety&limit=500'
  );
  const grapeCounts: Record<string, number> = {};
  for (var r of grapeRows) {
    var g = String(r.grape_variety).split(',')[0].trim();
    if (g) grapeCounts[g] = (grapeCounts[g] || 0) + 1;
  }
  var keyGrapes = Object.entries(grapeCounts).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (e) { return e[0]; });

  return NextResponse.json({
    type: 'country',
    name: entity.name,
    slug: entity.slug,
    coords: { lat: entity.latitude, lng: entity.longitude },
    description: {
      short: expert?.knowledge_short_en || null,
      full: expert?.knowledge_full_en || null,
      source: expert ? 'expert_library' : null,
    },
    counts: entity.counts,
    priceRange: entity.priceRange,
    keyGrapes: keyGrapes,
    keyRegions: regions.slice(0, 10).map(function (r: any) {
      return { name: r.name, slug: r.slug, total: r.counts.total, coords: { lat: r.latitude, lng: r.longitude } };
    }),
    productHighlights: products.slice(0, 5),
    allProducts: products,
    relatedCountries: (tax?.countries || [])
      .filter(function (c: any) { return c.id !== entity.id && c.counts.total > 0; })
      .sort(function (a: any, b: any) { return b.counts.total - a.counts.total; })
      .slice(0, 5)
      .map(function (c: any) { return { name: c.name, slug: c.slug, total: c.counts.total }; }),
    seo: {
      title: entity.name + ' Wines & Spirits — ' + entity.counts.total + ' Products',
      description: expert?.knowledge_short_en || entity.name + ' — explore ' + entity.counts.total + ' products',
    },
    expertMeta: expert ? {
      signatureVarieties: expert.signature_varieties_or_styles,
      signatureRegions: expert.signature_regions_or_appellations,
      houseTraits: expert.house_or_category_traits,
      useCases: expert.use_cases,
      confidence: expert.confidence_level,
    } : null,
  });
}

// ── Region bundle ───────────────────────────────────────────

async function handleRegion(slug: string, tax: any) {
  const entity = tax?.regions?.find(function (r: any) { return r.slug === slug; });
  if (!entity) return NextResponse.json({ error: 'Region not found' }, { status: 404 });

  const country = tax?.countries?.find(function (c: any) { return c.id === entity.parentId; });
  const expert = getExpertEntry('region', entity.name);
  const subregions = (tax?.subregions || [])
    .filter(function (s: any) { return s.parentId === entity.id; })
    .sort(function (a: any, b: any) { return b.counts.total - a.counts.total; });

  var products = await sbQuery(
    'products?region=eq.' + encodeURIComponent(entity.name) +
    '&select=sku,name,brand,classification,grape_variety,subregion,price,vintage' +
    '&order=price.desc.nullslast&limit=10'
  );

  // If few products by region name, try country-level for this region
  if (products.length < 3 && country) {
    var moreProducts = await sbQuery(
      'products?country=eq.' + encodeURIComponent(country.name) +
      '&select=sku,name,brand,classification,grape_variety,region,subregion,price,vintage' +
      '&order=price.desc.nullslast&limit=10'
    );
    if (moreProducts.length > products.length) products = moreProducts;
  }

  var grapeRows = await sbQuery(
    'products?region=eq.' + encodeURIComponent(entity.name) +
    '&grape_variety=not.is.null&grape_variety=neq.' +
    '&select=grape_variety&limit=200'
  );
  var grapeCounts: Record<string, number> = {};
  for (var r of grapeRows) {
    var g = String(r.grape_variety).split(',')[0].trim();
    if (g) grapeCounts[g] = (grapeCounts[g] || 0) + 1;
  }
  var keyGrapes = Object.entries(grapeCounts).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (e) { return e[0]; });

  // Sibling regions
  var siblings = (tax?.regions || [])
    .filter(function (r: any) { return r.parentId === entity.parentId && r.id !== entity.id && !r.nonGeographic; })
    .sort(function (a: any, b: any) { return b.counts.total - a.counts.total; })
    .slice(0, 6);

  return NextResponse.json({
    type: 'region',
    name: entity.name,
    slug: entity.slug,
    country: country ? { name: country.name, slug: country.slug } : null,
    coords: { lat: entity.latitude, lng: entity.longitude },
    description: {
      short: expert?.knowledge_short_en || null,
      full: expert?.knowledge_full_en || null,
      source: expert ? 'expert_library' : null,
    },
    counts: entity.counts,
    priceRange: entity.priceRange,
    keyGrapes: keyGrapes,
    keySubregions: subregions.slice(0, 10).map(function (s: any) {
      return { name: s.name, slug: s.slug, total: s.counts.total, coords: { lat: s.latitude, lng: s.longitude } };
    }),
    productHighlights: products.slice(0, 5),
    allProducts: products,
    relatedRegions: siblings.map(function (r: any) {
      return { name: r.name, slug: r.slug, total: r.counts.total };
    }),
    seo: {
      title: entity.name + ' — ' + (country?.name || '') + ' — ' + entity.counts.total + ' Products',
      description: expert?.knowledge_short_en || entity.name + ', ' + (country?.name || '') + ' — explore ' + entity.counts.total + ' products',
    },
    expertMeta: expert ? {
      signatureVarieties: expert.signature_varieties_or_styles,
      signatureRegions: expert.signature_regions_or_appellations,
      houseTraits: expert.house_or_category_traits,
      useCases: expert.use_cases,
      confidence: expert.confidence_level,
    } : null,
  });
}

// ── Subregion bundle ────────────────────────────────────────

async function handleSubregion(slug: string, tax: any) {
  var entity = tax?.subregions?.find(function (s: any) { return s.slug === slug; });
  if (!entity) return NextResponse.json({ error: 'Subregion not found' }, { status: 404 });

  var region = tax?.regions?.find(function (r: any) { return r.id === entity.parentId; });
  var country = tax?.countries?.find(function (c: any) { return c.id === entity.grandparentId; });

  var products = await sbQuery(
    'products?subregion=ilike.*' + encodeURIComponent(entity.name) + '*' +
    '&select=sku,name,brand,classification,grape_variety,price,vintage' +
    '&order=price.desc.nullslast&limit=10'
  );

  return NextResponse.json({
    type: 'subregion',
    name: entity.name,
    slug: entity.slug,
    region: region ? { name: region.name, slug: region.slug } : null,
    country: country ? { name: country.name, slug: country.slug } : null,
    coords: { lat: entity.latitude, lng: entity.longitude },
    counts: entity.counts,
    priceRange: entity.priceRange,
    productHighlights: products.slice(0, 5),
    allProducts: products,
    seo: {
      title: entity.name + ' — ' + (region?.name || '') + ', ' + (country?.name || ''),
      description: 'Explore products from ' + entity.name + ', ' + (region?.name || '') + ', ' + (country?.name || ''),
    },
  });
}

// ── Classification bundle ───────────────────────────────────

async function handleClassification(slug: string) {
  var name = slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  var expert = getExpertEntry('classification', name);

  var totalCount = await sbCount('classification=ilike.' + encodeURIComponent(name));

  var products = await sbQuery(
    'products?classification=ilike.' + encodeURIComponent(name) +
    '&select=sku,name,brand,country,region,grape_variety,price,vintage' +
    '&order=price.desc.nullslast&limit=10'
  );

  // Top countries for this classification
  var countryRows = await sbQuery(
    'products?classification=ilike.' + encodeURIComponent(name) +
    '&country=not.is.null&country=neq.' +
    '&select=country&limit=1000'
  );
  var countryCounts: Record<string, number> = {};
  for (var r of countryRows) {
    countryCounts[r.country] = (countryCounts[r.country] || 0) + 1;
  }
  var topCountries = Object.entries(countryCounts).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);

  return NextResponse.json({
    type: 'classification',
    name: name,
    slug: slug,
    description: {
      short: expert?.knowledge_short_en || null,
      full: expert?.knowledge_full_en || null,
      source: expert ? 'expert_library' : null,
    },
    totalProducts: totalCount,
    topCountries: topCountries.map(function (e) { return { name: e[0], count: e[1] }; }),
    productHighlights: products.slice(0, 5),
    allProducts: products,
    seo: {
      title: name + ' — ' + totalCount + ' Products',
      description: expert?.knowledge_short_en || 'Browse ' + totalCount + ' ' + name + ' products',
    },
    expertMeta: expert ? {
      signatureVarieties: expert.signature_varieties_or_styles,
      houseTraits: expert.house_or_category_traits,
      useCases: expert.use_cases,
      confidence: expert.confidence_level,
    } : null,
  });
}
