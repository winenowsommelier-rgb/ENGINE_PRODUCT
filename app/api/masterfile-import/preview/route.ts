import { NextRequest, NextResponse } from 'next/server';
import { getCleanedProducts } from '@/lib/db/client';
import { parseCsvText } from '@/lib/taxonomy/maps';

export const runtime = 'nodejs';

/**
 * Masterfile Import Preview
 *
 * Parses a masterfile CSV, maps columns to our DB fields,
 * computes diffs for tracked fields, and returns a structured preview.
 *
 * Tracked fields (business/operational):
 *   pricing: price, cost, special_price, promotion_price, promotion_tier_price, b2b
 *   status:  is_in_stock, custom_stock_status
 *   identity: name, brand, bottle_size, vintage
 *   geography: country, region, classification, grape_variety, wine_type, liquor_main_type
 *
 * Skipped (taste/enrichment — cleaned separately):
 *   wine_body, wine_acidity, wine_tannin, food_matching, flavor_profile, character_traits
 */

// Map masterfile column headers → our DB field names
const COLUMN_MAP: Record<string, string> = {
  'sku':                   'sku',
  'name':                  'name',
  'brand':                 'brand',
  'bottle_size':           'bottle_size',
  'vintage':               'vintage',
  'cost':                  'cost',
  'price':                 'price',
  'special_price':         'special_price',
  'is_in_stock':           'is_in_stock',
  'custom_stock_status':   'custom_stock_status',
  'promotion_price':       'promotion_price',
  'promotion_tier_price':  'promotion_tier_price',
  'b2b':                   'b2b_price',
  'country':               'country',
  'region_wine':           'region',
  'wine_type':             'classification',
  'grape_variety':         'grape_variety',
  'grape_class':           'grape_class',
  'liquor_main_type':      'liquor_main_type',
  'other_type':            'other_type',
  'manufacturer':          'manufacturer',
  'supplier_code':         'supplier_code',
  'type':                  'sku_type',
  'web':                   'web_flag',
  'price_group':           'price_group',
  'margin_thb':            'margin_thb',
  'margin':                'margin_pct',
  'sp_discount':           'sp_discount_pct',
  'b2b_margin_thb':        'b2b_margin_thb',
  'b2b_margin':            'b2b_margin_pct',
  'b2b_discount':          'b2b_discount_pct',
  'content':               'content_tag',
  'wn_stock':              'wn_stock',
  'consign':               'consign',
  'sold_order_mar':        'sold_orders',
  'sold_qty_mar':          'sold_qty',
};

// Fields we actually track changes for and write to changelog
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

// Fields that are numeric (compare as numbers to avoid "755" vs "755.0" false diffs)
const NUMERIC_FIELDS = new Set([
  'cost', 'price', 'special_price', 'promotion_price', 'promotion_tier_price', 'b2b_price',
  'margin_thb', 'b2b_margin_thb', 'sold_orders', 'sold_qty', 'wn_stock',
]);

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/%/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

export interface DiffChange {
  field: string;
  oldValue: string;
  newValue: string;
  category: 'pricing' | 'status' | 'identity' | 'geography' | 'operational';
}

export interface DiffRow {
  sku: string;
  productId: string;
  productName: string;
  changes: DiffChange[];
}

