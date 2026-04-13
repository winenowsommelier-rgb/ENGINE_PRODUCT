import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const CHANGELOG_PATH = join(process.cwd(), 'data', 'db', 'product-changelog.json');

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

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const field = sp.get('field') ?? '';
    const source = sp.get('source') ?? '';
    const sku = sp.get('sku') ?? '';
    const since = sp.get('since') ?? '';
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? 50)));

    const raw = readFileSync(CHANGELOG_PATH, 'utf-8');
    let entries: ChangelogEntry[] = JSON.parse(raw);

    // Filter
    if (field) entries = entries.filter(e => e.field === field);
    if (source) entries = entries.filter(e => e.source === source);
    if (sku) entries = entries.filter(e => e.sku?.toUpperCase().includes(sku.toUpperCase()));
    if (since) entries = entries.filter(e => e.changed_at >= since);

    // Sort newest first
    entries.sort((a, b) => (b.changed_at ?? '').localeCompare(a.changed_at ?? ''));

    const total = entries.length;
    const offset = (page - 1) * limit;
    const pageEntries = entries.slice(offset, offset + limit);

    // Compute summary stats
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

    return NextResponse.json({
      entries: pageEntries,
      total,
      page,
      limit,
      summary: {
        fieldCounts,
        sourceCounts,
        pricing: {
          priceUpCount, priceDownCount,
          priceUpAvg: priceUpCount > 0 ? Math.round(priceUpTotal / priceUpCount) : 0,
          priceDownAvg: priceDownCount > 0 ? Math.round(priceDownTotal / priceDownCount) : 0,
          costUpCount, costDownCount,
        },
        stock: { stockInCount, stockOutCount },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
