import Link from 'next/link';
import { Wine } from 'lucide-react';

/**
 * Global 404 — rendered by Next when a route (e.g. an unknown /product/[sku])
 * calls notFound(). Kept calm and Maison-clean with a clear path back to /shop.
 */
export default function NotFound() {
  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center gap-5 py-16 text-center">
      <Wine className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        We couldn’t find that page
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        The product may have sold out or the link may be out of date.
      </p>
      <Link
        href="/shop"
        className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the shop
      </Link>
    </main>
  );
}
