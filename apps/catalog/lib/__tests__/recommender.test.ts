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
  const rose = { ...base, sku: 'ROSE', category_group: 'Wine', category_type: 'Rosé Wine', is_in_stock: true };
  const white = { ...base, sku: 'WHITE', category_group: 'Wine', category_type: 'White Wine', is_in_stock: true };
  const sparkling = { ...base, sku: 'SPARK', category_group: 'Wine', category_type: 'Sparkling & Champagne', is_in_stock: true };
  const wineSet = { ...base, sku: 'WSET', category_group: 'Wine', category_type: 'Wine Set', is_in_stock: true };

  it('Wine subject never returns Whisky candidate', () => {
    const recs = getRecommendations(wine, [wine, whisky, rose]);
    expect(recs.find(r => r.sku === 'WHISK')).toBeUndefined();
  });
  it('Gin subject returns same-group Vodka candidate', () => {
    const recs = getRecommendations(gin, [gin, vodka, wine]);
    expect(recs.find(r => r.sku === 'VODKA')).toBeDefined();
  });
  it('Gin subject never returns Wine candidate', () => {
    const recs = getRecommendations(gin, [gin, vodka, wine]);
    expect(recs.find(r => r.sku === 'WINE')).toBeUndefined();
  });

  // REGRESSION (bug found 2026-07-22): "you might also like" only suppressed
  // cross-category_group (Wine<->Spirits) but treated wine COLOR/style as a
  // soft +1 score nudge, not a gate. Proven against the live catalog: 92/2,439
  // in-stock Red Wines had >=1 non-red Wine-group item in their rail (e.g. a
  // Penfolds Pinot Noir recommending a Grosset Riesling) whenever region/
  // country/price/food/body/acidity/tannin signals outweighed the +1. Mirrors
  // finderPrefilter's CATEGORY_MAP (lib/finder/category-map.ts), which already
  // hard-gates these same 4 canonical types for the Finder. This test used to
  // assert the OPPOSITE (a red wine subject returning a rosé candidate) — that
  // was pinning the bug, not the desired behavior (CLAUDE.md Rule 5).
  it('Red Wine subject never returns Rosé/White/Sparkling candidates', () => {
    const recs = getRecommendations(wine, [wine, rose, white, sparkling]);
    expect(recs.find(r => r.sku === 'ROSE')).toBeUndefined();
    expect(recs.find(r => r.sku === 'WHITE')).toBeUndefined();
    expect(recs.find(r => r.sku === 'SPARK')).toBeUndefined();
  });
  it('Rosé subject never returns Red Wine candidate', () => {
    const recs = getRecommendations(rose, [rose, wine]);
    expect(recs.find(r => r.sku === 'WINE')).toBeUndefined();
  });
  it('non-color wine type (Wine Set) is not suppressed by the color gate', () => {
    // Niche types outside the 4 canonical colors stay permissive — not enough
    // catalog depth to justify their own strict bucket (would starve the rail).
    const recs = getRecommendations(wine, [wine, wineSet]);
    expect(recs.find(r => r.sku === 'WSET')).toBeDefined();
  });

  // REGRESSION (bug found 2026-07-22, whisky smokiness audit): peat_level (the
  // intended dominant +3 whisky signal) is 0% populated in the live catalog, so
  // whisky peat/smoke matching fell entirely to the generic smokiness +0.5
  // within-1-band nudge — proven to leak in 17/17 (100%) heavy-smokiness whisky
  // subjects, e.g. Laphroaig 10 Years (LWH0024AA, heavy) recommending Old
  // Pulteney 18 Year (LWH0473ES, none), and Bowmore 15 Years (heavy)
  // recommending Bruichladdich "Unpeated" Islay Single Malt (none). isEligible()
  // now hard-gates the heavy<->none/light smokiness EXTREMES within Whisky,
  // mirroring the WINE_COLOR_TYPES gate. Only the extremes are gated — mild/
  // medium stays a soft nudge, since only the extremes were proven to be a
  // genuine mismatch.
  const whiskyHeavy = { ...base, sku: 'WHISK-HEAVY', category_group: 'Whisky', category_type: 'Whisky', smokiness: 'heavy', is_in_stock: true };
  const whiskyNone = { ...base, sku: 'WHISK-NONE', category_group: 'Whisky', category_type: 'Whisky', smokiness: 'none', is_in_stock: true };
  const whiskyLight = { ...base, sku: 'WHISK-LIGHT', category_group: 'Whisky', category_type: 'Whisky', smokiness: 'light', is_in_stock: true };
  const whiskyMedium = { ...base, sku: 'WHISK-MEDIUM', category_group: 'Whisky', category_type: 'Whisky', smokiness: 'medium', is_in_stock: true };

  it('heavy-smokiness Whisky subject never returns a none/light-smokiness candidate', () => {
    const recs = getRecommendations(whiskyHeavy, [whiskyHeavy, whiskyNone, whiskyLight]);
    expect(recs.find(r => r.sku === 'WHISK-NONE')).toBeUndefined();
    expect(recs.find(r => r.sku === 'WHISK-LIGHT')).toBeUndefined();
  });
  it('none/light-smokiness Whisky subject never returns a heavy-smokiness candidate', () => {
    const recs = getRecommendations(whiskyNone, [whiskyNone, whiskyHeavy]);
    expect(recs.find(r => r.sku === 'WHISK-HEAVY')).toBeUndefined();
  });
  it('medium-smokiness Whisky subject STILL CAN return a light-smokiness candidate (only extremes gated)', () => {
    const recs = getRecommendations(whiskyMedium, [whiskyMedium, whiskyLight]);
    expect(recs.find(r => r.sku === 'WHISK-LIGHT')).toBeDefined();
  });

  // REGRESSION (bug found 2026-07-22, wine sweetness audit): sweetness is
  // severely underpopulated for Red Wine (0.2%) and Rosé Wine (0%) but
  // reasonably well-populated for White Wine (65.4%). Where data exists (White
  // Wine), the generic +0.5 within-1-band sweetness signal proved too weak to
  // stop a dry<->sweet leak: 12/467 (2.6%) in-stock Dry White Wine subjects
  // had >=1 Sweet White Wine candidate leak into their rail, e.g.
  // WWW2006AB Nik Weis Urban Riesling (Dry) recommending WWW5371AB Nollen
  // Erben Mosel Riesling Spätlese (Sweet). WWW1974DJ Chateau Reynon Blanc
  // Cadillac (a sweet Bordeaux dessert wine) was a repeat offender in 6/12
  // leaked slots. isEligible() now hard-gates sweetness EXTREMES (2+ bands
  // apart on SWEETNESS_BANDS) within White Wine specifically — Red/Rosé Wine
  // are a pure data-coverage gap and are intentionally NOT gated (no data to
  // gate on).
  const whiteDry = { ...base, sku: 'WHITE-DRY', category_group: 'Wine', category_type: 'White Wine', sweetness: 'Dry', is_in_stock: true };
  const whiteOffDry = { ...base, sku: 'WHITE-OFFDRY', category_group: 'Wine', category_type: 'White Wine', sweetness: 'Off-Dry', is_in_stock: true };
  const whiteMediumSweet = { ...base, sku: 'WHITE-MEDSWEET', category_group: 'Wine', category_type: 'White Wine', sweetness: 'Medium-Sweet', is_in_stock: true };
  const whiteSweet = { ...base, sku: 'WHITE-SWEET', category_group: 'Wine', category_type: 'White Wine', sweetness: 'Sweet', is_in_stock: true };
  const redDry = { ...base, sku: 'RED-DRY', category_group: 'Wine', category_type: 'Red Wine', sweetness: 'Dry', is_in_stock: true };
  const redSweet = { ...base, sku: 'RED-SWEET', category_group: 'Wine', category_type: 'Red Wine', sweetness: 'Sweet', is_in_stock: true };

  it('Dry White Wine subject never returns a Sweet White Wine candidate', () => {
    const recs = getRecommendations(whiteDry, [whiteDry, whiteSweet]);
    expect(recs.find(r => r.sku === 'WHITE-SWEET')).toBeUndefined();
  });
  it('Sweet White Wine subject never returns a Dry White Wine candidate', () => {
    const recs = getRecommendations(whiteSweet, [whiteSweet, whiteDry]);
    expect(recs.find(r => r.sku === 'WHITE-DRY')).toBeUndefined();
  });
  it('Dry White Wine subject never returns a Medium-Sweet White Wine candidate (2 bands apart)', () => {
    const recs = getRecommendations(whiteDry, [whiteDry, whiteMediumSweet]);
    expect(recs.find(r => r.sku === 'WHITE-MEDSWEET')).toBeUndefined();
  });
  it('Off-Dry White Wine subject never returns a Sweet White Wine candidate (2 bands apart)', () => {
    const recs = getRecommendations(whiteOffDry, [whiteOffDry, whiteSweet]);
    expect(recs.find(r => r.sku === 'WHITE-SWEET')).toBeUndefined();
  });
  it('Dry White Wine subject STILL CAN return an Off-Dry White Wine candidate (only extremes gated)', () => {
    const recs = getRecommendations(whiteDry, [whiteDry, whiteOffDry]);
    expect(recs.find(r => r.sku === 'WHITE-OFFDRY')).toBeDefined();
  });
  it('Dry Red Wine subject STILL CAN return a Sweet Red Wine candidate (gate scoped to White Wine only — no data to gate on for Red)', () => {
    const recs = getRecommendations(redDry, [redDry, redSweet]);
    expect(recs.find(r => r.sku === 'RED-SWEET')).toBeDefined();
  });

  // REGRESSION (bug found 2026-07-22, Sake & Asian audit, Gap 1): Sake & Asian
  // has no category-scorer.ts override, so its 4 real category_type values
  // (Sake / Shochu, Umeshu, Shochu, Makgeolli) mixed freely on shared region/
  // country/price/food signal alone. Proven: 145/419 (34.6%) in-stock Sake &
  // Asian subjects had a cross-category_type candidate leak into their rail,
  // e.g. a dry Sake/Shochu product recommending a sweet Umeshu plum liqueur
  // (~10-15% ABV) — a substitute-confusion mismatch, same class as red<->white
  // wine. isEligible() now hard-gates cross-category_type WITHIN Sake & Asian,
  // mirroring the WINE_COLOR_TYPES gate.
  const sakeShochu1 = { ...base, sku: 'SAKE-1', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', is_in_stock: true };
  const sakeShochu2 = { ...base, sku: 'SAKE-2', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', is_in_stock: true };
  const umeshu = { ...base, sku: 'UMESHU-1', category_group: 'Sake & Asian', category_type: 'Umeshu', is_in_stock: true };
  const shochuType = { ...base, sku: 'SHOCHU-1', category_group: 'Sake & Asian', category_type: 'Shochu', is_in_stock: true };
  const makgeolli = { ...base, sku: 'MAKGEOLLI-1', category_group: 'Sake & Asian', category_type: 'Makgeolli', is_in_stock: true };

  it('Sake / Shochu subject never returns an Umeshu, Shochu, or Makgeolli candidate', () => {
    const recs = getRecommendations(sakeShochu1, [sakeShochu1, umeshu, shochuType, makgeolli]);
    expect(recs.find(r => r.sku === 'UMESHU-1')).toBeUndefined();
    expect(recs.find(r => r.sku === 'SHOCHU-1')).toBeUndefined();
    expect(recs.find(r => r.sku === 'MAKGEOLLI-1')).toBeUndefined();
  });
  it('Umeshu subject never returns a Sake / Shochu candidate', () => {
    const recs = getRecommendations(umeshu, [umeshu, sakeShochu1]);
    expect(recs.find(r => r.sku === 'SAKE-1')).toBeUndefined();
  });
  it('same category_type (Sake / Shochu <-> Sake / Shochu) is NOT blocked by the gate', () => {
    const recs = getRecommendations(sakeShochu1, [sakeShochu1, sakeShochu2]);
    expect(recs.find(r => r.sku === 'SAKE-2')).toBeDefined();
  });

  // REGRESSION (bug found 2026-07-22, Sake & Asian audit, Gap 2): sake brewing
  // class (Junmai = pure rice/koji, vs non-Junmai Daiginjo/Ginjo = added
  // distilled alcohol) is only readable from the structured `variety` field
  // (NEVER free-text `name` matching — see CLAUDE.md Rule 12 convention).
  // smokiness, the only generic Sake & Asian signal, is 0% populated, so
  // there's no working disambiguation. Proven: 8/39 (20.5%) in-stock
  // Junmai-variety subjects had a non-Junmai Daiginjo/Ginjo candidate leak
  // into their rail, e.g. LSK0119AB Dassai Junmai Daiginjou (variety="Junmai
  // Daiginjo") recommending LSK0008AR Kamotsuru Tokusei Gold Daiginjo
  // (variety="Daiginjo", no "Junmai") — a different brewing style. isEligible()
  // now hard-gates Junmai-class (variety matches /junmai/i, case-insensitive)
  // vs non-Junmai WITHIN Sake & Asian, only when variety is populated on BOTH
  // sides (never excludes on missing data, mirroring the other 3 gates).
  const junmaiDaiginjo = { ...base, sku: 'JUNMAI-DAIGINJO', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', variety: 'Junmai Daiginjo', is_in_stock: true };
  const daiginjoOnly = { ...base, sku: 'DAIGINJO-ONLY', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', variety: 'Daiginjo', is_in_stock: true };
  const junmaiPlain = { ...base, sku: 'JUNMAI-PLAIN', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', variety: 'Junmai', is_in_stock: true };
  const junmaiGinjo = { ...base, sku: 'JUNMAI-GINJO', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', variety: 'Junmai Ginjo', is_in_stock: true };
  const noVarietySake = { ...base, sku: 'NO-VARIETY-SAKE', category_group: 'Sake & Asian', category_type: 'Sake / Shochu', variety: undefined, is_in_stock: true };

  it('Junmai Daiginjo subject never returns a plain Daiginjo (non-Junmai) candidate', () => {
    const recs = getRecommendations(junmaiDaiginjo, [junmaiDaiginjo, daiginjoOnly]);
    expect(recs.find(r => r.sku === 'DAIGINJO-ONLY')).toBeUndefined();
  });
  it('plain Daiginjo (non-Junmai) subject never returns a Junmai Daiginjo candidate', () => {
    const recs = getRecommendations(daiginjoOnly, [daiginjoOnly, junmaiDaiginjo]);
    expect(recs.find(r => r.sku === 'JUNMAI-DAIGINJO')).toBeUndefined();
  });
  it('Junmai subject STILL CAN return a Junmai Ginjo candidate (both Junmai-class, not gated against each other)', () => {
    const recs = getRecommendations(junmaiPlain, [junmaiPlain, junmaiGinjo]);
    expect(recs.find(r => r.sku === 'JUNMAI-GINJO')).toBeDefined();
  });
  it('gate does not fire when the candidate has no variety populated (falls through, does not exclude on missing data)', () => {
    const recs = getRecommendations(junmaiDaiginjo, [junmaiDaiginjo, noVarietySake]);
    expect(recs.find(r => r.sku === 'NO-VARIETY-SAKE')).toBeDefined();
  });
  it('gate does not fire when the subject has no variety populated (falls through, does not exclude on missing data)', () => {
    const recs = getRecommendations(noVarietySake, [noVarietySake, daiginjoOnly]);
    expect(recs.find(r => r.sku === 'DAIGINJO-ONLY')).toBeDefined();
  });

  // REGRESSION (bug found 2026-07-22, Beer & RTD audit): Beer & RTD has no
  // category-scorer.ts override and no generic disambiguating signal, so its
  // 2 real category_type values (Beer, Ready-to-Drink pre-mixed cocktails)
  // mixed freely on shared region/country/price/food signal alone. Proven:
  // 8/16 (50%) in-stock Beer & RTD subjects had a cross-category_type
  // candidate leak into their rail — 100% systematic (every Beer subject
  // recommended all 5 RTD products and vice versa, given the tiny 3-vs-5
  // pool at the time of the audit), e.g. LBE0995CH Moose Indie Summer Cider
  // (Beer) recommending LRD0016DG Signature Cocktail The Lychee Martini,
  // LRD0017DG Sunset Aperitivo, LRD0018DG Raspberry Espresso Martini,
  // LRD0019DG Rose & White Pepper Negroni, and LRD0020DG Coconut & Pineapple
  // Daiquiri (all Ready-to-Drink) — cider and pre-mixed cocktails are not
  // substitutes a shopper would consider interchangeable. isEligible() now
  // hard-gates cross-category_type WITHIN Beer & RTD, mirroring the
  // SAKE_ASIAN_TYPES gate (same "N mutually exclusive category_type values
  // within one group" pattern, here N=2).
  const beer1 = { ...base, sku: 'BEER-1', category_group: 'Beer & RTD', category_type: 'Beer', is_in_stock: true };
  const beer2 = { ...base, sku: 'BEER-2', category_group: 'Beer & RTD', category_type: 'Beer', is_in_stock: true };
  const rtd1 = { ...base, sku: 'RTD-1', category_group: 'Beer & RTD', category_type: 'Ready-to-Drink', is_in_stock: true };
  const rtd2 = { ...base, sku: 'RTD-2', category_group: 'Beer & RTD', category_type: 'Ready-to-Drink', is_in_stock: true };

  it('Beer subject never returns a Ready-to-Drink candidate', () => {
    const recs = getRecommendations(beer1, [beer1, rtd1, rtd2]);
    expect(recs.find(r => r.sku === 'RTD-1')).toBeUndefined();
    expect(recs.find(r => r.sku === 'RTD-2')).toBeUndefined();
  });
  it('Ready-to-Drink subject never returns a Beer candidate', () => {
    const recs = getRecommendations(rtd1, [rtd1, beer1, beer2]);
    expect(recs.find(r => r.sku === 'BEER-1')).toBeUndefined();
    expect(recs.find(r => r.sku === 'BEER-2')).toBeUndefined();
  });
  it('same category_type (Beer <-> Beer) is NOT blocked by the gate', () => {
    const recs = getRecommendations(beer1, [beer1, beer2]);
    expect(recs.find(r => r.sku === 'BEER-2')).toBeDefined();
  });
  it('same category_type (Ready-to-Drink <-> Ready-to-Drink) is NOT blocked by the gate', () => {
    const recs = getRecommendations(rtd1, [rtd1, rtd2]);
    expect(recs.find(r => r.sku === 'RTD-2')).toBeDefined();
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

// END-TO-END INVARIANT (CLAUDE.md Rule 6): if a shopper is looking at a Red
// Wine, "you might also like" must never contain a White/Rosé/Sparkling &
// Champagne wine. Bug found 2026-07-22 (team report: finder cat=red flow led
// to non-red results on the product page rail, not the finder grid itself —
// see the 'cross-category suppression' describe block above for the unit-level
// fix). Run against the REAL catalog, not fixtures, since the leak only showed
// up at real-data scale (region/country/price signals winning over the old +1
// category_type nudge).
describe('wine color purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock Red Wine has a White/Rosé/Sparkling & Champagne product in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const redSkus = normalized.filter((p) => p.category_type === 'Red Wine' && p.is_in_stock);
    expect(redSkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const OTHER_WINE_COLORS = new Set(['White Wine', 'Rosé Wine', 'Sparkling & Champagne']);
    const leaks: string[] = [];

    for (const subject of redSkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        if (cand && OTHER_WINE_COLORS.has(cand.category_type)) {
          leaks.push(`${subject.sku} (Red Wine) -> ${r.sku} (${cand.category_type})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

// END-TO-END INVARIANT (CLAUDE.md Rule 6): peat_level is 0% populated in the
// live catalog, so whisky peat/smoke matching falls entirely to the generic
// smokiness +0.5 nudge. Proven: 17/17 (100%) in-stock heavy-smokiness whisky
// subjects had >=1 none/light-smokiness candidate leak into their rail (e.g.
// LWH0024AA Laphroaig 10 Years -> LWH0473ES Old Pulteney 18 Year). This test
// pins that leak count at 0 post-fix. Run against the REAL catalog, not
// fixtures, since the leak only showed up at real-data scale.
describe('whisky smokiness purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock heavy-smokiness Whisky has a none/light-smokiness candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const heavySkus = normalized.filter(
      (p) => p.category_group === 'Whisky' &&
        typeof p.smokiness === 'string' &&
        p.smokiness.toLowerCase() === 'heavy' &&
        p.is_in_stock
    );
    expect(heavySkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const NONE_OR_LIGHT = new Set(['none', 'light']);
    const leaks: string[] = [];

    for (const subject of heavySkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        const candSmoke = typeof cand?.smokiness === 'string' ? cand.smokiness.toLowerCase() : '';
        if (cand && cand.category_group === 'Whisky' && NONE_OR_LIGHT.has(candSmoke)) {
          leaks.push(`${subject.sku} (heavy) -> ${r.sku} (${cand.smokiness})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

// END-TO-END INVARIANT (CLAUDE.md Rule 6): sweetness is severely underpopulated
// for Red Wine (0.2%) and Rosé Wine (0%) — a pure data-coverage gap, NOT fixed
// here — but reasonably well-populated for White Wine (65.4%), where the
// generic +0.5 within-1-band nudge proved too weak. Proven: 12/467 (2.6%)
// in-stock Dry White Wine subjects had >=1 Sweet White Wine candidate leak
// into their rail (e.g. WWW2006AB Nik Weis Urban Riesling -> WWW5371AB Nollen
// Erben Mosel Riesling Spätlese). This test pins that leak count at 0 post-fix.
// Run against the REAL catalog, not fixtures, since the leak only showed up at
// real-data scale.
describe('White Wine sweetness purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock Dry White Wine has a Sweet White Wine candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const drySkus = normalized.filter(
      (p) => p.category_type === 'White Wine' &&
        typeof p.sweetness === 'string' &&
        p.sweetness.toLowerCase() === 'dry' &&
        p.is_in_stock
    );
    expect(drySkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const leaks: string[] = [];

    for (const subject of drySkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        const candSweet = typeof cand?.sweetness === 'string' ? cand.sweetness.toLowerCase() : '';
        if (cand && cand.category_type === 'White Wine' && candSweet === 'sweet') {
          leaks.push(`${subject.sku} (Dry) -> ${r.sku} (${cand.sweetness})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

// END-TO-END INVARIANT (CLAUDE.md Rule 6): Sake & Asian has no
// category-scorer.ts override, so its 4 real category_type values mixed
// freely on shared region/country/price/food signal alone. Proven: 145/419
// (34.6%) in-stock Sake & Asian subjects had a cross-category_type candidate
// leak into their rail (e.g. dry Sake/Shochu recommending sweet Umeshu plum
// liqueur). This test pins that leak count at 0 post-fix. Run against the
// REAL catalog, not fixtures, since the leak only showed up at real-data
// scale.
describe('Sake & Asian category_type purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock Sake & Asian product has a cross-category_type candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const sakeAsianSkus = normalized.filter(
      (p) => p.category_group === 'Sake & Asian' && p.is_in_stock
    );
    expect(sakeAsianSkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const leaks: string[] = [];

    for (const subject of sakeAsianSkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        if (
          cand &&
          cand.category_group === 'Sake & Asian' &&
          cand.category_type !== subject.category_type
        ) {
          leaks.push(`${subject.sku} (${subject.category_type}) -> ${r.sku} (${cand.category_type})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

// END-TO-END INVARIANT (CLAUDE.md Rule 6): sake brewing class (Junmai vs
// non-Junmai Daiginjo/Ginjo) is only readable from the structured `variety`
// field, and smokiness (Sake & Asian's only generic taste signal) is 0%
// populated for this group, so there was no working disambiguation. Proven:
// 8/39 (20.5%) in-stock Junmai-variety subjects had a non-Junmai Daiginjo/
// Ginjo candidate leak into their rail (e.g. LSK0119AB Dassai Junmai
// Daiginjou -> LSK0008AR Kamotsuru Tokusei Gold Daiginjo). This test pins
// that leak count at 0 post-fix. Run against the REAL catalog, not fixtures,
// since the leak only showed up at real-data scale.
describe('Sake & Asian Junmai purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock Junmai-variety Sake & Asian product has a non-Junmai-variety candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const isJunmai = (v: any) => typeof v === 'string' && /junmai/i.test(v);
    const junmaiSkus = normalized.filter(
      (p) => p.category_group === 'Sake & Asian' && isJunmai(p.variety) && p.is_in_stock
    );
    expect(junmaiSkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const leaks: string[] = [];

    for (const subject of junmaiSkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        if (
          cand &&
          cand.category_group === 'Sake & Asian' &&
          typeof cand.variety === 'string' && cand.variety.trim() !== '' &&
          !isJunmai(cand.variety)
        ) {
          leaks.push(`${subject.sku} (${subject.variety}) -> ${r.sku} (${cand.variety})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});

// END-TO-END INVARIANT (CLAUDE.md Rule 6): Beer & RTD has no
// category-scorer.ts override and no generic disambiguating signal, so its 2
// real category_type values (Beer, Ready-to-Drink) mixed freely on shared
// region/country/price/food signal alone. Proven: 8/16 (50%) in-stock Beer &
// RTD subjects had a cross-category_type candidate leak into their rail
// (100% systematic given the tiny pool — e.g. LBE0995CH Moose Indie Summer
// Cider recommending all 5 Ready-to-Drink cocktails). This test pins that
// leak count at 0 post-fix. Run against the REAL catalog, not fixtures,
// since the leak only showed up at real-data scale.
describe('Beer & RTD category_type purity (real catalog, end-to-end invariant)', () => {
  it('no in-stock Beer & RTD product has a cross-category_type candidate in its precomputed "you might also like" rail', () => {
    const exportPathFile = findRealFile('data/live_products_export.json');
    const liveRaw = JSON.parse(fs.readFileSync(exportPathFile!, 'utf8'));
    const liveRows: any[] = Array.isArray(liveRaw) ? liveRaw : (liveRaw.products ?? []);

    // precomputeRecommendations expects is_in_stock pre-normalized to a real
    // boolean (post toPublicProduct load), unlike the raw export's "0"/"1"/null.
    const isInStockRaw = (v: any) => v === 1 || v === '1' || v === true;
    const normalized = liveRows.map((p) => ({ ...p, is_in_stock: isInStockRaw(p.is_in_stock) }));

    const bySku = new Map(normalized.map((p) => [p.sku, p]));
    const beerRtdSkus = normalized.filter(
      (p) => p.category_group === 'Beer & RTD' && p.is_in_stock
    );
    expect(beerRtdSkus.length).toBeGreaterThan(0); // sanity: fixture drift guard

    // Same bucketed path the real build uses (gen-recs-cache.mjs) — fast AND
    // representative of what actually ships, rather than a naive full-pool
    // scan per subject.
    const precomputed = precomputeRecommendations(normalized as any);

    const leaks: string[] = [];

    for (const subject of beerRtdSkus) {
      const recs = precomputed.get(subject.sku) ?? [];
      for (const r of recs) {
        const cand = bySku.get(r.sku);
        if (
          cand &&
          cand.category_group === 'Beer & RTD' &&
          cand.category_type !== subject.category_type
        ) {
          leaks.push(`${subject.sku} (${subject.category_type}) -> ${r.sku} (${cand.category_type})`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});
