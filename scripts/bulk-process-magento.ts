#!/usr/bin/env node

/**
 * Bulk Magento Data Processor
 * Processes all 11,187 Magento items in batches with proper logging
 */

import fs from 'fs';
import path from 'path';
import { processBatch } from '../lib/batch-processor.js';
import {
  initializeDatabase,
  loadTaxonomy,
  saveCleanedProduct,
  saveBatchLog,
  addDataIssue,
  addToScrapingQueue,
} from '../lib/db/client.js';

const BATCH_SIZE = 500; // Process 500 items at a time
const RESUME_FROM_SKU = 'GWN0311AB'; // Resume from this SKU (set to null to start from beginning)

async function processAllMagentoData() {
  console.log('🚀 Starting bulk Magento data processing...\n');

  try {
    // Initialize database
    initializeDatabase();
    loadTaxonomy();
    console.log('✓ Database initialized\n');

    // Load all Magento data
    const magentoFile = path.join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    const magentoData = JSON.parse(fs.readFileSync(magentoFile, 'utf-8'));
    const allItems = magentoData.data || [];

    console.log(`📊 Found ${allItems.length} Magento items to process\n`);

    // Find resume point if specified
    let startIndex = 0;
    if (RESUME_FROM_SKU) {
      const resumeIndex = allItems.findIndex((item: any) => item.sku === RESUME_FROM_SKU);
      if (resumeIndex !== -1) {
        startIndex = resumeIndex + 1; // Start from the next item
        console.log(`🔄 Resuming from SKU "${RESUME_FROM_SKU}" (index ${startIndex})\n`);
      } else {
        console.log(`⚠️  Resume SKU "${RESUME_FROM_SKU}" not found, starting from beginning\n`);
      }
    }

    const itemsToProcess = allItems.slice(startIndex);
    console.log(`📊 Processing ${itemsToProcess.length} remaining items\n`);

    let totalProcessed = 0;
    let totalReady = 0;
    let totalReview = 0;
    let totalBlocked = 0;
    let totalIssues = 0;
    const batches = [];

    // Process in batches
    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
      const batchItems = itemsToProcess.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor((startIndex + i) / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allItems.length / BATCH_SIZE);

      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batchItems.length} items)...`);

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
          console.error(`❌ Error saving product ${row.sku}:`, error);
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

      console.log(`✅ Batch ${batchNumber} completed: ${batchSaved} saved, ${batchIssues} issues\n`);
    }

    console.log('🎉 Bulk processing completed!\n');
    console.log('📈 Final Statistics:');
    console.log(`   • Total processed: ${totalProcessed}`);
    console.log(`   • Ready for use: ${totalReady}`);
    console.log(`   • Needs review: ${totalReview}`);
    console.log(`   • Blocked: ${totalBlocked}`);
    console.log(`   • Total issues: ${totalIssues}`);
    console.log(`   • Batches completed: ${batches.length}`);
    console.log(`   • Average confidence: ${((totalReady / totalProcessed) * 100).toFixed(1)}%\n`);

    return {
      success: true,
      stats: {
        total_processed: totalProcessed,
        total_ready: totalReady,
        total_review: totalReview,
        total_blocked: totalBlocked,
        total_issues: totalIssues,
        batches_completed: batches.length,
      },
      batches,
    };

  } catch (error) {
    console.error('💥 Bulk processing failed:', error);
    throw error;
  }
}

// Run the bulk processing
processAllMagentoData()
  .then(() => {
    console.log('✅ Bulk processing script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Bulk processing script failed:', error);
    process.exit(1);
  });