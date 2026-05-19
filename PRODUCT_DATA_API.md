# WNLQ9 Product Intelligence API

**Base URL:** `http://localhost:3000` (local)
**Last updated:** 2026-05-07
**Database:** Supabase PostgreSQL (11,841 products)

This is the central product intelligence database for Wine-Now (th.wine-now.com) and LIQ9 (th.liq9.com). Share this document with team members, external projects, or AI agents that need to read, search, validate, or enrich product data.

---

## Field Ownership Matrix

Multiple systems write to the product catalog. To avoid conflicts, each field has a designated owner. Other systems should treat non-owned fields as read-only.

| Field | Owner | Updated Via |
|-------|-------|-------------|
| `sku`, `name` | BI (source of truth) | BI sync / masterfile import |
| `brand`, `bottle_size`, `vintage`, `alcohol` | BI | BI sync / masterfile import |
| `price`, `cost_price`, `currency` | **BI** | BI sync (price/stock authoritative) |
| `special_price`, `promotion_price`, `promotion_tier_price` | **BI** | BI sync |
| `margin_thb`, `margin_pct`, `b2b_price`, `b2b_margin_*` | **BI** | BI sync |
| `is_in_stock`, `custom_stock_status`, `wn_stock` | **BI** | BI sync |
| `sold_orders`, `sold_qty`, `consign` | **BI** | BI sync (sales/inventory) |
| `popularity_score`, `popularity_qty_90d`, `popularity_orders_90d`, `popularity_revenue_90d`, `popularity_window_days`, `popularity_synced_at` | **BI** | `data/sync_popularity_from_bi.py` (daily 04:00 launchd) |
| `wine_body`, `wine_acidity`, `wine_tannin`, `grape_blend_type`, `wine_production_style`, `flavor_tags`, `food_matching`, `desc_en_short`, `full_description`, `score_max`, `score_summary`, `enrichment_confidence`, `enriched_at`, `enriched_by` | **PIM** (wine enrichment) | `data/enrich_wines.py` (see [docs/superpowers/specs/2026-05-12-wine-enrichment-design.md](docs/superpowers/specs/2026-05-12-wine-enrichment-design.md)) |
| `country`, `region`, `subregion`, `appellation` | **PIM** | AI enrichment / manual edit |
| `classification`, `wine_classification` | **PIM** | AI enrichment / taxonomy queue |
| `grape_variety`, `liquor_main_type`, `other_type` | **PIM** | AI enrichment |
| `wine_body`, `wine_acidity`, `wine_tannin` | **PIM** | AI enrichment / expert library |
| `food_matching`, `flavor_tags`, `flavor_profile` | **PIM** | AI enrichment / expert library |
| `full_description` | **PIM** | AI enrichment / expert library |
| `image_url`, `image_alt_text`, `image_local_path` | **PIM** | Image pipeline / manual upload |
| `validation_status`, `overall_confidence` | **PIM** | Validation pipeline |
| `enrichment_source`, `enrichment_note` | **PIM** | Enrichment pipeline |

**Rule of thumb:**
- **BI owns commercial data** — anything that changes with sales, pricing, or stock decisions
- **PIM owns product intelligence** — anything about what the product IS (origin, style, taste, description, images)

**Conflict policy (enforced):** PATCH requests are filtered by the `X-Source` header (or `?source=` query param):

| Source | Can Write | Ignored (dropped) |
|--------|-----------|-------------------|
| `admin` (default) | All fields | — |
| `bi` | BI-owned fields + system fields | PIM-owned fields |
| `enrichment` | PIM-owned fields + system fields | BI-owned fields |
| `system` | All fields | — |

The response includes `applied: [fields]` and `dropped: [fields]` so callers can see what was actually written.

Example — BI app updates price only:

```bash
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "X-Source: bi" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"price": 2500, "region": "Bordeaux"}}'
# Response: {"updated": true, "source": "bi", "applied": ["price"], "dropped": ["region"]}
```

---

## Database Snapshot

