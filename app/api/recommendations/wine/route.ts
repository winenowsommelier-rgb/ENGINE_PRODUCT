import { NextRequest, NextResponse } from 'next/server';
import { readProducts } from '@/lib/db/client';
import { findAnchorProduct, recommendWineProducts, wineRecommendationMethodology } from '@/lib/recommendation/wine';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get('sku') || req.nextUrl.searchParams.get('id') || '';
    const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 6)));
    if (!key.trim()) {
      return NextResponse.json({ error: 'sku or id is required' }, { status: 400 });
    }

    const products = await readProducts();
    const anchor = findAnchorProduct(products, key);
    if (!anchor) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const recommendations = recommendWineProducts(anchor, products, limit);
    return NextResponse.json({
      anchor: {
        id: anchor.id,
        sku: anchor.sku,
        name: anchor.name,
        brand: anchor.brand,
        classification: anchor.classification,
        country: anchor.country,
        region: anchor.region,
        subregion: anchor.subregion,
        grape_variety: anchor.grape_variety,
        price: anchor.price,
        currency: anchor.currency,
        wine_body: anchor.wine_body,
        wine_acidity: anchor.wine_acidity,
        wine_tannin: anchor.wine_tannin,
        wine_sweetness: anchor.wine_sweetness,
      },
      recommendations,
      methodology: wineRecommendationMethodology(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recommendation failed' },
      { status: 500 },
    );
  }
}

