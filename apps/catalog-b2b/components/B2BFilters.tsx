'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { B2B_PRICE_TIERS, buildQuery } from '@/lib/b2b-query';
import type { FacetOption } from '@/lib/b2b-query';

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'price-asc', label: 'Price ↑' },
  { id: 'price-desc', label: 'Price ↓' },
];

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  groups: FacetOption[];
  subCategories: FacetOption[];
  countries: FacetOption[];
  regions: FacetOption[];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400',
      )}
    >
      {children}
    </button>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-0.5 rounded-full bg-white/20 px-1.5 text-[10px] tabular-nums">{n}</span>
  );
}

function ActiveCountBadge({ n }: { n: number }) {
  return (
    <span className="ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold tabular-nums text-white">
      {n}
    </span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function B2BFilters({ groups, subCategories, countries, regions }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  const current = new URLSearchParams(searchParams?.toString() ?? '');
  const get = (k: string) => current.get(k) ?? '';

  const apply = (patch: Record<string, string | null>) => {
    const qs = buildQuery(current, patch);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggle = (k: string, v: string) => apply({ [k]: get(k) === v ? null : v });

  const activeGroup = get('group');
  const activeClass = get('class');
  const activePrice = get('price');
  const activeCountry = get('country');
  const activeRegion = get('region');
  const activeSort = get('sort');
  const inStockOnly = get('inStock') === '1';
  const hasScoreOnly = get('hasScore') === '1';

  const activeFilterCount = [activeGroup, activeClass, activePrice, activeCountry, activeRegion]
    .filter(Boolean).length + (inStockOnly ? 1 : 0) + (hasScoreOnly ? 1 : 0);

  const hasAnyFilter = activeFilterCount > 0 || activeSort !== '';

  const sortLabel = SORT_OPTIONS.find((s) => s.id === (activeSort || 'recommended'))?.label ?? 'Sort';

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4">
      {/* Top bar: Sort + quick toggles + Clear */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">Sort</span>
          <div className="flex gap-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => apply({ sort: opt.id === 'recommended' ? null : opt.id })}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  (activeSort || 'recommended') === opt.id
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Quick toggles */}
          <button
            type="button"
            role="switch"
            aria-checked={inStockOnly}
            onClick={() => apply({ inStock: inStockOnly ? null : '1' })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              inStockOnly
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400',
            )}
          >
            📦 In stock
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={hasScoreOnly}
            onClick={() => apply({ hasScore: hasScoreOnly ? null : '1' })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              hasScoreOnly
                ? 'border-amber-500 bg-amber-50 text-amber-700'
                : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400',
            )}
          >
            ⭐ Critic-scored
          </button>

          {hasAnyFilter && (
            <button
              type="button"
              onClick={() => router.push(pathname, { scroll: false })}
              className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"
            >
              ✕ Clear {activeFilterCount > 0 && <ActiveCountBadge n={activeFilterCount} />}
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-neutral-100" />

      {/* Category */}
      {groups.length > 0 && (
        <Section label="Category">
          {groups.map((opt) => (
            <Chip
              key={opt.value}
              active={activeGroup === opt.value}
              onClick={() => apply({ group: activeGroup === opt.value ? null : opt.value, class: null })}
            >
              {opt.value}
              {activeGroup === opt.value
                ? <CountBadge n={opt.count} />
                : <span className="ml-0.5 text-[10px] text-neutral-400 tabular-nums">{opt.count}</span>}
            </Chip>
          ))}
        </Section>
      )}

      {/* Sub-category (type): only when a group is active and subtypes exist */}
      {activeGroup && subCategories.length > 0 && (
        <Section label={`Type · ${activeGroup}`}>
          {subCategories.map((opt) => (
            <Chip
              key={opt.value}
              active={activeClass === opt.value}
              onClick={() => toggle('class', opt.value)}
            >
              {opt.value}
              {activeClass === opt.value
                ? <CountBadge n={opt.count} />
                : <span className="ml-0.5 text-[10px] text-neutral-400 tabular-nums">{opt.count}</span>}
            </Chip>
          ))}
        </Section>
      )}

      {/* Price */}
      <Section label="Price">
        {B2B_PRICE_TIERS.map((tier) => (
          <Chip
            key={tier.id}
            active={activePrice === tier.id}
            onClick={() => toggle('price', tier.id)}
          >
            {tier.label}
          </Chip>
        ))}
      </Section>

      {/* Country */}
      {countries.length > 0 && (
        <Section label="Country">
          {countries.slice(0, 20).map((opt) => (
            <Chip
              key={opt.value}
              active={activeCountry === opt.value}
              onClick={() => apply({ country: activeCountry === opt.value ? null : opt.value, region: null })}
            >
              {opt.value}
              {activeCountry === opt.value
                ? <CountBadge n={opt.count} />
                : <span className="ml-0.5 text-[10px] text-neutral-400 tabular-nums">{opt.count}</span>}
            </Chip>
          ))}
        </Section>
      )}

      {/* Region: only when a country is active and regions exist */}
      {activeCountry && regions.length > 0 && (
        <Section label={`Region · ${activeCountry}`}>
          {regions.slice(0, 30).map((opt) => (
            <Chip
              key={opt.value}
              active={activeRegion === opt.value}
              onClick={() => toggle('region', opt.value)}
            >
              {opt.value}
              {activeRegion === opt.value
                ? <CountBadge n={opt.count} />
                : <span className="ml-0.5 text-[10px] text-neutral-400 tabular-nums">{opt.count}</span>}
            </Chip>
          ))}
        </Section>
      )}
    </div>
  );
}
