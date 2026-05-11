import { dataAccess, Product, DataAccessService } from './data-access';
import { validator, DataValidator } from './data-validation';
import { enricher, DataEnricher } from './data-enrichment';

export interface WorkflowStats {
  totalProcessed: number;
  validated: number;
  enriched: number;
  updatedInDatabase: number;
  errors: string[];
  timestamp: string;
}

export class DataWorkflow {
  private dataAccess: DataAccessService;
  private validator: DataValidator;
  private enricher: DataEnricher;
  private stats: WorkflowStats = {
    totalProcessed: 0,
    validated: 0,
    enriched: 0,
    updatedInDatabase: 0,
    errors: [],
    timestamp: new Date().toISOString()
  };

  constructor() {
    this.dataAccess = dataAccess;
    this.validator = validator;
    this.enricher = enricher;
  }

  async analyzeDataQuality(): Promise<{
    metrics: any;
    gaps: any;
    summary: string;
  }> {
    console.log('📊 Analyzing data quality...');

    const metrics = await this.dataAccess.getDataQualityMetrics();
    const gaps = await this.dataAccess.getEnrichmentGaps();

    const summary = `
Data Quality Report
==================
Total Products: ${metrics.totalProducts}
Validated: ${metrics.validatedProducts}
Needs Review: ${metrics.productsNeedingReview}
Average Confidence: ${(metrics.averageConfidence * 100).toFixed(1)}%

Top Enrichment Gaps:
${gaps
  .slice(0, 5)
  .map(
    g =>
      `  - ${g.field}: ${g.missingCount} missing (${(100 - g.coverage).toFixed(1)}% gap) - Priority: ${g.priority}`
  )
  .join('\n')}
    `;

    console.log(summary);

    return { metrics, gaps, summary };
  }

  async validateProducts(limit = 100): Promise<{
    total: number;
    valid: number;
    invalid: number;
    issues: any[];
  }> {
    console.log(`\n✓ Validating products (limit: ${limit})...`);

    const products = await this.dataAccess.getProducts();
    const batch = products.slice(0, limit);

    const results = this.validator.validateBatch(batch);
    const summary = this.validator.getValidationSummary(results);

    const issues = results
      .filter(r => r.issues.length > 0)
      .flatMap(r =>
        r.issues.map(i => ({
          sku: r.sku,
          field: i.field,
          issue: i.issue,
          severity: i.severity
        }))
      );

    console.log(`Validated: ${summary.validProducts}/${summary.totalProducts}`);
    console.log(`Errors: ${summary.errorCount}, Warnings: ${summary.warningCount}`);
    console.log(`Average Confidence: ${(summary.averageConfidence * 100).toFixed(1)}%`);

    this.stats.validated += summary.validProducts;
    this.stats.totalProcessed += summary.totalProducts;

    return {
      total: summary.totalProducts,
      valid: summary.validProducts,
      invalid: summary.totalProducts - summary.validProducts,
      issues
    };
  }

  async enrichProducts(field: string, limit = 50): Promise<{
    enriched: number;
    total: number;
    changes: number;
    sample: any[];
  }> {
    console.log(`\n🚀 Enriching products (field: ${field}, limit: ${limit})...`);

    const products = await this.dataAccess.getProductsForEnrichment(field, limit);
    const results = await this.enricher.enrichBatch(products, limit);

    let totalChanges = 0;
    const sample = [];

    for (const result of results) {
      if (result.changes.length > 0) {
        totalChanges += result.changes.length;

        // Prepare update
        const updates: Partial<Product> = {
          ...result.enrichedData,
          validation_status: 'needs_review'
        };

        // Find product ID
        const product = products.find(p => p.sku === result.sku);
        if (product) {
          await this.dataAccess.updateProduct(product.id, updates);
          this.stats.updatedInDatabase++;

          sample.push({
            sku: result.sku,
            changes: result.changes
          });
        }
      }
    }

    this.stats.enriched += results.length;

    console.log(`Enriched: ${results.length} products`);
    console.log(`Total changes: ${totalChanges}`);

    return {
      enriched: results.length,
      total: products.length,
      changes: totalChanges,
      sample: sample.slice(0, 5)
    };
  }

  async enrichMissingFields(priorities: string[] = ['full_description', 'flavor_profile', 'grape_variety', 'region']): Promise<any> {
    console.log('\n🎯 Multi-field enrichment...');

    const results: Record<string, any> = {};

    for (const field of priorities) {
      console.log(`\nProcessing field: ${field}`);
      const result = await this.enrichProducts(field, 20);
      results[field] = result;
    }

    return results;
  }

  async processProductsByStatus(status: string, limit = 50): Promise<{
    processed: number;
    validated: number;
    enriched: number;
  }> {
    console.log(`\n📋 Processing products with status: ${status}`);

    const { products } = await this.dataAccess.getProductsByValidationStatus(status, limit);

    // Validate
    const validationResults = this.validator.validateBatch(products);
    const validCount = validationResults.filter(r => r.isValid).length;

    // Enrich
    const enrichResults = await this.enricher.enrichBatch(products, limit);
    let enrichCount = 0;

    for (const result of enrichResults) {
      if (result.changes.length > 0) {
        enrichCount++;
        const product = products.find(p => p.sku === result.sku);
        if (product) {
          await this.dataAccess.updateProduct(product.id, result.enrichedData);
        }
      }
    }

    console.log(`Processed: ${products.length}`);
    console.log(`Valid: ${validCount}`);
    console.log(`Enriched: ${enrichCount}`);

    return {
      processed: products.length,
      validated: validCount,
      enriched: enrichCount
    };
  }

  async fullEnrichmentCycle(): Promise<WorkflowStats> {
    console.log('\n🔄 Starting full enrichment cycle...\n');

    try {
      // Step 1: Analyze data quality
      await this.analyzeDataQuality();

      // Step 2: Validate sample
      const validation = await this.validateProducts(100);

      // Step 3: Enrich products with missing fields
      const enrichment = await this.enrichMissingFields([
        'full_description',
        'flavor_profile',
        'grape_variety',
        'region'
      ]);

      // Step 4: Validate improvements
      const finalValidation = await this.validateProducts(100);

      console.log('\n✅ Enrichment cycle complete!');
      console.log(`Updated: ${this.stats.updatedInDatabase} products in database`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.errors.push(message);
      console.error('Workflow error:', error);
    }

    return this.stats;
  }

  async getStatistics(): Promise<any> {
    const metrics = await this.dataAccess.getDataQualityMetrics();
    const stats = await this.dataAccess.getProductStats();
    const gaps = await this.dataAccess.getEnrichmentGaps();

    return {
      dataQuality: metrics,
      productStats: stats,
      enrichmentGaps: gaps,
      workflowStats: this.stats
    };
  }

  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      validated: 0,
      enriched: 0,
      updatedInDatabase: 0,
      errors: [],
      timestamp: new Date().toISOString()
    };
  }
}

export const workflow = new DataWorkflow();
