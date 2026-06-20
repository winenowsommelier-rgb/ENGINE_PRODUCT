/**
 * search-index.server — build-time construction of the client search index.
 *
 * SERVER-ONLY: imports catalog-data (which uses `fs`). It MUST NOT be imported
 * by any client component or its module graph, or webpack would try to bundle
 * `fs` into the client (and fail). The pure helper + SearchEntry type live in
 * the sibling client-safe ./search-index module; this file only adds the build
 * step that reads the catalog.
 *
 * SAFETY — margin-leak chokepoint: buildSearchIndex constructs a NEW object per
 * row with ONLY {sku,name,brand,region} (all PUBLIC_FIELDS). It never spreads
 * the product, so even if a product ever carried extra keys they cannot ride
 * along into the client index.
 */

import { getAllProducts } from './catalog-data';
import type { PublicProduct } from './types';
import type { SearchEntry } from './search-index';

/**
 * Project a single public product to a SearchEntry. Constructs a NEW object with
 * ONLY the 4 allowlisted search fields — never spreads the source.
 */
function toSearchEntry(p: PublicProduct): SearchEntry {
  const entry: SearchEntry = { sku: p.sku, name: p.name };
  if (p.brand) entry.brand = p.brand;
  if (p.region) entry.region = p.region;
  return entry;
}

/**
 * Build the full client search index from the loaded catalog.
 *
 * Called at build time from a server boundary (app/layout.tsx). Returns one
 * SearchEntry per product, in catalog order — pure projection, no sort/dedupe —
 * so its length equals the product count.
 */
export function buildSearchIndex(): SearchEntry[] {
  return getAllProducts().map(toSearchEntry);
}
