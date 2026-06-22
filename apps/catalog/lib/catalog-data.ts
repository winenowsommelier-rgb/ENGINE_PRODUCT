import fs from 'fs';
import path from 'path';
import type { PublicProduct } from './types';
import { isInStock } from './utils';
import { compareRecommended, popularityCutoffP75, popularityTier } from './recommended-rank';

/**
 * PUBLIC_FIELDS — the allowlist. ONLY these keys are ever copied onto a
 * client-bound product. This is the single margin-leak chokepoint: if a key
 * is not in this list, it cannot reach the customer's browser.
 *
 * DO NOT add margin_pct, b2b_margin_pct, id, enrichment_*, or popularity_*.
 */
export const PUBLIC_FIELDS = [
  'sku','name','brand','classification','wine_classification','designation','variety','blend_type',
  'vintage','country','region','subregion','appellation','body','acidity',
  'tannin','sweetness','intensity','smokiness','finish','production_style',
  'food_matching','food_matching_detail','flavor_tags','flavor_tags_canonical','bottle_size','price','currency',
  'desc_en_short','full_description','taste_profile','color','image_url',
  'score_summary','score_max','is_in_stock',
  // SKU-derived canonical taxonomy (backfilled on every row). Safe to expose:
  // shopper-facing category labels, no margin/pricing/internal signal.
  'category_group','category_type',
  // Coarse client-SAFE popularity bucket (0/1/2). Derived server-side from the
  // FORBIDDEN popularity_score; the raw score itself is never copied. Set by the
  // popularityTierBucket argument below, NOT read from the raw row's popularity_* keys.
  'popularity_tier',
] as const;

// Drift guard: every PUBLIC_FIELDS key must be a known PublicProduct key.
// If you add to PUBLIC_FIELDS without adding it to PublicProduct, this won't compile —
// keeping the runtime allowlist and the public type honest about what leaves the server.
type _AssertFieldsAreKnown =
  (typeof PUBLIC_FIELDS)[number] extends keyof PublicProduct ? true : never;
const _fieldsCheck: _AssertFieldsAreKnown = true;
void _fieldsCheck;

/**
 * Project a raw product record down to its public, allowlisted shape.
 * Copies ONLY keys present in PUBLIC_FIELDS and only when defined, so internal
 * fields (margins, enrichment confidence, etc.) are structurally impossible to
 * leak — even if the raw record carries them.
 */
export function toPublicProduct(
  raw: Record<string, unknown>,
  popularityTierBucket: 0 | 1 | 2 = 0,
): PublicProduct {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  // DATA-INTEGRITY NORMALIZATION (CLAUDE.md Rule 3 — inherited data shapes are NOT validated
  // by the caller): the live export stores is_in_stock as a STRING "0"/"1" or null, NOT the
  // boolean the type advertises. Because "0" is truthy in JS, any plain-truthiness consumer
  // (the recommender did this) would treat 5,683 out-of-stock products as IN-STOCK. We normalize
  // it to a REAL boolean ONCE here, at the single load chokepoint, using the same isInStock()
  // helper the storefront uses, so the whole app sees an honest boolean. is_in_stock stays in
  // PUBLIC_FIELDS (it is allowlisted); we only coerce its value after the allowlist copy, so the
  // leak guarantee and drift guard are untouched. Coerce only when the field is present.
  if ('is_in_stock' in out) out.is_in_stock = isInStock(out.is_in_stock);
  // Attach the coarse tier. 'popularity_tier' is allowlisted, but the raw export does
  // NOT carry that key (it carries popularity_score, which is forbidden), so the loop
  // above never copies it — we set it explicitly here. The raw score is never written.
  out.popularity_tier = popularityTierBucket;
  // Cast: the output is built from the allowlist, so its keys are a subset of PublicProduct.
  // This does NOT guarantee required fields (sku/name/price) are present — presence/validation
  // is the loader's responsibility (Task 2). null values pass through intentionally (see test).
  return out as unknown as PublicProduct;
}

/**
 * Resolve the absolute path to the product export. cwd differs between local
 * dev (apps/catalog) and the Vercel build, so probe several known locations
 * plus an explicit env override. Throws loudly if none exist — a missing data
 * file at build time must fail the build, not silently produce an empty catalog.
 */
export function exportPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),             // cwd = repo root
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'), // cwd = apps/catalog
    process.env.CATALOG_DATA_PATH ?? '',                                       // explicit override
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('live_products_export.json not found in any known location');
  return found;
}

/**
 * Module-level singletons. The 26 MB export is read and projected ONCE on the
 * first getAllProducts() call (build-time SSG), then served from memory.
 *   - _all:   the public-projected array (margin/internal fields stripped).
 *   - _bySku: sku -> PublicProduct for O(1) lookup.
 */
let _all: PublicProduct[] | null = null;
let _bySku: Map<string, PublicProduct> | null = null;

function load(): void {
  const file = exportPath();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse catalog export at ${file}: ${(e as Error).message}`);
  }
  // Defensive shape handling: file is a bare array, but tolerate { products: [...] }.
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : ((raw as { products?: unknown[] })?.products ?? []);

  const typedRows = rows as Record<string, unknown>[];
  // PASS 1 — p75 cutoff over the scored population (raw popularity_score in scope).
  const cutoff = popularityCutoffP75(typedRows);
  // SORT raw rows by the Recommended comparator (raw score still in scope here).
  const sortedRows = [...typedRows].sort(compareRecommended);
  // PASS 2 — project each sorted raw row, deriving the client-safe tier.
  const all: PublicProduct[] = [];
  const bySku = new Map<string, PublicProduct>();
  for (const row of sortedRows) {
    // Project through the allowlist chokepoint so NO internal field can leak.
    const tier = popularityTier(row.popularity_score, cutoff);
    const p = toPublicProduct(row, tier);
    all.push(p);
    if (p.sku) bySku.set(p.sku, p);
  }
  _all = all;
  _bySku = bySku;
}

/** All products, public-projected. Lazy-loaded and cached for the process lifetime. */
export function getAllProducts(): PublicProduct[] {
  if (_all === null) load();
  return _all!;
}

/** O(1) sku lookup; returns undefined for unknown skus. */
export function getProductBySku(sku: string): PublicProduct | undefined {
  if (_bySku === null) load();
  return _bySku!.get(sku);
}
