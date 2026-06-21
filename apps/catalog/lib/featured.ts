/**
 * featured — the home page's "Featured" row.
 *
 * WHY THIS IS A MANUAL LIST (not auto "best-selling" / "most popular"):
 *   popularity_score now exists for ~29% of products (BI backfill, 2026-06), but
 *   it is sparse and skewed, so it drives the /shop Recommended ORDER rather than a
 *   home-page "best seller" claim. Inventing a per-tile popularity badge from such
 *   thin coverage would be a fake trust signal. Instead we hand-pick a small,
 *   confident set of real SKUs and present them honestly as "From the collection"
 *   / "Featured" — never as a popularity ranking.
 *
 * Each seeded SKU was verified against the live export as: in-stock, has an
 * image_url, has a positive price, and is critic-reviewed (non-empty
 * score_summary). They span Champagne / red / white so the row reads varied.
 *
 * RESILIENCE: if a seeded SKU goes missing or out-of-stock at build time,
 * resolveFeatured() drops it and back-fills from the same honest pool used to
 * pick these (in-stock + critic-reviewed + has image), so the row is always
 * full and never shows a broken/empty tile.
 */

import type { PublicProduct } from './types';
import { getProductBySku, getAllProducts } from './catalog-data';

/**
 * Hand-picked, verified featured SKUs (see file header). Seeded from real
 * in-stock, critic-reviewed, image-bearing products in live_products_export.json.
 */
export const FEATURED_SKUS: string[] = [
  'WSP1112BU', // Moet & Chandon Rose Imperial (750 ml) — Champagne
  'WRW6598GX', // VIK Milla Cala — Cachapoal Valley red
  'WWW1785GX', // Pounamu Sauvignon Blanc — Marlborough white
  'WRW6614GX', // VIK Millahue — Cachapoal Valley red
  'WSP1105BU', // Moet & Chandon Grand Vintage 2015 — Champagne
  'WRW6606DH', // Siro Pacenti Brunello di Montalcino — Tuscany red
  'WSP2633DH', // Champagne Albert Lebrun Blanc de Noir — Champagne
  'WWW1858DH', // Domaine Huet Le Clos Du Bourg — Loire white
];

/** Default number of tiles the home "Featured" row shows. */
export const FEATURED_COUNT = 8;

/** Is this product a valid, shippable featured tile? (in-stock + has an image) */
function isDisplayable(p: PublicProduct | undefined): p is PublicProduct {
  return Boolean(p && p.is_in_stock && p.image_url);
}

/**
 * Resolve the featured products for the home page.
 *
 * 1. Take each seeded SKU in order; keep it only if it still resolves and is
 *    in-stock with an image.
 * 2. If fewer than `count` survive, back-fill from the honest pool —
 *    in-stock + critic-reviewed (non-empty score_summary) + has image — skipping
 *    any already chosen — until we reach `count` (or run out).
 *
 * Pure-ish: reads the loaded catalog singletons (build-time), returns up to
 * `count` PublicProduct tiles. Never returns a broken/out-of-stock tile.
 */
export function resolveFeatured(count: number = FEATURED_COUNT): PublicProduct[] {
  const chosen: PublicProduct[] = [];
  const used = new Set<string>();

  for (const sku of FEATURED_SKUS) {
    if (chosen.length >= count) break;
    const p = getProductBySku(sku);
    if (isDisplayable(p) && !used.has(p.sku)) {
      chosen.push(p);
      used.add(p.sku);
    }
  }

  if (chosen.length < count) {
    for (const p of getAllProducts()) {
      if (chosen.length >= count) break;
      if (used.has(p.sku)) continue;
      const reviewed = Boolean(p.score_summary && p.score_summary.trim() !== '');
      if (reviewed && isDisplayable(p)) {
        chosen.push(p);
        used.add(p.sku);
      }
    }
  }

  return chosen;
}
