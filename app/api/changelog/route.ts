/**
 * GET /api/changelog?source=enrichment&field=region&sku=WRW&page=1&limit=50
 *
 * Source strategy:
 *  - If USE_SUPABASE_CHANGELOG=1 (or Supabase has the table populated),
 *    read from Supabase (indexed, fast for 82K+ rows, production-safe).
 *  - Otherwise fall back to local JSON (data/db/product-changelog.json).
 *
 * The response shape is identical either way.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const CHANGELOG_PATH = join(process.cwd(), 'data', 'db', 'product-changelog.json');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const USE_SUPABASE = process.env.USE_SUPABASE_CHANGELOG === '1';

interface ChangelogEntry {
  id: string;
  product_id: string;
  sku: string;
  changed_at: string;
  source: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

// ---------- Local JSON path ----------

function readLocalChangelog(): ChangelogEntry[] {
  try {
    const raw = readFileSync(CHANGELOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ---------- Supabase path ----------

async function readSupabaseChangelog(opts: {
  field: string; source: string; sku: string; since: string;
  page: number; limit: number;
}): Promise<{ entries: ChangelogEntry[]; total: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const filters: string[] = [];
  if (opts.field) filters.push(`field=eq.${encodeURIComponent(opts.field)}`);
  if (opts.source) filters.push(`source=eq.${encodeURIComponent(opts.source)}`);
  if (opts.sku) filters.push(`sku=ilike.*${encodeURIComponent(opts.sku)}*`);
  if (opts.since) filters.push(`changed_at=gte.${encodeURIComponent(opts.since)}`);

  const offset = (opts.page - 1) * opts.limit;
  const qs = [
    'select=*',
    ...filters,
    'order=changed_at.desc',
    `limit=${opts.limit}`,
    `offset=${offset}`,
  ].join('&');

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/product_changelog?${qs}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) return null;
    const total = Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
    const entries = await res.json();
    return { entries, total };
  } catch {
    return null;
  }
}

// ---------- Aggregates (both sources) ----------

function computeSummary(entries: ChangelogEntry[]) {
  const fieldCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let priceUpCount = 0, priceDownCount = 0, priceUpTotal = 0, priceDownTotal = 0;
  let costUpCount = 0, costDownCount = 0;
  let stockInCount = 0, stockOutCount = 0;

  for (const e of entries) {
    fieldCounts[e.field] = (fieldCounts[e.field] ?? 0) + 1;
    sourceCounts[e.source] = (sourceCounts[e.source] ?? 0) + 1;
    if (e.field === 'price' && e.old_value && e.new_value) {
      const diff = parseFloat(e.new_value) - parseFloat(e.old_value);
      if (diff > 0) { priceUpCount++; priceUpTotal += diff; }
      else if (diff < 0) { priceDownCount++; priceDownTotal += Math.abs(diff); }
    }
    if (e.field === 'cost' && e.old_value && e.new_value) {
      const diff = parseFloat(e.new_value) - parseFloat(e.old_value);
      if (diff > 0) costUpCount++;
      else if (diff < 0) costDownCount++;
    }
    if (e.field === 'is_in_stock') {
      if (e.new_value === '1' && e.old_value === '0') stockInCount++;
      if (e.new_value === '0' && e.old_value === '1') stockOutCount++;
    }
  }
  return {
    fieldCounts, sourceCounts,
    pricing: {
      priceUpCount, priceDownCount,
      priceUpAvg: priceUpCount > 0 ? Math.round(priceUpTotal / priceUpCount) : 0,
      priceDownAvg: priceDownCount > 0 ? Math.round(priceDownTotal / priceDownCount) : 0,
      costUpCount, costDownCount,
    },
    stock: { stockInCount, stockOutCount },
  };
}

// ---------- Handler ----------

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const field = sp.get('field') ?? '';
    const source = sp.get('source') ?? '';
    const sku = sp.get('sku') ?? '';
    const since = sp.get('since') ?? '';
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? 50)));

    let entries: ChangelogEntry[] = [];
    let total = 0;
    let dataSource: 'supabase' | 'local' = 'local';

    // Try Supabase first when flag set
    if (USE_SUPABASE) {
      const sb = await readSupabaseChangelog({ field, source, sku, since, page, limit });
      if (sb && sb.total > 0) {
        entries = sb.entries;
        total = sb.total;
        dataSource = 'supabase';
      }
    }

    // Fallback to local JSON
    if (dataSource === 'local') {
      let all = readLocalChangelog();
      if (field) all = all.filter(e => e.field === field);
      if (source) all = all.filter(e => e.source === source);
      if (sku) all = all.filter(e => e.sku?.toUpperCase().includes(sku.toUpperCase()));
      if (since) all = all.filter(e => e.changed_at >= since);
      all.sort((a, b) => (b.changed_at ?? '').localeCompare(a.changed_at ?? ''));
      total = all.length;
      const offset = (page - 1) * limit;
      entries = all.slice(offset, offset + limit);
    }

    return NextResponse.json({
      entries,
      total,
      page,
      limit,
      dataSource,
      summary: computeSummary(entries),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
