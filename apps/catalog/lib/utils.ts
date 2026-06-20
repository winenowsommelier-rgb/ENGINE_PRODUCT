import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Robust stock check for `PublicProduct.is_in_stock`.
 *
 * IMPORTANT — the live export stores is_in_stock as a STRING ("0"/"1") or null,
 * NOT the boolean the type advertises. A naive `value !== false` check would
 * treat the string "0" as in-stock (since "0" !== false), so the out-of-stock
 * badge would never appear with real data. Likewise a plain truthiness check
 * (`!!value`) treats "0" as in-stock because non-empty strings are truthy.
 *
 * This normalises the known shapes so the storefront agrees with the data:
 *   in-stock  -> true,  1, "1", "true"  (case-insensitive)
 *   out-of-stock -> false, 0, "0", "false", "", null, undefined
 *
 * Unknown/missing values default to in-stock (don't hide sellable products on
 * a parsing edge case); only explicit out-of-stock signals show the badge.
 */
export function isInStock(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '' || v === '0' || v === 'false' || v === 'no') return false;
    return true;
  }
  return Boolean(value);
}
