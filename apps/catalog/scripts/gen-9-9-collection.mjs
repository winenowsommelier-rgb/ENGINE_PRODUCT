/**
 * gen-9-9-collection.mjs — One-off generator: 9.9 promo CSVs -> data/promo_9_9_collection.json
 *
 * Plain Node .mjs (runs before tsc) so it CANNOT import TS modules.
 * Parsing helpers are exported for unit testing (TDD).
 *
 * Run manually: node scripts/gen-9-9-collection.mjs
 * Re-run whenever corrected source CSVs are supplied (e.g. fixing #REF! rows).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** "2,349" / "959" / "#REF!" / "" -> number | null. */
export function parseMoney(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/^"|"$/g, '');
  if (s === '' || s === '#REF!') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "9%" / "#REF!" / "" -> number | null. */
export function parsePercent(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '#REF!') return null;
  const n = Number(s.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/** Recompute % off from regular vs promo price; 0 when not a genuine discount. */
export function computeDiscountPct(regularPrice, promoPrice) {
  if (typeof regularPrice !== 'number' || typeof promoPrice !== 'number') return 0;
  if (regularPrice <= 0 || promoPrice >= regularPrice) return 0;
  return Math.round(((regularPrice - promoPrice) / regularPrice) * 100);
}

/**
 * Map one raw CSV row (field names as they appear in the header) to a promo
 * item, or null if the row is unusable. On a #REF! 9.9 price (broken source
 * formula), falls back to the regular price for BOTH promoPrice and
 * regularPrice with discountPct 0 — included at regular price, no discount
 * badge, per user decision (spec: 2026-09-04-9-9-collection-promo-design.md).
 */
export function mapRow(row) {
  const sku = String(row.sku ?? '').trim();
  if (!sku) return null;

  const regularPrice = parseMoney(row.price);
  if (regularPrice === null) return null; // no usable price at all — skip the row

  const rawPromo = parseMoney(row['9.9 price']);
  const promoPrice = rawPromo === null ? regularPrice : rawPromo;
  const discountPct = computeDiscountPct(regularPrice, promoPrice);

  return { sku, promoPrice, regularPrice, discountPct };
}
