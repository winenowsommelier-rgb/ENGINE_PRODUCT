# WNLQ9 Full-Stack SEO/AEO Architecture
**Date:** 2026-06-26
**Status:** Approved
**Scope:** `apps/catalog` — Next.js 14 storefront at wnlq9-catalog.vercel.app

---

## Context

WNLQ9 is a Bangkok-based curated wine, whisky and spirits retailer. The catalog is a Next.js 14 SSG/ISR storefront with 11,436 products across 430 wine regions and 10 category groups. Audience: English-speaking expats and Thai nationals searching for imported wine/spirits (retail-focused, English-language).

### Current SEO State (audited 2026-06-26)

| Signal | Status |
|---|---|
| sitemap.xml | 404 — does not exist |
| robots.txt | 404 — does not exist |
| Structured data (JSON-LD) | Zero — none on any page |
| /shop page metadata | Inherits root title "WNLQ9" — no own metadata |
| /finder/* noindex | Missing — wastes crawl budget |
| Canonical tags | Missing — filter URL pollution risk |
| OG image dimensions | Missing — social preview cropping |
| geo-signal in titles | Missing — "Bangkok"/"Thailand" absent from all titles |
| llms.txt | 404 — no AEO file |
| Core Web Vitals | Good — homepage 121ms/81KB, product 403ms/68KB — protect |

---

## Goals (priority order)

1. **Transactional** — rank product pages for specific bottle searches ("buy Penfolds Grange Bangkok")
2. **Discovery** — rank category/region pages for intent searches ("best Burgundy wine Thailand")
3. **AEO** — appear in AI answers (ChatGPT, Perplexity, Google AI Overviews) for "where to buy X in Bangkok"

---

## Architecture: Four Layers

```
Layer 1: Technical Foundation
  sitemap.xml + robots.txt + canonical + noindex guards
  → everything is crawlable, indexed, and budget-efficient

Layer 2: Structured Data (JSON-LD)
  Product + BreadcrumbList + ItemList + Organization + LocalBusiness + FAQPage
  → rich results in SERPs + signals for AI answer engines

Layer 3: Page-Level Metadata Depth
  Keyword-targeted titles with geo-signal, OG with dimensions, Twitter cards
  → improved CTR from SERPs and social sharing quality

Layer 4: AEO Content Signals
  Auto-generated region blurbs + FAQPage schema + llms.txt + Speakable
  → cited in AI Overviews and Perplexity answers
```

---

## Layer 1: Technical Foundation

### 1.1 Sitemap

File: `apps/catalog/app/sitemap.ts` (Next.js 14 MetadataRoute.Sitemap)

Segmented sitemap index with three child sitemaps:

```
/sitemap.xml  (index pointing to all three)
  /sitemap/core.xml
      /                     priority 1.0  daily
      /shop                 priority 0.9  daily
      /explore-map          priority 0.8  weekly
      /about                priority 0.5  monthly
      /contact              priority 0.5  monthly

  /sitemap/products.xml     (11,436 URLs)
      /product/[sku]        priority 0.8  in-stock (is_in_stock=1, custom_stock_status≠CATALOG)
                            priority 0.3  archived (custom_stock_status=CATALOG)
                            lastmod: product.updated_at

  /sitemap/regions.xml      (430 URLs)
      /explore-map/[region] priority 0.7  weekly
```

Implementation note: Next.js 14 supports `generateSitemaps()` for segmented output. All three sitemaps are generated at build time from `live_products_export.json` and the explore map data.

### 1.2 robots.ts

File: `apps/catalog/app/robots.ts`

```
User-agent: *
Allow: /
Disallow: /finder/
Disallow: /api/
Sitemap: https://wnlq9-catalog.vercel.app/sitemap.xml
```

Rationale: `/finder/*` contains dynamic quiz state pages with zero unique content. Blocking them prevents crawl budget waste on 11+ step permutations.

### 1.3 Canonical Tags

Added via `metadata.alternates.canonical` in every `generateMetadata()` call. Canonical is the clean URL without query parameters for all filter-driven pages (`/shop?group=Wine` → canonical `/shop`).

Exception: the 10 category group pages if made into static routes (see Layer 2 §2.5) each get their own canonical pointing to themselves.

### 1.4 hreflang

Every page gets `<link rel="alternate" hreflang="en" href="[canonical]">` and `<link rel="alternate" hreflang="x-default" href="[canonical]">`. Applied once in `layout.tsx` via `metadata.alternates`. Signals English-language intent to Google and prevents confusion if Thai content is added later.

### 1.5 noindex Guards

- `/finder/[step]/page.tsx`: add `export const metadata: Metadata = { robots: { index: false } }`
- `/finder/result/page.tsx`: same
- `/shop` with thin filter results (< 5 products): inject `<meta name="robots" content="noindex">` conditionally in the server component when the filtered product count is below threshold

---

## Layer 2: Structured Data (JSON-LD)

### Implementation Pattern

All JSON-LD is rendered server-side as `<script type="application/ld+json">` via a `JsonLd` server component:

```tsx
// apps/catalog/components/seo/JsonLd.tsx
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

Never client-rendered. All builder functions live in `apps/catalog/lib/seo/jsonld.ts` as pure functions that take product/page data and return plain objects. This keeps page components clean and makes the schema testable.

### 2.1 WebSite + Organization (layout.tsx — every page)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://wnlq9-catalog.vercel.app/#website",
      "name": "WNLQ9",
      "url": "https://wnlq9-catalog.vercel.app/",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://wnlq9-catalog.vercel.app/shop?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@type": "Organization",
      "@id": "https://wnlq9-catalog.vercel.app/#organization",
      "name": "WNLQ9",
      "url": "https://wnlq9-catalog.vercel.app/",
      "description": "Curated wine, whisky and spirits retailer based in Bangkok, Thailand.",
      "areaServed": "Thailand",
      "serviceType": "Wine and spirits retail"
    }
  ]
}
```

### 2.2 Product + BreadcrumbList (/product/[sku])

**Product schema** — fields mapped from `PublicProduct`:

| Schema field | Source field | Notes |
|---|---|---|
| name | product.name | |
| description | desc_en_short \|\| full_description | Strip HTML |
| image | image_url | |
| sku | sku | |
| brand.name | brand | |
| category | category_type | NOT raw classification |
| countryOfOrigin | country | |
| offers.price | price | THB |
| offers.priceCurrency | "THB" | hardcoded |
| offers.availability | is_in_stock | InStock / OutOfStock |
| offers.seller | "WNLQ9" | |
| aggregateRating | score_summary | See §2.2a below |
| additionalProperty | body, acidity, tannin, variety, region, vintage, flavor_tags, food_matching | PropertyValue array |

**§2.2a — AggregateRating from score_summary**

`score_summary` contains multiple critics (JS, WS, WA). Strategy: use the **highest** critic score as `ratingValue`, name that critic in a `description` field, and set `ratingCount` to the number of critics who scored it. This is technically `AggregateRating` (averaged across reviewers) — but since wine critics are independent authorities, using the highest with disclosure is the accepted pattern used by Wine-Searcher and Vivino.

```json
{
  "@type": "AggregateRating",
  "ratingValue": "98",
  "bestRating": "100",
  "worstRating": "85",
  "ratingCount": 2,
  "description": "James Suckling 98, Wine Advocate 96"
}
```

Only emit this block when `score_summary` is non-null and has at least one critic score.

**BreadcrumbList** on every product page:

```json
{
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Shop", "item": "/shop" },
    { "@type": "ListItem", "position": 2, "name": "Wine", "item": "/shop?group=Wine" },
    { "@type": "ListItem", "position": 3, "name": "Coastal Ridge Cabernet Sauvignon" }
  ]
}
```

### 2.3 LocalBusiness (/contact)

```json
{
  "@type": "LocalBusiness",
  "@id": "https://wnlq9-catalog.vercel.app/#localbusiness",
  "name": "WNLQ9",
  "description": "Curated wine, whisky and spirits. Browse online, order via LINE or WhatsApp.",
  "url": "https://wnlq9-catalog.vercel.app/",
  "areaServed": {
    "@type": "Country",
    "name": "Thailand"
  },
  "serviceType": "Wine and spirits retail",
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "WNLQ9 Wine & Spirits Catalog",
    "url": "https://wnlq9-catalog.vercel.app/shop"
  }
}
```

Note: No physical address is injected unless one is explicitly provided in env config. `areaServed: Thailand` is sufficient for local search intent.

### 2.4 CollectionPage + BreadcrumbList (/explore-map/[region])

```json
{
  "@type": "CollectionPage",
  "name": "Bordeaux Wine — WNLQ9",
  "description": "Browse 752 bottles from Bordeaux, France...",
  "url": "https://wnlq9-catalog.vercel.app/explore-map/bordeaux",
  "about": {
    "@type": "Place",
    "name": "Bordeaux",
    "containedInPlace": { "@type": "Country", "name": "France" }
  },
  "numberOfItems": 752
}
```

### 2.5 ItemList on Category Pages (/shop?group=X)

The 10 category groups (`Wine`, `Whisky`, `Spirits`, etc.) are the highest-traffic discovery pages. To enable Google carousel rich results, these need static routes with `ItemList` schema.

Proposal: create `apps/catalog/app/shop/[group]/page.tsx` as static routes for the 10 groups, pre-rendered at build time. Each emits an `ItemList` of the top 20 in-stock products for that group (by critic score desc, then by price desc as tiebreak).

```json
{
  "@type": "ItemList",
  "name": "Wine — WNLQ9",
  "url": "https://wnlq9-catalog.vercel.app/shop/wine",
  "numberOfItems": 6983,
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "url": "https://wnlq9-catalog.vercel.app/product/WCH0001",
      "name": "Château Pétrus 2018",
      "image": "...",
      "offers": { "price": "185000", "priceCurrency": "THB" }
    }
    ...
  ]
}
```

### 2.6 FAQPage (/explore-map/[region])

Auto-generated from catalog data at build time. Each region page gets 4 Q&As:

```
Q1: What [region] [category] does WNLQ9 carry?
    A: WNLQ9 stocks [N] bottles from [region], [country], including [top 3 varieties].
       Prices range from ฿[min] to ฿[max]. Browse: [URL]

Q2: What food pairs well with [region] [category]?
    A: [Top 3 food_matching values from products in that region, deduplicated]

Q3: What are the top-rated [region] [category] at WNLQ9?
    A: [Up to 3 products with critic scores in that region, name + score]
       (Only emit if ≥1 scored product in region)

Q4: How do I order [region] wine from WNLQ9 in Thailand?
    A: WNLQ9 is a Bangkok-based retailer. Contact us via LINE or WhatsApp
       to place an order. [contact URL]
```

Builder function: `apps/catalog/lib/seo/faq-builder.ts` — pure function, takes region slug + all products for that region, returns FAQ schema object. Generated at build time, zero runtime cost.

---

## Layer 3: Page-Level Metadata

### Title Templates (with geo-signal)

| Route | Title template |
|---|---|
| / | `WNLQ9 — Wine, Whisky & Spirits \| Bangkok, Thailand` |
| /shop | `Shop Wine, Whisky & Spirits — WNLQ9 Bangkok` |
| /shop/wine | `Buy Wine in Thailand — Red, White, Sparkling & More \| WNLQ9` |
| /shop/whisky | `Buy Whisky in Thailand — Single Malt & Blended \| WNLQ9` |
| /shop/spirits | `Buy Spirits in Thailand — Gin, Vodka, Rum, Tequila \| WNLQ9` |
| /product/[sku] | `[name] [vintage] — Buy in Bangkok \| WNLQ9` |
| /explore-map | `Wine & Spirits by Region — Bordeaux, Burgundy & more \| WNLQ9` |
| /explore-map/[region] | `Buy [region] [category] in Thailand — [N] bottles \| WNLQ9` |
| /about | `About WNLQ9 — Curated Wine & Spirits, Bangkok` |
| /contact | `Order Wine & Spirits — Contact WNLQ9, Bangkok` |

Vintage in product title: only include if `vintage` is a real year (not "Current vintage"). Cap total title length at 60 characters.

### Meta Description Templates

| Route | Description template |
|---|---|
| / | `WNLQ9 is a curated selection of wine, whisky and spirits in Bangkok. [N] bottles from 430 regions worldwide. Browse and order via LINE or WhatsApp.` |
| /shop | `Shop [N] wines, whiskies and spirits at WNLQ9, Bangkok. Filter by region, variety, taste and price. Order via LINE or WhatsApp.` |
| /product/[sku] | `[desc_en_short, max 155 chars]. Available at WNLQ9, Bangkok.` |
| /explore-map/[region] | `Browse [N] bottles from [region], [country] at WNLQ9. [Top variety]. Prices from ฿[min]. Order in Thailand via LINE or WhatsApp.` |

### OG / Social Tags

Applied on every page:

```html
<meta property="og:type" content="website" />          <!-- "product" on /product/[sku] -->
<meta property="og:locale" content="en_TH" />
<meta property="og:site_name" content="WNLQ9" />
<meta property="og:image" content="[url]" />
<meta property="og:image:width" content="1200" />       <!-- always include dimensions -->
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
```

Fallback OG image: a single `public/og-default.jpg` (1200×630) used for pages without a product image. This prevents blank previews on social sharing.

---

## Layer 4: AEO Signals

### 4.1 Auto-Generated Region Content Blurbs

For the top 50 regions by product count (Bordeaux 752 → the long tail), generate a 3-sentence content paragraph at build time from catalog data:

```
[Region] is one of [country]'s most celebrated wine regions, represented at WNLQ9
by [N] bottles. The selection spans [top 3 varieties], with prices ranging from
฿[min] to ฿[max]. [If critic scores exist: Critic-acclaimed bottles include
[top scored product] ([score] pts, [critic]).]
```

Builder: `apps/catalog/lib/seo/region-blurb-builder.ts`. Pure function, no LLM calls. Rendered as visible `<p>` text on the region page — real on-page content, not hidden. Serves both human readers and crawlers.

Threshold: only generate for regions with ≥10 products. Below that, the blurb would be too thin to be credible.

### 4.2 Speakable Schema (/about)

```json
{
  "@type": "SpeakableSpecification",
  "cssSelector": [".about-intro", ".about-mission"]
}
```

Marks the introductory paragraphs on `/about` as speakable — used by Google Assistant and voice search to read aloud when someone asks "what is WNLQ9?".

### 4.3 llms.txt

File: `apps/catalog/public/llms.txt`

Perplexity, some ChatGPT plugins, and Claude web crawl this file. Structure:

```
# WNLQ9

> WNLQ9 is a curated wine, whisky and spirits retailer based in Bangkok, Thailand.

WNLQ9 stocks over 11,000 bottles from 430 wine and spirits regions across 40+
countries, with a focus on France, Italy, USA, Australia, Japan and Scotland.
The selection includes wine (red, white, rosé, sparkling, Champagne), whisky
(single malt, blended, Japanese), spirits (gin, vodka, rum, tequila, cognac),
sake, liqueurs, beer, and accessories.

## How to order
WNLQ9 does not process online payments. To order, contact the team directly:
- LINE: [handle]
- WhatsApp: [handle]
- Facebook Messenger: [handle]

## Catalog
Full catalog: https://wnlq9-catalog.vercel.app/shop
Browse by region: https://wnlq9-catalog.vercel.app/explore-map
Sitemap: https://wnlq9-catalog.vercel.app/sitemap.xml

## Key collections
- Bordeaux (752 bottles): https://wnlq9-catalog.vercel.app/explore-map/bordeaux
- Burgundy (565 bottles): https://wnlq9-catalog.vercel.app/explore-map/burgundy
- Champagne (496 bottles): https://wnlq9-catalog.vercel.app/explore-map/champagne
- Tuscany (457 bottles): https://wnlq9-catalog.vercel.app/explore-map/tuscany
- California (447 bottles): https://wnlq9-catalog.vercel.app/explore-map/california
- Speyside Whisky (224 bottles): https://wnlq9-catalog.vercel.app/explore-map/speyside
```

Contact handles are read from env vars (same `getContactEnv()` pattern). The file is regenerated at build time so bottle counts stay current.

---

## File Map

```
Phase 1 — Technical Foundation
  apps/catalog/app/sitemap.ts                NEW
  apps/catalog/app/robots.ts                 NEW
  apps/catalog/app/finder/[step]/page.tsx    ADD noindex metadata
  apps/catalog/app/finder/result/page.tsx    ADD noindex metadata
  apps/catalog/app/layout.tsx               ADD hreflang alternates + root canonical
  apps/catalog/app/shop/page.tsx             ADD export const metadata + canonical + noindex guard

Phase 2 — Structured Data
  apps/catalog/components/seo/JsonLd.tsx     NEW — server component wrapper
  apps/catalog/lib/seo/jsonld.ts             NEW — pure builder functions
  apps/catalog/lib/seo/faq-builder.ts        NEW — FAQ schema from product data
  apps/catalog/lib/seo/region-blurb-builder.ts  NEW — region text from product data
  apps/catalog/app/layout.tsx               ADD WebSite + Organization JSON-LD
  apps/catalog/app/product/[sku]/page.tsx   ADD Product + BreadcrumbList JSON-LD
  apps/catalog/app/contact/page.tsx         ADD LocalBusiness JSON-LD
  apps/catalog/app/explore-map/[region]/page.tsx  ADD CollectionPage + FAQPage JSON-LD
  apps/catalog/app/shop/[group]/page.tsx     NEW — 10 static category group pages with ItemList

Phase 3 — Metadata Depth
  apps/catalog/app/layout.tsx               UPGRADE root metadata title + OG defaults
  apps/catalog/app/product/[sku]/page.tsx   UPGRADE generateMetadata() title template + OG dims
  apps/catalog/app/shop/page.tsx             UPGRADE metadata title + description
  apps/catalog/app/shop/[group]/page.tsx     ADD per-group metadata (in Phase 2 file)
  apps/catalog/app/explore-map/[region]/page.tsx  UPGRADE generateMetadata() with data-driven desc
  apps/catalog/app/about/page.tsx           UPGRADE metadata title/desc
  apps/catalog/app/contact/page.tsx         UPGRADE metadata title/desc

Phase 4 — AEO
  apps/catalog/public/llms.txt              NEW (static, updated at build time via script)
  apps/catalog/app/about/page.tsx           ADD Speakable JSON-LD
  apps/catalog/app/explore-map/[region]/page.tsx  ADD region blurb text (visible on page)
  scripts/gen-llms-txt.mjs                  NEW — build-time llms.txt generator
```

---

## Constraints & Guard Rails

- **No LLM calls** — all content is derived from `live_products_export.json` at build time
- **No new DB writes** — SEO layer is purely read-only against the existing export
- **No Core Web Vitals regression** — all JSON-LD server-rendered; no client hydration of schema
- **No duplicate content** — canonical tag on every page; filter URLs canonicalize to clean URL
- **`classification` field is never used** — category routing uses `category_group`/`category_type` per Rule 12
- **`custom_stock_status=CATALOG` products** — included in sitemap at priority 0.3, never labeled InStock
- **Thin filter pages** — `/shop` with < 5 results gets `noindex` injected dynamically
- **Region blurb threshold** — only regions with ≥ 10 products get auto-generated blurbs
- **Title cap** — 60 chars max; vintage only included when it is a 4-digit year

---

## Success Metrics

| Metric | Baseline (now) | Target (8 weeks) |
|---|---|---|
| Pages indexed by Google | Unknown (no sitemap) | > 8,000 product pages |
| Rich results (product) | 0 | > 500 with price/rating |
| Rich results (breadcrumb) | 0 | All indexed product pages |
| Organic clicks (GSC) | Baseline | +40% |
| AI citation (Perplexity test queries) | 0 | Cited for ≥ 5 "Bangkok wine" queries |
| /shop page title in SERP | "WNLQ9" (wrong) | "Shop Wine, Whisky & Spirits — WNLQ9 Bangkok" |

---

## Implementation Order

```
Week 1 — Stop the bleeding
  sitemap.ts + robots.ts + /shop metadata + finder noindex + canonical everywhere

Week 2 — Structured data
  jsonld.ts builders + Product schema + WebSite/Org + LocalBusiness + ItemList on categories

Week 3 — Metadata depth
  Title templates with geo-signal + OG image dimensions + region page metadata upgrade

Week 4 — AEO
  Region blurbs (top 50 regions) + FAQPage schema + llms.txt + Speakable on About
```
