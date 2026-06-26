// apps/catalog/app/shop/[group]/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllProducts } from '@/lib/catalog-data';
import { groupForProduct } from '@/lib/category-groups';
import { isInStock } from '@/lib/utils';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildItemList, GROUP_SLUG } from '@/lib/seo/jsonld';

const BASE = 'https://wnlq9.shop';

// Reverse map: slug → CategoryGroup display name
const SLUG_TO_GROUP = Object.fromEntries(
  Object.entries(GROUP_SLUG).map(([g, s]) => [s, g])
) as Record<string, string>;

const GROUP_TITLES: Record<string, string> = {
  'Wine':          'Buy Wine in Thailand — Red, White, Sparkling & More | WNLQ9',
  'Whisky':        'Buy Whisky in Thailand — Single Malt & Blended | WNLQ9',
  'Spirits':       'Buy Spirits in Thailand — Gin, Vodka, Rum, Tequila | WNLQ9',
  'Sake & Asian':  'Buy Sake & Asian Spirits in Thailand | WNLQ9',
  'Liqueur':       'Buy Liqueur in Thailand | WNLQ9',
  'Beer & RTD':    'Buy Beer & RTD in Thailand | WNLQ9',
  'Non-Alcoholic': 'Buy Non-Alcoholic Drinks in Thailand | WNLQ9',
  'Cigars':        'Buy Cigars in Thailand | WNLQ9',
  'Events':        'Wine & Spirits Events | WNLQ9 Bangkok',
  'Accessories':   'Buy Wine Accessories in Thailand | WNLQ9',
};

export function generateStaticParams() {
  return Object.values(GROUP_SLUG).map((slug) => ({ group: slug }));
}

export function generateMetadata({ params }: { params: { group: string } }): Metadata {
  const groupName = SLUG_TO_GROUP[params.group];
  if (!groupName) return { title: 'Not found — WNLQ9' };
  return {
    title: GROUP_TITLES[groupName] ?? `Buy ${groupName} in Thailand | WNLQ9`,
    description: `Shop ${groupName.toLowerCase()} at WNLQ9, Bangkok. Filter by region, variety, taste and price. Order via LINE or WhatsApp.`,
    alternates: { canonical: `${BASE}/shop/${params.group}` },
    openGraph: {
      title: GROUP_TITLES[groupName] ?? `${groupName} | WNLQ9`,
      locale: 'en_TH',
      siteName: 'WNLQ9',
      type: 'website',
    },
  };
}

export default function ShopGroupPage({ params }: { params: { group: string } }) {
  const groupName = SLUG_TO_GROUP[params.group];
  if (!groupName) notFound();

  const all = getAllProducts();
  const inGroup = all.filter(
    (p) => groupForProduct(p) === groupName && isInStock(p.is_in_stock)
  );
  const totalCount = inGroup.length;

  // Top 20: critic score desc (nulls last), then price desc
  const top20 = [...inGroup]
    .sort((a, b) => {
      const sa = a.score_max ?? 0;
      const sb = b.score_max ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.price ?? 0) - (a.price ?? 0);
    })
    .slice(0, 20);

  const itemListSchema = buildItemList(top20, groupName, params.group, totalCount);

  // This page is the SEO canonical. Browser users are redirected to /shop?group=X
  // via middleware (so they get the interactive experience). Crawlers see this page
  // with full JSON-LD and a product listing.
  return (
    <>
      <JsonLd data={itemListSchema} />
      <main className="container py-8">
        <h1 className="text-3xl font-semibold mb-4">{groupName}</h1>
        <p className="text-muted-foreground mb-6">
          {totalCount} bottles available.{' '}
          <Link href={`/shop?group=${encodeURIComponent(groupName)}`} className="text-primary underline">
            Browse the full {groupName} collection →
          </Link>
        </p>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {top20.map((p) => (
            <li key={p.sku}>
              <Link href={`/product/${p.sku}`} className="block text-sm hover:underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
