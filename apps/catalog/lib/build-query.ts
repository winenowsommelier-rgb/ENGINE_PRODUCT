/**
 * buildQuery — PURE URL-search-param patcher for the shop Filters.
 *
 * Filters reflects all of its controls in the URL (?group=Wine&price=...). To
 * keep that logic unit-testable (and out of the React/next-navigation render
 * path), the merge lives here as a pure function: take the CURRENT params, apply
 * a PATCH, get back a query string.
 *
 * Semantics:
 *  - patch value = string  → set/overwrite that key
 *  - patch value = null    → DELETE that key (used by "clear this filter")
 *  - keys not in the patch  → preserved as-is
 *  - empty-string value ''  → treated as "clear" (a blank filter is no filter),
 *    so callers can pass '' to remove a key without a separate null.
 *
 * Returns a query string WITHOUT a leading '?' (e.g. "group=Wine&price=under-1000"),
 * or '' when no params remain — so callers can do `?${buildQuery(...)}` or
 * route to the bare path when it's empty.
 *
 * Accepts either a URLSearchParams (what useSearchParams gives) or a plain
 * Record (handy for tests and server-side callers).
 */
export function buildQuery(
  current: URLSearchParams | Record<string, string>,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams(
    current instanceof URLSearchParams ? current.toString() : current,
  );

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  return params.toString();
}
