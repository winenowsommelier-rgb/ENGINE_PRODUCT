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
const AGAVE_TYPES = new Set(['Tequila', 'Mezcal']);
const RUM_TYPES = new Set(['Rum']);
const WHISKY_GROUPS = new Set(['Whisky']);
const SPARKLING_TYPES = new Set(['Champagne', 'Sparkling Wine', 'Crémant', 'Cava', 'Prosecco', 'Pétillant Naturel']);

/**
 * Additional points from category-specific fields (gin_style, agave_aging, etc.)
 * Returns 0 when fields are absent — never penalises.
 */
export function categorySignalPoints(
  product: PublicProduct,
  candidate: PublicProduct,
): number {
  const type = typeForProduct(product);
  const group = groupForProduct(product);

  // Group-based checks first: category_group is the broader, more reliable
  // classification signal. Checking it ahead of the type-based buckets below
  // also avoids Whisky products being mis-routed into the Gin branch when
  // category_type is stale/absent (category_group is populated independently).
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
  return 0;
}

function matchField(
  product: PublicProduct,
  candidate: PublicProduct,
  field: string,
  points: number,
): number {
  const a = (product as any)[field];
  const b = (candidate as any)[field];
  return a && b && a === b ? points : 0;
}

/**
 * Return a weight override for the region signal, or null to use the default (+3).
 * Gin: region is meaningless (London Dry can be made anywhere) → override to 0.
 * All other categories: null (use default).
 */
export function regionWeightOverride(product: PublicProduct): number | null {
  // Whisky (group) takes precedence over a possibly-stale/default category_type,
  // matching the precedence used in categorySignalPoints above.
  if (WHISKY_GROUPS.has(groupForProduct(product))) return null;
  if (GIN_TYPES.has(typeForProduct(product))) return 0;
  return null;
}
