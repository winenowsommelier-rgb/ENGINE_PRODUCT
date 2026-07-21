import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { getRecommendations, getRecommendationsWithBands, precomputeRecommendations, priceBand, scoreCandidateDetailed } from '@/lib/recommender';
import { buildBaseSkuMap } from '@/lib/co-purchase';
import type { Band } from '@/lib/types';

const base = { sku:'A', name:'A', region:'Bordeaux', variety:'Cabernet',
  country:'France', classification:'Red Wine', food_matching:'Beef, Lamb', price:1600, is_in_stock:true } as any;
const pool = [
  base,
  { ...base, sku:'B', name:'B', price:1700 },
  { ...base, sku:'C', name:'C', region:'Napa', country:'USA', food_matching:'Beef', price:1800 },
  { ...base, sku:'D', name:'D', region:'X', variety:'Y', country:'Z', classification:'Gin', food_matching:'Fish', price:50000 },
  { ...base, sku:'E', name:'E', is_in_stock:false },
];

describe('getRecommendations', () => {
  it('returns up to 4, excludes self and OOS, no dupes', () => {
    const recs = getRecommendations(base, pool);
    expect(recs.length).toBeLessThanOrEqual(4);
    expect(recs.find(r => r.sku === 'A')).toBeUndefined();
    expect(recs.find(r => r.sku === 'E')).toBeUndefined();
    expect(new Set(recs.map(r => r.sku)).size).toBe(recs.length);
  });

  // DEFENSIVE / REGRESSION (data-integrity bug): even if a caller passes a RAW,
  // un-normalized product whose is_in_stock is the string "0" (the live-export shape),
  // it must be treated as OUT-of-stock and excluded. Plain truthiness read "0" as
  // in-stock, surfacing 5,683 out-of-stock products — this guards against that.
  it('excludes a candidate whose is_in_stock is the raw string "0"', () => {
    const rawOos = { ...base, sku: 'RAW0', name: 'RAW0', price: 1650, is_in_stock: '0' } as any;
    const recs = getRecommendations(base, [...pool, rawOos]);
    expect(recs.find(r => r.sku === 'RAW0')).toBeUndefined();
  });
  it('ranks the most-similar product first', () => {
    expect(getRecommendations(base, pool)[0].sku).toBe('B');
  });
  // D scores 0 (no shared region/variety/country/food/price/category_type signal
  // with base) and so is dropped by scoreCandidate's score>0 filter — NOT by the
  // cross-category suppression gate in isEligible(). Neither base (sku 'A') nor D
  // (sku 'D') sets a real category_group, so groupForProduct() falls back to
  // SKU-taxonomy resolution: D's sku (also 'D') doesn't match a known prefix and
  // resolves to 'Unknown', while base's sku 'A' happens to resolve to
  // 'Accessories' via the taxonomy's letter-fallback. Either way, the suppression
  // gate short-circuits as soon as ONE side is 'Unknown' (candidateGroup here) —
  // it never even reaches the group-equality check, so this test's drop is purely
  // about score, not suppression. See the 'cross-category suppression' describe
  // block below for tests that actually exercise the gate (those fixtures set
  // category_group explicitly on both sides to a real, non-Unknown value).
  it('a far-out-of-band product (price 50000, no shared attrs) ranks last or is dropped', () => {
    const recs = getRecommendations(base, pool);
    const dIdx = recs.findIndex(r => r.sku === 'D');
    expect(dIdx === -1 || dIdx === recs.length - 1).toBe(true);
  });
  it('food_matching overlap is counted (case-insensitive, comma-split)', () => {
    const p1 = { ...base, sku:'P1', region:'z', variety:'z', country:'z', classification:'z', price:999999, food_matching:'beef, lamb' };
    const p2 = { ...base, sku:'P2', region:'z', variety:'z', country:'z', classification:'z', price:999999, food_matching:'Fish' };
    const recs = getRecommendations(base, [base, p1, p2]);
    expect(recs[0].sku).toBe('P1');
  });
});

// Helper to extract SKUs from the new map shape ({sku,band}[]).
const skus = (map: Map<string, { sku: string; band: Band }[]>, sku: string) =>
  (map.get(sku) ?? []).map(r => r.sku);

