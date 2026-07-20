import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PublicProduct } from '@/lib/types';

// This route is a CLAUDE.md hyper-scrutiny zone (auth + margin-adjacent B2B
// pricing data). getAllProducts/getProductBySku are mocked so tests don't
// depend on the real DB/export files; getRecommendationsWithBands is left
// real so the auth/B2B-fallback wiring is exercised against genuine scoring
// output, not a stubbed shape.
vi.mock('@/lib/catalog-data', () => ({
  getAllProducts: vi.fn(),
  getProductBySku: vi.fn(),
}));

const base = {
  name: 'X', region: 'Bordeaux', variety: 'Cabernet', country: 'France',
  classification: 'Red Wine', food_matching: 'Beef, Lamb', is_in_stock: true,
} as any;
const mkProduct = (sku: string, price: number, overrides: any = {}): PublicProduct => ({
  ...base, sku, price, ...overrides,
});

const SUBJECT = mkProduct('SUBJECT', 1000);
const CAND_A = mkProduct('CAND_A', 1050);
const CAND_B = mkProduct('CAND_B', 1100);
const POOL = [SUBJECT, CAND_A, CAND_B];

async function importRoute() {
  // Re-imported per test after vi.doMock('node:fs', ...) / resetModules so each
  // test's fs mock and the route's module-level _b2bPrices cache start fresh.
  return await import('../route');
}

/**
 * route.ts does `import fs from 'node:fs'` (default import). Under vitest's
 * ESM transform, that binding resolves through the module's `default` export,
 * not the named exports alone — a mock providing only named overrides is
 * silently ignored and the route falls through to the REAL fs. Mirror every
 * override onto both the named and `default` shape so fs.existsSync(...) in
 * the route actually hits the mock.
 *
 * SCOPED to paths containing "b2b_products_export" — sku-taxonomy.ts (loaded
 * transitively via getRecommendationsWithBands -> isEligible ->
 * groupForProduct) also calls existsSync/readFileSync for its own
 * sku_prefix_map.json at module-load time. A blanket fs mock breaks that
 * unrelated read; delegate to the real fs for every other path.
 */
async function mockB2bFile(behavior: {
  exists: boolean;
  read?: () => string;
}) {
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    const isB2bPath = (p: unknown) => typeof p === 'string' && p.includes('b2b_products_export');
    const merged = {
      ...actual,
      existsSync: vi.fn((p: unknown) => (isB2bPath(p) ? behavior.exists : actual.existsSync(p as any))),
      readFileSync: vi.fn((p: unknown, ...rest: any[]) =>
        isB2bPath(p) ? behavior.read!() : (actual.readFileSync as any)(p, ...rest)
      ),
    };
    return { ...merged, default: merged };
  });
}

