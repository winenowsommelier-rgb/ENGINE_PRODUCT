import type { PublicProduct } from './types';

/**
 * PUBLIC_FIELDS — the allowlist. ONLY these keys are ever copied onto a
 * client-bound product. This is the single margin-leak chokepoint: if a key
 * is not in this list, it cannot reach the customer's browser.
 *
 * DO NOT add margin_pct, b2b_margin_pct, id, enrichment_*, or popularity_*.
 */
export const PUBLIC_FIELDS = [
  'sku','name','brand','classification','wine_classification','grape_variety',
  'vintage','country','region','subregion','appellation','wine_body','wine_acidity',
  'wine_tannin','food_matching','flavor_tags','bottle_size','price','currency',
  'desc_en_short','full_description','taste_profile','wine_color','image_url',
  'score_summary','score_max','is_in_stock',
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
export function toPublicProduct(raw: Record<string, unknown>): PublicProduct {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  // Cast: the output is built from the allowlist, so its keys are a subset of PublicProduct.
  // This does NOT guarantee required fields (sku/name/price) are present — presence/validation
  // is the loader's responsibility (Task 2). null values pass through intentionally (see test).
  return out as unknown as PublicProduct;
}
