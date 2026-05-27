# Unified Product Detail Panel

**Date:** 2026-05-27  
**Branch:** feat/taste-taxonomy-v2  
**Status:** Approved

---

## Problem

Two separate product detail views exist in the app and have diverged:

1. **ProductsPage detail** (`components/pages/ProductsPage.tsx`) — rich ~12-card right panel with full enrichment data, BI analytics, data quality, descriptions, edit mode.
2. **ProductDetailCard** (`components/explore/ProductDetailCard.tsx`) — lightweight modal overlay for map/explore views; shows only: hero, badges, short description, radar chart, flavor tags, food pairing, v2 TasteProfileSection.

When a user clicks a product in the map (via `ProductSidebar` or `BottomPanel`), they see an incomplete detail view. The goal is: same page, same data, regardless of where you click.

---

## Goals

- Clicking a product anywhere in the app shows the same rich product detail.
- No duplication — one source of truth for the detail panel content.
- Explore view stays in-place (modal overlay remains; map context is not lost).
- New enrichment fields (`taste_profile`, `pairing_rationale`, `full_description`, `score_summary`, etc.) already returned by the explore API are rendered correctly.
- Graceful empty states for fields absent in explore context (e.g. BI affinities).

---

## Approach: Shared `ProductDetailPanel` component

Extract the detail panel content into a standalone shared component. Both the explore modal shell and the ProductsPage right panel render this component.

---

## Type Changes

**File:** `lib/explore/types.ts`

Extend `ExploreProduct` with the following optional fields (already fetched by the explore API, just not typed):

```ts
grape_blend_type?: string;
wine_production_style?: string;
score_max?: number;  // adapter narrows to number via Number() + isFinite(); never a string after adaptation
score_summary?: string;
full_description?: string;
// Internal/catalog fields (present when loaded from /api/products/:id):
wine_classification?: string;
bottle_size?: string | number;
alcohol?: string | number;
validation_status?: string;
overall_confidence?: number;
appellation?: string;
desc_en_full?: string;
description_en_html?: string;
short_description_th_wn?: string;
description_th_wn_text?: string;
description_th_wn_html?: string;
queue_priority?: number | string;
priority_band?: string;
bi_priority_band?: string;
product_tier?: string | number;
enrichment_priority?: string | number;
product_tier_definition?: string;
enrichment_note?: string;
is_primary_variant?: boolean;
sku_base?: string;
cost_price?: number;
```

**Adapter function:** `toExploreProduct(raw: Record<string, unknown>): ExploreProduct`

A simple cast helper in `lib/explore/adapters.ts` (new file — keeps `lib/explore/types.ts` domain-pure) that maps `ProductsPage`'s `Record<string, unknown>` to `ExploreProduct`. Does field narrowing via `String()`, `Number()`, and nullish coalescing. Numeric fields (`overall_confidence`, `cost_price`, `price`, `score_max`) are narrowed with `Number()` and validated with `isFinite()` before assignment — never passed as raw strings to avoid display bugs downstream.

---

## New Component: `ProductDetailPanel`

**File:** `components/product/ProductDetailPanel.tsx`

**Props:**
```ts
interface ProductDetailPanelProps {
  product: ExploreProduct;
  theme?: "dark" | "light";
  category?: CategoryScope | null;  // for accent colors (radar, badges, chips)
  // Optional extra data — only passed from ProductsPage context
  charDimensions?: CharDimension[];
  taxContextMap?: Map<string, string>;  // derived in ProductsPage, passed down
  relatedProducts?: RelatedProduct[];
  productAffinities?: ProductAffinities | null;
}
```

The `category` prop enables accent-coloured radar strokes, badge highlights, and flavor chip colours via `getAccent(category)` / `getAccentRgb(category)`. When absent (e.g. ProductsPage context), accent colours fall back to the violet defaults already used in ProductsPage today. `ProductDetailCard` forwards its existing `category` prop to `ProductDetailPanel`.

**Type sharing:** `CharDimension`, `RelatedProduct`, `AffinityItem`, and `ProductAffinities` are currently defined locally in `ProductsPage.tsx`. They must be extracted to `lib/explore/types.ts` and imported by both `ProductsPage` and `ProductDetailPanel` so the build does not break. (`lib/products/` already exists but is for field-validation/ownership logic — keeping product-catalogue types in `lib/explore/types.ts` keeps the import graph flat.)

**Visualization component casting:** `CharacterRadarChart`, `FlavorWheel`, `BodySweetnessMatrix`, `FoodPairingGrid`, `DataQualityGauge`, and `VintageTimeline` all accept `product: Record<string, unknown>`. `ProductDetailPanel` holds `product: ExploreProduct`. Pass as `product as Record<string, unknown>` at each call site — do not change the visualization component signatures.

**Origin card interactivity:** The Origin card breadcrumb buttons in `ProductsPage` currently call `setCountry` / `setRegion` / `setAppellation` to filter the list. `ProductDetailPanel` has no access to those callbacks. The Origin card in the panel renders location values as **plain non-interactive text** (no buttons, no filter callbacks). The filter-by-location feature stays as-is in the ProductsPage header bar and is not part of this refactor.

**`taxContextMap` guard:** `taxContextMap` is an optional prop (undefined in explore context). All access in the panel must use optional chaining: `(taxContextMap?.size ?? 0) > 0` and `taxContextMap ? Array.from(taxContextMap.entries()) : []`. Never call `.size` or `.entries()` without the guard.

**Sections rendered (in order):**

