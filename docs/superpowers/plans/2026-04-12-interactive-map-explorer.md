# Interactive Map Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an immersive, consumer-facing interactive world map at `/explore` for discovering wine, spirits, beer, and sake by geographic origin, powered by the existing PIM engine.

**Architecture:** Next.js 14 catch-all route (`/explore/[...slug]`) with Mapbox GL JS via `react-map-gl` rendering a dark-themed world map. URL-driven state for shareability. Two-phase data loading: static taxonomy JSON for instant map render, on-demand API calls for product details. Responsive layout with floating cards (desktop/tablet) and bottom sheet (mobile).

**Tech Stack:** Next.js 14, React 18, Mapbox GL JS, react-map-gl, Tailwind CSS, Lucide React, Supabase (existing product API)

**Spec:** `docs/superpowers/specs/2026-04-12-interactive-map-explorer-design.md`

---

## File Structure

### New Files

```
lib/explore/
├── types.ts                     ← All TypeScript interfaces for the explore feature
├── category-config.ts           ← Category colors, labels, filter definitions, scope mappings
├── taxonomy-utils.ts            ← Slug lookup, hierarchy traversal, search filtering
├── map-config.ts                ← Mapbox token, initial viewport, zoom level thresholds
├── map-style.ts                 ← Custom dark map style JSON for Mapbox
├── use-map-navigation.ts        ← Hook: URL ↔ map state sync (fly-to, breadcrumb)
├── use-explore-data.ts          ← Hook: load taxonomy, fetch products on-demand
└── use-bottom-sheet.ts          ← Hook: snap points, drag gestures for mobile/tablet

components/explore/
├── ExploreMap.tsx               ← Mapbox GL map wrapper with layers and click handlers
├── CategoryLens.tsx             ← Category pill tabs (Wine|Spirits|Beer|Sake)
├── RegionCard.tsx               ← Floating glassmorphism info card
├── ProductSidebar.tsx           ← Right sidebar for desktop (380px)
├── BottomPanel.tsx              ← Bottom panel for tablet/mobile with snap points
├── ProductCard.tsx              ← Individual product card in sidebar/panel
├── ProductFilters.tsx           ← Contextual filter controls by category
├── Breadcrumb.tsx               ← Drill-down path navigation
├── SearchOverlay.tsx            ← Full-width search overlay (v1: regions only)
├── EmptyState.tsx               ← Smart redirect for 0-product scenarios
├── MapSkeleton.tsx              ← Dark gradient loading animation
├── OnboardingHint.tsx           ← First-visit toast + pulse markers
└── ZoomControls.tsx             ← +/- buttons, always visible

app/explore/
├── layout.tsx                   ← Immersive full-screen layout (no dashboard nav)
├── page.tsx                     ← /explore default (redirects to catch-all)
└── [...slug]/
    └── page.tsx                 ← Dynamic catch-all route with generateMetadata

app/api/explore/
└── products/route.ts            ← Paginated products by location slug + category

scripts/
├── fill-explore-coordinates.ts  ← One-time geocoding for missing coords
└── build-explore-taxonomy.ts    ← Aggregates taxonomy + counts into explore-taxonomy.json

data/taxonomy/
└── explore-taxonomy.json        ← Pre-aggregated combined taxonomy for the map

public/
├── countries-110m.geojson       ← Natural Earth country boundaries
└── images/placeholders/         ← Category placeholder SVGs
    ├── wine-red.svg
    ├── wine-white.svg
    ├── wine-rose.svg
    ├── spirits.svg
    ├── beer.svg
    ├── sake.svg
    └── bottle-generic.svg
```

### Modified Files

```
package.json                     ← Add react-map-gl, mapbox-gl dependencies
tailwind.config.ts               ← Add explore color tokens
.env.local                       ← Add NEXT_PUBLIC_MAPBOX_TOKEN
```

---

## Task 1: Install Dependencies & Config

**Files:**
- Modify: `package.json`
- Modify: `tailwind.config.ts`
- Modify: `.env.local`

- [ ] **Step 1: Install Mapbox dependencies**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
npm install react-map-gl mapbox-gl
npm install --save-dev @types/mapbox-gl
```

- [ ] **Step 2: Add Mapbox token to .env.local**

Add to `.env.local`:
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_token_here
```

Note: Developer must create a Mapbox account at mapbox.com and generate a public access token. Restrict the token to `localhost` and production URLs (`th.wine-now.com`, `th.liq9.com`).

- [ ] **Step 3: Add explore color tokens to Tailwind config**

In `tailwind.config.ts`, extend the `colors` object inside `theme.extend`:

```typescript
explore: {
  bg: '#0a0a1a',
  surface: '#12121f',
  wine: '#722F37',
  spirits: '#B5651D',
  beer: '#DAA520',
  sake: '#5F8575',
  default: '#4A90D9',
  border: 'rgba(255,255,255,0.08)',
  'border-hover': 'rgba(255,255,255,0.15)',
  'text-secondary': 'rgba(255,255,255,0.6)',
  'text-muted': 'rgba(255,255,255,0.35)',
},
```

- [ ] **Step 4: Verify the build still compiles**

Run:
```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts .env.local
git commit -m "chore: add mapbox dependencies and explore color tokens"
```

---

## Task 2: TypeScript Types & Category Config

**Files:**
- Create: `lib/explore/types.ts`
- Create: `lib/explore/category-config.ts`

- [ ] **Step 1: Create types file**

Create `lib/explore/types.ts`:

```typescript
// === Taxonomy Types ===

export interface CategoryCounts {
  wine: number
  spirits: number
  beer: number
  sake: number
  total: number
}

export interface PriceRange {
  min: number
  max: number
}

export interface TaxonomyCountry {
  id: number
  name: string
  slug: string
  latitude: number | null
  longitude: number | null
  scopes: string[]
  counts: CategoryCounts
  priceRange: PriceRange
}

export interface TaxonomyRegion {
  id: number
  name: string
  slug: string
  latitude: number | null
  longitude: number | null
  parentId: number
  parentSlug: string
  scopes: string[]
  counts: CategoryCounts
  priceRange: PriceRange
  description?: string
  keyGrapes?: string[]
  keyStyles?: string[]
}

export interface TaxonomySubregion {
  id: number
  name: string
  slug: string
  latitude: number | null
  longitude: number | null
  parentId: number
  parentSlug: string
  grandparentId: number
  grandparentSlug: string
  scopes: string[]
  counts: CategoryCounts
  priceRange: PriceRange
}

export interface TaxonomyAppellation {
  id: number
  name: string
  slug: string
  latitude: number | null
  longitude: number | null
  parentId: number
  parentSlug: string
  regionId: number
  regionSlug: string
  countryId: number
  countrySlug: string
  scopes: string[]
  counts: CategoryCounts
  priceRange: PriceRange
}

export interface ExploreTaxonomy {
  countries: TaxonomyCountry[]
  regions: TaxonomyRegion[]
  subregions: TaxonomySubregion[]
  appellations: TaxonomyAppellation[]
}

// === Category Types ===

export type CategoryKey = 'wine' | 'spirits' | 'beer' | 'sake'

export interface CategoryConfig {
  key: CategoryKey
  label: string
  color: string
  tailwindColor: string
  filters: FilterDefinition[]
}

export interface FilterDefinition {
  key: string
  label: string
  type: 'select' | 'range' | 'multi-select'
  options?: string[]
}

// === Map State Types ===

export type DrillLevel = 'world' | 'country' | 'region' | 'subregion' | 'appellation'

export interface MapState {
  category: CategoryKey | null
  countrySlug: string | null
  regionSlug: string | null
  subregionSlug: string | null
  appellationSlug: string | null
  drillLevel: DrillLevel
}

export interface BreadcrumbItem {
  label: string
  slug: string
  href: string
}

// === Product Types ===

export interface ExploreProduct {
  id: number
  name: string
  brand: string
  classification: string
  grape_variety?: string
  vintage?: string
  price: number
  wine_color?: string
  image_url?: string
  country: string
  region: string
  subregion?: string
  desc_en_short?: string
}

export interface ProductsResponse {
  products: ExploreProduct[]
  total: number
  page: number
  limit: number
}

// === UI State Types ===

export type SidebarState = 'hidden' | 'visible'
export type BottomSheetState = 'collapsed' | 'full'
export type BottomSheetTab = 'region' | 'products'

export interface RegionCardData {
  name: string
  parentName: string
  slug: string
  description?: string
  keyGrapes?: string[]
  keyStyles?: string[]
  counts: CategoryCounts
  priceRange: PriceRange
  previewProducts?: ExploreProduct[]
  position: { x: number; y: number }
}
```

- [ ] **Step 2: Create category config**

Create `lib/explore/category-config.ts`:

