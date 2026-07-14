import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { baseCodeOf, buildBaseSkuMap } from '@/lib/co-purchase';
import { getCoPurchaseBonus, __resetForTest } from '@/lib/co-purchase';
import { supportDamping } from '@/lib/co-purchase';

describe('baseCodeOf', () => {
  it('strips a trailing variant-lot suffix', () => {
    expect(baseCodeOf('WRW6603AC')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it has no suffix', () => {
    expect(baseCodeOf('WRW6603')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it does not match the 3-letter/4-digit pattern', () => {
    expect(baseCodeOf('WEIRD')).toBe('WEIRD');
  });
});

describe('buildBaseSkuMap', () => {
  const products = [
    { sku: 'WRW6603AC', name: 'A' },
    { sku: 'WRW6564GF', name: 'B' },
    { sku: 'WRW6564AA', name: 'C' },
    { sku: 'NOPREFIXMATCH', name: 'D' },
  ] as any;

  it('maps a base code to its live sku', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6603')).toEqual(['WRW6603AC']);
  });
  it('fans out a base code to 2 live sku variants', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6564')?.sort()).toEqual(['WRW6564AA', 'WRW6564GF']);
  });
  it('excludes codes with no live match (map has no entry for them)', () => {
    const map = buildBaseSkuMap(products);
    expect(map.has('NOP')).toBe(false);
  });
});

describe('BI file loading — graceful degradation', () => {
  it('getCoPurchaseBonus returns 0 when there is no co_order data for the subject', () => {
    const map = new Map<string, string[]>();
    expect(getCoPurchaseBonus('NOSUCHSKU0000', 'ALSONOTREAL0000', map)).toBe(0);
  });
});

describe('supportDamping', () => {
  it('a short list (length 1) is damped well below 1.0', () => {
    expect(supportDamping(1)).toBeCloseTo(0.2, 5);
  });
  it('a list at SUPPORT_FULL_AT (5) reaches full damping (1.0)', () => {
    expect(supportDamping(5)).toBe(1);
  });
  it('a list longer than SUPPORT_FULL_AT is capped at 1.0, never exceeds it', () => {
    expect(supportDamping(50)).toBe(1);
  });
  it('a list of length 0 damps to 0', () => {
    expect(supportDamping(0)).toBe(0);
  });
});

describe('coverage regression guard (real data)', () => {
  it('maps >90% of real BI subject codes to a live base SKU', () => {
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    if (!biPath || !exportPathFile) {
      throw new Error('Real data files not found — run this test from the repo, not an isolated fixture dir.');
    }
    const bi = JSON.parse(fs.readFileSync(biPath, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    const baseSkuMap = buildBaseSkuMap(liveRows as any);
    const biCodes = Object.keys(bi.affinities);
    const mapped = biCodes.filter((code) => baseSkuMap.has(code));
    const coverage = mapped.length / biCodes.length;

    expect(coverage).toBeGreaterThan(0.90);
  });
});

function findRealFile(relPath: string): string | null {
  const candidates = [
    path.join(process.cwd(), relPath),
    path.join(process.cwd(), '..', '..', relPath),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

describe('getCoPurchaseBonus — real data integration', () => {
  it('returns a positive bonus for a real known co_order pair', () => {
    __resetForTest();
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    // Find one real subject with a co_order entry that maps to a live sku.
    let subjectSku = '', candidateSku = '';
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base);
      if (!subjectSkus?.length) continue;
      for (const entry of record.co_order_affinities ?? []) {
        const candSkus = baseSkuMap.get(entry.base_product_code);
        if (candSkus?.length) {
          subjectSku = subjectSkus[0];
          candidateSku = candSkus[0];
          break outer;
        }
      }
    }
    expect(subjectSku).not.toBe('');

    const bonus = getCoPurchaseBonus(subjectSku, candidateSku, baseSkuMap);
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(5); // K ceiling
  });

  // REGRESSION GUARD: a candidate that appears ONLY in co_customer_affinities
  // (never in co_order_affinities) must score 0 — this is the dropped
  // max-blend decision (spec decision #2). If this test ever fails, someone
  // reintroduced the co_customer fallback; don't "fix" the test, fix the code.
  it('scores 0 for a candidate that ONLY appears in co_customer_affinities, not co_order_affinities', () => {
    __resetForTest();
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    let subjectSku = '', candidateSku = '';
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base);
      if (!subjectSkus?.length) continue;
      const orderCodes = new Set((record.co_order_affinities ?? []).map((e: any) => e.base_product_code));
      for (const entry of record.co_customer_affinities ?? []) {
        if (orderCodes.has(entry.base_product_code)) continue; // must be customer-only
        const candSkus = baseSkuMap.get(entry.base_product_code);
        if (candSkus?.length) {
          subjectSku = subjectSkus[0];
          candidateSku = candSkus[0];
          break outer;
        }
      }
    }
    expect(subjectSku).not.toBe(''); // sanity: found a customer-only pair to test against

    const bonus = getCoPurchaseBonus(subjectSku, candidateSku, baseSkuMap);
    expect(bonus).toBe(0);
  });
});
