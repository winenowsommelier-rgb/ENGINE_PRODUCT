# Interactive Map Explorer — Design Specification

**Date:** 2026-04-12
**Status:** Draft
**Route:** `/explore`

---

## 1. Overview

An immersive, consumer-facing interactive world map for discovering and browsing wine, spirits, beer, and sake by geographic origin. The map is the primary interface — users drill down from world view through countries, regions, subregions, and appellations, with a product catalog surfacing contextually.

### Audience
- **Primary:** End consumers browsing th.wine-now.com / th.liq9.com
- **Secondary:** Standalone discovery/showcase tool (marketing, shareable)

### Design Vision
**Immersive map-first (full-bleed, dark theme)** with clean, restrained UI elements floating above. The vibe: walking into a high-end wine bar where the wall is a glowing world map. Glassmorphism cards, smooth fly-to animations, minimal chrome.

---

## 2. Technical Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Map renderer | Mapbox GL JS via `react-map-gl` | Best-in-class fly-to animations, custom dark styles, vector tile performance |
| Framework | Next.js 14 (existing app) | New route `/explore` within existing ENGINE_PRODUCT app |
| Styling | Tailwind CSS (existing) | Consistent with project |
| Icons | Lucide React (existing) | Consistent with project |
| State | URL-driven + React state | Shareable URLs, SSR-friendly |
| Data | Static taxonomy JSON + API calls | Two-phase: taxonomy instant, products on-demand |

### New Dependencies
- `react-map-gl` (~60KB gzipped)
- `mapbox-gl` (~200KB gzipped)
- Combined real-world bundle: ~280-300KB gzipped + ~1MB WebGL shader compilation on first load
- No other new dependencies required

### Mapbox Token Security
- Token stored in `.env.local` as `NEXT_PUBLIC_MAPBOX_TOKEN`
- Token scoped on Mapbox dashboard: restrict to production URL (`th.wine-now.com`, `th.liq9.com`) + `localhost` for dev
- Use a **public** token with URL-restriction (not a secret token — Mapbox GL JS requires client-side access)
- Free tier: 50,000 map loads/month. For projected traffic (~5K-10K monthly visits at launch), this is sufficient. Monitor via Mapbox dashboard and budget for growth.

### Performance Budgets
- **LCP target:** < 3.0s on 4G (Thailand average mobile connection)
- **TTI target:** < 5.0s on 4G
- **Non-WebGL fallback:** If `mapboxgl.supported()` returns false, show a static SVG world map with clickable country regions (graceful degradation, not a full feature set)

---

## 3. URL Structure & Routing

URLs drive all map state. Every view is a shareable link.

```
/explore                                    → World map, default (all categories)
/explore/wine                               → World map, wine lens active
/explore/spirits                            → World map, spirits lens active
/explore/beer                               → World map, beer lens active  
/explore/sake                               → World map, sake lens active
/explore/wine/france                        → France zoomed, wine lens
/explore/spirits/scotland                   → Scotland zoomed, spirits lens
/explore/wine/france/burgundy               → Burgundy zoomed, wine lens
/explore/wine/france/burgundy/chablis       → Chablis zoomed, wine lens
/explore/wine/france/burgundy/chablis/chablis-premier-cru → Appellation level
```

### Route Implementation
```
app/explore/
├── layout.tsx              ← Immersive layout (no dashboard navigation)
├── page.tsx                ← /explore (world view)
└── [...slug]/
    └── page.tsx            ← Dynamic catch-all for all drill levels
```

**Slug parsing:** `[category?, country?, region?, subregion?, appellation?]`
- First segment checked against known categories (`wine`, `spirits`, `beer`, `sake`)
- **If first segment is NOT a known category** (e.g., `/explore/france`), treat it as a country slug with no category filter (default "All" lens). The URL `/explore/france` is equivalent to `/explore/france` with all categories shown.
- Remaining segments matched against taxonomy slugs by walking the parent-child hierarchy
- Invalid slugs → 404 with helpful redirect suggestion

**URL examples without category:**
```
/explore/france                         → France zoomed, all categories
/explore/france/burgundy                → Burgundy zoomed, all categories
```

**Breadcrumb derives from URL** — single source of truth, no state sync needed.

### SEO & Open Graph Meta Tags

Each URL generates dynamic meta tags for shareability and search indexing:

