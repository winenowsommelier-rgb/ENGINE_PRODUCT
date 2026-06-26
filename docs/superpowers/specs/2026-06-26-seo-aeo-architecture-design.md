# WNLQ9 Full-Stack SEO/AEO Architecture
**Date:** 2026-06-26
**Status:** Approved — v2 (post adversarial review)
**Scope:** `apps/catalog` — Next.js 14 storefront at wnlq9-catalog.vercel.app

---

## Context

WNLQ9 is a Bangkok-based curated wine, whisky and spirits retailer. The catalog is a Next.js 14 SSG/ISR storefront with ~11,500+ products (count grows with onboarding) across 430 wine regions and 10 category groups. All product counts in this spec are derived at build time from `live_products_export.json` and are never hardcoded. Audience: English-speaking expats and Thai nationals searching for imported wine/spirits (retail-focused, English-language).

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

**Single sitemap file** — all in-stock and region URLs fit comfortably within Google's 50,000-URL / 50 MB limit. Segmentation adds complexity with no current benefit. Revisit only if the catalog exceeds 40,000 indexable URLs.

```
/sitemap.xml
    /                          changeFreq daily    (no priority — Google ignores it)
    /shop                      changeFreq daily
    /explore-map               changeFreq weekly
    /about                     changeFreq monthly
    /contact                   changeFreq monthly
    /shop/[group] × 10         changeFreq daily
    /product/[sku]  (in-stock only, custom_stock_status ≠ CATALOG)
                               changeFreq weekly   lastmod: see note below
    /explore-map/[region] × 430  changeFreq weekly
```

**Archived products are excluded from the sitemap.** SKUs with `custom_stock_status === 'CATALOG'` have no purchase intent and will dilute crawl budget. The product page itself will carry `noindex` (see §1.5).

**`lastmod` implementation note:** `updated_at` is NOT in `PUBLIC_FIELDS` and is not available via `getAllProducts()`. The sitemap must read `data/live_products_export.json` directly (raw file import, not via the catalog-data module). Do NOT add `updated_at` to PUBLIC_FIELDS. Separately: since bulk enrichment runs stamp identical `updated_at` values across thousands of products simultaneously, use the build date as `lastmod` for all product URLs rather than the DB timestamp — this avoids signalling a mass-change event to Googlebot on every enrichment run.

**`priority` values are omitted** — Google has stated publicly it ignores the `priority` field in sitemaps.

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

Added via `metadata.alternates.canonical` in every `generateMetadata()` call — including all pages with dynamic metadata. **Cannot be delegated to `layout.tsx`** because Next.js 14 does not deep-merge `alternates` from layout into page metadata; a page with its own `generateMetadata()` that omits `alternates` will emit no canonical at all.

Canonical rules:
- `/shop?group=Wine` → canonical `/shop/wine` (the static group route, not `/shop`)
- `/shop?group=Wine&page=2` → canonical `/shop/wine`
- `/shop` (unfiltered) → canonical `/shop`
- `/product/[sku]` → canonical `/product/[sku]` (absolute URL)
- `/explore-map/[region]` → canonical `/explore-map/[region]` (absolute URL)
- All other pages → canonical = own absolute URL

**Critical conflict resolved:** The original spec said `/shop?group=Wine` should canonical to `/shop`. This was wrong — it would signal that all category views are duplicates of the general shop, competing with the static `/shop/[group]` pages being built. Canonicals now point to the static group route.

### 1.4 hreflang

**Not implemented in this phase.** hreflang is designed for multi-language or multi-regional sites with separate language versions. This site is English-only (`<html lang="en">`). Emitting `hreflang="en"` + `x-default` with identical URLs provides zero ranking signal and adds implementation complexity. The `<html lang="en">` tag already signals language to Google. Implement hreflang only when Thai-language pages (`/th/...`) exist with real alternate URLs.

Note: Next.js 14's `metadata.alternates` in `layout.tsx` is silently overridden by any page that exports its own `generateMetadata()` (alternates are not deep-merged). Canonical tags must therefore be set explicitly inside each page's own `generateMetadata()` call — not delegated to the layout.

