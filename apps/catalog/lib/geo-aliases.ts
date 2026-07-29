export function normGeo(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Geography alias tables. TWO DISTINCT CONCEPTS — do not merge them again.
 *
 * SPELLING_ALIASES rewrites a mis-spelled value to its canonical form. The value
 * still names the SAME place at the SAME level.
 *
 * HIERARCHY_PARENT records that one place sits INSIDE another. It must NOT rewrite
 * the value — doing so destroys a level. `napa valley -> California` lived in the
 * alias table until 2026-07-27 and was the root cause of the explore map showing
 * every USA wine as "California" (spec: 2026-07-27-geography-resolution-design.md).
 */
const SPELLING_ALIASES: Record<string, Record<string, string>> = {
  scotland: {
    highlands: 'Highland',
    lowlands: 'Lowland',
  },
};

/** child (normalized) -> parent NAME, per country. A rollup link, never a rewrite. */
const HIERARCHY_PARENT: Record<string, Record<string, string>> = {
  usa: {
    napa: 'California',
    'napa valley': 'California',
  },
};

function spellingValuesForCountry(country: string | null | undefined): Set<string> {
  const countryKey = normGeo(country);
  return new Set(Object.values(SPELLING_ALIASES[countryKey] ?? {}).map(normGeo));
}

function parentValuesForCountry(country: string | null | undefined): Set<string> {
  const countryKey = normGeo(country);
  return new Set(Object.values(HIERARCHY_PARENT[countryKey] ?? {}).map(normGeo));
}

export function canonicalRegionForCountry(
  country: string | null | undefined,
  region: string | null | undefined,
): string {
  const raw = (region ?? '').trim();
  if (!raw) return '';

  const countryKey = normGeo(country);
  const regionKey = normGeo(raw);
  if (countryKey && countryKey === regionKey) return '';
  // SPELLING only. Hierarchy parents are deliberately NOT applied here.
  return SPELLING_ALIASES[countryKey]?.[regionKey] ?? raw;
}

/**
 * True when `value` names a REGION-level place for this country — i.e. it is the
 * country itself, a canonical spelling target, or a hierarchy parent. Used to drop
 * a redundant subregion (e.g. region='Napa Valley', subregion='California').
 *
 * MUST read the UNION of both tables: reading only HIERARCHY_PARENT regresses
 * Scotland; reading only SPELLING_ALIASES regresses California.
 */
export function isRegionLevelValueForCountry(
  country: string | null | undefined,
  value: string | null | undefined,
): boolean {
  const rawKey = normGeo(value);
  if (!rawKey) return false;
  const countryKey = normGeo(country);
  if (countryKey && countryKey === rawKey) return true;
  return spellingValuesForCountry(country).has(rawKey)
    || parentValuesForCountry(country).has(rawKey);
}

/**
 * Walk a child->parent table upward from `start`, nearest first.
 *
 * Cycle-safe: a repeated name ends the walk, so each ancestor appears AT MOST ONCE
 * and no region is ever reported as its own ancestor. A bare bounded loop is not
 * enough — it stops the hang but still returns garbage (a->b, b->a yielded
 * ['B','A','B','A','B','A','B','A']). The bound stays as a second guard.
 *
 * Exported for testing the cycle guard against a synthetic table; the real table is
 * acyclic, so the guard is otherwise unreachable from production data.
 */
export function walkAncestors(
  table: Record<string, string> | undefined,
  start: string,
): string[] {
  const out: string[] = [];
  const visited = new Set<string>([start]);
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    const parent = table?.[cursor];
    if (!parent) break;
    const parentKey = normGeo(parent);
    if (visited.has(parentKey)) break; // cycle — stop before repeating a name
    visited.add(parentKey);
    out.push(parent);
    cursor = parentKey;
  }
  return out;
}

/** The chain of ancestor names above a region, nearest first. Empty when top-level. */
export function regionAncestors(
  country: string | null | undefined,
  region: string | null | undefined,
): string[] {
  return walkAncestors(HIERARCHY_PARENT[normGeo(country)], normGeo(region));
}

/**
 * Does a product's region satisfy `?region=` ? True on a direct (canonical) match
 * OR when the filter names any ANCESTOR of the product's region.
 *
 * Ancestor matching costs ~1 row today (only one export row sits at
 * region='Napa Valley'). It is correctness insurance for Phase B3, which normalizes
 * swapped/junk region values and can move rows onto child regions — without this,
 * such rows would silently vanish from the parent's grid.
 */
export function regionMatchesFilter(
  productCountry: string | null | undefined,
  productRegion: string | null | undefined,
  filterRegion: string,
): boolean {
  const want = normGeo(filterRegion);
  const own = normGeo(canonicalRegionForCountry(productCountry, productRegion));
  if (own === want) return true;
  return regionAncestors(productCountry, productRegion).some((a) => normGeo(a) === want);
}