| Route Level | `<title>` | `<meta description>` | OG Image |
|------------|-----------|----------------------|----------|
| `/explore` | "Explore Wine & Spirits by Region — Wine-Now" | "Discover wines, spirits, beer and sake from {N} countries. Browse by region on our interactive world map." | Static branded OG image of the map |
| `/explore/wine` | "Explore Wine Regions of the World — Wine-Now" | "Browse {count} wines from {N} countries. Discover wines by region, grape variety, and style." | Same static image |
| `/explore/wine/france` | "French Wines — Explore {count} Products — Wine-Now" | "Discover {count} French wines from Bordeaux, Burgundy, Champagne and more. Browse by region." | Country-level OG or static |
| `/explore/wine/france/burgundy` | "Burgundy Wines — {count} Products — Wine-Now" | "Explore {count} wines from Burgundy, France. Known for Pinot Noir and Chardonnay." | Region-level OG or static |

- Generated server-side via Next.js `generateMetadata()` in the catch-all route
- Counts pulled from pre-aggregated taxonomy data (no API call needed)

---

## 4. Layout — Responsive Design

### 4.1 Desktop (>=1280px)

```
┌──────────────────────────────────────────────────────────┐
│  Wine │ Spirits │ Beer │ Sake        🔍              ☰   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    FULL-BLEED MAP                         │
│                    (100vw x 100vh)                        │
│                                                          │
│         ┌──────────────┐                                 │
│         │ Region Card   │                                │
│         │ "Explore →"   │                                │
│         └──────────────┘                                 │
│                                                          │
│                         OR (never both simultaneously):  │
│                                                          │
│                                            ┌────────────┐│
│                                            │  SIDEBAR   ││
│                                            │  380px     ││
│                                            │  Products  ││
│                                            │  ◀ Hide    ││
│                                            └────────────┘│
│                                                          │
│  🌍 World › France › Burgundy                    [−] [+] │
└──────────────────────────────────────────────────────────┘
```

**Top bar:** Floating, `backdrop-blur`, transparent background. Contains:
- Category pills (horizontal, scrollable on overflow)
- Search icon (expands to full-width overlay on click)
- Hamburger menu (theme toggle, about, settings)
- **3 interactive elements total** — minimal cognitive load

**Floating region card:** Max-width 340px, glassmorphism (dark scrim 0.85 opacity behind text for readability). Positioned near clicked region. Dismissed by clicking elsewhere, pressing Esc, or clicking "Explore →".

**Product sidebar:** 380px, slides from right with spring animation. Shows only after user clicks "Explore →" on a region card, or clicks a subregion/appellation directly. Toggle button to collapse. **Never shown simultaneously with floating card.**

**Bottom bar:** Floating breadcrumb (left) + zoom controls (right). Always visible.

### 4.2 Tablet (768px – 1279px)

```
┌──────────────────────────────────┐
│ Wine│Spirits│Beer│Sake   🔍  ☰  │
├──────────────────────────────────┤
│                                  │
│           FULL-BLEED MAP         │
│                                  │
│    ┌──────────────┐              │
│    │ Region Card   │             │
│    └──────────────┘              │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ ━━━  BOTTOM PANEL            │ │
│ │ Sort ▾  Filter ▾  42 items   │ │
│ │ ┌─────┐ ┌─────┐ ┌─────┐ →   │ │
│ │ └─────┘ └─────┘ └─────┘     │ │
│ └──────────────────────────────┘ │
│ 🌍 World › France       [−][+]  │
└──────────────────────────────────┘
```

- **No right sidebar** — not enough width. Product catalog lives in a **bottom panel**.
- **2 snap points only:** Peek (100px — shows region name + product count) and Full (85vh — full catalog with filters).
- **Bottom panel has 2 internal tabs** (same as mobile): "Region" (info, description, grapes) and "Products" (catalog with filters). This ensures region info is not lost when the floating card dismisses.
- Floating card still appears on region tap. When panel expands to full, card auto-dismisses and region info is available in the panel's "Region" tab.
- Category pills in top bar — same position as desktop.

### 4.3 Mobile (<768px)

```
┌─────────────────────────┐
│ Wine│Spirits│Beer│Sake  │
│                    🔍 ☰ │
├─────────────────────────┤
│                          │
│      FULL-BLEED MAP      │
│                          │
│                          │
│┌───────────────────────┐│
││ ━━━ drag handle        ││
││ Region | Products      ││
││ ──────────────────     ││
││ 🇫🇷 Burgundy           ││
││ Pinot Noir & Chardonnay││
││ 412 products           ││
│└───────────────────────┘│
│ World › France    [+][-]│
└─────────────────────────┘
```

- **No floating card.** Bottom sheet replaces it entirely.
- **Bottom sheet has 2 internal tabs:** "Region" (info) and "Products" (catalog).
- **2 snap points:** Collapsed (80px — region name peek) and Full (90vh — full catalog).
- **Category pills always at top** — consistent position across all breakpoints.
- **Zoom buttons always visible** — accessibility for motor-impaired users. Bottom-right, small but present.
- **Breadcrumb** in bottom bar, tappable to navigate back. Truncated with "..." for deep paths.
- **No swipe-right for "go back"** — conflicts with map panning. Use breadcrumb taps instead.
- **Search** expands to full-width overlay when tapped.

