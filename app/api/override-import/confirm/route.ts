import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts, saveCleanedProduct, addChangelogEntries, saveOverrideBatch } from '@/lib/db/client';
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
    const { csvText, note, batchId } = body;

    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });
    if (!note || !String(note).trim()) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const skuColIndex = normalizedHeaders.findIndex(h => SKU_HEADERS.has(h));
    if (skuColIndex < 0) return NextResponse.json({ error: 'CSV must contain a "sku" column' }, { status: 400 });

    const dataHeaders = normalizedHeaders.filter((h, i) => i !== skuColIndex && KNOWN_PRODUCT_FIELDS.has(h));
    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    let rowsUpdated = 0;
    let rowsSkipped = 0;
    const changelogEntries: any[] = [];

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIndex] ?? '').trim().toUpperCase();
      if (!sku) continue;
      const product = productBySku.get(sku);
      if (!product) { rowsSkipped++; continue; }

      const updates: Record<string, any> = {};
      dataHeaders.forEach(field => {
        const actualIdx = normalizedHeaders.indexOf(field);
        const newVal = String(row[actualIdx] ?? '').trim();
        if (!newVal) return;
        const oldVal = product[field] != null ? String(product[field]) : '';
        if (oldVal !== newVal) {
          updates[field] = newVal;
          changelogEntries.push({
            product_id: String(product.id ?? ''),
            sku: product.sku ?? '',
            source: 'override_import' as const,
            field,
            old_value: oldVal || null,
            new_value: newVal,
            note: String(note).trim(),
          });
        }
      });

      if (Object.keys(updates).length > 0) {
        await saveCleanedProduct({ ...product, ...updates });
        rowsUpdated++;
      }
    }

    if (changelogEntries.length > 0) await addChangelogEntries(changelogEntries);

    await saveOverrideBatch({
      source_file: batchId ?? 'unknown',
      note: String(note).trim(),
      rows_updated: rowsUpdated,
      rows_skipped: rowsSkipped,
    });

    return NextResponse.json({ rowsUpdated, rowsSkipped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Confirm failed' }, { status: 500 });
  }
}
