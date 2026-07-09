import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Printable Price Lists',
  description: 'Browse and print the WNLQ9 wine, whisky & spirits price list — retail (B2C) or trade (B2B).',
  robots: { index: false, follow: false },
};

export default function CatalogsMenuPage() {
  return (
    <section className="container max-w-3xl py-16 sm:py-20">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Price Lists</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        WNLQ9 Catalog
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
        The full assortment, organized by country, region and sub-region — built for browsing on screen
        or printing to PDF. Choose an edition below.
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        <Link
          href="/catalogs/b2c"
          className="group flex flex-col justify-between rounded-lg border border-border bg-card p-6 transition-colors hover:border-foreground/30"
        >
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Retail Catalog</h2>
              <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Consumer price list (B2C). Retail price, active promotions, and critic scores for every
              in-stock item.
            </p>
          </div>
          <p className="mt-6 text-xs uppercase tracking-wide text-muted-foreground">Public · No sign-in required</p>
        </Link>

        <div className="flex flex-col justify-between rounded-lg border border-dashed border-border bg-card/50 p-6 opacity-70">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Trade Catalog</h2>
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Wholesale price list (B2B). Retail price, trade price and discount for authorized partners.
            </p>
          </div>
          <p className="mt-6 text-xs uppercase tracking-wide text-muted-foreground">Coming soon</p>
        </div>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Each catalog opens as a print-ready document — use the “Print / Save PDF” button on that page to
        export it.
      </p>
    </section>
  );
}
