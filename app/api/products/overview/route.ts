/**
 * GET /api/products/overview
 *
 * Returns a comprehensive data summary for team members, external projects,
 * and AI agents to understand the product catalog state at a glance.
 *
 * Includes: schema, counts, data quality, coverage gaps, top values per field.
 * No authentication required — returns aggregate data only, no individual records.
 */
import { NextResponse } from 'next/server';
import { readProducts } from '@/lib/db/client';
import { getSupabaseServerConfig } from '@/lib/supabase/server';

export const runtime = 'nodejs';

async function supabaseGet(path: string) {
  const { url, headers } = getSupabaseServerConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function countWhere(filter: string): Promise<number> {
  const { url, headers } = getSupabaseServerConfig();
  const res = await fetch(
    `${url}/rest/v1/products?select=id&${filter}&limit=1`,
    { headers: { ...headers, Prefer: 'count=exact' } }
  );
  const range = res.headers.get('content-range') ?? '*/0';
  return Number(range.split('/')[1] || 0);
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function countFilled(products: any[], field: string) {
  return products.filter(product => hasValue(product[field])).length;
}

function pct(filled: number, total: number) {
  return total > 0 ? Math.round((filled / total) * 100) : 0;
}

function topValues(products: any[], field: string) {
  const counts = new Map<string, number>();
  for (const product of products) {
    const value = String(product[field] ?? '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
}

async function buildLocalOverview(reason: string) {
  const products = await readProducts();
  const total = products.length;
  const validated = products.filter(p => p.validation_status === 'validated').length;
  const needsReview = products.filter(p => p.validation_status === 'needs_review').length;
  const needsAttention = products.filter(p => p.validation_status === 'needs_attention').length;
  const wine = products.filter(p => String(p.sku ?? '').startsWith('W')).length;
  const spirits = products.filter(p => String(p.sku ?? '').startsWith('L')).length;
  const beer = products.filter(p => String(p.sku ?? '').startsWith('LBE')).length;
  const accessories = products.filter(p => /^[AGN]/.test(String(p.sku ?? ''))).length;

  const prices = products
    .map(p => Number(p.price))
    .filter(price => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  const priceStats = prices.length > 0 ? {
    min: prices[0],
    max: prices[prices.length - 1],
    median: prices[Math.floor(prices.length / 2)],
    avg: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    count: prices.length,
  } : null;

  const fields = {
    country: countFilled(products, 'country'),
    region: countFilled(products, 'region'),
    grape_variety: countFilled(products, 'grape_variety'),
    brand: countFilled(products, 'brand'),
    vintage: countFilled(products, 'vintage'),
    price: countFilled(products, 'price'),
    full_description: countFilled(products, 'full_description'),
    flavor_profile: countFilled(products, 'flavor_profile'),
  };

  return {
    _meta: {
      generated: new Date().toISOString(),
      description: 'WNLQ9 Product Intelligence Database — local catalog fallback overview',
      baseUrl: 'http://localhost:3000',
      source: 'local_json',
      fallbackReason: reason,
    },
    counts: {
      total,
      byStatus: {
        validated,
        needs_review: needsReview,
        needs_attention: needsAttention,
        other: total - validated - needsReview - needsAttention,
      },
      bySegment: {
        wine,
        spirits,
        beer,
        accessories,
        other: total - wine - spirits - beer - accessories,
      },
    },
    coverage: {
      description: 'Percentage of products with non-empty values for key fields',
      fields: Object.fromEntries(
        Object.entries(fields).map(([field, filled]) => [
          field,
          { filled, total, pct: pct(filled, total) },
        ])
      ),
    },
    inventory: {
      in_stock_items: products.filter(p => Number(p.quantity_in_stock ?? 0) > 0).length,
      total_quantity: products.reduce((sum, p) => sum + Number(p.quantity_in_stock ?? 0), 0),
      stock_source: 'WN Stock when available, otherwise is_in_stock availability proxy',
    },
    pricing: priceStats ? { currency: 'THB', ...priceStats } : null,
    topCountries: topValues(products, 'country'),
  };
}

export async function GET() {
  try {
    const localProducts = await readProducts();
    const inventory = {
      in_stock_items: localProducts.filter(p => Number(p.quantity_in_stock ?? 0) > 0).length,
      total_quantity: localProducts.reduce((sum, p) => sum + Number(p.quantity_in_stock ?? 0), 0),
      stock_source: 'WN Stock when available, otherwise is_in_stock availability proxy',
    };

    // Total count
    const total = await countWhere('id=not.is.null');
    const validated = await countWhere('validation_status=eq.validated');
    const needsReview = await countWhere('validation_status=eq.needs_review');
    const needsAttention = await countWhere('validation_status=eq.needs_attention');

    // Segment counts (by SKU prefix)
    const wine = await countWhere('sku=like.W*');
    const spirits = await countWhere('sku=like.L*');
    const beer = await countWhere('sku=like.LBE*');
    const accessories = await countWhere('or=(sku.like.A*,sku.like.G*,sku.like.N*)');

    // Coverage — count non-empty fields
    const hasCountry = await countWhere('country=not.is.null&country=neq.');
    const hasRegion = await countWhere('region=not.is.null&region=neq.');
    const hasGrape = await countWhere('grape_variety=not.is.null&grape_variety=neq.');
    const hasPrice = await countWhere('price=not.is.null');
    const hasBrand = await countWhere('brand=not.is.null&brand=neq.');
    const hasVintage = await countWhere('vintage=not.is.null&vintage=neq.');
    const hasDescription = await countWhere('full_description=not.is.null&full_description=neq.');
    const hasFlavorProfile = await countWhere('flavor_profile=not.is.null&flavor_profile=neq.');

    // Top countries (sample for context)
    const topCountries: any[] = await supabaseGet(
      'products?select=country&country=not.is.null&country=neq.&order=country.asc&limit=5000'
    );
    const countryCounts: Record<string, number> = {};
    for (const r of topCountries) {
      const c = r.country;
      countryCounts[c] = (countryCounts[c] || 0) + 1;
    }
    const sortedCountries = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    // Price stats
    const priceRows: any[] = await supabaseGet(
      'products?select=price&price=not.is.null&price=gt.0&order=price.asc&limit=5000'
    );
    const prices = priceRows.map(r => r.price).filter(Boolean).sort((a: number, b: number) => a - b);
    const priceStats = prices.length > 0 ? {
      min: prices[0],
      max: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
      avg: Math.round(prices.reduce((s: number, p: number) => s + p, 0) / prices.length),
      count: prices.length,
    } : null;

    return NextResponse.json({
      _meta: {
        generated: new Date().toISOString(),
        description: 'WNLQ9 Product Intelligence Database — comprehensive overview for team and AI collaboration',
        baseUrl: 'http://localhost:3000',
      },

      schema: {
        description: 'Product intelligence records with enrichment from AI and rules engine',
        keyFields: {
          identity: ['sku', 'name', 'brand', 'bottle_size', 'vintage', 'alcohol'],
          classification: ['classification', 'wine_classification', 'grape_variety'],
          geography: ['country', 'region', 'subregion', 'appellation'],
          tasting: ['wine_body', 'wine_acidity', 'wine_tannin', 'food_matching', 'flavor_tags', 'flavor_profile'],
          pricing: ['price', 'cost', 'currency', 'special_price'],
          quality: ['validation_status', 'overall_confidence', 'taxonomy_confidence', 'description_confidence'],
          content: ['full_description', 'image_url'],
        },
        validationStatuses: ['validated', 'needs_review', 'needs_attention', 'unvalidated'],
        skuPrefixes: {
          'W (wine)': 'WRW=Red, WWW=White, WSP=Sparkling, WRS=Rose, WDW=Dessert, WCH=Champagne',
          'L (spirits)': 'LWH=Whisky, LGN=Gin, LRM=Rum, LTQ=Tequila, LVK=Vodka, LBD=Brandy, LLQ=Liqueur, LSK=Sake, LBE=Beer',
          'A/G/N (accessories)': 'ABA=Bar accessories, AWC=Wine accessories, GWN=Glassware, NNA=Non-alcoholic',
        },
      },

      counts: {
        total,
        byStatus: { validated, needs_review: needsReview, needs_attention: needsAttention, other: total - validated - needsReview - needsAttention },
        bySegment: { wine, spirits, beer, accessories, other: total - wine - spirits - beer - accessories },
      },

      coverage: {
        description: 'Percentage of products with non-empty values for key fields',
        fields: {
          country: { filled: hasCountry, total, pct: Math.round(hasCountry / total * 100) },
          region: { filled: hasRegion, total, pct: Math.round(hasRegion / total * 100) },
          grape_variety: { filled: hasGrape, total, pct: Math.round(hasGrape / total * 100) },
          brand: { filled: hasBrand, total, pct: Math.round(hasBrand / total * 100) },
          vintage: { filled: hasVintage, total, pct: Math.round(hasVintage / total * 100) },
          price: { filled: hasPrice, total, pct: Math.round(hasPrice / total * 100) },
          full_description: { filled: hasDescription, total, pct: Math.round(hasDescription / total * 100) },
          flavor_profile: { filled: hasFlavorProfile, total, pct: Math.round(hasFlavorProfile / total * 100) },
        },
      },

      pricing: priceStats ? {
        currency: 'THB',
        ...priceStats,
      } : null,

      inventory,

      topCountries: sortedCountries,

      apis: {
        description: 'Available API endpoints for accessing product data',
        endpoints: [
          { method: 'GET', path: '/api/products/overview', description: 'This endpoint — full data summary and schema' },
          { method: 'GET', path: '/api/products/lookup?sku=SKU1,SKU2', description: 'Lookup products by SKU (comma-separated). Returns enriched product intelligence cards.' },
          { method: 'POST', path: '/api/products/lookup', body: '{ "skus": ["SKU1", "SKU2"] }', description: 'Bulk SKU lookup (POST). Returns products map + missing SKUs list.' },
          { method: 'GET', path: '/api/products/search?q=keyword&country=France&limit=20', description: 'Search products by name, brand, or SKU. Filter by country, region, classification.' },
          { method: 'GET', path: '/api/products/export?format=json', description: 'Export all validated products as JSON' },
          { method: 'GET', path: '/api/products/export?format=csv', description: 'Export all validated products as CSV' },
          { method: 'GET', path: '/api/products/export?format=json&status=all', description: 'Export all products (including unvalidated)' },
          { method: 'GET', path: '/api/products/facets', description: 'Get distinct values for all filter fields with counts' },
          { method: 'GET', path: '/api/products?country=France&sort=price&sortDir=desc&page=1', description: 'Browse products with filters, sort, pagination (50/page)' },
          { method: 'GET', path: '/api/products/{id}', description: 'Single product detail with taxonomy context and character dimensions' },
          { method: 'GET', path: '/api/changelog?field=price&limit=50', description: 'View product change history. Filter by field, source, SKU.' },
          { method: 'GET', path: '/api/explore/products?country=France&category=wine&sort=popular&page=1&limit=20', description: 'Map explorer product query — paginated by location and category' },
        ],
      },

      gapsToFill: {
        description: 'Priority data gaps that need filling — useful for AI agents or team validation',
        missingRegion: total - hasRegion,
        missingGrape: total - hasGrape,
        missingDescription: total - hasDescription,
        missingFlavorProfile: total - hasFlavorProfile,
        missingVintage: total - hasVintage,
        missingBrand: total - hasBrand,
        suggestion: 'Use /api/products?region=&sort=confidence&sortDir=desc to find high-confidence products missing region data. Use /api/products/lookup to fetch details, then PATCH /api/products/{id} with corrected fields.',
      },
    });
  } catch (err: any) {
    console.warn('[products/overview] Supabase overview failed; using local catalog fallback.', err);
    return NextResponse.json(await buildLocalOverview(err.message));
  }
}
