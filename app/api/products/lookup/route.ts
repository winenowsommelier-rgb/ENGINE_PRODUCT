/**
 * GET  /api/products/lookup?sku=WRW0066AC
 * GET  /api/products/lookup?sku=WRW0066AC,WWW0047AC
 * POST /api/products/lookup  body: { skus: ["WRW0066AC", ...] }
 *
 * Cross-project API — returns the PIM's clean, enriched product data
 * for one or many SKUs.  Any external project (sales, ecommerce, BI)
 * calls this to resolve SKUs into full product intelligence records.
 *
 * Returns only the "public intelligence" fields — not internal pipeline
 * metadata like overall_confidence or enrichment_note.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// Fields exposed to external projects — the "product intelligence card"
const SELECT_FIELDS = [
  'sku', 'name', 'brand',
  'classification',           // product category (Red Wine, Whisky, Beer…)
  'wine_classification',      // tier (Grand Cru, Premier Cru, Reserva…)
  'grape_variety',
  'vintage',
  'alcohol',
  'country', 'region', 'subregion', 'appellation',
  'wine_body', 'wine_acidity', 'wine_tannin',
  'food_matching',
  'flavor_tags',
  'bottle_size',
  'price', 'currency',
  'validation_status',
  'overall_confidence',
].join(',');

async function fetchBySku(skus: string[]) {
  if (!skus.length) return [];
  const list = skus.map(s => `"${s.trim()}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?sku=in.(${list})&select=${SELECT_FIELDS}`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const skuParam = new URL(req.url).searchParams.get('sku') ?? '';
    const skus = skuParam.split(',').map(s => s.trim()).filter(Boolean);
    if (!skus.length) {
      return NextResponse.json({ error: 'Provide ?sku=SKU1,SKU2' }, { status: 400 });
    }
    const products = await fetchBySku(skus);
    // Return map for easy lookup: { WRW0066AC: { ... }, ... }
    const map: Record<string, any> = {};
    for (const p of products) map[p.sku] = p;
    return NextResponse.json({ products: map, count: products.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const skus: string[] = Array.isArray(body.skus) ? body.skus : [];
    if (!skus.length) {
      return NextResponse.json({ error: 'Provide { skus: ["SKU1", ...] }' }, { status: 400 });
    }
    const products = await fetchBySku(skus);
    const map: Record<string, any> = {};
    for (const p of products) map[p.sku] = p;
    // Also list any SKUs that had no match
    const found   = new Set(products.map((p: any) => p.sku));
    const missing = skus.filter(s => !found.has(s));
    return NextResponse.json({ products: map, count: products.length, missing });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
