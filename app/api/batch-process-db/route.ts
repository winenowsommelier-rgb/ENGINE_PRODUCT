import { NextRequest, NextResponse } from 'next/server';
import {
  initializeDatabase,
  loadTaxonomy,
  saveCleanedProduct,
  getCleanedProducts,
  getProductStats,
  saveBatchLog,
  getBatchLogs,
  addDataIssue,
  addToScrapingQueue,
} from '@/lib/db/client';
import { processBatch } from '@/lib/batch-processor';

export const runtime = 'nodejs';

// Initialize database on first request
let dbInitialized = false;

function ensureDbInitialized() {
  if (!dbInitialized) {
    try {
      initializeDatabase();
      loadTaxonomy();
      dbInitialized = true;
      console.log('✓ Database initialized');
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }
}

// POST /api/batch-process - Process and save batch to database
export async function POST(req: NextRequest) {
  try {
    ensureDbInitialized();
    
    const data = await req.json();
    const { rows, batch_id, source_file } = data;

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'Invalid rows data' }, { status: 400 });
    }

    // Process rows through AI normalization
    const batchResult = processBatch(rows, source_file || 'api-upload');
    
    // Calculate statistics
    const stats = {
      total: batchResult.totalRows,
      processed: batchResult.rows.length,
      ready: batchResult.readyRows,
      review: batchResult.reviewRows,
      blocked: batchResult.blockedRows,
    };

    // Save each normalized row to database
    let successCount = 0;
    let issueCount = 0;

    for (const row of batchResult.rows) {
      try {
        // Save cleaned product
        await saveCleanedProduct({
          id: row.id,
          sku: row.sku,
          name: row.name,
          country: row.country,
          region: row.region,
          subregion: row.subregion,
          origin: row.origin,
          classification: row.classification,
          origin_source: row.origin_source,
          classification_source: row.classification_source,
          grape_variety: row.grape_variety,
          price: row.price,
          cost: row.cost,
          currency: row.currency,
          quantity_in_stock: 0,
          taxonomy_confidence: row.confidence,
          description_confidence: 0,
          overall_confidence: row.confidence,
          validation_status: 'needs_review',
          full_description: row.name, // Will be populated by scraping
          flavor_profile: JSON.stringify(row.flavorNotes || []),
          character_traits: JSON.stringify(row.flavorFamilies || []),
          brand: row.brand,
          vintage: row.vintage,
          alcohol: row.alcohol,
          bottle_size: row.bottle_size,
          // Image support (to be populated by scraping)
          image_url: null,
          image_scraped_url: null,
          image_local_path: null,
          image_alt_text: row.name,
          batch_id: batch_id || `batch-${Date.now()}`,
          source_file: source_file || 'api-upload',
        });

        successCount++;

        // Add data issues if any
        if (row.errors && row.errors.length > 0) {
          for (const errMsg of row.errors) {
            await addDataIssue({
              product_id: row.id,
              sku: row.sku,
              issue_type: 'validation_error',
              severity: 'critical',
              description: errMsg,
            });
          }
          issueCount++;
        }

        if (row.warnings && row.warnings.length > 0) {
          for (const warning of row.warnings) {
            await addDataIssue({
              product_id: row.id,
              sku: row.sku,
              issue_type: 'validation_warning',
              severity: 'warning',
              description: warning,
            });
          }
        }

        // Queue for scraping and enrich metadata (async follow-up)
        await addToScrapingQueue({
          id: row.id,
          sku: row.sku,
          name: row.name,
          country: row.country,
          region: row.region,
          status: row.status,
          created_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`Error saving product ${row.sku}:`, error);
      }
    }

    // Save batch log
    const logId = batch_id || `batch-${Date.now()}`;
    await saveBatchLog({
      id: logId,
      source_file: source_file || 'api-upload',
      source_type: 'api',
      total_rows: stats.total,
      processed_rows: successCount,
      ready_rows: stats.ready,
      review_rows: stats.review,
      blocked_rows: stats.blocked,
      status: 'completed',
      notes: `Processed ${successCount} products with ${issueCount} issues identified`,
    });

    // Fire enrichment pipeline in background
    import('@/lib/enrichment/pipeline').then(({ runEnrichmentPipeline }) => {
      runEnrichmentPipeline().catch(console.error);
    });

    return NextResponse.json({
      success: true,
      batch_id: logId,
      stats,
      saved: successCount,
      issues: issueCount,
      enrichmentStarted: true,
      message: `Saved ${successCount} products. Enrichment pipeline started in background.`,
    });
  } catch (error) {
    console.error('Batch processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}

// GET /api/batch-process - Get database statistics
export async function GET(req: NextRequest) {
  try {
    ensureDbInitialized();

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'stats') {
      const stats = await getProductStats();
      return NextResponse.json(stats);
    }

    if (action === 'products') {
      const filters = {
        validation_status: searchParams.get('status') || undefined,
        country: searchParams.get('country') || undefined,
        search: searchParams.get('search') || undefined,
        confidence_min: searchParams.get('confidence_min') ? parseFloat(searchParams.get('confidence_min')!) : undefined,
      };
      const products = await getCleanedProducts(filters);
      return NextResponse.json({
        count: products.length,
        products: products.slice(0, 100), // Paginate
      });
    }

    if (action === 'logs') {
      const logs = await getBatchLogs();
      return NextResponse.json({ logs });
    }

    // Default: return stats
    const stats = await getProductStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 }
    );
  }
}
