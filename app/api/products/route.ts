import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE_SIZE = 50;

const SEGMENT_FILTERS: Record<string, string> = {
  wine:        'sku=like.W*',
  spirits:     'sku=like.L*',
  beer:        'sku=like.LBE*',
  accessories: 'or=(sku.like.A*,sku.like.G*,sku.like.N*)',
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search            = searchParams.get('search') ?? '';
    const country           = searchParams.get('country') ?? '';
    const validation_status = searchParams.get('validation_status') ?? '';
    const classification    = searchParams.get('classification') ?? '';
    const segment           = searchParams.get('segment') ?? '';
    const page              = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const offset            = (page - 1) * PAGE_SIZE;

    const filters: string[] = [];
    if (country)           filters.push(`country=eq.${encodeURIComponent(country)}`);
    if (validation_status) filters.push(`validation_status=eq.${encodeURIComponent(validation_status)}`);
    if (classification)    filters.push(`classification=eq.${encodeURIComponent(classification)}`);
    if (segment && SEGMENT_FILTERS[segment]) filters.push(SEGMENT_FILTERS[segment]);
    if (search) {
      filters.push(`or=(name.ilike.*${encodeURIComponent(search)}*,sku.ilike.*${encodeURIComponent(search)}*)`);
    }

    const qs = [
      ...filters,
      `order=created_at.desc`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
    ].join('&');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*&${qs}`, {
      headers: { ...HEADERS, Prefer: 'count=exact' },
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const items = await res.json();
    const contentRange = res.headers.get('content-range') ?? '';
    const total = contentRange.includes('/') ? parseInt(contentRange.split('/')[1]) : items.length;

    return NextResponse.json({
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 }
    );
  }
}
