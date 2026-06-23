import { formatPrice, resolveSale } from '@/lib/price-tiers';

/**
 * PriceBlock — the product page's price line.
 *
 * Design A (strike + % badge): when a genuine special_price exists (< price),
 * the SALE price is shown large in the primary colour, the regular price is
 * struck through and muted, and a red discount pill states the % off. When there
 * is no sale (the majority of SKUs, incl. promotion-flag-only ones), it renders
 * exactly the previous single-price line — no badge, no strikethrough.
 *
 * Money safety: the discount is recomputed from (price, special_price) via
 * resolveSale, NOT read from the source sp_discount_pct string — so a stale or
 * malformed percent in the data can never display a wrong/fake discount.
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
    return <p className="text-2xl font-semibold text-primary tabular-nums">{formatPrice(price)}</p>;
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="text-2xl font-semibold text-primary tabular-nums">{formatPrice(sale.special)}</p>
      <p
        className="text-base text-muted-foreground line-through tabular-nums"
        aria-label={`Regular price ${formatPrice(price)}`}
      >
        {formatPrice(price)}
      </p>
      <span className="inline-flex items-center rounded-full bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
        −{sale.percentOff}%
      </span>
    </div>
  );
}
