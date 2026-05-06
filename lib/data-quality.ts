/**
 * Data Quality Scoring Engine
 * Scores product data quality across 5 dimensions (total = 100 points).
 */

// ── Required fields per scope ─────────────────────────────────────────────────

const REQUIRED_FIELDS: Record<string, string[]> = {
  wine: [
    'classification', 'country', 'region', 'grape_variety', 'vintage',
    'desc_en_short', 'desc_en_full', 'wine_body', 'wine_acidity',
    'wine_tannin', 'price',
  ],
  spirits: [
    'classification', 'country', 'brand', 'desc_en_short', 'desc_en_full',
    'style', 'price',
  ],
  sake: [
    'classification', 'country', 'brand', 'desc_en_short', 'desc_en_full',
    'price',
  ],
  beer: [
    'classification', 'country', 'brand', 'desc_en_short', 'desc_en_full',
    'style', 'price',
  ],
  accessories: [
    'classification', 'brand', 'desc_en_short', 'price',
  ],
};

// Map classification keywords to scope
const SCOPE_KEYWORDS: Array<[RegExp, string]> = [
  [/wine|champagne|ros[eé]|sparkling|prosecco|cava/i, 'wine'],
  [/whisky|whiskey|gin|vodka|rum|tequila|mezcal|brandy|cognac|liqueur|spirit|aperitif|vermouth|bitters|absinthe/i, 'spirits'],
  [/sake|shochu/i, 'sake'],
  [/beer|ale|lager|stout|ipa|pilsner/i, 'beer'],
  [/accessor|glass|gift|corkscrew|decant|opener|stopper/i, 'accessories'],
];

const PLACEHOLDER_PATTERNS = [
  /^wine product$/i,
  /^unknown$/i,
  /^tbd$/i,
  /^n\/a$/i,
  /^na$/i,
  /^null$/i,
  /^none$/i,
  /^-$/,
  /^\.$/,
  /^test$/i,
  /^placeholder$/i,
  /^description$/i,
  /^lorem ipsum/i,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferScope(classification: string | null | undefined): string {
  if (!classification) return 'wine'; // default fallback
  for (const [re, scope] of SCOPE_KEYWORDS) {
    if (re.test(classification)) return scope;
  }
  return 'wine'; // default
}

function hasValue(val: any): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  return true;
}

function isPlaceholder(val: string | null | undefined): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

function normalizeFieldValue(product: any, field: string): any {
  // Map scoring fields to actual product column names
  const fieldMap: Record<string, string[]> = {
    desc_en_short: ['desc_en_short', 'short_description_en'],
    desc_en_full: ['desc_en_full', 'description_en_text'],
    grape_variety: ['grape_variety', 'grape'],
  };
  const candidates = fieldMap[field] ?? [field];
  for (const key of candidates) {
    if (hasValue(product[key])) return product[key];
  }
  return null;
}

// ── Score dimensions ──────────────────────────────────────────────────────────

function scoreCompleteness(product: any, scope: string): { score: number; missing: string[] } {
  const required = REQUIRED_FIELDS[scope] ?? REQUIRED_FIELDS.wine;
  const missing: string[] = [];
  let filled = 0;

  for (const field of required) {
    const val = normalizeFieldValue(product, field);
    if (hasValue(val) && !isPlaceholder(typeof val === 'string' ? val : null)) {
      filled++;
    } else {
      missing.push(field);
    }
  }

  return {
    score: required.length > 0 ? Math.round((filled / required.length) * 35) : 35,
    missing,
  };
}

function scoreDescriptionQuality(product: any): { score: number; issues: string[] } {
  let score = 0;
  const issues: string[] = [];

  const short = normalizeFieldValue(product, 'desc_en_short');
  const full = normalizeFieldValue(product, 'desc_en_full');

  // Short description
  if (typeof short === 'string' && short.length >= 20 && short.length <= 200) {
    score += 10;
  } else if (!short || (typeof short === 'string' && short.length < 20)) {
    issues.push('desc_en_short missing or too short (< 20 chars)');
  } else if (typeof short === 'string' && short.length > 200) {
    issues.push('desc_en_short too long (> 200 chars)');
  }

  // Full description
  if (typeof full === 'string' && full.length > 100) {
    score += 10;
  } else {
    issues.push('desc_en_full missing or too short (< 100 chars)');
  }

  // No placeholders
  const hasPlaceholderShort = isPlaceholder(short);
  const hasPlaceholderFull = isPlaceholder(full);
  const namePlaceholder = isPlaceholder(product.name);

  if (!hasPlaceholderShort && !hasPlaceholderFull && !namePlaceholder) {
    score += 5;
  } else {
    issues.push('Contains placeholder text');
  }

  return { score, issues };
}

