/* ──────────────────────────────────────────────────
   Taxonomy data loading, slug lookup, hierarchy traversal
   ────────────────────────────────────────────────── */

import type {
  CategoryScope,
  DrillLevel,
  ExploreTaxonomy,
  TaxCountry,
  TaxRegion,
  TaxSubregion,
  TaxAppellation,
  BreadcrumbItem,
} from "./types";
import { CATEGORIES } from "./category-config";

// Static import of the explore taxonomy — loaded at build time
import taxonomyData from "@/data/taxonomy/explore-taxonomy.json";

const taxonomy = taxonomyData as ExploreTaxonomy;

// ── Indexes (built once) ────────────────────────

const countryBySlug = new Map<string, TaxCountry>();
const countryById = new Map<number, TaxCountry>();
for (const c of taxonomy.countries) {
  countryBySlug.set(c.slug, c);
  countryById.set(c.id, c);
}

const regionBySlug = new Map<string, TaxRegion>();
const regionById = new Map<number, TaxRegion>();
const regionsByCountryId = new Map<number, TaxRegion[]>();
for (const r of taxonomy.regions) {
  regionBySlug.set(r.slug, r);
  regionById.set(r.id, r);
  const list = regionsByCountryId.get(r.parentId) ?? [];
  list.push(r);
  regionsByCountryId.set(r.parentId, list);
}

const subBySlug = new Map<string, TaxSubregion>();
const subById = new Map<number, TaxSubregion>();
const subsByRegionId = new Map<number, TaxSubregion[]>();
for (const s of taxonomy.subregions) {
  subBySlug.set(s.slug, s);
  subById.set(s.id, s);
  const list = subsByRegionId.get(s.parentId) ?? [];
  list.push(s);
  subsByRegionId.set(s.parentId, list);
}

const appBySlug = new Map<string, TaxAppellation>();
const appsBySubregionId = new Map<number, TaxAppellation[]>();
for (const a of taxonomy.appellations) {
  appBySlug.set(a.slug, a);
  if (typeof (a as unknown as { parentId?: number }).parentId === "number") {
    const pid = (a as unknown as { parentId: number }).parentId;
    const list = appsBySubregionId.get(pid) ?? [];
    list.push(a);
    appsBySubregionId.set(pid, list);
  }
}

// ── Public API ──────────────────────────────────

export function getTaxonomy(): ExploreTaxonomy {
  return taxonomy;
}

export function getCountries(category: CategoryScope | null): TaxCountry[] {
  if (!category) return taxonomy.countries;
  return taxonomy.countries.filter((c) => c.counts[category] > 0);
}

export function getRegionsForCountry(countryId: number, category: CategoryScope | null): TaxRegion[] {
  const list = regionsByCountryId.get(countryId) ?? [];
  if (!category) return list.filter((r) => r.counts.total > 0 && !r.nonGeographic);
  return list.filter((r) => r.counts[category] > 0 && !r.nonGeographic);
}

export function getSubregionsForRegion(regionId: number, category: CategoryScope | null): TaxSubregion[] {
  const list = subsByRegionId.get(regionId) ?? [];
  if (!category) return list.filter((s) => !s.nonGeographic);
  return list;
}

export function getSubregionsForCountry(countryId: number, category: CategoryScope | null): TaxSubregion[] {
  const regions = regionsByCountryId.get(countryId) ?? [];
  return regions.flatMap((region) => getSubregionsForRegion(region.id, category));
}

export function getAppellationsForSubregion(subregionId: number): TaxAppellation[] {
  return appsBySubregionId.get(subregionId) ?? [];
}

export function findCountry(slug: string): TaxCountry | undefined {
  return countryBySlug.get(slug);
}

export function findRegion(slug: string): TaxRegion | undefined {
  return regionBySlug.get(slug);
}

export function findSubregion(slug: string): TaxSubregion | undefined {
  return subBySlug.get(slug);
}

export function findAppellation(slug: string): TaxAppellation | undefined {
  return appBySlug.get(slug);
}

export function getCountryById(id: number): TaxCountry | undefined {
  return countryById.get(id);
}

export function getRegionById(id: number): TaxRegion | undefined {
  return regionById.get(id);
}

/** Count for a location in a given category (or total) */
export function getCount(
  counts: { wine: number; spirits: number; beer: number; sake: number; total: number },
  category: CategoryScope | null
): number {
  if (!category) return counts.total;
  return counts[category];
}

// ── Slug Parsing ────────────────────────────────

export interface ParsedSlug {
  category: CategoryScope | null;
  country?: TaxCountry;
  region?: TaxRegion;
  subregion?: TaxSubregion;
  appellation?: TaxAppellation;
  drillLevel: DrillLevel;
  valid: boolean;
}

const CATEGORY_SET = new Set<string>(CATEGORIES.map((c) => c.key));

