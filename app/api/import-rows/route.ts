import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RawImportRow = {
  sku: string; name: string; category: string; type: string;
  grape: string; region: string; style: string; price: string;
  costPrice: string; currency: string; status: string; oak: string;
};

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function mapRow(row: Record<string, unknown>): RawImportRow {
  const wineType = str(row.wine_type ?? row.liquor_main_type);
  const category = wineType.toLowerCase().includes('wine') ? 'Wine' : 'Spirits';
  const isInStock = Number(row.is_in_stock);
  return {
    sku: str(row.sku) || str(row.sku_1),
    name: str(row.name),
    category,
    type: wineType,
    grape: str(row.grape_variety ?? row.grape_class),
    region: str(row.region_wine_1 ?? row.region_wine ?? row.region),
    style: wineType || str(row.wine_type),
    price: str(row.price),
    costPrice: str(row.cost),
    currency: 'THB',
    status: isInStock === 1 ? 'Ready' : 'Draft',
    oak: '0',
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '200'), 500);
  const offset = Number(searchParams.get('offset') ?? '0');

  try {
    const filePath = join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { rows?: Record<string, unknown>[] };
    const allRows = (data?.rows ?? []).map(mapRow);
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
