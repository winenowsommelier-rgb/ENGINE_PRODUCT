import type { Metadata } from 'next';
import { getB2BCatalogRows } from '@/lib/catalog-b2b-data';
import { buildCatalogTree } from '@/lib/catalog-print';
import { CatalogDocument } from '@/components/catalog-print/CatalogDocument';
import { CatalogToolbar } from '@/components/catalog-print/CatalogToolbar';

// Trade pricing must never be crawled/indexed or statically cached across
// requests without the key check, so this route is dynamic (Rule: high-risk
// zone — anything touching margin-adjacent data gets hyper-scrutiny).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Trade Price List (B2B)',
  robots: { index: false, follow: false, nocache: true },
};

interface B2BCatalogPageProps {
  searchParams: { key?: string };
}

const EDITION_DATE = 'July 2026';

function AccessDenied() {
  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Trade catalog — access required</h1>
      <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6 }}>
        This price list contains trade pricing and is restricted to authorized B2B partners. Contact your
        WNLQ9 account manager for access.
      </p>
    </div>
  );
}

export default function B2BCatalogPage({ searchParams }: B2BCatalogPageProps) {
  const requiredKey = process.env.B2B_CATALOG_ACCESS_KEY;
  // Fail closed: if the key isn't configured, the route is unreachable rather
  // than accidentally public.
  if (!requiredKey || searchParams.key !== requiredKey) {
    return <AccessDenied />;
  }

  const rows = getB2BCatalogRows();
  const groups = buildCatalogTree(rows);

  return (
    <>
      <CatalogToolbar
        title="WNLQ9 Catalog — B2B"
        hint={`Trade price list · ${rows.length.toLocaleString()} items in stock`}
      />
      <CatalogDocument
        edition="b2b"
        editionLabel="Trade Price List · B2B"
        dateLabel={EDITION_DATE}
        groups={groups}
        totalCount={rows.length}
      />
    </>
  );
}
