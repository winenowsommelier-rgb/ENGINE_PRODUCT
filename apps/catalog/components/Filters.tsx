'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
// Import the const from the PURE (no-fs) constants module: this is a client component,
// and lib/category-groups → lib/sku-taxonomy imports `fs`, which cannot resolve in the
// browser bundle. category-constants holds the same canonical CATEGORY_GROUPS.
import { CATEGORY_GROUPS } from '@/lib/category-constants';
import { PRICE_TIERS } from '@/lib/price-tiers';
import { buildQuery } from '@/lib/build-query';
import { clearDescendants } from '@/lib/drill-query';
import type { FacetOption } from '@/lib/facets';
import { SearchableSelect } from './SearchableSelect';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Filters — the shop's filter/sort bar. CLIENT component: it reads the current
 * filters from the URL (useSearchParams) and writes changes back to the URL
 * (router.push) so filters are shareable, bookmarkable, and survive refresh.
 *
 * IMPORTANT (Next.js): useSearchParams() requires a <Suspense> boundary. The
 * consuming shop page (Task 10) MUST render <Filters/> inside <Suspense>, e.g.
 *   <Suspense fallback={null}><Filters countries={...} /></Suspense>
 * Rendered standalone this still won't crash — useSearchParams returns an empty
 * set rather than throwing.
 *
 * The URL is the single source of truth. We don't keep filter state locally
 * (only the "More filters" expander's open/closed is local UI state). All the
 * query-string math lives in the pure buildQuery() helper so it's unit-tested.
 *
 * Maison styling: calm chips, 44px targets, 18px base. Advanced filters stay
 * hidden behind "More filters" so the default view reads uncluttered for the
 * 40+ audience.
 */

interface FiltersProps {
  /** Distinct country values to offer in the Country dropdown (built upstream). */
  countries: string[];
  /** Sub-category options for the active group (computed server-side). */
  availableSubCategories?: FacetOption[];
  /** Region options for the active country (computed server-side). */
  availableRegions?: FacetOption[];
  /** Sub-region options for the active region (computed server-side). */
  availableSubRegions?: FacetOption[];
  /** Capped grape typeahead options. */
  grapeOptions?: string[];
  /** Capped flavor typeahead options. */
  flavorOptions?: string[];
  /** Normalized body scale values, e.g. ['Light','Medium','Medium-Full','Full']. */
  bodyOptions?: string[];
  /** Normalized acidity scale values, e.g. ['Low','Medium','Medium-High','High']. */
  acidityOptions?: string[];
  /** Normalized tannin scale values, e.g. ['Low','Medium','Medium-High','High']. */
  tanninOptions?: string[];
  /**
   * Optional seed for the current params — handy when rendering standalone /
   * in tests. In the live app the URL (useSearchParams) is authoritative.
   */
  initialParams?: Record<string, string>;
}

/** Sentinel for the "Any" item in scale Selects (Radix items need a non-empty value). */
const ANY = '__any__';

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'name', label: 'Name A–Z' },
  { id: 'price-asc', label: 'Price: low → high' },
  { id: 'price-desc', label: 'Price: high → low' },
];

/** A calm pill/chip for single-select filters (category, price, drill-down). */
function Chip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Optional facet count rendered as a muted suffix (drill-down chip rows). */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[44px] items-center rounded-full border px-4 text-base transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:border-primary hover:text-primary',
      )}
    >
      {children}
      {count !== undefined ? (
        <span className="ml-1 text-sm opacity-70">{count}</span>
      ) : null}
    </button>
  );
}

