import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import { getProductBySku } from '@/lib/catalog-data';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { applyShopQuery, type ShopParams } from '@/lib/shop-query';
import { buildQuery } from '@/lib/build-query';
import { cn } from '@/lib/utils';
import { ViewItemListTracker } from '@/components/ViewItemListTracker';
import { getPromo99, isPromo99Active } from '@/lib/promo-9-9';
import { createClient } from '@/lib/supabase/server';
import { getUserLists } from '@/lib/lists';
import type { PublicProduct } from '@/lib/types';

const SLUG = '9-9-collection';

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
];

function firstStr(v: string | string[] | undefined): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' && first.trim() !== '' ? first : undefined;
}

/**
 * Build the fixed product list for the 9.9 grid: resolve every promo SKU to
 * its live product, drop unresolvable/out-of-stock/archived items, and
 * override price/special_price so ProductCard's existing resolveSale() path
 * renders the promo discount with zero changes to ProductCard itself.
 */
function buildPromoProducts(): PublicProduct[] {
  const promo = getPromo99();
  if (!promo) return [];
  const out: PublicProduct[] = [];
  for (const item of promo.items) {
    const live = getProductBySku(item.sku);
    if (!live) continue;
    if (live.is_in_stock === false) continue;
    if (live.custom_stock_status === 'CATALOG') continue;
    out.push({ ...live, price: item.regularPrice, special_price: item.promoPrice });
  }
  return out;
}

function mergedParams(searchParams?: ShopParams): ShopParams {
  const merged: ShopParams = {};
  const sort = firstStr(searchParams?.sort);
  const page = firstStr(searchParams?.page);
  if (sort) merged.sort = sort;
  if (page) merged.page = page;
  return merged;
}

export function generateMetadata(): Metadata {
  return {
    title: '9.9 Collection — WNLQ9',
    description: 'Special promo prices on curated wine and spirits, live until 9 September 2026.',
    alternates: { canonical: `https://wnlq9.shop/collections/${SLUG}` },
  };
}

function pageHref(sort: string | undefined, page: number): string {
  const qs = buildQuery({}, { sort: sort ?? null, page: page <= 1 ? null : String(page) });
  return qs ? `/collections/${SLUG}?${qs}` : `/collections/${SLUG}`;
}

function sortHref(sort: string): string {
  const qs = buildQuery({}, { sort: sort === 'recommended' ? null : sort });
  return qs ? `/collections/${SLUG}?${qs}` : `/collections/${SLUG}`;
}

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

export default async function Promo99Page({
  searchParams,
}: {
  searchParams?: ShopParams;
}) {
  if (!isPromo99Active()) {
    return (
      <main className="container flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-foreground">This promotion has ended</h1>
        <p className="max-w-md text-base text-muted-foreground">
          The 9.9 Collection&apos;s special prices are no longer available. Browse our other collections instead.
        </p>
        <Link
          href="/collections"
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to Collections
        </Link>
      </main>
    );
  }

  const promo = getPromo99();
  if (!promo) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);
  const userLists = user ? await getUserLists(supabase, user.id) : [];

  const promoProducts = buildPromoProducts();
  const activeSort = firstStr(searchParams?.sort) ?? 'recommended';
  const result = applyShopQuery(promoProducts, mergedParams(searchParams));
  const { pageItems, total, page, pageSize, totalPages } = result;

  const links = buildContactLinks(getContactEnv());
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <main className="container flex flex-col gap-5 py-6 sm:gap-6 sm:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/collections" className="transition-colors hover:text-primary">Collections</Link>
        <span aria-hidden="true" className="px-2">/</span>
        <span className="text-foreground">{promo.name}</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{promo.name}</h1>
        <p className="max-w-2xl text-base text-muted-foreground">{promo.tagline}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> {total === 1 ? 'bottle' : 'bottles'}
        </p>
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-muted/20 px-6 py-16 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-xl font-medium text-foreground">Nothing available right now</h2>
          <p className="max-w-md text-base text-muted-foreground">
            This collection has no available bottles at the moment. Browse the full shop instead.
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
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="text-base text-muted-foreground" aria-live="polite" role="status">
              Showing <span className="font-medium text-foreground">{first}–{last}</span> of{' '}
              <span className="font-medium text-foreground">{total}</span>
            </p>
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
                    href={sortHref(opt.value)}
                    className="inline-flex min-h-[36px] items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {opt.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <ViewItemListTracker
            listName={promo.name}
            items={pageItems.slice(0, 50).map((p, i) => ({
              item_id: p.sku,
              item_name: p.name,
              item_category: promo.name,
              item_category2: p.category_type ?? undefined,
              price: p.price ? Math.round(p.price) : undefined,
              currency: 'THB',
              index: i,
              item_list_name: promo.name,
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
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {(() => {
                const window = pageWindow(page, totalPages);
                const hasPrev = page > 1;
                const hasNext = page < totalPages;
                const baseLink = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
                return (
                  <>
                    {hasPrev ? (
                      <Link href={pageHref(activeSort, page - 1)} aria-label="Previous page" rel="prev" className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>
                        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(baseLink, 'border-transparent text-muted-foreground/40')}>
                        <ChevronLeft className="h-5 w-5" />
                      </span>
                    )}
                    {window.map((item, i) =>
                      item === 'gap' ? (
                        <span key={`gap-${i}`} aria-hidden="true" className="inline-flex min-h-[44px] items-center px-1 text-muted-foreground">…</span>
                      ) : item === page ? (
                        <span key={item} aria-current="page" aria-label={`Page ${item}, current page`} className={cn(baseLink, 'border-primary bg-primary font-medium text-primary-foreground')}>{item}</span>
                      ) : (
                        <Link key={item} href={pageHref(activeSort, item)} aria-label={`Page ${item}`} className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>{item}</Link>
                      ),
                    )}
                    {hasNext ? (
                      <Link href={pageHref(activeSort, page + 1)} aria-label="Next page" rel="next" className={cn(baseLink, 'border-border text-foreground hover:border-primary hover:text-primary')}>
                        <ChevronRight className="h-5 w-5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-hidden="true" className={cn(baseLink, 'border-transparent text-muted-foreground/40')}>
                        <ChevronRight className="h-5 w-5" />
                      </span>
                    )}
                  </>
                );
              })()}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
