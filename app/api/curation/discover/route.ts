/**
 * GET /api/curation/discover
 *
 * Metadata-driven discovery — answers questions like:
 *   "Show me Pomerol Merlots, body Medium-Full, ≤฿50k"
 *   "Whiskies with Trace peat, Sweet, Cask-dominant oak"
 *   "Sake from Niigata with Rich/Umami body, Daiginjo polish"
 *
 * Pure metadata filtering — no LLM call. Fast (~50-200ms).
 *
 * Query params (all optional; combine freely):
 *   classification   — e.g. "Red Wine", "Whisky"
 *   country          — e.g. "France"
 *   region           — e.g. "Pomerol"
 *   subregion        — e.g. "Margaux"
 *   brand            — exact match
 *   grape            — substring match on grape_variety
 *   priceMin, priceMax — THB
 *   wineBody         — "Light" | "Medium-Light" | "Medium" | "Medium-Full" | "Full"
 *   wineAcidity      — same scale
 *   wineTannin       — same scale
 *   axis.<key>       — per-category taste axis, e.g. axis.peat_smoke=Trace
 *                      Multiple axis.* params combine with AND.
 *   flavor           — substring on flavor_tags
 *   styleTag         — exact match on taste_profile.style_tag
 *   minGrade         — A | B | C
 *   requireActive    — default true; pass "false" to include OOS
 *   sort             — price_asc | price_desc | grade | name (default: grade then price_desc)
 *   limit, offset    — pagination; limit max 100
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerConfig } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type ProductRow = Record<string, unknown>;

async function sbGet(path: string): Promise<unknown[]> {
  try {
    const { url, headers } = getSupabaseServerConfig();
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

function parseTasteProfile(raw: unknown): { axes: Record<string, string>; styleTag?: string; category?: string } {
  if (!raw) return { axes: {} };
  let obj: Record<string, unknown> | undefined;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { axes: {} }; }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return { axes: {} };
  const axes: Record<string, string> = {};
  const rawAxes = obj.axes;
  if (rawAxes && typeof rawAxes === 'object') {
    for (const [k, v] of Object.entries(rawAxes as Record<string, unknown>)) {
      const value = typeof v === 'object' && v !== null ? (v as { value?: unknown }).value : v;
      if (typeof value === 'string') axes[k] = value;
    }
  }
  return {
    axes,
    styleTag: typeof obj.style_tag === 'string' ? obj.style_tag : undefined,
    category: typeof obj.category === 'string' ? obj.category : undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;

    // Build PostgREST filter string
    const filters: string[] = [];
    const text = (k: string, p: string) => {
      const v = q.get(p);
      if (v) filters.push(`${k}=eq.${encodeURIComponent(v)}`);
    };
    const ilike = (k: string, p: string) => {
      const v = q.get(p);
      if (v) filters.push(`${k}=ilike.${encodeURIComponent('*' + v + '*')}`);
    };

    text('classification', 'classification');
    text('country', 'country');
    text('region', 'region');
    text('subregion', 'subregion');
    text('brand', 'brand');
    ilike('grape_variety', 'grape');
    ilike('flavor_tags', 'flavor');
    text('wine_body', 'wineBody');
    text('wine_acidity', 'wineAcidity');
    text('wine_tannin', 'wineTannin');
    text('enrichment_quality_grade', 'minGrade');  // exact for now; range is harder via PostgREST

    const priceMin = q.get('priceMin');
    const priceMax = q.get('priceMax');
    if (priceMin) filters.push(`price=gte.${Number(priceMin) || 0}`);
    if (priceMax) filters.push(`price=lte.${Number(priceMax) || 0}`);

    // is_active filter — disabled by default until Supabase has the column.
    // Pass requireActive=true explicitly when the schema has it.
    const requireActive = q.get('requireActive') === 'true';
    if (requireActive) filters.push('is_active=eq.1');

    // For axis.* filters (taste_profile.axes — nested JSON), Postgres doesn't index well,
    // so we over-fetch by other criteria then filter in-memory.
    const axisFilters: Record<string, string> = {};
    for (const [k, v] of q.entries()) {
      if (k.startsWith('axis.') && v) {
        axisFilters[k.slice(5)] = v;
      }
    }
    const styleTagFilter = q.get('styleTag');

    // Sort
    const sortMap: Record<string, string> = {
      price_asc: 'price.asc.nullslast',
      price_desc: 'price.desc.nullslast',
      grade: 'enrichment_quality_grade.asc.nullslast,price.desc.nullslast',
      name: 'name.asc',
    };
    const order = sortMap[q.get('sort') || 'grade'] || sortMap.grade;

    // Page sizing — apply server-side limit when no axis filter; otherwise over-fetch.
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit') ?? '20', 10) || 20));
    const offset = Math.max(0, parseInt(q.get('offset') ?? '0', 10) || 0);
    const overfetch = (Object.keys(axisFilters).length > 0 || styleTagFilter) ? 400 : limit + offset;

    const filtersStr = filters.length > 0 ? '&' + filters.join('&') : '';
    const selectCols = [
      'id', 'sku', 'name', 'brand', 'vintage', 'price', 'currency',
      'classification', 'country', 'region', 'subregion', 'grape_variety',
      'image_url', 'desc_en_short',
      'wine_body', 'wine_acidity', 'wine_tannin',
      'taste_profile', 'flavor_tags', 'food_matching',
      'enrichment_quality_grade', 'enrichment_source',
    ].join(',');

    const rawRows = await sbGet(
      `products?select=${selectCols}${filtersStr}&order=${order}&limit=${overfetch}`
    ) as ProductRow[];

    // In-memory: axis.* and styleTag filters
    let filtered = rawRows;
    if (Object.keys(axisFilters).length > 0 || styleTagFilter) {
      filtered = rawRows.filter(row => {
        const tp = parseTasteProfile(row.taste_profile);
        for (const [k, v] of Object.entries(axisFilters)) {
          if (tp.axes[k] !== v) return false;
        }
        if (styleTagFilter && tp.styleTag !== styleTagFilter) return false;
        return true;
      });
    }

    // Apply pagination after in-memory filter
    const paged = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      filters: Object.fromEntries(q.entries()),
      total: filtered.length,
      returned: paged.length,
      offset,
      limit,
      results: paged.map(r => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        brand: r.brand,
        vintage: r.vintage,
        price: r.price,
        currency: r.currency,
        classification: r.classification,
        country: r.country,
        region: r.region,
        subregion: r.subregion,
        grape_variety: r.grape_variety,
        image_url: r.image_url,
        desc_en_short: r.desc_en_short,
        wine_body: r.wine_body,
        wine_acidity: r.wine_acidity,
        wine_tannin: r.wine_tannin,
        taste_profile: r.taste_profile,
        flavor_tags: r.flavor_tags,
        enrichment_quality_grade: r.enrichment_quality_grade,
      })),
      meta: {
        algorithm: 'metadata-only-filter',
        notes: 'For sub-50ms responses, prefer wine_* / brand / classification filters. axis.* and styleTag filters require in-memory post-filtering.',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
