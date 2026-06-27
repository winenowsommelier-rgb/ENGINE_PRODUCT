export function normGeo(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

const REGION_ALIASES_BY_COUNTRY: Record<string, Record<string, string>> = {
  usa: {
    napa: 'California',
    'napa valley': 'California',
  },
  scotland: {
    highlands: 'Highland',
    lowlands: 'Lowland',
  },
};

function regionAliasValuesForCountry(country: string | null | undefined): Set<string> {
  const countryKey = normGeo(country);
  return new Set(Object.values(REGION_ALIASES_BY_COUNTRY[countryKey] ?? {}).map(normGeo));
}

export function canonicalRegionForCountry(country: string | null | undefined, region: string | null | undefined): string {
  const raw = (region ?? '').trim();
  if (!raw) return '';

  const countryKey = normGeo(country);
  const regionKey = normGeo(raw);
  if (countryKey && countryKey === regionKey) return '';
  return REGION_ALIASES_BY_COUNTRY[countryKey]?.[regionKey] ?? raw;
}

export function isRegionLevelValueForCountry(
  country: string | null | undefined,
  value: string | null | undefined,
): boolean {
  const rawKey = normGeo(value);
  if (!rawKey) return false;
  const countryKey = normGeo(country);
  return (countryKey && countryKey === rawKey) || regionAliasValuesForCountry(country).has(rawKey);
}

export function regionMatchesFilter(
  productCountry: string | null | undefined,
  productRegion: string | null | undefined,
  filterRegion: string,
): boolean {
  return normGeo(canonicalRegionForCountry(productCountry, productRegion)) === normGeo(filterRegion);
}
