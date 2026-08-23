'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { StorefrontImage } from '@/components/StorefrontImage';
import { CriticScoreStrip } from '@/components/CriticScoreStrip';
import { ReputationBadge } from '@/components/product/ReputationBadge';
import { QuickView } from '@/components/QuickView';
import { CompactGauges } from '@/components/product/CompactGauges';
import { resolveSale } from '@/lib/price-tiers';
import { formatVintage, cn, isInStock } from '@/lib/utils';
import { PriceDisplay } from '@/components/PriceDisplay';
import { SaveToListButton } from '@/components/lists/SaveToListButton';
import type { PublicProduct } from '@/lib/types';
import type { ContactLinks } from '@/lib/contact';
import type { ListRow } from '@/lib/supabase/types';

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
  /**
   * Opt-in: render a compact "Details" (origin/variety/vintage) + "Taste
   * profile" (structural gauges) block under the price. OFF by default —
   * ProductCard is shared across shop/homepage/finder/blog grids, and this
   * adds real card height, so only the product detail page's "You might also
   * like" rail turns it on.
   *
   * `structural` is computed SERVER-SIDE by the caller via
   * lib/taste-adapter.ts:toStructural() and passed in as a plain prop —
   * ProductCard is a client component and toStructural's dependency chain
   * (category-groups.ts) touches Node's `fs`, so it cannot be imported here.
   */
  showDetails?: boolean;
  structural?: Record<string, string>;
  /**
   * Optional recommendation-reason pill (e.g. "Similar style", "Step up ↑"),
   * rendered top-left over the image, above the stock-status badge. Only the
   * PDP "You might also like" rail (RecsCarousel) passes this.
   */
  bandLabel?: string;
  /**
   * Optional honest match-band label ("Great match" / "Strong match" / "Good
   * match" — spec §11.9). Overlaid top-left on the image, above the
   * recommendation-reason/stock-status stack. Finder result grid only.
   */
  matchBand?: string;
  /**
   * Whether the current visitor is signed in. Drives SaveToListButton's
   * click behavior (optimistic add vs. redirect to /login). Defaults to
   * false (safe: shows a plain pin that redirects to login) so call sites
   * that haven't been updated yet still render correctly.
   */
  isLoggedIn?: boolean;
  /**
   * The signed-in caller's own lists, needed only so SaveToListButton can
   * decide whether to show its list-picker chevron (2+ lists). Empty/omitted
   * is safe -- the button just shows as a plain pin with no picker.
   */
  userLists?: ListRow[];
}

/** Key attributes for the compact card details block, in display order. */
function compactAttrRows(p: PublicProduct): Array<{ label: string; value: string }> {
  const vintage = formatVintage(p.vintage);
  const rows: Array<{ label: string; value: string | undefined | number }> = [
    { label: 'Origin', value: [p.country, p.region].filter(Boolean).join(', ') || undefined },
    { label: 'Variety', value: p.variety },
    { label: 'Vintage', value: vintage.display },
  ];
  return rows
    .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
    .map((r) => ({ label: r.label, value: String(r.value) }));
}

export function ProductCard({
  product,
  contactLinks,
  showDetails = false,
  structural: structuralProp,
  bandLabel,
  matchBand,
  isLoggedIn = false,
  userLists = [],
}: ProductCardProps) {
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const subtitle = product.brand || product.region;
  const inStock = isInStock(product.is_in_stock);
  const isArchived = product.custom_stock_status === 'CATALOG';
  const hasExpressDelivery = (product.wn_stock ?? 0) > 0;
  // Sale price (only when a genuine special_price < price); recomputed from the
  // prices so a stale source percent can never render a fake discount.
  const sale = resolveSale(product.price, product.special_price);

  // Compact Details + Taste profile — only computed when showDetails is on.
  const detailRows = showDetails ? compactAttrRows(product) : [];
  const structural = showDetails ? structuralProp ?? {} : {};

  const openQuickView = (e: React.MouseEvent) => {
    // Inside the card <Link>; don't navigate when opening the modal.
    e.preventDefault();
    e.stopPropagation();
    setQuickViewOpen(true);
  };

  return (
    <>
      <div className="group relative h-full">
        <Link
          href={`/product/${product.sku}`}
          className={cn(
            'flex h-full flex-col rounded-xl border border-stone-100 bg-white transition-all',
            'hover:-translate-y-0.5 hover:border-stone-200 hover:shadow-md',
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

            {/* Top-left overlay stack: honest match-band, then recommendation-reason
                band, then stock status. All optional and stack vertically when
                more than one is present so nothing is ever cropped or overlapped. */}
            <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
              {matchBand ? (
                <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm ring-1 ring-primary/20">
                  {matchBand}
                </span>
              ) : null}
              {bandLabel ? (
                <span className="inline-flex items-center rounded-full border border-border bg-background/95 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                  {bandLabel}
                </span>
              ) : null}
              {/* Stock status badge. Priority: Archive > Check availability > Express. */}
              {isArchived ? (
                <span className="rounded-full bg-muted/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border">
                  Archive
                </span>
              ) : !inStock ? (
                <span className="rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border">
                  Check availability
                </span>
              ) : hasExpressDelivery ? (
                <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                  Express Delivery
                </span>
              ) : null}
            </div>

            {/* Reputation tier — bottom-left, iconic/premium only. Renders nothing for
                established/everyday/unrated (too noisy) or when no data. */}
            <ReputationBadge tier={product.reputation_tier} className="absolute bottom-14 left-2" />

            {/* SKU — bottom-left of image, above the item name. */}
            <span className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground shadow-sm ring-1 ring-border">
              {product.sku}
            </span>

            {/* Critic score — compact pill, top-right. Renders nothing for
                unscored products (helper-gated), so no empty overlay. */}
            <div className="absolute right-2 top-2">
              <CriticScoreStrip
                variant="compact"
                scoreMax={product.score_max}
                scoreSummary={product.score_summary}
              />
            </div>

            {/* Save-to-list pin — top-right, below the critic score pill
                (top-2, ~24px tall) with a clear gap, so the two never
                collide even when both render. */}
            <SaveToListButton
              sku={product.sku}
              isLoggedIn={isLoggedIn}
              userLists={userLists}
              className="absolute right-2 top-12"
            />

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

          {/* Text block — flex column so the details/gauges block (mt-auto) pins to
              the bottom of the card regardless of how much the title/subtitle wrap,
              keeping every card in a row the same visual rhythm at equal height
              (parent .group is h-full, Link is flex flex-col h-full). */}
          <div className="flex flex-1 flex-col px-3 pb-3 pt-3">
            <h3 className="line-clamp-2 text-lg font-medium leading-snug text-foreground">
              {product.name}
            </h3>
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
            {sale ? (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-lg font-semibold text-primary tabular-nums">
                  <PriceDisplay price={sale.special} />
                </span>
                <span className="inline-flex items-center rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                  Sale
                </span>
              </div>
            ) : (
              <p className="mt-2 text-lg font-semibold text-primary tabular-nums">
                <PriceDisplay price={product.price} />
              </p>
            )}

            {(detailRows.length > 0 || Object.keys(structural).length > 0) ? (
              <div className="mt-auto flex flex-col gap-3 border-t border-stone-100 pt-3">
                {detailRows.length > 0 ? (
                  <dl className="flex flex-col gap-1.5">
                    {detailRows.map((row) => (
                      <div key={row.label} className="flex justify-between gap-3 text-xs leading-relaxed">
                        <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                        <dd className="truncate text-right font-medium text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {Object.keys(structural).length > 0 ? <CompactGauges structural={structural} /> : null}
              </div>
            ) : null}
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
