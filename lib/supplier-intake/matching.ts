import * as fuzz from 'fuzzball';
import type { SupplierMatchProposal, SupplierNormalizedPayload } from './types';

export interface MappingMemoryEntry {
  supplier_code: string;
  supplier_item_code: string;
  our_sku: string;
  product_name: string;
  approved_by: string;
  approved_at: string;
}

const STOPWORDS = new Set(['chateau', 'domaine', 'estate', 'winery', 'cellars', 'cellar', 'the', 'de', 'du', 'la', 'le', 'les', 'and', 'et']);

function normText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
    .join(' ')
    .trim();
}

function normBrand(value: unknown): string {
  return normText(value);
}

function toMl(value: unknown): number | null {
  const s = String(value ?? '').toLowerCase().replace(/\s+/g, '');
  const clMatch = s.match(/^(\d+(?:\.\d+)?)cl$/);
  if (clMatch) return Math.round(parseFloat(clMatch[1]) * 10);
  const lMatch = s.match(/^(\d+(?:\.\d+)?)l$/);
  if (lMatch) return Math.round(parseFloat(lMatch[1]) * 1000);
  const mlMatch = s.match(/^(\d+(?:\.\d+)?)ml$/);
  if (mlMatch) return Math.round(parseFloat(mlMatch[1]));
  return null;
}

function sizeMatch(a: unknown, b: unknown): boolean {
  const mlA = toMl(a);
  const mlB = toMl(b);
  if (mlA === null || mlB === null) return String(a ?? '') === String(b ?? '');
  return Math.abs(mlA - mlB) <= 5;
}

function compareVintage(supplierVintage: unknown, productVintage: unknown): 'exact' | 'rolling' | 'different' {
  const sv = String(supplierVintage ?? '').trim().toUpperCase();
  const pv = String(productVintage ?? '').trim().toUpperCase();
  if (!sv || !pv || sv === 'NV' || pv === 'NV') return 'rolling';
  const svYear = parseInt(sv, 10);
  const pvYear = parseInt(pv, 10);
  if (Number.isNaN(svYear) || Number.isNaN(pvYear)) return 'rolling';
  if (svYear === pvYear) return 'exact';
  // Rolling: within 1 year of current (supplier catalog may be slightly ahead)
  const diff = Math.abs(svYear - pvYear);
  if (diff <= 1) return 'rolling';
  return 'different';
}

export function buildBrandIndex(products: Array<Record<string, any>>): Map<string, Array<Record<string, any>>> {
  const index = new Map<string, Array<Record<string, any>>>();
  for (const p of products) {
    const key = normBrand(p.brand ?? p.name);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(p);
    index.set(key, bucket);
  }
  return index;
}

interface MatchOpts {
  supplierCode?: string;
  memory?: Map<string, MappingMemoryEntry>;
  brandIndex?: Map<string, Array<Record<string, any>>>;
  currentYear?: number;
}

