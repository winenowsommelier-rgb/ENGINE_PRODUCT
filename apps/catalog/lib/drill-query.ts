/**
 * Drill-down strand helpers. The two strands and their descendant chains:
 *   category: group → class
 *   geography: country → region → subregion
 *
 * When a user changes a parent level, the deeper levels become invalid and MUST
 * be cleared (design §3). buildQuery() does NOT do this — it's a generic patch
 * applier — so callers use clearDescendants to build the multi-key patch.
 *
 * Pure. No Next/React.
 */

export type DrillStrand = 'group' | 'class' | 'country' | 'region' | 'subregion';

/**
 * The descendant params cleared/dropped below each drill strand. Single source of
 * truth — also consumed by DrillBreadcrumb (jump-back nulls these deeper levels).
 */
export const DRILL_DESCENDANTS: Record<DrillStrand, DrillStrand[]> = {
  group: ['class'],
  class: [],
  country: ['region', 'subregion'],
  region: ['subregion'],
  subregion: [],
};

/**
 * Patch that sets `strand` to `value` (or removes it when value is null) and
 * clears every descendant param. Pass to buildQuery().
 */
export function clearDescendants(
  strand: DrillStrand,
  value: string | null,
): Record<string, string | null> {
  const patch: Record<string, string | null> = { [strand]: value };
  for (const d of DRILL_DESCENDANTS[strand]) patch[d] = null;
  return patch;
}
