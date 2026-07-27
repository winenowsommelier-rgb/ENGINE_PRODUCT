import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { CollectionDef } from '@/lib/collections';

/**
 * CollectionCard — the flat, bordered card used by BOTH the collections index
 * (category-split landing) and the per-group category page. Extracted verbatim
 * from the original flat index so the two views can never drift.
 *
 * Server component. `count` is the live total from applyShopQuery(), computed by
 * the caller (which already loads getAllProducts() once per page).
 *
 * Calm editorial style: flat border, hover:border-primary, ArrowRight affordance,
 * "{n} bottle(s)" count line. Whole card is one >=44px tap target with a visible
 * focus ring.
 */
export function CollectionCard({
  collection,
  count,
}: {
  collection: CollectionDef;
  count: number;
}) {
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group flex min-h-[44px] flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
          {collection.name}
        </h3>
        <ArrowRight
          className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
          aria-hidden="true"
        />
      </div>
      {collection.description ? (
        <p className="line-clamp-3 text-base text-muted-foreground">
          {collection.description}
        </p>
      ) : null}
      <p className="mt-auto text-sm font-medium text-muted-foreground">
        {count} {count === 1 ? 'bottle' : 'bottles'}
      </p>
    </Link>
  );
}
