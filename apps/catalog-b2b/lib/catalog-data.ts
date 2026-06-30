import fs from 'fs';
import path from 'path';
import type { B2BProduct } from './types';

/**
 * B2B_PUBLIC_FIELDS — the allowlist. ONLY these keys are ever copied onto a
 * client-bound B2B product. This is the single margin-leak chokepoint.
 *
 * NEVER add: price, special_price, sp_discount_pct, b2b_discount_pct,
 *            margin_pct, b2b_margin_pct, b2b_margin_thb, cost, popularity_score.
 */
export const B2B_PUBLIC_FIELDS = [
  'sku', 'name', 'brand', 'classification', 'designation', 'variety', 'blend_type',
  'vintage', 'country', 'region', 'subregion', 'appellation', 'body', 'acidity',
  'tannin', 'sweetness', 'intensity', 'smokiness', 'finish',
  'food_matching', 'food_matching_detail', 'flavor_tags', 'flavor_tags_canonical',
  'bottle_size', 'currency', 'image_url',
  'score_summary', 'score_max',
  'is_in_stock', 'custom_stock_status', 'wn_stock', 'quantity_in_stock',
  'category_group', 'category_type',
  'popularity_tier',
  'b2b_price',
] as const;

// Drift guard: every B2B_PUBLIC_FIELDS key must be a known B2BProduct key.
// If you add to B2B_PUBLIC_FIELDS without adding it to B2BProduct, this won't
// compile — keeping the runtime allowlist and the B2B type honest.
type _AssertB2BFieldsKnown =
  (typeof B2B_PUBLIC_FIELDS)[number] extends keyof B2BProduct ? true : never;
const _b2bFieldsCheck: _AssertB2BFieldsKnown = true;
void _b2bFieldsCheck;

function isInStock(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === '1' || raw === 1) return true;
  if (raw === '0' || raw === 0) return false;
  return Boolean(raw);
}

function popularityCutoffP75(rows: Record<string, unknown>[]): number {
  const scores = rows
    .map((r) => r.popularity_score as number)
    .filter((s) => typeof s === 'number' && s > 0)
    .sort((a, b) => a - b);
  if (!scores.length) return 0;
  return scores[Math.floor(scores.length * 0.75)] ?? 0;
}

function popularityTierBucket(score: unknown, cutoff: number): 0 | 1 | 2 {
  if (typeof score !== 'number' || score <= 0) return 0;
  return score >= cutoff ? 2 : 1;
}

/**
 * Project a raw B2B product record down to its public, allowlisted shape.
 * Copies ONLY keys present in B2B_PUBLIC_FIELDS and only when defined, so
 * internal fields (retail prices, margins, enrichment metadata) are
 * structurally impossible to leak — even if the raw record carries them.
 */
export function toPublicProductB2B(
  raw: Record<string, unknown>,
  tierBucket: 0 | 1 | 2 = 0,
): B2BProduct {
  const out: Record<string, unknown> = {};
  for (const f of B2B_PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  if ('is_in_stock' in out) out.is_in_stock = isInStock(out.is_in_stock);
  out.popularity_tier = tierBucket;
  return out as unknown as B2BProduct;
}

/**
 * Resolve the absolute path to the B2B product export. cwd differs between
 * local dev (apps/catalog-b2b) and the Vercel build, so probe several known
 * locations plus an explicit env override.
 */
export function exportPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'b2b_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'b2b_products_export.json'),
    process.env.B2B_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('b2b_products_export.json not found in any known location');
  return found;
}

let _all: B2BProduct[] | null = null;
let _bySku: Map<string, B2BProduct> | null = null;

function load(): void {
  const file = exportPath();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse B2B export at ${file}: ${(e as Error).message}`);
  }
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : ((raw as { products?: unknown[] })?.products ?? []);
  const typedRows = rows as Record<string, unknown>[];
  const cutoff = popularityCutoffP75(typedRows);
  const all: B2BProduct[] = [];
  const bySku = new Map<string, B2BProduct>();
  for (const row of typedRows) {
    const tier = popularityTierBucket(row.popularity_score, cutoff);
    const p = toPublicProductB2B(row, tier);
    all.push(p);
    if (p.sku) bySku.set(p.sku, p);
  }
  _all = all;
  _bySku = bySku;
}

/** All B2B products, public-projected. Lazy-loaded and cached for process lifetime. */
export function getAllProducts(): B2BProduct[] {
  if (_all === null) load();
  return _all!;
}

/**
 * O(1) SKU lookup. Returns null (not undefined) for unknown SKUs so that
 * detail pages can call notFound() on a falsy check without type-narrowing
 * issues. Non-B2B SKUs simply aren't in the B2B export → null → 404.
 */
export function getProductBySku(sku: string): B2BProduct | null {
  if (_bySku === null) load();
  return _bySku!.get(sku) ?? null;
}

// ---------------------------------------------------------------------------
// Back-compat aliases so the Phase-0 page.tsx import continues to compile
// while Phase 2+ pages can use the shorter names above.
// ---------------------------------------------------------------------------
export const getAllProductsB2B = getAllProducts;
export const getProductBySkuB2B = getProductBySku;
