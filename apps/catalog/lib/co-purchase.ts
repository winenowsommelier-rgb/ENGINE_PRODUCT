/**
 * co-purchase.ts — real BI co-purchase ("customers also bought in the same
 * order") data, wired into the recommender's additive scorer as one more
 * signal. See docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md
 * for the full design and the decisions behind it (esp. why only
 * co_order_affinities is used, never co_customer_affinities).
 */
import fs from 'fs';
import path from 'path';
import type { PublicProduct } from '@/lib/types';

type AffinityEntry = { rank: number; base_product_code: string; product_name: string; rate: number };
// co_customer_affinities is parsed as part of the file's shape but
// deliberately never read by this module (spec decision #2).
type AffinityRecord = { co_order_affinities: AffinityEntry[]; co_customer_affinities: AffinityEntry[] };
type AffinityFile = { source: string; exported_at: string; base_count: number; affinities: Record<string, AffinityRecord> };

// live sku -> base_product_code, via the 3-letter/4-digit prefix BI base
// codes are keyed on (e.g. "WRW6603AC" -> "WRW6603"). SKUs that don't match
// the pattern are returned unchanged (defensive: never throws on a weird sku).
export function baseCodeOf(sku: string): string {
  const m = sku.match(/^([A-Z]{3}\d{4})/);
  return m ? m[1] : sku;
}

/**
 * base_product_code (BI) -> live sku[] (0 built here; callers get [] via
 * Map.get returning undefined -> treat as no live match). `all` is the FULL
 * product pool (in-stock AND out-of-stock) — matching the existing `all`
 * parameter convention on precomputeRecommendations/getRecommendations.
 * Stock filtering is NOT this function's job (same as every other
 * candidate-pool step in recommender.ts); it happens later via isEligible.
 */
export function buildBaseSkuMap(all: readonly PublicProduct[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of all) {
    if (!p.sku) continue;
    const base = baseCodeOf(p.sku);
    const arr = map.get(base);
    if (arr) arr.push(p.sku);
    else map.set(base, [p.sku]);
  }
  return map;
}
