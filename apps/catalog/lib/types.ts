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
 *  - `food_matching` is a COMMA-SEPARATED STRING (e.g. "Beef, Lamb, Cheese").
 *  - `flavor_tags` is a STRING ARRAY (string[]).
 *
 * DELIBERATELY ABSENT (do NOT add — these are internal-only):
 *  - id                 (internal DB primary key)
 *  - margin_pct         (internal pricing)
 *  - b2b_margin_pct     (internal pricing)
 *  - enrichment_*       (e.g. enrichment_confidence — internal pipeline metadata)
 *  - popularity_*       (e.g. popularity_rank/score — internal ranking signals)
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
  grape_variety?: string;
  vintage?: string; // STRING at runtime: "Current vintage", "2005", "2005 [**VINTAGE MAY CHANGE]" — never numeric math, only displayed as text

  country?: string;
  region?: string;
  subregion?: string;
  appellation?: string;
  wine_body?: string;
  wine_acidity?: string;
  wine_tannin?: string;
  food_matching?: string; // comma-separated string, e.g. "Beef, Lamb, Cheese"
  flavor_tags?: string[]; // array of tag strings
  bottle_size?: string;
  currency?: string;
  desc_en_short?: string;
  full_description?: string;
  taste_profile?: Record<string, unknown>; // structured object/JSON, shape varies upstream
  wine_color?: string;
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
}
