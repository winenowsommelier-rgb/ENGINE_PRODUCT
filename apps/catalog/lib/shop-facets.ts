import type { PublicProduct } from './types';
import type { ShopParams } from './shop-query';
import { matchesFilters } from './shop-query';
import {
  subCategoriesFor, accessorySubCategoriesFor, groupsFor, countriesFor, regionsFor, subRegionsFor, designationsFor, type FacetOption,
} from './facets';
import { type CategoryGroup, CATEGORY_GROUPS } from './category-groups';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Return a SHALLOW COPY of params with the given keys removed. Stays typed as
 * ShopParams (no `as Record<string, unknown>` cast) so matchesFilters keeps its
 * type safety. `class` is a contextual keyword but a perfectly legal object key.
 */
function omit(params: ShopParams, ...keys: string[]): ShopParams {
  const copy: ShopParams = { ...params };
  for (const k of keys) delete copy[k];
  return copy;
}

export interface ShopFacets {
  groups: FacetOption[];
  countries: FacetOption[];
  subCategories: FacetOption[];
  regions: FacetOption[];
  subRegions: FacetOption[];
  designations: FacetOption[];
}

/** Build the drill-down option lists per design §4.1 input-set table. */
export function shopFacets(all: PublicProduct[], params: ShopParams): ShopFacets {
  const group = first(params.group) as CategoryGroup | undefined;
  const country = first(params.country);
  const region = first(params.region);

  // groups: apply everything EXCEPT the category strand (group + class), so each
  // group chip's count reflects the OTHER active filters (country/price/taste)
  // and picking a group doesn't zero out its siblings.
  const groupSet = all.filter((p) => matchesFilters(p, omit(params, 'group', 'class')));
  const groups = groupsFor(groupSet);

  // countries: apply everything EXCEPT the geo strand, so each chip's count
  // reflects what's available under the current non-geo filters (group/price/
  // taste) — and stays stable as the user picks a country.
  const countrySet = all.filter((p) =>
    matchesFilters(p, omit(params, 'country', 'region', 'subregion')),
  );
  const countries = countriesFor(countrySet);

  // subCategories: apply everything EXCEPT `class`.
  let subCategories: FacetOption[] = [];
  if (group && (CATEGORY_GROUPS as readonly string[]).includes(group)) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'class')));
    subCategories = group === 'Accessories'
      ? accessorySubCategoriesFor(set)
      : subCategoriesFor(group, set);
  }

  // regions: apply everything EXCEPT region + subregion.
  let regions: FacetOption[] = [];
  if (country) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'region', 'subregion')));
    regions = regionsFor(country, set);
  }

  // subRegions: apply everything EXCEPT subregion.
  let subRegions: FacetOption[] = [];
  if (region) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'subregion')));
    subRegions = subRegionsFor(region, set);
  }

  // designations: apply everything EXCEPT designation, so each chip's count
  // reflects the OTHER active filters and selecting one doesn't zero its siblings.
  const designationSet = all.filter((p) => matchesFilters(p, omit(params, 'designation')));
  const designations = designationsFor(designationSet);

  return { groups, countries, subCategories, regions, subRegions, designations };
}

/** Top-N most frequent non-empty grape varietals across the catalog (single source for the typeahead seed). */
export function topGrapes(all: PublicProduct[], n = 40): string[] {
  return topByFrequency(all.map((p) => p.grape_variety), n);
}

/** Top-N most frequent non-empty flavor tags across the catalog. */
export function topFlavors(all: PublicProduct[], n = 50): string[] {
  const tags: (string | null | undefined)[] = [];
  for (const p of all) if (Array.isArray(p.flavor_tags)) tags.push(...p.flavor_tags);
  return topByFrequency(tags, n);
}

function topByFrequency(values: (string | null | undefined)[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, n)
    .map(([value]) => value);
}
