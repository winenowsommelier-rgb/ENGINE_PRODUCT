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

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function supabaseGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function countWhere(filter: string): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=id&${filter}&limit=1`,
    { headers: { ...HEADERS, Prefer: 'count=exact' } }
  );
  const range = res.headers.get('content-range') ?? '*/0';
  return Number(range.split('/')[1] || 0);
}

export async function GET() {
  try {
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
