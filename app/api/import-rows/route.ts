import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function mapRow(row: Record<string, unknown>) {
  const wineType = str(row.wine_type ?? row.liquor_main_type);
  return {
    sku: str(row.sku) || str(row.sku_1),
    name: str(row.name),
    category: wineType.toLowerCase().includes('wine') ? 'Wine' : 'Spirits',
    type: wineType,
    grape: str(row.grape_variety ?? row.grape_class),
    region: str(row.region_wine_1 ?? row.region_wine ?? row.region),
    style: wineType || str(row.wine_type),
    price: str(row.price),
    costPrice: str(row.cost),
    currency: 'THB',
    status: Number(row.is_in_stock) === 1 ? 'Ready' : 'Draft',
    oak: '0',
    // Extra Magento fields for batch processor
    wine_type: str(row.wine_type),
    liquor_main_type: str(row.liquor_main_type),
    country: str(row.country),
    region_wine: str(row.region_wine ?? row.region_wine_1),
    grape_variety: str(row.grape_variety),
    grape_class: str(row.grape_class),
    alcohol: str(row.alcohol),
    brand: str(row.brand),
    vintage: str(row.vintage),
    bottle_size: str(row.bottle_size),
    whisky_type: str(row.whisky_type),
    other_type: str(row.other_type),
    is_in_stock: Number(row.is_in_stock),
    cost: str(row.cost),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '200'), 500);
  const offset = Number(searchParams.get('offset') ?? '0');

  try {
    const filePath = join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { data?: Record<string, unknown>[] };
    const allRows = (data?.data ?? []).map(mapRow);
    const page = allRows.slice(offset, offset + limit);
    return NextResponse.json({
      rows: page,
      total: allRows.length,
      offset,
      limit,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch {
    return NextResponse.json({ rows: [], total: 0, offset: 0, limit }, { status: 200 });
  }
}
