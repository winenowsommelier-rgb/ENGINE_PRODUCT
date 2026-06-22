import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { TrustBar } from '@/components/TrustBar';
import { Filters } from '@/components/Filters';
import { ProductCard } from '@/components/ProductCard';
import { getAllProducts } from '@/lib/catalog-data';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { applyShopQuery, type ShopParams } from '@/lib/shop-query';
import { shopFacets, topGrapes, topFlavors } from '@/lib/shop-facets';
import { DrillBreadcrumb } from '@/components/DrillBreadcrumb';
import { buildQuery } from '@/lib/build-query';
import { cn } from '@/lib/utils';

/**
 * Fixed taste scales for the advanced-filter dropdowns (spec §6.6 minimum).
 * NOT context-aware — these are the normalized scales taste-adapter renders to.
 */
const BODY_SCALE = ['Light', 'Medium', 'Medium-Full', 'Full'];
const ACIDITY_SCALE = ['Low', 'Medium', 'Medium-High', 'High'];
const TANNIN_SCALE = ['Low', 'Medium', 'Medium-High', 'High'];

/**
 * Grape/flavor typeahead seeds are catalog-wide (they do NOT depend on the
 * active filters), so compute them once and reuse. getAllProducts() is itself
 * process-cached; this lazy cache just avoids re-tallying ~8.5k products on
 * every request to this dynamic route.
 */
let _grapeOptions: string[] | null = null;
let _flavorOptions: string[] | null = null;
function getGrapeOptions(): string[] {
  return (_grapeOptions ??= topGrapes(getAllProducts()));
}
function getFlavorOptions(): string[] {
  return (_flavorOptions ??= topFlavors(getAllProducts()));
}

/**
 * Shop — the core browsing experience (SSG-friendly server component).
 *
 * Reads URL searchParams server-side, runs the catalog through the pure
 * applyShopQuery() engine (filter → sort → paginate), and renders the Maison
 * product grid. The query LOGIC lives in lib/shop-query.ts so it is unit-tested
 * independently of Next/React; this file is just data-load + render.
 *
 * SAFETY: products come from getAllProducts(), which projects every record
 * through the PUBLIC_FIELDS allowlist (catalog-data.ts) — internal margin/b2b
 * fields are structurally absent, so they cannot reach the rendered HTML.
 *
 * Filters is a client component using useSearchParams, so it MUST be wrapped in
 * <Suspense> (Next requirement).
 */

/**
 * Distinct, sorted country list for the Filters dropdown. Computed once at
 * module init from the loaded catalog (build-time), not per request.
 */
function distinctCountries(): string[] {
  const set = new Set<string>();
  for (const p of getAllProducts()) {
    const c = p.country?.trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en'));
}

/** Flatten Next's searchParams into the Record<string,string> the URL helpers expect. */
function toStringRecord(params: ShopParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out[k] = val;
  }
  return out;
}

/** Build an href to /shop for a given page, preserving all active filters. */
function pageHref(currentParams: Record<string, string>, page: number): string {
  const qs = buildQuery(currentParams, { page: page <= 1 ? null : String(page) });
  return qs ? `/shop?${qs}` : '/shop';
}

/**
 * Compact, accessible page-number window: always shows first & last, the
 * current page and its neighbours, with '…' gaps. Returns page numbers and
 * 'gap' sentinels.
 */
function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | 'gap'> = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push('gap');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total - 1) out.push('gap');
  out.push(total);
  return out;
}

