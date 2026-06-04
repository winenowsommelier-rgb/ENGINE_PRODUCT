import * as fuzz from 'fuzzball';
import type { SupplierMatchCandidate, SupplierMatchProposal, SupplierNormalizedPayload } from './types';

// ── String normalization ──────────────────────────────────────────────────────

const STRIP_WORDS = new Set([
  'the','de','du','des','le','la','les','di','del','della','van','von','and','&',
  'winery','vineyard','vineyards','estate','estates','cellar','cellars','chateau',
  'château','domaine','bodega','bodegas','weingut','tenuta','cantina','aoc','doc',
  'docg','igt','vdp','qba','qmp','nv','ltd','co','inc','sa','srl','spa',
]);

/** Canonical form for comparison: lowercase, strip accents, remove punctuation and stop-words */
export function normText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STRIP_WORDS.has(t))
    .join(' ')
    .trim();
}

/** Brand-specific normalization — keeps brand tokens only, drops generic suffixes */
export function normBrand(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STRIP_WORDS.has(t))
    .join(' ')
    .trim();
}

// ── Volume normalization → ml ─────────────────────────────────────────────────

function toMl(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).toLowerCase().trim();
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  if (s.includes('cl')) return Math.round(n * 10);
  if (s.includes('ml')) return Math.round(n);
  if (s.includes(' l') || s.endsWith('l')) return Math.round(n * 1000);
  // bare number: < 5 = litres, 5–20 = cl ambiguous (treat as cl), > 20 = ml
  if (n < 5) return Math.round(n * 1000);
  if (n <= 20) return Math.round(n * 10);
  return Math.round(n);
}

function sizeMatch(a: unknown, b: unknown): boolean {
  const ma = toMl(a);
  const mb = toMl(b);
  if (ma == null || mb == null) return false;
  return Math.abs(ma - mb) <= 5; // allow ±5ml rounding
}

// ── Vintage normalization ─────────────────────────────────────────────────────

const CURRENT_VINTAGE_TOKENS = new Set(['current vintage', 'current', 'nv', 'n/v', 'non vintage', 'non-vintage', '']);

function normalizeVintage(value: unknown): string {
  const s = String(value ?? '').toLowerCase().trim();
  if (CURRENT_VINTAGE_TOKENS.has(s)) return 'nv';
  // range "2021/22" → "2021"
  const m = s.match(/^((?:19|20)\d{2})/);
  return m ? m[1] : 'nv';
}

/**
 * Vintage comparison result:
 * - 'exact'    : same year or both NV
 * - 'rolling'  : DB says current/NV or supplier says NV — accept any year
 * - 'different': specific years that differ
 */
function compareVintage(supplierVintage: unknown, productVintage: unknown): 'exact' | 'rolling' | 'different' {
  const sv = normalizeVintage(supplierVintage);
  const pv = normalizeVintage(productVintage);
  if (sv === 'nv' || pv === 'nv') return 'rolling';
  if (sv === pv) return 'exact';
  return 'different';
}

// ── Name similarity (token_set_ratio handles word order differences) ──────────

function nameSimilarity(a: string, b: string): number {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  return fuzz.token_set_ratio(na, nb);
}

// ── Quality guards ────────────────────────────────────────────────────────────

function qualityIssues(row: SupplierNormalizedPayload, currentYear: number): string[] {
  const issues: string[] = [];
  const vintage = normalizeVintage(row.vintage);
  if (vintage !== 'nv') {
    const yr = parseInt(vintage);
    if (yr > currentYear) issues.push(`future_vintage_${yr}`);
    if (yr < currentYear - 30 && row.category?.toLowerCase().includes('wine')) {
      issues.push(`suspicious_age_${yr}`);
    }
  }
  if (row.cost != null && row.cost > 0 && row.cost < 50) issues.push('cost_suspiciously_low');
  if (row.cost != null && row.rsp != null && row.rsp > 0 && row.cost > row.rsp * 2) {
    issues.push('cost_exceeds_rsp');
  }
  return issues;
}

// ── Mapping memory ────────────────────────────────────────────────────────────

export interface MappingMemoryEntry {
  supplier_code: string;
  supplier_item_code: string;
  current_sku: string;
  approval_status: string;
  vintage_locked: boolean;
  brand?: string;
  bottle_size?: string;
  vintage?: string;
}