```typescript
import { CategoryConfig, CategoryKey, FilterDefinition } from './types'

const wineFilters: FilterDefinition[] = [
  { key: 'wine_color', label: 'Color', type: 'multi-select', options: ['Red', 'White', 'Rosé', 'Sparkling', 'Champagne'] },
  { key: 'grape_variety', label: 'Grape', type: 'multi-select' },
  { key: 'wine_body', label: 'Body', type: 'select', options: ['Light', 'Medium', 'Full'] },
  { key: 'price', label: 'Price', type: 'range' },
  { key: 'vintage', label: 'Vintage', type: 'select' },
]

const spiritsFilters: FilterDefinition[] = [
  { key: 'classification', label: 'Type', type: 'multi-select', options: ['Whisky', 'Gin', 'Rum', 'Tequila', 'Vodka', 'Brandy', 'Liqueur'] },
  { key: 'price', label: 'Price', type: 'range' },
]

const beerFilters: FilterDefinition[] = [
  { key: 'style', label: 'Style', type: 'multi-select', options: ['IPA', 'Lager', 'Stout', 'Ale'] },
  { key: 'price', label: 'Price', type: 'range' },
]

const sakeFilters: FilterDefinition[] = [
  { key: 'classification', label: 'Grade', type: 'multi-select', options: ['Junmai', 'Daiginjo', 'Honjozo'] },
  { key: 'price', label: 'Price', type: 'range' },
]

export const CATEGORIES: Record<CategoryKey, CategoryConfig> = {
  wine: { key: 'wine', label: 'Wine', color: '#722F37', tailwindColor: 'explore-wine', filters: wineFilters },
  spirits: { key: 'spirits', label: 'Spirits', color: '#B5651D', tailwindColor: 'explore-spirits', filters: spiritsFilters },
  beer: { key: 'beer', label: 'Beer', color: '#DAA520', tailwindColor: 'explore-beer', filters: beerFilters },
  sake: { key: 'sake', label: 'Sake', color: '#5F8575', tailwindColor: 'explore-sake', filters: sakeFilters },
}

export const CATEGORY_KEYS: CategoryKey[] = ['wine', 'spirits', 'beer', 'sake']

export const DEFAULT_ACCENT = '#4A90D9'

export function isValidCategory(s: string): s is CategoryKey {
  return CATEGORY_KEYS.includes(s as CategoryKey)
}

export function getCategoryColor(category: CategoryKey | null): string {
  return category ? CATEGORIES[category].color : DEFAULT_ACCENT
}

/** Maps product classifications to category keys for filtering */
export const CLASSIFICATION_TO_CATEGORY: Record<string, CategoryKey> = {
  'Red Wine': 'wine',
  'White Wine': 'wine',
  'Rosé Wine': 'wine',
  'Rose Wine': 'wine',
  'Sparkling Wine': 'wine',
  'Champagne': 'wine',
  'Whisky': 'spirits',
  'Gin': 'spirits',
  'Rum': 'spirits',
  'Tequila': 'spirits',
  'Vodka': 'spirits',
  'Brandy': 'spirits',
  'Liqueur': 'spirits',
  'Cognac': 'spirits',
  'Beer': 'beer',
  'Sake/Shochu': 'sake',
}
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/explore/types.ts lib/explore/category-config.ts
git commit -m "feat(explore): add TypeScript types and category configuration"
```

---

## Task 3: Taxonomy Utils & Data Helpers

**Files:**
- Create: `lib/explore/taxonomy-utils.ts`

- [ ] **Step 1: Create taxonomy utilities**

Create `lib/explore/taxonomy-utils.ts`:

```typescript
import { ExploreTaxonomy, TaxonomyCountry, TaxonomyRegion, TaxonomySubregion, TaxonomyAppellation, MapState, BreadcrumbItem, CategoryKey, DrillLevel } from './types'
import { isValidCategory } from './category-config'

/**
 * Parse URL slug segments into MapState.
 * Patterns:
 *   []                                    → world, no category
 *   ['wine']                              → world, wine lens
 *   ['france']                            → country, no category
 *   ['wine', 'france']                    → country, wine lens
 *   ['wine', 'france', 'burgundy']        → region, wine lens
 *   ['wine', 'france', 'burgundy', 'chablis'] → subregion, wine lens
 *   ['wine', 'france', 'burgundy', 'chablis', 'chablis-premier-cru'] → appellation
 */
export function parseSlug(segments: string[], taxonomy: ExploreTaxonomy): MapState {
  const state: MapState = {
    category: null,
    countrySlug: null,
    regionSlug: null,
    subregionSlug: null,
    appellationSlug: null,
    drillLevel: 'world',
  }

  if (segments.length === 0) return state

  let idx = 0

  // Check if first segment is a category
  if (isValidCategory(segments[0])) {
    state.category = segments[0] as CategoryKey
    idx = 1
  }

  // Country
  if (idx < segments.length) {
    const country = taxonomy.countries.find(c => c.slug === segments[idx])
    if (country) {
      state.countrySlug = country.slug
      state.drillLevel = 'country'
      idx++
    } else {
      return state // invalid slug — stay at world
    }
  }

  // Region
  if (idx < segments.length) {
    const region = taxonomy.regions.find(
      r => r.slug === segments[idx] && r.parentSlug === state.countrySlug
    )
    if (region) {
      state.regionSlug = region.slug
      state.drillLevel = 'region'
      idx++
    } else {
      return state
    }
  }

  // Subregion
  if (idx < segments.length) {
    const subregion = taxonomy.subregions.find(
      s => s.slug === segments[idx] && s.parentSlug === state.regionSlug
    )
    if (subregion) {
      state.subregionSlug = subregion.slug
      state.drillLevel = 'subregion'
      idx++
    } else {
      return state
    }
  }

  // Appellation
  if (idx < segments.length) {
    const appellation = taxonomy.appellations.find(
      a => a.slug === segments[idx] && a.parentSlug === state.subregionSlug
    )
    if (appellation) {
      state.appellationSlug = appellation.slug
      state.drillLevel = 'appellation'
    }
  }

  return state
}

/** Build the URL path from a MapState */
export function buildExplorePath(state: MapState): string {
  const parts: string[] = ['/explore']
  if (state.category) parts.push(state.category)
  if (state.countrySlug) parts.push(state.countrySlug)
  if (state.regionSlug) parts.push(state.regionSlug)
  if (state.subregionSlug) parts.push(state.subregionSlug)
  if (state.appellationSlug) parts.push(state.appellationSlug)
  return parts.join('/')
}

/** Build breadcrumb items from MapState */
export function buildBreadcrumbs(state: MapState, taxonomy: ExploreTaxonomy): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ label: 'World', slug: '', href: state.category ? `/explore/${state.category}` : '/explore' }]
  const catPrefix = state.category ? `/${state.category}` : ''

  if (state.countrySlug) {
    const country = taxonomy.countries.find(c => c.slug === state.countrySlug)
    if (country) items.push({ label: country.name, slug: country.slug, href: `/explore${catPrefix}/${country.slug}` })
  }

  if (state.regionSlug) {
    const region = taxonomy.regions.find(r => r.slug === state.regionSlug)
    if (region) items.push({ label: region.name, slug: region.slug, href: `/explore${catPrefix}/${state.countrySlug}/${region.slug}` })
  }

  if (state.subregionSlug) {
    const sub = taxonomy.subregions.find(s => s.slug === state.subregionSlug)
    if (sub) items.push({ label: sub.name, slug: sub.slug, href: `/explore${catPrefix}/${state.countrySlug}/${state.regionSlug}/${sub.slug}` })
  }

  if (state.appellationSlug) {
    const app = taxonomy.appellations.find(a => a.slug === state.appellationSlug)
    if (app) items.push({ label: app.name, slug: app.slug, href: `/explore${catPrefix}/${state.countrySlug}/${state.regionSlug}/${state.subregionSlug}/${app.slug}` })
  }

  return items
}

/** Get coordinates and zoom for a given MapState */
export function getViewportForState(
  state: MapState,
  taxonomy: ExploreTaxonomy
): { latitude: number; longitude: number; zoom: number } | null {
  if (state.drillLevel === 'world') {
    return { latitude: 30, longitude: 10, zoom: 1.8 }
  }

  if (state.appellationSlug) {
    const app = taxonomy.appellations.find(a => a.slug === state.appellationSlug)
    if (app?.latitude && app?.longitude) return { latitude: app.latitude, longitude: app.longitude, zoom: 12 }
  }

  if (state.subregionSlug) {
    const sub = taxonomy.subregions.find(s => s.slug === state.subregionSlug)
    if (sub?.latitude && sub?.longitude) return { latitude: sub.latitude, longitude: sub.longitude, zoom: 10 }
  }

  if (state.regionSlug) {
    const region = taxonomy.regions.find(r => r.slug === state.regionSlug)
    if (region?.latitude && region?.longitude) return { latitude: region.latitude, longitude: region.longitude, zoom: 8 }
  }

  if (state.countrySlug) {
    const country = taxonomy.countries.find(c => c.slug === state.countrySlug)
    if (country?.latitude && country?.longitude) return { latitude: country.latitude, longitude: country.longitude, zoom: 5 }
  }

  return null
}

/** Filter locations by category scope */
export function filterByCategory<T extends { scopes: string[]; counts: import('./types').CategoryCounts }>(
  items: T[],
  category: CategoryKey | null
): T[] {
  if (!category) return items.filter(item => item.counts.total > 0)
  return items.filter(item => item.scopes.includes(category) && item.counts[category] > 0)
}

/** Search taxonomy locations by query string */
export function searchLocations(
  query: string,
  taxonomy: ExploreTaxonomy
): Array<{ name: string; parentName: string; slug: string; type: DrillLevel; count: number; href: string }> {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const results: Array<{ name: string; parentName: string; slug: string; type: DrillLevel; count: number; href: string }> = []

  // Search countries
  for (const c of taxonomy.countries) {
    if (c.name.toLowerCase().includes(q)) {
      results.push({ name: c.name, parentName: '', slug: c.slug, type: 'country', count: c.counts.total, href: `/explore/${c.slug}` })
    }
  }

  // Search regions
  for (const r of taxonomy.regions) {
    if (r.name.toLowerCase().includes(q)) {
      const parent = taxonomy.countries.find(c => c.id === r.parentId)
      results.push({ name: r.name, parentName: parent?.name || '', slug: r.slug, type: 'region', count: r.counts.total, href: `/explore/${r.parentSlug}/${r.slug}` })
    }
  }

  // Search subregions
  for (const s of taxonomy.subregions) {
    if (s.name.toLowerCase().includes(q)) {
      results.push({ name: s.name, parentName: '', slug: s.slug, type: 'subregion', count: s.counts.total, href: `/explore/${s.grandparentSlug}/${s.parentSlug}/${s.slug}` })
    }
  }

  return results.slice(0, 15) // limit results
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/explore/taxonomy-utils.ts
git commit -m "feat(explore): add taxonomy utility functions for slug parsing and navigation"
```

---

## Task 4: Map Configuration & Style

**Files:**
- Create: `lib/explore/map-config.ts`
- Create: `lib/explore/map-style.ts`

- [ ] **Step 1: Create map config**

Create `lib/explore/map-config.ts`:

```typescript
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

export const INITIAL_VIEWPORT = {
  latitude: 30,
  longitude: 10,
  zoom: 1.8,
}

/** Zoom thresholds for showing different marker layers */
export const ZOOM_THRESHOLDS = {
  countries: { min: 0, max: 4 },
  regions: { min: 4, max: 8 },
  subregions: { min: 8, max: 12 },
  appellations: { min: 12, max: 20 },
}

/** Fly-to animation config */
export const FLY_TO_CONFIG = {
  drillDown: { duration: 1500, curve: 1.42 },
  drillUp: { duration: 1200, curve: 1.42 },
  instant: { duration: 0 },
}

/** Zoom levels for each drill depth */
export const DRILL_ZOOM: Record<string, number> = {
  world: 1.8,
  country: 5,
  region: 8,
  subregion: 10,
  appellation: 12,
}

/** Marker size range based on product count */
export const MARKER_SIZE = {
  min: 8,
  max: 40,
}
```

