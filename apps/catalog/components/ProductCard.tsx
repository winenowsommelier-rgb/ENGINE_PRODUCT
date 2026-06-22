'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { StorefrontImage } from '@/components/StorefrontImage';
import { CriticScoreStrip } from '@/components/CriticScoreStrip';
import { QuickView } from '@/components/QuickView';
import { formatPrice } from '@/lib/price-tiers';
import { cn, isInStock } from '@/lib/utils';
import type { PublicProduct } from '@/lib/types';
import type { ContactLinks } from '@/lib/contact';

/**
 * ProductCard — the Maison grid tile.
 *
 * Layout: large bottle image (aspect-[3/4], object-contain) on top; below it
 * the product name (18px, 2-line clamp), a muted brand/region subtitle, and a
 * prominent price. The WHOLE card links to /product/[sku].
 *
 * Two interactive details:
 *  - "Quick look" button opens the QuickView modal WITHOUT navigating. It lives
 *    INSIDE the card link, so it must stopPropagation + preventDefault to avoid
 *    following the card's href. Appears on hover (desktop) / always tappable
 *    (mobile), 44px target.
 *  - Out-of-stock products get a calm muted badge but stay clickable.
 *
 * Client component: owns the QuickView open state and the quick-look handler.
 */

interface ProductCardProps {
  product: PublicProduct;
  /**
   * Optional ready-made contact deep-links for this product (built server-side).
   * Passed straight through to QuickView; when omitted, QuickView shows no
   * contact buttons. Pages wire this in (Tasks 10/11).
   */
  contactLinks?: ContactLinks;
}

export function ProductCard({ product, contactLinks }: ProductCardProps) {
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const subtitle = product.brand || product.region;
  const inStock = isInStock(product.is_in_stock);

  const openQuickView = (e: React.MouseEvent) => {
    // Inside the card <Link>; don't navigate when opening the modal.
    e.preventDefault();
    e.stopPropagation();
    setQuickViewOpen(true);
  };

  return (
    <>
      <div className="group relative">
        <Link
          href={`/product/${product.sku}`}
          className={cn(
            'block rounded-lg border border-transparent transition-all',
            'hover:-translate-y-0.5 hover:border-border hover:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {/* Image + overlays */}
          <div className="relative">
            <StorefrontImage
              src={product.image_url}
              alt={product.name}
              className="rounded-lg"
            />

            {!inStock ? (
              <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border">
                Check availability
              </span>
            ) : null}

            {/* Critic score — compact pill, top-right. Renders nothing for
                unscored products (helper-gated), so no empty overlay. */}
            <div className="absolute right-2 top-2">
              <CriticScoreStrip
                variant="compact"
                scoreMax={product.score_max}
                scoreSummary={product.score_summary}
              />
            </div>

            {/* Quick look — visible on mobile, fades in on desktop hover. */}
            <button
              type="button"
              onClick={openQuickView}
              aria-label={`Quick look at ${product.name}`}
              className={cn(
                'absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center',
                'rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border',
                'transition-opacity hover:bg-background hover:text-primary',
                'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
              )}
            >
              <Eye className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Text block */}
          <div className="px-1 pb-1 pt-3">
            <h3 className="line-clamp-2 text-lg font-medium leading-snug text-foreground">
              {product.name}
            </h3>
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
            <p className="mt-2 text-lg font-semibold text-primary">
              {formatPrice(product.price)}
            </p>
          </div>
        </Link>
      </div>

      <QuickView
        product={product}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
        contactLinks={contactLinks}
      />
    </>
  );
}
