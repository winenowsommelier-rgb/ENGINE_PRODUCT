import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const revalidate = 300; // cache facets for 5 minutes

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

// ── Local data cache (loaded once per process) ────────────────────────────────

type Row = Record<string, unknown>;
let _localCache: Row[] | null = null;
let _localCacheAt = 0;
const LOCAL_TTL = 5 * 60 * 1000; // 5 min

function loadLocal(): Row[] {
  if (_localCache && Date.now() - _localCacheAt < LOCAL_TTL) return _localCache;
  const livePath = path.join(process.cwd(), 'data', 'live_products_export.json');
  const dbPath   = path.join(process.cwd(), 'data', 'db', 'products.json');
  let live: Row[] = [];
  let db: Row[]   = [];
  try { const r = JSON.parse(fs.readFileSync(livePath, 'utf8')); live = Array.isArray(r) ? r : (r.products ?? []); } catch (_) {}
  try { const r = JSON.parse(fs.readFileSync(dbPath,  'utf8')); db   = Array.isArray(r) ? r : []; } catch (_) {}
  const dbBySku = new Map<string, Row>();
  for (const p of db) if (p.sku) dbBySku.set(String(p.sku), p);
  _localCache = live.map(p => {
    const d = dbBySku.get(String(p.sku ?? ''));
    return d ? { ...p, validation_status: p.validation_status ?? d.validation_status, enrichment_priority: p.enrichment_priority ?? d.enrichment_priority } : p;
  });
  _localCacheAt = Date.now();
  return _localCache;
}

function countBy(rows: Row[], key: string): { value: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const row of rows) {
    let v = row[key];
    if (v == null || String(v).trim() === '') continue;
    let val = String(v).trim();
    // Normalise pipe-delimited classification — take primary classification only
    if (key === 'classification' && val.includes('|')) {
      val = val.split('|')[0].trim();
    }
    map[val] = (map[val] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

export async function GET() {
  try {
    const [sbRows, localRows] = await Promise.all([
      sbAll('classification,country,validation_status,region,appellation,wine_classification,enrichment_priority'),
      Promise.resolve(loadLocal()),
    ]);
    const rows = sbRows.length > 0 ? sbRows : localRows;
    const source = sbRows.length > 0 ? 'supabase' : 'local';

    return NextResponse.json({
      categories:   countBy(rows, 'classification'),
      countries:    countBy(rows, 'country'),
      statuses:     countBy(rows, 'validation_status'),
      regions:      countBy(rows, 'region'),
      appellations: countBy(rows, 'appellation'),
      wineClasses:  countBy(rows, 'wine_classification'),
      tiers:        countBy(rows, 'enrichment_priority'),
      source,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
