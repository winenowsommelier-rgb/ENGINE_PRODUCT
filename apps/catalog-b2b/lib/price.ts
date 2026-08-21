/**
 * B2B/WNLQ9 Trade price display helpers.
 *
 * Private trade catalog: unlike the public storefront, RRP + wholesale
 * discount % are shown together (b2b_price is what they pay, price is RRP).
 */

export function formatPrice(price: number, currency?: string): string {
  const sym = currency === 'THB' || !currency ? '฿' : currency + ' ';
  return sym + price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Recomputes the wholesale discount from (price, b2b_price) — never trusts
 * the source b2b_discount_pct string (which may be stale, malformed, or a
 * pre-formatted "11.4" string from the export) — so a bad source value can
 * never render a wrong/fake discount. Returns null when there's no genuine
 * discount (missing RRP, or b2b_price not actually below RRP).
 */
export function wholesaleDiscountPct(
  price: number | null | undefined,
  b2bPrice: number | null | undefined,
): number | null {
  if (
    price === null || price === undefined || Number.isNaN(price) ||
    b2bPrice === null || b2bPrice === undefined || Number.isNaN(b2bPrice)
  ) {
    return null;
  }
  if (b2bPrice <= 0 || b2bPrice >= price) return null;
  const pct = ((price - b2bPrice) / price) * 100;
  if (pct < 1) return null;
  return Math.round(pct * 10) / 10;
}