describe('precomputeRecommendations', () => {
  it('returns a Map<sku, {sku,band}[]> covering in-stock products', () => {
    const map = precomputeRecommendations(pool);
    expect(map.get('A')).toBeDefined();
    expect(Array.isArray(map.get('A'))).toBe(true);
    expect(map.get('A')!.length).toBeLessThanOrEqual(8);
    expect(skus(map, 'A')).not.toContain('A');
    expect(skus(map, 'A')).not.toContain('E');
  });

  // Pins the accepted region-bucketing approximation — see precomputeRecommendations
  // docblock. If this fails after a refactor, the perf/parity tradeoff changed
  // intentionally-or-not; re-decide, don't just update the assertion.
  it('does NOT surface a cross-region high-scorer (region-bucketing approximation)', () => {
    // Subject product P, region "Bordeaux".
    const P = { ...base, sku:'P', region:'Bordeaux', variety:'Merlot',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000 };

    // Nine MORE in-stock products in P's OWN region bucket (Bordeaux), so the
    // in-region pool reaches >= MIN_POOL (MAX_RECS_EXTENDED + 1 = 9 incl. P) and
    // the classification/country/global widening chain is NOT triggered. These
    // share ONLY region with P (+3) and nothing else, so each scores exactly 3.
    const inRegion = ['R1','R2','R3','R4','R5','R6','R7','R8','R9'].map((sku) => ({
      ...base, sku, region:'Bordeaux', variety:'none', country:'none',
      classification:'none', food_matching:'', price:999999, is_in_stock:true,
    }));

    // A cross-region candidate that WOULD outscore the in-region items in a full
    // scan: shares variety (+2) + country (+1) + classification (+1) +
    // food "Beef" (+1) + price band (+1) = score 6 > 3, but it lives in region
    // "Napa", a DIFFERENT bucket, so bucketing must never merge it into P's pool.
    const crossRegion = { ...base, sku:'X', region:'Napa', variety:'Merlot',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:true };

    const map = precomputeRecommendations([P, ...inRegion, crossRegion]);
    const recsForP = skus(map, 'P');

    // The approximation is pinned: X is NOT recommended even though it would win a
    // full scan. P's recs come only from its region bucket (the R* items).
    expect(recsForP).not.toContain('X');
    expect(recsForP.every((sku) => sku.startsWith('R'))).toBe(true);
  });

  // Tiny region bucket forces the widening chain. We can't observe the bounded
  // global slice from outside, so instead we assert the INVARIANTS still hold
  // after widening: <= MAX_RECS results, all valid in-stock non-self skus.
  it('a product with a tiny region bucket still returns <= 8 valid in-stock non-self skus', () => {
    // Subject T is alone in its region "Solo" — region bucket has only T itself,
    // so widening (classification -> country -> global fallback) must kick in.
    const T = { ...base, sku:'T', region:'Solo', variety:'Syrah',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000 };
    // Other in-stock products in different regions but sharing classification/
    // country with T so widening can find eligible neighbours.
    const others = ['N1','N2','N3','N4','N5','N6'].map((sku, i) => ({
      ...base, sku, region:`Reg${i}`, variety:'Syrah', country:'France',
      classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:true,
    }));
    const oos = { ...base, sku:'OOS', region:'Reg9', country:'France',
      classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:false };

    const allProducts = [T, ...others, oos];
    const map = precomputeRecommendations(allProducts);
    const recsForT = skus(map, 'T');
    const inStockSkus = new Set(others.map((o) => o.sku)); // valid recommendable skus

    expect(recsForT.length).toBeGreaterThan(0); // widening produced neighbours
    expect(recsForT.length).toBeLessThanOrEqual(8); // bounded by MAX_RECS_EXTENDED
    expect(new Set(recsForT).size).toBe(recsForT.length); // no dupes
    expect(recsForT).not.toContain('T'); // never self
    expect(recsForT).not.toContain('OOS'); // never out-of-stock
    expect(recsForT.every((sku) => inStockSkus.has(sku))).toBe(true); // only valid in-stock skus
  });

  // SUBJECT vs CANDIDATE invariant (the OOS-recs bug this fix closes):
  // An OUT-OF-STOCK product is a valid SUBJECT (gets a map entry + recs) but is
  // never a CANDIDATE (never recommended to anyone, never recommends itself).
  // Previously the outer loop iterated only `inStock`, so OOS products got NO map
  // entry and their product page rendered no "you might also like" section.
  it('an OUT-OF-STOCK product still gets recs (all in-stock, excludes itself)', () => {
    // OOS subject P shares region "Bordeaux" with several in-stock neighbours, so
    // its own region bucket (built from in-stock candidates) yields recs FOR it.
    const P = { ...base, sku:'POOS', region:'Bordeaux', variety:'Merlot',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000,
      is_in_stock:false };
    const neighbours = ['IS1','IS2','IS3','IS4','IS5'].map((sku) => ({
      ...base, sku, region:'Bordeaux', variety:'Merlot', country:'France',
      classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:true,
    }));
    const inStockSkus = new Set(neighbours.map((n) => n.sku));

    const map = precomputeRecommendations([P, ...neighbours]);
    const recsForP = skus(map, 'POOS');

    expect(map.get('POOS')).toBeDefined();    // OOS product IS a key now
    expect(recsForP.length).toBeGreaterThan(0); // and it has recommendations
    expect(recsForP).not.toContain('POOS');  // never recommends itself
    // every returned sku is an IN-STOCK candidate
    expect(recsForP.every((sku) => inStockSkus.has(sku))).toBe(true);
  });

  // is_in_stock undefined => treated as unavailable as a CANDIDATE (never
  // recommended TO any other product). It IS still a SUBJECT (gets a map entry),
  // because an unavailable product page should still surface in-stock alternatives.
  it('a product with is_in_stock undefined is a subject but never a candidate', () => {
    const ghost = { ...base, sku:'GHOST', is_in_stock: undefined };
    const inStockTwin = { ...base, sku:'TWIN', price:1650 }; // would otherwise match
    const map = precomputeRecommendations([base, inStockTwin, ghost]);

    // (a) GHOST IS in the map now (OOS/unavailable products are valid subjects),
    //     and its recs are in-stock candidates that exclude itself.
    expect(map.has('GHOST')).toBe(true);
    expect(skus(map, 'GHOST')).not.toContain('GHOST');

    // (b) GHOST is never recommended to anyone else (excluded as a candidate).
    for (const recs of map.values()) {
      expect(recs.map(r => r.sku)).not.toContain('GHOST');
    }
  });

  // GROUP-AWARE WIDENING (Step 4.5): a subject in a SMALL category group must not
  // have its pool "filled" entirely by a big cross-group bucket that is merged
  // EARLY in the widening chain (region -> type -> country -> global fallback).
  //
  // To actually distinguish OLD vs NEW widening logic, the cross-group padding
  // must sit in an EARLIER bucket than the subject's same-group candidates:
  //   - REGION bucket (merged unconditionally, first): 200 cross-group (Wine)
  //     candidates, region "Kyoto" (same as S). Raw pool.length is 200 >= MIN_POOL
  //     right after this merge alone.
  //       OLD logic: checked `pool.length < MIN_POOL` -> 200 >= 9 -> FALSE -> never
  //       widens to the type bucket -> S's pool is 100% cross-group -> Task-4
  //       suppression drops all 200 -> S gets ZERO recs.
  //       NEW logic: checks `eligibleCount() < MIN_POOL`, i.e. SAME-GROUP count
  //       from the pool so far -> 0 same-group items among the 200 Wine
  //       candidates -> 0 < 9 -> TRUE -> widens to the type bucket next.
  //   - TYPE bucket ("Sake", checked second): the 3 same-group candidates live
  //     ONLY here (different region "Osaka", so NOT in S's region bucket). Only
  //     reached by the NEW logic.
  //
  // This means the fixture actually fails under the old (ungated) widening logic
  // and only passes with the eligibleCount() fix — verified by temporarily
  // reverting the eligibleCount() change locally and re-running (see PR notes).
  it('small-group subject gets all its same-group candidates despite a huge cross-group region bucket', () => {
    // Subject S is Sake & Asian, region "Kyoto", country "Japan" — a small group.
    const S = { ...base, sku: 'S', region: 'Kyoto', country: 'Japan',
      variety: 'Rice', classification: 'Sake', food_matching: 'Sushi',
      category_group: 'Sake & Asian', category_type: 'Sake', price: 1000,
      is_in_stock: true };

    // 200 cross-group (Wine) candidates that live in S's OWN region ("Kyoto") —
    // the FIRST bucket merged, unconditionally, before any MIN_POOL check runs.
    // Raw pool.length (200) already satisfies the OLD `pool.length < MIN_POOL`
    // check, so old logic would stop widening right here and never reach the
    // type bucket below. These must be suppressed by isEligible's group gate and
    // must NEVER appear in S's recs.
    const crossGroup = Array.from({ length: 200 }, (_, i) => ({
      ...base, sku: `CG${i}`, region: 'Kyoto', country: 'Other', variety: 'Rice',
      classification: 'Red Wine', food_matching: 'Sushi',
      category_group: 'Wine', category_type: 'Red Wine', price: 1000,
      is_in_stock: true,
    }));

    // Only 3 same-group candidates exist, and they live in a DIFFERENT region
    // ("Osaka") so they are NOT in S's region bucket at all — they only appear
    // in S's TYPE bucket ("Sake"), the second bucket in the widening chain. Old
    // logic never reaches this bucket because the region bucket alone already
    // looked "full" (200 >= MIN_POOL). New logic reaches it because none of
    // those 200 region-bucket items are same-group.
    const sameGroup = ['SG1', 'SG2', 'SG3'].map((sku) => ({
      ...base, sku, region: 'Osaka', country: 'Japan', variety: 'Rice',
      classification: 'Sake', food_matching: 'Sushi',
      category_group: 'Sake & Asian', category_type: 'Sake', price: 1000,
      is_in_stock: true,
    }));

    const map = precomputeRecommendations([S, ...sameGroup, ...crossGroup]);
    const recsForS = skus(map, 'S');

    // All 3 same-group candidates are found (widening continued past the
    // "full but all cross-group" region bucket into the type bucket, because
    // eligibleCount() correctly saw 0 same-group matches there).
    expect(new Set(recsForS)).toEqual(new Set(['SG1', 'SG2', 'SG3']));
    // Never a cross-group SKU, no matter how many were available.
    expect(recsForS.some((sku) => sku.startsWith('CG'))).toBe(false);
  });

  // Task 11 (Phase 2): regionWeightOverride === 0 for Gin means the region
  // bucket must be SKIPPED entirely for gin subjects during precompute, not
  // merely down-weighted at score time — otherwise a UK gin subject's pool
  // would still be dominated by same-region non-gin noise (region bucket alone
  // satisfies MIN_POOL, so the OLD widening chain would never reach the TYPE
  // bucket where the cross-region gin_style match lives). If the
  // `regionWeightOverride(product) !== 0` guard around `merge(byRegion...)`
  // in precomputeRecommendations were reverted, this test fails: GIN_UK's pool
  // fills with the 9 same-region Spirits candidates (score 0 vs GIN_UK — no
  // shared signal), eligibleCount() >= MIN_POOL, and the type-bucket widening
  // step never runs, so GIN_XR (Japan) never enters the pool at all.
  it('gin subject skips its region bucket so a cross-region gin_style match is recommended', () => {
    const GIN_UK = { ...base, sku: 'GIN_UK', region: 'London', country: 'UK',
      variety: 'none', classification: 'Gin', food_matching: '',
      category_group: 'Spirits', category_type: 'Gin', gin_style: 'contemporary_citrus',
      price: 3000, is_in_stock: true };

    // 9 same-region (London), same-group (Spirits) but DIFFERENT-type candidates
    // (not Gin) so the region bucket alone reaches MIN_POOL (9 = MAX_RECS_EXTENDED
    // + 1) and shares NO signal with GIN_UK (score 0 — never actually recommended,
    // just present to "fill" the region bucket and prove it's skipped). country and
    // variety are deliberately set to something other than GIN_UK's so these don't
    // pick up a stray country/variety match that would let them slip into recs too.
    const sameRegionNonGin = Array.from({ length: 9 }, (_, i) => ({
      ...base, sku: `LNVOD${i}`, region: 'London', country: 'Elsewhere', variety: 'grain',
      classification: 'Vodka', food_matching: '', category_group: 'Spirits',
      category_type: 'Vodka', price: 999999, is_in_stock: true,
    }));

    // Cross-region gin (Japan) sharing gin_style with GIN_UK — must be surfaced
    // via the TYPE bucket ("Gin") since the region bucket is skipped for gin.
    const GIN_XR = { ...base, sku: 'GIN_XR', region: 'Osaka', country: 'Japan',
      variety: 'none', classification: 'Gin', food_matching: '',
      category_group: 'Spirits', category_type: 'Gin', gin_style: 'contemporary_citrus',
      price: 3000, is_in_stock: true };

    const map = precomputeRecommendations([GIN_UK, ...sameRegionNonGin, GIN_XR]);
    const recsForGin = skus(map, 'GIN_UK');

    expect(recsForGin).toContain('GIN_XR');
    // The 9 same-region Vodka candidates share no signal (score 0) so none of
    // them should be recommended either.
    expect(recsForGin.some((sku) => sku.startsWith('LNVOD'))).toBe(false);
  });
});

