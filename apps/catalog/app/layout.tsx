import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildWebSiteOrganization } from '@/lib/seo/jsonld';

const BASE = 'https://wnlq9.shop';

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: 'WNLQ9 — Wine, Whisky & Spirits | Bangkok, Thailand',
  description:
    'WNLQ9 is a curated selection of wine, whisky and spirits in Bangkok. Thousands of bottles from 430 regions worldwide. Browse and order via LINE or WhatsApp.',
  openGraph: {
    siteName: 'WNLQ9',
    locale: 'en_TH',
    type: 'website',
    images: [{ url: `${BASE}/og-default.jpg`, width: 1200, height: 630, alt: 'WNLQ9 — Wine, Whisky & Spirits, Bangkok' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [`${BASE}/og-default.jpg`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // PERF: the search index is NO LONGER embedded here. Embedding it shipped a
  // ~1.4 MB array in EVERY page's RSC/HTML (home, /shop + all 11,436 product
  // pages were ~1.5 MB each). It is now generated at build time as a single
  // static file (public/search-index.json via scripts/gen-search-index.mjs) and
  // fetched on demand by the SearchOverlay the first time a shopper opens search.
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col overflow-x-hidden">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Analytics />
        <SpeedInsights />
        <JsonLd data={buildWebSiteOrganization()} />
      </body>
    </html>
  );
}
