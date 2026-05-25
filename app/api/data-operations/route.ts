import { NextRequest, NextResponse } from 'next/server';
import { dataAccess } from '@/lib/data-access';
import { validator } from '@/lib/data-validation';
import { enricher } from '@/lib/data-enrichment';

/**
 * Direct access to data enrichment from CLI or external services
 * Endpoint: POST /api/data-operations
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, params } = body;

    switch (action) {
      // Analyze data quality
      case 'analyze': {
        const metrics = await dataAccess.getDataQualityMetrics();
        const gaps = await dataAccess.getEnrichmentGaps();
        return NextResponse.json({ metrics, gaps });
      }

      // Validate products
      case 'validate': {
        const { limit = 100 } = params;
        const products = await dataAccess.getProducts();
        const batch = products.slice(0, limit);
        const results = validator.validateBatch(batch);
        const summary = validator.getValidationSummary(results);
        return NextResponse.json({ summary, sampleIssues: results.slice(0, 5) });
      }

      // Get enrichment gaps
      case 'get-gaps': {
        const gaps = await dataAccess.getEnrichmentGaps();
        return NextResponse.json({ gaps });
      }

      // Search products
      case 'search': {
        const { query, limit = 20 } = params;
        const results = await dataAccess.searchProducts(query, limit);
        return NextResponse.json({ results, count: results.length });
      }

      // Get products for enrichment
      case 'get-for-enrichment': {
        const { field, limit = 20 } = params;
        const products = await dataAccess.getProductsForEnrichment(field, limit);
        return NextResponse.json({ products, count: products.length, field });
      }

      // Enrich products
      case 'enrich': {
        const { field, limit = 10 } = params;
        const products = await dataAccess.getProductsForEnrichment(field, limit);
        const enrichResults = await enricher.enrichBatch(products, limit);

        let updated = 0;
        for (const result of enrichResults) {
          if (result.changes.length > 0) {
            const product = products.find(p => p.sku === result.sku);
            if (product) {
              await dataAccess.updateProduct(product.id, result.enrichedData);
              updated++;
            }
          }
        }

        return NextResponse.json({
          enriched: enrichResults.length,
          updated,
          field,
          results: enrichResults.slice(0, 5)
        });
      }

      // Get statistics
      case 'stats': {
        const stats = await dataAccess.getProductStats();
        const metrics = await dataAccess.getDataQualityMetrics();
        return NextResponse.json({ stats, metrics });
      }

      // Get single product
      case 'get-product': {
        const { sku } = params;
        const product = await dataAccess.getProductBySku(sku);
        if (!product) {
          return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }
        const validation = validator.validateProduct(product);
        return NextResponse.json({ product, validation });
      }

      // Update product
      case 'update-product': {
        const { productId, updates, note } = params;
        const updated = await dataAccess.updateProduct(productId, {
          ...updates,
          enrichment_note: note || 'Updated via API'
        });
        if (!updated) {
          return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }
        return NextResponse.json({ updated });
      }

      // Batch enrich
      case 'enrich-batch': {
        const { field, count = 50 } = params;
        const products = await dataAccess.getProductsForEnrichment(field, count);
        const enrichResults = await enricher.enrichBatch(products, count);

        let updated = 0;
        const changes = [];

        for (const result of enrichResults) {
          if (result.changes.length > 0) {
            const product = products.find(p => p.sku === result.sku);
            if (product) {
              await dataAccess.updateProduct(product.id, result.enrichedData);
              updated++;
              changes.push({
                sku: result.sku,
                changes: result.changes
              });
            }
          }
        }

        return NextResponse.json({
          field,
          enriched: enrichResults.length,
          updated,
          changes: changes.slice(0, 10),
          remainingGap: enrichResults.length - updated
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Data operations error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (action === 'analyze') {
    const metrics = await dataAccess.getDataQualityMetrics();
    const gaps = await dataAccess.getEnrichmentGaps();
    return NextResponse.json({ metrics, gaps });
  }

  if (action === 'gaps') {
    const gaps = await dataAccess.getEnrichmentGaps();
    return NextResponse.json({ gaps });
  }

  if (action === 'stats') {
    const stats = await dataAccess.getProductStats();
    const metrics = await dataAccess.getDataQualityMetrics();
    return NextResponse.json({ stats, metrics });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