/** Build lookup key for mapping memory: supplier_code|supplier_item_code */
function memKey(supplierCode: string, itemCode: string): string {
  return `${supplierCode.toUpperCase()}|${(itemCode || '').trim()}`;
}

// ── Brand index ───────────────────────────────────────────────────────────────

export type BrandIndex = Map<string, Array<Record<string, any>>>;

export function buildBrandIndex(products: Array<Record<string, any>>): BrandIndex {
  const index: BrandIndex = new Map();
  for (const p of products) {
    const key = normBrand(p.brand || p.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(p);
  }
  return index;
}

// ── Main matcher ──────────────────────────────────────────────────────────────

export function buildMatchProposal(
  row: SupplierNormalizedPayload,
  products: Array<Record<string, any>>,
  opts?: {
    supplierCode?: string;
    memory?: MappingMemoryEntry[];
    brandIndex?: BrandIndex;
    currentYear?: number;
  },
): SupplierMatchProposal {
  const supplierCode = opts?.supplierCode ?? '';
  const memory = opts?.memory ?? [];
  const brandIndex = opts?.brandIndex ?? buildBrandIndex(products);
  const year = opts?.currentYear ?? new Date().getFullYear();

  // Pre-check quality issues (don't block matching, but add to reasons)
  const qIssues = qualityIssues(row, year);

  // ── L1: Mapping memory lookup ─────────────────────────────────────────────
  if (supplierCode && row.supplier_item_code) {
    const key = memKey(supplierCode, row.supplier_item_code);
    const entry = memory.find(m => memKey(m.supplier_code, m.supplier_item_code) === key);
    if (entry && entry.current_sku) {
      const product = products.find(p => String(p.sku) === entry.current_sku);
      const vintageResult = compareVintage(row.vintage, entry.vintage ?? product?.vintage);
      const reasons = ['Matched from supplier mapping memory'];
      if (entry.approval_status === 'seeded_from_masterfile') reasons.push('seeded — verify on first run');
      if (vintageResult === 'different') reasons.push(`vintage mismatch: supplier=${normalizeVintage(row.vintage)} memory=${normalizeVintage(entry.vintage)}`);
      if (qIssues.length) reasons.push(...qIssues);

      // Vintage-locked entries: exact vintage required for strong_match
      const isStrong = vintageResult !== 'different' || !entry.vintage_locked;
      return {
        status: isStrong ? 'strong_match' : 'likely_match',
        selected_product_id: product?.id ? String(product.id) : undefined,
        selected_sku: entry.current_sku,
        confidence: isStrong ? 100 : 75,
        candidates: product ? [{
          product_id: String(product.id ?? ''),
          sku: entry.current_sku,
          name: String(product.name ?? ''),
          score: isStrong ? 100 : 75,
          reasons,
        }] : [],
        reasons,
      };
    }
  }

  // ── L2: Barcode exact match ───────────────────────────────────────────────
  if (row.barcode) {
    const barcodeMatch = products.find(p =>
      p.barcode && String(p.barcode).replace(/\D/g, '') === String(row.barcode).replace(/\D/g, '')
    );
    if (barcodeMatch) {
      return _proposal('strong_match', barcodeMatch, 100, ['Exact barcode match'], products, qIssues);
    }
  }

  // ── L3/L4/L5: Fuzzy matching ──────────────────────────────────────────────
  const candidates: Array<{ product: Record<string, any>; score: number; reasons: string[]; layer: string }> = [];

  // Determine candidate pool: prefer brand-filtered for L3, all products for L4/L5
  const normSupplierBrand = normBrand(row.brand);
  const brandPool = normSupplierBrand ? brandIndex.get(normSupplierBrand) : undefined;

  // L3: Brand match → token_set_ratio on name
  if (brandPool && brandPool.length > 0) {
    for (const product of brandPool) {
      const nameSim = nameSimilarity(row.name, product.name);
      if (nameSim < 50) continue;

      const reasons: string[] = [`Brand match (${normSupplierBrand})`, `Name similarity ${nameSim}%`];
      let score = Math.round(nameSim * 0.7 + 30); // brand anchor adds 30 baseline

      // Vintage bonus/penalty
      const vResult = compareVintage(row.vintage, product.vintage);
      if (vResult === 'exact') { score += 10; reasons.push('Vintage exact match'); }
      else if (vResult === 'different') { score -= 15; reasons.push(`Vintage differs: ${normalizeVintage(row.vintage)} vs ${normalizeVintage(product.vintage)}`); }

      // Size bonus
      if (sizeMatch(row.bottle_size, product.bottle_size)) { score += 5; reasons.push('Bottle size matches'); }

      candidates.push({ product, score: Math.min(score, 99), reasons, layer: 'L3_brand_name' });
    }
  }

  // L4: Full name fuzzy (all products, no brand anchor) — only if L3 found nothing good
  const bestL3 = candidates.length ? Math.max(...candidates.map(c => c.score)) : 0;
  if (bestL3 < 80) {
    // Use token_set_ratio on normText — handles word order, plurals
    const normRowName = normText(row.name);
    for (const product of products) {
      const normProdName = normText(product.name);
      const sim = fuzz.token_set_ratio(normRowName, normProdName);
      if (sim < 70) continue; // high threshold — no brand anchor

      const reasons: string[] = [`Name-only match ${sim}%`];
      let score = Math.round(sim * 0.65); // no brand anchor penalty

      const vResult = compareVintage(row.vintage, product.vintage);
      if (vResult === 'exact') { score += 8; reasons.push('Vintage matches'); }
      else if (vResult === 'different') { score -= 20; reasons.push('Vintage differs'); }
      if (sizeMatch(row.bottle_size, product.bottle_size)) { score += 5; reasons.push('Size matches'); }

      // Don't duplicate L3 hits
      if (!candidates.find(c => c.product.sku === product.sku)) {
        candidates.push({ product, score: Math.min(score, 75), reasons, layer: 'L4_name_only' });
      }
    }
  }

  // L5: Partial ratio — catches "BAROLO DOCG" matching "Batasiolo Barolo DOCG"
  const bestSoFar = candidates.length ? Math.max(...candidates.map(c => c.score)) : 0;
  if (bestSoFar < 55 && brandPool && brandPool.length > 0) {
    const normRowName = normText(row.name);
    for (const product of brandPool) {
      const normProdName = normText(product.name);
      const sim = fuzz.partial_ratio(normRowName, normProdName);
      if (sim < 85) continue; // partial needs very high raw score

      const scaledScore = Math.round(sim * 0.55); // heavily discounted
      const reasons = [`Partial name match ${sim}% → scaled ${scaledScore}%`, 'Requires human review'];
      if (!candidates.find(c => c.product.sku === product.sku)) {
        candidates.push({ product, score: scaledScore, reasons, layer: 'L5_partial' });
      }
    }
  }

  if (!candidates.length) {
    return {
      status: 'no_match',
      confidence: 0,
      candidates: [],
      reasons: ['No candidate found at any matching layer', ...qIssues],
    };
  }

  // Sort and take top 5
  candidates.sort((a, b) => b.score - a.score);
  const top5 = candidates.slice(0, 5);
  const best = top5[0];

  const allReasons = [...best.reasons, ...qIssues];

  const matchCandidates: SupplierMatchCandidate[] = top5.map(c => ({
    product_id: String(c.product.id ?? ''),
    sku: String(c.product.sku ?? ''),
    name: String(c.product.name ?? ''),
    score: c.score,
    reasons: c.reasons,
  }));

  if (best.score >= 90) {
    return { status: 'strong_match', selected_product_id: String(best.product.id ?? ''), selected_sku: String(best.product.sku), confidence: best.score, candidates: matchCandidates, reasons: allReasons };
  }
  if (best.score >= 55) {
    return { status: 'likely_match', selected_product_id: String(best.product.id ?? ''), selected_sku: String(best.product.sku), confidence: best.score, candidates: matchCandidates, reasons: allReasons };
  }
  return {
    status: 'no_match',
    confidence: best.score,
    candidates: matchCandidates,
    reasons: [`Best score only ${best.score}% — below threshold`, ...qIssues],
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function _proposal(
  status: SupplierMatchProposal['status'],
  product: Record<string, any>,
  score: number,
  reasons: string[],
  _products: Array<Record<string, any>>,
  extraReasons: string[] = [],
): SupplierMatchProposal {
  const candidate: SupplierMatchCandidate = {
    product_id: String(product.id ?? ''),
    sku: String(product.sku ?? ''),
    name: String(product.name ?? ''),
    score,
    reasons,
  };
  return {
    status,
    selected_product_id: candidate.product_id,
    selected_sku: candidate.sku,
    confidence: score,
    candidates: [candidate],
    reasons: [...reasons, ...extraReasons],
  };
}
