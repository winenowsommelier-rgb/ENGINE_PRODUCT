import type { SupplierMatchProposal, SupplierNormalizedPayload } from './types';

function norm(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(norm(a).split(' ').filter(Boolean));
  const right = new Set(norm(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

export function buildMatchProposal(
  row: SupplierNormalizedPayload,
  products: Array<Record<string, any>>,
): SupplierMatchProposal {
  const candidates = products.map(product => {
    let score = 0;
    const reasons: string[] = [];

    if (row.sku && norm(row.sku) === norm(product.sku)) {
      score += 100;
      reasons.push('Exact SKU match');
    }

    const nameScore = tokenOverlap(row.name, product.name);
    if (nameScore > 0) {
      score += Math.round(nameScore * 35);
      reasons.push('Product name similarity');
    }

    if (row.brand && norm(row.brand) === norm(product.brand)) {
      score += 20;
      reasons.push('Brand match');
    }

    if (row.bottle_size && norm(row.bottle_size) === norm(product.bottle_size)) {
      score += 10;
      reasons.push('Bottle size match');
    }

    if (row.vintage && norm(row.vintage) === norm(product.vintage)) {
      score += 10;
      reasons.push('Vintage match');
    }

    return {
      product_id: String(product.id ?? ''),
      sku: String(product.sku ?? ''),
      name: String(product.name ?? ''),
      score,
      reasons,
    };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

  const best = candidates[0];
  if (!best) return { status: 'no_match', confidence: 0, candidates: [], reasons: ['No product candidate found'] };
  if (best.score >= 100) return { status: 'strong_match', selected_product_id: best.product_id, selected_sku: best.sku, confidence: best.score, candidates, reasons: best.reasons };
  if (best.score >= 55) return { status: 'likely_match', selected_product_id: best.product_id, selected_sku: best.sku, confidence: best.score, candidates, reasons: best.reasons };
  return { status: 'conflict', confidence: best.score, candidates, reasons: ['Low-confidence candidate requires review'] };
}
