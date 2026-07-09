import fs from 'node:fs';
import path from 'node:path';
import { type NextRequest, NextResponse } from 'next/server';
import { getAllProducts, getProductBySku } from '@/lib/catalog-data';
import { getRecommendationsWithBands } from '@/lib/recommender';

/**
 * Staff recommendations API.
 * GET /api/internal/recommendations?sku=WRW5601AD&limit=8&b2b=true
 * Header: x-staff-token: <STAFF_RECS_TOKEN>
 *
 * Returns full RecommendationResult[] with scoreBreakdown so staff can explain
 * WHY a product was recommended to a customer over phone/email.
 * b2b=true swaps band calculation to use b2b_price (loaded server-side from
 * data/b2b_products_export.json — b2b_price is NOT in the public export and
 * must never leave the server unauthenticated).
 *
 * AUTH (non-negotiable): Vercel deployments are public internet — there is no
 * "internal network". Without this gate, anyone could enumerate b2b_price for
 * the whole catalog (margin leak, the exact thing EXPORT_COLS exists to prevent).
 * Fail CLOSED: if STAFF_RECS_TOKEN is unset, the route is disabled.
 */
export const dynamic = 'force-dynamic';

// sku → b2b_price, loaded once per serverless instance.
let _b2bPrices: Map<string, number> | null = null;
function b2bPrices(): Map<string, number> {
  if (_b2bPrices) return _b2bPrices;
  // Same path probing as scripts/gen-search-index.mjs (works from repo root and apps/catalog).
  const candidates = [
    path.join(process.cwd(), 'data', 'b2b_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'b2b_products_export.json'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  _b2bPrices = new Map();
  if (file) {
    const rows: Array<{ sku: string; b2b_price?: number | null }> = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of rows) {
      if (r.sku && typeof r.b2b_price === 'number' && r.b2b_price > 0) _b2bPrices.set(r.sku, r.b2b_price);
    }
  }
  return _b2bPrices;
}

export async function GET(req: NextRequest) {
  const expected = process.env.STAFF_RECS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'staff API disabled (STAFF_RECS_TOKEN not configured)' }, { status: 503 });
  }
  if (req.headers.get('x-staff-token') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sku = searchParams.get('sku');
  const parsedLimit = parseInt(searchParams.get('limit') ?? '8', 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 8;
  const b2bMode = searchParams.get('b2b') === 'true';

  if (!sku) {
    return NextResponse.json({ error: 'sku is required' }, { status: 400 });
  }

  const all = getAllProducts();
  const product = getProductBySku(sku);
  if (!product) {
    return NextResponse.json({ error: `SKU ${sku} not found` }, { status: 404 });
  }

  const prices = b2bMode ? b2bPrices() : undefined;
  // Rule 1-style guard: if b2b mode was requested but the price file is missing/
  // empty, say so instead of silently serving retail bands as if they were B2B.
  if (b2bMode && (!prices || prices.size === 0)) {
    return NextResponse.json({ error: 'b2b price data unavailable on this deployment' }, { status: 503 });
  }

  const results = getRecommendationsWithBands(product, all, {
    includeGreatAlternative: true,
    b2bPrices: prices,
  }).slice(0, limit);

  return NextResponse.json(
    results.map(r => ({
      sku: r.product.sku,
      name: r.product.name,
      price: r.product.price,
      b2b_price: prices?.get(r.product.sku) ?? null, // authed staff response only
      band: r.band,
      score: r.score,
      scoreBreakdown: r.scoreBreakdown,
      region: r.product.region,
      variety: r.product.variety,
      category_type: r.product.category_type,
      is_in_stock: r.product.is_in_stock,
    }))
  );
}
