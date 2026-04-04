import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  initializeDatabase,
  loadTaxonomy,
  saveCleanedProduct,
  saveBatchLog,
  addDataIssue,
  addToScrapingQueue,
} from '@/lib/db/client';
import { processBatch } from '@/lib/batch-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest) {
  try {
    ensureDbInitialized();

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'process-all') {
      // Process all remaining Magento data in batches
      return await processAllMagentoData();
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Bulk processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}

async function processAllMagentoData() {
  const BATCH_SIZE = 500; // Process 500 items at a time
  let totalProcessed = 0;
  let totalReady = 0;
  let totalReview = 0;
  let totalBlocked = 0;
  let totalIssues = 0;
  const batches = [];

  try {
    // Load all Magento data
    const magentoFile = path.join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    const magentoData = JSON.parse(fs.readFileSync(magentoFile, 'utf-8'));
    const allItems = magentoData.data || [];

    console.log(`Starting bulk processing of ${allItems.length} Magento items...`);

    // Process in batches
    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const batchItems = allItems.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allItems.length / BATCH_SIZE);

      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batchItems.length} items)...`);

      // Convert Magento format to our processing format
      const rows = batchItems.map((item: any, idx: number) => ({
        sku: item.sku || '',
        name: item.name || '',
        country: item.country || '',
        region: item.region || item.region_wine || '',
        wine_type: item.wine_type || '',
        liquor_main_type: item.liquor_main_type || '',
        grape_variety: item.grape_variety || item.grape_class || '',
        price: parseFloat(item.price) || 0,
        cost: parseFloat(item.cost) || 0,
        brand: item.brand || item.manufacturer || '',
        vintage: item.vintage || '',
        alcohol: item.alcohol || '',
        bottle_size: item.bottle_size || '',
        is_in_stock: item.is_in_stock || 0,
      }));

      // Process the batch
      const batchResult = processBatch(rows, `magento-batch-${batchNumber}`);

      // Save each normalized row to database
      let batchSaved = 0;
      let batchIssues = 0;

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
            currency: 'THB',
            quantity_in_stock: row.is_in_stock,
            taxonomy_confidence: row.confidence,
            description_confidence: 0,
            overall_confidence: row.confidence,
            validation_status: row.status === 'ready' ? 'validated' : row.status === 'blocked' ? 'blocked' : 'needs_review',
            full_description: row.name,
            flavor_profile: JSON.stringify(row.flavorNotes || []),
            character_traits: JSON.stringify(row.flavorFamilies || []),
            brand: row.brand,
            vintage: row.vintage,
            alcohol: row.alcohol,
            bottle_size: row.bottle_size,
            batch_id: `bulk-batch-${batchNumber}`,
            source_file: 'magento-bulk-import',
          });

          batchSaved++;

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
            batchIssues++;
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

          // Queue for scraping
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
      const logId = `bulk-batch-${batchNumber}`;
      await saveBatchLog({
        id: logId,
        source_file: 'magento-bulk-import',
        source_type: 'bulk',
        total_rows: batchResult.totalRows,
        processed_rows: batchSaved,
        ready_rows: batchResult.readyRows,
        review_rows: batchResult.reviewRows,
        blocked_rows: batchResult.blockedRows,
        status: 'completed',
        notes: `Bulk batch ${batchNumber}/${totalBatches}: Processed ${batchSaved}/${batchResult.totalRows} products with ${batchIssues} issues`,
      });

      // Update totals
      totalProcessed += batchSaved;
      totalReady += batchResult.readyRows;
      totalReview += batchResult.reviewRows;
      totalBlocked += batchResult.blockedRows;
      totalIssues += batchIssues;

      batches.push({
        batch: batchNumber,
        processed: batchSaved,
        ready: batchResult.readyRows,
        review: batchResult.reviewRows,
        blocked: batchResult.blockedRows,
        issues: batchIssues,
      });

      console.log(`Batch ${batchNumber} completed: ${batchSaved} saved, ${batchIssues} issues`);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${totalProcessed} products in ${batches.length} batches`,
      stats: {
        total_processed: totalProcessed,
        total_ready: totalReady,
        total_review: totalReview,
        total_blocked: totalBlocked,
        total_issues: totalIssues,
        batches_completed: batches.length,
        average_batch_size: Math.round(totalProcessed / batches.length),
      },
      batches,
    });

  } catch (error) {
    console.error('Bulk processing failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bulk processing failed' },
      { status: 500 }
    );
  }
}