### 4.4 Interaction Patterns Across Breakpoints

| Action | Desktop | Tablet | Mobile |
|--------|---------|--------|--------|
| Region hover | Compact tooltip (name + count) | N/A (no hover) | N/A |
| Region click/tap | Floating card pins | Floating card + panel peeks | Bottom sheet expands |
| View products | "Explore →" opens sidebar | Panel expands to full | Sheet switches to Products tab |
| Dismiss | Click elsewhere / Esc | Tap map / swipe panel down | Swipe sheet down |
| Drill down | Fly-to animation + breadcrumb | Same | Same |
| Go back | Breadcrumb click / browser back | Same | Breadcrumb tap / browser back |
| Category switch | Pill click, map re-renders | Same | Pill tap, map re-renders |

---

## 5. Interaction Flow by Drill Level

```
WORLD VIEW (default)
  └─► Countries visible as highlighted polygons (active) or muted (no products)
  └─► Hover (desktop only): tooltip with country name + flag + product count
  └─► Product counts reflect selected category lens

COUNTRY click/tap
  └─► Map flies to country zoom level
  └─► Regions appear as styled markers (sized by product count)
  └─► NO floating card — the zoom IS the response
  └─► URL updates: /explore/{category}/{country-slug}
  └─► Breadcrumb updates: World › {Country}

REGION click/tap
  └─► Floating card appears (desktop/tablet)
  └─► Bottom sheet expands (mobile)
  └─► Card content:
      - Region name
      - 1-2 sentence description (from taxonomy or AI-generated)
      - Key grapes/styles for this region
      - Product count + price range
      - 2 product thumbnail previews
      - "Explore Products →" button
  └─► URL updates: /explore/{category}/{country}/{region-slug}

REGION "Explore Products →"
  └─► Card dismisses
  └─► Sidebar slides in (desktop) / panel expands (tablet) / sheet → Products tab (mobile)
  └─► Products fetched from API (paginated, 20/page)
  └─► If subregions exist, map zooms to show them as markers

SUBREGION click/tap
  └─► Sidebar/panel/sheet opens DIRECTLY with products (no card)
  └─► User intent is clear at this depth — skip the intermediary
  └─► URL updates: /explore/{category}/{country}/{region}/{subregion-slug}

APPELLATION click/tap
  └─► Same as subregion — direct to products
  └─► Deepest drill level
  └─► URL: /explore/{category}/{country}/{region}/{subregion}/{appellation-slug}
```

---

## 6. Category Lens System

Categories act as a "lens" on the map, changing what's highlighted and clickable.

| Category | Accent Color | Key Countries | Filter Options |
|----------|-------------|---------------|----------------|
| Wine | Deep Burgundy `#722F37` | France, Italy, Spain, Chile, Argentina, Australia, USA, NZ, etc. | Color, Grape, Body, Style, Price, Vintage |
| Spirits | Amber `#B5651D` | Scotland, Mexico, France (Cognac/Armagnac), USA (Kentucky/Tennessee), Japan, Ireland, etc. | Type (Whisky/Gin/Rum/Tequila/Vodka/Brandy), Age, Price |
| Beer | Golden `#DAA520` | Germany, Thailand, Belgium | Style (IPA/Lager/Stout), Brewery, Price |
| Sake | Jade `#5F8575` | Japan | Grade (Junmai/Daiginjo), Rice Type, Price |
| Default (no lens) | Mixed — color by dominant category | All locations | All filters combined |

**Note on Scotland, England, UK:** The taxonomy treats Scotland (id: 10) and England (id: 8) as top-level "country" entities. This is intentional — Scotch whisky and English sparkling wine are strongly identified with these nations, not "UK." The UK entry (id: 11) exists for products that don't specify Scotland/England. On the map, Scotland and England render as separate clickable regions within the British Isles. This mirrors how the wine/spirits industry categorizes origins.

**Total taxonomy locations:** 51 country-level entities. 4 missing coords (Caribbean, Czech Republic, Norway, "Netherland" duplicate). "Netherland" merges into "Netherlands." Effective: **48 mappable countries** after geocoding the remaining 3.

### Category Lens Behavior
- **Source data:** The `scopes` field in taxonomy already maps each location to categories. No product-level query needed for map rendering.
- **Switching category:** Map re-renders — active countries/regions change, product counts update, accent color changes.
- **Countries with 0 products in selected category:** Muted/grey, non-interactive. Tooltip: "No {category} from {country}".
- **Default view (no category selected):** All countries active, color-coded by dominant category. This is the initial state at `/explore`.