| Metric | Value |
|--------|-------|
| Total products | 11,841 |
| Validated | ~10,130 |
| Needs review | ~1,710 (manual region-audit queue from May 2026 enrichment) |
| Wine | 7,103 |
| Spirits | 3,317 |
| Beer | 227 |
| Accessories | 1,032 |
| Currency | THB (Thai Baht) |
| Popularity coverage | 1,395 SKUs (any closed order in last 90 days) |

### Field Coverage

| Field | Filled | Coverage |
|-------|--------|----------|
| country | 11,330 | 98% |
| brand | 11,550 | 100% |
| region | 8,767 | 76% |
| vintage | 7,667 | 66% |
| grape_variety | 6,959 | 60% |
| flavor_profile | 3,867 | 33% |
| full_description | 0 | 0% |

### Priority Gaps to Fill

| Gap | Count | Suggestion |
|-----|-------|------------|
| Missing region | 2,797 | Use search API with `missing=region&has=country` |
| Missing grape variety | 4,605 | Focus on wine SKUs: `missing=grape_variety&classification=Red%20Wine` |
| Missing flavor profile | 7,697 | AI can generate from grape + region + classification |
| Missing description | 11,564 | All products need descriptions |
| Missing vintage | 3,897 | Check against masterfile or brand websites |

---

## Quick Start

```bash
# Get a live overview of the database (schema, counts, gaps, all API docs)
curl http://localhost:3000/api/products/overview

# Look up products by SKU
curl http://localhost:3000/api/products/lookup?sku=WRW0066AC

# Search by keyword
curl "http://localhost:3000/api/products/search?q=chateau&limit=5"

# Find products missing a field (for AI enrichment)
curl "http://localhost:3000/api/products/search?missing=grape_variety&country=France&limit=20"

# Export all validated products as JSON
curl http://localhost:3000/api/products/export?format=json

# Export as CSV
curl http://localhost:3000/api/products/export?format=csv
```

---

## API Endpoints

### 1. Overview — `GET /api/products/overview`

Returns the complete state of the database: schema, counts by status/segment, field coverage percentages, price statistics, top countries, data gaps to fill, and a full list of available APIs.

**Use this first** — it tells you everything you need to know about the data.

```bash
curl http://localhost:3000/api/products/overview | python3 -m json.tool
```

---

### 2. Search — `GET /api/products/search`

Full-text search across name, brand, SKU, grape variety. Supports filters and field-presence queries.

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
| `has` | Only products WITH this field filled | `has=region` |
| `missing` | Only products MISSING this field | `missing=grape_variety` |
| `sort` | Sort by: name, price, sku, country, overall_confidence, vintage | `sort=price` |
| `sortDir` | asc or desc | `sortDir=desc` |
| `limit` | Results per page (max 100) | `limit=20` |
| `offset` | Pagination offset | `offset=20` |

**Examples:**

```bash
# French red wines sorted by price
curl "http://localhost:3000/api/products/search?country=France&classification=Red%20Wine&sort=price&sortDir=desc&limit=10"

# Italian wines missing grape variety
curl "http://localhost:3000/api/products/search?missing=grape_variety&country=Italy&limit=50"

# Expensive products missing descriptions (priority for AI enrichment)
curl "http://localhost:3000/api/products/search?missing=full_description&has=country&sort=price&sortDir=desc&limit=20"

# Search by brand
curl "http://localhost:3000/api/products/search?brand=penfolds&limit=10"

# Whisky products with region data
curl "http://localhost:3000/api/products/search?has=region&classification=Whisky&limit=20"
```

**Response format:**
```json
{
  "products": [ { "sku": "WRW0066AC", "name": "...", "country": "France", ... } ],
  "total": 707,
  "limit": 20,
  "offset": 0,
  "hasMore": true
}
```

---

### 3. Lookup by SKU — `GET|POST /api/products/lookup`

**GET** `?sku=SKU1,SKU2` or **POST** `{ "skus": ["SKU1", "SKU2"] }`

