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
 *
 * PARTIAL B2B COVERAGE: the 503 guard below only catches TOTAL absence of B2B
 * price data. getRecommendationsWithBands()'s priceOf() helper falls back to
 * retail price PER-SKU whenever a given candidate isn't in the injected
 * b2bPrices map (intentional degrade-per-item design in the scoring engine).
 * That means individual rows in a b2b=true response can have their `band`
 * computed against retail price when the SKU is simply missing from the B2B
 * export (e.g. not yet synced). Each row's `band_price_basis` field tells staff
 * which basis was actually used for THAT row, so a "similar"/"step-up" label
 * computed against retail isn't silently mistaken for a B2B-accurate one.
 *
 * SUBJECT-SIDE GAP (known limitation, not yet surfaced in the response): the
 * SAME fallback applies to the subject SKU itself — getRecommendationsWithBands()
 * computes `subjectPrice = priceOf(product)` with the identical retail-fallback
 * logic, so if the SKU passed in `?sku=` has no B2B price, EVERY row's `band` in
 * the response is silently anchored to a retail subject price, not just the rows
 * missing B2B data. `band_price_basis` only reports the CANDIDATE side of this;
 * there is currently no response field indicating the subject's basis, and the
 * subject itself never appears as a row (only candidates do), so a caller has no
 * way to detect this from the response alone. If precision matters, check
 * whether `sku` exists in data/b2b_products_export.json independently before
 * trusting a b2b=true result. Adding a `subject_price_basis` field is a
 * follow-up, not required here.
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
  const prices = new Map<string, number>();
  if (file) {
    try {
      const rows: Array<{ sku: string; b2b_price?: number | null }> = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const r of rows) {
        if (r.sku && typeof r.b2b_price === 'number' && r.b2b_price > 0) prices.set(r.sku, r.b2b_price);
      }
      // Cache ONLY on a successful parse. If we cached the empty Map on a parse
      // failure too, `if (_b2bPrices) return _b2bPrices;` above would short-circuit
      // on the truthy-but-empty Map for the rest of this warm instance's life —
      // a transient bad read would permanently 503 the B2B route until redeploy.
      // Leaving _b2bPrices null on failure means the next request retries the read.
      _b2bPrices = prices;
    } catch (e) {
      // Malformed B2B export must degrade to "no B2B data" for THIS request
      // (caught by the b2bMode guard below), never crash the route or leak parse
      // details/file contents to the client — this route is margin-data
      // hyper-scrutiny per CLAUDE.md. Do not cache — see comment above.
      console.error(`Failed to parse B2B price export at ${file}: ${(e as Error).message}`);
      return prices;
    }
  } else {
    // No file at all: this is stable until redeploy (a missing file won't
    // start existing mid-instance), so caching the empty Map here is safe and
    // avoids re-probing the filesystem on every request.
    _b2bPrices = prices;
  }
  return _b2bPrices ?? prices;
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
      // Per-row signal for partial B2B coverage: only meaningful when b2bMode is
      // true. Tells staff whether THIS row's `band` was computed against the B2B
      // price or fell back to retail because the SKU is missing from the B2B
      // export — see the PARTIAL B2B COVERAGE note in the file header.
      band_price_basis: b2bMode ? (prices?.has(r.product.sku) ? 'b2b' : 'retail') : undefined,
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
