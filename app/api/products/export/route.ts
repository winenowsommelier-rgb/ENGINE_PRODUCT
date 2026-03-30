/**
 * GET /api/products/export?format=json          — all validated products as JSON
 * GET /api/products/export?format=csv           — as CSV
 * GET /api/products/export?format=json&status=all  — include non-validated too
 *
 * Bulk mirror endpoint — external projects call this once to build their own
 * local product cache, then use /api/products/lookup for incremental updates.
 *
 * Tip: compare `synced_at` header against your local cache timestamp to decide
 * whether a fresh pull is needed.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime  = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE = 1000;

const EXPORT_FIELDS = [
  'sku', 'name', 'brand',
  'classification', 'wine_classification',
  'grape_variety', 'vintage', 'alcohol',
  'country', 'region', 'subregion', 'appellation',
  'wine_body', 'wine_acidity', 'wine_tannin',
  'food_matching', 'flavor_tags',
  'bottle_size', 'price', 'currency',
  'validation_status', 'overall_confidence',
].join(',');

async function fetchAll(filter: string): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/products?select=${EXPORT_FIELDS}${filter}&order=sku.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: BASE_HEADERS });
    if (!res.ok) throw new Error(await res.text());
    const batch: Record<string, any>[] = await res.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = (v: any) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const format  = params.get('format') === 'csv' ? 'csv' : 'json';
    const status  = params.get('status') ?? 'validated';

    const filter = status === 'all'
      ? ''
      : `&validation_status=eq.${encodeURIComponent(status)}`;

    const products = await fetchAll(filter);

    if (format === 'csv') {
      return new NextResponse(toCSV(products), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="pim-products-${new Date().toISOString().slice(0,10)}.csv"`,
          'X-PIM-Count': String(products.length),
          'X-PIM-Synced-At': new Date().toISOString(),
        },
      });
    }

    return NextResponse.json(
      { products, count: products.length, exported_at: new Date().toISOString() },
      { headers: { 'X-PIM-Count': String(products.length) } }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