function categorizeField(field: string): DiffChange['category'] {
  if (['price', 'cost', 'special_price', 'promotion_price', 'promotion_tier_price', 'b2b_price',
       'margin_thb', 'margin_pct', 'sp_discount_pct', 'b2b_margin_thb', 'b2b_margin_pct', 'b2b_discount_pct',
       'price_group'].includes(field)) return 'pricing';
  if (['is_in_stock', 'custom_stock_status'].includes(field)) return 'status';
  if (['name', 'brand', 'bottle_size', 'vintage', 'manufacturer', 'supplier_code'].includes(field)) return 'identity';
  if (['country', 'region', 'classification', 'grape_variety', 'liquor_main_type'].includes(field)) return 'geography';
  return 'operational';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csvText: string = body.csvText;
    if (!csvText) return NextResponse.json({ error: 'csvText required' }, { status: 400 });

    const rows = parseCsvText(csvText);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV needs header + data rows' }, { status: 400 });

    const rawHeaders = rows[0];
    const normalizedHeaders = rawHeaders.map(normalizeHeader);

    // Find SKU column
    const skuColIdx = normalizedHeaders.findIndex(h => h === 'sku');
    if (skuColIdx < 0) return NextResponse.json({ error: 'CSV must contain a "sku" column' }, { status: 400 });

    // Build column index → DB field mapping
    const colMapping: Array<{ colIdx: number; dbField: string }> = [];
    normalizedHeaders.forEach((nh, idx) => {
      if (idx === skuColIdx) return;
      const dbField = COLUMN_MAP[nh];
      if (dbField && dbField !== 'sku' && TRACKED_FIELDS.has(dbField)) {
        colMapping.push({ colIdx: idx, dbField });
      }
    });

    // Load existing products
    const allProducts = await getCleanedProducts();
    const productBySku = new Map(allProducts.map(p => [String(p.sku ?? '').toUpperCase(), p]));

    const matched: DiffRow[] = [];
    const newSkus: Array<{ sku: string; name: string; price: string; country: string }> = [];
    const unmatchedSkus: string[] = [];
    let totalRows = 0;

    const nameColIdx = normalizedHeaders.findIndex(h => h === 'name');
    const priceColIdx = normalizedHeaders.findIndex(h => h === 'price');
    const countryColIdx = normalizedHeaders.findIndex(h => h === 'country');

    for (const row of rows.slice(1)) {
      const sku = String(row[skuColIdx] ?? '').trim().toUpperCase();
      if (!sku) continue;
      totalRows++;

      const product = productBySku.get(sku);
      if (!product) {
        newSkus.push({
          sku,
          name: nameColIdx >= 0 ? String(row[nameColIdx] ?? '').trim() : '',
          price: priceColIdx >= 0 ? String(row[priceColIdx] ?? '').trim() : '',
          country: countryColIdx >= 0 ? String(row[countryColIdx] ?? '').trim() : '',
        });
        continue;
      }

      const changes: DiffChange[] = [];
      for (const { colIdx, dbField } of colMapping) {
        const newVal = normalizeValue(String(row[colIdx] ?? ''), dbField);
        if (!newVal) continue;
        const oldVal = product[dbField] != null ? normalizeValue(String(product[dbField]), dbField) : '';
        if (oldVal !== newVal) {
          changes.push({ field: dbField, oldValue: oldVal, newValue: newVal, category: categorizeField(dbField) });
        }
      }

      if (changes.length > 0) {
        matched.push({
          sku,
          productId: String(product.id ?? ''),
          productName: String(product.name ?? ''),
          changes,
        });
      }
    }

    // Summary stats
    const summary = {
      totalRows,
      existingMatched: totalRows - newSkus.length,
      withChanges: matched.length,
      newProducts: newSkus.length,
      totalChanges: matched.reduce((s, m) => s + m.changes.length, 0),
      byCategory: {
        pricing: 0,
        status: 0,
        identity: 0,
        geography: 0,
        operational: 0,
      },
      priceUp: 0,
      priceDown: 0,
      costUp: 0,
      costDown: 0,
      stockIn: 0,   // went from 0→1
      stockOut: 0,   // went from 1→0
    };

    for (const m of matched) {
      for (const c of m.changes) {
        summary.byCategory[c.category]++;
        if (c.field === 'price') {
          const diff = parseFloat(c.newValue) - parseFloat(c.oldValue);
          if (diff > 0) summary.priceUp++;
          else if (diff < 0) summary.priceDown++;
        }
        if (c.field === 'cost') {
          const diff = parseFloat(c.newValue) - parseFloat(c.oldValue);
          if (diff > 0) summary.costUp++;
          else if (diff < 0) summary.costDown++;
        }
        if (c.field === 'is_in_stock') {
          if (c.newValue === '1' && c.oldValue === '0') summary.stockIn++;
          if (c.newValue === '0' && c.oldValue === '1') summary.stockOut++;
        }
      }
    }

    return NextResponse.json({ matched, newSkus: newSkus.slice(0, 100), summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Preview failed' }, { status: 500 });
  }
}
