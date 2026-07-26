import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { getCollections, collectionToShopParams } from '@/lib/collections';

/**
 * Collections index — a directory of curated, fixed-filter views over the
 * catalog. Each card's count is the live total from the SAME pure
 * applyShopQuery() engine the listing page uses, so the count on the card and
 * the count on the collection page can never diverge.
 *
 * Simple server component: no searchParams, no client state. Safe to render
 * statically, but left as a plain server component so counts always reflect the
 * current export.
 */

export const metadata: Metadata = {
  title: 'Collections — WNLQ9',
  description:
    'Curated collections of wine, whisky and spirits at WNLQ9, Bangkok — hand-picked by region, style and occasion.',
  alternates: { canonical: 'https://wnlq9.shop/collections' },
  openGraph: {
    title: 'Collections — WNLQ9',
    description:
      'Curated collections of wine, whisky and spirits at WNLQ9, Bangkok.',
    locale: 'en_TH',
    siteName: 'WNLQ9',
  },
};

export default function CollectionsIndexPage() {
  const products = getAllProducts();
  const cols = getCollections();

  const cards = cols.map((col) => ({
    ...col,
    count: applyShopQuery(products, collectionToShopParams(col)).total,
  }));

  return (
    <main className="container flex flex-col gap-6 py-6 sm:gap-8 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Collections
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Hand-picked selections — explore the cellar by region, style and
          occasion.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="text-base text-muted-foreground">
          No collections available yet — check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {cards.map((col) => (
            <Link
              key={col.slug}
              href={`/collections/${col.slug}`}
              className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {col.name}
                </h2>
                <ArrowRight
                  className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </div>
              {col.description ? (
                <p className="line-clamp-3 text-base text-muted-foreground">
                  {col.description}
                </p>
              ) : null}
              <p className="mt-auto text-sm font-medium text-muted-foreground">
                {col.count} {col.count === 1 ? 'bottle' : 'bottles'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
