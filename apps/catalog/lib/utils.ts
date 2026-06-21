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

/**
 * Parse a `food_matching` string into clean chip items.
 *
 * Data-shape note — the canonical separator is the pipe '|' (migrated
 * 2026-06-21 by scripts/migrate_food_matching_delimiter.py). Legacy rows used
 * a comma, but commas ALSO appear inside parenthetical clarifications, e.g.
 * "Shellfish (lobster, crab, prawn)" or "Comfort food (pasta bakes, casseroles,
 * roasts)". A naive `.split(',')` shatters those into broken chips.
 *
 * Strategy (defense-in-depth so un-migrated data still renders correctly):
 *   1. If '|' is present, split on it (unambiguous).
 *   2. Otherwise split on commas at parenthesis-depth 0 only, preserving any
 *      parenthetical that itself contains commas as a single item.
 *
 * Returns trimmed, non-empty items in source order.
 */
export function parseFoodMatching(food: string | undefined | null): string[] {
  if (!food) return [];
  if (food.includes('|')) {
    return food
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const items: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of food) {
    if (ch === '(') {
      depth += 1;
      buf += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      items.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  items.push(buf);
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}