### Non-Beverage Products
- **Accessories (612 products) and Glassware (280 products)** are excluded from the map — no geographic meaning.
- Accessible via search or a menu link ("Shop Accessories"), not via map navigation.

---

## 7. Data Architecture

### 7.1 Two-Phase Loading

**Phase 1 — Instant (static JSON, loaded at build time or on first visit):**
- Taxonomy hierarchy: countries → regions → subregions → appellations
- Coordinates for all locations
- Scopes (category mapping) for each location
- Pre-aggregated product counts per location per category

**Phase 2 — On-Demand (API calls, triggered by user interaction):**
- Product details fetched only when sidebar/panel opens
- Paginated: 20 products per page, lazy-load on scroll
- Filters applied server-side

### 7.2 Static Data Files

**`data/taxonomy/explore-taxonomy.json`** (NEW — single combined file for the map):
```typescript
{
  countries: Array<{
    id: number
    name: string
    slug: string
    latitude: number
    longitude: number
    scopes: string[]          // from taxonomy
    counts: {                 // pre-aggregated
      wine: number
      spirits: number
      beer: number
      sake: number
      total: number
    }
    priceRange: { min: number, max: number }
  }>
  regions: Array<{
    id: number
    name: string
    slug: string
    latitude: number
    longitude: number
    parentId: number          // country id
    parentSlug: string
    scopes: string[]
    counts: { wine, spirits, beer, sake, total }
    priceRange: { min, max }
    description?: string      // 1-2 sentences
    keyGrapes?: string[]
    keyStyles?: string[]
  }>
  subregions: Array<{
    id: number
    name: string
    slug: string
    latitude: number
    longitude: number
    parentId: number          // region id
    parentSlug: string        // region slug (for URL building)
    grandparentId: number     // country id
    grandparentSlug: string   // country slug (for URL building)
    scopes: string[]
    counts: { wine: number, spirits: number, beer: number, sake: number, total: number }
    priceRange: { min: number, max: number }
  }>
  appellations: Array<{
    id: number
    name: string
    slug: string
    latitude: number
    longitude: number
    parentId: number          // subregion id
    parentSlug: string
    regionId: number          // region id (for breadcrumb)
    regionSlug: string
    countryId: number         // country id
    countrySlug: string
    scopes: string[]
    counts: { wine: number, spirits: number, beer: number, sake: number, total: number }
    priceRange: { min: number, max: number }
  }>
}
```

This file is generated by a build script that:
1. Reads the full taxonomy with coordinates
2. Queries product counts by location × category
3. Aggregates price ranges
4. Outputs a single JSON (~200KB estimated)

### 7.3 API Endpoints

**Existing (reuse):**
- `GET /api/products?country=France&region=Burgundy&classification=Red Wine&page=1&limit=20`
- `GET /api/map-data` (may need enhancement)

**New or enhanced:**
- `GET /api/explore/products?slug=burgundy&category=wine&sort=popular&page=1&limit=20`
  - Returns paginated product list for a given location + category
  - Includes: name, brand, grape_variety, vintage, price, classification, wine_color, image_url
  - Sort options: popular (default), price-asc, price-desc, newest, name
- `GET /api/explore/counts` (optional — can be pre-computed in static JSON)

### 7.4 Coordinate Gap Fill

Current state from taxonomy data:
- **Countries:** 4 missing coords (Caribbean, Czech Republic, Norway, Netherland)
- **Regions:** ~46 missing coords
- **Subregions:** ALL 80 missing coords
- **Appellations:** ALL 81 missing coords

**Resolution:** Build a one-time geocoding script (`scripts/fill-explore-coordinates.ts`) that:
1. Uses a geocoding service (Mapbox Geocoding API — free tier: 100K requests/month) to resolve location names to coordinates
2. Context-aware: passes parent region/country name for disambiguation (e.g., "Margaux" → "Margaux, Bordeaux, France")
3. Outputs to `data/taxonomy/coordinates-enriched.json`
4. Manual review pass for accuracy
5. Store final coordinates in the explore-taxonomy.json

### 7.5 Duplicate Resolution Strategy

9 confirmed duplicate region pairs:

| Keep (canonical) | Merge into it | Rationale |
|-----------------|---------------|-----------|
| Barossa Valley | Barossa | "Barossa Valley" is the official GI name |
| Casablanca Valley | Casablanca | Official name |
| Clare Valley | Clare | Official name |
| Colchagua Valley | Colchagua | Official name |
| Friuli-Venezia Giulia | Friuli | Official region name |
| Loire Valley | Loire, Loire valley | Normalize casing + merge |
| Maipo Valley | Maipo | Official name |
| Rhone Valley | Rhone | Official name |
| Sonoma County | Sonoma | Official county name |