describe('priceBand', () => {
  it('returns similar when both prices null', () => {
    expect(priceBand(null, null)).toBe('similar');
  });
  it('returns similar when subject price is 0', () => {
    expect(priceBand(0, 1500)).toBe('similar');
  });
  it('returns similar when candidate price is null', () => {
    expect(priceBand(1619, null)).toBe('similar');
  });
  it('budget tier: lo clamped to 0 (not negative)', () => {
    // Price 200, band is ±250 absolute → lo = max(0,-50) = 0, hi = 450.
    // stepUpCeiling = max(200*1.35, 450*1.15) = max(270, 517.5) = 517.5
    expect(priceBand(200, 1)).toBe('similar');    // any positive price is >= 0
    expect(priceBand(200, 480)).toBe('step-up');  // 480 > hi(450), <= ceiling(517.5)
    expect(priceBand(200, 520)).toBe(null);       // > ceiling(517.5)
  });
  it('mid tier (1000-5000): ±20%', () => {
    expect(priceBand(1619, 1900)).toBe('similar');      // within 20%
    expect(priceBand(1619, 2100)).toBe('step-up');      // >20% above, within ceiling (2234.22)
    expect(priceBand(1619, 800)).toBe('great-alternative'); // >20% below
  });
  it('high tier (5000-15000): ±15%', () => {
    expect(priceBand(8000, 9000)).toBe('similar');
    expect(priceBand(8000, 9300)).toBe('step-up');
  });
  it('premium tier (15000+): ±10%', () => {
    expect(priceBand(20000, 21999)).toBe('similar');
    expect(priceBand(20000, 22001)).toBe('step-up');
    expect(priceBand(20000, 17000)).toBe('great-alternative');
  });
  // stepUpCeiling caps how far above the subject's price a candidate can be
  // and still read as a natural "step up" rather than an unrelated, jarring
  // price jump. Beyond it, a candidate is excluded (null) rather than
  // mislabeled as step-up or great-alternative. See recommender.ts priceBand.
  describe('step-up ceiling', () => {
    it('just above hi and within the ceiling is step-up', () => {
      // subject 1000: hi=1200 (mid tier, ±20%), ceiling=max(1350, 1380)=1380
      expect(priceBand(1000, 1350)).toBe('step-up');
    });
    it('beyond the ceiling is excluded (null), not step-up', () => {
      expect(priceBand(1000, 1381)).toBe(null); // just over ceiling(1380)
      expect(priceBand(1000, 1800)).toBe(null);
    });
    it('a large price jump (real-world example: 3818 -> 10208, ~2.67x) is excluded', () => {
      expect(priceBand(3818, 10208)).toBe(null);
    });
  });
});

