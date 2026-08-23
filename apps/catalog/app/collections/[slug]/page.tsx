import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// Force dynamic rendering so every request re-runs the filter engine with the
// actual searchParams (sort/page). Matches app/shop/page.tsx — without this,
// Next.js 14's router cache can serve a stale SSR snapshot to later navigations.
// (Intentionally NO generateStaticParams: it is inconsistent with force-dynamic.)
export const dynamic = 'force-dynamic';

import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import { getAllProducts } from '@/lib/catalog-data';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { applyShopQuery, normalizeShopParams, type ShopParams } from '@/lib/shop-query';
import { buildQuery } from '@/lib/build-query';
import { cn } from '@/lib/utils';
import { ViewItemListTracker } from '@/components/ViewItemListTracker';
import {
  getCollectionBySlug,
  collectionToShopParams,
  type CollectionDef,
} from '@/lib/collections';
import { createClient } from '@/lib/supabase/server';
import { getUserLists } from '@/lib/lists';

/**
 * Collection listing — a curated, FIXED-filter view over the catalog.
 *
 * The collection's filter (country/region/class/…) is IMMUTABLE: it comes only
 * from the collection definition via collectionToShopParams(), which re-applies
 * the allowlist. The URL may ONLY carry `sort` and `page` — a visitor must not
 * be able to override the curated filter through query params. This is the key
 * difference from /shop, where the URL drives every filter.
 *
 * Everything else (grid, pagination, sort semantics) reuses the shared, pure
 * applyShopQuery() engine and the same ProductCard markup as the shop page.
 */

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
];

/**
 * Build the ShopParams for a collection request. The collection's own filter is
 * fixed; only `sort` and `page` are read off the URL and merged on top.
 *
 * The fixed filter is run through normalizeShopParams first — the same
 * canonicalization (region aliasing, subregion pruning) the /shop route applies —
 * so a collection's count and contents always match the equivalent /shop query,
 * even if a future collection seeds a region alias or a subregion.
 */
function mergedParams(def: CollectionDef, searchParams?: ShopParams): ShopParams {
  const merged: ShopParams = { ...normalizeShopParams(collectionToShopParams(def)) };
  const sort = firstStr(searchParams?.sort);
  const page = firstStr(searchParams?.page);
  if (sort) merged.sort = sort;
  if (page) merged.page = page;
  return merged;
}

function firstStr(v: string | string[] | undefined): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' && first.trim() !== '' ? first : undefined;
}

export function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: ShopParams;
}): Metadata {
  const def = getCollectionBySlug(params.slug);
  if (!def) {
    // Unknown slug renders notFound() in the component; keep metadata safe.
    return { title: 'Collection — WNLQ9' };
  }

  const { total } = applyShopQuery(getAllProducts(), mergedParams(def, searchParams));
  const thinPage = total < 5;

  return {
    title: `${def.name} — WNLQ9`,
    description: def.description,
    alternates: { canonical: `https://wnlq9.shop/collections/${params.slug}` },
    openGraph: {
      title: `${def.name} — WNLQ9`,
      description: def.description,
      locale: 'en_TH',
      siteName: 'WNLQ9',
    },
    ...(thinPage ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * href to this collection for a given page, preserving the active sort.
 * Only sort+page ever appear in the URL — the collection filter is fixed.
 */
function pageHref(slug: string, sort: string | undefined, page: number): string {
  const qs = buildQuery(
    {},
    { sort: sort ?? null, page: page <= 1 ? null : String(page) },
  );
  return qs ? `/collections/${slug}?${qs}` : `/collections/${slug}`;
}

/** href to this collection for a given sort, resetting to page 1. */
function sortHref(slug: string, sort: string): string {
  const qs = buildQuery({}, { sort: sort === 'recommended' ? null : sort });
  return qs ? `/collections/${slug}?${qs}` : `/collections/${slug}`;
}

/** Compact page-number window: first, last, current ±1, with '…' gaps. */
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

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: ShopParams;
}) {
  const def = getCollectionBySlug(params.slug);
  if (!def) notFound();

  // Resolved once per page load, threaded down into every ProductCard below
  // so the save-to-list pin knows whether to optimistically add or redirect
  // to /login, and whether to show the list-picker chevron.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);
  const userLists = user ? await getUserLists(supabase, user.id) : [];

  const activeSort = firstStr(searchParams?.sort) ?? 'recommended';
  const result = applyShopQuery(getAllProducts(), mergedParams(def, searchParams));
  const { pageItems, total, page, pageSize, totalPages } = result;

  // Global contact links (no product) for QuickView inside cards.
  const links = buildContactLinks(getContactEnv());

  // "Showing X–Y of N" (1-based, clamped); zero results handled by EmptyState.
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <main className="container flex flex-col gap-5 py-6 sm:gap-6 sm:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/collections" className="transition-colors hover:text-primary">
          Collections
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span className="text-foreground">{def.name}</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {def.name}
        </h1>
        {def.description ? (
          <p className="max-w-2xl text-base text-muted-foreground">
            {def.description}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span>{' '}
          {total === 1 ? 'bottle' : 'bottles'}
        </p>
      </header>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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
            <SortControl slug={params.slug} activeSort={activeSort} />
          </div>

          <ViewItemListTracker
            listName={def.name}
            items={pageItems.slice(0, 50).map((p, i) => ({
              item_id: p.sku,
              item_name: p.name,
              item_category: def.name,
              item_category2: p.category_type ?? undefined,
              price: p.price ? Math.round(p.price) : undefined,
              currency: 'THB',
              index: i,
              item_list_name: def.name,
            }))}
          />

          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {pageItems.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                contactLinks={links}
                isLoggedIn={isLoggedIn}
                userLists={userLists}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <Pagination
              slug={params.slug}
              sort={activeSort}
              page={page}
              totalPages={totalPages}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

/**
 * Sort control — plain <Link>s (no client component needed). Reflects the active
 * sort in the URL and resets to page 1 on change. `recommended` is the default,
 * so it drops the param entirely (clean canonical URL).
 */
function SortControl({
  slug,
  activeSort,
}: {
  slug: string;
  activeSort: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Sort:</span>
      {SORT_OPTIONS.map((opt) => {
        const isActive = opt.value === activeSort;
        return isActive ? (
          <span
            key={opt.value}
            aria-current="true"
            className="inline-flex min-h-[36px] items-center rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {opt.label}
          </span>
        ) : (
          <Link
            key={opt.value}
            href={sortHref(slug, opt.value)}
            className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Shown when the collection currently has no matching products. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-muted/20 px-6 py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-xl font-medium text-foreground">
        Nothing in stock right now
      </h2>
      <p className="max-w-md text-base text-muted-foreground">
        This collection has no available bottles at the moment. Browse the full
        shop instead.
      </p>
      <Link
        href="/shop"
        className={cn(
          'inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground',
          'transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        Browse the shop
      </Link>
    </div>
  );
}

/** Prev / numbered pages / Next. 44px tap targets, aria-labelled. */
function Pagination({
  slug,
  sort,
  page,
  totalPages,
}: {
  slug: string;
  sort: string | undefined;
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
          href={pageHref(slug, sort, page - 1)}
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
            href={pageHref(slug, sort, item)}
            aria-label={`Page ${item}`}
            className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}
          >
            {item}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link
          href={pageHref(slug, sort, page + 1)}
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
