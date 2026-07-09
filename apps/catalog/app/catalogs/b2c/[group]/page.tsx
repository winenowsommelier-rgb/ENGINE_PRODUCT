import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllProducts } from '@/lib/catalog-data';
import { buildCatalogTree, getB2CCatalogRows } from '@/lib/catalog-print';
import { GROUP_SLUG } from '@/lib/seo/jsonld';
import { CatalogDocument } from '@/components/catalog-print/CatalogDocument';
import { CatalogToolbar } from '@/components/catalog-print/CatalogToolbar';

const SLUG_TO_GROUP = Object.fromEntries(
  Object.entries(GROUP_SLUG).map(([g, s]) => [s, g]),
) as Record<string, string>;

const EDITION_DATE = 'July 2026';

export function generateStaticParams() {
  return Object.values(GROUP_SLUG).map((slug) => ({ group: slug }));
}

export function generateMetadata({ params }: { params: { group: string } }): Metadata {
  const groupName = SLUG_TO_GROUP[params.group];
  if (!groupName) return { title: 'Not found — WNLQ9 Catalog' };
  return {
    title: `WNLQ9 Catalog — ${groupName} Price List (B2C)`,
    robots: { index: false, follow: false },
  };
}

export default function B2CCategoryCatalogPage({ params }: { params: { group: string } }) {
  const groupName = SLUG_TO_GROUP[params.group];
  if (!groupName) notFound();

  const rows = getB2CCatalogRows(getAllProducts(), groupName);
  if (rows.length === 0) notFound();

  const groups = buildCatalogTree(rows);

  return (
    <>
      <CatalogToolbar
        title={`WNLQ9 Catalog — ${groupName}`}
        hint={`Retail price list · ${rows.length.toLocaleString()} items in stock`}
        backHref="/catalogs/b2c"
      />
      <CatalogDocument
        edition="b2c"
        editionLabel={`Retail Price List · ${groupName}`}
        dateLabel={EDITION_DATE}
        groups={groups}
        totalCount={rows.length}
      />
    </>
  );
}
