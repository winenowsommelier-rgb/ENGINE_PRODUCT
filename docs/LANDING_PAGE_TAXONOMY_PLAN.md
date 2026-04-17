# Landing Page & Taxonomy Library Plan

## Vision

Build a comprehensive product intelligence library that powers:
1. **Dedicated landing pages** — SEO-optimized pages for key regions, countries, classifications
2. **Collection & recommendation system** — curated product selections based on taxonomy data
3. **AI-powered content** — Claude and other AIs can read the library via API and generate content grounded in real catalog data
4. **Cross-project data hub** — other projects (BI, ecommerce, marketing) consume this as the authoritative source

---

## Current Data State (as of 2026-04-17)

### Products: 11,564 total

| Level | Total | With Descriptions | With Coords |
|-------|-------|-------------------|-------------|
| Countries | 50 | 49 (98%) | 50 (100%) |
| Regions | 90 | 48 (53%) | 90 (100%) |
| Subregions | 80 | 11 (14%) | 80 (100%) |
| Appellations | 81 | 10 (12%) | 81 (100%) |
| Brands | 618 | 35 (6%) | — |
| Expert packs | 55 | 55 (100%) | — |

### Coverage gaps
- region: 76% filled (2,797 missing)
- grape_variety: 60% (4,605 missing)
- description: 0% (11,564 missing)
- flavor_profile: 33% (7,697 missing)

---

## Priority Taxonomy for Landing Pages

### Tier 1 — High traffic, high product count (build first)

**Countries (10):**
| Country | Products | Expert | Priority |
|---------|----------|--------|----------|
| France | 854 | YES | Wine capital |
| Italy | 875 | YES | Most products |
| Australia | 340 | YES | Strong NW presence |
| USA | 182 | YES | Napa, Sonoma, bourbon |
| Spain | 113 | YES | Rioja, Ribera |
| Chile | 192 | YES | Value wines |
| Scotland | 186 | YES | Whisky heritage |
| Japan | 177 | YES | Sake + whisky |
| New Zealand | 95 | YES | Marlborough SB |
| Argentina | 64 | YES | Malbec |

**Regions (15):**
| Region | Country | Products | Expert |
|--------|---------|----------|--------|
| Bordeaux | France | 15+ (726 in catalog) | YES |
| Burgundy | France | 13+ (521) | YES |
| Tuscany | Italy | 20+ | YES |
| Champagne | France | 2+ (504) | YES |
| Piedmont | Italy | 12+ | YES |
| Napa | USA | 10+ | no |
| Barossa Valley | Australia | — | YES |
| Rioja | Spain | 2+ | YES |
| Mendoza | Argentina | 7+ | YES |
| Marlborough | New Zealand | — | YES |
| Highland | Scotland | 2+ | YES |
| Islay | Scotland | — | YES |
| Veneto | Italy | 14+ | no |
| California | USA | 12+ | no |
| Rhone Valley | France | 3+ | YES |

**Classifications (8):**
| Classification | Products |
|----------------|----------|
| Red Wine | ~4,000 |
| White Wine | ~1,500 |
| Sparkling Wine | ~800 |
| Champagne | ~500 |
| Whisky | ~400 |
| Gin | ~250 |
| Rum | ~150 |
| Sake | ~100 |

### Tier 2 — Medium (build second)
- Remaining top-20 regions: Languedoc, Abruzzo, Sicily, Paso Robles, Sonoma
- Spirits regions: Kentucky, Jalisco (tequila), Cognac, Campbeltown, Islay
- Key subregions: Pauillac, Saint-Emilion, Chianti, Barolo, Chablis

### Tier 3 — Long tail (build via automation)
- Remaining 60+ regions, 80 subregions, 81 appellations
- Use templates + expert library to auto-generate

---

## API for Cloud Claude Access

### Current (localhost only):
```
GET /api/products/overview          — full catalog state
GET /api/products/search?q=...      — search with filters
GET /api/products/lookup?sku=...    — SKU lookup
GET /api/products/export            — bulk export
GET /api/products/{id}/image        — image metadata
GET /api/taxonomy-descriptions      — taxonomy descriptions
GET /api/taxonomy-library           — SQLite taxonomy + expert overlay
GET /api/changelog                  — change history
```

