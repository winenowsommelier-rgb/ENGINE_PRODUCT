'use client';

import React, { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Plus, X } from 'lucide-react';
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
  /** Distinct country values (fallback / standalone-tests). */
  countries: string[];
  /**
   * Category group options WITH SKU counts, most-stocked first. When provided,
   * the Category section renders the 2-row sliding chip rail (count badges)
   * instead of the bare CATEGORY_GROUPS list. Falls back to CATEGORY_GROUPS.
   */
  groupOptions?: FacetOption[];
  /**
   * Country options WITH SKU counts, most-stocked first. When provided, the
   * Origin section renders a horizontal country chip rail (count in the badge)
   * instead of a plain dropdown. Falls back to `countries` if absent.
   */
  countryOptions?: FacetOption[];
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

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'name', label: 'Name A–Z' },
  { id: 'price-asc', label: 'Price: low → high' },
  { id: 'price-desc', label: 'Price: high → low' },
];

/**
 * FilterAccordion — one collapsible filter group built on the native
 * <details>/<summary> element. Native gives us free keyboard support (Enter/
 * Space toggles), correct screen-reader semantics, and no JS/dependency cost.
 *
 * The summary is a 44px row showing the section name + a live summary of the
 * active selection (so you can read the state WITHOUT opening it) + a chevron
 * that rotates on open. "Smart auto-open": callers pass `defaultOpen` true when
 * the section already holds an active value, so arriving via a deep link
 * (?region=Champagne) reveals the relevant section and collapses the rest.
 *
 * `key={String(defaultOpen)}` forces a remount when the active-state flips, so
 * the uncontrolled <details> re-reads its defaultOpen (e.g. selecting a country
 * auto-opens Origin). Cheap: these subtrees are tiny.
 */
function FilterAccordion({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  /** Compact read-out of the active selection, shown in the closed header. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      key={String(defaultOpen)}
      open={defaultOpen}
      className="group rounded-lg border border-border bg-card transition-colors open:bg-muted/10 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        className={cn(
          'flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-2',
          'rounded-lg select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span className="text-base font-medium text-foreground">{label}</span>
        {summary ? (
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border/60 px-4 pb-4 pt-4">
        {children}
      </div>
    </details>
  );
}

/** A small pill that reads back an active selection in a collapsed accordion header. */
function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
      {children}
    </span>
  );
}

/**
 * ChipRow — a wrapping row of chips that caps long lists (e.g. France's ~25
 * regions) behind a "Show all N" expander so the open accordion never becomes a
 * wall. Below the cap it just renders everything.
 */
function ChipRow({
  cap = 12,
  ariaLabel,
  children,
}: {
  cap?: number;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const overflow = items.length > cap && !expanded;
  const shown = overflow ? items.slice(0, cap) : items;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {shown}
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            'inline-flex min-h-[44px] items-center gap-1 rounded-full border border-dashed border-border px-4 text-sm text-muted-foreground',
            'transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Show all {items.length}
        </button>
      ) : null}
    </div>
  );
}

/**
 * ChipRail — a horizontally-scrolling, 2-row rail of single-select chips, each
 * showing its SKU count. Used for the whole geography strand (Country / Region /
 * Sub-region): these lists are too long for one comfortable wrapping row, so we
 * pack them into two rows that slide right (overflow-x-auto + grid-flow-col).
 * Scanning + selecting in place beats a dropdown or an unbounded pill wall, and
 * because options arrive count-DESC the highest-stock entries lead the rail.
 */
