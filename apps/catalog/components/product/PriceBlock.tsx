import { resolveSale } from '@/lib/price-tiers';
import { PriceDisplay } from '@/components/PriceDisplay';

/**
 * PriceBlock — the product page's price line.
 *
 * Single-price display (Thai law: only one price may be shown per product —
 * no crossed-out "was" price, no percent-off). When a genuine special_price
 * exists (< price), only the special price is shown, large, with a plain
 * "Sale" badge and no reference to the regular price anywhere. When there is
 * no sale (the majority of SKUs, incl. promotion-flag-only ones), it renders
 * exactly the previous single-price line — no badge.
 *
 * Renders through PriceDisplay, so until a visitor unlocks prices this shows
 * the ฿-tier icon instead of the real number (see PriceUnlockProvider).
 */
export function PriceBlock({
  price,
  specialPrice,
}: {
  price: number | null | undefined;
  specialPrice?: number | null;
}) {
  const sale = resolveSale(price, specialPrice);

  if (!sale) {
    // No genuine sale — unchanged single-price line.
    return <p className="text-2xl font-semibold text-primary tabular-nums"><PriceDisplay price={price} /></p>;
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="text-2xl font-semibold text-primary tabular-nums"><PriceDisplay price={sale.special} /></p>
      <span className="inline-flex items-center rounded-full bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
        Sale
      </span>
    </div>
  );
}
