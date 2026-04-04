import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/magento-items - Load Magento product data
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '200', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const action = searchParams.get('action');

    // Check if we need full count
    if (action === 'count') {
      try {
        const magentoPath = path.join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
        if (fs.existsSync(magentoPath)) {
          const data = JSON.parse(fs.readFileSync(magentoPath, 'utf-8'));
          const total = data.data?.length || 0;
          return NextResponse.json({ total, pages: Math.ceil(total / limit) });
        }
      } catch (error) {
        console.error('Error counting items:', error);
      }
    }

    // Load paginated rows
    const magentoPath = path.join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    
    if (!fs.existsSync(magentoPath)) {
      return NextResponse.json({
        error: 'Magento data file not found. Run extract_taxonomy.py first.',
        total: 0,
        rows: [],
      });
    }

    const fileData = JSON.parse(fs.readFileSync(magentoPath, 'utf-8'));
    const allRows = fileData.data || [];

    const total = allRows.length;
    const rows = allRows.slice(offset, offset + limit);

    // Transform rows to importable format
    const transformedRows = rows.map((row: any, idx: number) => ({
      id: `magento-${offset + idx}`,
      sku: row.sku || row.SKU || `product-${offset + idx}`,
      name: row.name || row.Name || row.product_name || 'Unknown',
      mainCategory: row.category || row.Category || row.main_category || 'Uncategorized',
      wine_type: row.wine_type || row.type || row.product_type || '',
      country: row.country || row.Country || row.origin || '',
      region: row.region || row.Region || '',
      grape_variety: row.grape || row.Grape || row.grape_variety || '',
      vintage: row.vintage || row.Vintage || '',
      price: parseFloat(row.price || row.Price || '0'),
      cost: parseFloat(row.cost || row.Cost || '0'),
      currency: row.currency || 'USD',
      quantity_in_stock: parseInt(row.quantity_in_stock || row.qty || '0', 10),
      brand: row.brand || row.Brand || '',
      description: row.description || row.Description || '',
      raw: row,
    }));

    return NextResponse.json({
      total,
      offset,
      limit,
      rows: transformedRows,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('Magento items error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load items' },
      { status: 500 }
    );
  }
}