export function Filters({
  countries,
  availableSubCategories = [],
  availableRegions = [],
  availableSubRegions = [],
  grapeOptions = [],
  flavorOptions = [],
  bodyOptions = [],
  acidityOptions = [],
  tanninOptions = [],
  initialParams,
}: FiltersProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // URL is authoritative; fall back to initialParams (standalone/tests).
  const current: URLSearchParams =
    searchParams && searchParams.toString()
      ? new URLSearchParams(searchParams.toString())
      : new URLSearchParams(initialParams ?? {});

  const get = (key: string) => current.get(key) ?? '';

  /** Apply a patch to the URL via the pure helper, then navigate. */
  const apply = (patch: Record<string, string | null>) => {
    const qs = buildQuery(current, patch);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  /** Toggle a single-select chip: clicking the active value clears it. */
  const toggle = (key: string, value: string) => {
    apply({ [key]: get(key) === value ? null : value });
  };

  const activeGroup = get('group');
  const activeClass = get('class');
  const activePrice = get('price');
  const activeCountry = get('country');
  const activeRegion = get('region');
  const activeSubRegion = get('subregion');
  const inStockOnly = get('inStock') === '1';
  const activeSort = get('sort');
  const hasScoreOnly = get('hasScore') === '1';

  const sortLabel =
    SORT_OPTIONS.find((s) => s.id === activeSort)?.label ?? 'Sort';

  const hasAnyFilter = Array.from(current.keys()).length > 0;

  return (
    <section aria-label="Product filters" className="flex flex-col gap-4">
      {/* Category group chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {CATEGORY_GROUPS.map((group) => (
          <Chip
            key={group}
            active={activeGroup === group}
            onClick={() =>
              apply(
                clearDescendants(
                  'group',
                  activeGroup === group ? null : group,
                ),
              )
            }
          >
            {group}
          </Chip>
        ))}
      </div>

      {/* Sub-category drill-down (progressive reveal): only when a group is set
          AND the upstream-computed option list is non-empty. */}
      {activeGroup && availableSubCategories.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Sub-category"
        >
          {availableSubCategories.map((opt) => (
            <Chip
              key={opt.value}
              active={activeClass === opt.value}
              count={opt.count}
              onClick={() =>
                apply(
                  clearDescendants(
                    'class',
                    activeClass === opt.value ? null : opt.value,
                  ),
                )
              }
            >
              {opt.value}
            </Chip>
          ))}
        </div>
      ) : null}

      {/* Price tier chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Price">
        {PRICE_TIERS.map((tier) => (
          <Chip
            key={tier.id}
            active={activePrice === tier.id}
            onClick={() => toggle('price', tier.id)}
          >
            {tier.label}
          </Chip>
        ))}
      </div>

      {/* Country / sort / in-stock / clear row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Country dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-background px-4 text-base',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeCountry ? 'text-primary' : 'text-foreground',
            )}
          >
            {activeCountry || 'Country'}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Country</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => apply(clearDescendants('country', null))}
            >
              All countries
            </DropdownMenuItem>
            {countries.map((country) => (
              <DropdownMenuItem
                key={country}
                onClick={() => apply(clearDescendants('country', country))}
              >
                {country}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-background px-4 text-base',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeSort ? 'text-primary' : 'text-foreground',
            )}
          >
            {sortLabel}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SORT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => apply({ sort: opt.id })}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* In-stock-only toggle */}
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-foreground">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => apply({ inStock: e.target.checked ? '1' : null })}
            className="h-5 w-5 rounded border-border accent-[hsl(var(--primary))]"
          />
          In stock only
        </label>

        {/* More filters toggle */}
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className={cn(
            'inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-background px-4 text-base text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          More filters
        </button>

        {/* Clear all — only when something is set */}
        {hasAnyFilter ? (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 text-base text-muted-foreground',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear all
          </button>
        ) : null}
      </div>

      {/* Region drill-down (progressive reveal): only when a country is set
          AND the upstream-computed option list is non-empty. */}
      {activeCountry && availableRegions.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Region">
          {availableRegions.map((opt) => (
            <Chip
              key={opt.value}
              active={activeRegion === opt.value}
              count={opt.count}
              onClick={() =>
                apply(
                  clearDescendants(
                    'region',
                    activeRegion === opt.value ? null : opt.value,
                  ),
                )
              }
            >
              {opt.value}
            </Chip>
          ))}
        </div>
      ) : null}

      {/* Sub-region drill-down: only when a region is set AND options exist. */}
      {activeRegion && availableSubRegions.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Sub-region"
        >
          {availableSubRegions.map((opt) => (
            <Chip
              key={opt.value}
              active={activeSubRegion === opt.value}
              count={opt.count}
              onClick={() =>
                apply(
                  clearDescendants(
                    'subregion',
                    activeSubRegion === opt.value ? null : opt.value,
                  ),
                )
              }
            >
              {opt.value}
            </Chip>
          ))}
        </div>
      ) : null}

      {/* Advanced / "More filters" — hidden until expanded */}
      {advancedOpen ? (
        <div
          className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-4"
          aria-label="Advanced filters"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Grape: high-cardinality typeahead (region now lives in drill-down chips). */}
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Grape
              <SearchableSelect
                label="Grape"
                value={get('grape')}
                options={grapeOptions}
                onSelect={(v) => apply({ grape: v })}
                placeholder="Search grape…"
              />
            </label>

            {/* Flavor: high-cardinality typeahead. */}
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Flavor
              <SearchableSelect
                label="Flavor"
                value={get('flavor')}
                options={flavorOptions}
                onSelect={(v) => apply({ flavor: v })}
                placeholder="Search flavor…"
              />
            </label>

            <ScaleSelect
              label="Body"
              paramKey="body"
              value={get('body')}
              options={bodyOptions}
              onChange={apply}
            />
            <ScaleSelect
              label="Acidity"
              paramKey="acidity"
              value={get('acidity')}
              options={acidityOptions}
              onChange={apply}
            />
            <ScaleSelect
              label="Tannin"
              paramKey="tannin"
              value={get('tannin')}
              options={tanninOptions}
              onChange={apply}
            />
          </div>

          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-foreground">
            <input
              type="checkbox"
              checked={hasScoreOnly}
              onChange={(e) =>
                apply({ hasScore: e.target.checked ? '1' : null })
              }
              className="h-5 w-5 rounded border-border accent-[hsl(var(--primary))]"
            />
            Critic-scored only
          </label>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Controlled shadcn Select for a normalized taste scale (body / acidity /
 * tannin). The trigger shows the current value or "Any {label}". A sentinel
 * "Any" item at the top clears the param (Radix items require a non-empty
 * value, hence ANY). Writes go through the parent's apply() — URL stays the
 * single source of truth.
 */
function ScaleSelect({
  label,
  paramKey,
  value,
  options,
  onChange,
}: {
  label: string;
  paramKey: string;
  value: string;
  options: string[];
  onChange: (patch: Record<string, string | null>) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
      {label}
      <Select
        value={value || ANY}
        onValueChange={(v) =>
          onChange({ [paramKey]: v === ANY ? null : v })
        }
      >
        <SelectTrigger
          aria-label={label}
          className="min-h-[44px] h-auto text-base text-foreground"
        >
          <SelectValue placeholder={`Any ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{`Any ${label.toLowerCase()}`}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
