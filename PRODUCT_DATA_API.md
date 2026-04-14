# WNLQ9 Product Intelligence API

**Base URL:** `http://localhost:3000` (local) — update for production deployment.

This document describes how to access the WNLQ9 product intelligence database. Share this with team members, external projects, or AI agents that need to read, search, validate, or enrich product data.

---

## Quick Start

```bash
# Get a full overview of the database (schema, counts, gaps, available APIs)
curl http://localhost:3000/api/products/overview

# Look up a product by SKU
curl http://localhost:3000/api/products/lookup?sku=WRW0066AC

# Search by keyword
curl http://localhost:3000/api/products/search?q=chateau&limit=5

# Export all validated products as JSON
curl http://localhost:3000/api/products/export?format=json

# Export as CSV
curl http://localhost:3000/api/products/export?format=csv
```

---

## API Endpoints

### 1. Overview — `/api/products/overview`

**GET** — Returns the complete state of the database: schema, counts by status/segment, field coverage percentages, price statistics, top countries, data gaps to fill, and a full list of available APIs.

**Use this first** — it tells you everything you need to know about the data.

```bash
curl http://localhost:3000/api/products/overview | python3 -m json.tool
```

---

### 2. Search — `/api/products/search`

**GET** — Full-text search across name, brand, SKU, grape variety. Supports filters and field-presence queries.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `q` | Search keyword (name, brand, SKU, grape) | `q=pinot noir` |
| `country` | Exact country match | `country=France` |
| `region` | Exact region match | `region=Burgundy` |
| `classification` | Product type | `classification=Red Wine` |
| `grape_variety` | Grape (partial match) | `grape_variety=cabernet` |
| `brand` | Brand (partial match) | `brand=opus` |
| `validation_status` | Status filter | `validation_status=validated` |
| `price_min` / `price_max` | Price range (THB) | `price_min=500&price_max=2000` |
| `has` | Only products with this field filled | `has=region` |
| `missing` | Only products missing this field | `missing=grape_variety` |
| `sort` | Sort by: name, price, sku, country, overall_confidence, vintage | `sort=price` |
| `sortDir` | asc or desc | `sortDir=desc` |
| `limit` | Results per page (max 100) | `limit=20` |
| `offset` | Pagination offset | `offset=20` |

**Examples:**

```bash
# Find French red wines
curl "http://localhost:3000/api/products/search?country=France&classification=Red%20Wine&limit=10"

# Find products missing grape variety (for enrichment)
curl "http://localhost:3000/api/products/search?missing=grape_variety&country=Italy&limit=50"

# Find products missing descriptions (for AI to fill)
curl "http://localhost:3000/api/products/search?missing=full_description&has=country&sort=price&sortDir=desc&limit=20"

# Search by brand
curl "http://localhost:3000/api/products/search?brand=penfolds&limit=10"
```

---

### 3. Lookup by SKU — `/api/products/lookup`

**GET** `?sku=SKU1,SKU2` or **POST** `{ "skus": ["SKU1", "SKU2"] }`

Returns enriched product intelligence cards keyed by SKU.

```bash
# Single SKU
curl http://localhost:3000/api/products/lookup?sku=WRW0066AC

# Multiple SKUs
curl -X POST http://localhost:3000/api/products/lookup \
  -H "Content-Type: application/json" \
  -d '{"skus": ["WRW0066AC", "WWW0047AC", "LWH0001AA"]}'
```

Response includes: `{ products: { SKU: {...} }, count, missing: [] }`

---

### 4. Export — `/api/products/export`

**GET** — Bulk download all products.

```bash
# JSON (all validated)
curl http://localhost:3000/api/products/export?format=json > products.json

# CSV (all validated)
curl http://localhost:3000/api/products/export?format=csv > products.csv

# Include unvalidated products too
curl "http://localhost:3000/api/products/export?format=json&status=all" > all_products.json
```

---

### 5. Browse — `/api/products`

**GET** — Paginated product browsing with filters and sorting (50/page).

| Parameter | Description |
|-----------|-------------|
| `search` | Search name/SKU/brand |
| `country` | Country filter |
| `region` | Region filter |
| `classification` | Classification filter |
| `segment` | wine, spirits, beer, accessories |
| `validation_status` | validated, needs_review, needs_attention |
| `sort` | name, price, confidence, vintage, created, sku |
| `sortDir` | asc, desc |
| `page` | Page number |

---

### 6. Single Product — `/api/products/{id}`

**GET** — Full product detail with taxonomy context and character dimensions.

