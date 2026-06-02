/**
 * GET /api/similar/[id]
 *
 * Returns SKUs related to the given product. Computed on-the-fly from
 * brand + region + price band + taste profile axes. This is a *companion*
 * to the pre-computed /api/products/[id]/similar endpoint and works even
 * when product_similar hasn't been populated yet.
 *
 * Scoring (max ~120 points):
 *   +40 same brand
 *   +25 same classification
 *   +15 same country (different region)
 *   +20 same region
 *   +18 same price band
 *   +45 same SKU base (variants)
 *   +0..15 taste-profile axis overlap (wine: body/acidity/tannin; spirit: per-category)
 *
 * Query params:
 *   limit (default 8, max 30) — how many results
 *   excludeBrand=true — drop same-brand matches (useful for "discover similar from elsewhere")
 *
 * Powers: "You might also like", "Customers also bought" complement, "Similar style" rails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerConfig } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type SourceRow = Record<string, unknown>;

async function sbGet(path: string): Promise<unknown[]> {
  try {
    const { url, headers } = getSupabaseServerConfig();
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

function priceBand(value: unknown): string {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return '';
  if (price < 1000) return 'under_1000';
  if (price < 2000) return '1000_1999';
  if (price < 3000) return '2000_2999';
  if (price < 5000) return '3000_4999';
  if (price < 10000) return '5000_9999';
  if (price < 25000) return '10000_24999';
  if (price < 75000) return '25000_74999';
  return '75000_plus';
}

function baseSku(row: SourceRow): string {
  const sb = String(row.sku_base ?? '').toUpperCase();
  if (sb) return sb;
  const sku = String(row.sku ?? '').toUpperCase();
  return sku.length > 2 && /^[A-Z]{2}$/.test(sku.slice(-2)) ? sku.slice(0, -2) : sku;
}

function parseTaste(raw: unknown): Record<string, string> {
  if (!raw) return {};
  let obj: Record<string, unknown> | undefined;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return {}; }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj?.axes || typeof obj.axes !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.axes as Record<string, unknown>)) {
    const value = typeof v === 'object' && v !== null ? (v as { value?: unknown }).value : v;
    if (typeof value === 'string') out[k] = value;
  }
  return out;
}

function tasteSimilarity(a: Record<string, string>, b: Record<string, string>): number {
  const keys = Object.keys(a).filter(k => b[k] !== undefined);
  if (keys.length === 0) return 0;
  let matches = 0;
  for (const k of keys) {
    if (a[k] === b[k]) matches += 1;
  }
  return Math.round((matches / keys.length) * 15);  // max 15 points
}

function wineAxisSimilarity(a: SourceRow, b: SourceRow): number {
  const axes = ['wine_body', 'wine_acidity', 'wine_tannin'];
  let matches = 0;
  let cmp = 0;
  for (const ax of axes) {
    if (a[ax] && b[ax]) {
      cmp += 1;
      if (a[ax] === b[ax]) matches += 1;
    }
  }
  return cmp > 0 ? Math.round((matches / cmp) * 15) : 0;
}

function scoreCandidate(source: SourceRow, c: SourceRow, opts: { excludeBrand: boolean }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (!opts.excludeBrand && source.brand && c.brand === source.brand) {
    score += 40;
    reasons.push('same brand');
  }
  if (baseSku(source) && baseSku(c) === baseSku(source) && source.sku !== c.sku) {
    score += 45;
    reasons.push('same SKU family (variant)');
  }
  if (source.classification && c.classification === source.classification) {
    score += 25;
    reasons.push('same category');
  }
  if (source.region && c.region === source.region) {
    score += 20;
    reasons.push('same region');
  } else if (source.country && c.country === source.country) {
    score += 15;
    reasons.push('same country');
  }
  if (priceBand(source.price) && priceBand(c.price) === priceBand(source.price)) {
    score += 18;
    reasons.push('same price tier');
  }

  // Taste similarity — pick wine_* OR taste_profile.axes depending on what's there
  const sourceWine = ['wine_body', 'wine_acidity', 'wine_tannin'].some(k => !!source[k]);
  const candWine = ['wine_body', 'wine_acidity', 'wine_tannin'].some(k => !!c[k]);
  if (sourceWine && candWine) {
    const ts = wineAxisSimilarity(source, c);
    if (ts > 0) {
      score += ts;
      reasons.push(`taste axes match (${ts}/15)`);
    }
  } else {
    const sa = parseTaste(source.taste_profile);
    const ca = parseTaste(c.taste_profile);
    if (Object.keys(sa).length > 0 && Object.keys(ca).length > 0) {
      const ts = tasteSimilarity(sa, ca);
      if (ts > 0) {
        score += ts;
        reasons.push(`taste profile match (${ts}/15)`);
      }
    }
  }

  // Boost enrichment-grade A so high-quality data surfaces in similar rails
  if (c.enrichment_quality_grade === 'A') score += 3;

  return { score, reasons };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit') ?? '8', 10) || 8));
    const excludeBrand = url.searchParams.get('excludeBrand') === 'true';

    // 1) Fetch the source product
    const sourceRows = await sbGet(
      `products?id=eq.${encodeURIComponent(params.id)}` +
      '&select=id,sku,sku_base,name,brand,classification,country,region,price,wine_body,wine_acidity,wine_tannin,taste_profile,is_active' +
      '&limit=1'
    ) as SourceRow[];
    if (sourceRows.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const source = sourceRows[0];

    // 2) Build candidate pool — products that share at least one strong dimension
    const clauses: string[] = [];
    for (const key of ['sku_base', 'brand', 'classification', 'region'] as const) {
      const v = source[key];
      if (v) clauses.push(`${key}.eq.${encodeURIComponent(String(v))}`);
    }
    if (clauses.length === 0) {
      return NextResponse.json({ source, similar: [], note: 'No strong dimensions available' });
    }

    const candidates = await sbGet(
      'products?' +
      `or=(${clauses.join(',')})` +
      '&select=id,sku,sku_base,name,brand,classification,country,region,price,currency,image_url,enrichment_quality_grade,wine_body,wine_acidity,wine_tannin,taste_profile,desc_en_short,is_active' +
      '&is_active=eq.1' +
      '&limit=400'
    ) as SourceRow[];

    // 3) Score
    const scored = candidates
      .filter(c => c.id !== source.id && c.sku !== source.sku)
      .map(c => {
        const m = scoreCandidate(source, c, { excludeBrand });
        return { ...c, matchScore: m.score, matchReasons: m.reasons };
      })
      .filter(c => c.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return NextResponse.json({
      source: {
        id: source.id,
        sku: source.sku,
        name: source.name,
        brand: source.brand,
        classification: source.classification,
        region: source.region,
        price: source.price,
      },
      similar: scored,
      meta: {
        candidatesEvaluated: candidates.length,
        excludeBrand,
        algorithm: 'on-the-fly score: brand+sku_base+region+price_band+taste_axes',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
