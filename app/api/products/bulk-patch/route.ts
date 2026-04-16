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
import { filterByOwnership, parseSource, type Source } from '@/lib/products/ownership';
import { validateProductFields } from '@/lib/products/field-validation';
import { addChangelogEntries, type ProductChangelog } from '@/lib/db/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Map the ownership source to a changelog source label. */
function sourceToChangelog(source: Source): ProductChangelog['source'] {
  if (source === 'bi') return 'bi_sync';
  if (source === 'enrichment') return 'enrichment';
  if (source === 'system') return 'system';
  return 'manual_edit'; // admin default
}

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

/**
 * Fetch current state of a product by id OR sku. We need the current values
 * to log old->new diffs in the changelog.
 */
async function fetchCurrent(
  lookup: { id?: string; sku?: string },
  fieldsToSelect: string[]
): Promise<{ id: string; sku: string; current: Record<string, unknown> } | null> {
  const selectCols = Array.from(new Set(['id', 'sku', ...fieldsToSelect])).join(',');
  let query: string;
  if (lookup.id) {
    query = `id=eq.${encodeURIComponent(lookup.id)}`;
  } else if (lookup.sku) {
    query = `sku=eq.${encodeURIComponent(lookup.sku)}`;
  } else {
    return null;
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?${query}&select=${selectCols}&limit=1`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows[0]) return null;
  return { id: rows[0].id, sku: rows[0].sku, current: rows[0] };
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
    const changelogSource = sourceToChangelog(source);
    const note = typeof body.note === 'string' ? body.note : null;

    const results: any[] = [];
    const allDropped = new Set<string>();
    const timestamp = new Date().toISOString();
    const changelogEntries: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];

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

      // Validate field values
      const validation = validateProductFields(allowed);
      if (!validation.valid) {
        results.push({
          sku: item.sku,
          id: item.id,
          error: 'validation failed: ' + validation.errors.join('; '),
          validation_errors: validation.errors,
        });
        continue;
      }
      // Use cleaned values (trimmed, etc.)
      const cleanedFields = validation.cleaned;

      // Fetch current state (need both id and old values for changelog diff)
      const fieldNames = Object.keys(cleanedFields);
      const existing = await fetchCurrent({ id: item.id, sku: item.sku }, fieldNames);
      if (!existing) {
        results.push({ sku: item.sku, id: item.id, error: 'product not found' });
        continue;
      }

      // Numeric casts
      const payload: Record<string, unknown> = { ...cleanedFields, updated_at: timestamp };
      if (payload.price != null) payload.price = parseInt(payload.price as string) || null;
      if (payload.cost_price != null) payload.cost_price = parseInt(payload.cost_price as string) || null;

      const ok = await patchProduct(existing.id, payload);
      if (ok) {
        // Collect changelog entries — only for fields that actually changed
        for (const field of fieldNames) {
          const oldVal = existing.current[field];
          const newVal = payload[field];
          const oldStr = oldVal == null ? '' : String(oldVal);
          const newStr = newVal == null ? '' : String(newVal);
          if (oldStr !== newStr) {
            changelogEntries.push({
              product_id: existing.id,
              sku: existing.sku,
              source: changelogSource,
              field,
              old_value: oldStr || null,
              new_value: newStr,
              note,
            });
          }
        }

        results.push({
          sku: existing.sku,
          id: existing.id,
          updated: true,
          applied: fieldNames,
          dropped,
        });
      } else {
        results.push({ sku: item.sku, id: existing.id, error: 'supabase patch failed' });
      }
    }

    // Write changelog in one batch
    if (changelogEntries.length > 0) {
      try {
        await addChangelogEntries(changelogEntries);
      } catch (err) {
        console.error('Changelog write failed:', err);
      }
    }

    const succeeded = results.filter(r => r.updated).length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      source,
      total: updates.length,
      succeeded,
      failed,
      changelog_entries: changelogEntries.length,
      dropped_fields_unique: Array.from(allDropped),
      results,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'bulk patch failed',
    }, { status: 500 });
  }
}
