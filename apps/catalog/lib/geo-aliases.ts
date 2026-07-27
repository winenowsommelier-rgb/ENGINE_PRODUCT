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

/** The chain of ancestor names above a region, nearest first. Empty when top-level. */
export function regionAncestors(
  country: string | null | undefined,
  region: string | null | undefined,
): string[] {
  const countryKey = normGeo(country);
  const out: string[] = [];
  let cursor = normGeo(region);
  // Bounded walk — the table is shallow, but guard against a future cycle.
  for (let i = 0; i < 8; i += 1) {
    const parent = HIERARCHY_PARENT[countryKey]?.[cursor];
    if (!parent) break;
    out.push(parent);
    cursor = normGeo(parent);
  }
  return out;
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
