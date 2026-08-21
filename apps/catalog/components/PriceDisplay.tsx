'use client';

import { formatPrice, priceTierIcon } from '@/lib/price-tiers';
import { usePriceUnlock } from '@/components/PriceUnlockProvider';
import { cn } from '@/lib/utils';

/**
 * PriceDisplay — the single chokepoint for rendering a price anywhere in the
 * storefront. Shows the real formatted price once unlocked (usePriceUnlock);
 * otherwise shows the coarse ฿-tier icon (priceTierIcon) and, when clicked,
 * opens the unlock passcode modal.
 *
 * Every card/grid/detail price line should render through this component
 * instead of calling formatPrice directly, so the unlock gate can never be
 * missed at a new call site.
 */
export function PriceDisplay({
  price,
  className,
}: {
  price: number | null | undefined;
  className?: string;
}) {
  const { unlocked, openModal } = usePriceUnlock();

  if (unlocked) {
    return <span className={className}>{formatPrice(price)}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Card prices usually sit inside a <Link>; don't navigate on click.
        e.preventDefault();
        e.stopPropagation();
        openModal();
      }}
      aria-label="Unlock to see price"
      className={cn(className, 'cursor-pointer underline decoration-dotted underline-offset-4')}
    >
      {priceTierIcon(price)}
    </button>
  );
}
