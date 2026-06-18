import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { buildSearchIndex } from '@/lib/search-index.server';

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
  // Built ONCE at build time (server). Projects the catalog down to the 4
  // allowlisted search fields and embeds it for the client search overlay.
  const searchIndex = buildSearchIndex();

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col overflow-x-hidden">
        <Header searchIndex={searchIndex} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