**Implementation:** Merge duplicate IDs in the explore-taxonomy builder script. Products tagged with either ID map to the canonical entry. The non-canonical slug redirects to canonical (301).

### 7.6 Non-Geographic Entries

| Entry | Handling |
|-------|---------|
| "Multi-Regional" (Australia) | Show products at country level, no map marker |
| "Others region" (Spain) | Show products at country level, no map marker |
| "Multi-Appellation California" | Show products under California region |
| "South Eastern Australia" | Show products at country level |
| "Caribbean" (country) | Place marker at centroid [15.5, -75.0], treat as region grouping |

---

## 8. Map Implementation

### 8.1 Map Style
Custom Mapbox style — dark, desaturated base:
- Terrain: `#1a1a2e` to `#16213e` gradient
- Water: `#0a0a1a`
- Country borders: `#2a2a3e` (subtle)
- Labels: minimal, light grey, only major features
- No road network, no POIs — clean canvas

### 8.2 Map Layers

| Layer | Type | Zoom Level | Data Source |
|-------|------|-----------|-------------|
| Country polygons (fill) | GeoJSON fill | 0–4 | Natural Earth GeoJSON (~800KB, gzipped ~250KB) |
| Country borders | GeoJSON line | 0–6 | Same source |
| Region markers | Circle/symbol | 4–8 | explore-taxonomy.json |
| Subregion markers | Circle/symbol | 8–12 | explore-taxonomy.json |
| Appellation markers | Circle/symbol | 12+ | explore-taxonomy.json |

### 8.3 Marker Styling
- **Circle size:** Scaled by product count (min 8px, max 40px) using `interpolate` expression
- **Circle color:** Category accent color with 0.7 opacity
- **Circle border:** 2px white at 0.3 opacity
- **Hover state:** Scale up 1.2x, border brightens to 0.8 opacity
- **Active state (selected):** Pulse animation, full opacity
- **Inactive (0 products in current lens):** Grey, 0.2 opacity, non-interactive

### 8.4 Animations
- **Fly-to on drill-down:** `map.flyTo({ center, zoom, duration: 1500, curve: 1.42 })`
- **Fly-out on breadcrumb "back":** Same but reverse, slightly faster (1200ms)
- **Marker enter/exit:** Fade + scale spring animation on zoom level changes
- **Respect `prefers-reduced-motion`:** Instant transitions (duration: 0) when enabled

### 8.5 Country Boundaries
- Source: Natural Earth 110m Admin 0 countries (free, public domain)
- Stored as GeoJSON (~800KB raw, ~250KB gzipped). Mapbox GL JS natively supports GeoJSON but NOT TopoJSON — no conversion library needed.
- Used for fill layer at world zoom — countries colored by category accent when active, muted grey when inactive
- At region zoom level, country fill fades to outline-only so markers are prominent

---

## 9. Floating Region Card

### Content Structure (Desktop/Tablet)
```
┌──────────────────────────────┐
│  🇫🇷  Burgundy               │  ← Flag (from country ISO) + name
│  France · Wine               │  ← Parent + category badge
│──────────────────────────────│
│  Known for Pinot Noir and    │  ← 1-2 sentence description
│  Chardonnay. The birthplace  │
│  of terroir-driven winemaking│
│──────────────────────────────│
│  Pinot Noir · Chardonnay     │  ← Key grapes/styles (chips)
│  Gamay                       │
│──────────────────────────────│
│  412 products · ฿850–฿45,000│  ← Count + price range (THB)
│──────────────────────────────│
│  ┌──────┐  ┌──────┐         │  ← 2 product thumbnails
│  │ img  │  │ img  │         │
│  │ Name │  │ Name │         │
│  │฿1,850│  │฿3,200│         │
│  └──────┘  └──────┘         │
│──────────────────────────────│
│        Explore Products →    │  ← CTA button
└──────────────────────────────┘
```

### Visual Treatment
- **Background:** `rgba(10, 10, 26, 0.88)` with `backdrop-filter: blur(20px)` on desktop/tablet. **On mobile (<768px): solid background `#12121f`** (no blur) to avoid WebGL + blur jank on lower-end Thai-market devices.
- **Border:** 1px `rgba(255, 255, 255, 0.08)`
- **Border-radius:** 16px
- **Shadow:** `0 8px 32px rgba(0, 0, 0, 0.5)`
- **Text:** White primary, `rgba(255, 255, 255, 0.6)` secondary
- **Solid fallback behind text** — dark scrim ensures readability regardless of map background

### Behavior
- **Desktop:** Positioned near clicked marker (offset to avoid covering it). Constrained within viewport bounds.
- **Tablet:** Same positioning, max-width 300px.
- **Mobile:** No floating card — content appears in bottom sheet "Region" tab.
- **Dismiss:** Click outside / Esc / click another region / click "Explore →".

