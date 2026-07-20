/**
 * category-scorer.ts — category-aware scoring overrides (Task 11, Phase 2).
 *
 * Some category-specific fields (gin_style, agave_aging, rum_style, peat_level,
 * production_method) are stronger similarity signals than region for their
 * respective categories — e.g. "London Dry" gin is made in many countries, so
 * region is a weak/misleading signal for gin specifically, while gin_style
 * (contemporary_citrus, juniper_forward, ...) is a strong style match.
 *
 * These fields were migrated + populated for real production data in Tasks 9-10
 * (gin/tequila/mezcal/rum/whisky/sparkling). This module adds the TS SCORING
 * layer that consumes them — see recommender.ts scoreCandidateDetailed() and
 * precomputeRecommendations() for the wiring.
 */

import type { PublicProduct } from '@/lib/types';
import { groupForProduct, typeForProduct } from '@/lib/category-groups';

const GIN_TYPES = new Set(['Gin']);
// 'Mezcal' is not a real category_type in the live export — Mezcal SKUs are
// typed 'Tequila' (verified 2026-07-09: 0/11,934 rows have category_type ===
// 'Mezcal'; all 22 mezcal-named products are category_type 'Tequila'). Kept
// in the set defensively (see SPARKLING_TYPES note below) in case the agave
// taxonomy is ever split.
const AGAVE_TYPES = new Set(['Tequila', 'Mezcal']);
const RUM_TYPES = new Set(['Rum']);
const WHISKY_GROUPS = new Set(['Whisky']);
// Real live export data (verified 2026-07-09 against data/live_products_export.json,
// 930 sparkling/champagne products) uses ONE combined category_type value,
// 'Sparkling & Champagne' — there is no separate 'Champagne'/'Sparkling Wine'/
// 'Prosecco' category_type; the traditional-vs-tank-method distinction lives
// only in the `production_method` field itself. Without 'Sparkling & Champagne'
// in this set, categorySignalPoints() never matched for ANY real sparkling
// product and the production_method scoring signal was silently dead since
// Task 11 shipped (Task 12 verification bug). The original aspirational values
// are kept alongside it (costs nothing) in case the taxonomy is ever split to
// match them.
const SPARKLING_TYPES = new Set([
  'Sparkling & Champagne',
  'Champagne',
  'Sparkling Wine',
  'Crémant',
  'Cava',
  'Prosecco',
  'Pétillant Naturel',
]);

/** Which field a category signal matched on, and how many points it's worth. */
export interface CategorySignalMatch {
  field: keyof PublicProduct;
  points: number;
}

/**
 * Additional points from category-specific fields (gin_style, agave_aging, etc.)
 * Returns null when fields are absent or don't match — never penalises.
 *
 * Returns the matched field name alongside the points (rather than a bare
 * number) so callers can attribute the points to a specific breakdown key
 * (e.g. `gin_style`, `peat_level`) instead of a generic bucket — this is
 * what keeps scoreBreakdown explainable for staff.
 */
export function categorySignalPoints(
  product: PublicProduct,
  candidate: PublicProduct,
): CategorySignalMatch | null {
  const type = typeForProduct(product);
  const group = groupForProduct(product);

  // Group-based check first: category_type can be absent or stale for a given
  // product even when category_group is populated (group is backfilled more
  // reliably than type — see Tasks 9-10). Checking WHISKY_GROUPS ahead of the
  // type-based buckets below ensures peat_level still gets scored for a Whisky
  // product whose category_type is missing/out of date, instead of silently
  // falling through to the `return null` at the bottom of this function.
  if (WHISKY_GROUPS.has(group)) {
    return matchField(product, candidate, 'peat_level', 3);
  }
  if (GIN_TYPES.has(type)) {
    return matchField(product, candidate, 'gin_style', 3);
  }
  if (AGAVE_TYPES.has(type)) {
    return matchField(product, candidate, 'agave_aging', 3);
  }
  if (RUM_TYPES.has(type)) {
    return matchField(product, candidate, 'rum_style', 3);
  }
  if (SPARKLING_TYPES.has(type)) {
    return matchField(product, candidate, 'production_method', 3);
  }
  return null;
}

function matchField(
  product: PublicProduct,
  candidate: PublicProduct,
  field: keyof PublicProduct,
  points: number,
): CategorySignalMatch | null {
  const a = product[field];
  const b = candidate[field];
  return a && b && a === b ? { field, points } : null;
}

/**
 * Return a weight override for the region signal, or null to use the default (+3).
 * Gin: region is meaningless (London Dry can be made anywhere) → override to 0.
 * All other categories: null (use default).
 */
export function regionWeightOverride(product: PublicProduct): number | null {
  // Whisky (group) is checked first for the same reason as in categorySignalPoints
  // above: category_type may be stale/absent while category_group is reliable.
  if (WHISKY_GROUPS.has(groupForProduct(product))) return null;
  if (GIN_TYPES.has(typeForProduct(product))) return 0;
  return null;
}