### 1.5 noindex Guards

- `/finder/[step]/page.tsx`: add `export const metadata: Metadata = { robots: { index: false } }`
- `/finder/result/page.tsx`: same
- `/shop` with thin filter results (< 5 products): inject `<meta name="robots" content="noindex">` conditionally in the server component when the filtered product count is below threshold
- `/product/[sku]` where `custom_stock_status === 'CATALOG'` (archived): add `robots: { index: false }` in `generateMetadata()` — these pages are excluded from the sitemap AND get noindex so they are dropped from the index even if discovered via links

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

`SearchAction` / Sitelinks Searchbox requires a server-rendered search results URL (`/shop?q={term}`). The current search is a client-side overlay with no stable results URL — do NOT include `potentialAction` until a `/search` server route exists. Including it now with a URL that returns the full catalog (not filtered results) will cause Google to reject the Sitelinks Searchbox.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://wnlq9-catalog.vercel.app/#website",
      "name": "WNLQ9",
      "url": "https://wnlq9-catalog.vercel.app/"
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

The `@id` values (`#website`, `#organization`) are used by other schema blocks to reference these entities without duplicating their properties.

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

`score_summary` contains multiple critics (JS, WS, WA). Strategy: compute `ratingValue` as the **mean** of all `score_value` entries in `critics[]`, rounded to one decimal place. `ratingCount` = number of critics. List all critics with scores in the `description` field. `bestRating` is required by Google — always `"100"` for wine critics. `worstRating` is `"50"` (conventional wine critic floor).

Do NOT use the highest score as `ratingValue` — that misrepresents the aggregate and violates schema.org `AggregateRating` semantics. `score_max` (the highest individual score) is used separately for the display badge in the UI, not for schema.

```json
{
  "@type": "AggregateRating",
  "ratingValue": "97.0",
  "bestRating": "100",
  "worstRating": "50",
  "ratingCount": 2,
  "description": "James Suckling 98, Wine Advocate 96"
}
```

Only emit this block when `score_summary` is non-null and has at least one `score_value` in `critics[]`.

**BreadcrumbList** on every product page. `item` must be a full absolute URL (Google ignores relative paths in BreadcrumbList). The last item (current page) has no `item` property — only `name`.

```json
{
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Shop",
      "item": "https://wnlq9-catalog.vercel.app/shop" },
    { "@type": "ListItem", "position": 2, "name": "Wine",
      "item": "https://wnlq9-catalog.vercel.app/shop/wine" },
    { "@type": "ListItem", "position": 3, "name": "Coastal Ridge Cabernet Sauvignon" }
  ]
}
```

The second breadcrumb item points to the static `/shop/[group]` route (not the query-param form `/shop?group=Wine`), because that is the canonical URL for the category page.

### 2.3 LocalBusiness (/contact)

Use `@id: "#organization"` to link this to the same entity as the Organization schema in layout — they describe the same business and must share an `@id` so Google merges them into one knowledge panel entry rather than treating them as two separate entities.

```json
{
  "@type": "LocalBusiness",
  "@id": "https://wnlq9-catalog.vercel.app/#organization",
  "name": "WNLQ9",
  "description": "Curated wine, whisky and spirits. Browse online, order via LINE or WhatsApp.",
  "url": "https://wnlq9-catalog.vercel.app/",
  "areaServed": {
    "@type": "City",
    "name": "Bangkok",
    "containedInPlace": { "@type": "Country", "name": "Thailand" }
  },
  "serviceType": "Wine and spirits retail",
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "WNLQ9 Wine & Spirits Catalog",
    "url": "https://wnlq9-catalog.vercel.app/shop"
  }
}
```

Note: No physical `address` is injected unless explicitly provided in env config (`WNLQ9_ADDRESS`). Without a physical address, WNLQ9 will not appear in Google Maps local pack results — but `areaServed: Bangkok` is still sufficient for local knowledge panel and service-area business signals. If an address becomes available, add it as a `PostalAddress` object.

### 2.4 CollectionPage + BreadcrumbList (/explore-map/[region])

