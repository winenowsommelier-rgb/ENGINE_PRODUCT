import Link from 'next/link';
import { TrustBar } from '@/components/TrustBar';
import { ProductCard } from '@/components/ProductCard';
import { resolveFeatured } from '@/lib/featured';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { CATEGORY_GROUPS } from '@/lib/category-groups';

/**
 * Home — the real WNLQ9 storefront landing page (SSG server component).
 *
 * Sections (Maison-calm, lots of whitespace):
 *   1. TrustBar — sets browse-and-enquire expectations near the top.
 *   2. Hero — confident WNLQ9 wordmark, short tagline, one burgundy CTA → /shop.
 *   3. Featured — ~8 hand-picked, in-stock, image-bearing products (lib/featured).
 *      Labelled "From the collection" — NEVER "best-selling"/"most popular",
 *      because there is no real popularity signal (popularity_score is 0 for all).
 *   4. Shop by Category — the 10 CATEGORY_GROUPS as large tap targets → /shop?group=.
 *
 * SAFETY: featured products come from getAllProducts() via the PUBLIC_FIELDS
 * allowlist (catalog-data.ts) — internal margin/b2b/popularity fields are
 * structurally absent and cannot reach the rendered HTML.
 */

/** Subtle accent tint per category card, kept within the Maison palette. */
const CATEGORY_BLURB: Record<string, string> = {
  Wine: 'Reds, whites, rosé, sparkling & Champagne',
  Whisky: 'Single malt, blended & world whisky',
  Spirits: 'Gin, vodka, rum, tequila, cognac & more',
  'Sake & Asian': 'Sake, shochu & umeshu',
  'Beer & RTD': 'Beer, ready-to-drink & non-alcoholic',
  Accessories: 'Glassware, cigars & gifting',
};

export default function Home() {
  const featured = resolveFeatured();
  // Global contact links (no product) for QuickView inside cards.
  const contactLinks = buildContactLinks(getContactEnv());

  return (
    <>
      <TrustBar />

      {/* Hero */}
      <section className="container flex flex-col items-center justify-center gap-7 py-20 text-center sm:py-28">
        <p className="text-base font-medium uppercase tracking-widest text-muted-foreground">
          Wine · Whisky · Spirits
        </p>
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          WNLQ9
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          A considered selection, chosen with care. Browse the collection at
          your own pace — when something speaks to you, reach out and we&apos;ll
          help you order.
        </p>
        <Link
          href="/shop"
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Shop the collection
        </Link>
      </section>

      {/* Find Your Match — calm prompt steering undecided browsers into the finder quiz. */}
      <section className="border-t border-border bg-secondary/40">
        <div className="container flex flex-col items-center gap-5 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Not sure where to start?
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            Answer a few quick questions and we&apos;ll find your style — then
            the bottles that match it.
          </p>
          <Link
            href="/finder"
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Find Your Match
          </Link>
        </div>
      </section>

      {/* Featured */}
      {featured.length > 0 ? (
        <section className="container flex flex-col gap-8 pb-16">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              From the collection
            </h2>
            <Link
              href="/shop"
              className="hidden shrink-0 text-base font-medium text-primary transition-colors hover:opacity-80 sm:inline-flex"
            >
              View all →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                contactLinks={contactLinks}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Shop by Category */}
      <section className="border-t border-border bg-secondary/40">
        <div className="container flex flex-col gap-8 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Shop by category
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_GROUPS.map((group) => (
              <Link
                key={group}
                href={`/shop?group=${encodeURIComponent(group)}`}
                className="group flex min-h-[96px] flex-col justify-center gap-1 rounded-lg border border-border bg-background px-6 py-6 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-xl font-semibold text-foreground transition-colors group-hover:text-primary">
                  {group}
                </span>
                <span className="text-base text-muted-foreground">
                  {CATEGORY_BLURB[group]}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
