import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'WNLQ9',
  description:
    'WNLQ9 — a considered selection of wine, whisky and spirits. Browse the collection and contact us to order.',
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
      </body>
    </html>
  );
}
