import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/catalog-data';
import { buildCatalogTree, publicProductInScope, rowFromPublicProduct } from '@/lib/catalog-print';
import { CatalogDocument } from '@/components/catalog-print/CatalogDocument';
import { CatalogToolbar } from '@/components/catalog-print/CatalogToolbar';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Retail Price List (B2C)',
  robots: { index: false, follow: false },
};

const EDITION_DATE = 'July 2026';

export default function B2CCatalogPage() {
  const rows = getAllProducts()
    .filter(publicProductInScope)
    .map(rowFromPublicProduct)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const groups = buildCatalogTree(rows);

  return (
    <>
      <CatalogToolbar
        title="WNLQ9 Catalog — B2C"
        hint={`Retail price list · ${rows.length.toLocaleString()} items in stock`}
      />
      <CatalogDocument
        edition="b2c"
        editionLabel="Retail Price List · B2C"
        dateLabel={EDITION_DATE}
        groups={groups}
        totalCount={rows.length}
      />
    </>
  );
}