**PATCH** — Update product fields:
```bash
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{"fields": {"region": "Burgundy", "grape_variety": "Pinot Noir"}, "note": "AI enrichment"}'
```

---

### 7. Facets — `/api/products/facets`

**GET** — Returns all distinct values with counts for filter dropdowns: categories, countries, statuses, regions, appellations, wine classifications.

---

### 8. Change Log — `/api/changelog`

**GET** — View product change history with filters.

| Parameter | Description |
|-----------|-------------|
| `field` | Filter by field (price, cost, region, etc.) |
| `source` | masterfile_import, override_import, batch_process, manual_edit |
| `sku` | Filter by SKU (partial match) |
| `page` / `limit` | Pagination |

---

## Product Schema

### Key Fields

| Field | Type | Description | Coverage |
|-------|------|-------------|----------|
| `sku` | string | Unique product identifier (prefix indicates type) | 100% |
| `name` | string | Product name | 100% |
| `brand` | string | Brand name | ~80% |
| `classification` | string | Product type: Red Wine, White Wine, Whisky, Gin, etc. | ~95% |
| `wine_classification` | string | Quality tier: Grand Cru, Premier Cru, Reserva, etc. | ~10% |
| `grape_variety` | string | Grape(s): "Cabernet Sauvignon", "Pinot Noir 100%" | ~30% |
| `vintage` | string | Vintage year or "NV" | ~40% |
| `country` | string | Country of origin | ~87% |
| `region` | string | Wine/spirits region (Bordeaux, Napa, Highland...) | ~5% |
| `subregion` | string | Subregion (Pauillac, Oakville...) | ~1% |
| `appellation` | string | Appellation/AOC | <1% |
| `wine_body` | string | Light, Medium, Full | ~15% |
| `wine_acidity` | string | Low, Medium, High | ~15% |
| `wine_tannin` | string | Low, Medium, High | ~15% |
| `food_matching` | string | Food pairing suggestions | ~15% |
| `flavor_tags` | string | JSON array of flavor descriptors | ~20% |
| `flavor_profile` | string | JSON array of tasting notes | ~20% |
| `price` | number | Retail price in THB | 100% |
| `cost` | number | Cost price in THB | ~90% |
| `bottle_size` | string | "750 ml", "1 L", etc. | ~80% |
| `alcohol` | string | ABV percentage | ~30% |
| `full_description` | string | HTML product description | ~15% |
| `validation_status` | string | validated, needs_review, needs_attention | 100% |
| `overall_confidence` | number | 0.0–1.0 enrichment confidence score | 100% |

### SKU Prefixes

| Prefix | Category | Example |
|--------|----------|---------|
| `WRW` | Red Wine | WRW0066AC |
| `WWW` | White Wine | WWW0047AC |
| `WSP` | Sparkling Wine | WSP0012AA |
| `WCH` | Champagne | WCH0003AA |
| `WRS` | Rosé | WRS0005AA |
| `WDW` | Dessert Wine | WDW0001AA |
| `LWH` | Whisky | LWH0001AA |
| `LGN` | Gin | LGN0010AA |
| `LRM` | Rum | LRM0003AA |
| `LTQ` | Tequila | LTQ0001AA |
| `LVK` | Vodka | LVK0002AA |
| `LBD` | Brandy | LBD0001AA |
| `LLQ` | Liqueur | LLQ0005AA |
| `LSK` | Sake | LSK0001AA |
| `LBE` | Beer | LBE0001AA |

---

## For AI Agents

### Finding Products to Enrich

```bash
# Products with country but missing region — high confidence first
curl "http://localhost:3000/api/products/search?has=country&missing=region&sort=overall_confidence&sortDir=desc&limit=50"

# Products missing descriptions
curl "http://localhost:3000/api/products/search?missing=full_description&sort=price&sortDir=desc&limit=50"

# Products missing grape variety
curl "http://localhost:3000/api/products/search?missing=grape_variety&classification=Red%20Wine&limit=50"
```

### Updating Products

```bash
# Update a single product (PATCH by ID)
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "region": "Bordeaux",
      "subregion": "Pauillac",
      "grape_variety": "Cabernet Sauvignon, Merlot",
      "wine_body": "Full",
      "wine_acidity": "Medium",
      "wine_tannin": "High"
    },
    "note": "AI enrichment from product research"
  }'
```

### Workflow for Validation

1. Call `/api/products/overview` to understand current data state
2. Use `/api/products/search?missing=FIELD` to find gaps
3. Research and fill via PATCH `/api/products/{id}`
4. Changes are logged automatically in the changelog
5. Check `/api/changelog?source=manual_edit` to verify your updates
