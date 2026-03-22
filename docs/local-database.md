# WineNow Local Database System

## Overview

This document describes the local database implementation for the WineNow PIM (Product Information Management) system. The system has been converted from Supabase to a **local, file-based storage system** for full data control and offline capability.

## Architecture

### Database Implementation

The system uses **JSON file storage** in `data/db/` directory instead of a traditional SQL database. This provides:

- **Zero dependencies**: No database server installation needed
- **Local control**: All data files stored locally
- **Easy backup**: Simple JSON file export/import
- **Development-friendly**: Easy to inspect and debug
- **Production-ready**: Can be upgraded to SQLite or PostgreSQL later

### Data Files

```
data/
├── db/
│   ├── products.json           # All cleaned & normalized products
│   ├── batch-logs.json         # Processing history & audit trail
│   ├── data-issues.json        # Validation issues & errors
│   ├── scraping-queue.json     # Pending scraping tasks
│   └── reviews.json            # Scraped product reviews
└── taxonomy/
    ├── countries.json
    ├── regions.json
    ├── subregions.json
    ├── origins.json
    ├── classification_master.json
    ├── ingredient_master.json
    ├── flavor_note_master.json
    ├── category_render_config.json
    ├── expert_sources.json
    └── magento_item_data.json    # Full 11,187 product rows
```

## Data Flow

### 1. Load Magento Products
```
User clicks "Load Magento rows 1–200" or "Load all products"
                          ↓
API: GET /api/magento-items?limit=200&offset=0
                          ↓
Reads from: data/taxonomy/magento_item_data.json
                          ↓
Returns: Paginated product data with 11,187 items available
```

### 2. Batch Process & Normalize
```
User selects products & clicks "Process & Store"
                          ↓
Batch Processor (lib/batch-processor.ts):
  - AI field detection using taxonomy
  - Confidence scoring (0.0 to 1.0)
  - Auto-corrections for high-confidence matches
  - Validation & error detection
                          ↓
API: POST /api/batch-process-db
                          ↓
Database Client (lib/db/client.ts):
  - Save cleaned products to: data/db/products.json
  - Save batch log to: data/db/batch-logs.json
  - Record data issues to: data/db/data-issues.json
                          ↓
Response: Batch processed with stats (ready/review/blocked counts)
```

### 3. View Data Catalog
```
User navigates to "Data Catalog" section
                          ↓
Component: DataCatalog (components/data-catalog.tsx)
                          ↓
API: GET /api/batch-process-db?action=products
                          ↓
Reads: All products from data/db/products.json
                          ↓
Display:
  - Product list (searchable, filterable, paginated)
  - Statistics dashboard
  - Validation status & confidence scores
  - Full product details modal
```

### 4. Scrape & Enrich Product Data
```
Background process (can be triggered manually or scheduled):
                          ↓
Jobs: getScrapingQueue()
                          ↓
For each pending item:
  1. Scrape product information (description, reviews, ratings)
  2. Extract characteristics using NLP
  3. Analyze review sentiment
  4. Generate comprehensive English description
                          ↓
Save to:
  - Update product's full_description
  - Update product's scraped_description
  - Add to product_reviews table
                          ↓
Update confidence: description_confidence += scraped data quality
```

## API Endpoints

### Process & Store Batch Data
```
POST /api/batch-process-db

Request:
{
  "rows": [{ ... normalized rows ... }],
  "batch_id": "batch-1234567890",
  "source_file": "magento-feed"
}

Response:
{
  "success": true,
  "batch_id": "batch-1234567890",
  "saved": 200,
  "issues": 5,
  "stats": {
    "total": 200,
    "processed": 200,
    "ready": 145,
    "review": 35,
    "blocked": 20
  }
}
```

### Get Database Statistics
```
GET /api/batch-process-db?action=stats

Response:
{
  "total": 1245,
  "validated": 892,
  "pending": 180,
  "needs_review": 142,
  "blocked": 31,
  "avg_confidence": 0.82,
  "avg_taxonomy_confidence": 0.85,
  "avg_description_confidence": 0.61
}
```

### Get Cleaned Products
```
GET /api/batch-process-db?action=products&status=validated&country=France

Response:
{
  "count": 234,
  "products": [
    {
      "id": "prod-1",
      "sku": "WINE-001",
      "name": "Château Margaux 2018",
      "country": "France",
      "region": "Bordeaux",
      "classification": "Red Wine",
      "overall_confidence": 0.92,
      "validation_status": "validated",
      ...
    }
  ]
}
```

### Load Magento Products
```
GET /api/magento-items?limit=200&offset=0

Response:
{
  "total": 11187,
  "offset": 0,
  "limit": 200,
  "hasMore": true,
  "rows": [
    {
      "id": "magento-0",
      "sku": "WINE-SKU",
      "name": "Product Name",
      "country": "Italy",
      ...
    }
  ]
}

Action counters:
- GET /api/magento-items?action=count → { "total": 11187, "pages": 56 }
```

## Features

### ✅ Batch Processing UI (`Data Hub` section)
- **Load data**: CSV upload or Magento API feed
- **Search & Filter**: By SKU, name, country, region, type, category
- **Status tracking**: Ready (validated), Review (medium confidence), Blocked (errors)
- **Shift+Click Selection**: Select ranges of products quickly
- **Select All**: Process all 200+ items at once
- **Process & Store**: Save normalized data with validated taxonomy to database
- **Multi-format Export**: CSV (review), Magento JSON (import-ready), raw JSON
- **Audit Log**: Track all batch operations with timestamps

