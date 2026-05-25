# 🚀 Live Data Operations API

**Access all 11,436 products and enrich them in real-time from this chat or any external system.**

## Quick Start

### From This Chat

```bash
# Analyze data quality
curl -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"analyze"}'

# Search products
curl -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"search","params":{"query":"pinot","limit":5}}'

# Enrich products (will save to database)
curl -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"enrich","params":{"field":"full_description","limit":10}}'

# Batch enrich many products
curl -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"enrich-batch","params":{"field":"grape_variety","count":50}}'
```

## API Endpoints

### Base URL
```
POST http://localhost:3000/api/data-operations
GET http://localhost:3000/api/data-operations?action=analyze
```

## Actions

### 1. **analyze** - Get Data Quality Overview
```json
{
  "action": "analyze"
}
```

**Response:**
```json
{
  "metrics": {
    "totalProducts": 11436,
    "validatedProducts": 4052,
    "productsNeedingReview": 7378,
    "averageConfidence": 0.339,
    "coverageByField": {
      "country": 99.7,
      "region": 66.7,
      "grape_variety": 55.4,
      "full_description": 37.9
    }
  },
  "gaps": [
    {
      "field": "full_description",
      "missingCount": 7103,
      "coverage": 37.9,
      "priority": 10
    }
  ]
}
```

### 2. **search** - Find Products
```json
{
  "action": "search",
  "params": {
    "query": "cabernet",
    "limit": 20
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "sku": "WRW2106AC",
      "name": "Coastal Ridge Cabernet Sauvignon",
      "brand": "Coastal Ridge",
      "country": "USA",
      "classification": "Red Wine",
      "price": 700,
      "overall_confidence": 0.85
    }
  ],
  "count": 15
}
```

### 3. **validate** - Check Data Quality
```json
{
  "action": "validate",
  "params": {
    "limit": 100
  }
}
```

**Response:**
```json
{
  "summary": {
    "totalProducts": 100,
    "validProducts": 85,
    "issueCount": 45,
    "errorCount": 2,
    "warningCount": 15,
    "averageConfidence": 0.83
  },
  "sampleIssues": [
    {
      "sku": "WRW5570FP",
      "field": "vintage",
      "issue": "Vintage should be a year (e.g., \"2020\") or \"NV\"",
      "severity": "info"
    }
  ]
}
```

### 4. **enrich** - Enrich Single Batch
```json
{
  "action": "enrich",
  "params": {
    "field": "full_description",
    "limit": 10
  }
}
```

**Response:**
```json
{
  "enriched": 10,
  "updated": 7,
  "field": "full_description",
  "results": [
    {
      "sku": "WRW0066AC",
      "changes": [
        {
          "field": "full_description",
          "oldValue": null,
          "newValue": "Rich and complex Cabernet..."
        }
      ]
    }
  ]
}
```

### 5. **enrich-batch** - Enrich Many Products
```json
{
  "action": "enrich-batch",
  "params": {
    "field": "grape_variety",
    "count": 100
  }
}
```

**Response:**
```json
{
  "field": "grape_variety",
  "enriched": 100,
  "updated": 78,
  "changes": [
    {
      "sku": "WWW5186FP",
      "changes": [
        {
          "field": "grape_variety",
          "oldValue": "blanc",
          "newValue": "Sauvignon Blanc"
        }
      ]
    }
  ]
}
```

### 6. **get-gaps** - View Enrichment Opportunities
```json
{
  "action": "get-gaps"
}
```

**Response:**
```json
{
  "gaps": [
    {
      "field": "full_description",
      "missingCount": 7103,
      "coverage": 37.9,
      "priority": 10
    },
    {
      "field": "flavor_profile",
      "missingCount": 7103,
      "coverage": 37.9,
      "priority": 8
    }
  ]
}
```

### 7. **stats** - Get Database Statistics
```json
{
  "action": "stats"
}
```

**Response:**
```json
{
  "stats": {
    "byClassification": {
      "Red Wine": 4122,
      "White Wine": 1583,
      "Whisky": 621
    },
    "byCountry": {
      "France": 2734,
      "Italy": 1981,
      "USA": 979
    },
    "priceRange": {
      "min": 40,
      "max": 2460999,
      "avg": 850
    }
  }
}
```

