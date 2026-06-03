/**
 * GET /api/products/search?q=chateau&country=France&classification=Red Wine&limit=20&offset=0
 *
 * Full-text search across product name, brand, SKU, grape_variety.
 * Supports filtering by any field. Returns enriched product cards.
 *
 * Designed for team members and AI agents to find products by any criteria.
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

const SELECT_FIELDS = [
  'id', 'sku', 'name', 'brand',
  'classification', 'wine_classification', 'grape_variety',
  'vintage', 'alcohol',
  'country', 'region', 'subregion', 'appellation',
  'wine_body', 'wine_acidity', 'wine_tannin',
  'food_matching', 'flavor_tags',
  'bottle_size', 'price', 'cost_price', 'currency',
  'validation_status', 'overall_confidence',
  'image_url',
  // Taste taxonomy v2 (2026-05-24): structured taste profile + food pairing rationale
  'taste_profile', 'taste_profile_override', 'pairing_rationale',
].join(',');

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get('q') ?? '';
    const country = sp.get('country') ?? '';
    const region = sp.get('region') ?? '';
    const classification = sp.get('classification') ?? '';
    const grape = sp.get('grape_variety') ?? '';
    const brand = sp.get('brand') ?? '';
    const status = sp.get('validation_status') ?? '';
    const minPrice = sp.get('price_min') ?? '';
    const maxPrice = sp.get('price_max') ?? '';
    const note = sp.get('note') ?? '';          // v2: click-a-note discovery — bare taste-vocab label
    const tier = sp.get('tier') ?? '';          // optional: 'primary'|'secondary'|'tertiary'|'flat'
    const hasField = sp.get('has') ?? '';       // e.g. has=region — only return products that HAVE this field filled
    const missingField = sp.get('missing') ?? ''; // e.g. missing=region — only return products MISSING this field
    const sort = sp.get('sort') ?? 'name';
    const sortDir = sp.get('sortDir') ?? 'asc';
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 20)));
    const offset = Math.max(0, Number(sp.get('offset') ?? 0));

    const filters: string[] = [];

    // Full-text search across multiple fields
    if (q) {
      const encoded = encodeURIComponent(q);
      filters.push(`or=(name.ilike.*${encoded}*,brand.ilike.*${encoded}*,sku.ilike.*${encoded}*,grape_variety.ilike.*${encoded}*)`);
    }

    // Exact filters
    if (country) filters.push(`country=eq.${encodeURIComponent(country)}`);
    if (region) filters.push(`region=eq.${encodeURIComponent(region)}`);
    if (classification) filters.push(`classification=eq.${encodeURIComponent(classification)}`);
    if (grape) filters.push(`grape_variety=ilike.*${encodeURIComponent(grape)}*`);
    if (brand) filters.push(`brand=ilike.*${encodeURIComponent(brand)}*`);
    if (status) filters.push(`validation_status=eq.${encodeURIComponent(status)}`);

    // Price range
    if (minPrice) filters.push(`price=gte.${Number(minPrice)}`);
    if (maxPrice) filters.push(`price=lte.${Number(maxPrice)}`);

    // v2 click-a-note discovery: resolve product_ids first via product_taste_notes,
    // then add `id=in.(...)` filter to the main products query. Cross-category
    // by default; the user can narrow with classification=... if desired.
    if (note) {
      const nq: string[] = [`select=product_id`, `note=eq.${encodeURIComponent(note)}`];
      if (tier) nq.push(`tier=eq.${encodeURIComponent(tier)}`);
      nq.push(`limit=1000`);
      const noteRes = await fetch(`${SUPABASE_URL}/rest/v1/product_taste_notes?${nq.join('&')}`, {
        headers: HEADERS,
      });
      if (!noteRes.ok) {
        return NextResponse.json({ error: `note lookup failed: ${noteRes.status}` }, { status: 502 });
      }
      const noteRows = (await noteRes.json()) as Array<{ product_id: string }>;
      const ids = noteRows.map((r) => r.product_id);
      if (ids.length === 0) {
        // No matches — short-circuit with empty result rather than fetching all products
        return NextResponse.json({ products: [], total: 0, limit, offset, hasMore: false });
      }
      // PostgREST `in` filter: id=in.(id1,id2,...) — quote each value for safety
      const inList = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
      filters.push(`id=in.(${inList})`);
    }

    // Field presence filters — useful for finding gaps
    if (hasField) {
      for (const f of hasField.split(',')) {
        filters.push(`${f.trim()}=not.is.null`);
        filters.push(`${f.trim()}=neq.`);
      }
    }
    if (missingField) {
      for (const f of missingField.split(',')) {
        filters.push(`or=(${f.trim()}.is.null,${f.trim()}.eq.)`);
      }
    }

    // Sort
    const sortCol = ['name', 'price', 'sku', 'country', 'overall_confidence', 'vintage', 'created_at'].includes(sort) ? sort : 'name';
    const dir = sortDir === 'desc' ? 'desc' : 'asc';

    const qs = [
      `select=${SELECT_FIELDS}`,
      ...filters,
      `order=${sortCol}.${dir}.nullslast`,
      `limit=${limit}`,
      `offset=${offset}`,
    ].join('&');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?${qs}`, {
      headers: { ...HEADERS, Prefer: 'count=exact' },
    });

    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: 502 });
    }

    const total = Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
    const products = await res.json();

    return NextResponse.json({
      products,
      total,
      limit,
      offset,
      hasMore: offset + products.length < total,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
