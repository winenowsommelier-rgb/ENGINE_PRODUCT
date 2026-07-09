import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getAllProducts } from '@/lib/catalog-data';
import { publicProductInScope } from '@/lib/catalog-print';
import { GROUP_SLUG } from '@/lib/seo/jsonld';

export const metadata: Metadata = {
  title: 'WNLQ9 Catalog — Retail Price List (B2C)',
  description: 'Print the WNLQ9 retail price list by category, or the full catalog.',
  robots: { index: false, follow: false },
};

export default function B2CCatalogPickerPage() {
  const inScope = getAllProducts().filter(publicProductInScope);
  const totalCount = inScope.length;

  const counts = new Map<string, number>();
  for (const p of inScope) {
    const g = p.category_group || 'Other';
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  // Preserve GROUP_SLUG's canonical order; only show categories with items.
  const categories = Object.entries(GROUP_SLUG)
    .map(([name, slug]) => ({ name, slug, count: counts.get(name) ?? 0 }))
    .filter((c) => c.count > 0);

  return (
    <section className="container max-w-3xl py-16 sm:py-20">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Retail · B2C</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Print by Category
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
        Each category prints as its own short, focused document. For the entire assortment in one file,
        use the full catalog link below.
      </p>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={`/catalogs/b2c/${c.slug}`}
            className="group flex items-center justify-between rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30"
          >
            <div>
              <h2 className="text-lg font-semibold text-foreground">{c.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{c.count.toLocaleString()} items in stock</p>
            </div>
            <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        ))}
      </div>

      <div className="mt-10 border-t border-border pt-8">
        <Link
          href="/catalogs/b2c/full"
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline underline-offset-4"
        >
          Full catalog — all categories, {totalCount.toLocaleString()} items
        </Link>
      </div>
    </section>
  );
}
