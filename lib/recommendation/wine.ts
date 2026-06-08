import fs from 'fs';
import path from 'path';

export type WineRelationshipType = 'direct_substitute' | 'similar_style' | 'trade_up' | 'value_alternative' | 'premium_gift';

export type ProductRow = Record<string, unknown>;

export type WineRecommendation = {
  relationship_type: WineRelationshipType;
  relationship_label: string;
  intent: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  target: ProductSummary;
  reasons: string[];
  risks: string[];
  fit_summary: string;
  matrix: {
    category: number;
    grape_family: number;
    origin: number;
    structure: number;
    flavor: number;
    price: number;
    quality: number;
    presentation?: number;
  };
  scorecard: Array<{
    dimension: string;
    score: number;
    weight: number;
    contribution: number;
    note: string;
  }>;
};

export type ProductSummary = {
  id?: string;
  sku: string;
  name: string;
  brand?: string;
  classification?: string;
  country?: string;
  region?: string;
  subregion?: string;
  grape_variety?: string;
  vintage?: string;
  price?: number;
  currency?: string;
  image_url?: string;
  desc_en_short?: string;
  flavor_tags?: string[];
  wine_body?: string;
  wine_acidity?: string;
  wine_tannin?: string;
  wine_sweetness?: string;
  validation_status?: string;
  overall_confidence?: number;
  is_in_stock?: boolean;
  quantity_in_stock?: number;
};

type RelationshipRule = {
  label: string;
  intent: string;
  minimum_score: number;
  price_window_pct?: number;
  price_min_multiplier?: number;
  price_max_multiplier?: number;
  price_min?: number;
  constraints?: Record<string, number>;
  weights: Record<string, number>;
};

type WineRules = {
  relationship_types: Record<WineRelationshipType, RelationshipRule>;
  grape_families: Record<string, string[]>;
  structure_scale: Record<string, number>;
  origin_hierarchy: Record<string, number>;
  classic_cross_region_affinities: Array<{
    affinity_id: string;
    family: string;
    regions: string[];
    score: number;
    rationale: string;
  }>;
  quality_signals: {
    validated_bonus: number;
    image_bonus: number;
    description_bonus: number;
    confidence_weight: number;
  };
  presentation_signals: {
    recognized_region_bonus: number;
    validated_bonus: number;
    premium_price_bonus: number;
  };
};

const RULES_PATH = path.join(process.cwd(), 'data', 'lib', 'recommendation', 'wine_recommendation_rules.json');

let rulesCache: WineRules | null = null;

