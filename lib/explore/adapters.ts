// lib/explore/adapters.ts
/**
 * toExploreProduct — safely cast a raw product Record (as used in ProductsPage)
 * to ExploreProduct so it can be passed to ProductDetailPanel.
 *
 * Rules:
 * - String fields: String() coercion, undefined when falsy.
 * - Numeric fields: Number() + isFinite() guard; undefined when non-finite.
 * - JSON fields (flavor_tags, taste_profile): pass through as-is (already
 *   decoded by the API or by ProductsPage's fetch).
 * - No field is invented — only maps what is present in the raw object.
 */
import type { ExploreProduct } from "./types";

function str(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return String(v);
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function toExploreProduct(raw: Record<string, unknown>): ExploreProduct {
  return {
    // Required fields — fall back to empty string to satisfy the type
    id:             String(raw.id ?? ""),
    sku:            String(raw.sku ?? ""),
    name:           String(raw.name ?? ""),
    brand:          String(raw.brand ?? ""),
    classification: String(raw.classification ?? ""),
    country:        String(raw.country ?? ""),
    region:         String(raw.region ?? ""),
    price:          num(raw.price) ?? 0,
    currency:       String(raw.currency ?? "THB"),

    // Optional string fields
    grape_variety:         str(raw.grape_variety),
    vintage:               str(raw.vintage),
    wine_color:            str(raw.wine_color),
    image_url:             str(raw.image_url),
    subregion:             str(raw.subregion),
    appellation:           str(raw.appellation),
    desc_en_short:         str(raw.desc_en_short),
    wine_body:             str(raw.wine_body),
    wine_acidity:          str(raw.wine_acidity),
    wine_tannin:           str(raw.wine_tannin),
    food_matching:         raw.food_matching as string | undefined,
    pairing_rationale:     raw.pairing_rationale as string | null | undefined,
    grape_blend_type:      str(raw.grape_blend_type),
    wine_production_style: str(raw.wine_production_style),
    score_summary:         str(raw.score_summary),
    full_description:      str(raw.full_description),
    wine_classification:   str(raw.wine_classification),
    validation_status:     str(raw.validation_status),
    desc_en_full:          str(raw.desc_en_full),
    description_en_html:   str(raw.description_en_html),
    short_description_th_wn:  str(raw.short_description_th_wn),
    description_th_wn_text:   str(raw.description_th_wn_text),
    description_th_wn_html:   str(raw.description_th_wn_html),
    priority_band:         str(raw.priority_band),
    bi_priority_band:      str(raw.bi_priority_band),
    product_tier_definition: str(raw.product_tier_definition),
    enrichment_note:       str(raw.enrichment_note),
    sku_base:              str(raw.sku_base),

    // Mixed string|number fields — pass through
    bottle_size:          raw.bottle_size as string | number | undefined,
    alcohol:              raw.alcohol as string | number | undefined,
    product_tier:         raw.product_tier as string | number | undefined,
    enrichment_priority:  raw.enrichment_priority as string | number | undefined,
    queue_priority:       raw.queue_priority as number | string | undefined,

    // Numeric fields — guarded
    overall_confidence:   num(raw.overall_confidence),
    score_max:            num(raw.score_max),
    cost_price:           num(raw.cost_price),

    // Boolean
    is_primary_variant: raw.is_primary_variant === true,

    // JSON/unknown pass-through
    flavor_tags:    raw.flavor_tags as string | string[] | undefined,
    taste_profile:  raw.taste_profile,
  };
}
