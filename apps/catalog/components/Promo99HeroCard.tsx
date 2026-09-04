import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Promo99Collection } from '@/lib/promo-9-9';

/**
 * Promo99HeroCard — full-width hero for the time-boxed 9.9 Collection.
 * Rendered above every group section on /collections while isPromo99Active().
 * Item count is promo.items.length (static JSON count) — see
 * docs/superpowers/specs/2026-09-04-9-9-collection-promo-design.md for why
 * this deliberately doesn't re-resolve every SKU just for a cosmetic count.
 */
export function Promo99HeroCard({ promo }: { promo: Promo99Collection }) {
  return (
    <Link
      href={`/collections/${promo.slug}`}
      className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-primary bg-gradient-to-br from-primary/90 to-primary p-6 text-primary-foreground transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {promo.name}
        </h2>
        <ArrowRight
          className="mt-2 h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </div>
      <p className="max-w-xl text-base opacity-90">{promo.tagline}</p>
      <p className="mt-2 text-sm font-medium opacity-80">
        {promo.items.length} {promo.items.length === 1 ? 'bottle' : 'bottles'}
      </p>
    </Link>
  );
}
