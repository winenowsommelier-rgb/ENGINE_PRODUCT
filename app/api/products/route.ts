import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Source',
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const SEGMENT_FILTERS: Record<string, string> = {
  wine:        'sku=like.W*',
  spirits:     'sku=like.L*',
  beer:        'sku=like.LBE*',
  accessories: 'or=(sku.like.A*,sku.like.G*,sku.like.N*)',
};

const SORT_COLS: Record<string, string> = {
  name:       'name',
  price:      'price',
  confidence: 'overall_confidence',
  tier:       'enrichment_priority',
  vintage:    'vintage',
  created:    'created_at',
  sku:        'sku',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error: Supabase credentials missing' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const { searchParams } = new URL(req.url);
    const search            = searchParams.get('search') ?? '';
    const brand             = searchParams.get('brand') ?? '';
    const country           = searchParams.get('country') ?? '';
    const validation_status = searchParams.get('validation_status') ?? '';
    const classification    = searchParams.get('classification') ?? '';
    const region            = searchParams.get('region') ?? '';
    const appellation       = searchParams.get('appellation') ?? '';
    const wine_classification = searchParams.get('wine_classification') ?? '';
    const segment           = searchParams.get('segment') ?? '';
    const tier              = searchParams.get('tier') ?? '';
    const sortBy            = SORT_COLS[searchParams.get('sort') ?? ''] ?? 'created_at';
    const sortDir           = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
    const page              = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit             = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const explicitOffset    = searchParams.get('offset');
    const offset            = explicitOffset ? parseInt(explicitOffset) : (page - 1) * limit;

    const filters: string[] = [];
    if (brand)              filters.push(`brand=ilike.*${encodeURIComponent(brand)}*`);
    if (country)            filters.push(`country=eq.${encodeURIComponent(country)}`);
    if (validation_status)  filters.push(`validation_status=eq.${encodeURIComponent(validation_status)}`);
    if (classification)     filters.push(`classification=eq.${encodeURIComponent(classification)}`);
    if (region)             filters.push(`region=eq.${encodeURIComponent(region)}`);
    if (appellation)        filters.push(`appellation=eq.${encodeURIComponent(appellation)}`);
    if (wine_classification) filters.push(`wine_classification=eq.${encodeURIComponent(wine_classification)}`);
    if (tier)               filters.push(`enrichment_priority=eq.${encodeURIComponent(tier)}`);
    if (segment && SEGMENT_FILTERS[segment]) filters.push(SEGMENT_FILTERS[segment]);
    if (search) {
      filters.push(`or=(name.ilike.*${encodeURIComponent(search)}*,sku.ilike.*${encodeURIComponent(search)}*,brand.ilike.*${encodeURIComponent(search)}*)`);
    }

    const qs = [
      ...filters,
      `order=${sortBy}.${sortDir}.nullslast`,
      `limit=${limit}`,
      `offset=${offset}`,
    ].join('&');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*&${qs}`, {
      headers: { ...HEADERS, Prefer: 'count=exact' },
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: err },
        { status: res.status, headers: CORS_HEADERS }
      );
    }

    const items = (await res.json()).map((item: Record<string, unknown>) => ({
      ...item,
      product_tier: item.enrichment_priority == null ? null : `T${item.enrichment_priority}`,
      product_tier_definition: item.enrichment_note ?? null,
    }));
    const contentRange = res.headers.get('content-range') ?? '';
    const total = contentRange.includes('/') ? parseInt(contentRange.split('/')[1]) : items.length;

    return NextResponse.json({
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    }, {
      headers: CORS_HEADERS
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
