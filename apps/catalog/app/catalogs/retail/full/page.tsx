import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/catalog-data';
import { buildCatalogTree, countriesInRows, getB2CCatalogRows } from '@/lib/catalog-print';
import { CatalogDocument } from '@/components/catalog-print/CatalogDocument';
import { CatalogToolbar } from '@/components/catalog-print/CatalogToolbar';
import { CatalogFilterPanel } from '@/components/catalog-print/CatalogFilterPanel';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Retail Price List',
  robots: { index: false, follow: false },
};

// Filters live in the URL (?country=...&minPrice=...), so this route can no
// longer be fully static — it needs the request's searchParams to decide
// which rows to render. force-dynamic alone still let Vercel's edge CDN
// cache the response as `public` and serve one filtered result for every
// query string (verified in production: every ?country=... variant HIT the
// same cached body) — revalidate = 0 forces a genuine no-store response so
// each filter combination is actually re-rendered per request.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EDITION_DATE = 'July 2026';

function parseSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const countryParam = searchParams.country;
  const countries = countryParam ? (Array.isArray(countryParam) ? countryParam : [countryParam]) : [];
  const minPrice = searchParams.minPrice ? Number(searchParams.minPrice) : undefined;
  const maxPrice = searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined;
  const hasScoreOnly = searchParams.scoreOnly === '1';
  return { countries, minPrice, maxPrice, hasScoreOnly };
}

export default function RetailFullCatalogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const allRows = getB2CCatalogRows(getAllProducts());
  const filters = parseSearchParams(searchParams);
  const rows = getB2CCatalogRows(getAllProducts(), filters);
  const groups = buildCatalogTree(rows);
  const countryOptions = countriesInRows(allRows);

  return (
    <>
      <CatalogToolbar
        title="WNLQ9 Catalog — Retail"
        hint={`Retail price list · ${rows.length.toLocaleString()} items in stock`}
        backHref="/catalogs/retail"
      />
      <CatalogFilterPanel countries={countryOptions} resultCount={rows.length} />
      {rows.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '48px 16px', color: '#8b8272' }}>
          No items match the current filters.
        </p>
      ) : (
        <CatalogDocument
          edition="b2c"
          editionLabel="Retail Price List"
          dateLabel={EDITION_DATE}
          groups={groups}
          totalCount={rows.length}
        />
      )}
    </>
  );
}