const wineBase = {
  sku: 'W1', name: 'W1', region: 'Burgundy', subregion: 'Côte de Nuits',
  variety: 'Pinot Noir', country: 'France', category_group: 'Wine',
  category_type: 'Red Wine', food_matching: 'Beef|Lamb', price: 1619,
  is_in_stock: true, body: 'Medium', acidity: 'High', tannin: 'Low',
} as any;

describe('scoreCandidateDetailed — taste tiebreakers', () => {
  it('body match adds +1.5', () => {
    const candidate = { ...wineBase, sku: 'W2', body: 'Medium' };
    const { score, breakdown } = scoreCandidateDetailed(wineBase, candidate);
    expect(breakdown.body).toBe(1.5);
    expect(score).toBeGreaterThan(0);
  });
  it('body mismatch adds 0', () => {
    const candidate = { ...wineBase, sku: 'W2', body: 'Full' };
    const { breakdown } = scoreCandidateDetailed(wineBase, candidate);
    expect(breakdown.body ?? 0).toBe(0);
  });
  it('missing body on candidate adds 0, no penalty', () => {
    const candidate = { ...wineBase, sku: 'W2', body: undefined };
    const { breakdown } = scoreCandidateDetailed(wineBase, candidate);
    expect(breakdown.body ?? 0).toBe(0);
  });
  it('acidity and tannin each add +1.5 when matched', () => {
    const candidate = { ...wineBase, sku: 'W2', acidity: 'High', tannin: 'Low' };
    const { breakdown } = scoreCandidateDetailed(wineBase, candidate);
    expect(breakdown.acidity).toBe(1.5);
    expect(breakdown.tannin).toBe(1.5);
  });
  it('three taste signals (+4.5) can surface cross-region match over same-region no-taste match', () => {
    // Same-region-only candidate scores +3 (region)
    const sameRegion = { ...wineBase, sku: 'SR', variety: 'none', food_matching: '', price: 99999 };
    // Cross-region candidate with matching taste scores +4.5 (body+acidity+tannin) + other signals
    const crossRegion = {
      ...wineBase, sku: 'CR', region: 'Marlborough', country: 'New Zealand',
      body: 'Medium', acidity: 'High', tannin: 'Low',
    };
    const { score: sr } = scoreCandidateDetailed(wineBase, sameRegion);
    const { score: cr } = scoreCandidateDetailed(wineBase, crossRegion);
    expect(cr).toBeGreaterThan(sr);
  });
  it('sweetness fires for Wine group subject', () => {
    const subject = { ...wineBase, category_group: 'Wine', sweetness: 'Dry' } as any;
    const candidate = { ...wineBase, sku: 'W2', sweetness: 'Off-Dry' }; // adjacent band
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.sweetness ?? 0).toBeGreaterThan(0);
  });
  it('sweetness does NOT fire for Whisky group subject', () => {
    const subject = { ...wineBase, sku: 'WH1', category_group: 'Whisky', sweetness: 'Dry' } as any;
    const candidate = { ...wineBase, sku: 'WH2', sweetness: 'Dry' };
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.sweetness ?? 0).toBe(0);
  });
  it('smokiness fires for Whisky group subject', () => {
    const subject = { ...wineBase, sku: 'WH1', category_group: 'Whisky', smokiness: 'Heavy' } as any;
    const candidate = { ...wineBase, sku: 'WH2', smokiness: 'Medium' }; // adjacent
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.smokiness ?? 0).toBeGreaterThan(0);
  });
  // REGRESSION GUARD (vocab-vs-DB): the DB stores smokiness LOWERCASE ('none',
  // 'heavy'). A case-sensitive band lookup would silently kill this signal for
  // 100% of real rows while synthetic capitalized tests stay green.
  it('smokiness fires for real lowercase DB values (none/heavy)', () => {
    const subject = { ...wineBase, sku: 'WH1', category_group: 'Whisky', smokiness: 'heavy' } as any;
    const candidate = { ...wineBase, sku: 'WH2', smokiness: 'heavy' };
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.smokiness ?? 0).toBe(0.5);
    // none vs heavy = 3 steps apart — must NOT fire
    const far = { ...wineBase, sku: 'WH3', smokiness: 'none' };
    expect(scoreCandidateDetailed(subject, far).breakdown.smokiness ?? 0).toBe(0);
  });
  it('smokiness does NOT fire for Wine group subject', () => {
    const subject = { ...wineBase, category_group: 'Wine', smokiness: 'Heavy' } as any;
    const candidate = { ...wineBase, sku: 'W2', smokiness: 'Heavy' };
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.smokiness ?? 0).toBe(0);
  });
  it('scoreBreakdown values sum to score', () => {
    const candidate = { ...wineBase, sku: 'W2' };
    const { score, breakdown } = scoreCandidateDetailed(wineBase, candidate);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(score, 5);
  });
});

