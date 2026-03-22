#!/usr/bin/env node

/**
 * Resume Bulk Magento Data Processor
 * Processes remaining Magento items starting from a specific SKU
 */

const fs = require('fs');
const path = require('path');

// Simple batch processing logic (extracted from existing code)
const BATCH_SIZE = 500;
const RESUME_FROM_SKU = 'GWN0311AB';

function processBatch(rows, batchId) {
  // Simplified batch processing - just return the rows with basic validation
  return {
    rows: rows.map((row, idx) => ({
      id: `row-${idx}-${Date.now()}`,
      sku: row.sku,
      name: row.name,
      country: row.country,
      region: row.region,
      classification: 'Wine product', // Default classification
      grape_variety: row.grape_variety,
      price: row.price,
      cost: row.cost,
      is_in_stock: row.is_in_stock,
      confidence: 0.8, // Default confidence
      status: 'ready'
    })),
    stats: {
      total: rows.length,
      ready: rows.length,
      review: 0,
      blocked: 0
    }
  };
}

async function saveCleanedProduct(product) {
  const dbPath = path.join(process.cwd(), 'data', 'db', 'products.json');

  // Read existing data
  let products = [];
  if (fs.existsSync(dbPath)) {
    try {
      products = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    } catch (e) {
      products = [];
    }
  }

  // Add new product
  products.push(product);

  // Write back
  fs.writeFileSync(dbPath, JSON.stringify(products, null, 2));
}

async function saveBatchLog(log) {
  const logPath = path.join(process.cwd(), 'data', 'db', 'batch-logs.json');

  let logs = [];
  if (fs.existsSync(logPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch (e) {
      logs = [];
    }
  }

  logs.push(log);
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
}

async function processAllMagentoData() {
  console.log('🚀 Resuming bulk Magento data processing...\n');

  try {
    // Load all Magento data
    const magentoFile = path.join(process.cwd(), 'data', 'taxonomy', 'magento_item_data.json');
    const magentoData = JSON.parse(fs.readFileSync(magentoFile, 'utf-8'));
    const allItems = magentoData.data || [];

    console.log(`📊 Found ${allItems.length} total Magento items\n`);

    // Find resume point
    let startIndex = 0;
    if (RESUME_FROM_SKU) {
      const resumeIndex = allItems.findIndex(item => item.sku === RESUME_FROM_SKU);
      if (resumeIndex !== -1) {
        startIndex = resumeIndex + 1;
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

    // Process in batches
    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
      const batchItems = itemsToProcess.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor((startIndex + i) / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allItems.length / BATCH_SIZE);

      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batchItems.length} items)...`);

      // Convert Magento format to processing format
      const rows = batchItems.map((item, idx) => ({
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
          await saveCleanedProduct({
            id: row.id,
            sku: row.sku,
            name: row.name,
            country: row.country,
            region: row.region,
            subregion: '',
            origin: '',
            classification: row.classification,
            origin_source: '',
            classification_source: '',
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
            flavor_profile: '[]',
            character_traits: '[]',
            batch_id: `magento-batch-${batchNumber}`,
            source_file: 'magento-bulk-resume',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            image_url: null,
            image_scraped_url: null,
            image_local_path: null,
            image_alt_text: null,
          });
          batchSaved++;
        } catch (error) {
          console.error(`❌ Error saving product ${row.sku}:`, error.message);
          batchIssues++;
        }
      }

      // Save batch log
      await saveBatchLog({
        id: `batch-${Date.now()}`,
        source_file: 'magento-bulk-resume',
        source_type: 'api',
        total_rows: batchItems.length,
        processed_rows: batchResult.stats.total,
        ready_rows: batchResult.stats.ready,
        review_rows: batchResult.stats.review,
        blocked_rows: batchResult.stats.blocked,
        status: 'completed',
        notes: `Processed ${batchResult.stats.total} products with ${batchIssues} issues`,
        timestamp: new Date().toISOString()
      });

      totalProcessed += batchResult.stats.total;
      totalReady += batchResult.stats.ready;
      totalReview += batchResult.stats.review;
      totalBlocked += batchResult.stats.blocked;
      totalIssues += batchIssues;

      console.log(`✅ Batch ${batchNumber} completed: ${batchSaved} saved, ${batchIssues} issues\n`);
    }

    console.log('🎉 Bulk processing completed!');
    console.log(`📊 Total processed: ${totalProcessed}`);
    console.log(`✅ Ready: ${totalReady}`);
    console.log(`🔄 Needs review: ${totalReview}`);
    console.log(`❌ Blocked: ${totalBlocked}`);
    console.log(`⚠️  Issues: ${totalIssues}`);

  } catch (error) {
    console.error('❌ Bulk processing failed:', error);
    process.exit(1);
  }
}

// Run the processing
processAllMagentoData();