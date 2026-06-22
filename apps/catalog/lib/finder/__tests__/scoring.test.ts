import { describe, it, expect } from 'vitest';
import { scoreProducts, bodyLadderDistance } from '@/lib/finder/scoring';
import type { Answers } from '@/lib/finder/answers';

const P = (o: any) => ({ price: 1500, is_in_stock: true, classification: 'Red Wine', ...o });

describe('bodyLadderDistance (5-level ordinal)', () => {
  it('exact = 0 steps', () => expect(bodyLadderDistance('Full','Full')).toBe(0));
  it('adjacent = 1 step', () => expect(bodyLadderDistance('Full','Medium-Full')).toBe(1));
  it('far = 4 steps', () => expect(bodyLadderDistance('Full','Light')).toBe(4));
  it('unknown value = null (no score)', () => expect(bodyLadderDistance('Full','???')).toBeNull());
});

describe('scoreProducts', () => {
  const ans = (o: Partial<Answers>): Answers => ({ category:'red', ...o } as Answers);

  it('ranks the exact-body match above a far one', () => {
    const pool = [P({sku:'WRWfar', wine_body:'Light'}), P({sku:'WRWexact', wine_body:'Full'})];
    const out = scoreProducts(ans({axis1:'bold'}), pool as any); // bold → Full
    expect(out.products[0].sku).toBe('WRWexact');
  });

  it('a "No preference" (no axis1) contributes 0 → both present, neither boosted by body', () => {
    const pool = [P({sku:'WRWa', wine_body:'Full', price:2000}), P({sku:'WRWb', wine_body:'Light', price:1000})];
    const out = scoreProducts(ans({}), pool as any);
    expect(out.products.map(p=>p.sku)).toContain('WRWa');
  });

  it('minimum-results guarantee: returns ≥4 even when nothing matches deeply, flagged degraded', () => {
    const pool = Array.from({length:6},(_,i)=>P({sku:`WRW${i}`, wine_body:undefined}));
    const res = scoreProducts(ans({axis1:'bold', flavorChips:['oak']}), pool as any);
    expect(res.products.length).toBeGreaterThanOrEqual(4);
    expect(res.degraded).toBe(true); // nothing cleared the quality threshold → honest-label flag
  });

  it('a genuine deep match is NOT degraded', () => {
    // Regression guard: needs ≥4 GENUINELY near-body products. Since the far-body rung
    // was decoupled from QUALITY_MIN (dist≥2 → rung 1 < QUALITY_MIN 2), a distance-4
    // body (Light vs wanted Full) no longer counts as well-matched. The old fixture had
    // only 3 near + 1 Light (=3 well-matched < MIN_RESULTS) which now honestly degrades;
    // WRW2 is Medium-Full so all four are near-body (rungs 4/3/3/4) → 4 well-matched.
    const pool = [P({sku:'WRW1', wine_body:'Full'}), P({sku:'WRW2', wine_body:'Medium-Full'}),
                  P({sku:'WRW3', wine_body:'Medium-Full'}), P({sku:'WRW4', wine_body:'Full'})];
    const res = scoreProducts(ans({axis1:'bold'}), pool as any);
    expect(res.degraded).toBe(false);
  });

  it('never returns duplicates or out-of-stock', () => {
    const pool = [P({sku:'WRW1'}), P({sku:'WRW1'}), P({sku:'WRW9', is_in_stock:false})];
    const res = scoreProducts(ans({}), pool as any);
    expect(new Set(res.products.map(p=>p.sku)).size).toBe(res.products.length);
    expect(res.products.some(p=>p.sku==='WRW9')).toBe(false);
  });

  it('empty pool → not degraded, empty products (never "closest matches" over nothing)', () => {
    const res = scoreProducts(ans({ category:'red', budget:0 }), [] as any);
    expect(res.products).toEqual([]);
    expect(res.degraded).toBe(false);
  });

  it('a pool where every match is far from the wanted body IS degraded', () => {
    // want bold (Full); all candidates Light (distance 4 → rung 1 < QUALITY_MIN 2)
    const pool = Array.from({length:5},(_,i)=>P({sku:`WRWlt${i}`, wine_body:'Light'}));
    const res = scoreProducts(ans({ axis1:'bold' }), pool as any);
    expect(res.products.length).toBeGreaterThanOrEqual(4); // still shown
    expect(res.degraded).toBe(true);                        // but honestly flagged
  });

  it('everyday + low budget gives a small value lean', () => {
    // price 500 keeps it inside budget tier 0 (under ฿1,000) so the prefilter passes it through.
    const pool = [P({sku:'WRWv', wine_body:'Full', price:500})];
    const a1 = scoreProducts(ans({ occasion:'everyday', budget:0 }), pool as any);
    expect(a1.products.map(p=>p.sku)).toContain('WRWv'); // present; rule adds +1, no crash
  });

  // ── TIER-2 origin/style scoring for non-wine categories (regression: these
  // axes used to feed only the archetype text, contributing nothing to ranking). ──
  it('whisky: axis1=scotch ranks a Scotland bottle above a USA bottle', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', ...o });
    const pool = [W({sku:'LWHusa', country:'USA'}), W({sku:'LWHsco', country:'Scotland'})];
    const out = scoreProducts({ category:'whisky', axis1:'scotch' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHsco');
    expect(out.degraded).toBe(false); // +2 origin clears QUALITY_MIN
  });
  it('whisky: axis2=smoky ranks an Islay bottle above a Speyside bottle', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHspey', region:'Speyside'}), W({sku:'LWHislay', region:'Islay'})];
    const out = scoreProducts({ category:'whisky', axis1:'scotch', axis2:'smoky' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHislay');
  });
  it('spirits: axis1=rum ranks a Rum above a Vodka', () => {
    const S = (o:any)=>({ price:1500, is_in_stock:true, ...o });
    const pool = [S({sku:'LVKv', classification:'Vodka'}), S({sku:'LRMr', classification:'Rum'})];
    const out = scoreProducts({ category:'spirits', axis1:'rum' } as any, pool as any);
    expect(out.products[0].sku).toBe('LRMr');
  });

  // ── SAKE sweetness (axis1) — was profile-only (inert); now a real taste-tier ladder
  // term reading taste_profile.axes.sweetness (~26% of sake populated). LSK* prefix →
  // Sake & Asian group so finderPrefilter passes them. ──
  const SK = (sku: string, sweetness?: string, o: any = {}) => ({
    sku, price: 4000, is_in_stock: true,
    taste_profile: sweetness ? { axes: { sweetness: { value: sweetness } } } : undefined,
    ...o,
  });
  it('sake: axis1=sweet ranks a Sweet bottle above a Very Dry one', () => {
    const pool = [SK('LSKdry', 'Very Dry'), SK('LSKsweet', 'Sweet')];
    const out = scoreProducts({ category:'sake', axis1:'sweet' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKsweet');
  });
  it('sake: axis1=dry ranks a Dry bottle above a Sweet one', () => {
    const pool = [SK('LSKsweet', 'Sweet'), SK('LSKdry', 'Dry')];
    const out = scoreProducts({ category:'sake', axis1:'dry' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKdry');
  });
  it('sake: a sweetness match clears the quality gate (not degraded)', () => {
    // Off-dry is adjacent to the Sweet target (ladder rung 3 ≥ QUALITY_MIN) → well-matched.
    const pool = [SK('LSK1','Sweet'), SK('LSK2','Off-dry'), SK('LSK3','Sweet'), SK('LSK4','Off-dry')];
    const out = scoreProducts({ category:'sake', axis1:'sweet' } as any, pool as any);
    expect(out.degraded).toBe(false);
  });
  it('sake: no-sweetness-data products are NEUTRAL (kept, not penalized, not degraded by absence)', () => {
    // 74% of real sake has no sweetness signal. Such a pool must still return matches and
    // must NOT crash; absence scores 0 (degraded only because nothing clears the gate).
    const pool = Array.from({length:5},(_,i)=>SK(`LSKn${i}`)); // no taste_profile
    const out = scoreProducts({ category:'sake', axis1:'sweet' } as any, pool as any);
    expect(out.products.length).toBeGreaterThanOrEqual(4);
    expect(out.products.every(p => p.sku.startsWith('LSKn'))).toBe(true);
  });
  it("sake: axis1='any' imposes no sweetness constraint (no crash, all kept)", () => {
    const pool = [SK('LSKa','Sweet'), SK('LSKb','Dry')];
    const out = scoreProducts({ category:'sake', axis1:'any' } as any, pool as any);
    expect(out.products.length).toBe(2);
  });

  // Honest-label guard: a THIN pool where NOTHING matches what the user asked must be
  // degraded (the old `ranked.length >= 4` gate wrongly hid this — showed confident
  // "Your matches" over poor fits). User wants Scotch; only 2 USA whiskies in budget.
  it('whisky: a thin pool with NO genuine match IS degraded', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'USA', ...o });
    const pool = [W({sku:'LWHu1'}), W({sku:'LWHu2'})];
    const out = scoreProducts({ category:'whisky', axis1:'scotch' } as any, pool as any);
    expect(out.products.length).toBe(2); // still shown (never empty)
    expect(out.degraded).toBe(true);     // but honestly flagged "closest matches"
  });

  // ── DEEP-DIVE sommelier upgrade (acidity/tannin/grape/age/adventurousness).
  // ADDITIVE: these affect SORT ORDER only; the honest-label `degraded` flag stays
  // computed from the v1 taste-tier score ONLY. ──
  it('acidity crisp ranks High-acidity above Soft', () => {
    const pool=[P({sku:'WRWs',wine_acidity:'Medium-Light'}),P({sku:'WRWc',wine_acidity:'High'})];
    expect(scoreProducts(ans({acidity:'crisp'}),pool).products[0].sku).toBe('WRWc');
  });
  it('tannin firm ranks High-tannin above silky', () => {
    const pool=[P({sku:'WRWsi',wine_tannin:'Low'}),P({sku:'WRWf',wine_tannin:'High'})];
    expect(scoreProducts(ans({tannin:'firm'}),pool).products[0].sku).toBe('WRWf');
  });
  it('grape cabernet boosts a Cabernet blend; surprise does not constrain', () => {
    const pool=[P({sku:'WRWo',grape_variety:'Merlot'}),P({sku:'WRWc',grape_variety:'Cabernet Sauvignon, Merlot'})];
    expect(scoreProducts(ans({grape:'cabernet'}),pool).products[0].sku).toBe('WRWc');
  });
  it('age young buckets "Current vintage" as young', () => {
    const pool=[P({sku:'WRWm',vintage:'2005'}),P({sku:'WRWy',vintage:'Current vintage'})];
    expect(scoreProducts(ans({age:'young'}),pool).products[0].sku).toBe('WRWy');
  });
  it('adventurousness discovery boosts a non-famous region over Bordeaux', () => {
    const pool=[P({sku:'WRWf',region:'Bordeaux'}),P({sku:'WRWd',region:'Swartland'})];
    expect(scoreProducts(ans({adventure:'discovery'}),pool).products[0].sku).toBe('WRWd');
  });
  it('whisky: peat heavy ranks an Islay bottle above a Speyside bottle', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHspey', region:'Speyside'}), W({sku:'LWHislay', region:'Islay'})];
    const out = scoreProducts({ category:'whisky', peat:'heavy' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHislay');
  });
  it('whisky: peat none ranks a non-Islay bottle above an Islay bottle', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHislay', region:'Islay'}), W({sku:'LWHspey', region:'Speyside'})];
    const out = scoreProducts({ category:'whisky', peat:'none' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHspey');
  });
  it('a core-only Answers scores identically with the new code (additive)', () => {
    const pool=[P({sku:'WRW1',wine_body:'Full'}),P({sku:'WRW2',wine_body:'Light'})];
    expect(scoreProducts(ans({axis1:'bold'}),pool).products[0].sku).toBe('WRW1');
  });
  it('deep-dive terms do NOT change the degraded flag (computed from taste tiers only)', () => {
    // a pool where taste tiers give 0 well-matched but a deep-dive term would add points
    const pool=[P({sku:'WRWx',wine_body:undefined,region:'Swartland'})];
    const out=scoreProducts(ans({adventure:'discovery'}),pool);
    expect(out.degraded).toBe(true); // adventure bump must not clear the quality gate
  });

  // ── FLAVOR scoring via FLAVOR_FAMILY set-intersection against flavor_tags_canonical.
  // regression: dark-fruit was DEAD (hyphen vs space). Must now score + out-rank a non-match.
  it('dark-fruit chip scores a "Dark Plum" product and ranks it above a non-match', () => {
    const pool=[P({sku:'WRWno', flavor_tags_canonical:['Citrus Zest']}), P({sku:'WRWyes', flavor_tags_canonical:['Black Cherry']})];
    expect(scoreProducts(ans({flavorChips:['dark-fruit']}),pool).products[0].sku).toBe('WRWyes');
  });
  it('mineral chip matches "Minerality"', () => {
    const pool=[P({sku:'WRWx', flavor_tags_canonical:['Oak']}), P({sku:'WRWm', flavor_tags_canonical:['Minerality']})];
    expect(scoreProducts(ans({flavorChips:['mineral']}),pool).products[0].sku).toBe('WRWm');
  });
  it('flavor scoring reads flavor_tags_canonical, NOT flavor_tags', () => {
    const pool=[P({sku:'WRWc', flavor_tags:['nope'], flavor_tags_canonical:['Oak']})];
    expect(scoreProducts(ans({flavorChips:['oak']}),pool).products.length).toBe(1);
  });
  it('core-only run (no flavorChips) scores identically (additive)', () => {
    const pool=[P({sku:'WRW1', wine_body:'Full'}), P({sku:'WRW2', wine_body:'Light'})];
    expect(scoreProducts(ans({axis1:'bold'}),pool).products[0].sku).toBe('WRW1');
  });
});
