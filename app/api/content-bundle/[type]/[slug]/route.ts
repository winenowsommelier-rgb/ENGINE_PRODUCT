/**
 * GET /api/content-bundle/{type}/{slug}
 *
 * Returns a landing-page-ready content bundle for a taxonomy entity.
 * Merges data from: Supabase products + SQLite taxonomy + expert library
 * + brand library + explore-taxonomy.json coordinates.
 *
 * Types: country, region, subregion, classification, brand
 * Slug: e.g., "france", "bordeaux", "red-wine", "the-balvenie"
 *
 * Designed for:
 * - Cloud Claude to generate landing page content grounded in real data
 * - Next.js pages to render SEO-optimized region/country/brand pages
 * - External projects building collection/recommendation features
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getSupabaseServerConfig } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const EXPLORE_PATH = join(process.cwd(), 'data/taxonomy/explore-taxonomy.json');
const EXPERT_PATH = join(process.cwd(), 'data/expert_knowledge_library.csv');
const BRAND_LIBRARY_PATH = join(process.cwd(), 'data/brand_description_library.csv');

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
    const { url, headers } = getSupabaseServerConfig();
    const res = await fetch(url + '/rest/v1/' + path, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function sbCount(filter: string): Promise<number> {
  try {
    const { url, headers } = getSupabaseServerConfig();
    const res = await fetch(
      url + '/rest/v1/products?select=id&' + filter + '&limit=1',
      { headers: { ...headers, Prefer: 'count=exact' } }
    );
    return Number(res.headers.get('content-range')?.split('/')[1] || 0);
  } catch { return 0; }
}

// Brand library lookup — JSON-encoded in `notes` column of brand_description_library.csv
let _brandCache: Map<string, any> | null = null;
function getBrandEntry(name: string): any | null {
  if (!_brandCache) {
    _brandCache = new Map();
    if (existsSync(BRAND_LIBRARY_PATH)) {
      const raw = readFileSync(BRAND_LIBRARY_PATH, 'utf-8');
      const lines = raw.split('\n');
      const headers = parseCSVLine(lines[0]);
      // Records may span multiple lines because `notes` is a quoted JSON blob.
      // Fall back to JSON-parsing the notes column when present.
      let buffer = '';
      let inRecord = false;
      const records: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        buffer += (buffer ? '\n' : '') + line;
        const dqCount = (buffer.match(/"/g) || []).length;
        if (dqCount % 2 === 0) {
          if (buffer.trim()) records.push(buffer);
          buffer = '';
        }
      }
      for (const rec of records) {
        const vals = parseCSVLine(rec);
        const entry: any = {};
        headers.forEach(function (h, idx) { entry[h] = vals[idx] || ''; });
        if (entry.entity_type !== 'brand') continue;
        if (entry.source_basis !== 'web_research_validated') continue;
        const name = (entry.entity_name || '').toLowerCase().trim();
        if (name) _brandCache.set(name, entry);
      }
    }
  }
  return _brandCache.get(name.toLowerCase()) || null;
}

function slugifyBrand(name: string): string {
  return String(name).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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
    if (type === 'brand') return handleBrand(slug);

    return NextResponse.json({ error: 'type must be country, region, subregion, classification, or brand' }, { status: 400 });
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

// ── Brand bundle ────────────────────────────────────────────

async function handleBrand(slug: string) {
  // Look up brand by slug — try direct match first, then iterate the cache
  // (CSV stores brand name in entity_name column, slug is computed).
  // Force cache hydration:
  getBrandEntry('__noop__');

  let entry: any = null;
  let canonicalName: string | null = null;
  if (_brandCache) {
    for (const [name, e] of _brandCache.entries()) {
      if (slugifyBrand(name) === slug) {
        entry = e;
        canonicalName = e.entity_name;
        break;
      }
    }
  }

  if (!entry || !canonicalName) {
    return NextResponse.json({ error: 'Brand not found in validated library', slug }, { status: 404 });
  }

  // Parse the JSON-encoded research notes
  let research: any = {};
  let verifier: any = {};
  try {
    const notes = JSON.parse(entry.notes || '{}');
    research = notes.research || {};
    verifier = notes.verifier || {};
  } catch {}

  // Pull SKUs for this brand from Supabase. `is_active` may or may not
  // be a column in Supabase yet — try with it, fall back to without it.
  let skus = await sbQuery(
    'products?brand=eq.' + encodeURIComponent(canonicalName) +
    '&select=id,sku,name,vintage,price,classification,wine_classification,country,region,subregion,grape_variety,image_url,desc_en_short,full_description,wine_body,wine_acidity,wine_tannin,taste_profile,flavor_tags,food_matching,enrichment_quality_grade,enrichment_source,is_active' +
    '&order=price.desc.nullslast&limit=500'
  );
  if (skus.length === 0) {
    // Fallback: column probably doesn't exist on Supabase yet
    skus = await sbQuery(
      'products?brand=eq.' + encodeURIComponent(canonicalName) +
      '&select=id,sku,name,vintage,price,classification,wine_classification,country,region,subregion,grape_variety,image_url,desc_en_short,full_description,wine_body,wine_acidity,wine_tannin,taste_profile,flavor_tags,food_matching,enrichment_quality_grade,enrichment_source' +
      '&order=price.desc.nullslast&limit=500'
    );
  }

  // Stats — prefer active SKUs (when is_active is available); else treat all as active.
  const hasActiveFlag = skus.some(function (s: any) { return s.is_active !== undefined; });
  const activeSkus = hasActiveFlag
    ? skus.filter(function (s: any) { return s.is_active === 1 || s.is_active === true; })
    : skus;
  const prices = activeSkus.map(function (s: any) { return Number(s.price); }).filter(function (p: number) { return Number.isFinite(p) && p > 0; });
  const priceMin = prices.length > 0 ? Math.min(...prices) : null;
  const priceMax = prices.length > 0 ? Math.max(...prices) : null;
  const priceMedian = prices.length > 0 ? prices.sort(function (a: number, b: number) { return a - b; })[Math.floor(prices.length / 2)] : null;

  const classifications = Array.from(new Set(activeSkus.map(function (s: any) { return s.classification; }).filter(Boolean)));
  const regions = Array.from(new Set(activeSkus.map(function (s: any) { return s.region; }).filter(Boolean)));
  const grapes: Record<string, number> = {};
  for (const s of activeSkus) {
    const g = String(s.grape_variety || '').split(',')[0].trim();
    if (g) grapes[g] = (grapes[g] || 0) + 1;
  }
  const topGrapes = Object.entries(grapes).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (e) { return { name: e[0], count: e[1] }; });

  // Featured products — prefer A-grade enriched
  const featured = activeSkus
    .filter(function (s: any) { return s.enrichment_quality_grade === 'A' && s.full_description; })
    .slice(0, 8);
  const fallbackFeatured = featured.length === 0
    ? activeSkus.filter(function (s: any) { return s.full_description; }).slice(0, 8)
    : [];

  return NextResponse.json({
    type: 'brand',
    slug,
    canonicalName,
    parentCountry: entry.parent_country || research.country || null,
    parentRegion: entry.parent_region || research.region || null,
    library: {
      sourceBasis: entry.source_basis,
      copyStatus: entry.copy_status,
      shortDescription: entry.description_short_en || null,
      fullDescription: entry.description_full_en || null,
      productCount: Number(entry.product_count || 0),
      classificationScope: (entry.classification_scope || '').split('|').filter(Boolean),
    },
    research: {
      founded: research.founded || null,
      owner: research.owner || null,
      classification: research.classification || null,
      signatureStyle: research.signature_style || null,
      vineyardOrDistillery: research.vineyard_or_distillery || null,
      winemakingOrProduction: research.winemaking_or_production || null,
      blendTypicalOrRecipe: research.blend_typical_or_recipe || null,
      mustKnow: research.must_know || null,
      vintageNotes: research.vintage_notes || null,
      sources: research.sources || [],
      confidenceSelf: research.confidence_self || null,
      uncertaintyFlags: research.uncertainty_flags || [],
    },
    verifier: {
      finalConfidence: verifier.final_confidence || null,
      criticalFactsVerified: verifier.critical_facts_verified || null,
      criticalFactsSuspect: verifier.critical_facts_suspect || null,
      minorUncertainCount: verifier.minor_uncertain_count || null,
      suspectClaims: verifier.suspect_claims || [],
      verifierNotes: verifier.verifier_notes || null,
      readyForLibrary: verifier.ready_for_library || null,
    },
    stats: {
      totalSkus: skus.length,
      activeSkus: activeSkus.length,
      priceMin,
      priceMax,
      priceMedian,
      classifications,
      regions: regions.slice(0, 12),
      topGrapes,
    },
    featuredProducts: featured.length > 0 ? featured : fallbackFeatured,
    allSkus: activeSkus.map(function (s: any) {
      return {
        id: s.id,
        sku: s.sku,
        name: s.name,
        vintage: s.vintage,
        price: s.price,
        classification: s.classification,
        region: s.region,
        image_url: s.image_url,
        enrichmentGrade: s.enrichment_quality_grade,
      };
    }),
    seoMeta: {
      title: canonicalName + ' — Brand Profile, Heritage & Available Bottles',
      description: entry.description_short_en
        ? entry.description_short_en.slice(0, 155)
        : (canonicalName + ' wines and spirits curated by Wine-Now'),
    },
  });
}