function scoreTaxonomyAccuracy(product: any): { score: number; issues: string[] } {
  let score = 0;
  const issues: string[] = [];

  // Item category matches scope (has a valid item category)
  if (hasValue(product.classification) && !isPlaceholder(product.classification)) {
    score += 5;
  } else {
    issues.push('Missing or invalid item category');
  }

  // Country exists
  if (hasValue(product.country) && !isPlaceholder(product.country)) {
    score += 5;
  } else {
    issues.push('Missing country');
  }

  // Region exists
  if (hasValue(product.region) && !isPlaceholder(product.region)) {
    score += 5;
  } else {
    issues.push('Missing region');
  }

  // Brand exists
  if (hasValue(product.brand) && !isPlaceholder(product.brand)) {
    score += 5;
  } else {
    issues.push('Missing brand');
  }

  return { score, issues };
}

function scoreDataConsistency(product: any): { score: number; issues: string[] } {
  let score = 0;
  const issues: string[] = [];

  // Vintage check
  const vintage = product.vintage;
  if (vintage) {
    const vintageStr = String(vintage).trim();
    const isCleanYear = /^\d{4}$/.test(vintageStr);
    const isNV = /^N\.?V\.?$/i.test(vintageStr);
    const hasMayChange = /MAY\s*CHANGE/i.test(vintageStr);
    if (isCleanYear && !hasMayChange) {
      score += 5;
    } else if (isNV) {
      // NV is a legitimate vintage designation for Champagne, sparkling, fortified, spirits
      score += 5;
    } else {
      issues.push(hasMayChange ? 'Vintage contains "MAY CHANGE"' : `Vintage not clean 4-digit year: "${vintageStr}"`);
    }
  } else {
    // No vintage may be fine for spirits/accessories — still give partial credit based on scope
    const scope = inferScope(product.classification);
    if (scope !== 'wine') {
      score += 5; // spirits/accessories don't need vintage
    } else {
      issues.push('Missing vintage for wine product');
    }
  }

  // Price check
  const price = parseFloat(product.price);
  if (!isNaN(price) && price > 0 && price < 200000) {
    score += 5;
  } else {
    issues.push(isNaN(price) || !product.price ? 'Missing price' : `Price out of range: ${price}`);
  }

  return { score, issues };
}

function scoreEnrichmentDepth(product: any): { score: number; issues: string[] } {
  let score = 0;
  const issues: string[] = [];

  // Has flavor_tags
  const tags = product.flavor_tags;
  if (hasValue(tags) && (Array.isArray(tags) ? tags.length > 0 : String(tags).trim().length > 0)) {
    score += 3;
  } else {
    issues.push('Missing flavor_tags');
  }

  // Has food_matching
  const food = product.food_matching;
  if (hasValue(food) && (Array.isArray(food) ? food.length > 0 : String(food).trim().length > 0)) {
    score += 3;
  } else {
    issues.push('Missing food_matching');
  }

  // Has wine character dimensions (for wine)
  const scope = inferScope(product.classification);
  if (scope === 'wine') {
    const hasBody = hasValue(product.wine_body);
    const hasAcidity = hasValue(product.wine_acidity);
    const hasTannin = hasValue(product.wine_tannin);
    if (hasBody && hasAcidity && hasTannin) {
      score += 4;
    } else {
      const missingDims: string[] = [];
      if (!hasBody) missingDims.push('wine_body');
      if (!hasAcidity) missingDims.push('wine_acidity');
      if (!hasTannin) missingDims.push('wine_tannin');
      issues.push(`Missing wine dimensions: ${missingDims.join(', ')}`);
    }
  } else {
    // Non-wine products get full marks for character dimensions
    score += 4;
  }

  return { score, issues };
}

// ── Main scoring function ─────────────────────────────────────────────────────

export type ScoreBreakdown = {
  completeness: number;
  description_quality: number;
  taxonomy_accuracy: number;
  data_consistency: number;
  enrichment_depth: number;
};

export type ProductScore = {
  total: number;
  breakdown: ScoreBreakdown;
  missing: string[];
  issues: string[];
  scope: string;
};