describe('scoreCandidateDetailed — popularity tiebreaker', () => {
  it('both tier-2 (top quartile) adds +1 under the popularity key', () => {
    const subject = { ...wineBase, popularity_tier: 2 } as any;
    const candidate = { ...wineBase, sku: 'W2', popularity_tier: 2 } as any;
    const { breakdown } = scoreCandidateDetailed(subject, candidate);
    expect(breakdown.popularity).toBe(1);
  });
  it('does NOT fire when only one side is tier 2', () => {
    const subject = { ...wineBase, popularity_tier: 2 } as any;
    const candidate = { ...wineBase, sku: 'W2', popularity_tier: 1 } as any;
    expect(scoreCandidateDetailed(subject, candidate).breakdown.popularity ?? 0).toBe(0);
  });
  it('does NOT fire for two tier-1 (merely above-median) products — only tier 2 counts', () => {
    const subject = { ...wineBase, popularity_tier: 1 } as any;
    const candidate = { ...wineBase, sku: 'W2', popularity_tier: 1 } as any;
    expect(scoreCandidateDetailed(subject, candidate).breakdown.popularity ?? 0).toBe(0);
  });
  it('does NOT fire when popularity_tier is absent on either side (no penalty)', () => {
    const subject = { ...wineBase, popularity_tier: undefined } as any;
    const candidate = { ...wineBase, sku: 'W2', popularity_tier: 2 } as any;
    expect(scoreCandidateDetailed(subject, candidate).breakdown.popularity ?? 0).toBe(0);
  });
  it('popularity (+1) is smaller than every attribute signal, so it cannot override real dissimilarity', () => {
    // Two products sharing NOTHING but tier-2 popularity must still score lower
    // than a same-region, no-popularity-data candidate — popularity is a
    // tiebreaker, not a substitute for genuine similarity.
    const subject = { ...wineBase, popularity_tier: 2 } as any;
    const popularOnly = {
      ...wineBase, sku: 'PO', region: 'Nowhere', country: 'Nowhere',
      variety: 'none', food_matching: '', popularity_tier: 2,
    } as any;
    const sameRegionOnly = { ...wineBase, sku: 'SR', variety: 'none', food_matching: '' } as any;
    const popScore = scoreCandidateDetailed(subject, popularOnly).score;
    const regionScore = scoreCandidateDetailed(subject, sameRegionOnly).score;
    expect(regionScore).toBeGreaterThan(popScore);
  });
});