- [ ] **Step 2: Create map style**

Create `lib/explore/map-style.ts`:

```typescript
/**
 * Custom dark map style for the explore page.
 * Uses Mapbox's dark-v11 as base with overrides.
 * For a fully custom style, create one in Mapbox Studio and replace this URL.
 */
export const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'

/**
 * If using a custom Mapbox Studio style, set the style URL here:
 * export const MAP_STYLE = 'mapbox://styles/YOUR_USERNAME/YOUR_STYLE_ID'
 *
 * Custom style should have:
 * - Terrain: #1a1a2e to #16213e
 * - Water: #0a0a1a
 * - Country borders: #2a2a3e (subtle)
 * - Labels: minimal, light grey
 * - No road network, no POIs
 */

/** Country polygon fill colors by state */
export const COUNTRY_FILL_COLORS = {
  active: 'rgba(74, 144, 217, 0.15)',       // default blue, overridden by category
  inactive: 'rgba(42, 42, 62, 0.3)',         // muted grey
  hover: 'rgba(74, 144, 217, 0.25)',         // brighter on hover
}

/** Country border colors */
export const COUNTRY_BORDER_COLORS = {
  default: 'rgba(42, 42, 62, 0.5)',
  active: 'rgba(255, 255, 255, 0.15)',
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/explore/map-config.ts lib/explore/map-style.ts
git commit -m "feat(explore): add Mapbox configuration and dark map style"
```

---

## Task 5: Data Pre-work Scripts

**Files:**
- Create: `scripts/fill-explore-coordinates.ts`
- Create: `scripts/build-explore-taxonomy.ts`

- [ ] **Step 1: Create coordinate gap-fill script**

Create `scripts/fill-explore-coordinates.ts`:

```typescript
/**
 * One-time script to geocode missing coordinates in the taxonomy.
 * Uses Mapbox Geocoding API with parent context for disambiguation.
 *
 * Usage: npx tsx scripts/fill-explore-coordinates.ts
 *
 * Reads: data/taxonomy_for_map.json
 * Writes: data/taxonomy/coordinates-enriched.json
 */

import * as fs from 'fs'
import * as path from 'path'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''
const INPUT_PATH = path.join(process.cwd(), 'data', 'taxonomy_for_map.json')
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'taxonomy', 'coordinates-enriched.json')

interface Location {
  id: number
  name: string
  slug: string
  latitude: number | null
  longitude: number | null
  parent_name?: string
  grandparent_name?: string
}

async function geocode(name: string, context: string): Promise<{ lat: number; lng: number } | null> {
  const query = context ? `${name}, ${context}` : name
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=place,locality,region`

  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].center
      return { lat, lng }
    }
  } catch (e) {
    console.error(`  Failed to geocode "${query}":`, e)
  }
  return null
}

async function main() {
  if (!MAPBOX_TOKEN) {
    console.error('Error: NEXT_PUBLIC_MAPBOX_TOKEN not set in environment')
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'))
  let filled = 0
  let failed = 0

  // Process regions
  console.log('\n=== Geocoding Regions ===')
  for (const region of raw.regions) {
    if (region.latitude !== null && region.longitude !== null) continue
    const context = region.parent_name || ''
    const result = await geocode(region.name, context)
    if (result) {
      region.latitude = result.lat
      region.longitude = result.lng
      console.log(`  ✓ ${region.name} (${context}) → [${result.lat}, ${result.lng}]`)
      filled++
    } else {
      console.log(`  ✗ ${region.name} (${context}) — NOT FOUND`)
      failed++
    }
    await new Promise(r => setTimeout(r, 200)) // rate limit
  }

  // Process subregions
  console.log('\n=== Geocoding Subregions ===')
  for (const sub of raw.subregions) {
    if (sub.latitude !== null && sub.longitude !== null) continue
    const context = [sub.parent_name, sub.grandparent_name].filter(Boolean).join(', ')
    const result = await geocode(sub.name, context)
    if (result) {
      sub.latitude = result.lat
      sub.longitude = result.lng
      console.log(`  ✓ ${sub.name} (${context}) → [${result.lat}, ${result.lng}]`)
      filled++
    } else {
      console.log(`  ✗ ${sub.name} (${context}) — NOT FOUND`)
      failed++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Process appellations
  console.log('\n=== Geocoding Appellations ===')
  for (const app of raw.appellations) {
    if (app.latitude !== null && app.longitude !== null) continue
    const result = await geocode(app.name, 'wine region')
    if (result) {
      app.latitude = result.lat
      app.longitude = result.lng
      console.log(`  ✓ ${app.name} → [${result.lat}, ${result.lng}]`)
      filled++
    } else {
      console.log(`  ✗ ${app.name} — NOT FOUND`)
      failed++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Process countries with missing coords
  console.log('\n=== Geocoding Countries ===')
  for (const country of raw.countries) {
    if (country.latitude !== null && country.longitude !== null) continue
    const result = await geocode(country.name, '')
    if (result) {
      country.latitude = result.lat
      country.longitude = result.lng
      console.log(`  ✓ ${country.name} → [${result.lat}, ${result.lng}]`)
      filled++
    } else {
      console.log(`  ✗ ${country.name} — NOT FOUND`)
      failed++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(raw, null, 2))
  console.log(`\n=== Done ===\nFilled: ${filled}\nFailed: ${failed}\nOutput: ${OUTPUT_PATH}`)
}

main()
```

- [ ] **Step 2: Create taxonomy builder script**

Create `scripts/build-explore-taxonomy.ts`:

```typescript
/**
 * Builds the explore-taxonomy.json file used by the map frontend.
 * Reads taxonomy data + product masterfile, aggregates counts per location × category.
 *
 * Usage: npx tsx scripts/build-explore-taxonomy.ts
 *
 * Reads: data/taxonomy/coordinates-enriched.json (or taxonomy_for_map.json)
 *        data/masterfile_all_tiers.csv
 * Writes: data/taxonomy/explore-taxonomy.json
 */

import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const TAXONOMY_PATH = path.join(DATA_DIR, 'taxonomy', 'coordinates-enriched.json')
const TAXONOMY_FALLBACK = path.join(DATA_DIR, 'taxonomy_for_map.json')
const MASTERFILE_PATH = path.join(DATA_DIR, 'masterfile_all_tiers.csv')
const OUTPUT_PATH = path.join(DATA_DIR, 'taxonomy', 'explore-taxonomy.json')

/** Classification → category mapping */
const CLASSIFICATION_MAP: Record<string, string> = {
  'Red Wine': 'wine', 'White Wine': 'wine', 'Rosé Wine': 'wine', 'Rose Wine': 'wine',
  'Sparkling Wine': 'wine', 'Champagne': 'wine',
  'Whisky': 'spirits', 'Gin': 'spirits', 'Rum': 'spirits', 'Tequila': 'spirits',
  'Vodka': 'spirits', 'Brandy': 'spirits', 'Liqueur': 'spirits', 'Cognac': 'spirits',
  'Beer': 'beer',
  'Sake/Shochu': 'sake',
}

/** Known duplicate regions — map non-canonical to canonical slug */
const DUPLICATE_MAP: Record<string, string> = {
  'barossa': 'barossa-valley',
  'casablanca': 'casablanca-valley',
  'clare': 'clare-valley',
  'colchagua': 'colchagua-valley',
  'friuli': 'friuli-venezia-giulia',
  'loire': 'loire-valley',
  'maipo': 'maipo-valley',
  'rh-ne': 'rh-ne-valley',
  'sonoma': 'sonoma-county',
}

/** Non-geographic region slugs to exclude from map markers */
const NON_GEOGRAPHIC_SLUGS = new Set(['multi-regional', 'others-region', 'south-eastern-australia'])

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    // Simple CSV parse — handles basic quoting
    const values: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
      current += char
    }
    values.push(current.trim())

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    rows.push(row)
  }
  return rows
}

function main() {
  // Read taxonomy
  const taxPath = fs.existsSync(TAXONOMY_PATH) ? TAXONOMY_PATH : TAXONOMY_FALLBACK
  console.log(`Reading taxonomy from: ${taxPath}`)
  const taxonomy = JSON.parse(fs.readFileSync(taxPath, 'utf-8'))

  // Read masterfile
  console.log(`Reading products from: ${MASTERFILE_PATH}`)
  const csvContent = fs.readFileSync(MASTERFILE_PATH, 'utf-8')
  const products = parseCSV(csvContent)
  console.log(`  ${products.length} products loaded`)

  // Count products per location × category
  const countsByCountry: Record<string, Record<string, number>> = {}
  const countsByRegion: Record<string, Record<string, number>> = {}
  const pricesByCountry: Record<string, number[]> = {}
  const pricesByRegion: Record<string, number[]> = {}

  for (const p of products) {
    const cat = CLASSIFICATION_MAP[p.classification]
    if (!cat) continue // skip accessories, glassware etc.

    const country = p.country?.trim()
    const region = p.region?.trim()
    const price = parseFloat(p.price)

    if (country) {
      if (!countsByCountry[country]) countsByCountry[country] = { wine: 0, spirits: 0, beer: 0, sake: 0, total: 0 }
      countsByCountry[country][cat]++
      countsByCountry[country].total++
      if (!isNaN(price) && price > 0) {
        if (!pricesByCountry[country]) pricesByCountry[country] = []
        pricesByCountry[country].push(price)
      }
    }

    if (region) {
      if (!countsByRegion[region]) countsByRegion[region] = { wine: 0, spirits: 0, beer: 0, sake: 0, total: 0 }
      countsByRegion[region][cat]++
      countsByRegion[region].total++
      if (!isNaN(price) && price > 0) {
        if (!pricesByRegion[region]) pricesByRegion[region] = []
        pricesByRegion[region].push(price)
      }
    }
  }

  // Build output
  const emptyCounts = { wine: 0, spirits: 0, beer: 0, sake: 0, total: 0 }
  const emptyPriceRange = { min: 0, max: 0 }

  function getPriceRange(prices: number[] | undefined) {
    if (!prices || prices.length === 0) return emptyPriceRange
    return { min: Math.min(...prices), max: Math.max(...prices) }
  }

  // Build countries
  const countries = taxonomy.countries
    .filter((c: any) => c.latitude !== null && c.longitude !== null)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      latitude: c.latitude,
      longitude: c.longitude,
      scopes: c.scopes || [],
      counts: countsByCountry[c.name] || emptyCounts,
      priceRange: getPriceRange(pricesByCountry[c.name]),
    }))

  // Build regions (excluding duplicates and non-geographic)
  const regions = taxonomy.regions
    .filter((r: any) => !DUPLICATE_MAP[r.slug] && !NON_GEOGRAPHIC_SLUGS.has(r.slug))
    .filter((r: any) => r.latitude !== null && r.longitude !== null)
    .map((r: any) => {
      const parent = taxonomy.countries.find((c: any) => c.id === r.parent_id)
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        latitude: r.latitude,
        longitude: r.longitude,
        parentId: r.parent_id,
        parentSlug: parent?.slug || '',
        scopes: r.scopes || [],
        counts: countsByRegion[r.name] || emptyCounts,
        priceRange: getPriceRange(pricesByRegion[r.name]),
        description: r.description || undefined,
        keyGrapes: r.keyGrapes || undefined,
        keyStyles: r.keyStyles || undefined,
      }
    })

  // Build subregions
  const subregions = taxonomy.subregions
    .filter((s: any) => s.latitude !== null && s.longitude !== null)
    .map((s: any) => {
      const parentRegion = taxonomy.regions.find((r: any) => r.id === s.parent_id)
      const grandparent = parentRegion ? taxonomy.countries.find((c: any) => c.id === parentRegion.parent_id) : null
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        latitude: s.latitude,
        longitude: s.longitude,
        parentId: s.parent_id,
        parentSlug: parentRegion?.slug || '',
        grandparentId: grandparent?.id || 0,
        grandparentSlug: grandparent?.slug || '',
        scopes: s.scopes || [],
        counts: countsByRegion[s.name] || emptyCounts,
        priceRange: getPriceRange(pricesByRegion[s.name]),
      }
    })

  // Build appellations
  const appellations = taxonomy.appellations
    .filter((a: any) => a.latitude !== null && a.longitude !== null)
    .map((a: any) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      latitude: a.latitude,
      longitude: a.longitude,
      parentId: a.parent_id || 0,
      parentSlug: a.parent_slug || '',
      regionId: a.region_id || 0,
      regionSlug: a.region_slug || '',
      countryId: a.country_id || 0,
      countrySlug: a.country_slug || '',
      scopes: a.scopes || [],
      counts: emptyCounts,
      priceRange: emptyPriceRange,
    }))

  const output = { countries, regions, subregions, appellations }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

  console.log(`\n=== Output ===`)
  console.log(`Countries: ${countries.length}`)
  console.log(`Regions: ${regions.length}`)
  console.log(`Subregions: ${subregions.length}`)
  console.log(`Appellations: ${appellations.length}`)
  console.log(`Written to: ${OUTPUT_PATH}`)
}

