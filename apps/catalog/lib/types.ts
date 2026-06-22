/**
 * PublicProduct — the ONLY product shape allowed to reach a customer's browser.
 *
 * SAFETY-CRITICAL: This interface is the public projection of a raw product
 * record. Every field listed here is safe to ship to the client. Internal
 * fields (margins, enrichment metadata, popularity signals, internal id) are
 * DELIBERATELY ABSENT — a margin leak is a production break.
 *
 * The actual leak-prevention chokepoint is `toPublicProduct` in catalog-data.ts,
 * which copies ONLY the keys in PUBLIC_FIELDS. This interface documents and
 * type-checks the resulting shape.
 *
 * Field-shape notes:
 *  - `score_summary` is a JSON STRING (not a parsed object) as stored upstream.
 *  - `food_matching` is a PIPE-SEPARATED STRING since 2026-06-21
 *    (e.g. "Beef | Lamb | Comfort food (pasta bakes, casseroles, roasts)").
 *    Commas may appear INSIDE an item's parenthetical, so never split on ','.
 *    Use parseFoodMatching() from lib/utils to parse it safely.
 *  - `flavor_tags` is a STRING ARRAY (string[]).
 *
 * DELIBERATELY ABSENT (do NOT add — these are internal-only):
 *  - id                 (internal DB primary key)
 *  - margin_pct         (internal pricing)
 *  - b2b_margin_pct     (internal pricing)
 *  - enrichment_*       (e.g. enrichment_confidence — internal pipeline metadata)
 *  - popularity_score / popularity_rank  (internal raw ranking signals — FORBIDDEN)
 *    (the ONE allowed derivative is the coarse popularity_tier 0|1|2 field below)
 */
export interface PublicProduct {
  // Required identity / commercial fields.
  sku: string;
  name: string;
  price: number;

  // Optional descriptive / classification fields.
  brand?: string;
  classification?: string;
  wine_classification?: string;
  designation?: string;   // derived class/designation (Grand Cru/DOCG/IGT/XO/…); see lib/designation.ts
  // Universal product attributes (renamed from wine_* 2026-06-22; apply to all categories).
  variety?: string; // grape (wine) / agave (tequila) / barley (whisky) / rice (sake)
  blend_type?: string;
  vintage?: string; // STRING at runtime: "Current vintage", "2005", "2005 [**VINTAGE MAY CHANGE]" — never numeric math, only displayed as text

  country?: string;
  region?: string;
  subregion?: string;
  appellation?: string;
  body?: string;
  acidity?: string;
  tannin?: string;
  sweetness?: string;
  intensity?: string;
  smokiness?: string;
  finish?: string;
  production_style?: string[];
  food_matching?: string; // pipe-separated string; see parseFoodMatching() in lib/utils
  food_matching_detail?: string; // pipe-separated original detailed dishes; see signatureDishes() in lib/utils
  flavor_tags?: string[]; // array of tag strings
  flavor_tags_canonical?: string[]; // canonical Title-Case flavor notes (e.g. ["Dark Plum","Minerality"]); used by the finder's flavor scoring
  bottle_size?: string;
  currency?: string;
  desc_en_short?: string;
  full_description?: string;
  taste_profile?: Record<string, unknown>; // structured object/JSON, shape varies upstream
  color?: string;
  image_url?: string;
  score_summary?: string; // JSON STRING (not a parsed object)
  score_max?: number;
  // SKU-derived canonical taxonomy, backfilled on every export row. These are the
  // authoritative shopper-facing category fields (the raw `classification` field is
  // unreliable). Resolved by lib/sku-taxonomy.ts; see category-groups.ts shims.
  category_group?: string; // one of CATEGORY_GROUPS (or 'Unknown')
  category_type?: string;  // sub-type within the group, e.g. "Red Wine", "Glassware"
  // NORMALIZED at load time. The raw live export stores this as a STRING "0"/"1" or null;
  // toPublicProduct() in catalog-data.ts coerces it to a REAL boolean via isInStock() so this
  // type is honest and plain-truthiness consumers are correct ("0" no longer reads as in-stock).
  is_in_stock?: boolean;
  // Coarse, client-SAFE popularity bucket derived server-side from popularity_score
  // (which is itself FORBIDDEN from the public shape). 0 = no sales data, 1 = sells,
  // 2 = top seller (>= p75 of scored population). Drives Recommended ordering upstream
  // and is available for optional "Bestseller" badging. The raw score never ships.
  popularity_tier?: 0 | 1 | 2;
}