---

## 10. Product Sidebar / Panel

### Desktop Sidebar (380px, right side)

```
┌──────────────────────┐
│ ◀ Burgundy · Wine    │  ← Back arrow (hides sidebar) + context
│ 412 products         │
│──────────────────────│
│ Sort: Popular ▾      │  ← Sort dropdown
│ 🔽 Filters           │  ← Expandable filter section
│──────────────────────│
│ ┌──────────────────┐ │
│ │ 🖼  Product Name  │ │  ← Product card
│ │     Pinot Noir    │ │     Image or category placeholder
│ │     2020 · ฿1,850 │ │     Grape, vintage, price (THB)
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ 🖼  Product Name  │ │
│ │     Chardonnay    │ │
│ │     2019 · ฿2,400 │ │
│ └──────────────────┘ │
│         ...          │
│ Showing 20 of 412    │  ← Lazy load on scroll
└──────────────────────┘
```

### Tablet/Mobile Bottom Panel
- Same content as sidebar, laid out vertically
- Product cards: horizontal scroll at peek state, vertical list at full state
- Filters: collapsible accordion

### Contextual Filters by Category

| Wine | Spirits | Beer | Sake |
|------|---------|------|------|
| Color (Red/White/Rose/Sparkling/Champagne) | Type (Whisky/Gin/Rum/Tequila/Vodka/Brandy/Liqueur) | Style (IPA/Lager/Stout/Ale) | Grade (Junmai/Daiginjo/Honjozo) |
| Grape variety | Age statement | Brewery | Rice type |
| Body (Light/Medium/Full) | — | — | — |
| Price range (slider) | Price range (slider) | Price range (slider) | Price range (slider) |
| Vintage | — | — | — |

### Sort Options
- Popular (default — sort by `enrichment_priority` field DESC; products without this field sort last, then by `price` DESC as tiebreaker)
- Price: Low → High
- Price: High → Low
- Newest (vintage or addition date)
- Name A–Z

### Product Card Data
```typescript
{
  name: string
  brand: string
  classification: string
  grape_variety?: string
  vintage?: string
  price: number              // THB
  wine_color?: string
  image_url?: string         // from image library (phase 2)
  country: string
  region: string
  desc_en_short?: string
}
```

### Virtual Scrolling
- Render 20 products initially
- Lazy-load next 20 on scroll (intersection observer)
- "Showing 20 of 412" counter updates as user scrolls
- Skeleton cards while loading

---

## 11. Empty States & Smart Redirects

| Scenario | UI Response |
|----------|------------|
| Category + country = 0 products | Card: "No {category} from {country}. Explore {suggested country} for {category} →" with map arrow |
| Region with < 3 products | Show products inline in the region card — no sidebar needed |
| Category has 0 products globally | "Coming soon — we're expanding our {category} collection" |
| Country has products but no regions | Show products at country level directly in sidebar, skip drill-down |
| Non-geographic product (Accessories) | Excluded from map. Accessible via search or menu link |
| Invalid URL slug | 404 page with: "We couldn't find that region. Did you mean {closest match}?" + link to `/explore` |

### Smart Suggestions Logic
When a dead end is hit, suggest the nearest country/region with products in the selected category. Precompute this mapping from the explore-taxonomy.json.

### Error States (API Failures)

| Scenario | UI Response |
|----------|------------|
| Product API request fails (network/500) | Sidebar shows: "Couldn't load products. [Retry]" button. Map remains functional. |
| Product API timeout (>5s) | Same retry UI. Do not block map interaction. |
| Taxonomy JSON fails to load | Show static SVG world map fallback with country list (text-based navigation). |
| Mapbox tiles fail to load | Map canvas shows dark background. Marker overlay still renders from local data. Toast: "Map tiles loading slowly — you can still browse regions." |
| Mapbox GL not supported (no WebGL) | Full graceful degradation: static SVG map with clickable country regions + text-based region list. |

**Principle:** The map and taxonomy are independent of the product API. A product API failure should never break map navigation. The sidebar/panel is the only surface that depends on the API.

---

## 12. Search (v1: Region-Only)

### Behavior
- **Trigger:** Click search icon → full-width overlay with autofocus input
- **Scope (v1):** Regions and countries only. Product search deferred to v2.
- **Results:** Grouped dropdown: Countries, then Regions, then Subregions
- **Each result shows:** Name, parent (e.g., "Burgundy — France"), product count
- **Selection:** Map flies to that location, URL updates, card/sidebar opens
- **Keyboard:** Arrow keys to navigate, Enter to select, Esc to close
- **Debounced:** 200ms debounce on input for filtering