main()
```

- [ ] **Step 3: Run coordinate fill (requires Mapbox token)**

Run:
```bash
npx tsx scripts/fill-explore-coordinates.ts
```
Expected: Output showing geocoded locations. Review the coordinates-enriched.json for accuracy.

- [ ] **Step 4: Run taxonomy builder**

Run:
```bash
npx tsx scripts/build-explore-taxonomy.ts
```
Expected: `data/taxonomy/explore-taxonomy.json` created with counts.

- [ ] **Step 5: Commit**

```bash
git add scripts/fill-explore-coordinates.ts scripts/build-explore-taxonomy.ts data/taxonomy/explore-taxonomy.json data/taxonomy/coordinates-enriched.json
git commit -m "feat(explore): add geocoding and taxonomy builder scripts"
```

---

## Task 6: Download Country Boundaries GeoJSON

**Files:**
- Create: `public/countries-110m.geojson`

- [ ] **Step 1: Download Natural Earth 110m countries GeoJSON**

Run:
```bash
curl -L "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson" -o "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/public/countries-110m.geojson"
```

Note: This file is ~23MB raw. For production, simplify with mapshaper or use a simplified version. For v1, this works.

Alternatively, use a smaller source:
```bash
curl -L "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json" -o "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/public/countries-110m.json"
```

Note: The world-atlas file is TopoJSON (~120KB). Mapbox GL does not support TopoJSON natively, but we can convert it client-side with the `topojson-client` library, or pre-convert it to GeoJSON using a script. For simplicity in v1, download a pre-made GeoJSON.

- [ ] **Step 2: Verify the file is valid JSON**

Run:
```bash
node -e "const d = require('./public/countries-110m.geojson'); console.log('Features:', d.features?.length || 'N/A')"
```
Expected: `Features: 255` (or similar count).

- [ ] **Step 3: Commit**

```bash
git add public/countries-110m.geojson
git commit -m "feat(explore): add Natural Earth country boundaries GeoJSON"
```

---

## Task 7: Placeholder Images

**Files:**
- Create: `public/images/placeholders/wine-red.svg` (and other variants)

- [ ] **Step 1: Create placeholder SVGs**

Create minimal dark-themed bottle silhouette SVGs for each category. These are simple outlines on transparent background, styled to match the dark theme.

Create `public/images/placeholders/wine-red.svg`:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 200" fill="none">
  <path d="M30 10h20v40l10 20v100c0 11-9 20-20 20s-20-9-20-20V70l10-20V10z" fill="#722F37" opacity="0.3" stroke="#722F37" stroke-width="1.5"/>
</svg>
```