Returns enriched product intelligence cards keyed by SKU. Best for integrating with other systems.

```bash
# Single SKU
curl http://localhost:3000/api/products/lookup?sku=WRW0066AC

# Multiple SKUs (POST)
curl -X POST http://localhost:3000/api/products/lookup \
  -H "Content-Type: application/json" \
  -d '{"skus": ["WRW0066AC", "WWW0047AC", "LWH0001AA"]}'
```

**Response:** `{ "products": { "WRW0066AC": {...}, ... }, "count": 3, "missing": [] }`

---

### 4. Export — `GET /api/products/export`

Bulk download all products.

| Parameter | Options |
|-----------|---------|
| `format` | `json` (default) or `csv` |
| `status` | `validated` (default) or `all` |

```bash
# JSON — all validated
curl http://localhost:3000/api/products/export?format=json > products.json

# CSV — all validated
curl http://localhost:3000/api/products/export?format=csv > products.csv

# JSON — include unvalidated too
curl "http://localhost:3000/api/products/export?format=json&status=all" > all_products.json
```

---

### 5. Browse — `GET /api/products`

Paginated product browsing with filters and sorting (50/page).

| Parameter | Description |
|-----------|-------------|
| `search` | Search name/SKU/brand |
| `country`, `region` | Geography filters |
| `classification` | Product type filter |
| `segment` | wine, spirits, beer, accessories |
| `validation_status` | validated, needs_review, needs_attention |
| `sort` | name, price, confidence, vintage, created, sku |
| `sortDir` | asc, desc |
| `page` | Page number (1-based) |

---

### 6. Single Product — `GET|PATCH /api/products/{id}`

**GET** — Full product detail with taxonomy context and character dimensions.

**PATCH** — Update product fields (changes are auto-logged to changelog):
```bash
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{
    "fields": { "region": "Burgundy", "grape_variety": "Pinot Noir" },
    "note": "AI enrichment"
  }'
```

---

### 7. Product Image — `GET|POST /api/products/{id}/image`

**GET** — Returns image metadata and suggested SEO filename for a product.

**POST** — Upload or fetch a product image. Two modes:

```bash
# Mode 1: Download from URL (for AI agents / scrapers)
curl -X POST http://localhost:3000/api/products/PRODUCT_ID/image \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/product-photo.jpg"}'

# Mode 2: Direct file upload
curl -X POST http://localhost:3000/api/products/PRODUCT_ID/image \
  -F "file=@/path/to/image.webp"
```

The image is automatically:
- Saved with an SEO-optimized filename: `{brand}-{product-name}-{grape}-{region}-{vintage}.webp`
- Stored in `public/images/products/{country}/`
- Product record updated with `image_url`, `image_alt_text`, `image_local_path`
- Alt text auto-generated: "{Brand} {Product Name} -- {Grape/Type} from {Region}"

**Image naming examples:**
| Product | Generated Filename |
|---------|-------------------|
| Opus One 2019, Napa | `opus-one-cabernet-sauvignon-napa-2019.webp` |
| Glenfiddich 18 Year | `glenfiddich-18-year-single-malt-speyside.webp` |
| Asahi Super Dry | `asahi-super-dry-premium-lager-japan.webp` |

---

### 8. Facets — `GET /api/products/facets`

Returns all distinct values with counts for every filterable field: categories, countries, statuses, regions, appellations, wine classifications. Use this to understand what values exist in the database.

---

### 8. Change Log — `GET /api/changelog`

View product change history with filters.

| Parameter | Description |
|-----------|-------------|
| `field` | Filter by changed field (price, cost, region, etc.) |
| `source` | masterfile_import, override_import, batch_process, manual_edit |
| `sku` | Filter by SKU (partial match) |
| `since` | ISO date — only changes after this date |
| `page` / `limit` | Pagination (default 50/page) |

---

### 9. Map Explorer — `GET /api/explore/products`

Products for the interactive wine/spirits map at `/explore`.

