/**
 * Product field ownership policy.
 *
 * See PRODUCT_DATA_API.md "Field Ownership Matrix" for rationale.
 *
 * BI owns commercial data (price, cost, stock, sales).
 * PIM owns product intelligence (taxonomy, enrichment, descriptions, images).
 * Admin (default) can write to any field from the internal dashboard UI.
 *
 * External callers should identify themselves via the `X-Source` header or
 * `?source=` query param so the PATCH endpoint can filter out fields they
 * don't own.
 */

export type Source = 'admin' | 'bi' | 'enrichment' | 'system';

/** Fields owned by the BI / commerce system. */
export const BI_FIELDS = new Set<string>([
  'sku', 'name', 'brand', 'bottle_size', 'vintage', 'alcohol',
  'price', 'cost_price', 'cost', 'currency',
  'special_price', 'promotion_price', 'promotion_tier_price', 'b2b_price',
  'margin_thb', 'margin_pct', 'sp_discount_pct',
  'b2b_margin_thb', 'b2b_margin_pct', 'b2b_discount_pct',
  'price_group', 'manufacturer', 'supplier_code',
  'is_in_stock', 'custom_stock_status', 'wn_stock', 'consign',
  'sold_orders', 'sold_qty',
]);

/** Fields owned by the PIM enrichment pipeline. */
export const PIM_FIELDS = new Set<string>([
  // Geography / taxonomy
  'country', 'region', 'subregion', 'appellation',
  'classification', 'wine_classification',
  'grape_variety', 'grape_class', 'style',
  'liquor_main_type', 'other_type', 'wine_type',
  // Tasting profile
  'wine_body', 'wine_acidity', 'wine_tannin',
  'food_matching', 'flavor_tags', 'flavor_profile', 'character_traits',
  // Descriptions (all variants)
  'full_description', 'short_description_en',
  'description_en_text', 'description_en_html',
  'desc_en_short', 'desc_en_full',
  // Images
  'image_url', 'image_alt_text', 'image_local_path', 'image_scraped_url',
  // Validation / enrichment metadata
  'validation_status', 'overall_confidence',
  'taxonomy_confidence', 'description_confidence',
  'enrichment_source', 'enrichment_note', 'enrichment_priority',
  'queue_priority',
  // NOTE: 'research_validation' and 'research_confidence_level' are NOT
  // in the live Supabase products schema. Removed to prevent 400 errors.
  // If those columns are added later, re-add here.
]);

/** System fields that anyone can write. */
export const SYSTEM_FIELDS = new Set<string>([
  'updated_at', 'synced_at', 'notes',
]);

/**
 * Filter a fields object to only those allowed by the source.
 * Returns the filtered object + a list of dropped fields.
 */
export function filterByOwnership(
  fields: Record<string, unknown>,
  source: Source
): { allowed: Record<string, unknown>; dropped: string[] } {
  // Admin can write everything
  if (source === 'admin') {
    return { allowed: { ...fields }, dropped: [] };
  }

  const allowed: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (SYSTEM_FIELDS.has(key)) {
      allowed[key] = value;
      continue;
    }
    if (source === 'bi' && BI_FIELDS.has(key)) {
      allowed[key] = value;
    } else if (source === 'enrichment' && PIM_FIELDS.has(key)) {
      allowed[key] = value;
    } else if (source === 'system') {
      // Internal system jobs: allow all (e.g. Supabase triggers, our scripts)
      allowed[key] = value;
    } else {
      dropped.push(key);
    }
  }

  return { allowed, dropped };
}

/** Parse source from headers/query params. Defaults to `admin`. */
export function parseSource(req: Request, searchParams?: URLSearchParams): Source {
  const header = req.headers.get('x-source')?.toLowerCase();
  const query = searchParams?.get('source')?.toLowerCase();
  const raw = query || header || 'admin';
  if (raw === 'bi' || raw === 'enrichment' || raw === 'system') return raw;
  return 'admin';
}
