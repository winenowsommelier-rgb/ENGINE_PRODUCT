import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts, saveCleanedProduct, addChangelogEntries, saveOverrideBatch } from '@/lib/db/client';
import { parseCsvText } from '@/lib/taxonomy/maps';

export const runtime = 'nodejs';

// Same column mapping as preview
const COLUMN_MAP: Record<string, string> = {
  'sku': 'sku', 'name': 'name', 'brand': 'brand', 'bottle_size': 'bottle_size',
  'vintage': 'vintage', 'cost': 'cost', 'price': 'price', 'special_price': 'special_price',
  'is_in_stock': 'is_in_stock', 'custom_stock_status': 'custom_stock_status',
  'promotion_price': 'promotion_price', 'promotion_tier_price': 'promotion_tier_price',
  'b2b': 'b2b_price', 'country': 'country', 'region_wine': 'region',
  'wine_type': 'classification', 'grape_variety': 'grape_variety',
  'grape_class': 'grape_class', 'liquor_main_type': 'liquor_main_type',
  'other_type': 'other_type', 'manufacturer': 'manufacturer', 'supplier_code': 'supplier_code',
  'type': 'sku_type', 'web': 'web_flag', 'price_group': 'price_group',
  'margin_thb': 'margin_thb', 'margin': 'margin_pct', 'sp_discount': 'sp_discount_pct',
  'b2b_margin_thb': 'b2b_margin_thb', 'b2b_margin': 'b2b_margin_pct',
  'b2b_discount': 'b2b_discount_pct', 'content': 'content_tag',
  'wn_stock': 'wn_stock', 'consign': 'consign',
  'sold_order_mar': 'sold_orders', 'sold_qty_mar': 'sold_qty',
};

const TRACKED_FIELDS = new Set([
  'name', 'brand', 'bottle_size', 'vintage',
  'cost', 'price', 'special_price', 'promotion_price', 'promotion_tier_price', 'b2b_price',
  'is_in_stock', 'custom_stock_status',
  'country', 'region', 'classification', 'grape_variety', 'liquor_main_type',
  'manufacturer', 'supplier_code',
  'price_group', 'margin_thb', 'margin_pct', 'sp_discount_pct',
  'b2b_margin_thb', 'b2b_margin_pct', 'b2b_discount_pct',
  'wn_stock', 'consign', 'sold_orders', 'sold_qty',
]);

const NUMERIC_FIELDS = new Set([
  'cost', 'price', 'special_price', 'promotion_price', 'promotion_tier_price', 'b2b_price',
  'margin_thb', 'b2b_margin_thb', 'sold_orders', 'sold_qty', 'wn_stock',
]);

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/%/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeValue(val: string, field: string): string {
  const v = val.trim();
  if (!v) return '';
  if (NUMERIC_FIELDS.has(field)) {
    const n = parseFloat(v.replace(/,/g, ''));
    return isNaN(n) ? v : String(n);
  }
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { csvText, note, fileName } = body;

    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });
    if (!note?.trim()) return NextResponse.json({ error: 'Import note is required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV needs header + data rows' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);
    const skuColIdx = normalizedHeaders.findIndex(h => h === 'sku');
    if (skuColIdx < 0) return NextResponse.json({ error: 'No "sku" column' }, { status: 400 });

    const colMapping: Array<{ colIdx: number; dbField: string }> = [];
    normalizedHeaders.forEach((nh, idx) => {
      if (idx === skuColIdx) return;
      const dbField = COLUMN_MAP[nh];
      if (dbField && dbField !== 'sku' && TRACKED_FIELDS.has(dbField)) {
        colMapping.push({ colIdx: idx, dbField });
      }
    });

    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    let rowsUpdated = 0;
    let rowsSkipped = 0;
    let totalChanges = 0;
    const changelogEntries: Array<{
      product_id: string;
      sku: string;
      source: 'masterfile_import';
      field: string;
      old_value: string | null;
      new_value: string;
      note: string;
    }> = [];

    const timestamp = new Date().toISOString();

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIdx] ?? '').trim().toUpperCase();
      if (!sku) continue;

      const product = productBySku.get(sku);
      if (!product) { rowsSkipped++; continue; }

      const updates: Record<string, any> = {};

      for (const { colIdx, dbField } of colMapping) {
        const newVal = normalizeValue(String(row[colIdx] ?? ''), dbField);
        if (!newVal) continue;
        const oldVal = product[dbField] != null ? normalizeValue(String(product[dbField]), dbField) : '';

        if (oldVal !== newVal) {
          updates[dbField] = NUMERIC_FIELDS.has(dbField) ? parseFloat(newVal) || newVal : newVal;
          changelogEntries.push({
            product_id: String(product.id ?? ''),
            sku: product.sku ?? '',
            source: 'masterfile_import',
            field: dbField,
            old_value: oldVal || null,
            new_value: newVal,
            note: String(note).trim(),
          });
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = timestamp;
        await saveCleanedProduct({ ...product, ...updates });
        rowsUpdated++;
        totalChanges += Object.keys(updates).length - 1; // exclude updated_at
      }
    }

    if (changelogEntries.length > 0) {
      await addChangelogEntries(changelogEntries);
    }

    await saveOverrideBatch({
      source_file: fileName ?? 'masterfile-import',
      note: String(note).trim(),
      rows_updated: rowsUpdated,
      rows_skipped: rowsSkipped,
    });

    return NextResponse.json({
      rowsUpdated,
      rowsSkipped,
      totalChanges: changelogEntries.length,
      timestamp,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status: 500 });
  }
}