### 8. **get-product** - Get Single Product Details
```json
{
  "action": "get-product",
  "params": {
    "sku": "WRW0066AC"
  }
}
```

**Response:**
```json
{
  "product": {
    "sku": "WRW0066AC",
    "name": "...",
    "country": "USA",
    "overall_confidence": 0.85
  },
  "validation": {
    "isValid": true,
    "confidence": 0.85,
    "issues": []
  }
}
```

### 9. **update-product** - Update Single Product
```json
{
  "action": "update-product",
  "params": {
    "productId": "row-1669-1774263062961",
    "updates": {
      "region": "Napa Valley",
      "grape_variety": "Cabernet Sauvignon"
    },
    "note": "AI enrichment from chat session"
  }
}
```

## Usage from This Chat 💬

Run any of these commands right now:

### 1. Check Current Status
```bash
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"analyze"}' | jq '.'
```

### 2. Find What Needs Enrichment
```bash
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"get-gaps"}' | jq '.gaps[0:3]'
```

### 3. Enrich 20 Products Missing Descriptions
```bash
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"enrich","params":{"field":"full_description","limit":20}}' | jq '.'
```

### 4. Batch Enrich 100 Grape Varieties
```bash
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"enrich-batch","params":{"field":"grape_variety","count":100}}' | jq '.updated, .enriched'
```

## Usage from Code

### TypeScript/Node.js
```typescript
import { dataClient } from '@/lib/data-operations-client';

// Analyze
const analysis = await dataClient.analyze();
console.log(analysis.metrics);

// Search
const results = await dataClient.search('pinot noir', 10);

// Enrich
const enriched = await dataClient.enrich('full_description', 20);

// Batch enrich
const batchResult = await dataClient.enrichBatch('grape_variety', 100);
```

### Python
```python
import requests
import json

api_url = "http://localhost:3000/api/data-operations"

# Analyze
response = requests.post(api_url, json={"action": "analyze"})
print(response.json())

# Search
response = requests.post(api_url, json={
    "action": "search",
    "params": {"query": "cabernet", "limit": 10}
})
print(response.json())

# Enrich
response = requests.post(api_url, json={
    "action": "enrich",
    "params": {"field": "full_description", "limit": 20}
})
print(response.json())
```

### curl
```bash
# All examples above use curl - they work directly from CLI/chat
```

## Real-Time Workflow from This Chat

### Example: Enrich Top Priority Field

```bash
# 1. See what needs enrichment
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"get-gaps"}' | jq '.gaps[0]'

# 2. Enrich batch of that field
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"enrich-batch","params":{"field":"full_description","count":50}}' | jq '.updated'

# 3. Check progress
curl -s -X POST http://localhost:3000/api/data-operations \
  -H "Content-Type: application/json" \
  -d '{"action":"analyze"}' | jq '.metrics | {validated, total: .totalProducts}'

# 4. Repeat until complete
```

## Data Flow

```
Chat (curl/API calls)
      ↓
Next.js API Route (/api/data-operations)
      ↓
DataAccessService (11,436 products)
      ↓
DataValidator (check quality)
      ↓
DataEnricher (fill gaps with AI)
      ↓
Local JSON Database (persisted)
      ↓
Supabase (sync when configured)
```

## Error Handling

All endpoints return errors as:
```json
{
  "error": "Error message describing what went wrong"
}
```

HTTP Status Codes:
- `200` - Success
- `400` - Invalid action or parameters
- `404` - Product not found
- `500` - Server error

## Performance

- **Validate**: ~100-500 products at a time
- **Enrich**: ~10-50 products at a time (slower due to AI)
- **Batch enrich**: Full count up to ~500 (queued)
- **Search**: Instant (full-text)
- **All operations are asynchronous** and non-blocking

## What's Accessible Now

✅ All 11,436 products
✅ Real-time validation
✅ AI-powered enrichment
✅ Database updates
✅ Search and filtering
✅ Statistics and metrics
✅ Gap identification

## Next: Supabase Integration

To sync with live Supabase database:
1. Add `.env.local` with Supabase credentials
2. Data operations will sync to remote database
3. Real-time updates across all systems

## Questions?

Use the API endpoints above directly from this chat. Every operation is available for real-time processing!
