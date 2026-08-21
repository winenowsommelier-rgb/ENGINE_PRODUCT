/**
 * B2BProduct — the ONLY product shape allowed to reach a B2B/WNLQ9 Trade
 * client's browser. This is a private trade account, so — unlike the public
 * storefront — the retail `price` (shown as RRP) and `b2b_discount_pct` (the
 * % off RRP) ARE included, so trade buyers can see their discount.
 * Leak-prevention chokepoint: toPublicProductB2B() in catalog-data.ts.
 *
 * DELIBERATELY ABSENT (do NOT add):
 *  - special_price       (retail sale price mechanics — not relevant to trade)
 *  - sp_discount_pct     (retail discount % — not relevant to trade)
 *  - margin_pct          (internal pricing)
 *  - b2b_margin_pct      (internal pricing)
 *  - b2b_margin_thb      (internal pricing)
 *  - cost                (internal cost)
 *  - popularity_score    (raw ranking signal — forbidden; only coarse tier ships)
 */
export interface B2BProduct {
  // Required identity / commercial fields.
  sku: string;
  name: string;
  b2b_price: number;
  /** Retail RRP — the reference price trade buyers see their discount against. */
  price?: number;
  /** Wholesale discount vs RRP, e.g. 11.4 = 11.4% off. Computed server-side from (price, b2b_price); not present for every SKU. */
  b2b_discount_pct?: number;

  // Optional descriptive / classification fields.
  brand?: string;
  classification?: string;
  designation?: string;
  variety?: string;
  blend_type?: string;
  vintage?: string;

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
  food_matching?: string;
  food_matching_detail?: string;
  flavor_tags?: string[];
  flavor_tags_canonical?: string[];
  bottle_size?: string;
  currency?: string;
  image_url?: string;
  score_summary?: string;
  score_max?: number;

  // SKU-derived canonical taxonomy.
  category_group?: string;
  category_type?: string;

  // Stock fields.
  is_in_stock?: boolean;
  custom_stock_status?: string;
  wn_stock?: number;
  // B2B export carries a real quantity (unlike public which only shows a badge).
  quantity_in_stock?: number;

  // Coarse, client-safe popularity bucket (0=none, 1=sells, 2=top seller).
  popularity_tier?: 0 | 1 | 2;
}
