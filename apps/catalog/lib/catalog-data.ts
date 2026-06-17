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

/**
 * Project a raw product record down to its public, allowlisted shape.
 * Copies ONLY keys present in PUBLIC_FIELDS and only when defined, so internal
 * fields (margins, enrichment confidence, etc.) are structurally impossible to
 * leak — even if the raw record carries them.
 */
export function toPublicProduct(raw: Record<string, unknown>): PublicProduct {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  return out as unknown as PublicProduct;
}