| Parameter | Description |
|-----------|-------------|
| `country` | Country filter |
| `region` | Region filter |
| `category` | wine, spirits, beer, sake |
| `sort` | popular, price-asc, price-desc, newest, name |
| `page` / `limit` | Pagination |

`popular` sorts by `products.popularity_score` descending, then `popularity_orders_90d`, then `price`. The response includes `popularity_score`, `popularity_qty_90d`, `popularity_orders_90d`, `popularity_revenue_90d`, `popularity_window_days`, and `popularity_synced_at` when those columns are populated.

**Popularity pipeline:** populated by `data/sync_popularity_from_bi.py`, which reads `marts.mart_pivot_base` from the local BI DuckDB (`/Users/admin/Desktop/CLAUDE DATA_WNLQ9 M REPORT ALL/data/processed/ecommerce_bi.duckdb`), aggregates the last 90 days of `is_closed = 1` orders per SKU, computes `popularity_score = 0.5·norm(orders) + 0.3·norm(qty) + 0.2·norm(revenue)` (each component min-max normalised to `[0, 1]`), and upserts to Supabase. A launchd job (`com.wnlq9.popularity-sync`) runs the script daily at 04:00 local time. Manual run: `.venv/bin/python3 data/sync_popularity_from_bi.py [--window-days N] [--dry-run]`.

---

## Product Schema

### Key Fields

| Field | Type | Description | Coverage |
|-------|------|-------------|----------|
| `sku` | string | Unique product identifier (prefix = type) | 100% |
| `name` | string | Product name | 100% |
| `brand` | string | Brand name | 100% |
| `classification` | string | Red Wine, White Wine, Whisky, Gin, Rum, Beer, Sake... | 95% |
| `wine_classification` | string | Quality tier: Grand Cru, Premier Cru, Reserva... | 10% |
| `grape_variety` | string | Grape(s): "Cabernet Sauvignon", "Pinot Noir 100%" | 60% |
| `vintage` | string | Vintage year or "NV" | 66% |
| `country` | string | Country of origin | 98% |
| `region` | string | Wine/spirits region: Bordeaux, Napa, Highland... | 76% |
| `subregion` | string | Subregion: Pauillac, Oakville, Speyside... | low |
| `appellation` | string | AOC/AVA/DOC | low |
| `wine_body` | string | Light, Medium, Full | 15% |
| `wine_acidity` | string | Low, Medium, High | 15% |
| `wine_tannin` | string | Low, Medium, High | 15% |
| `food_matching` | string | Food pairing suggestions | 15% |
| `flavor_tags` | string | JSON array of flavor descriptors | 20% |
| `flavor_profile` | string | JSON array of tasting notes | 33% |
| `price` | number | Retail price in THB | 100% |
| `cost_price` | number | Cost price in THB | 90% |
| `bottle_size` | string | "750 ml", "1 L", "1.75 L" | 80% |
| `alcohol` | string | ABV percentage | 30% |
| `full_description` | string | HTML product description | 0% |
| `validation_status` | string | validated, needs_review, needs_attention | 100% |
| `overall_confidence` | number | 0.0-1.0 enrichment confidence score | 100% |

### SKU Prefixes

| Prefix | Category | Count |
|--------|----------|-------|
| `WRW` | Red Wine | ~1,700 |
| `WWW` | White Wine | ~620 |
| `WSP` | Sparkling Wine | ~300 |
| `WCH` | Champagne | included in WSP |
| `WRS` | Rose | ~70 |
| `WDW` | Dessert Wine | ~35 |
| `LWH` | Whisky | ~230 |
| `LGN` | Gin | ~130 |
| `LRM` | Rum | ~80 |
| `LTQ` | Tequila | ~80 |
| `LVK` | Vodka | ~65 |
| `LBD` | Brandy | ~53 |
| `LLQ` | Liqueur | ~110 |
| `LSK` | Sake | ~100 |
| `LBE` | Beer | ~19 |
| `ABA/AWC` | Accessories | ~490 |
| `GWN` | Glassware | ~280 |
| `NNA` | Non-alcoholic | ~84 |