export function scoreProduct(product: any): ProductScore {
  const scope = inferScope(product.classification);

  const completeness = scoreCompleteness(product, scope);
  const descQuality = scoreDescriptionQuality(product);
  const taxonomyAcc = scoreTaxonomyAccuracy(product);
  const consistency = scoreDataConsistency(product);
  const enrichment = scoreEnrichmentDepth(product);

  const breakdown: ScoreBreakdown = {
    completeness: completeness.score,
    description_quality: descQuality.score,
    taxonomy_accuracy: taxonomyAcc.score,
    data_consistency: consistency.score,
    enrichment_depth: enrichment.score,
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const allIssues = [
    ...descQuality.issues,
    ...taxonomyAcc.issues,
    ...consistency.issues,
    ...enrichment.issues,
  ];

  return {
    total,
    breakdown,
    missing: completeness.missing,
    issues: allIssues,
    scope,
  };
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

export type ValidationSummary = {
  summary: {
    total: number;
    avg_score: number;
    passing: number;
    failing: number;
  };
  distribution: Record<string, number>;
  top_issues: Array<{ field: string; missing_count: number; pct: number }>;
  products: Array<any & { quality_score: ProductScore }>;
};

export function buildValidationReport(products: any[]): ValidationSummary {
  const scored = products.map(p => {
    const quality_score = scoreProduct(p);
    return { ...p, quality_score };
  });

  // Sort by score ascending (worst first)
  scored.sort((a, b) => a.quality_score.total - b.quality_score.total);

  const total = scored.length;
  const totalScore = scored.reduce((s, p) => s + p.quality_score.total, 0);
  const avg_score = total > 0 ? Math.round(totalScore / total) : 0;
  const passing = scored.filter(p => p.quality_score.total >= 75).length;
  const failing = total - passing;

  // Distribution buckets
  const distribution: Record<string, number> = {
    '90+': 0, '80-89': 0, '70-79': 0, '60-69': 0, '<60': 0,
  };
  for (const p of scored) {
    const s = p.quality_score.total;
    if (s >= 90) distribution['90+']++;
    else if (s >= 80) distribution['80-89']++;
    else if (s >= 70) distribution['70-79']++;
    else if (s >= 60) distribution['60-69']++;
    else distribution['<60']++;
  }

  // Top issues — count missing fields across all products
  const fieldCounts: Record<string, number> = {};
  for (const p of scored) {
    for (const field of p.quality_score.missing) {
      fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
    }
    // Also count issue-based fields
    for (const issue of p.quality_score.issues) {
      // Extract the field name from the issue string
      const match = issue.match(/^Missing ([\w_]+)/);
      if (match && !p.quality_score.missing.includes(match[1])) {
        fieldCounts[match[1]] = (fieldCounts[match[1]] ?? 0) + 1;
      }
    }
  }

  const top_issues = Object.entries(fieldCounts)
    .map(([field, missing_count]) => ({
      field,
      missing_count,
      pct: total > 0 ? Math.round((missing_count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.missing_count - a.missing_count);

  return {
    summary: { total, avg_score, passing, failing },
    distribution,
    top_issues,
    products: scored,
  };
}

// ── CSV export helper ─────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'sku', 'sku_base', 'name', 'classification', 'wine_color', 'style',
  'country', 'region', 'subregion', 'appellation', 'vintage', 'brand',
  'grape_variety', 'wine_body', 'wine_acidity', 'wine_tannin',
  'flavor_tags', 'food_matching', 'overall_confidence',
  'desc_en_short', 'desc_en_full', 'bottle_size', 'price',
  'validation_status', 'enrichment_priority',
  'quality_score_total', 'score_completeness', 'score_description',
  'score_taxonomy', 'score_consistency', 'score_enrichment',
  'scope', 'missing_fields', 'issues',
];

function escCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(scoredProducts: Array<any & { quality_score: ProductScore }>): string {
  const header = CSV_COLUMNS.join(',');
  const rows = scoredProducts.map(p => {
    const qs = p.quality_score;
    const vals = CSV_COLUMNS.map(col => {
      switch (col) {
        case 'quality_score_total': return qs.total;
        case 'score_completeness': return qs.breakdown.completeness;
        case 'score_description': return qs.breakdown.description_quality;
        case 'score_taxonomy': return qs.breakdown.taxonomy_accuracy;
        case 'score_consistency': return qs.breakdown.data_consistency;
        case 'score_enrichment': return qs.breakdown.enrichment_depth;
        case 'scope': return qs.scope;
        case 'missing_fields': return qs.missing.join('; ');
        case 'issues': return qs.issues.join('; ');
        case 'desc_en_short': return p.desc_en_short ?? p.short_description_en ?? '';
        case 'desc_en_full': return p.desc_en_full ?? p.description_en_text ?? '';
        case 'flavor_tags':
          return Array.isArray(p.flavor_tags) ? p.flavor_tags.join('; ') : (p.flavor_tags ?? '');
        case 'food_matching':
          return Array.isArray(p.food_matching) ? p.food_matching.join('; ') : (p.food_matching ?? '');
        default: return p[col] ?? '';
      }
    });
    return vals.map(escCsv).join(',');
  });

  return [header, ...rows].join('\n');
}