`CollectionPage` must include `hasPart` to be semantically meaningful — without it the type annotation provides no structured data benefit beyond a generic `WebPage`. Include the top 5 products for the region (by critic score, then price) as `hasPart` items to connect the collection to its member products in the knowledge graph.

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
  "numberOfItems": 752,
  "hasPart": [
    {
      "@type": "Product",
      "name": "Château Pétrus 2018",
      "url": "https://wnlq9-catalog.vercel.app/product/WCH0001",
      "offers": { "@type": "Offer", "price": "185000", "priceCurrency": "THB" }
    }
  ]
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

Auto-generated from catalog data at build time. **FAQPage JSON-LD content must be visible as rendered HTML on the page** — Google's FAQ rich result guidelines require the Q&A content to exist as expandable or visible text, not just in the schema. Implement as a visible `<details>`/`<summary>` accordion section on the region page below the product list. The JSON-LD must mirror the visible content exactly.

**Scope:** Top 50 regions by product count only (not all 430). This avoids the "scaled programmatic content" risk from Google's helpful content guidance while covering all commercially significant regions.

3 Q&As per region (not 4 — Q2 food pairing dropped; see below):

```
Q1: What [region] [category] does WNLQ9 carry?
    A: WNLQ9 stocks [N] bottles from [region], [country], including [top 3 varieties].
       Prices range from ฿[min] to ฿[max]. Browse: [URL]

Q2: What are the top-rated [region] [category] at WNLQ9?
    A: [Up to 3 products with critic scores in that region: "Name (Score pts, Critic)"]
       Only emit this Q&A when ≥1 scored product exists in the region.

Q3: How do I order [region] wine from WNLQ9 in Thailand?
    A: WNLQ9 is a Bangkok-based retailer. Contact us via LINE or WhatsApp
       to place an order. [contact URL]
```

**Q2 food pairing is dropped.** Aggregating `food_matching` across all products in a region (e.g. 783 Bordeaux products) produces an answer listing every food category — true for every wine region worldwide, zero information value. Scoping to top-scored products' pairings produces marginal improvement at high implementation complexity.

Builder function: `apps/catalog/lib/seo/faq-builder.ts` — pure function, takes region slug + region products array, returns `{ schema: FAQPageObject, qaItems: QAItem[] }`. The `qaItems` are rendered as visible HTML; the `schema` is emitted as JSON-LD. Generated at build time, zero runtime cost.

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

Applied on every page via `metadata.openGraph` and `metadata.twitter` in each page's `generateMetadata()`:

```html
<meta property="og:type" content="website" />          <!-- "product" on /product/[sku] -->
<meta property="og:locale" content="en_TH" />
<meta property="og:site_name" content="WNLQ9" />
<meta property="og:image" content="[absolute url]" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
```

**Product pages:** bottle images from `th.wine-now.com` are portrait-format (~300×400px), not 1200×630. Do NOT use the raw bottle image as `og:image` without a social card wrapper — Facebook, Slack, and X will crop them badly. Use the fallback OG image for all product pages in this phase. A dedicated bottle-image social card (Next.js OG image generation) is a future enhancement.

**Fallback OG image:** `apps/catalog/public/og-default.jpg` — must be created as part of this work (1200×630px, WNLQ9 brand lockup). Does not currently exist in the repo. Until it is created, omit the `og:image` tag rather than pointing to a missing file.

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

### 4.2 Speakable Schema — DROPPED

Google removed `Speakable` from its supported rich result types in 2023. It is no longer honored by any Google Search feature. Do not implement.

Replaced by: ensuring the `/about` page has strong natural-language copy that can be cited directly by AI systems without schema annotation. The `llms.txt` file (§4.3) serves this purpose more effectively for AEO.

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
  apps/catalog/app/sitemap.ts                    NEW — single sitemap, in-stock + region URLs only
  apps/catalog/app/robots.ts                     NEW — disallow /finder/, /api/
  apps/catalog/app/finder/[step]/page.tsx        ADD robots: { index: false }
  apps/catalog/app/finder/result/page.tsx        ADD robots: { index: false }
  apps/catalog/app/product/[sku]/page.tsx        ADD robots: { index: false } for CATALOG-status SKUs
  apps/catalog/app/shop/page.tsx                 ADD export const metadata + canonical + noindex guard
  (hreflang — NOT implemented; deferred until Thai-language pages exist)

