#!/usr/bin/env ts-node

/**
 * Data Enrichment Workflow
 *
 * This script demonstrates how to:
 * 1. Load and analyze product data
 * 2. Validate data quality
 * 3. Enrich missing fields with AI
 * 4. Update the database with enriched data
 */

import { dataAccess } from '../lib/data-access';
import { validator } from '../lib/data-validation';
import { enricher } from '../lib/data-enrichment';
import { workflow } from '../lib/workflow';

async function main() {
  console.log('🍷 Wine-Now Engine Product Data Enrichment Workflow\n');

  const command = process.argv[2];
  const arg = process.argv[3];

  try {
    switch (command) {
      case 'analyze':
        await analyzeData();
        break;

      case 'validate':
        await validateData(arg ? parseInt(arg) : 100);
        break;

      case 'enrich':
        await enrichData(arg || 'full_description');
        break;

      case 'full':
        await runFullCycle();
        break;

      case 'stats':
        await showStatistics();
        break;

      case 'search':
        await searchProducts(arg || 'cabernet');
        break;

      case 'enrich-gaps':
        await showEnrichmentGaps();
        break;

      default:
        showHelp();
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function analyzeData() {
  console.log('📊 Analyzing Data Quality\n');

  const metrics = await dataAccess.getDataQualityMetrics();
  const gaps = await dataAccess.getEnrichmentGaps();

  console.log(`Total Products: ${metrics.totalProducts}`);
  console.log(`Validated: ${metrics.validatedProducts}`);
  console.log(`Needs Review: ${metrics.productsNeedingReview}`);
  console.log(`Average Confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%\n`);

  console.log('Field Coverage:');
  for (const [field, coverage] of Object.entries(metrics.coverageByField)) {
    const missing = metrics.fieldsWithMissing[field] || 0;
    console.log(`  ${field}: ${coverage.toFixed(1)}% (${missing} missing)`);
  }

  console.log('\nTop Enrichment Gaps:');
  for (const gap of gaps.slice(0, 5)) {
    console.log(
      `  ${gap.field}: ${gap.missingCount} missing (${(100 - gap.coverage).toFixed(1)}% gap) - Priority: ${gap.priority}`
    );
  }
}

async function validateData(limit: number) {
  console.log(`✓ Validating Products (limit: ${limit})\n`);

  const products = await dataAccess.getProducts();
  const batch = products.slice(0, limit);

  const results = validator.validateBatch(batch);
  const summary = validator.getValidationSummary(results);

  console.log(`Total Validated: ${summary.validProducts}/${summary.totalProducts}`);
  console.log(`Errors: ${summary.errorCount}`);
  console.log(`Warnings: ${summary.warningCount}`);
  console.log(`Average Confidence: ${(summary.averageConfidence * 100).toFixed(1)}%\n`);

  // Show sample issues
  const issuesCount = results.filter(r => r.issues.length > 0).length;
  if (issuesCount > 0) {
    console.log(`Products with issues: ${issuesCount}\n`);

    const sampleIssues = results
      .filter(r => r.issues.length > 0)
      .slice(0, 5)
      .flatMap(r =>
        r.issues.slice(0, 2).map(i => ({
          sku: r.sku,
          field: i.field,
          issue: i.issue,
          severity: i.severity
        }))
      );

    console.log('Sample Issues:');
    for (const issue of sampleIssues) {
      console.log(
        `  [${issue.severity}] ${issue.sku} - ${issue.field}: ${issue.issue}`
      );
    }
  }
}

async function enrichData(field: string) {
  console.log(`🚀 Enriching Products (field: ${field})\n`);

  const products = await dataAccess.getProductsForEnrichment(field, 10);
  console.log(`Found ${products.length} products missing ${field}\n`);

  if (products.length === 0) {
    console.log('No products to enrich for this field.');
    return;
  }

  const results = await enricher.enrichBatch(products, 10);

  let updatedCount = 0;
  for (const result of results) {
    if (result.changes.length > 0) {
      const product = products.find(p => p.sku === result.sku);
      if (product) {
        await dataAccess.updateProduct(product.id, result.enrichedData);
        updatedCount++;

        console.log(`✓ ${result.sku}`);
        for (const change of result.changes) {
          console.log(`  ${change.field}: ${String(change.oldValue).slice(0, 30)}... → ${String(change.newValue).slice(0, 30)}...`);
        }
      }
    }
  }

  console.log(`\nUpdated: ${updatedCount} products`);
}

async function runFullCycle() {
  console.log('🔄 Running Full Enrichment Cycle\n');

  const stats = await workflow.fullEnrichmentCycle();

  console.log('\nWorkflow Statistics:');
  console.log(`Total Processed: ${stats.totalProcessed}`);
  console.log(`Validated: ${stats.validated}`);
  console.log(`Enriched: ${stats.enriched}`);
  console.log(`Updated in Database: ${stats.updatedInDatabase}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.forEach(e => console.log(`  - ${e}`));
  }
}

async function showStatistics() {
  console.log('📈 Product Database Statistics\n');

  const stats = await dataAccess.getProductStats();

  console.log('By Classification:');
  const classificationEntries = Object.entries(stats.byClassification).sort(([, a], [, b]) => b - a);
  for (const [classification, count] of classificationEntries.slice(0, 10)) {
    console.log(`  ${classification}: ${count}`);
  }

  console.log('\nTop 10 Countries:');
  const countryEntries = Object.entries(stats.byCountry).sort(([, a], [, b]) => b - a);
  for (const [country, count] of countryEntries.slice(0, 10)) {
    console.log(`  ${country}: ${count}`);
  }

  console.log('\nBy Validation Status:');
  for (const [status, count] of Object.entries(stats.byValidationStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log(`\nPrice Range: ${Math.round(stats.priceRange.min)} - ${Math.round(stats.priceRange.max)}`);
  console.log(`Average Price: ${Math.round(stats.priceRange.avg)}`);
}

async function searchProducts(query: string) {
  console.log(`🔍 Searching for: "${query}"\n`);

  const results = await dataAccess.searchProducts(query, 10);

  if (results.length === 0) {
    console.log('No products found.');
    return;
  }

  for (const product of results) {
    console.log(`SKU: ${product.sku}`);
    console.log(`Name: ${product.name}`);
    console.log(`Brand: ${product.brand}`);
    console.log(`Country: ${product.country}`);
    console.log(`Classification: ${product.classification}`);
    console.log(`Price: ${product.price}`);
    console.log(`Confidence: ${(product.overall_confidence! * 100).toFixed(1)}%`);
    console.log(`Status: ${product.validation_status}`);
    console.log('---');
  }

  console.log(`\nFound ${results.length} products`);
}

async function showEnrichmentGaps() {
  console.log('📋 Enrichment Gaps\n');

  const gaps = await dataAccess.getEnrichmentGaps();

  console.log('Field\t\t\tMissing\tCoverage\tPriority');
  console.log('─────────────────────────────────────────────');

  for (const gap of gaps) {
    const coverage = gap.coverage.toFixed(1);
    console.log(`${gap.field.padEnd(24)}\t${gap.missingCount}\t${coverage}%\t\t${gap.priority}`);
  }
}

function showHelp() {
  console.log(`
Usage: npx ts-node scripts/data-enrichment-workflow.ts [command] [args]

Commands:
  analyze                  Analyze data quality and gaps
  validate [limit]         Validate products (default: 100)
  enrich [field]          Enrich specific field (default: full_description)
  full                    Run full enrichment cycle
  stats                   Show product statistics
  search [query]          Search products (default: cabernet)
  enrich-gaps             Show enrichment gaps

Examples:
  npx ts-node scripts/data-enrichment-workflow.ts analyze
  npx ts-node scripts/data-enrichment-workflow.ts validate 50
  npx ts-node scripts/data-enrichment-workflow.ts enrich grape_variety
  npx ts-node scripts/data-enrichment-workflow.ts full
  npx ts-node scripts/data-enrichment-workflow.ts search "pinot noir"
  npx ts-node scripts/data-enrichment-workflow.ts stats
  npx ts-node scripts/data-enrichment-workflow.ts enrich-gaps
  `);
}

main().catch(console.error);