function rules(): WineRules {
  if (!rulesCache) {
    rulesCache = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')) as WineRules;
  }
  return rulesCache;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function boolStock(row: ProductRow): boolean {
  return String(row.is_in_stock ?? '') === '1' || Number(row.quantity_in_stock ?? 0) > 0;
}

function tags(row: ProductRow): string[] {
  const raw = row.flavor_tags;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (_error) {
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function isWine(row: ProductRow): boolean {
  const sku = str(row.sku).toUpperCase();
  const cls = str(row.classification).toLowerCase();
  return sku.startsWith('W') || /wine|champagne|sparkling|prosecco|cava|ros[eé]/.test(cls);
}

function summary(row: ProductRow): ProductSummary {
  return {
    id: str(row.id) || undefined,
    sku: str(row.sku),
    name: str(row.name),
    brand: str(row.brand) || undefined,
    classification: str(row.classification) || undefined,
    country: str(row.country) || undefined,
    region: str(row.region) || undefined,
    subregion: str(row.subregion) || undefined,
    grape_variety: str(row.grape_variety) || undefined,
    vintage: str(row.vintage) || undefined,
    price: num(row.price) || undefined,
    currency: str(row.currency) || 'THB',
    image_url: str(row.image_url) || undefined,
    desc_en_short: str(row.desc_en_short) || undefined,
    flavor_tags: tags(row),
    wine_body: str(row.wine_body) || undefined,
    wine_acidity: str(row.wine_acidity) || undefined,
    wine_tannin: str(row.wine_tannin) || undefined,
    wine_sweetness: str(row.wine_sweetness) || undefined,
    validation_status: str(row.validation_status) || undefined,
    overall_confidence: num(row.overall_confidence) || undefined,
    is_in_stock: boolStock(row),
    quantity_in_stock: num(row.quantity_in_stock),
  };
}

function grapeFamily(row: ProductRow, matrix = rules()): string {
  const grape = `${str(row.grape_variety)} ${str(row.name)} ${str(row.classification)}`.toLowerCase();
  for (const [family, needles] of Object.entries(matrix.grape_families)) {
    if (needles.some(needle => grape.includes(needle.toLowerCase()))) return family;
  }
  return '';
}

function categoryScore(anchor: ProductRow, candidate: ProductRow): number {
  const a = str(anchor.classification).toLowerCase();
  const b = str(candidate.classification).toLowerCase();
  if (!a || !b) return 0.3;
  if (a === b) return 1;
  if ((a.includes('champagne') && b.includes('sparkling')) || (a.includes('sparkling') && b.includes('champagne'))) return 0.8;
  if (a.includes('wine') && b.includes('wine')) return 0.55;
  return 0;
}

function grapeScore(anchor: ProductRow, candidate: ProductRow): number {
  const af = grapeFamily(anchor);
  const bf = grapeFamily(candidate);
  const ag = str(anchor.grape_variety).toLowerCase();
  const bg = str(candidate.grape_variety).toLowerCase();
  if (ag && bg && (ag.includes(bg) || bg.includes(ag))) return 1;
  if (af && bf && af === bf) return 0.82;
  if (!af || !bf) return 0.35;
  return 0.1;
}

function originScore(anchor: ProductRow, candidate: ProductRow): number {
  const matrix = rules().origin_hierarchy;
  if (str(anchor.subregion) && str(anchor.subregion).toLowerCase() === str(candidate.subregion).toLowerCase()) return matrix.same_subregion;
  if (str(anchor.region) && str(anchor.region).toLowerCase() === str(candidate.region).toLowerCase()) return matrix.same_region;
  if (str(anchor.country) && str(anchor.country).toLowerCase() === str(candidate.country).toLowerCase()) return matrix.same_country;
  const family = grapeFamily(anchor);
  if (family && family === grapeFamily(candidate)) {
    const aRegion = str(anchor.region).toLowerCase();
    const cRegion = str(candidate.region).toLowerCase();
    const affinity = rules().classic_cross_region_affinities.find(item =>
      item.family === family &&
      item.regions.some(region => region.toLowerCase() === aRegion) &&
      item.regions.some(region => region.toLowerCase() === cRegion)
    );
    if (affinity) return affinity.score;
  }
  return matrix.different_origin;
}

function axisScore(anchorValue: unknown, candidateValue: unknown): number {
  const scale = rules().structure_scale;
  const a = scale[str(anchorValue)];
  const b = scale[str(candidateValue)];
  if (!a || !b) return 0.35;
  const delta = Math.abs(a - b);
  if (delta === 0) return 1;
  if (delta === 1) return 0.72;
  if (delta === 2) return 0.38;
  return 0.08;
}

function structureScore(anchor: ProductRow, candidate: ProductRow): number {
  const axes = [
    axisScore(anchor.wine_body, candidate.wine_body),
    axisScore(anchor.wine_acidity, candidate.wine_acidity),
    axisScore(anchor.wine_tannin, candidate.wine_tannin),
    axisScore(anchor.wine_sweetness, candidate.wine_sweetness),
  ];
  return axes.reduce((sum, value) => sum + value, 0) / axes.length;
}

function flavorScore(anchor: ProductRow, candidate: ProductRow): number {
  const a = new Set(tags(anchor).map(t => t.toLowerCase()));
  const b = new Set(tags(candidate).map(t => t.toLowerCase()));
  if (!a.size || !b.size) return 0.3;
  let overlap = 0;
  for (const tag of a) {
    if (b.has(tag) || [...b].some(candidateTag => candidateTag.includes(tag) || tag.includes(candidateTag))) overlap += 1;
  }
  return Math.min(1, overlap / Math.max(3, Math.min(a.size, b.size)));
}

function priceFit(anchor: ProductRow, candidate: ProductRow, type: WineRelationshipType, rule: RelationshipRule): number {
  const a = num(anchor.price);
  const c = num(candidate.price);
  if (!a || !c) return 0.35;

  if (type === 'trade_up') {
    const min = rule.price_min_multiplier ?? 1.15;
    const max = rule.price_max_multiplier ?? 3.5;
    const ratio = c / a;
    if (ratio < min || ratio > max) return 0;
    return ratio <= 2.2 ? 1 : 0.72;
  }
  if (type === 'value_alternative') {
    const min = rule.price_min_multiplier ?? 0.35;
    const max = rule.price_max_multiplier ?? 0.95;
    const ratio = c / a;
    if (ratio < min || ratio > max) return 0;
    return ratio >= 0.65 ? 1 : 0.74;
  }
  if (type === 'premium_gift') {
    const min = rule.price_min ?? 2500;
    if (c < min) return 0;
    return c >= 5000 ? 1 : 0.72;
  }

  const window = (rule.price_window_pct ?? 40) / 100;
  const delta = Math.abs(c - a) / a;
  if (delta <= window / 2) return 1;
  if (delta <= window) return 0.7;
  return 0;
}

function qualityScore(row: ProductRow): number {
  const q = rules().quality_signals;
  let score = Math.min(1, Math.max(0, num(row.overall_confidence))) * q.confidence_weight;
  if (str(row.validation_status) === 'validated') score += q.validated_bonus;
  if (str(row.image_url)) score += q.image_bonus;
  if (str(row.desc_en_short)) score += q.description_bonus;
  return Math.min(1, score);
}

function presentationScore(row: ProductRow): number {
  const p = rules().presentation_signals;
  let score = 0;
  if (str(row.image_url)) score += 0.35;
  if (str(row.validation_status) === 'validated') score += p.validated_bonus;
  if (num(row.price) >= 2500) score += p.premium_price_bonus;
  if (str(row.region) || str(row.subregion)) score += p.recognized_region_bonus;
  if (str(row.brand)) score += 0.15;
  return Math.min(1, score);
}

function weightedScore(matrix: WineRecommendation['matrix'], rule: RelationshipRule): number {
  let total = 0;
  let max = 0;
  for (const [key, weight] of Object.entries(rule.weights)) {
    max += weight;
    total += ((matrix as unknown as Record<string, number>)[key] ?? 0) * weight;
  }
  return max > 0 ? Math.round((total / max) * 100) : 0;
}

function scorecard(matrix: WineRecommendation['matrix'], rule: RelationshipRule): WineRecommendation['scorecard'] {
  const totalWeight = Object.values(rule.weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(rule.weights).map(([dimension, weight]) => {
    const score = ((matrix as unknown as Record<string, number>)[dimension] ?? 0);
    return {
      dimension,
      score,
      weight,
      contribution: Math.round(score * weight / totalWeight * 100),
      note: dimensionNote(dimension, score),
    };
  }).sort((a, b) => b.contribution - a.contribution);
}

function dimensionNote(dimension: string, score: number): string {
  const band = score >= 0.85 ? 'strong' : score >= 0.55 ? 'usable' : score >= 0.3 ? 'weak' : 'poor';
  const labels: Record<string, string> = {
    category: 'category/style type',
    grape_family: 'grape or style family',
    origin: 'origin proximity',
    structure: 'body/acidity/tannin/sweetness',
    flavor: 'flavor overlap',
    price: 'price role fit',
    quality: 'data and content trust',
    presentation: 'gift/promotion presentation',
  };
  return `${band} ${labels[dimension] ?? dimension}`;
}

function passesConstraints(matrix: WineRecommendation['matrix'], rule: RelationshipRule): boolean {
  const constraints = rule.constraints ?? {};
  for (const [key, min] of Object.entries(constraints)) {
    const dimension = key.replace(/_min$/, '');
    const score = ((matrix as unknown as Record<string, number>)[dimension] ?? 0);
    if (score < min) return false;
  }
  return true;
}

function riskFlags(anchor: ProductRow, candidate: ProductRow, matrix: WineRecommendation['matrix'], type: WineRelationshipType): string[] {
  const risks: string[] = [];
  const anchorPrice = num(anchor.price);
  const candidatePrice = num(candidate.price);
  if (!boolStock(candidate)) risks.push('out_of_stock');
  if (num(candidate.overall_confidence) > 0 && num(candidate.overall_confidence) < 0.75) risks.push('low_confidence');
  if (!str(candidate.image_url)) risks.push('missing_image');
  if (!str(candidate.desc_en_short)) risks.push('missing_copy');
  if (matrix.structure < 0.55) risks.push('wide_structure_gap');
  if (matrix.origin < 0.35 && type === 'direct_substitute') risks.push('different_origin');
  if (anchorPrice && candidatePrice && Math.abs(candidatePrice - anchorPrice) / anchorPrice > 0.6 && ['direct_substitute', 'similar_style'].includes(type)) {
    risks.push('price_jump');
  }
  return risks;
}

function fitSummary(score: number, risks: string[]): string {
  if (score >= 85 && risks.length === 0) return 'Excellent professional fit';
  if (score >= 78 && risks.length <= 1) return 'Strong fit with minor review';
  if (score >= 68) return 'Usable fit; review context';
  return 'Low-confidence fit; use carefully';
}

function relationshipReasons(anchor: ProductRow, candidate: ProductRow, matrix: WineRecommendation['matrix'], type: WineRelationshipType): string[] {
  const reasons: string[] = [];
  if (matrix.category >= 0.95) reasons.push(`same category: ${str(candidate.classification)}`);
  if (matrix.grape_family >= 0.8) reasons.push(`same grape/style family: ${grapeFamily(candidate) || str(candidate.grape_variety)}`);
  if (matrix.origin >= 0.85) reasons.push(`same region: ${str(candidate.region)}`);
  else if (matrix.origin >= 0.5) reasons.push(`same country: ${str(candidate.country)}`);
  if (matrix.structure >= 0.75) reasons.push('similar structure across body, acidity, tannin and sweetness');
  if (matrix.flavor >= 0.55) reasons.push('overlapping flavor tags');
  if (matrix.price >= 0.9 && type === 'direct_substitute') reasons.push('close price replacement');
  if (type === 'trade_up') reasons.push(`trade-up from ${num(anchor.price).toLocaleString()} to ${num(candidate.price).toLocaleString()}`);
  if (type === 'value_alternative') reasons.push(`lower-priced alternative at ${num(candidate.price).toLocaleString()}`);
  if (type === 'premium_gift') reasons.push('gift/promotion signals: image, brand, region, premium price or validation');
  if (boolStock(candidate)) reasons.push('available or in-stock signal');
  return reasons.filter(Boolean).slice(0, 7);
}

function confidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 82) return 'high';
  if (score >= 68) return 'medium';
  return 'low';
}

function scoreOne(anchor: ProductRow, candidate: ProductRow, type: WineRelationshipType): WineRecommendation | null {
  const rule = rules().relationship_types[type];
  const price = priceFit(anchor, candidate, type, rule);
  if (price <= 0) return null;

  const matrix: WineRecommendation['matrix'] = {
    category: categoryScore(anchor, candidate),
    grape_family: grapeScore(anchor, candidate),
    origin: originScore(anchor, candidate),
    structure: structureScore(anchor, candidate),
    flavor: flavorScore(anchor, candidate),
    price,
    quality: qualityScore(candidate),
  };
  if (type === 'premium_gift') matrix.presentation = presentationScore(candidate);

  const score = weightedScore(matrix, rule);
  if (!passesConstraints(matrix, rule)) return null;
  if (score < rule.minimum_score) return null;
  const risks = riskFlags(anchor, candidate, matrix, type);

  return {
    relationship_type: type,
    relationship_label: rule.label,
    intent: rule.intent,
    score,
    confidence: confidence(score),
    target: summary(candidate),
    reasons: relationshipReasons(anchor, candidate, matrix, type),
    risks,
    fit_summary: fitSummary(score, risks),
    matrix,
    scorecard: scorecard(matrix, rule),
  };
}

export function recommendWineProducts(anchor: ProductRow, catalog: ProductRow[], limit = 6): Record<WineRelationshipType, WineRecommendation[]> {
  if (!isWine(anchor)) {
    return {
      direct_substitute: [],
      similar_style: [],
      trade_up: [],
      value_alternative: [],
      premium_gift: [],
    };
  }

  const anchorSku = str(anchor.sku).toUpperCase();
  const candidates = catalog.filter(row => isWine(row) && str(row.sku).toUpperCase() !== anchorSku && str(row.name));
  const types: WineRelationshipType[] = ['direct_substitute', 'similar_style', 'trade_up', 'value_alternative', 'premium_gift'];
  const out = {} as Record<WineRelationshipType, WineRecommendation[]>;

  for (const type of types) {
    out[type] = candidates
      .map(candidate => scoreOne(anchor, candidate, type))
      .filter((row): row is WineRecommendation => !!row)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  return out;
}

export function findAnchorProduct(catalog: ProductRow[], key: string): ProductRow | undefined {
  const normalized = key.trim().toLowerCase();
  return catalog.find(row =>
    str(row.sku).toLowerCase() === normalized ||
    str(row.id).toLowerCase() === normalized ||
    str(row.name).toLowerCase() === normalized
  );
}

export function wineRecommendationMethodology() {
  const r = rules();
  return {
    version: (r as unknown as { version?: string }).version,
    scope: 'wine',
    relationship_types: Object.fromEntries(
      Object.entries(r.relationship_types).map(([key, value]) => [
        key,
        {
          label: value.label,
          intent: value.intent,
          minimum_score: value.minimum_score,
          weights: value.weights,
        },
      ]),
    ),
    dimensions: [
      'category',
      'grape_family',
      'origin',
      'structure',
      'flavor',
      'price',
      'quality',
      'presentation',
    ],
  };
}