Phase 2 — Structured Data
  apps/catalog/components/seo/JsonLd.tsx         NEW — server component, never client-rendered
  apps/catalog/lib/seo/jsonld.ts                 NEW — pure builder functions for all schema types
  apps/catalog/lib/seo/faq-builder.ts            NEW — FAQPage schema + visible QA items from product data
  apps/catalog/lib/seo/region-blurb-builder.ts   NEW — 3-sentence region blurb from product data
  apps/catalog/app/layout.tsx                    ADD WebSite + Organization JSON-LD (@graph, no SearchAction)
  apps/catalog/app/product/[sku]/page.tsx        ADD Product + BreadcrumbList + AggregateRating JSON-LD
  apps/catalog/app/contact/page.tsx              ADD LocalBusiness JSON-LD (shared @id with Organization)
  apps/catalog/app/explore-map/[region]/page.tsx ADD CollectionPage (with hasPart) + FAQPage JSON-LD
  apps/catalog/app/shop/[group]/page.tsx         NEW — 10 static group pages with ItemList JSON-LD

Phase 3 — Metadata Depth
  apps/catalog/app/layout.tsx                    UPGRADE root title/desc; OG locale + site_name defaults
  apps/catalog/app/product/[sku]/page.tsx        UPGRADE title template + canonical + OG (fallback image)
  apps/catalog/app/shop/page.tsx                 UPGRADE title + desc + canonical
  apps/catalog/app/shop/[group]/page.tsx         ADD per-group title/desc/canonical (in Phase 2 file)
  apps/catalog/app/explore-map/[region]/page.tsx UPGRADE title/desc/canonical with data-driven content
  apps/catalog/app/about/page.tsx                UPGRADE title/desc/canonical
  apps/catalog/app/contact/page.tsx              UPGRADE title/desc/canonical

Phase 4 — AEO
  apps/catalog/public/og-default.jpg             NEW — 1200×630 brand lockup (required before deploy)
  apps/catalog/public/llms.txt                   NEW — generated by build script, kept current
  scripts/gen-llms-txt.mjs                       NEW — reads export JSON, writes llms.txt at build time
  apps/catalog/app/explore-map/[region]/page.tsx ADD visible region blurb + FAQ accordion (top 50 regions)
  (Speakable — NOT implemented; deprecated by Google 2023)
```

---

## Constraints & Guard Rails

- **No LLM calls** — all content derived from `live_products_export.json` at build time
- **No new DB writes** — SEO layer is purely read-only against the existing export
- **No Core Web Vitals regression** — all JSON-LD server-rendered; no client hydration of schema
- **Canonical in every generateMetadata()** — cannot delegate to layout; Next.js 14 does not deep-merge `alternates`
- **`classification` field never used** — category routing uses `category_group`/`category_type` per Rule 12
- **Archived products** — excluded from sitemap AND get `robots: { index: false }` in generateMetadata()
- **Thin filter pages** — `/shop` with < 5 results gets `noindex` injected dynamically in the server component
- **AggregateRating** — `ratingValue` is always the mean of all critics, never the max; `bestRating: "100"` always required
- **FAQPage** — content must be visible HTML on the page; JSON-LD must mirror it exactly; top 50 regions only
- **CollectionPage** — must include `hasPart` with top 5 products or the type annotation provides no value
- **SearchAction** — omitted until a server-rendered `/search?q=` route exists
- **Speakable** — dropped; deprecated by Google in 2023
- **hreflang** — not implemented; English-only site, `<html lang="en">` is sufficient
- **OG image** — fallback `public/og-default.jpg` must be created before deployment; omit tag if file missing
- **Product counts** — never hardcoded; always computed at build time from the export file
- **Sitemap lastmod** — uses build date, not `product.updated_at` (not in PUBLIC_FIELDS; bulk runs stamp identical timestamps)
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
