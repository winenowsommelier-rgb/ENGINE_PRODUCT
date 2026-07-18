import 'server-only';
import fs from 'fs';
import path from 'path';
import type { CatalogRow } from './catalog-print';

/**
 * B2B trade-price loader — SEPARATE from catalog-data.ts on purpose.
 *
 * This reads data/b2b_catalog_export.json, a gitignored, server-only export
 * (see scripts/refresh_b2b_catalog_export.py) that carries b2b_price /
 * b2b_discount_pct. Those fields are DELIBERATELY absent from PUBLIC_FIELDS /
 * PublicProduct (apps/catalog/lib/catalog-data.ts, types.ts) — the
 * storefront's margin-leak allowlist. Do not import this module from any
 * client component or merge its output into PublicProduct.
 *
 * The 'server-only' import makes any accidental client-side import a build
 * error rather than a silent leak.
 */

interface B2BRawRow {
  sku?: string;
  name?: string;
  brand?: string;
  vintage?: string;
  bottle_size?: string;
  variety?: string;
  country?: string;
  region?: string;
  subregion?: string;
  category_group?: string;
  price?: number;
  special_price?: number;
  b2b_price?: number;
  b2b_discount_pct?: string;
  image_url?: string;
  score_summary?: string;
  score_max?: number;
}

function exportPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'b2b_catalog_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'b2b_catalog_export.json'),
    process.env.B2B_CATALOG_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('b2b_catalog_export.json not found — run scripts/refresh_b2b_catalog_export.py');
  return found;
}

let _rows: CatalogRow[] | null = null;

export function getB2BCatalogRows(): CatalogRow[] {
  if (_rows !== null) return _rows;
  const raw = JSON.parse(fs.readFileSync(exportPath(), 'utf8')) as B2BRawRow[];
  _rows = raw
    .filter((r): r is B2BRawRow & { sku: string; name: string; price: number; b2b_price: number } =>
      Boolean(r.sku && r.name && r.price && r.b2b_price),
    )
    .map((r) => ({
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      vintage: r.vintage,
      bottleSize: r.bottle_size,
      variety: r.variety,
      imageUrl: r.image_url,
      price: r.price,
      specialPrice: r.special_price,
      b2bPrice: r.b2b_price,
      b2bDiscountPct: r.b2b_discount_pct,
      scoreSummary: r.score_summary,
      scoreMax: r.score_max,
      categoryGroup: r.category_group || 'Other',
      country: r.country,
      region: r.region,
      subregion: r.subregion,
    }));
  return _rows;
}