### Needed for Cloud Claude:
1. **Public read-only API** — deploy to Vercel/Railway with auth token
2. **Structured content endpoint** — returns landing page-ready content bundles:
   - Country/region name, description, key grapes, key subregions
   - Product highlights (top 5 products by price/popularity)
   - Price ranges, vintage range
   - Related regions ("Also explore...")
   - Ready-to-render JSON that Claude can transform into blog/page content

### New endpoint: `GET /api/content-bundle/{type}/{slug}`

Returns everything needed to write a landing page:
```json
{
  "type": "region",
  "name": "Bordeaux",
  "country": "France",
  "description": { "short": "...", "full": "..." },
  "keyGrapes": ["Cabernet Sauvignon", "Merlot", "Petit Verdot"],
  "keySubregions": ["Pauillac", "Saint-Emilion", "Margaux", "Pessac-Leognan"],
  "productHighlights": [ { "sku": "...", "name": "...", "price": 1200 } ],
  "priceRange": { "min": 500, "max": 45000, "median": 2500 },
  "productCount": 726,
  "relatedRegions": ["Burgundy", "Rhone Valley", "Loire Valley"],
  "mapCoords": { "lat": 44.84, "lng": -0.58 },
  "seoTitle": "Bordeaux Wines — 726 Products from France's Premier Region",
  "seoDescription": "Discover Bordeaux wines from Pauillac, Saint-Emilion, and Margaux..."
}
```

---

## Development Plan

### Branch: `feature/content-library`

**Phase 1: Content Bundle API** (~1 hour)
- Build `/api/content-bundle/{type}/{slug}` endpoint
- Merges: Supabase products + SQLite taxonomy + expert library + explore-taxonomy coords
- Returns landing page-ready JSON bundles

**Phase 2: Taxonomy Coverage Sprint** (~2 hours)
- Fill missing expert entries for Tier 1 (15 regions, 8 classifications)
- Generate via Claude prompt using existing expert library as style guide
- Write to expert_knowledge_library.csv

**Phase 3: Landing Page Templates** (~2 hours)
- Build `/region/{slug}` page template in Next.js
- Renders from content-bundle API
- SEO meta, OG tags, structured data (JSON-LD)
- Product grid, price range, grape varieties, map embed

**Phase 4: Cloud Deploy** (depends on infra)
- Deploy to Vercel with bearer token auth on API
- Cloud Claude calls production API instead of localhost

---

## Prompt for New Branch (copy to new Claude session)

```
You are working on the ENGINE_PRODUCT PIM project at /Users/admin/WNLQ9 PIE/ENGINE_PRODUCT.

Create a new branch `feature/content-library` and build:

1. A content bundle API at `/api/content-bundle/[type]/[slug]/route.ts` that returns
   landing page-ready JSON for countries, regions, subregions, and classifications.
   It should merge: Supabase product data + SQLite taxonomy + expert_knowledge_library.csv
   + explore-taxonomy.json coordinates. See docs/LANDING_PAGE_TAXONOMY_PLAN.md for the
   exact response shape.

2. Landing page routes at `/region/[slug]/page.tsx` and `/country/[slug]/page.tsx`
   that render from the content-bundle API with SEO meta, product highlights, price
   range, key grapes, key subregions, and map coords.

3. Expand the expert_knowledge_library.csv with entries for these Tier 1 regions that
   are currently missing: Napa, Veneto, California, Abruzzo, Languedoc, Mendoza,
   Sicily, Ribera del Duero, Lazio, Puglia, Kentucky, Islay.

Key files to read first:
- docs/LANDING_PAGE_TAXONOMY_PLAN.md (this plan)
- PRODUCT_DATA_API.md (API docs)
- data/expert_knowledge_library.csv (expert content format)
- lib/explore/taxonomy-utils.ts (taxonomy data loading)
- lib/taxonomy-db.ts (SQLite + expert overlay)
- prompts/enrichment-agent-integration.md (field ownership rules)

The app uses Next.js 14.2, Tailwind CSS, and Supabase PostgreSQL.
Use `function` keyword syntax (not arrow functions) in components to avoid SWC parse issues.
```
