import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE = 1000;

/**
 * Paginate through ALL rows — Supabase's server-side max-rows cap (default: 1000)
 * cannot be bypassed with the Range header alone, so we page through every batch
 * until we have the full dataset.
 */
async function sbAll(select: string): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/products?select=${select}&limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { headers: BASE_HEADERS });
    if (!r.ok) break;
    const batch: Record<string, any>[] = await r.json();
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function countBy(rows: Record<string, any>[], key: string): { value: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const v = row[key];
    if (v != null && v !== '') map[String(v)] = (map[String(v)] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

export async function GET() {
  try {
    // Fetch all facet columns in one paginated sweep — no repeated round-trips per field
    const rows = await sbAll(
      'classification,country,validation_status,region,appellation,wine_classification'
    );

    return NextResponse.json({
      categories:   countBy(rows, 'classification'),
      countries:    countBy(rows, 'country'),
      statuses:     countBy(rows, 'validation_status'),
      regions:      countBy(rows, 'region'),
      appellations: countBy(rows, 'appellation'),
      wineClasses:  countBy(rows, 'wine_classification'),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