describe('cross-category suppression', () => {
  const wine = { ...base, sku: 'WINE', category_group: 'Wine', category_type: 'Red Wine', is_in_stock: true };
  const whisky = { ...base, sku: 'WHISK', category_group: 'Whisky', category_type: 'Whisky', is_in_stock: true };
  const gin = { ...base, sku: 'GIN', category_group: 'Spirits', category_type: 'Gin', is_in_stock: true };
  const vodka = { ...base, sku: 'VODKA', category_group: 'Spirits', category_type: 'Vodka', is_in_stock: true };
  const rose = { ...base, sku: 'ROSE', category_group: 'Wine', category_type: 'Rose Wine', is_in_stock: true };

  it('Wine subject never returns Whisky candidate', () => {
    const recs = getRecommendations(wine, [wine, whisky, rose]);
    expect(recs.find(r => r.sku === 'WHISK')).toBeUndefined();
  });
  it('Wine subject returns same-group Rosé candidate', () => {
    const recs = getRecommendations(wine, [wine, whisky, rose]);
    expect(recs.find(r => r.sku === 'ROSE')).toBeDefined();
  });
  it('Gin subject returns same-group Vodka candidate', () => {
    const recs = getRecommendations(gin, [gin, vodka, wine]);
    expect(recs.find(r => r.sku === 'VODKA')).toBeDefined();
  });
  it('Gin subject never returns Wine candidate', () => {
    const recs = getRecommendations(gin, [gin, vodka, wine]);
    expect(recs.find(r => r.sku === 'WINE')).toBeUndefined();
  });
});

