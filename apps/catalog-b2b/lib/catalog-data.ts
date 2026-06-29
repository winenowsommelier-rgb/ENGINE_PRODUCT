/**
 * B2B catalog data loader.
 *
 * Mirrors the public app's @/lib/catalog-data interface so that any shared
 * utility that receives products as a parameter works without modification.
 *
 * Data source for Phase 0 spike: data/b2b_products_export_fixture.json
 * Phase 1 will swap this for data/b2b_products_export.json.
 *
 * NOTE: The @/* alias in tsconfig.json resolves to apps/catalog-b2b/*,
 * so this file shadows apps/catalog/lib/catalog-data.ts without touching it.
 * The public app is unaffected.
 */
import fs from 'fs';
import path from 'path';

export interface B2BProduct {
  sku: string;
  name: string;
  b2b_price: number | null;
  country: string | null;
  region: string | null;
  is_in_stock: boolean;
  score_summary: string | null;
  score_max: number | null;
  popularity_score: number | null;
  image_url: string | null;
}

/**
 * Resolve path to the B2B fixture (or real export in Phase 1).
 * Probes cwd-relative paths to handle both:
 *   - local dev:   cwd = apps/catalog-b2b  → ../../data/...
 *   - Vercel build: cwd = repo root         → data/...
 */
function exportPath(): string {
  const FIXTURE = 'b2b_products_export_fixture.json';
  const candidates = [
    path.join(process.cwd(), 'data', FIXTURE),
    path.join(process.cwd(), '..', '..', 'data', FIXTURE),
    process.env.B2B_CATALOG_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error(
      `${FIXTURE} not found in any known location. ` +
      `Searched: ${candidates.filter(Boolean).join(', ')}`
    );
  }
  return found;
}

function normalizeIsInStock(raw: unknown): boolean {
  if (raw === '1' || raw === 1 || raw === true) return true;
  return false;
}

let _all: B2BProduct[] | null = null;
let _bySku: Map<string, B2BProduct> | null = null;

function load(): void {
  const file = exportPath();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(
      `Failed to parse B2B catalog export at ${file}: ${(e as Error).message}`
    );
  }
  const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];

  const all: B2BProduct[] = [];
  const bySku = new Map<string, B2BProduct>();
  for (const row of rows) {
    const product: B2BProduct = {
      sku: String(row.sku ?? ''),
      name: String(row.name ?? ''),
      b2b_price: row.b2b_price != null ? Number(row.b2b_price) : null,
      country: row.country != null ? String(row.country) : null,
      region: row.region != null ? String(row.region) : null,
      is_in_stock: normalizeIsInStock(row.is_in_stock),
      score_summary: row.score_summary != null ? String(row.score_summary) : null,
      score_max: row.score_max != null ? Number(row.score_max) : null,
      popularity_score: row.popularity_score != null ? Number(row.popularity_score) : null,
      image_url: row.image_url != null ? String(row.image_url) : null,
    };
    if (product.sku) {
      all.push(product);
      bySku.set(product.sku, product);
    }
  }
  _all = all;
  _bySku = bySku;
}

/** All B2B products. Lazy-loaded and cached for the process lifetime. */
export function getAllProductsB2B(): B2BProduct[] {
  if (_all === null) load();
  return _all!;
}

/** O(1) SKU lookup; returns undefined for unknown SKUs. */
export function getProductBySkuB2B(sku: string): B2BProduct | undefined {
  if (_bySku === null) load();
  return _bySku!.get(sku);
}
