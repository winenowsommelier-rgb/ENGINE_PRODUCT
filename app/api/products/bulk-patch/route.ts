/**
 * POST /api/products/bulk-patch
 *
 * Bulk update multiple products. Designed for enrichment agents that have
 * prepared N records and need to apply them in one request.
 *
 * Request body:
 * {
 *   updates: [
 *     { id: "row-...", fields: { flavor_tags: "...", region: "..." } },
 *     { sku: "WRW0066AC", fields: { region: "..." } },
 *     ...
 *   ]
 * }
 *
 * Also respects the `X-Source` header (bi | enrichment | system | admin).
 * Each update can be keyed by `id` OR `sku` (id is resolved server-side if
 * only sku is given).
 *
 * Response:
 * {
 *   results: [
 *     { sku: "...", updated: true, applied: [...], dropped: [...] },
 *     { sku: "...", error: "Product not found" },
 *     ...
 *   ],
 *   total, succeeded, failed, dropped_fields_unique: [...]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { filterByOwnership, parseSource } from '@/lib/products/ownership';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const MAX_BATCH = 200;

interface UpdateItem {
  id?: string;
  sku?: string;
  fields: Record<string, unknown>;
}

async function resolveId(sku: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}&select=id&limit=1`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

async function patchProduct(id: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify(payload) }
  );
  return res.ok;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const updates: UpdateItem[] = Array.isArray(body.updates) ? body.updates : [];

    if (updates.length === 0) {
      return NextResponse.json({ error: 'updates array required' }, { status: 400 });
    }
    if (updates.length > MAX_BATCH) {
      return NextResponse.json({
        error: `Max ${MAX_BATCH} updates per batch`,
        received: updates.length,
      }, { status: 400 });
    }

    const source = parseSource(req, req.nextUrl.searchParams);

    const results: any[] = [];
    const allDropped = new Set<string>();
    const timestamp = new Date().toISOString();

    for (const item of updates) {
      if (!item.fields || typeof item.fields !== 'object') {
        results.push({ sku: item.sku, id: item.id, error: 'missing fields object' });
        continue;
      }

      // Filter by ownership
      const { allowed, dropped } = filterByOwnership(item.fields, source);
      for (const d of dropped) allDropped.add(d);

      if (Object.keys(allowed).length === 0) {
        results.push({
          sku: item.sku,
          id: item.id,
          error: 'no writable fields for source',
          dropped,
        });
        continue;
      }

      // Resolve id
      let id = item.id;
      if (!id && item.sku) {
        id = (await resolveId(item.sku)) ?? undefined;
      }
      if (!id) {
        results.push({ sku: item.sku, error: 'product not found' });
        continue;
      }

      // Numeric casts
      const payload: Record<string, unknown> = { ...allowed, updated_at: timestamp };
      if (payload.price != null) payload.price = parseInt(payload.price as string) || null;
      if (payload.cost_price != null) payload.cost_price = parseInt(payload.cost_price as string) || null;

      const ok = await patchProduct(id, payload);
      if (ok) {
        results.push({
          sku: item.sku,
          id,
          updated: true,
          applied: Object.keys(allowed),
          dropped,
        });
      } else {
        results.push({ sku: item.sku, id, error: 'supabase patch failed' });
      }
    }

    const succeeded = results.filter(r => r.updated).length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      source,
      total: updates.length,
      succeeded,
      failed,
      dropped_fields_unique: Array.from(allDropped),
      results,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'bulk patch failed',
    }, { status: 500 });
  }
}
