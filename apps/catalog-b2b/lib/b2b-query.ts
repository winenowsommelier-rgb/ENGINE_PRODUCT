/**
 * b2b-query — pure filter/sort/paginate engine for the B2B catalog page.
 * No Next or React imports. Operates on B2BProduct[] + plain URL params.
 */

import type { B2BProduct } from './types';

export const B2B_PAGE_SIZE = 48;

export type SortKey = 'recommended' | 'name' | 'price-asc' | 'price-desc';

export type B2BParams = Record<string, string | string[] | undefined>;

export interface B2BQueryResult {
  items: B2BProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  pageItems: B2BProduct[];
}

export interface FacetOption {
  value: string;
  count: number;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

export const B2B_PRICE_TIERS = [
  { id: 'under-1000', label: 'Under ฿1,000', min: 0, max: 1000 },
  { id: '1000-3000', label: '฿1,000–3,000', min: 1000, max: 3000 },
  { id: '3000-7000', label: '฿3,000–7,000', min: 3000, max: 7000 },
  { id: '7000-15000', label: '฿7,000–15,000', min: 7000, max: 15000 },
  { id: '15000-plus', label: '฿15,000+', min: 15000, max: Infinity },
] as const;

function tierById(id: string) {
  return B2B_PRICE_TIERS.find((t) => t.id === id);
}

/**
 * Single per-product predicate. AND across all params; absent param = no constraint.
 * Both the grid and facet counters call this so they can never disagree.
 */
export function matchesFilters(p: B2BProduct, params: B2BParams): boolean {
  const group = first(params.group);
  if (group && p.category_group !== group) return false;

  const klass = norm(first(params.class));
  if (klass && norm(p.category_type) !== klass) return false;

  const priceId = first(params.price);
  const tier = priceId ? tierById(priceId) : undefined;
  if (tier) {
    const price = p.b2b_price;
    if (typeof price !== 'number' || Number.isNaN(price)) return false;
    if (price < tier.min || price >= tier.max) return false;
  }

  const country = norm(first(params.country));
  if (country && norm(p.country) !== country) return false;

  const region = norm(first(params.region));
  if (region && norm(p.region) !== region) return false;

  if (first(params.inStock) === '1' && !p.is_in_stock) return false;
  if (first(params.hasScore) === '1' &&
      !(typeof p.score_summary === 'string' && p.score_summary.trim() !== '')) return false;

  return true;
}

function omit(params: B2BParams, ...keys: string[]): B2BParams {
  const copy: B2BParams = { ...params };
  for (const k of keys) delete copy[k];
  return copy;
}

function tally(products: B2BProduct[], key: (p: B2BProduct) => string | null | undefined): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const v = (key(p) ?? '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));
}

export interface B2BFacets {
  groups: FacetOption[];
  subCategories: FacetOption[];
  countries: FacetOption[];
  regions: FacetOption[];
}

export function buildFacets(all: B2BProduct[], params: B2BParams): B2BFacets {
  const activeGroup = first(params.group);
  const activeCountry = first(params.country);

  const groupSet = all.filter((p) => matchesFilters(p, omit(params, 'group', 'class')));
  const groups = tally(groupSet, (p) => p.category_group);

  let subCategories: FacetOption[] = [];
  if (activeGroup) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'class')));
    subCategories = tally(set.filter((p) => p.category_group === activeGroup), (p) => p.category_type);
  }

  const countrySet = all.filter((p) => matchesFilters(p, omit(params, 'country', 'region')));
  const countries = tally(countrySet, (p) => p.country);

  let regions: FacetOption[] = [];
  if (activeCountry) {
    const set = all.filter((p) => matchesFilters(p, omit(params, 'region')));
    regions = tally(set.filter((p) => norm(p.country) === norm(activeCountry)), (p) => p.region);
  }

  return { groups, subCategories, countries, regions };
}

const SORTS: Record<string, SortKey> = {
  recommended: 'recommended',
  name: 'name',
  'price-asc': 'price-asc',
  'price-desc': 'price-desc',
};

export function applyB2BQuery(products: B2BProduct[], params: B2BParams): B2BQueryResult {
  const items = products.filter((p) => matchesFilters(p, params));

  const rawSort = first(params.sort) ?? '';
  const sortKey: SortKey = Object.prototype.hasOwnProperty.call(SORTS, rawSort) ? SORTS[rawSort] : 'recommended';
  const sorted = [...items];
  if (sortKey === 'name') {
    sorted.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }));
  } else if (sortKey === 'price-asc') {
    sorted.sort((a, b) => (a.b2b_price ?? Infinity) - (b.b2b_price ?? Infinity));
  } else if (sortKey === 'price-desc') {
    sorted.sort((a, b) => (b.b2b_price ?? -Infinity) - (a.b2b_price ?? -Infinity));
  }

  const total = sorted.length;
  const pageSize = B2B_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rawPage = Number.parseInt(first(params.page) ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1
    ? Math.min(rawPage, totalPages)
    : 1;
  const start = (page - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  return { items: sorted, total, page, pageSize, totalPages, pageItems };
}

export function buildQuery(current: URLSearchParams | Record<string, string>, patch: Record<string, string | null>): string {
  const params = current instanceof URLSearchParams
    ? new URLSearchParams(current.toString())
    : new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') params.delete(k);
    else params.set(k, v);
  }
  return params.toString();
}
