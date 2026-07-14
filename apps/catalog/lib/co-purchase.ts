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

/**
 * Resolve the absolute path to the BI affinity file. Mirrors the multi-path
 * probe in catalog-data.ts's exportPath() (cwd differs between local dev and
 * the Vercel build) but does NOT throw when nothing is found — see module
 * docblock on graceful degradation.
 */
function affinityPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data', 'bi-product-affinities.json'),
    path.join(process.cwd(), '..', '..', 'data', 'bi-product-affinities.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let _affinities: Record<string, AffinityRecord> | null = null;
let _loaded = false;

function loadAffinities(): Record<string, AffinityRecord> {
  if (_loaded) return _affinities ?? {};
  _loaded = true;
  const file = affinityPath();
  if (!file) {
    console.warn('[co-purchase] bi-product-affinities.json not found; co-purchase bonus disabled for this build.');
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AffinityFile;
    _affinities = parsed.affinities ?? {};
    return _affinities;
  } catch (e) {
    console.warn(`[co-purchase] failed to parse ${file}: ${(e as Error).message}; co-purchase bonus disabled for this build.`);
    return {};
  }
}

// Test-only: reset module-level cache so tests can simulate a fresh load.
// Not exported from any public index — import directly from this module in tests.
export function __resetForTest(): void {
  _affinities = null;
  _loaded = false;
}

const K = 5; // ceiling bonus, only reachable at rate=1.0 AND full damping

// SUPPORT_FULL_AT is curve-fit to an observed gap between well-supported and
// thinly-supported subjects' co_order list lengths (see Task 1 investigation
// and spec decision #6) — a rough proxy, not a calibrated confidence
// threshold. TODO: replace with a real order-count-based Wilson/Bayesian
// shrinkage once/if the BI export adds a support (n_orders) field per pair.
const SUPPORT_FULL_AT = 5;

export function supportDamping(listLength: number): number {
  return Math.min(1, listLength / SUPPORT_FULL_AT);
}

/**
 * Bonus points for candidate given subject, scaled from BI co_order rate.
 * Returns 0 if no co_order data for subject, or candidate isn't a listed
 * co_order target. Deliberately never consults co_customer_affinities (spec
 * decision #2) — no blend, no fallback to it when co_order is empty.
 */
export function getCoPurchaseBonus(
  subjectSku: string,
  candidateSku: string,
  baseSkuMap: Map<string, string[]>,
): number {
  const affinities = loadAffinities();
  const subjectBase = baseCodeOf(subjectSku);
  const record = affinities[subjectBase];
  if (!record || !record.co_order_affinities?.length) return 0;

  const candidateBase = baseCodeOf(candidateSku);
  const entry = record.co_order_affinities.find((e) => e.base_product_code === candidateBase);
  if (!entry) return 0;

  const damping = supportDamping(record.co_order_affinities.length);
  return entry.rate * K * damping;
}
