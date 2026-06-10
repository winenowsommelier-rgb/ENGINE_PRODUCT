const NON_BEVERAGE_CLASSIFICATIONS = new Set([
  'accessories',
  'cigar',
  'events',
  'glassware',
  'mineral water',
  'non-alcoholic',
]);

const NON_BEVERAGE_PREFIXES = new Set([
  'ABA',
  'AWC',
  'CIG',
  'GBE',
  'GDC',
  'GLQ',
  'GWN',
  'WEV',
]);

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function hasMojibake(value) {
  return /(?:Ã|Â|â)[\u0080-\u00bf]|�/.test(clean(value));
}

export function isBeverage(product) {
  const classification = clean(product.classification).toLowerCase();
  const prefix = clean(product.sku).slice(0, 3).toUpperCase();

  if (NON_BEVERAGE_CLASSIFICATIONS.has(classification)) return false;
  if (NON_BEVERAGE_PREFIXES.has(prefix)) return false;
  if (classification === 'wine product') {
    return prefix.startsWith('L') || (prefix.startsWith('W') && prefix !== 'WEV');
  }
  return true;
}

export function computeReviewPriority(product) {
  const recentRevenue = Number(product.popularity_revenue_90d) || 0;
  const stock = Number(product.wn_stock ?? product.quantity_in_stock) || 0;
  if (recentRevenue > 0 || Number(product.has_recent_sales) === 1) return 'HIGH';
  if (stock > 0) return 'MEDIUM';
  return 'LOW';
}

function ageInDays(updatedAt, currentDate) {
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((currentDate.getTime() - parsed.getTime()) / 86_400_000);
}

export function assessProduct(product, currentDate = new Date()) {
  const blockers = [];
  const warnings = [];
  const name = clean(product.name);
  const shortDescription = clean(product.desc_en_short);
  const fullDescription = clean(product.full_description);
  const country = clean(product.country);
  const region = clean(product.region);
  const subregion = clean(product.subregion);
  const beverage = isBeverage(product);

  if (!clean(product.sku)) blockers.push('sku_missing');
  if (!name) blockers.push('name_missing');
  if ([
    name,
    shortDescription,
    fullDescription,
    country,
    region,
    subregion,
  ].some(hasMojibake)) {
    blockers.push('encoding_mojibake_detected');
  }

  const descriptionIsName = fullDescription.toLowerCase() === name.toLowerCase();
  if (fullDescription.length < 100 || descriptionIsName) {
    blockers.push('description_missing_or_too_short');
  }
  if (shortDescription.length < 50) blockers.push('short_description_missing_or_too_short');

  if (beverage && !country) blockers.push('beverage_country_missing');
  if (beverage && !region) blockers.push('beverage_region_missing');

  if (beverage && region && !subregion) warnings.push('missing_subregion');
  if (region && subregion && region.toLowerCase() === subregion.toLowerCase()) {
    warnings.push('region_equals_subregion');
  }

  const updateAgeDays = ageInDays(product.updated_at, currentDate);
  if (updateAgeDays > 45) warnings.push('stale_update_over_45_days');

  let status = 'READY';
  if (blockers.length > 0) {
    status = 'HOLD';
  } else if (
    warnings.includes('region_equals_subregion')
    || warnings.includes('stale_update_over_45_days')
  ) {
    status = 'REVIEW';
  } else if (warnings.length > 0) {
    status = 'READY_WITH_WARNING';
  }

  return {
    status,
    blockers,
    warnings,
    beverage,
    updateAgeDays,
  };
}

export function toMagentoRow(product, currentDate = new Date()) {
  const assessment = assessProduct(product, currentDate);
  return {
    sku: clean(product.sku),
    name: clean(product.name),
    country: clean(product.country),
    region: clean(product.region),
    subregion: clean(product.subregion),
    short_description: clean(product.desc_en_short),
    description: clean(product.full_description),
    updated_at: clean(product.updated_at),
    magento_readiness: assessment.status,
    quality_blockers: assessment.blockers.join('; '),
    quality_warnings: assessment.warnings.join('; '),
    current_validation_status: clean(product.validation_status),
    enrichment_quality_grade: clean(product.enrichment_quality_grade),
  };
}
