/**
 * search-index — client-safe search types + pure match helper.
 *
 * This module has NO server-only imports (no fs / catalog-data). It is imported
 * by the CLIENT SearchOverlay, so it must stay free of anything that pulls Node
 * built-ins into the client bundle. The build-time index construction lives in a
 * SEPARATE server-only module (./search-index.server.ts) so importing the pure
 * helper here never drags `fs` into the client.
 *
 * DATA FLOW (perf fix):
 *   1. scripts/gen-search-index.mjs runs ONCE at build time (npm "prebuild") and
 *      projects each product to 4 short fields { sku, name, brand, region },
 *      writing public/search-index.json — a single cacheable static asset.
 *      (search-index.server.ts buildSearchIndex() applies the same projection and
 *      is the leak-guarantee fixture the unit tests assert against.)
 *   2. The static file is fetched LAZILY by <SearchOverlay> the first time a
 *      shopper opens search — it is NO LONGER embedded in every page's HTML.
 *   3. On the client, searchEntries(index, query) (below) runs a pure,
 *      case-insensitive substring match and returns up to 10 results.
 *
 * SAFETY: SearchEntry has ONLY sku/name/brand/region (all PUBLIC_FIELDS). No
 * internal field (margin_pct, b2b_margin_pct, enrichment_*, popularity_*, id)
 * can reach the client through the search index.
 */

/**
 * A single searchable row. The ONLY four fields shipped to the client for search.
 * `brand` / `region` are optional because the underlying product fields are.
 */
export interface SearchEntry {
  sku: string;
  name: string;
  brand?: string;
  region?: string;
}

/** Max results returned by searchEntries — keeps the overlay calm and fast. */
export const SEARCH_RESULT_CAP = 10;

/**
 * Pure, case-insensitive substring search over an embedded index.
 *
 * Matches when the (trimmed, lower-cased) query is a substring of ANY of the
 * entry's name / brand / region / sku. Returns at most SEARCH_RESULT_CAP (10)
 * results, in index order. An empty/whitespace-only query returns [] (the
 * overlay shows a hint instead of dumping the whole catalog).
 *
 * No React/Next/Node imports — exhaustively unit-testable in isolation.
 */
export function searchEntries(
  index: SearchEntry[],
  query: string,
): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const out: SearchEntry[] = [];
  for (const e of index) {
    const haystack =
      e.name.toLowerCase() +
      ' ' +
      (e.brand ?? '').toLowerCase() +
      ' ' +
      (e.region ?? '').toLowerCase() +
      ' ' +
      e.sku.toLowerCase();
    if (haystack.includes(q)) {
      out.push(e);
      if (out.length >= SEARCH_RESULT_CAP) break;
    }
  }
  return out;
}