---

## For AI Agents

### Step 1: Understand the Data

```bash
curl http://localhost:3000/api/products/overview
```

This returns live stats, schema, coverage, gaps, and all API endpoints.

### Step 2: Find Products to Enrich

```bash
# Products with country but missing region (high confidence first)
curl "http://localhost:3000/api/products/search?has=country&missing=region&sort=overall_confidence&sortDir=desc&limit=50"

# Wine products missing grape variety
curl "http://localhost:3000/api/products/search?missing=grape_variety&classification=Red%20Wine&limit=50"

# All products missing flavor profile
curl "http://localhost:3000/api/products/search?missing=flavor_profile&has=grape_variety&limit=50"

# Expensive products missing descriptions (highest business value)
curl "http://localhost:3000/api/products/search?missing=full_description&sort=price&sortDir=desc&limit=50"
```

### Step 3: Update Products

```bash
# Get the product ID first
curl "http://localhost:3000/api/products/search?q=WRW0066AC&limit=1"
# Use the id from the response

# Update fields
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "region": "Bordeaux",
      "subregion": "Pauillac",
      "grape_variety": "Cabernet Sauvignon, Merlot",
      "wine_body": "Full",
      "wine_acidity": "Medium",
      "wine_tannin": "High",
      "food_matching": "Grilled beef, lamb, aged cheese"
    },
    "note": "AI enrichment from product research"
  }'
```

### Step 4: Verify Updates

```bash
# Check your changes were logged
curl "http://localhost:3000/api/changelog?source=manual_edit&limit=10"
```

### Enrichment Guidelines

When filling in data, follow these conventions:

- **grape_variety**: Use full names, comma-separated. Include percentages if known. Example: "Cabernet Sauvignon 60%, Merlot 30%, Petit Verdot 10%"
- **wine_body**: One of: Light, Medium, Medium-Full, Full
- **wine_acidity**: One of: Low, Medium, Medium-High, High
- **wine_tannin**: One of: Low, Medium, Medium-High, High
- **food_matching**: Comma-separated food categories. Example: "Grilled red meat, lamb, aged hard cheese, dark chocolate"
- **flavor_profile**: JSON array. Example: '["Blackcurrant","Cedar","Tobacco","Dark Cherry","Vanilla"]'
- **region**: Use the canonical region name from the taxonomy. Call `/api/products/facets` to see existing values.
- **classification**: Must be one of the existing categories. Call `/api/products/facets` to see valid values.

### Batch Enrichment Pattern

For enriching many products at once:

1. Export a batch: `GET /api/products/search?missing=FIELD&limit=100`
2. Research and prepare updates externally
3. Apply updates one by one via `PATCH /api/products/{id}`
4. Or prepare a CSV and use the Masterfile Import UI at `http://localhost:3000` (Import > Masterfile Update)

---

## For Other Projects

### Syncing Product Data

```bash
# Full sync — download all validated products
curl http://localhost:3000/api/products/export?format=json > local_cache.json

# Incremental — look up specific SKUs
curl -X POST http://localhost:3000/api/products/lookup \
  -H "Content-Type: application/json" \
  -d '{"skus": ["WRW0066AC", "WWW0047AC"]}'
```

### Integration Pattern

1. On first run: call `/api/products/export` to get the full catalog
2. Cache locally in your project
3. For real-time lookups: call `/api/products/lookup?sku=XXX`
4. Periodically re-sync by comparing your cache timestamp against a fresh export

### Interactive Map

The product database powers an interactive wine/spirits map at:

```
http://localhost:3000/explore
http://localhost:3000/explore/wine
http://localhost:3000/explore/wine/france
http://localhost:3000/explore/wine/france/burgundy
```

Map data (taxonomy with coordinates and product counts) is available at:
- Static JSON: `data/taxonomy/explore-taxonomy.json` (118 KB)
- Country boundaries: `public/data/ne_110m_countries.geojson` (819 KB)