| # | Card | Source data | Empty state |
|---|------|-------------|-------------|
| 1 | Hero (image, name, brand, vintage, price, bottle, status, confidence bar) | core fields | `--` for missing |
| 2 | Origin (country/region/subregion/appellation breadcrumb + taxonomy contexts) | core fields | "Origin unknown" |
| 3 | Character Profile (dynamic radar via `CharacterRadarChart`) | wine_body/acidity/tannin + charDimensions | graceful empty |
| 4 | Style Position matrix (`BodySweetnessMatrix`) | wine_body, sweetness | graceful empty |
| 5 | Flavor Wheel (`FlavorWheel`) | flavor_tags | "No flavor data yet" |
| 6 | Food Pairing Grid (`FoodPairingGrid`) | food_matching | "No pairing data yet" |
| 7 | Descriptions (EN/TH, text/preview/HTML tabs) | desc_en_short, full_description / desc_en_full, description_en_html, TH variants | "Pending enrichment" |
| 8 | Vintage Timeline (`VintageTimeline`) | vintage | hidden when no vintage |
| 9 | BI Priority | product_tier/enrichment_priority + definition | "Not tiered" |
| 10 | Taste Profile v2 (`TasteProfileSection`) | taste_profile | feature-flagged; null when off or no data |
| 11 | Similar Products Rail (`SimilarProductsRail`) | productId | returns null when no data |
| 12 | BI Affinities | productAffinities prop | "No BI affinity data available" |
| 13 | Comparable Products | relatedProducts prop | "No comparable SKU cluster found yet" |
| 14 | Data Quality (`DataQualityGauge`) | validation_status, overall_confidence | always shown |

Cards 12 and 13 render their empty states when no data is passed (i.e. in explore context). They are **not hidden** — the user sees the same empty state message they would see in the catalog view for a product with no BI data. Note: in catalog context the empty state appears after a fetch returns no results; in explore context the fetch is not made and the empty state is immediate. The visual output is identical when data is absent.

**Theming:**  
All dark/light conditional class strings follow the same pattern as `ProductDetailCard` today. The `theme` prop defaults to `"dark"` (explore context) and can be overridden.

**Scrolling:**  
The panel is a plain `<div className="flex-col space-y-5 px-6 py-5">` — no fixed height, no `max-w` on the panel itself. Width is controlled entirely by the host container:
- In `ProductsPage`: the right panel's `overflow-y-auto` div already has `max-w-4xl` applied at the wrapping level.
- In `ProductDetailCard`: the modal card enforces `max-w-[480px]`; the panel fills it naturally.

This removes the need for a `disableMaxWidth` prop — the panel is always 100% of its host width.

---

## Modified: `ProductDetailCard`

**File:** `components/explore/ProductDetailCard.tsx`

Becomes a thin modal shell. Retains:
- Backdrop overlay
- Modal card frame (max-h-[90vh], rounded, border, shadow)
- Close button (X + Escape key handler)
- Theme-aware class strings

Removes:
- All product data rendering JSX (hero, badges, radar, flavor tags, etc.)

Renders:
```tsx
<ProductDetailPanel product={product} theme={theme} category={category} />
```

---

## Modified: `ProductsPage`

**File:** `components/pages/ProductsPage.tsx`

In the right panel's `overflow-y-auto` section, the inline card JSX (Cards 1–14) is replaced with:
```tsx
<ProductDetailPanel
  product={toExploreProduct(selected)}
  theme="dark"
  charDimensions={charDimensions}
  taxContextMap={taxContextMap}
  relatedProducts={relatedProducts}
  productAffinities={productAffinities}
/>
```

The sticky header bar and Edit panel stay in `ProductsPage` (edit is catalog-only).

The `openProduct` function, pagination, filter, and edit logic are **unchanged**.

---

## Files Changed

| File | Change |
|---|---|
| `lib/explore/types.ts` | Add optional fields to `ExploreProduct`; extract `CharDimension`, `RelatedProduct`, `AffinityItem`, `ProductAffinities` types |
| `lib/explore/adapters.ts` | **New** — `toExploreProduct()` adapter function |
| `components/product/ProductDetailPanel.tsx` | **New** — shared detail panel |
| `components/explore/ProductDetailCard.tsx` | Slim down to modal shell; forward `category` to panel |
| `components/pages/ProductsPage.tsx` | Import shared types; replace inline detail JSX with `ProductDetailPanel` |

**No other files changed.** `ProductSidebar` and `BottomPanel` continue to use `ProductDetailCard` unchanged.

---

## Out of Scope

- Edit mode in explore view (stays in ProductsPage only)
- BI Affinities / Comparable Products data fetching in explore context (data is not available; cards show empty state)
- Taxonomy context descriptions in explore context (not fetched; Origin card renders without them)
- Mobile layout changes beyond what the current `ProductDetailCard` modal already handles

---

## Success Criteria

- [ ] Clicking a product in map (desktop sidebar or mobile bottom panel) opens the same rich detail as the Products catalog
- [ ] All enrichment fields from the explore API (`taste_profile`, `pairing_rationale`, `full_description`, etc.) render correctly in the modal
- [ ] ProductsPage detail panel renders identically to before (when the same data props are available)
- [ ] Dark and light themes both work in explore context; accent colors from `category` prop display correctly in the explore modal
- [ ] No TypeScript errors; `npm run build` passes
- [ ] `TasteProfileSection` still only renders when `NEXT_PUBLIC_TASTE_PROFILE_ENABLED=true`
- [ ] `ProductSidebar` and `BottomPanel` render correctly without code changes — only `ProductDetailCard` is modified
- [ ] `toExploreProduct` adapter does not corrupt numeric fields — `overall_confidence`, `price`, `cost_price`, `score_max` remain numbers after adaptation
- [ ] Mobile bottom-panel scroll and close behavior unchanged after `ProductDetailCard` refactor
- [ ] Panel has no `max-w` class of its own — width is 100% of host container in both ProductsPage and the explore modal
