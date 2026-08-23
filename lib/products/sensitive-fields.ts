/**
 * Cost/margin/wholesale field protection for internal API responses.
 *
 * Incident (2026-08-22): several app/api/products* and related routes
 * returned raw DB/Supabase rows (object spreads, `select=*`, hand-picked
 * field lists) with no allowlist, leaking cost/margin/wholesale-price data
 * to any unauthenticated caller — the middleware.ts token gate had a
 * separate bypass (see that file's history) that made these routes
 * reachable without a token in the first place. This is the single
 * source-of-truth denylist; every route that echoes a product-like row
 * back to the client MUST run it through stripSensitiveFields() (or filter
 * a CSV/array export against SENSITIVE_PRODUCT_FIELDS) before responding.
 *
 * Mirrors the same denylist already enforced in apps/catalog/lib/catalog-data.ts
 * (PUBLIC_FIELDS) and apps/catalog-b2b/lib/catalog-data.ts (B2B_PUBLIC_FIELDS)
 * for the public storefronts — this app has no such allowlist chokepoint, so
 * this is the denylist equivalent for its many ad hoc response shapes.
 */

export const SENSITIVE_PRODUCT_FIELDS = [
  'cost', 'cost_price',
  'margin_pct', 'margin_thb',
  'b2b_price', 'b2b_margin_pct', 'b2b_margin_thb', 'b2b_discount_pct', 'b2b_margin',
  'supplier_rsp', 'calculated_price',
] as const;

const SENSITIVE_SET = new Set<string>(SENSITIVE_PRODUCT_FIELDS);

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_SET.has(field);
}

/** Returns a shallow copy of `row` with every sensitive field removed. */
export function stripSensitiveFields<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const f of SENSITIVE_PRODUCT_FIELDS) delete out[f];
  return out as T;
}

/** Array form of stripSensitiveFields, for list/paginated responses. */
export function stripSensitiveFieldsMany<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(stripSensitiveFields);
}
