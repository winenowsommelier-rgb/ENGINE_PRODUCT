import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts } from '@/lib/db/client';
import { parseCsvText } from '@/lib/taxonomy/maps';

export const runtime = 'nodejs';

const SKU_HEADERS = new Set(['sku', 'product_sku']);

const KNOWN_PRODUCT_FIELDS = new Set([
  'name', 'category', 'type', 'grape', 'region', 'style',
  'price', 'cost', 'cost_price', 'currency', 'status', 'oak', 'country',
  'subregion', 'origin', 'classification', 'grape_variety',
  'wine_type', 'liquor_main_type', 'flavor_profile', 'full_description',
]);

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csvText: string = body.csvText;
    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const skuColIndex = normalizedHeaders.findIndex(h => SKU_HEADERS.has(h));

    if (skuColIndex < 0) return NextResponse.json({ error: 'CSV must contain a "sku" column' }, { status: 400 });

    const ignoredColumns = rawHeaders.filter((_, i) => i !== skuColIndex && !KNOWN_PRODUCT_FIELDS.has(normalizedHeaders[i]));
    const dataHeaders = normalizedHeaders.filter((h, i) => i !== skuColIndex && KNOWN_PRODUCT_FIELDS.has(h));

    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    const matched: Array<{ sku: string; productId: string; changes: Array<{ field: string; oldValue: string; newValue: string }> }> = [];
    const unmatched: string[] = [];

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIndex] ?? '').trim().toUpperCase();
      if (!sku) continue;

      const product = productBySku.get(sku);
      if (!product) { unmatched.push(sku); continue; }

      const changes: Array<{ field: string; oldValue: string; newValue: string }> = [];
      dataHeaders.forEach((field, i) => {
        const actualIdx = normalizedHeaders.indexOf(field, i === 0 ? 0 : normalizedHeaders.indexOf(dataHeaders[i - 1]) + 1);
        const newVal = String(row[actualIdx] ?? '').trim();
        if (!newVal) return;
        const oldVal = product[field] != null ? String(product[field]) : '';
        if (oldVal !== newVal) changes.push({ field, oldValue: oldVal, newValue: newVal });
      });

      if (changes.length > 0) matched.push({ sku, productId: String(product.id ?? ''), changes });
    }

    return NextResponse.json({ matched, unmatched, ignoredColumns });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Preview failed' }, { status: 500 });
  }
}
