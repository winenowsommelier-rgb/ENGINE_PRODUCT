# Data Access, Validation & Enrichment Guide

This guide walks you through how to use the comprehensive data access, validation, and enrichment system for the Wine-Now engine product database.

## Quick Start

### 1. Analyze Data Quality

```bash
npx tsx scripts/data-enrichment-workflow.ts analyze
```

This gives you:
- Total products and validation status
- Field coverage percentages
- Top enrichment gaps with priorities
- Average confidence scores

**Example Output:**
```
📊 Analyzing Data Quality

Total Products: 11436
Validated: 4052
Needs Review: 7378
Average Confidence: 33.9%

Field Coverage:
  country: 99.7% (40 missing)
  region: 66.7% (3805 missing)
  grape_variety: 55.4% (5102 missing)
  full_description: 37.9% (7103 missing)
```

### 2. Validate Products

```bash
npx tsx scripts/data-enrichment-workflow.ts validate 50
```

Validates up to 50 products and shows:
- Count of valid vs invalid products
- Errors and warnings
- Average confidence score
- Sample issues found

### 3. Search Products

```bash
npx tsx scripts/data-enrichment-workflow.ts search "pinot noir"
```

Returns matching products with full details:
- SKU, name, brand, country
- Classification and price
- Validation status and confidence

### 4. View Statistics

```bash
npx tsx scripts/data-enrichment-workflow.ts stats
```

Shows:
- Products by classification (Red Wine, Whisky, etc.)
- Top countries represented
- Validation status distribution
- Price range and averages

### 5. View Enrichment Gaps

```bash
npx tsx scripts/data-enrichment-workflow.ts enrich-gaps
```

Lists all missing fields with:
- Field name
- Count of missing values
- Coverage percentage
- Priority score

## Programmatic Usage

### Data Access

```typescript
import { dataAccess } from './lib/data-access';

// Load all products
const products = await dataAccess.getProducts();

// Get a product by SKU
const product = await dataAccess.getProductBySku('WRW0066AC');

// Search with filters
const { products, total } = await dataAccess.filterProducts({
  country: 'France',
  classification: 'Red Wine',
  priceMin: 500,
  priceMax: 2000,
  limit: 50,
  offset: 0
});

// Get products missing a specific field
const incomplete = await dataAccess.getProductsForEnrichment('full_description', 20);

// Get quality metrics
const metrics = await dataAccess.getDataQualityMetrics();

// Get enrichment gaps
const gaps = await dataAccess.getEnrichmentGaps();
```

### Validation

```typescript
import { validator } from './lib/data-validation';

// Validate a single product
const result = validator.validateProduct(product);
console.log(result.isValid);        // true/false
console.log(result.confidence);     // 0.0-1.0
console.log(result.issues);         // Array of issues

// Validate a batch
const results = validator.validateBatch(products);

// Get validation summary
const summary = validator.getValidationSummary(results);
console.log(summary.validProducts);  // count
console.log(summary.errorCount);     // count
console.log(summary.averageConfidence);  // 0.0-1.0
```

### Enrichment

```typescript
import { enricher } from './lib/data-enrichment';

// Enrich a single product
const result = await enricher.enrichProduct(product);
console.log(result.enrichedData);    // Updated fields
console.log(result.changes);         // Array of field changes
console.log(result.confidence);      // Updated confidence

// Enrich a batch
const results = await enricher.enrichBatch(products, 20);

// Update products with enriched data
for (const result of results) {
  if (result.changes.length > 0) {
    const product = products.find(p => p.sku === result.sku);
    await dataAccess.updateProduct(product.id, result.enrichedData);
  }
}
```

### Full Workflow

```typescript
import { workflow } from './lib/workflow';

// Get data quality analysis
const { metrics, gaps, summary } = await workflow.analyzeDataQuality();

// Validate a batch
const validation = await workflow.validateProducts(100);

// Enrich products with missing fields
const enrichment = await workflow.enrichProducts('full_description', 50);

// Run full enrichment cycle
const stats = await workflow.fullEnrichmentCycle();
console.log(stats.updatedInDatabase);  // count of updated products
```

## Database Schema

The product database has these key fields:

