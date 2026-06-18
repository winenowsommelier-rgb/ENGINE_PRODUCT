import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Explore by Map — an honest, static placeholder (server component, SSG).
 *
 * The full interactive region map is intentionally OUT of scope here (it's a
 * separate, large WebGL/SVG build). This page is a calm, on-brand "coming soon"
 * with a single CTA back into the full collection, so the header nav link
 * resolves cleanly instead of 404-ing.
 */

export const metadata: Metadata = {
  title: 'Explore by Map — WNLQ9',
  description:
    'An interactive map view of the regions behind our collection is coming soon. Browse the full collection in the meantime.',
};

export default function ExploreMapPage() {
  return (
    <section className="container flex max-w-xl flex-col items-center py-20 text-center sm:py-28">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Explore by Map
      </h1>

      <p className="mt-8 text-lg leading-relaxed text-muted-foreground">
        An interactive map view of the regions behind our collection is coming
        soon. In the meantime, browse the full selection of wine, whisky and
        spirits.
      </p>

      <div className="mt-10">
        <Link
          href="/shop"
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse the full collection
        </Link>
      </div>
    </section>
  );
}
