import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { collectionToShopParams, getGroupsWithCollections } from '@/lib/collections';
import { groupToSlug } from '@/lib/collection-groups';
import { CollectionCard } from '@/components/CollectionCard';

/**
 * Collections index — a CATEGORY-SPLIT editorial landing over the curated,
 * fixed-filter views. One section per group (Wine / Whisky / Sake & Asian /
 * Spirits …), already in export (sort) order via getGroupsWithCollections().
 *
 * Each card's count is the live total from the SAME pure applyShopQuery() engine
 * the listing page uses, so the count on the card and the count on the collection
 * page can never diverge.
 *
 * Simple server component: no searchParams, no client state. The URL carries no
 * filter — the group sections and their cards come only from the seed data.
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
  const groups = getGroupsWithCollections();

  // Precompute each collection's live count once (products loaded once above).
  const sections = groups.map(({ group, collections }) => ({
    group,
    collections: collections.map((col) => ({
      col,
      count: applyShopQuery(products, collectionToShopParams(col)).total,
    })),
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

      {sections.length === 0 ? (
        <p className="text-base text-muted-foreground">
          No collections available yet — check back soon.
        </p>
      ) : (
        sections.map(({ group, collections }) => (
          <section key={group} className="flex flex-col gap-4 sm:gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {group}
              </h2>
              {collections.length > 3 ? (
                <Link
                  href={`/collections/category/${groupToSlug(group)}`}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  See all →
                </Link>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {collections.map(({ col, count }) => (
                <CollectionCard key={col.slug} collection={col} count={count} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