function ChipRail({
  options,
  active,
  ariaLabel,
  onSelect,
}: {
  /** Either counted facets (geo) or plain string options (grape/flavor). */
  options: FacetOption[] | string[];
  active: string;
  ariaLabel: string;
  onSelect: (value: string | null) => void;
}) {
  const items = options.map((o) =>
    typeof o === 'string' ? { value: o, count: undefined } : o,
  );
  return (
    <div
      className={cn(
        'flex snap-x gap-2 overflow-x-auto pb-2',
        // Two rows that fill top-to-bottom, then advance a new column to the
        // right — turns a long list into a compact swipeable 2-row rail.
        'grid grid-flow-col grid-rows-2 auto-cols-max',
        // Slim, unobtrusive scrollbar; momentum scroll on touch.
        '[scrollbar-width:thin] [-webkit-overflow-scrolling:touch]',
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((opt) => {
        const isActive = active === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(isActive ? null : opt.value)}
            aria-pressed={isActive}
            className={cn(
              'inline-flex min-h-[44px] snap-start items-center gap-2 whitespace-nowrap rounded-full border px-4 text-base transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:border-primary hover:text-primary',
            )}
          >
            {opt.value}
            {opt.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-sm tabular-nums',
                  isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * GaugeSelect — a segmented "intensity gauge" for an ordered scale (Body /
 * Acidity / Tannin all share a 4-step low→high scale). The track is N connected
 * segments; selecting a level fills every segment up to and including it, so the
 * control reads as a strength meter rather than an opaque dropdown. Clicking the
 * active level clears it (back to "Any"). Keyboard: each segment is a button in
 * tab order; arrow-free, single-press selection keeps it simple.
 */
function GaugeSelect({
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
  const activeIndex = options.indexOf(value); // -1 when unset
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-foreground">
          {value || 'Any'}
        </span>
      </div>
      <div
        role="group"
        aria-label={`${label} level`}
        className="flex gap-1"
      >
        {options.map((opt, i) => {
          const filled = activeIndex >= 0 && i <= activeIndex;
          const isExact = value === opt;
          return (
            <button
              key={opt}
              type="button"
              title={opt}
              aria-label={opt}
              aria-pressed={isExact}
              onClick={() =>
                onChange({ [paramKey]: isExact ? null : opt })
              }
              className={cn(
                'h-11 flex-1 rounded-md border text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filled
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  groupOptions = [],
  countryOptions = [],
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

  // "Taste & more" advanced params — used both to badge the section header and
  // to auto-open it on arrival when any are set. (Critic-scored is NOT here: it
  // lives in the Refine toolbar as a peer of In-stock, not a taste filter.)
  const advancedValues = [
    get('grape'),
    get('flavor'),
    get('body'),
    get('acidity'),
    get('tannin'),
  ].filter(Boolean);

  // Compact origin read-out for the collapsed Origin header: France › Champagne.
  const originParts = [activeCountry, activeRegion, activeSubRegion].filter(
    Boolean,
  );

  // Has the shopper engaged ANY browse filter (ignoring infra params like
  // bev / inStock / sort / page)? Drives Category's "starting point" auto-open:
  // a truly fresh shop opens Category; once they've drilled anywhere, we respect
  // their per-section state and don't force Category open.
  const hasBrowseFilter =
    advancedValues.length > 0 ||
    Boolean(
      activeGroup || activeClass || activePrice || originParts.length > 0,
    );

  return (
    <section aria-label="Product filters" className="flex flex-col gap-4">
      {/* ── Toolbar: always-visible controls (result-agnostic). Sort + stock +
          clear live here so they're reachable without opening any section. ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="mr-1 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Refine
        </span>

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

        {/* Critic-scored-only toggle — sits beside In-stock as a peer quick filter */}
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-foreground">
          <input
            type="checkbox"
            checked={hasScoreOnly}
            onChange={(e) => apply({ hasScore: e.target.checked ? '1' : null })}
            className="h-5 w-5 rounded border-border accent-[hsl(var(--primary))]"
          />
          Critic-scored only
        </label>

        {/* Clear all — pushed to the right; only when something is set */}
        {hasAnyFilter ? (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className={cn(
              'ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 text-base text-muted-foreground',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear all
          </button>
        ) : null}
      </div>

      {/* ── Accordion sections. Each collapses to a 52px header that reads back
          its active selection; "smart auto-open" expands only the sections that
          already hold a value (defaultOpen), so a deep link reveals exactly the
          relevant controls and keeps the rest folded. ── */}

      {/* Category (+ Type drill-down nested inside). */}
      <FilterAccordion
        label="Category"
        defaultOpen={!hasBrowseFilter || Boolean(activeGroup)}
        summary={
          activeGroup ? (
            <>
              <SectionBadge>{activeGroup}</SectionBadge>
              {activeClass ? <SectionBadge>{activeClass}</SectionBadge> : null}
            </>
          ) : null
        }
      >
        {groupOptions.length > 0 ? (
          <ChipRail
            ariaLabel="Category"
            options={groupOptions}
            active={activeGroup}
            onSelect={(value) => apply(clearDescendants('group', value))}
          />
        ) : (
          <ChipRow ariaLabel="Category">
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
          </ChipRow>
        )}

        {/* Type drill-down: only when a group is set AND options exist. */}
        {activeGroup && availableSubCategories.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Type
              </span>
              <span className="text-xs italic text-muted-foreground/70">
                in {activeGroup}
              </span>
            </div>
            <ChipRow ariaLabel="Sub-category">
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
            </ChipRow>
          </div>
        ) : null}
      </FilterAccordion>

      {/* Price. */}
      <FilterAccordion
        label="Price"
        defaultOpen={Boolean(activePrice)}
        summary={
          activePrice ? (
            <SectionBadge>
              {PRICE_TIERS.find((t) => t.id === activePrice)?.label ??
                activePrice}
            </SectionBadge>
          ) : null
        }
      >
        <ChipRow ariaLabel="Price">
          {PRICE_TIERS.map((tier) => (
            <Chip
              key={tier.id}
              active={activePrice === tier.id}
              onClick={() => toggle('price', tier.id)}
            >
              {tier.label}
            </Chip>
          ))}
        </ChipRow>
      </FilterAccordion>

      {/* Origin — Country › Region › Sub-region, the long region list now lives
          behind one collapsed header and a Show-all cap. */}
      <FilterAccordion
        label="Origin"
        defaultOpen={Boolean(activeCountry)}
        summary={
          originParts.length > 0 ? (
            <SectionBadge>{originParts.join(' › ')}</SectionBadge>
          ) : null
        }
      >
        {/* Country — horizontal sliding chip rail with SKU counts (falls back
            to a dropdown only if upstream didn't supply counts). */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Country
          </span>
          {countryOptions.length > 0 ? (
            <ChipRail
              ariaLabel="Country"
              options={countryOptions}
              active={activeCountry}
              onSelect={(value) => apply(clearDescendants('country', value))}
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  'inline-flex min-h-[44px] w-fit items-center gap-2 rounded-md border border-border bg-background px-4 text-base',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  activeCountry ? 'text-primary' : 'text-foreground',
                )}
              >
                {activeCountry || 'Any country'}
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
          )}
        </div>

        {/* Region drill-down: only once a country is set AND options exist. */}
        {activeCountry && availableRegions.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Region
            </span>
            <ChipRail
              ariaLabel="Region"
              options={availableRegions}
              active={activeRegion}
              onSelect={(value) => apply(clearDescendants('region', value))}
            />
          </div>
        ) : null}

        {/* Sub-region drill-down: only when a region is set AND options exist. */}
        {activeRegion && availableSubRegions.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Sub-region
              </span>
              <span className="text-xs italic text-muted-foreground/70">
                in {activeRegion}
              </span>
            </div>
            <ChipRail
              ariaLabel="Sub-region"
              options={availableSubRegions}
              active={activeSubRegion}
              onSelect={(value) => apply(clearDescendants('subregion', value))}
            />
          </div>
        ) : null}
      </FilterAccordion>

      {/* Taste & more — the former "More filters" advanced panel. */}
      <FilterAccordion
        label="Taste & more"
        defaultOpen={advancedValues.length > 0}
        summary={
          advancedValues.length > 0 ? (
            <SectionBadge>
              {advancedValues.length} active
            </SectionBadge>
          ) : null
        }
      >
        <div className="flex flex-col gap-4">
          {/* Grape: count-less 2-row slide rail (high-cardinality, capped seed). */}
          {grapeOptions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Grape
              </span>
              <ChipRail
                ariaLabel="Grape"
                options={grapeOptions}
                active={get('grape')}
                onSelect={(value) => apply({ grape: value })}
              />
            </div>
          ) : null}

          {/* Flavor: count-less 2-row slide rail. */}
          {flavorOptions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Flavor
              </span>
              <ChipRail
                ariaLabel="Flavor"
                options={flavorOptions}
                active={get('flavor')}
                onSelect={(value) => apply({ flavor: value })}
              />
            </div>
          ) : null}

          {/* Body / Acidity / Tannin — shared 4-step scale, shown as intensity
              gauges instead of three identical dropdowns. */}
          <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
            <GaugeSelect
              label="Body"
              paramKey="body"
              value={get('body')}
              options={bodyOptions}
              onChange={apply}
            />
            <GaugeSelect
              label="Acidity"
              paramKey="acidity"
              value={get('acidity')}
              options={acidityOptions}
              onChange={apply}
            />
            <GaugeSelect
              label="Tannin"
              paramKey="tannin"
              value={get('tannin')}
              options={tanninOptions}
              onChange={apply}
            />
          </div>
        </div>
      </FilterAccordion>
    </section>
  );
}