### Core Fields
- `id`: Unique product ID
- `sku`: Stock keeping unit (product identifier)
- `name`: Product name
- `brand`: Brand name
- `country`: Country of origin
- `region`: Wine/spirits region (e.g., Bordeaux, Napa)
- `classification`: Type (Red Wine, Whisky, etc.)

### Product Attributes
- `grape_variety`: Grape used (for wines)
- `vintage`: Year produced
- `bottle_size`: Volume (750 ml, 1 L, etc.)
- `alcohol`: ABV percentage

### Pricing
- `price`: Retail price (THB)
- `cost`: Cost price (THB)
- `currency`: Currency code

### Enrichment Fields
- `full_description`: HTML product description
- `flavor_profile`: JSON array of flavor notes
- `character_traits`: Product characteristics

### Quality Fields
- `overall_confidence`: 0.0-1.0 confidence score
- `validation_status`: validated, needs_review, needs_attention
- `enrichment_source`: How data was enriched
- `enrichment_note`: Notes about enrichment

## Enrichment Rules

The system uses several strategies to enrich data:

### 1. Rule-Based Enrichment
- **Regions**: Normalizes region names and guesses based on country
- **Grape Varieties**: Expands abbreviations (e.g., "cab sauv" → "Cabernet Sauvignon")
- **Classifications**: Infers type from product name

### 2. AI-Powered Enrichment
For missing descriptions and flavor profiles:
- Analyzes brand, country, region, classification, and grape variety
- Generates descriptions using Claude
- Suggests flavor notes based on product characteristics

### 3. Confidence Scoring
- Based on field completeness
- Updated as enrichment adds data
- Range: 0.0 (no data) to 1.0 (complete and verified)

## Common Tasks

### Find Products Needing Most Enrichment

```typescript
const gaps = await dataAccess.getEnrichmentGaps();
const topGap = gaps[0];  // Highest priority
const products = await dataAccess.getProductsForEnrichment(topGap.field, 50);
```

### Enrich All Red Wines Missing Grape Variety

```typescript
const { products } = await dataAccess.filterProducts({
  classification: 'Red Wine',
  missingField: 'grape_variety',
  limit: 100
});

const results = await enricher.enrichBatch(products);

for (const result of results) {
  if (result.changes.length > 0) {
    await dataAccess.updateProduct(
      products.find(p => p.sku === result.sku).id,
      result.enrichedData
    );
  }
}
```

### Get High-Confidence Products

```typescript
const products = await dataAccess.getProductsByConfidenceScore(0.9, 100);
console.log(`${products.length} products with 90%+ confidence`);
```

### Export Enriched Data

```typescript
const products = await dataAccess.getProducts();
const enriched = products.filter(p => p.overall_confidence > 0.8);

console.log(JSON.stringify(enriched, null, 2));
// Or save to CSV/Excel as needed
```

## Performance Notes

- **Dataset Size**: 11,436 products
- **Field Coverage**: Most fields 30-99% complete
- **Validation**: ~500 products/second
- **Enrichment**: ~2-5 products/second (with AI calls)

For batch operations, process in chunks:
- Validation: Process up to 1,000 at a time
- Enrichment: Process 10-50 at a time (due to API calls)
- Database updates: Batch with `updateProducts()` method

## Validation Rules

Products are checked against:

1. **Required Fields**: SKU, name
2. **Format Rules**: 
   - Prices must be non-negative numbers
   - Vintage must be 4-digit year or "NV"
   - Alcohol must be percentage format
   - Confidence between 0.0-1.0

3. **Enumerated Fields**:
   - `classification`: Must match known wine/spirit types
   - `validation_status`: validated, needs_review, needs_attention

4. **Critical Gaps**: Products missing country, region, grape_variety, or description receive lower confidence

## API Endpoints (Optional)

If running the Next.js dev server:

```bash
npm run dev
```

Then use REST API:

```bash
# Get product overview and data quality metrics
curl http://localhost:3000/api/products/overview

# Search products
curl "http://localhost:3000/api/products/search?q=pinot&limit=10"

# Get product details
curl http://localhost:3000/api/products/lookup?sku=WRW0066AC

# Update a product
curl -X PATCH http://localhost:3000/api/products/{id} \
  -H "Content-Type: application/json" \
  -d '{"fields": {"region": "Burgundy"}, "note": "AI enrichment"}'
```

See `PRODUCT_DATA_API.md` for full API documentation.