Create analogous files for: `wine-white.svg` (fill=#DAA520 opacity=0.2), `wine-rose.svg` (fill=#E8A0B5 opacity=0.25), `spirits.svg` (fill=#B5651D opacity=0.3), `beer.svg` (fill=#DAA520 opacity=0.3), `sake.svg` (fill=#5F8575 opacity=0.3), `bottle-generic.svg` (fill=#4A90D9 opacity=0.2).

- [ ] **Step 2: Commit**

```bash
git add public/images/placeholders/
git commit -m "feat(explore): add category placeholder bottle SVGs"
```

---

## Task 8: Explore API Endpoint

**Files:**
- Create: `app/api/explore/products/route.ts`

- [ ] **Step 1: Create the products API route**

Create `app/api/explore/products/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || ''

/** Classification prefixes for category filtering */
const CATEGORY_CLASSIFICATIONS: Record<string, string[]> = {
  wine: ['Red Wine', 'White Wine', 'Rosé Wine', 'Rose Wine', 'Sparkling Wine', 'Champagne'],
  spirits: ['Whisky', 'Gin', 'Rum', 'Tequila', 'Vodka', 'Brandy', 'Liqueur', 'Cognac'],
  beer: ['Beer'],
  sake: ['Sake/Shochu'],
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const country = params.get('country')
    const region = params.get('region')
    const subregion = params.get('subregion')
    const category = params.get('category')
    const sort = params.get('sort') || 'popular'
    const page = parseInt(params.get('page') || '1')
    const limit = parseInt(params.get('limit') || '20')
    const offset = (page - 1) * limit

    // Build Supabase query
    const filters: string[] = []

    if (country) filters.push(`country=eq.${encodeURIComponent(country)}`)
    if (region) filters.push(`region=eq.${encodeURIComponent(region)}`)
    if (subregion) filters.push(`subregion=eq.${encodeURIComponent(subregion)}`)

    // Category filter — match classifications
    if (category && CATEGORY_CLASSIFICATIONS[category]) {
      const classifications = CATEGORY_CLASSIFICATIONS[category]
      const orFilter = classifications.map(c => `classification.eq.${c}`).join(',')
      filters.push(`or=(${orFilter})`)
    }

    // Sort mapping
    let orderBy = 'enrichment_priority.desc.nullslast,price.desc.nullslast'
    switch (sort) {
      case 'price-asc': orderBy = 'price.asc.nullslast'; break
      case 'price-desc': orderBy = 'price.desc.nullslast'; break
      case 'newest': orderBy = 'vintage.desc.nullslast'; break
      case 'name': orderBy = 'name.asc'; break
    }

    const select = 'id,name,brand,classification,grape_variety,vintage,price,wine_color,image_url,country,region,subregion,desc_en_short'
    const queryString = filters.length > 0 ? `&${filters.join('&')}` : ''
    const url = `${SUPABASE_URL}/rest/v1/products?select=${select}${queryString}&order=${orderBy}&offset=${offset}&limit=${limit}`

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      },
    })

    if (!res.ok) {
      const error = await res.text()
      return NextResponse.json({ error: `Supabase error: ${error}` }, { status: res.status })
    }

    const products = await res.json()
    const contentRange = res.headers.get('content-range')
    const total = contentRange ? parseInt(contentRange.split('/')[1]) : products.length

    return NextResponse.json({
      products,
      total,
      page,
      limit,
    })
  } catch (error) {
    console.error('Explore products API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/explore/products/route.ts
git commit -m "feat(explore): add paginated products API endpoint"
```

---

## Task 9: Explore Layout & Route Pages

**Files:**
- Create: `app/explore/layout.tsx`
- Create: `app/explore/page.tsx`
- Create: `app/explore/[...slug]/page.tsx`

- [ ] **Step 1: Create immersive layout**

Create `app/explore/layout.tsx`:

```typescript
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Explore Wine & Spirits by Region — Wine-Now',
  description: 'Discover wines, spirits, beer and sake from 50+ countries. Browse by region on our interactive world map.',
}

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a1a] text-white">
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Create root explore page**

Create `app/explore/page.tsx`:

```typescript
import { redirect } from 'next/navigation'

// Root /explore redirects to the catch-all with empty slug
// This avoids duplicating logic between page.tsx and [...slug]/page.tsx
export default function ExplorePage() {
  // We render the catch-all route instead
  // The actual rendering happens in [...slug]/page.tsx with an empty slug
  redirect('/explore/')
}
```

Actually, simpler: let `/explore` render the same component. Create `app/explore/page.tsx`:

```typescript
import ExploreView from './[...slug]/page'

export default function ExplorePage() {
  return <ExploreView params={{ slug: [] }} />
}
```

Wait — Next.js catch-all routes `[...slug]` don't match the bare path. Use an optional catch-all `[[...slug]]` instead. Let me fix the route structure:

Delete the plan for `app/explore/page.tsx` and `app/explore/[...slug]/page.tsx`. Instead:

Create `app/explore/[[...slug]]/page.tsx`:

```typescript
import { Metadata } from 'next'
import dynamic from 'next/dynamic'

// Dynamic import for Mapbox GL — skip SSR (requires browser APIs)
const ExploreClient = dynamic(() => import('@/components/explore/ExploreClient'), {
  ssr: false,
  loading: () => <MapSkeleton />,
})

import { MapSkeleton } from '@/components/explore/MapSkeleton'

interface ExplorePageProps {
  params: { slug?: string[] }
}

export async function generateMetadata({ params }: ExplorePageProps): Promise<Metadata> {
  const slug = params.slug || []

  // Base metadata — enhanced per drill level in a real implementation
  // For now, static metadata that covers the general case
  const title = slug.length === 0
    ? 'Explore Wine & Spirits by Region — Wine-Now'
    : `Explore ${slug[slug.length - 1]?.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} — Wine-Now`

  return {
    title,
    description: 'Discover wines, spirits, beer and sake from 50+ countries. Browse by region on our interactive world map.',
    openGraph: {
      title,
      description: 'Explore wine and spirits regions of the world.',
      type: 'website',
    },
  }
}

export default function ExplorePage({ params }: ExplorePageProps) {
  const slug = params.slug || []

  return <ExploreClient initialSlug={slug} />
}
```

- [ ] **Step 3: Create the ExploreClient component (shell)**

Create `components/explore/ExploreClient.tsx`:

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ExploreTaxonomy, MapState, CategoryKey, RegionCardData, SidebarState, BottomSheetState, BottomSheetTab, ExploreProduct, ProductsResponse } from '@/lib/explore/types'
import { parseSlug, buildExplorePath, buildBreadcrumbs, getViewportForState, filterByCategory } from '@/lib/explore/taxonomy-utils'
import { isValidCategory } from '@/lib/explore/category-config'
import { MapSkeleton } from './MapSkeleton'

interface ExploreClientProps {
  initialSlug: string[]
}

export default function ExploreClient({ initialSlug }: ExploreClientProps) {
  const router = useRouter()
  const [taxonomy, setTaxonomy] = useState<ExploreTaxonomy | null>(null)
  const [mapState, setMapState] = useState<MapState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [sidebarState, setSidebarState] = useState<SidebarState>('hidden')
  const [regionCard, setRegionCard] = useState<RegionCardData | null>(null)
  const [products, setProducts] = useState<ExploreProduct[]>([])
  const [productsTotal, setProductsTotal] = useState(0)
  const [productsLoading, setProductsLoading] = useState(false)

  // Load taxonomy on mount
  useEffect(() => {
    fetch('/api/explore/taxonomy')
      .then(res => res.json())
      .then(data => {
        setTaxonomy(data)
        const state = parseSlug(initialSlug, data)
        setMapState(state)
        setLoading(false)
      })
      .catch(err => {
        setError('Failed to load map data')
        setLoading(false)
      })
  }, [])

  // Navigate: update URL and map state
  const navigate = useCallback((newState: MapState) => {
    setMapState(newState)
    setRegionCard(null) // dismiss card on navigation
    const path = buildExplorePath(newState)
    router.push(path, { scroll: false })
  }, [router])

  // Category switch
  const setCategory = useCallback((category: CategoryKey | null) => {
    if (!mapState) return
    navigate({ ...mapState, category })
  }, [mapState, navigate])

  if (loading || !taxonomy || !mapState) {
    return <MapSkeleton />
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-explore-text-secondary">{error}</p>
      </div>
    )
  }

  const breadcrumbs = buildBreadcrumbs(mapState, taxonomy)
  const viewport = getViewportForState(mapState, taxonomy)

  return (
    <div className="relative h-full w-full">
      {/* Map will be added in Task 10 */}
      <div className="flex h-full items-center justify-center bg-[#0a0a1a]">
        <p className="text-white/60">Map loading... (slug: {initialSlug.join('/')})</p>
      </div>

      {/* TODO: CategoryLens, Breadcrumb, RegionCard, ProductSidebar, BottomPanel, SearchOverlay, ZoomControls */}
    </div>
  )
}
```

- [ ] **Step 4: Create MapSkeleton component**

Create `components/explore/MapSkeleton.tsx`:

```typescript
export function MapSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a1a]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        <p className="text-sm text-white/40">Loading map...</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create taxonomy API endpoint (serves static JSON)**

Create `app/api/explore/taxonomy/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'taxonomy', 'explore-taxonomy.json')
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load taxonomy data' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 6: Verify typecheck and dev server**

Run:
```bash
npm run typecheck
```
Expected: No errors.

Visit `http://localhost:3000/explore` — should show the skeleton or placeholder text.

- [ ] **Step 7: Commit**

```bash
git add app/explore/ components/explore/ExploreClient.tsx components/explore/MapSkeleton.tsx app/api/explore/taxonomy/route.ts
git commit -m "feat(explore): add route pages, layout, client shell, and taxonomy API"
```

---

## Task 10: Mapbox Map Component

**Files:**
- Create: `components/explore/ExploreMap.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create ExploreMap component**

Create `components/explore/ExploreMap.tsx`:

```typescript
'use client'

import { useRef, useCallback, useEffect, useMemo } from 'react'
import Map, { Source, Layer, MapRef, MapLayerMouseEvent } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN, FLY_TO_CONFIG } from '@/lib/explore/map-config'
import { MAP_STYLE, COUNTRY_FILL_COLORS } from '@/lib/explore/map-style'
import { ExploreTaxonomy, MapState, CategoryKey } from '@/lib/explore/types'
import { filterByCategory, getViewportForState } from '@/lib/explore/taxonomy-utils'
import { getCategoryColor } from '@/lib/explore/category-config'

interface ExploreMapProps {
  taxonomy: ExploreTaxonomy
  mapState: MapState
  onCountryClick: (countrySlug: string) => void
  onRegionClick: (regionSlug: string, position: { x: number; y: number }) => void
  onSubregionClick: (subregionSlug: string) => void
  onAppellationClick: (appellationSlug: string) => void
}

export default function ExploreMap({
  taxonomy,
  mapState,
  onCountryClick,
  onRegionClick,
  onSubregionClick,
  onAppellationClick,
}: ExploreMapProps) {
  const mapRef = useRef<MapRef>(null)
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

  const viewport = getViewportForState(mapState, taxonomy)
  const accentColor = getCategoryColor(mapState.category)

  // Fly to new viewport when map state changes
  useEffect(() => {
    if (!mapRef.current || !viewport) return

    const flyConfig = prefersReducedMotion
      ? FLY_TO_CONFIG.instant
      : FLY_TO_CONFIG.drillDown

    mapRef.current.flyTo({
      center: [viewport.longitude, viewport.latitude],
      zoom: viewport.zoom,
      ...flyConfig,
    })
  }, [mapState.drillLevel, mapState.countrySlug, mapState.regionSlug, mapState.subregionSlug, mapState.appellationSlug])

  // Build GeoJSON for region markers
  const regionMarkers = useMemo(() => {
    const filtered = filterByCategory(taxonomy.regions, mapState.category)
    return {
      type: 'FeatureCollection' as const,
      features: filtered
        .filter(r => r.latitude && r.longitude)
        .map(r => ({
          type: 'Feature' as const,
          properties: {
            slug: r.slug,
            name: r.name,
            count: mapState.category ? r.counts[mapState.category] : r.counts.total,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [r.longitude!, r.latitude!],
          },
        })),
    }
  }, [taxonomy.regions, mapState.category])

  // Build GeoJSON for subregion markers
  const subregionMarkers = useMemo(() => {
    const filtered = mapState.regionSlug
      ? taxonomy.subregions.filter(s => s.parentSlug === mapState.regionSlug)
      : []
    return {
      type: 'FeatureCollection' as const,
      features: filtered
        .filter(s => s.latitude && s.longitude)
        .map(s => ({
          type: 'Feature' as const,
          properties: {
            slug: s.slug,
            name: s.name,
            count: mapState.category ? s.counts[mapState.category] : s.counts.total,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [s.longitude!, s.latitude!],
          },
        })),
    }
  }, [taxonomy.subregions, mapState.regionSlug, mapState.category])

  // Click handlers
  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features || []
    if (features.length === 0) return

    const feature = features[0]
    const layer = feature.layer?.id

    if (layer === 'region-markers' && feature.properties?.slug) {
      onRegionClick(feature.properties.slug, { x: e.point.x, y: e.point.y })
    } else if (layer === 'subregion-markers' && feature.properties?.slug) {
      onSubregionClick(feature.properties.slug)
    } else if (layer === 'country-fills' && feature.properties?.ISO_A3) {
      // Find country by matching GeoJSON properties
      const country = taxonomy.countries.find(
        c => c.name === feature.properties?.ADMIN || c.name === feature.properties?.NAME
      )
      if (country) onCountryClick(country.slug)
    }
  }, [taxonomy, onCountryClick, onRegionClick, onSubregionClick])

  if (!viewport) return null

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        latitude: viewport.latitude,
        longitude: viewport.longitude,
        zoom: viewport.zoom,
      }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE}
      interactiveLayerIds={['country-fills', 'region-markers', 'subregion-markers']}
      onClick={handleMapClick}
      cursor="pointer"
    >
      {/* Country boundary fill layer */}
      <Source id="countries" type="geojson" data="/countries-110m.geojson">
        <Layer
          id="country-fills"
          type="fill"
          paint={{
            'fill-color': COUNTRY_FILL_COLORS.active,
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.3, 0.12],
          }}
        />
        <Layer
          id="country-borders"
          type="line"
          paint={{
            'line-color': 'rgba(255,255,255,0.1)',
            'line-width': 0.5,
          }}
        />
      </Source>

      {/* Region markers */}
      <Source id="regions" type="geojson" data={regionMarkers}>
        <Layer
          id="region-markers"
          type="circle"
          minzoom={3}
          paint={{
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'count'],
              0, 6,
              100, 14,
              500, 22,
              2000, 32,
            ],
            'circle-color': accentColor,
            'circle-opacity': 0.7,
            'circle-stroke-color': 'rgba(255,255,255,0.3)',
            'circle-stroke-width': 2,
          }}
        />
        <Layer
          id="region-labels"
          type="symbol"
          minzoom={4}
          layout={{
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-offset': [0, 1.8],
            'text-anchor': 'top',
          }}
          paint={{
            'text-color': 'rgba(255,255,255,0.7)',
            'text-halo-color': 'rgba(0,0,0,0.8)',
            'text-halo-width': 1,
          }}
        />
      </Source>

      {/* Subregion markers (shown when drilled into a region) */}
      {subregionMarkers.features.length > 0 && (
        <Source id="subregions" type="geojson" data={subregionMarkers}>
          <Layer
            id="subregion-markers"
            type="circle"
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'count'],
                0, 5,
                50, 10,
                200, 18,
              ],
              'circle-color': accentColor,
              'circle-opacity': 0.6,
              'circle-stroke-color': 'rgba(255,255,255,0.25)',
              'circle-stroke-width': 1.5,
            }}
          />
          <Layer
            id="subregion-labels"
            type="symbol"
            layout={{
              'text-field': ['get', 'name'],
              'text-size': 10,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
            }}
            paint={{
              'text-color': 'rgba(255,255,255,0.6)',
              'text-halo-color': 'rgba(0,0,0,0.8)',
              'text-halo-width': 1,
            }}
          />
        </Source>
      )}
    </Map>
  )
}
```

- [ ] **Step 2: Wire ExploreMap into ExploreClient**

In `components/explore/ExploreClient.tsx`, replace the placeholder div with:

```typescript
// Add import at top:
import ExploreMap from './ExploreMap'

