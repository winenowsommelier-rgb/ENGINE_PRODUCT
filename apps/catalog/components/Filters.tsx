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
import { CATEGORY_GROUPS } from '@/lib/category-groups';
import { PRICE_TIERS } from '@/lib/price-tiers';
import { buildQuery } from '@/lib/build-query';
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

/** A calm pill/chip for single-select filters (category, price). */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
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
    </button>
  );
}

export function Filters({ countries, initialParams }: FiltersProps) {
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
  const activePrice = get('price');
  const activeCountry = get('country');
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
            onClick={() => toggle('group', group)}
          >
            {group}
          </Chip>
        ))}
      </div>

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
            <DropdownMenuItem onClick={() => apply({ country: null })}>
              All countries
            </DropdownMenuItem>
            {countries.map((country) => (
              <DropdownMenuItem
                key={country}
                onClick={() => apply({ country })}
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

      {/* Advanced / "More filters" — hidden until expanded */}
      {advancedOpen ? (
        <div
          className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-4"
          aria-label="Advanced filters"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextFilter
              label="Region"
              value={get('region')}
              onCommit={(v) => apply({ region: v || null })}
              placeholder="e.g. Bordeaux"
            />
            <TextFilter
              label="Grape"
              value={get('grape')}
              onCommit={(v) => apply({ grape: v || null })}
              placeholder="e.g. Pinot Noir"
            />
            <TextFilter
              label="Flavor tag"
              value={get('flavor')}
              onCommit={(v) => apply({ flavor: v || null })}
              placeholder="e.g. Berry"
            />
            <TextFilter
              label="Body"
              value={get('body')}
              onCommit={(v) => apply({ body: v || null })}
              placeholder="e.g. Full"
            />
            <TextFilter
              label="Acidity"
              value={get('acidity')}
              onCommit={(v) => apply({ acidity: v || null })}
              placeholder="e.g. High"
            />
            <TextFilter
              label="Tannin"
              value={get('tannin')}
              onCommit={(v) => apply({ tannin: v || null })}
              placeholder="e.g. Medium"
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
 * Small uncontrolled-on-commit text input for the advanced filters. Commits to
 * the URL on Enter or blur (not on every keystroke) so we don't push a history
 * entry per character.
 */
function TextFilter({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <label className="flex flex-col gap-1 text-sm text-muted-foreground">
      {label}
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(draft.trim());
          }
        }}
        className={cn(
          'min-h-[44px] rounded-md border border-border bg-background px-3 text-base text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      />
    </label>
  );
}