describe('GET /api/internal/recommendations', () => {
  const ORIGINAL_ENV = process.env.STAFF_RECS_TOKEN;

  beforeEach(async () => {
    vi.resetModules();
    const catalogData = await import('@/lib/catalog-data');
    vi.mocked(catalogData.getAllProducts).mockReturnValue(POOL);
    vi.mocked(catalogData.getProductBySku).mockImplementation(
      (sku: string) => POOL.find(p => p.sku === sku)
    );
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.STAFF_RECS_TOKEN;
    else process.env.STAFF_RECS_TOKEN = ORIGINAL_ENV;
    vi.unstubAllEnvs();
    vi.doUnmock('node:fs');
    vi.restoreAllMocks();
  });

  describe('auth', () => {
    it('fails closed with 503 when STAFF_RECS_TOKEN is not configured, even with a token header', async () => {
      delete process.env.STAFF_RECS_TOKEN;
      const { GET } = await importRoute();
      const req = new NextRequest('http://localhost/api/internal/recommendations?sku=SUBJECT', {
        headers: { 'x-staff-token': 'anything' },
      });
      const res = await GET(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });

    it('returns 401 when the token header is missing', async () => {
      process.env.STAFF_RECS_TOKEN = 'correct-token';
      const { GET } = await importRoute();
      const req = new NextRequest('http://localhost/api/internal/recommendations?sku=SUBJECT');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when the token header does not match', async () => {
      process.env.STAFF_RECS_TOKEN = 'correct-token';
      const { GET } = await importRoute();
      const req = new NextRequest('http://localhost/api/internal/recommendations?sku=SUBJECT', {
        headers: { 'x-staff-token': 'wrong-token' },
      });
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('succeeds with a matching token header', async () => {
      process.env.STAFF_RECS_TOKEN = 'correct-token';
      const { GET } = await importRoute();
      const req = new NextRequest('http://localhost/api/internal/recommendations?sku=SUBJECT', {
        headers: { 'x-staff-token': 'correct-token' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
    });

    it('does not leak whether a wrong token vs a missing config was the cause (both are auth failures, not 500s)', async () => {
      // Regression guard: an attacker probing the route should not be able to
      // distinguish "misconfigured deployment" from "wrong token" via status
      // code alone beyond the documented 503-vs-401 contract — both must be
      // clean 4xx/503, never an unhandled exception (500) that could leak a
      // stack trace mentioning env var names or file paths.
      delete process.env.STAFF_RECS_TOKEN;
      const { GET } = await importRoute();
      const req = new NextRequest('http://localhost/api/internal/recommendations?sku=SUBJECT', {
        headers: { 'x-staff-token': 'wrong' },
      });
      const res = await GET(req);
      expect([401, 503]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });

  describe('basic request handling', () => {
    beforeEach(() => {
      process.env.STAFF_RECS_TOKEN = 'correct-token';
    });

    const authedReq = (qs: string) =>
      new NextRequest(`http://localhost/api/internal/recommendations${qs}`, {
        headers: { 'x-staff-token': 'correct-token' },
      });

    it('returns 400 when sku is missing', async () => {
      const { GET } = await importRoute();
      const res = await GET(authedReq(''));
      expect(res.status).toBe(400);
    });

    it('returns 404 when sku does not exist', async () => {
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=DOES_NOT_EXIST'));
      expect(res.status).toBe(404);
    });

    it('returns recommendations for a valid sku, excluding the subject itself', async () => {
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.find((r: any) => r.sku === 'SUBJECT')).toBeUndefined();
      expect(body.every((r: any) => 'scoreBreakdown' in r)).toBe(true);
    });

    it('clamps limit into [1, 20] and defaults to 8 when absent/invalid', async () => {
      const { GET } = await importRoute();
      const resDefault = await GET(authedReq('?sku=SUBJECT'));
      expect((await resDefault.json()).length).toBeLessThanOrEqual(8);

      const resOverMax = await GET(authedReq('?sku=SUBJECT&limit=999'));
      expect((await resOverMax.json()).length).toBeLessThanOrEqual(20);

      // NaN-safe: a garbage limit must not crash the route or silently become
      // NaN/0 — it should fall back to the documented default of 8.
      const resGarbage = await GET(authedReq('?sku=SUBJECT&limit=not-a-number'));
      expect(resGarbage.status).toBe(200);
      expect((await resGarbage.json()).length).toBeLessThanOrEqual(8);

      const resZero = await GET(authedReq('?sku=SUBJECT&limit=0'));
      expect(resZero.status).toBe(200);
      const zeroBody = await resZero.json();
      expect(zeroBody.length).toBeGreaterThanOrEqual(0);
      expect(zeroBody.length).toBeLessThanOrEqual(1); // clamped up to min 1, not 0
    });

    it('never includes b2b_price or band_price_basis fields in a non-b2b request', async () => {
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT'));
      const body = await res.json();
      for (const row of body) {
        expect(row.b2b_price).toBeNull();
        expect(row.band_price_basis).toBeUndefined();
      }
    });
  });

  describe('b2b mode', () => {
    beforeEach(() => {
      process.env.STAFF_RECS_TOKEN = 'correct-token';
    });

    const authedReq = (qs: string) =>
      new NextRequest(`http://localhost/api/internal/recommendations${qs}`, {
        headers: { 'x-staff-token': 'correct-token' },
      });

    it('returns 503 when b2b=true but the B2B export file does not exist on disk', async () => {
      await mockB2bFile({ exists: false });
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/b2b price data unavailable/i);
    });

    it('returns 503 when the B2B export file exists but is malformed JSON (never a 500, never leaks parse error to client)', async () => {
      await mockB2bFile({ exists: true, read: () => '{not valid json' });
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/b2b price data unavailable/i);
      expect(JSON.stringify(body)).not.toMatch(/SyntaxError|not valid json|at JSON\.parse/i);
    });

    it('returns 503 when the B2B export file exists but has zero usable rows (all null/zero/missing prices)', async () => {
      await mockB2bFile({
        exists: true,
        read: () => JSON.stringify([
          { sku: 'CAND_A', b2b_price: null },
          { sku: 'CAND_B', b2b_price: 0 },
        ]),
      });
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res.status).toBe(503);
    });

    it('serves 200 with b2b_price populated and band_price_basis="b2b" for a fully-covered SKU', async () => {
      await mockB2bFile({
        exists: true,
        read: () => JSON.stringify([
          { sku: 'CAND_A', b2b_price: 900 },
          { sku: 'CAND_B', b2b_price: 950 },
        ]),
      });
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBeGreaterThan(0);
      for (const row of body) {
        expect(row.band_price_basis).toBe('b2b');
        expect(row.b2b_price).toBe(row.sku === 'CAND_A' ? 900 : 950);
      }
    });

    it('signals band_price_basis="retail" per-row for a candidate missing from partial B2B coverage, without failing the whole request', async () => {
      // Partial coverage: only CAND_A has a B2B price. CAND_B must still be
      // returned (not silently dropped) but flagged as retail-basis so staff
      // don't mistake its band for a B2B-accurate one — this is the exact
      // gap CLAUDE.md Rule 1 exists to prevent (silent degrade with no signal).
      await mockB2bFile({
        exists: true,
        read: () => JSON.stringify([{ sku: 'CAND_A', b2b_price: 900 }]),
      });
      const { GET } = await importRoute();
      const res = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res.status).toBe(200);
      const body = await res.json();
      const rowA = body.find((r: any) => r.sku === 'CAND_A');
      const rowB = body.find((r: any) => r.sku === 'CAND_B');
      expect(rowA?.band_price_basis).toBe('b2b');
      expect(rowA?.b2b_price).toBe(900);
      expect(rowB?.band_price_basis).toBe('retail');
      expect(rowB?.b2b_price).toBeNull();
    });

    it('does not poison the module-level cache after a malformed-file 503, so a later valid read still works within the same warm instance', async () => {
      // Regression guard for the "assign _b2bPrices only after try/catch
      // resolves" fix — a parse error on request 1 must not permanently wedge
      // the route into returning stale/empty B2B data for the life of the
      // serverless instance.
      let callCount = 0;
      await mockB2bFile({
        exists: true,
        read: () => {
          callCount++;
          if (callCount === 1) return '{not valid json';
          return JSON.stringify([{ sku: 'CAND_A', b2b_price: 900 }]);
        },
      });
      const { GET } = await importRoute();

      const res1 = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res1.status).toBe(503);

      const res2 = await GET(authedReq('?sku=SUBJECT&b2b=true'));
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2.find((r: any) => r.sku === 'CAND_A')?.band_price_basis).toBe('b2b');
    });
  });
});