### Disambiguation
"Champagne" matches both a region and a classification. V1: show the region result. V2: show grouped results with type labels.

---

## 13. Image Library Strategy

> **Scope note:** The full scraping pipeline (automated Magento scraping, WebP conversion, 3-size generation) is **v2**. For **v1**, use category-based placeholder images (see "Placeholder Images" below). The naming convention and storage structure below are designed now so v2 slots in without migration.

### Pipeline (v2)
Scrape product images from Magento product feed → optimize → store with SEO/AEO-friendly filenames.

### Filename Convention (English-first)
```
{brand}-{product-name}-{grape-or-type}-{region}-{vintage}.{ext}

Examples:
opus-one-cabernet-sauvignon-napa-valley-2019.webp
glenfiddich-18-year-single-malt-speyside.webp
asahi-super-dry-premium-lager-japan.webp
dassai-23-junmai-daiginjo-yamaguchi.webp
```

### Rules
- All lowercase, hyphens as word separators
- Strip special characters, transliterate non-ASCII (e.g., Chateau → chateau, Cote → cote)
- **Primary format:** WebP (fallback to JPG for older browsers)
- **3 sizes per product:** thumbnail (200px), card (400px), full (800px)
- **Alt text auto-generated:** `"{Brand} {Product Name} — {Grape/Type} from {Region}"`
- **Storage:** `/public/images/products/{country-slug}/{region-slug}/`
- **Phase 1:** Scrape from Magento feed URLs
- **Phase 2:** Supplement from brand websites where Magento images are missing
- **Deduplication:** Hash-based — don't re-download existing images on re-scrape

### Placeholder Images (until library is built)
Category-based silhouette illustrations on dark background:
- Wine bottle silhouette (red/white/rose variants)
- Whisky bottle silhouette
- Beer bottle/can silhouette
- Sake bottle silhouette
- Generic bottle for uncategorized

---

## 14. First-Visit Onboarding (v1)

### Implementation
- 3 key locations (France, Italy, Scotland — treated as top-level entities in taxonomy) get a subtle CSS pulse animation on their markers
- Toast notification at bottom-center: "Tap a country to start exploring"
- Auto-dismiss after 5 seconds or on first map interaction
- Stored in `localStorage('explore-onboarding-seen')` — never shows again

---

## 15. Accessibility

| Requirement | Implementation |
|------------|----------------|
| Color contrast | WCAG AA (4.5:1 text, 3:1 UI). Solid dark scrim behind all text on glassmorphism surfaces |
| Touch targets | Minimum 44x44px on all interactive elements |
| Keyboard navigation | Tab through regions, Enter to select, Esc to dismiss cards/sidebar |
| Screen reader | ARIA labels on map regions: "{Region name}, {count} products". aria-live for drill-down announcements |
| Reduced motion | `prefers-reduced-motion`: instant transitions, no fly-to, no pulse animations |
| Zoom buttons | Always visible on all breakpoints (including mobile) |
| Focus indicators | Visible focus ring on all interactive elements |
| Colorblind support | Pattern fills (subtle diagonal lines) on active regions in high-contrast mode |

---

## 16. Performance

| Concern | Mitigation |
|---------|-----------|
| Mapbox GL bundle (~200KB) | Dynamic import, loaded after initial paint. Show skeleton while loading. |
| Natural Earth GeoJSON (~800KB, ~250KB gzipped) | Cached aggressively (immutable asset hash). Loaded on first visit, service worker cached. |
| explore-taxonomy.json (~200KB) | Loaded at build time for SSG, or cached on first visit. |
| Product API for large regions (France: 2,753) | Never load all. Paginate 20/page, virtual scroll. API response < 5KB per page. |
| Map tile loading on slow connections | Skeleton: dark gradient animation matching map theme. Category pills + breadcrumb render instantly. |
| Markers at country level (51 countries) | Lightweight — 51 circles, no performance concern. |
| Markers at region level (99 regions) | Still fine — under 100 SVG circles. |

### Loading Sequence (on 4G / Thailand average)
1. **Instant:** HTML shell, top bar, breadcrumb, dark background (SSR)
2. **~300ms:** Taxonomy JSON parsed, marker data ready
3. **~1.5s:** Mapbox GL JS loaded + WebGL shader compilation begins
4. **~2.5-3.5s:** Map tiles rendered with country polygons + markers (LCP)
5. **~4-5s:** Full interactivity (TTI) — all event handlers bound

On fast WiFi, steps 3-5 compress to ~1.5s total. The skeleton (dark gradient + pre-rendered category pills) ensures the page never feels blank.

---

## 17. Component Architecture