const mkProduct = (sku: string, price: number, overrides: any = {}) => ({
  ...base, sku, name: sku, price, is_in_stock: true, ...overrides,
});

describe('getRecommendationsWithBands', () => {
  it('returns max 8 results', () => {
    const pool = Array.from({ length: 20 }, (_, i) => mkProduct(`P${i}`, 1600 + i * 10));
    const results = getRecommendationsWithBands(pool[0], pool);
    expect(results.length).toBeLessThanOrEqual(8);
  });
  it('returns fewer than 8 without padding when not enough candidates', () => {
    const pool = [mkProduct('S', 1000), mkProduct('A', 1100), mkProduct('B', 1200)];
    const results = getRecommendationsWithBands(pool[0], pool);
    expect(results.length).toBeLessThanOrEqual(2); // only A and B are candidates
  });
  it('returns [] when no positive-scoring candidates', () => {
    const subject = mkProduct('S', 1000, { region: 'UNIQUE_REGION_XYZ', variety: 'UNIQUE_VAR', country: 'NOWHERE', food_matching: '' });
    const unrelated = mkProduct('U', 999999, { region: 'OTHER', variety: 'OTHER', country: 'OTHER', food_matching: '' });
    const results = getRecommendationsWithBands(subject, [subject, unrelated]);
    expect(results).toEqual([]);
  });
  it('slot 1 is always band similar', () => {
    const pool = Array.from({ length: 15 }, (_, i) => mkProduct(`P${i}`, 1600 + i * 10));
    const results = getRecommendationsWithBands(pool[0], pool);
    expect(results[0]?.band).toBe('similar');
  });
  it('alternates similar/step-up while BOTH pools have candidates', () => {
    // Subject 1600: similar range is 1280-1920; step-up ceiling is
    // max(1600*1.35, 1920*1.15) = 2208. 5 similar (within ±20% of 1600) + 5
    // step-up (>20% above, still within the 2208 ceiling) — both pools deep
    // enough that the canonical slot order is never forced into fallback.
    const subject = mkProduct('S', 1600);
    const similar = Array.from({ length: 5 }, (_, i) => mkProduct(`SIM${i}`, 1500 + i * 20));
    const stepUp = Array.from({ length: 5 }, (_, i) => mkProduct(`UP${i}`, 1950 + i * 40));
    const results = getRecommendationsWithBands(subject, [subject, ...similar, ...stepUp]);
    expect(results.map(r => r.band)).toEqual([
      'similar', 'step-up', 'similar', 'step-up',
      'similar', 'step-up', 'similar', 'step-up',
    ]);
  });
  // NOTE: adjacency of two step-up slots IS allowed once the similar pool
  // exhausts — the fallback (popAny) intentionally fills remaining slots from
  // whatever band is left rather than returning fewer items. Pin that too:
  it('falls back to remaining band when preferred band exhausts (adjacency allowed)', () => {
    // Ceiling for subject 1600 is 2208 (see above) — all candidates here stay
    // within it so they band as step-up rather than being excluded (null).
    const subject = mkProduct('S', 1600);
    const stepUpOnly = Array.from({ length: 10 }, (_, i) => mkProduct(`UP${i}`, 1950 + i * 20));
    const results = getRecommendationsWithBands(subject, [subject, ...stepUpOnly]);
    expect(results.length).toBe(8);
    expect(results.every(r => r.band === 'step-up')).toBe(true);
  });
  it('great-alternative absent by default (in-stock page)', () => {
    const pool = Array.from({ length: 10 }, (_, i) => mkProduct(`P${i}`, 500 + i * 100));
    const results = getRecommendationsWithBands(pool[5], pool); // subject mid-price
    expect(results.every(r => r.band !== 'great-alternative')).toBe(true);
  });
  it('great-alternative present when includeGreatAlternative: true', () => {
    const subject = mkProduct('S', 3000);
    const cheaper = mkProduct('C', 500); // >20% cheaper = great-alternative
    const similar = mkProduct('M', 2800);
    const results = getRecommendationsWithBands(subject, [subject, cheaper, similar], { includeGreatAlternative: true });
    expect(results.some(r => r.band === 'great-alternative')).toBe(true);
  });
  it('scoreBreakdown values sum to score', () => {
    const pool = Array.from({ length: 5 }, (_, i) => mkProduct(`P${i}`, 1600 + i * 10));
    const results = getRecommendationsWithBands(pool[0], pool);
    for (const r of results) {
      const sum = Object.values(r.scoreBreakdown).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(r.score, 5);
    }
  });
});