// Replace the placeholder div in the return:
<ExploreMap
  taxonomy={taxonomy}
  mapState={mapState}
  onCountryClick={(slug) => {
    navigate({ ...mapState, countrySlug: slug, regionSlug: null, subregionSlug: null, appellationSlug: null, drillLevel: 'country' })
  }}
  onRegionClick={(slug, position) => {
    // For now, navigate. RegionCard will be added in Task 12.
    navigate({ ...mapState, regionSlug: slug, subregionSlug: null, appellationSlug: null, drillLevel: 'region' })
  }}
  onSubregionClick={(slug) => {
    navigate({ ...mapState, subregionSlug: slug, appellationSlug: null, drillLevel: 'subregion' })
  }}
  onAppellationClick={(slug) => {
    navigate({ ...mapState, appellationSlug: slug, drillLevel: 'appellation' })
  }}
/>
```

- [ ] **Step 3: Verify in browser**

Visit `http://localhost:3000/explore`. Should see a dark-themed world map with region markers.

- [ ] **Step 4: Commit**

```bash
git add components/explore/ExploreMap.tsx components/explore/ExploreClient.tsx
git commit -m "feat(explore): add Mapbox GL map with country fills and region markers"
```

---

## Task 11: CategoryLens, Breadcrumb, ZoomControls

**Files:**
- Create: `components/explore/CategoryLens.tsx`
- Create: `components/explore/Breadcrumb.tsx`
- Create: `components/explore/ZoomControls.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create CategoryLens**

Create `components/explore/CategoryLens.tsx`:

```typescript
'use client'

import { CategoryKey, CATEGORIES, CATEGORY_KEYS } from '@/lib/explore/category-config'

interface CategoryLensProps {
  active: CategoryKey | null
  onChange: (category: CategoryKey | null) => void
}