export function buildMatchProposal(
  row: SupplierNormalizedPayload,
  products: Array<Record<string, any>>,
  opts: MatchOpts = {},
): SupplierMatchProposal {
  const { supplierCode, memory, brandIndex, currentYear = new Date().getFullYear() } = opts;

  // ── L1: mapping memory ────────────────────────────────────────────────────
  if (memory && supplierCode && row.supplier_item_code) {
    const memKey = `${supplierCode}|${row.supplier_item_code}`;
    const entry = memory.get(memKey);
    if (entry) {
      const product = products.find(p => p.sku === entry.our_sku);
      if (product) {
        return {
          status: 'strong_match',
          selected_product_id: String(product.id ?? ''),
          selected_sku: entry.our_sku,
          confidence: 100,
          candidates: [{ product_id: String(product.id ?? ''), sku: entry.our_sku, name: String(product.name ?? ''), score: 100, reasons: ['L1 mapping memory'] }],
          reasons: ['L1 mapping memory'],
        };
      }
    }
  }

  // ── L2: barcode exact ─────────────────────────────────────────────────────
  if (row.barcode) {
    const hit = products.find(p => String(p.barcode ?? p.ean ?? '').trim() === row.barcode);
    if (hit) {
      return {
        status: 'strong_match',
        selected_product_id: String(hit.id ?? ''),
        selected_sku: String(hit.sku ?? ''),
        confidence: 98,
        candidates: [{ product_id: String(hit.id ?? ''), sku: String(hit.sku ?? ''), name: String(hit.name ?? ''), score: 98, reasons: ['L2 barcode exact'] }],
        reasons: ['L2 barcode exact'],
      };
    }
  }

  // ── L3: brand pool + fuzz.token_set_ratio ─────────────────────────────────
  const normRowName = normText(row.name);
  const normRowBrand = normBrand(row.brand ?? '');

  let pool: Array<Record<string, any>> = [];
  if (brandIndex && normRowBrand) {
    pool = brandIndex.get(normRowBrand) ?? [];
    // If brand pool is empty, try partial brand match across index keys
    if (pool.length === 0) {
      for (const [key, bucket] of brandIndex) {
        if (fuzz.partial_ratio(normRowBrand, key) >= 80) {
          pool = pool.concat(bucket);
        }
      }
    }
  }

  if (pool.length > 0) {
    const scored = pool.map(p => {
      const normProdName = normText(p.name);
      const sim = fuzz.token_set_ratio(normRowName, normProdName) / 100;
      let score = Math.round(sim * 70 + 30);

      const vintage = compareVintage(row.vintage, p.vintage);
      if (vintage === 'exact') score += 10;
      else if (vintage === 'different') score = Math.min(score - 15, 70); // cap, never strong_match on wrong vintage

      if (row.bottle_size && p.bottle_size && !sizeMatch(row.bottle_size, p.bottle_size)) score -= 10;

      return { product_id: String(p.id ?? ''), sku: String(p.sku ?? ''), name: String(p.name ?? ''), score, reasons: [`L3 brand+fuzz sim=${Math.round(sim * 100)}`] };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score >= 55) {
      const status = best.score >= 90 ? 'strong_match' : 'likely_match';
      return {
        status,
        selected_product_id: best.product_id,
        selected_sku: best.sku,
        confidence: best.score,
        candidates: scored.slice(0, 5),
        reasons: best.reasons,
      };
    }
  }

  // ── L4: all-products fuzz.token_set_ratio (name-only, no brand anchor) ────
  const l4scored = products.map(p => {
    const normProdName = normText(p.name);
    const sim = fuzz.token_set_ratio(normRowName, normProdName) / 100;
    const score = Math.min(Math.round(sim * 65), 75);
    return { product_id: String(p.id ?? ''), sku: String(p.sku ?? ''), name: String(p.name ?? ''), score, reasons: [`L4 name-only sim=${Math.round(sim * 100)}`] };
  }).filter(c => c.score >= 45).sort((a, b) => b.score - a.score);

  if (l4scored.length > 0 && l4scored[0].score >= 45) {
    const best = l4scored[0];
    if (best.score >= 55) {
      return {
        status: 'likely_match',
        selected_product_id: best.product_id,
        selected_sku: best.sku,
        confidence: best.score,
        candidates: l4scored.slice(0, 5),
        reasons: best.reasons,
      };
    }
  }

  // ── L5: partial_ratio within brand pool ───────────────────────────────────
  if (pool.length > 0) {
    const l5scored = pool.map(p => {
      const normProdName = normText(p.name);
      const sim = fuzz.partial_ratio(normRowName, normProdName) / 100;
      const score = Math.round(sim * 55);
      return { product_id: String(p.id ?? ''), sku: String(p.sku ?? ''), name: String(p.name ?? ''), score, reasons: [`L5 partial sim=${Math.round(sim * 100)}`] };
    }).filter(c => c.score >= 47).sort((a, b) => b.score - a.score);

    if (l5scored.length > 0) {
      const best = l5scored[0];
      return {
        status: 'likely_match',
        selected_product_id: best.product_id,
        selected_sku: best.sku,
        confidence: best.score,
        candidates: l5scored.slice(0, 5),
        reasons: best.reasons,
      };
    }
  }

  return {
    status: 'no_match',
    confidence: 0,
    candidates: [],
    reasons: ['No match at any layer'],
  };
}