export function parseSlug(segments: string[]): ParsedSlug {
  if (!segments.length) {
    return { category: null, drillLevel: "world", valid: true };
  }

  let idx = 0;
  let category: CategoryScope | null = null;

  // First segment: category or country?
  if (CATEGORY_SET.has(segments[0])) {
    category = segments[0] as CategoryScope;
    idx = 1;
  }

  if (idx >= segments.length) {
    return { category, drillLevel: "world", valid: true };
  }

  // Country
  const country = findCountry(segments[idx]);
  if (!country) return { category, drillLevel: "world", valid: false };
  idx++;

  if (idx >= segments.length) {
    return { category, country, drillLevel: "country", valid: true };
  }

  // Region
  const region = findRegion(segments[idx]);
  if (!region) return { category, country, drillLevel: "country", valid: false };
  idx++;

  if (idx >= segments.length) {
    return { category, country, region, drillLevel: "region", valid: true };
  }

  // Subregion
  const subregion = findSubregion(segments[idx]);
  if (!subregion) return { category, country, region, drillLevel: "region", valid: false };
  idx++;

  if (idx >= segments.length) {
    return { category, country, region, subregion, drillLevel: "subregion", valid: true };
  }

  // Appellation
  const appellation = findAppellation(segments[idx]);
  if (!appellation) return { category, country, region, subregion, drillLevel: "subregion", valid: false };

  return { category, country, region, subregion, appellation, drillLevel: "appellation", valid: true };
}

// ── Breadcrumb Builder ──────────────────────────

export function buildBreadcrumbs(parsed: ParsedSlug): BreadcrumbItem[] {
  const base = "/explore";
  const catPrefix = parsed.category ? `/${parsed.category}` : "";
  const crumbs: BreadcrumbItem[] = [{ label: "World", slug: "", href: `${base}${catPrefix}` }];

  if (parsed.country) {
    crumbs.push({
      label: parsed.country.name,
      slug: parsed.country.slug,
      href: `${base}${catPrefix}/${parsed.country.slug}`,
    });
  }
  if (parsed.region) {
    crumbs.push({
      label: parsed.region.name,
      slug: parsed.region.slug,
      href: `${base}${catPrefix}/${parsed.country!.slug}/${parsed.region.slug}`,
    });
  }
  if (parsed.subregion) {
    crumbs.push({
      label: parsed.subregion.name,
      slug: parsed.subregion.slug,
      href: `${base}${catPrefix}/${parsed.country!.slug}/${parsed.region!.slug}/${parsed.subregion.slug}`,
    });
  }
  if (parsed.appellation) {
    crumbs.push({
      label: parsed.appellation.name,
      slug: parsed.appellation.slug,
      href: `${base}${catPrefix}/${parsed.country!.slug}/${parsed.region!.slug}/${parsed.subregion!.slug}/${parsed.appellation.slug}`,
    });
  }

  return crumbs;
}

// ── Search ──────────────────────────────────────

export interface SearchResult {
  type: "country" | "region" | "subregion";
  name: string;
  parentName?: string;
  slug: string;
  href: string;
  latitude: number;
  longitude: number;
  total: number;
}

export function searchLocations(query: string, category: CategoryScope | null, limit = 10): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const c of taxonomy.countries) {
    if (c.name.toLowerCase().includes(q)) {
      results.push({
        type: "country",
        name: c.name,
        slug: c.slug,
        href: `/explore${category ? `/${category}` : ""}/${c.slug}`,
        latitude: c.latitude,
        longitude: c.longitude,
        total: getCount(c.counts, category),
      });
    }
  }

  for (const r of taxonomy.regions) {
    if (r.nonGeographic) continue;
    if (r.name.toLowerCase().includes(q)) {
      const country = countryById.get(r.parentId);
      results.push({
        type: "region",
        name: r.name,
        parentName: country?.name,
        slug: r.slug,
        href: `/explore${category ? `/${category}` : ""}/${country?.slug}/${r.slug}`,
        latitude: r.latitude,
        longitude: r.longitude,
        total: getCount(r.counts, category),
      });
    }
  }

  for (const s of taxonomy.subregions) {
    if (s.nonGeographic) continue;
    if (s.name.toLowerCase().includes(q)) {
      const region = regionById.get(s.parentId);
      const country = countryById.get(s.grandparentId);
      results.push({
        type: "subregion",
        name: s.name,
        parentName: `${region?.name}, ${country?.name}`,
        slug: s.slug,
        href: `/explore${category ? `/${category}` : ""}/${country?.slug}/${region?.slug}/${s.slug}`,
        latitude: s.latitude,
        longitude: s.longitude,
        total: getCount(s.counts, category),
      });
    }
  }

  // Sort by total products descending, then by type priority
  const typePriority = { country: 0, region: 1, subregion: 2 };
  results.sort((a, b) => typePriority[a.type] - typePriority[b.type] || b.total - a.total);

  return results.slice(0, limit);
}