export default function ShopPage({
  searchParams,
}: {
  searchParams: ShopParams;
}) {
  const products = getAllProducts();
  const countries = distinctCountries();
  const currentParams = toStringRecord(searchParams);

  // Context-aware drill-down option lists (sub-category / region / sub-region).
  const facets = shopFacets(products, searchParams);
  // Catalog-wide typeahead seeds (cached; independent of active filters).
  const grapeOptions = getGrapeOptions();
  const flavorOptions = getFlavorOptions();

  const result = applyShopQuery(products, searchParams);
  const { pageItems, total, page, pageSize, totalPages } = result;

  // Global contact links (no product) for QuickView inside cards. Per-product
  // prefill is the detail page's job; ContactButtons omits any unconfigured channel.
  const links = buildContactLinks(getContactEnv());

  // Heading: active group name if filtered to one, else "Shop".
  const activeGroup = currentParams.group;
  const heading = activeGroup || 'Shop';

  // "Showing X–Y of N" (1-based, clamped); zero results handled by EmptyState.
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <>
      <TrustBar />

      <main className="container flex flex-col gap-5 py-6 sm:gap-6 sm:py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {heading}
          </h1>
          <p className="text-base text-muted-foreground">
            Browse the collection — contact us to order.
          </p>
        </header>

        <Suspense fallback={<div className="min-h-[88px]" aria-hidden="true" />}>
          <Filters
            countries={countries}
            groupOptions={facets.groups}
            countryOptions={facets.countries}
            initialParams={currentParams}
            availableSubCategories={facets.subCategories}
            availableRegions={facets.regions}
            availableSubRegions={facets.subRegions}
            designationOptions={facets.designations}
            grapeOptions={grapeOptions}
            flavorOptions={flavorOptions}
            bodyOptions={BODY_SCALE}
            acidityOptions={ACIDITY_SCALE}
            tanninOptions={TANNIN_SCALE}
          />
        </Suspense>

        <DrillBreadcrumb params={currentParams} pathname="/shop" />

        {/* Quiet fallback into the finder quiz for browsers facing too much choice. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-3">
          <p className="text-base text-muted-foreground">
            Too many options? Let us help you choose.
          </p>
          <Link
            href="/finder"
            className="inline-flex min-h-[44px] items-center text-base font-medium text-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Find Your Match →
          </Link>
        </div>

        {total > 0 ? (
          <p
            className="text-base text-muted-foreground"
            aria-live="polite"
            role="status"
          >
            Showing{' '}
            <span className="font-medium text-foreground">
              {first}–{last}
            </span>{' '}
            of <span className="font-medium text-foreground">{total}</span>
          </p>
        ) : null}

        {total === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
              {pageItems.map((product) => (
                <ProductCard
                  key={product.sku}
                  product={product}
                  contactLinks={links}
                />
              ))}
            </div>

            {totalPages > 1 ? (
              <Pagination
                currentParams={currentParams}
                page={page}
                totalPages={totalPages}
              />
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

/** Shown when no products match the active filters. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-muted/20 px-6 py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-xl font-medium text-foreground">
        No products match
      </h2>
      <p className="max-w-md text-base text-muted-foreground">
        Try clearing a filter or two to widen your search.
      </p>
      <Link
        href="/shop"
        className={cn(
          'inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground',
          'transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        Clear all filters
      </Link>
    </div>
  );
}

/** Prev / numbered pages / Next. 44px tap targets, aria-labelled. */
function Pagination({
  currentParams,
  page,
  totalPages,
}: {
  currentParams: Record<string, string>;
  page: number;
  totalPages: number;
}) {
  const window = pageWindow(page, totalPages);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const baseLink =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-2 pt-2"
    >
      {hasPrev ? (
        <Link
          href={pageHref(currentParams, page - 1)}
          aria-label="Previous page"
          rel="prev"
          className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(baseLink, 'border-transparent text-muted-foreground/40')}
        >
          <ChevronLeft className="h-5 w-5" />
        </span>
      )}

      {window.map((item, i) =>
        item === 'gap' ? (
          <span
            key={`gap-${i}`}
            aria-hidden="true"
            className="inline-flex min-h-[44px] items-center px-1 text-muted-foreground"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            aria-label={`Page ${item}, current page`}
            className={cn(baseLink, 'border-primary bg-primary font-medium text-primary-foreground')}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={pageHref(currentParams, item)}
            aria-label={`Page ${item}`}
            className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}
          >
            {item}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link
          href={pageHref(currentParams, page + 1)}
          aria-label="Next page"
          rel="next"
          className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cn(baseLink, 'border-transparent text-muted-foreground/40')}
        >
          <ChevronRight className="h-5 w-5" />
        </span>
      )}
    </nav>
  );
}