export function CategoryLens({ active, onChange }: CategoryLensProps) {
  return (
    <div className="flex items-center gap-2">
      {CATEGORY_KEYS.map(key => {
        const cat = CATEGORIES[key]
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onChange(isActive ? null : key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              isActive
                ? 'text-white shadow-lg'
                : 'text-white/60 hover:text-white/90 bg-white/5 hover:bg-white/10'
            }`}
            style={isActive ? { backgroundColor: cat.color } : undefined}
            aria-pressed={isActive}
          >
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create Breadcrumb**

Create `components/explore/Breadcrumb.tsx`:

```typescript
'use client'

import { ChevronRight, Globe } from 'lucide-react'
import { BreadcrumbItem } from '@/lib/explore/types'

interface BreadcrumbProps {
  items: BreadcrumbItem[]
  onNavigate: (href: string) => void
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <nav aria-label="Map navigation breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((item, i) => (
        <span key={item.slug || 'world'} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
          {i === items.length - 1 ? (
            <span className="text-white font-medium flex items-center gap-1.5">
              {i === 0 && <Globe className="h-3.5 w-3.5" />}
              {item.label}
            </span>
          ) : (
            <button
              onClick={() => onNavigate(item.href)}
              className="text-white/50 hover:text-white/80 transition-colors flex items-center gap-1.5"
            >
              {i === 0 && <Globe className="h-3.5 w-3.5" />}
              {item.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}
```

- [ ] **Step 3: Create ZoomControls**

Create `components/explore/ZoomControls.tsx`:

```typescript
'use client'

import { Plus, Minus } from 'lucide-react'

interface ZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
}

export function ZoomControls({ onZoomIn, onZoomOut }: ZoomControlsProps) {
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onZoomIn}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#12121f]/90 text-white/70 hover:text-white hover:bg-[#12121f] border border-white/8 transition-colors"
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        onClick={onZoomOut}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#12121f]/90 text-white/70 hover:text-white hover:bg-[#12121f] border border-white/8 transition-colors"
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Wire into ExploreClient**

Add the top bar, bottom bar, and zoom controls to `ExploreClient.tsx`. Add these imports and JSX around the map:

```typescript
import { CategoryLens } from './CategoryLens'
import { Breadcrumb } from './Breadcrumb'
import { ZoomControls } from './ZoomControls'
import { Search, Menu } from 'lucide-react'
```

Wrap the map with floating UI:

```tsx
return (
  <div className="relative h-full w-full">
    {/* Map */}
    <ExploreMap ... />

    {/* Top bar — floating */}
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 backdrop-blur-md bg-[#0a0a1a]/60">
      <CategoryLens active={mapState.category} onChange={setCategory} />
      <div className="flex items-center gap-2">
        <button className="p-2 text-white/60 hover:text-white" aria-label="Search regions">
          <Search className="h-5 w-5" />
        </button>
        <button className="p-2 text-white/60 hover:text-white" aria-label="Menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </div>

    {/* Bottom bar — floating */}
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 backdrop-blur-md bg-[#0a0a1a]/60">
      <Breadcrumb items={breadcrumbs} onNavigate={(href) => router.push(href, { scroll: false })} />
      <ZoomControls
        onZoomIn={() => { /* TODO: wire to map ref */ }}
        onZoomOut={() => { /* TODO: wire to map ref */ }}
      />
    </div>
  </div>
)
```

- [ ] **Step 5: Verify in browser**

Visit `http://localhost:3000/explore`. Should see:
- Category pills at top
- Map in the middle
- Breadcrumb at bottom left, zoom controls at bottom right

- [ ] **Step 6: Commit**

```bash
git add components/explore/CategoryLens.tsx components/explore/Breadcrumb.tsx components/explore/ZoomControls.tsx components/explore/ExploreClient.tsx
git commit -m "feat(explore): add category lens, breadcrumb, and zoom controls"
```

---

## Task 12: RegionCard (Floating Info Card)

**Files:**
- Create: `components/explore/RegionCard.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create RegionCard component**

Create `components/explore/RegionCard.tsx`:

```typescript
'use client'

import { X } from 'lucide-react'
import { RegionCardData, CategoryKey } from '@/lib/explore/types'
import { getCategoryColor } from '@/lib/explore/category-config'

interface RegionCardProps {
  data: RegionCardData
  category: CategoryKey | null
  onExplore: () => void
  onDismiss: () => void
}

export function RegionCard({ data, category, onExplore, onDismiss }: RegionCardProps) {
  const count = category ? data.counts[category] : data.counts.total
  const accentColor = getCategoryColor(category)

  return (
    <div
      className="absolute z-20 w-[320px] rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden
        md:backdrop-blur-xl md:bg-[rgba(10,10,26,0.88)]
        bg-[#12121f]"
      style={{
        left: Math.min(data.position.x + 16, window.innerWidth - 340),
        top: Math.min(data.position.y - 40, window.innerHeight - 400),
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div>
          <h3 className="text-lg font-semibold text-white">{data.name}</h3>
          <p className="text-sm text-white/50">{data.parentName}{category ? ` · ${category.charAt(0).toUpperCase() + category.slice(1)}` : ''}</p>
        </div>
        <button onClick={onDismiss} className="p-1 text-white/30 hover:text-white/70 transition-colors" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Description */}
      {data.description && (
        <p className="px-4 text-sm text-white/60 leading-relaxed">{data.description}</p>
      )}

      {/* Key grapes/styles */}
      {data.keyGrapes && data.keyGrapes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {data.keyGrapes.map(grape => (
            <span key={grape} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-white/70">{grape}</span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 px-4 pt-3 text-sm">
        <span className="text-white/80 font-medium">{count.toLocaleString()} products</span>
        {data.priceRange.min > 0 && (
          <span className="text-white/40">฿{data.priceRange.min.toLocaleString()}–฿{data.priceRange.max.toLocaleString()}</span>
        )}
      </div>

      {/* CTA */}
      <div className="p-4 pt-4">
        <button
          onClick={onExplore}
          className="w-full rounded-xl py-2.5 text-sm font-medium text-white transition-all hover:brightness-110"
          style={{ backgroundColor: accentColor }}
        >
          Explore Products →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire RegionCard into ExploreClient**

In `ExploreClient.tsx`, update the `onRegionClick` handler to show the card instead of navigating:

```typescript
import { RegionCard } from './RegionCard'

// In onRegionClick:
onRegionClick={(slug, position) => {
  const region = taxonomy.regions.find(r => r.slug === slug)
  if (!region) return
  const parent = taxonomy.countries.find(c => c.id === region.parentId)
  setRegionCard({
    name: region.name,
    parentName: parent?.name || '',
    slug: region.slug,
    description: region.description,
    keyGrapes: region.keyGrapes,
    keyStyles: region.keyStyles,
    counts: region.counts,
    priceRange: region.priceRange,
    position,
  })
}}

// In the JSX, after the map:
{regionCard && (
  <RegionCard
    data={regionCard}
    category={mapState.category}
    onExplore={() => {
      setRegionCard(null)
      setSidebarState('visible')
      navigate({ ...mapState, regionSlug: regionCard.slug, drillLevel: 'region' })
    }}
    onDismiss={() => setRegionCard(null)}
  />
)}
```

Also add Esc key handler and click-outside-to-dismiss.

- [ ] **Step 3: Verify in browser**

Click a region marker → floating card should appear with region info and "Explore Products →" button.

- [ ] **Step 4: Commit**

```bash
git add components/explore/RegionCard.tsx components/explore/ExploreClient.tsx
git commit -m "feat(explore): add floating region info card with glassmorphism"
```

---

## Task 13: ProductCard & ProductSidebar

**Files:**
- Create: `components/explore/ProductCard.tsx`
- Create: `components/explore/ProductSidebar.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create ProductCard**

Create `components/explore/ProductCard.tsx`:

```typescript
import { ExploreProduct } from '@/lib/explore/types'

interface ProductCardProps {
  product: ExploreProduct
}

export function ProductCard({ product }: ProductCardProps) {
  // Pick placeholder based on classification
  const placeholder = product.wine_color === 'Red' ? '/images/placeholders/wine-red.svg'
    : product.wine_color === 'White' ? '/images/placeholders/wine-white.svg'
    : product.classification?.includes('Spirits') || product.classification === 'Whisky' || product.classification === 'Gin'
      ? '/images/placeholders/spirits.svg'
    : product.classification === 'Beer' ? '/images/placeholders/beer.svg'
    : product.classification === 'Sake/Shochu' ? '/images/placeholders/sake.svg'
    : '/images/placeholders/bottle-generic.svg'

  return (
    <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 hover:bg-white/[0.06] transition-colors">
      <div className="h-16 w-12 flex-shrink-0 rounded-lg bg-white/[0.04] flex items-center justify-center overflow-hidden">
        <img
          src={product.image_url || placeholder}
          alt={`${product.brand} ${product.name}`}
          className="h-14 w-auto object-contain"
        />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <h4 className="text-sm font-medium text-white truncate">{product.name}</h4>
        <p className="text-xs text-white/50 truncate">
          {[product.grape_variety, product.vintage].filter(Boolean).join(' · ')}
        </p>
        <p className="text-sm font-semibold text-white/90">
          {product.price ? `฿${product.price.toLocaleString()}` : ''}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ProductSidebar**

Create `components/explore/ProductSidebar.tsx`:

```typescript
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { ExploreProduct, SidebarState, CategoryKey } from '@/lib/explore/types'
import { ProductCard } from './ProductCard'

interface ProductSidebarProps {
  state: SidebarState
  regionName: string
  category: CategoryKey | null
  products: ExploreProduct[]
  total: number
  loading: boolean
  onHide: () => void
  onLoadMore: () => void
}

export function ProductSidebar({
  state, regionName, category, products, total, loading, onHide, onLoadMore,
}: ProductSidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && !loading && products.length < total) onLoadMore() },
      { threshold: 0.1 }
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [loading, products.length, total, onLoadMore])

  if (state === 'hidden') return null

  return (
    <div className="absolute top-0 right-0 z-20 h-full w-[380px] flex flex-col border-l border-white/[0.06] bg-[#12121f] shadow-[-8px_0_32px_rgba(0,0,0,0.4)] animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <button onClick={onHide} className="p-1 text-white/50 hover:text-white transition-colors" aria-label="Hide sidebar">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-white">{regionName}{category ? ` · ${category.charAt(0).toUpperCase() + category.slice(1)}` : ''}</h2>
          <p className="text-xs text-white/40">{total.toLocaleString()} products</p>
        </div>
      </div>

      {/* Product list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        )}

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-1" />

        {/* Count indicator */}
        {!loading && products.length > 0 && (
          <p className="text-center text-xs text-white/30 py-2">
            Showing {products.length} of {total.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add slide-in animation to global CSS**

Add to `app/globals.css`:

```css
@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.animate-slide-in-right {
  animation: slide-in-right 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 4: Wire sidebar and product fetching into ExploreClient**

Add product fetching logic and wire the sidebar. In `ExploreClient.tsx`:

```typescript
import { ProductSidebar } from './ProductSidebar'

// Add product fetching function:
const fetchProducts = useCallback(async (page: number = 1) => {
  if (!mapState) return
  setProductsLoading(true)
  try {
    const params = new URLSearchParams()
    if (mapState.countrySlug) {
      const country = taxonomy?.countries.find(c => c.slug === mapState.countrySlug)
      if (country) params.set('country', country.name)
    }
    if (mapState.regionSlug) {
      const region = taxonomy?.regions.find(r => r.slug === mapState.regionSlug)
      if (region) params.set('region', region.name)
    }
    if (mapState.category) params.set('category', mapState.category)
    params.set('page', String(page))
    params.set('limit', '20')

    const res = await fetch(`/api/explore/products?${params}`)
    const data: ProductsResponse = await res.json()

    if (page === 1) {
      setProducts(data.products)
    } else {
      setProducts(prev => [...prev, ...data.products])
    }
    setProductsTotal(data.total)
  } catch {
    // Error state handled by sidebar
  } finally {
    setProductsLoading(false)
  }
}, [mapState, taxonomy])

// Add state for current page:
const [productsPage, setProductsPage] = useState(1)

// Fetch products when sidebar opens:
useEffect(() => {
  if (sidebarState === 'visible') {
    setProductsPage(1)
    fetchProducts(1)
  }
}, [sidebarState, mapState?.regionSlug, mapState?.subregionSlug])
```

Wire the ProductSidebar JSX into the return alongside the map.

- [ ] **Step 5: Verify in browser**

Click a region → card appears → click "Explore Products →" → sidebar slides in with product cards.

- [ ] **Step 6: Commit**

```bash
git add components/explore/ProductCard.tsx components/explore/ProductSidebar.tsx components/explore/ExploreClient.tsx app/globals.css
git commit -m "feat(explore): add product sidebar with infinite scroll and product cards"
```

---

## Task 14: BottomPanel (Tablet/Mobile)

**Files:**
- Create: `components/explore/BottomPanel.tsx`
- Create: `lib/explore/use-bottom-sheet.ts`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create useBottomSheet hook**

Create `lib/explore/use-bottom-sheet.ts`:

```typescript
'use client'

import { useState, useRef, useCallback } from 'react'
import { BottomSheetState } from './types'

interface UseBottomSheetReturn {
  state: BottomSheetState
  dragHandleProps: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  expand: () => void
  collapse: () => void
  toggle: () => void
}

export function useBottomSheet(initialState: BottomSheetState = 'collapsed'): UseBottomSheetReturn {
  const [state, setState] = useState<BottomSheetState>(initialState)
  const startY = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // Prevent scroll while dragging
    e.preventDefault()
  }, [])

  const onTouchEnd = useCallback(() => {
    // Simple toggle based on drag — can be enhanced with velocity detection
    setState(prev => prev === 'collapsed' ? 'full' : 'collapsed')
  }, [])

  return {
    state,
    dragHandleProps: { onTouchStart, onTouchMove, onTouchEnd },
    expand: () => setState('full'),
    collapse: () => setState('collapsed'),
    toggle: () => setState(prev => prev === 'collapsed' ? 'full' : 'collapsed'),
  }
}
```

- [ ] **Step 2: Create BottomPanel component**

Create `components/explore/BottomPanel.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { ExploreProduct, CategoryKey, BottomSheetState, BottomSheetTab, RegionCardData } from '@/lib/explore/types'
import { ProductCard } from './ProductCard'
import { Loader2 } from 'lucide-react'

interface BottomPanelProps {
  sheetState: BottomSheetState
  regionData: RegionCardData | null
  category: CategoryKey | null
  products: ExploreProduct[]
  total: number
  loading: boolean
  onLoadMore: () => void
  onToggle: () => void
  dragHandleProps: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
}

export function BottomPanel({
  sheetState, regionData, category, products, total, loading, onLoadMore, onToggle, dragHandleProps,
}: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomSheetTab>('region')

  if (!regionData) return null

  const height = sheetState === 'collapsed' ? 'h-[100px]' : 'h-[85vh]'

  return (
    <div className={`absolute bottom-0 left-0 right-0 z-20 ${height} rounded-t-2xl border-t border-white/[0.06] bg-[#12121f] transition-all duration-300 ease-out`}>
      {/* Drag handle */}
      <div
        className="flex justify-center py-2 cursor-grab"
        onClick={onToggle}
        {...dragHandleProps}
      >
        <div className="h-1 w-10 rounded-full bg-white/20" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] px-4">
        <button
          onClick={() => setActiveTab('region')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'region' ? 'text-white border-white' : 'text-white/40 border-transparent hover:text-white/60'
          }`}
        >
          Region
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'products' ? 'text-white border-white' : 'text-white/40 border-transparent hover:text-white/60'
          }`}
        >
          Products ({total})
        </button>
      </div>

      {/* Content */}
      {sheetState === 'full' && (
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'region' ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white">{regionData.name}</h3>
              <p className="text-sm text-white/50">{regionData.parentName}</p>
              {regionData.description && <p className="text-sm text-white/60">{regionData.description}</p>}
              {regionData.keyGrapes && (
                <div className="flex flex-wrap gap-1.5">
                  {regionData.keyGrapes.map(g => (
                    <span key={g} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-white/70">{g}</span>
                  ))}
                </div>
              )}
              <p className="text-sm text-white/80">{(category ? regionData.counts[category] : regionData.counts.total).toLocaleString()} products</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products.map(p => <ProductCard key={p.id} product={p} />)}
              {loading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed peek */}
      {sheetState === 'collapsed' && (
        <div className="px-4 py-2">
          <p className="text-sm font-medium text-white">{regionData.name}</p>
          <p className="text-xs text-white/40">{(category ? regionData.counts[category] : regionData.counts.total).toLocaleString()} products · Swipe up to explore</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire BottomPanel into ExploreClient for tablet/mobile**

In `ExploreClient.tsx`, conditionally render ProductSidebar (desktop) vs BottomPanel (tablet/mobile) based on viewport width. Use a simple `useMediaQuery` or `window.innerWidth` check.

- [ ] **Step 4: Verify on mobile viewport**

Open browser DevTools, toggle mobile view (375px width). Verify bottom panel appears instead of sidebar.

- [ ] **Step 5: Commit**

```bash
git add components/explore/BottomPanel.tsx lib/explore/use-bottom-sheet.ts components/explore/ExploreClient.tsx
git commit -m "feat(explore): add bottom panel for tablet/mobile with snap points and tabs"
```

---

## Task 15: SearchOverlay

**Files:**
- Create: `components/explore/SearchOverlay.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create SearchOverlay**

Create `components/explore/SearchOverlay.tsx`:

```typescript
'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, X, MapPin, Globe, Layers } from 'lucide-react'
import { ExploreTaxonomy, DrillLevel } from '@/lib/explore/types'
import { searchLocations } from '@/lib/explore/taxonomy-utils'

interface SearchOverlayProps {
  isOpen: boolean
  taxonomy: ExploreTaxonomy
  onClose: () => void
  onSelect: (href: string) => void
}

const LEVEL_ICONS: Record<DrillLevel, typeof Globe> = {
  world: Globe,
  country: Globe,
  region: MapPin,
  subregion: Layers,
  appellation: Layers,
}

export function SearchOverlay({ isOpen, taxonomy, onClose, onSelect }: SearchOverlayProps) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => searchLocations(query, taxonomy), [query, taxonomy])

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIdx(0)
    }
  }, [isOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { setSelectedIdx(i => Math.min(i + 1, results.length - 1)); e.preventDefault(); return }
    if (e.key === 'ArrowUp') { setSelectedIdx(i => Math.max(i - 1, 0)); e.preventDefault(); return }
    if (e.key === 'Enter' && results[selectedIdx]) {
      onSelect(results[selectedIdx].href)
      onClose()
    }
  }, [results, selectedIdx, onClose, onSelect])

  if (!isOpen) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center bg-[#0a0a1a]/90 backdrop-blur-sm pt-20 px-4">
      {/* Search input */}
      <div className="w-full max-w-lg relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
          onKeyDown={handleKeyDown}
          placeholder="Search countries and regions..."
          className="w-full rounded-xl bg-white/[0.06] border border-white/[0.1] pl-12 pr-12 py-3 text-white placeholder:text-white/30 outline-none focus:border-white/20"
        />
        <button onClick={onClose} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="w-full max-w-lg mt-2 rounded-xl bg-[#12121f] border border-white/[0.06] overflow-hidden">
          {results.map((r, i) => {
            const Icon = LEVEL_ICONS[r.type]
            return (
              <button
                key={`${r.type}-${r.slug}`}
                onClick={() => { onSelect(r.href); onClose() }}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left transition-colors ${
                  i === selectedIdx ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="h-4 w-4 text-white/30 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{r.name}</p>
                  {r.parentName && <p className="text-xs text-white/40">{r.parentName}</p>}
                </div>
                <span className="ml-auto text-xs text-white/30 flex-shrink-0">{r.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {query && results.length === 0 && (
        <p className="mt-4 text-sm text-white/30">No regions found for "{query}"</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire search into ExploreClient**

Add search state and wire the overlay in `ExploreClient.tsx`:

```typescript
import { SearchOverlay } from './SearchOverlay'

const [searchOpen, setSearchOpen] = useState(false)

// Wire the search icon button:
<button onClick={() => setSearchOpen(true)} ...>

// Add the overlay:
<SearchOverlay
  isOpen={searchOpen}
  taxonomy={taxonomy}
  onClose={() => setSearchOpen(false)}
  onSelect={(href) => router.push(href, { scroll: false })}
/>
```

- [ ] **Step 3: Verify in browser**

Click search icon → overlay appears → type "Burg" → see "Burgundy — France" in results → click or press Enter → map flies to Burgundy.

- [ ] **Step 4: Commit**

```bash
git add components/explore/SearchOverlay.tsx components/explore/ExploreClient.tsx
git commit -m "feat(explore): add region search overlay with keyboard navigation"
```

---

## Task 16: EmptyState & OnboardingHint

**Files:**
- Create: `components/explore/EmptyState.tsx`
- Create: `components/explore/OnboardingHint.tsx`
- Modify: `components/explore/ExploreClient.tsx`

- [ ] **Step 1: Create EmptyState**

Create `components/explore/EmptyState.tsx`:

```typescript
import { MapPin } from 'lucide-react'
import { CategoryKey } from '@/lib/explore/types'

interface EmptyStateProps {
  category: CategoryKey | null
  locationName: string
  suggestedHref?: string
  suggestedName?: string
}

export function EmptyState({ category, locationName, suggestedHref, suggestedName }: EmptyStateProps) {
  const categoryLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : 'products'

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <MapPin className="h-10 w-10 text-white/15" />
      <p className="text-sm text-white/50">No {categoryLabel} from {locationName}</p>
      {suggestedHref && suggestedName && (
        <a href={suggestedHref} className="text-sm text-[#4A90D9] hover:underline">
          Explore {suggestedName} for {categoryLabel} →
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create OnboardingHint**

Create `components/explore/OnboardingHint.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { MousePointerClick } from 'lucide-react'

export function OnboardingHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = localStorage.getItem('explore-onboarding-seen')
    if (seen) return

    setVisible(true)
    const timer = setTimeout(() => {
      setVisible(false)
      localStorage.setItem('explore-onboarding-seen', 'true')
    }, 5000)

    const handleInteraction = () => {
      setVisible(false)
      localStorage.setItem('explore-onboarding-seen', 'true')
      clearTimeout(timer)
    }

    window.addEventListener('click', handleInteraction, { once: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handleInteraction)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-white/[0.08] backdrop-blur-sm border border-white/[0.1] px-4 py-2 animate-fade-in">
      <MousePointerClick className="h-4 w-4 text-white/60" />
      <span className="text-sm text-white/70">Tap a country to start exploring</span>
    </div>
  )
}
```

- [ ] **Step 3: Add fade-in animation to globals.css**

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.4s ease-out;
}
```

- [ ] **Step 4: Wire into ExploreClient**

```typescript
import { OnboardingHint } from './OnboardingHint'

// Add after the map:
{mapState.drillLevel === 'world' && <OnboardingHint />}
```

- [ ] **Step 5: Commit**

```bash
git add components/explore/EmptyState.tsx components/explore/OnboardingHint.tsx components/explore/ExploreClient.tsx app/globals.css
git commit -m "feat(explore): add empty state redirects and first-visit onboarding hint"
```

---

## Task 17: Final Integration & Polish

**Files:**
- Modify: `components/explore/ExploreClient.tsx` (final wiring)
- Modify: `components/explore/ExploreMap.tsx` (Esc key, click-outside)

- [ ] **Step 1: Add keyboard shortcuts**

In `ExploreClient.tsx`, add global keyboard listener:

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchOpen) { setSearchOpen(false); return }
      if (regionCard) { setRegionCard(null); return }
      if (sidebarState === 'visible') { setSidebarState('hidden'); return }
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [searchOpen, regionCard, sidebarState])
```

- [ ] **Step 2: Add click-outside-to-dismiss for RegionCard**

Wrap the map click handler to dismiss the card when clicking empty space.

- [ ] **Step 3: Wire zoom controls to map ref**

Pass a ref from ExploreMap up to ExploreClient, or use a callback to expose `zoomIn()` / `zoomOut()` methods.

- [ ] **Step 4: Verify full flow in browser**

Test the complete flow:
1. Visit `/explore` → world map with onboarding hint
2. Click France → fly-to France, regions appear
3. Click Burgundy marker → region card appears
4. Click "Explore Products →" → sidebar slides in with product list
5. Click breadcrumb "World" → fly back to world view
6. Switch to "Spirits" category → map highlights spirit-producing countries
7. Click Scotland → fly-to Scotland, whisky regions appear
8. Press Esc → dismiss whatever is open
9. Click search → type "Napa" → select → fly to Napa Valley
10. Test on mobile viewport → bottom panel instead of sidebar

- [ ] **Step 5: Run typecheck**

Run:
```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(explore): final integration — keyboard shortcuts, click-outside, zoom controls"
```

---

## Task 18: Cleanup & Production Readiness

- [ ] **Step 1: Remove spec-preview files (temporary)**

```bash
rm -f "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/public/spec-preview.html"
rm -f "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/public/spec-preview.md"
```

- [ ] **Step 2: Add next.config.js Mapbox GL CSS import**

If Mapbox CSS fails to load via the import in ExploreMap, add it to `app/explore/layout.tsx`:

```typescript
import 'mapbox-gl/dist/mapbox-gl.css'
```

- [ ] **Step 3: Verify production build**

Run:
```bash
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(explore): cleanup and production build verification"
```

---

## Summary

| Task | Description | Key Files |
|------|------------|-----------|
| 1 | Dependencies & Tailwind config | package.json, tailwind.config.ts |
| 2 | Types & category config | lib/explore/types.ts, category-config.ts |
| 3 | Taxonomy utilities | lib/explore/taxonomy-utils.ts |
| 4 | Map config & style | lib/explore/map-config.ts, map-style.ts |
| 5 | Data scripts (geocoding + builder) | scripts/*.ts |
| 6 | Country boundaries GeoJSON | public/countries-110m.geojson |
| 7 | Placeholder images | public/images/placeholders/*.svg |
| 8 | Products API endpoint | app/api/explore/products/route.ts |
| 9 | Route pages & client shell | app/explore/**, ExploreClient.tsx |
| 10 | Mapbox map component | ExploreMap.tsx |
| 11 | Category lens, breadcrumb, zoom | CategoryLens, Breadcrumb, ZoomControls |
| 12 | Floating region card | RegionCard.tsx |
| 13 | Product sidebar | ProductCard, ProductSidebar |
| 14 | Bottom panel (tablet/mobile) | BottomPanel, useBottomSheet |
| 15 | Search overlay | SearchOverlay.tsx |
| 16 | Empty states & onboarding | EmptyState, OnboardingHint |
| 17 | Final integration & polish | Keyboard, click-outside, zoom wiring |
| 18 | Cleanup & production build | Remove temp files, verify build |
