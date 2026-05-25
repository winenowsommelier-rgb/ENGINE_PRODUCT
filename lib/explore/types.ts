/* ──────────────────────────────────────────────────
   Type definitions for the interactive map explorer
   ────────────────────────────────────────────────── */

export interface Counts {
  wine: number;
  spirits: number;
  beer: number;
  sake: number;
  total: number;
}

export interface PriceRange {
  min: number | null;
  max: number | null;
}

export interface TaxCountry {
  id: number;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  scopes: string[];
  counts: Counts;
  priceRange: PriceRange;
}

export interface TaxRegion {
  id: number;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  parentId: number;
  parentSlug: string;
  scopes: string[];
  counts: Counts;
  priceRange: PriceRange;
  description?: string;
  keyGrapes?: string[];
  keyStyles?: string[];
  nonGeographic?: boolean;
}

export interface TaxSubregion {
  id: number;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  parentId: number;
  parentSlug: string;
  grandparentId: number;
  grandparentSlug: string;
  scopes: string[];
  counts: Counts;
  priceRange: PriceRange;
  nonGeographic?: boolean;
}

export interface TaxAppellation {
  id: number;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  scopes: string[];
  counts: Counts;
  priceRange: PriceRange;
  nonGeographic?: boolean;
}

export interface ExploreTaxonomy {
  _meta: {
    generated: string;
    counts: Record<string, number>;
    productStats: Record<string, number>;
    nonGeographicEntries: string[];
  };
  countries: TaxCountry[];
  regions: TaxRegion[];
  subregions: TaxSubregion[];
  appellations: TaxAppellation[];
}

export type CategoryScope = "wine" | "spirits" | "beer" | "sake";

export type DrillLevel = "world" | "country" | "region" | "subregion" | "appellation";

export interface MapViewState {
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface BreadcrumbItem {
  label: string;
  slug: string;
  href: string;
}

export interface ExploreProduct {
  id: string;
  sku: string;
  name: string;
  brand: string;
  classification: string;
  grape_variety?: string;
  vintage?: string;
  price: number;
  currency: string;
  wine_color?: string;
  image_url?: string;
  country: string;
  region: string;
  subregion?: string;
  desc_en_short?: string;
  wine_body?: string;
  wine_acidity?: string;
  wine_tannin?: string;
  flavor_tags?: string;
  food_matching?: string;
  // v2 taste taxonomy — null when not yet enriched or out-of-scope classification.
  // Discriminated by `structure: "tiered" | "flat"`; see components/product/TasteProfileSection.tsx
  taste_profile?: unknown;
}
