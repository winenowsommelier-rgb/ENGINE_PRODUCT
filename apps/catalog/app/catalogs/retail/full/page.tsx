import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/catalog-data';
import { buildCatalogTree, getB2CCatalogRows } from '@/lib/catalog-print';
import { CatalogDocument } from '@/components/catalog-print/CatalogDocument';
import { CatalogToolbar } from '@/components/catalog-print/CatalogToolbar';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Retail Price List',
  robots: { index: false, follow: false },
};

const EDITION_DATE = 'July 2026';

export default function RetailFullCatalogPage() {
  const rows = getB2CCatalogRows(getAllProducts());
  const groups = buildCatalogTree(rows);

  return (
    <>
      <CatalogToolbar
        title="WNLQ9 Catalog — Retail"
        hint={`Retail price list · ${rows.length.toLocaleString()} items in stock`}
        backHref="/catalogs/retail"
      />
      <CatalogDocument
        edition="b2c"
        editionLabel="Retail Price List"
        dateLabel={EDITION_DATE}
        groups={groups}
        totalCount={rows.length}
      />
    </>
  );
}