```
app/explore/
├── layout.tsx                        ← Immersive layout (no dashboard nav)
├── page.tsx                          ← /explore (world view)
└── [...slug]/
    └── page.tsx                      ← Dynamic catch-all

components/explore/
├── ExploreMap.tsx                    ← Mapbox GL wrapper, layers, interactions
├── CategoryLens.tsx                  ← Wine|Spirits|Beer|Sake pills
├── RegionCard.tsx                    ← Floating glassmorphism info card
├── ProductSidebar.tsx                ← Right sidebar (desktop)
├── BottomPanel.tsx                   ← Bottom panel (tablet/mobile)
├── ProductCard.tsx                   ← Individual product card
├── ProductFilters.tsx                ← Contextual filter controls
├── Breadcrumb.tsx                    ← Drill-down path navigation
├── SearchOverlay.tsx                 ← Full-width search (v1: regions only)
├── EmptyState.tsx                    ← Smart redirects for 0-product combos
├── MapSkeleton.tsx                   ← Loading animation
├── OnboardingHint.tsx                ← First-visit pulse + toast
└── ZoomControls.tsx                  ← +/- buttons, always visible

lib/explore/
├── map-config.ts                     ← Mapbox token, style URL, initial viewport
├── map-style.ts                      ← Custom dark map style definition
├── use-map-navigation.ts             ← Hook: URL ↔ map state sync
├── use-explore-data.ts               ← Hook: taxonomy data + product fetching
├── use-bottom-sheet.ts               ← Hook: snap points, drag gestures
├── taxonomy-utils.ts                 ← Slug lookup, hierarchy traversal, search
├── category-config.ts                ← Category colors, filter definitions, labels
└── types.ts                          ← TypeScript interfaces for explore feature

app/api/explore/
├── products/route.ts                 ← Paginated products by location + category
└── (reuses existing product query logic from lib/)
```

---

## 18. Color System

### Dark Theme (Default — v1 only, light mode deferred to v2)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-map` | `#0a0a1a` | Map water, loading background |
| `--bg-surface` | `rgba(10, 10, 26, 0.88)` | Cards, sidebar, panels |
| `--bg-surface-solid` | `#12121f` | Sidebar background (no transparency) |
| `--text-primary` | `#ffffff` | Headings, product names |
| `--text-secondary` | `rgba(255,255,255,0.6)` | Descriptions, metadata |
| `--text-muted` | `rgba(255,255,255,0.35)` | Disabled, inactive |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `--border-hover` | `rgba(255,255,255,0.15)` | Hover state borders |
| `--accent-wine` | `#722F37` | Wine category markers + UI |
| `--accent-spirits` | `#B5651D` | Spirits category |
| `--accent-beer` | `#DAA520` | Beer category |
| `--accent-sake` | `#5F8575` | Sake category |
| `--accent-default` | `#4A90D9` | No category selected |

---

## 19. v1 Scope vs v2 Deferred

### v1 (Build Now)
- [x] World map with Mapbox GL, dark theme
- [x] Category lens (Wine/Spirits/Beer/Sake)
- [x] Drill-down: Country → Region → Subregion → Appellation
- [x] Floating region cards with glassmorphism
- [x] Product sidebar (desktop) / bottom panel (tablet/mobile)
- [x] URL-driven state (shareable links)
- [x] Breadcrumb navigation
- [x] Search: region/country only
- [x] Empty states with smart redirects
- [x] Dark mode only
- [x] Responsive: desktop, tablet, mobile
- [x] Accessibility: WCAG AA
- [x] First-visit onboarding hint
- [x] Category placeholder images
- [x] Coordinate gap fill (geocoding script)
- [x] Duplicate region merge
- [x] Pre-aggregated taxonomy JSON

### v2 (Deferred)
- [ ] Light mode toggle
- [ ] Search: product name + grape search
- [ ] Image library scraping pipeline from Magento
- [ ] Grape/style multi-region highlight ("Show all Pinot Noir regions")
- [ ] Animated onboarding pulse (v1 uses simpler CSS)
- [ ] Region description AI generation (v1 uses manual/blank)
- [ ] Product ratings/reviews display
- [ ] "Compare regions" feature
- [ ] Favoriting / save for later
- [ ] i18n (Thai language support)

---

## 20. Data Quality Pre-work (Before Implementation)

These must be completed before building the map:

1. **Coordinate gap fill** — geocode ~207 missing coordinates (46 regions + 80 subregions + 81 appellations)
2. **Duplicate merge** — resolve 9 region pairs, create canonical slug redirects
3. **Non-geographic entry handling** — flag "Multi-Regional", "Others region" etc. in taxonomy
4. **Product count aggregation** — build script to count products per location per category
5. **Country boundary data** — download Natural Earth 110m Admin 0 as GeoJSON
6. **Mapbox account setup** — create account, get API token, design custom dark style

---

*End of specification.*