function findRealFile(relPath: string): string | null {
  const candidates = [
    path.join(process.cwd(), relPath),
    path.join(process.cwd(), '..', '..', relPath),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

describe('co-purchase integration (real BI data)', () => {
  it('a real co_order pair ranks above an otherwise-equivalent candidate with no co-purchase signal', () => {
    const biPath = findRealFile('data/bi-product-affinities.json');
    const exportPathFile = findRealFile('data/live_products_export.json');
    const bi = JSON.parse(fs.readFileSync(biPath!, 'utf8'));
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);
    const baseSkuMap = buildBaseSkuMap(liveRows as any);

    // Find a real subject sku with an in-stock live sku and a real co_order
    // partner that also maps to a live sku.
    const bySku = new Map(liveRows.map((r: any) => [r.sku, r]));
    let subjectProduct: any = null, coOrderPartnerSku = '';
    // Must also share category_group with the subject: isEligible() suppresses
    // cross-category-group candidates entirely (Wine <-> Accessories, etc.),
    // regardless of co-purchase bonus, so a same-group pair is required for the
    // partner to ever reach getRecommendations' output.
    //
    // Must NOT share country with the subject: the twin below nulls out
    // region/country/variety/food_matching to strip every OTHER rule-based
    // signal, so ONLY category_type+price (unavoidable, since the twin spreads
    // the partner's own category_type/price) and the co-purchase bonus can
    // differ between partner and twin. If the real pair happened to share
    // country, the twin's overridden (non-matching) country wouldn't actually
    // null anything — country would keep contributing to the partner's score
    // for a reason OTHER than co-purchase, weakening the proof that the bonus
    // is what separates them. Requiring a country mismatch rules that out.
    outer:
    for (const [base, record] of Object.entries(bi.affinities) as any) {
      const subjectSkus = baseSkuMap.get(base) ?? [];
      for (const sSku of subjectSkus) {
        const p = bySku.get(sSku);
        if (!p || p.is_in_stock !== '1') continue;
        for (const entry of record.co_order_affinities ?? []) {
          const candSkus = baseSkuMap.get(entry.base_product_code) ?? [];
          for (const cSku of candSkus) {
            const cand = bySku.get(cSku);
            if (
              cand &&
              cand.is_in_stock === '1' &&
              cSku !== sSku &&
              p.category_group &&
              cand.category_group &&
              p.category_group === cand.category_group &&
              p.country !== cand.country
            ) {
              subjectProduct = p;
              coOrderPartnerSku = cSku;
              break outer;
            }
          }
        }
      }
    }
    expect(subjectProduct).not.toBeNull();

    // A synthetic "twin" candidate: same category_group as the co-order
    // partner (so it isn't suppressed by cross-category eligibility), but
    // with none of the subject's actual attributes and no BI relationship —
    // it should score 0 on every rule-based signal, so ONLY the co-purchase
    // bonus can separate the two candidates.
    const partner = bySku.get(coOrderPartnerSku) as any;
    const twin = {
      ...partner,
      sku: 'ZZZ9999TWIN',
      name: 'Synthetic twin with no BI relationship',
      region: 'NoSuchRegionXYZ',
      country: 'NoSuchCountryXYZ',
      variety: undefined,
      food_matching: '',
    };

    const pool = [subjectProduct, partner, twin];
    const recs = getRecommendations(subjectProduct, pool);
    const partnerIdx = recs.findIndex((r) => r.sku === coOrderPartnerSku);
    const twinIdx = recs.findIndex((r) => r.sku === 'ZZZ9999TWIN');

    expect(partnerIdx).toBeGreaterThanOrEqual(0);
    // Either the twin scored 0 and was dropped entirely (not in recs), or it
    // ranked below the real co-order partner. Both prove the bonus worked.
    expect(twinIdx === -1 || twinIdx > partnerIdx).toBe(true);
  });
});
