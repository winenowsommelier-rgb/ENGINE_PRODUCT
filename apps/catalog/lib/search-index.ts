/**
 * search-index — client-safe search types + pure match helper.
 *
 * This module has NO server-only imports (no fs / catalog-data). It is imported
 * by the CLIENT SearchOverlay, so it must stay free of anything that pulls Node
 * built-ins into the client bundle. The build-time index construction lives in a
 * SEPARATE server-only module (./search-index.server.ts) so importing the pure
 * helper here never drags `fs` into the client.
 *
 * DATA FLOW (Task 12):
 *   1. buildSearchIndex() (search-index.server.ts) runs ONCE at build time in a
 *      SERVER component (app/layout.tsx) and projects each product to 4 short
 *      fields: { sku, name, brand, region }.
 *   2. That array crosses the server→client boundary as a prop into
 *      <SearchOverlay index={...} /> — embedded once for the whole site.
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