### ✅ Data Catalog (`Data Catalog` section)
- **Product List**: View all cleaned products (searchable, filterable, paginated)
- **Statistics Dashboard**: 
  - Total items
  - Validated vs pending vs review vs blocked counts
  - Average confidence scores
- **Product Details Modal**: Full product information with:
  - SKU, name, country, region, classification
  - Confidence scores (overall, taxonomy, description)
  - Full English description
  - Flavor profile
  - Original vs cleaned data comparison

### ✅ Product Scraping (`lib/scraper.ts`)
- **Description scraping** from Wine.com, Vivino, RateBeer
- **Review aggregation** with sentiment analysis
- **Characteristic extraction** using NLP:
  - Body (light, medium, full)
  - Tannins (soft, balanced, tannic)
  - Acidity (low, balanced, high)
  - Sweetness (dry, off-dry, sweet)
  - Aging potential
  - Food pairings
- **English description generation**: Creates comprehensive, marketing-ready descriptions

### ✅ Taxonomy Validation
- **Multi-strategy matching**:
  - Exact match (100% confidence)
  - Fuzzy matching (partial text)
  - Synonym lookup
  - Alias resolution
- **Confidence scoring**: Auto-corrections at 85%+, review flags at 70-85%
- **Error reporting**: Issues logged for manual review below 50% confidence

## Database Fields

### `products.json` - Cleaned Product Record
```json
{
  "id": "unique-id",
  "sku": "WINE-2024-001",
  "name": "Clean product name",
  "original_name": "Original from Magento",
  "brand": "Producer name",
  "country": "France",
  "region": "Burgundy",
  "classification": "Red Wine - Pinot Noir",
  "grape_variety": "Pinot Noir",
  "vintage": "2020",
  "price": 45.99,
  "cost": 18.50,
  "currency": "USD",
  "bottle_size": "750ml",
  
  "flavor_profile": "[\"cherry\", \"earth\", \"leather\"]",
  "flavor_families": "[\"fruity\", \"earthy\"]",
  "character_traits": "{\"body\": \"medium\", \"tannins\": \"balanced\", \"acidity\": \"high\"}",
  
  "full_description": "Full English description with all details...",
  "scraped_description": "Description scraped from external sources",
  "product_features": "[\"feature1\", \"feature2\"]",
  
  "taxonom_confidence": 0.92,
  "description_confidence": 0.75,
  "overall_confidence": 0.87,
  "validation_status": "validated | pending | needs_review | blocked",
  "validation_notes": "Any notes about validation",
  
  "batch_id": "batch-1234567890",
  "created_at": "2024-03-20T10:30:00Z",
  "updated_at": "2024-03-20T14:45:00Z"
}
```

### `batch-logs.json` - Processing History
```json
{
  "id": "batch-1234567890",
  "source_file": "magento-feed",
  "source_type": "api | csv | upload",
  "total_rows": 200,
  "processed_rows": 198,
  "ready_rows": 145,
  "review_rows": 35,
  "blocked_rows": 18,
  "status": "completed",
  "timestamp": "2024-03-20T10:30:00Z",
  "notes": "Successfully processed 198/200 products"
}
```

### `data-issues.json` - Validation Issues
```json
{
  "id": "issue-1234567890",
  "product_id": "unique-id",
  "sku": "WINE-2024-001",
  "issue_type": "missing_field | invalid_taxonomy | low_confidence | duplicate",
  "severity": "critical | warning | info",
  "description": "Issue description",
  "suggested_value": "Suggested correction",
  "created_at": "2024-03-20T10:30:00Z"
}
```

## Usage Examples

### Example 1: Process and Store Full Batch

```bash
# 1. Open DashBoard → Data Hub
# 2. Click "Load Magento rows 1–200"
# 3. Click "✓ All 200" to select all items
# 4. Click blue "Process 200 selected" button
# 5. View "Processed Collection" summary
# 6. Check "Data Catalog" to view all saved products
```

### Example 2: Search for Products by Country

```bash
# 1. Go to "Data Catalog"
# 2. In filters, select Country = "France"
# 3. View all French products with confidence scores
# 4. Click a product to see details
```

### Example 3: Export Validated Products

```bash
# 1. Go to "Data Hub"  
# 2. Load data or access existing batch
# 3. Filter to "Ready" status only
# 4. Click "Export Magento CSV (all ready)"
# 5. Use exported file for Magento import
```

## Performance Considerations

- **Products JSON**: Currently stores up to 1000s of products (limited by browser memory)
- **Batch processing**: O(n) complexity - linearly processes each product
- **Search/Filter**: O(n) - full table scan (indexes can be added)
- **Pagination**: UI paginated at 50 rows per page for performance

### Upgrading to SQLite (Optional)

When ready for production, replace JSON storage with SQLite:

```typescript
// Replace lib/db/client.ts with actual SQLite implementation
import Database from 'better-sqlite3';

// Use lib/db/schema.sql for table definitions
// All queries remain the same - only backend storage changes
```

## Security Notes

- All data stored locally - no cloud transmission
- Database files in `data/db/` should be added to `.gitignore`
- Backup `data/db/` directory regularly
- All product data is validated client-side before saving
- No PII stored (only product information)

## Next Steps

1. **Test Batch Processing**: Load Magento products and process through batch UI
2. **View Data Catalog**: Check saved products and statistics
3. **Scraping Integration**: Implement actual API integrations for external data
4. **Scale to All 11,187 Items**: Process full dataset
5. **Upgrade to SQLite**: When ready for production (optional)

