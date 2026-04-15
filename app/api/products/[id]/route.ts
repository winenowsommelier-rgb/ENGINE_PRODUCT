import { NextRequest, NextResponse } from 'next/server';
import { filterByOwnership, parseSource } from '@/lib/products/ownership';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) return [];
  return res.json();
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await sbGet(`products?id=eq.${encodeURIComponent(params.id)}&select=*&limit=1`);
    if (!rows.length) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const product = rows[0];

    // Resolve scope via classification_scope_map → character_dimensions
    let characterDimensions: Record<string, unknown>[] = [];
    const classification = product.classification;
    if (classification) {
      const scopeMaps = await sbGet(
        `classification_scope_map?classification=eq.${encodeURIComponent(classification)}&select=scope_id&limit=1`
      );
      const scopeId = scopeMaps?.[0]?.scope_id;
      if (scopeId) {
        characterDimensions = await sbGet(
          `character_dimensions?scope_id=eq.${encodeURIComponent(scopeId)}&select=dimension_key,label,description&order=sort_order.asc.nullslast`
        );
      }
    }

    // Fetch taxonomy_contexts for country and region
    let taxonomyContexts: Record<string, unknown>[] = [];
    const taxTerms = [product.country, product.region].filter(Boolean);
    if (taxTerms.length) {
      const orFilter = taxTerms.map(t => `term.eq.${encodeURIComponent(t)}`).join(',');
      taxonomyContexts = await sbGet(
        `taxonomy_contexts?or=(${orFilter})&select=term,description_short&limit=10`
      );
    }

    return NextResponse.json({ product, characterDimensions, taxonomyContexts, changelog: [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 });
    }

    // Enforce field ownership policy — see PRODUCT_DATA_API.md
    // Default source is `admin` (full access from internal dashboard).
    // External callers send `X-Source: bi` or `?source=enrichment` to restrict writes.
    const source = parseSource(req, req.nextUrl.searchParams);
    const { allowed, dropped } = filterByOwnership(body.fields, source);

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({
        error: 'No writable fields for this source',
        source,
        dropped,
      }, { status: 400 });
    }

    const payload: Record<string, unknown> = { ...allowed, updated_at: new Date().toISOString() };

    // Cast price / cost_price to integer if present
    if (payload.price != null)      payload.price      = parseInt(payload.price as string)      || null;
    if (payload.cost_price != null) payload.cost_price = parseInt(payload.cost_price as string) || null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(params.id)}`,
      { method: 'PATCH', headers: HEADERS, body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(await res.text());
    return NextResponse.json({ updated: true, source, applied: Object.keys(allowed), dropped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
