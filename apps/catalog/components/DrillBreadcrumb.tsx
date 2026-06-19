/**
 * DrillBreadcrumb — compact, link-driven breadcrumb of the shopper's active
 * drill-down path inside the shop Filters area.
 *
 * Two strands, in order:
 *   category:  group › class
 *   geography: country › region › subregion
 *
 * Each crumb is a link that jumps BACK to that level: it keeps everything up to
 * and including the crumb (and the OTHER strand untouched), and drops the deeper
 * levels of its OWN strand. "Clear all" removes only the 5 drill params,
 * preserving price/sort/inStock/grape/etc.
 *
 * Server component — pure props → links. No 'use client', no next-navigation
 * hooks. Hrefs are computed with the shared pure buildQuery() patcher.
 */
import Link from 'next/link';
import { buildQuery } from '@/lib/build-query';
import { DRILL_DESCENDANTS, type DrillStrand } from '@/lib/drill-query';
import { cn } from '@/lib/utils';

// The deeper keys of a crumb's OWN strand that get nulled when jumping back come
// from DRILL_DESCENDANTS — the single source of truth shared with drill-query's
// clearDescendants(). Do not redefine the strand topology here.

const CATEGORY_STRAND: DrillStrand[] = ['group', 'class'];
const GEO_STRAND: DrillStrand[] = ['country', 'region', 'subregion'];
const ALL_DRILL_KEYS: DrillStrand[] = [...CATEGORY_STRAND, ...GEO_STRAND];

const crumbClass =
  'inline-flex min-h-[44px] items-center px-1.5 text-base text-foreground ' +
  'underline-offset-4 hover:underline focus-visible:underline';
const sepClass = 'select-none text-muted-foreground';

function hrefFor(
  params: Record<string, string>,
  pathname: string,
  patch: Record<string, string | null>,
): string {
  const qs = buildQuery(params, patch);
  return qs ? `${pathname}?${qs}` : pathname;
}

function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

export function DrillBreadcrumb({
  params,
  pathname,
}: {
  params: Record<string, string>;
  pathname: string;
}) {
  const renderStrand = (strand: DrillStrand[]) =>
    strand
      .filter((key) => isSet(params[key]))
      .map((key, i) => {
        // Jumping back to `key` nulls only the deeper levels of its own strand;
        // every other param (the other strand, price, sort, …) is preserved.
        const patch: Record<string, string | null> = {};
        for (const d of DRILL_DESCENDANTS[key]) patch[d] = null;
        return (
          <span key={key} className="inline-flex items-center">
            {i > 0 && <span className={sepClass} aria-hidden="true">{'›'}</span>}
            <Link href={hrefFor(params, pathname, patch)} className={crumbClass}>
              {params[key]}
            </Link>
          </span>
        );
      });

  const categoryCrumbs = renderStrand(CATEGORY_STRAND);
  const geoCrumbs = renderStrand(GEO_STRAND);

  // Nothing drilled → render nothing (price/sort alone don't count).
  if (categoryCrumbs.length === 0 && geoCrumbs.length === 0) return null;

  const clearPatch: Record<string, string | null> = {};
  for (const key of ALL_DRILL_KEYS) clearPatch[key] = null;
  const clearHref = hrefFor(params, pathname, clearPatch);

  return (
    <nav
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-base"
    >
      {categoryCrumbs}
      {categoryCrumbs.length > 0 && geoCrumbs.length > 0 && (
        <span className={cn(sepClass, 'px-1')} aria-hidden="true">
          {'·'}
        </span>
      )}
      {geoCrumbs}
      <Link
        href={clearHref}
        className={cn(
          'ml-2 inline-flex min-h-[44px] items-center px-1.5',
          'text-sm text-muted-foreground underline-offset-4',
          'hover:text-foreground hover:underline focus-visible:underline',
        )}
      >
        Clear all
      </Link>
    </nav>
  );
}
