import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { collectionToShopParams, getCollectionsByGroup } from '@/lib/collections';
import { slugToGroup } from '@/lib/collection-groups';
import { CollectionCard } from '@/components/CollectionCard';

/**
 * Collections — per-group ("See all") page. Lists every collection in one group,
 * resolved from the group SLUG in the URL. Plain server component: no
 * searchParams, no force-dynamic — the section is fully determined by the seed
 * data. Counts come from the SAME pure applyShopQuery() engine as the index and
 * the collection pages, so they can never diverge.
 */

export function generateMetadata({
  params,
}: {
  params: { group: string };
}): Metadata {
  const groupName = slugToGroup(params.group);
  if (!groupName) {
    // Unknown slug renders notFound() in the component; keep metadata safe.
    return { title: 'Collections — WNLQ9' };
  }
  return {
    title: `${groupName} Collections — WNLQ9`,
    description: `Curated ${groupName.toLowerCase()} collections at WNLQ9, Bangkok.`,
    alternates: {
      canonical: `https://wnlq9.shop/collections/category/${params.group}`,
    },
    openGraph: {
      title: `${groupName} Collections — WNLQ9`,
      description: `Curated ${groupName.toLowerCase()} collections at WNLQ9, Bangkok.`,
      locale: 'en_TH',
      siteName: 'WNLQ9',
    },
  };
}

export default function CollectionGroupPage({
  params,
}: {
  params: { group: string };
}) {
  const groupName = slugToGroup(params.group);
  if (!groupName) notFound();

  const products = getAllProducts();
  const cards = getCollectionsByGroup(groupName).map((col) => ({
    col,
    count: applyShopQuery(products, collectionToShopParams(col)).total,
  }));

  return (
    <main className="container flex flex-col gap-6 py-6 sm:gap-8 sm:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/collections" className="transition-colors hover:text-primary">
          Collections
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span className="text-foreground">{groupName}</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {groupName}
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Every curated {groupName.toLowerCase()} collection — pick a view to
          browse the bottles.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {cards.map(({ col, count }) => (
          <CollectionCard key={col.slug} collection={col} count={count} />
        ))}
      </div>
    </main>
  );
}
