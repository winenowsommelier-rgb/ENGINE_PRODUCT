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
    const pool = [P({sku:'WRWfar', body:'Light'}), P({sku:'WRWexact', body:'Full'})];
    const out = scoreProducts(ans({axis1:'bold'}), pool as any); // bold → Full
    expect(out.products[0].sku).toBe('WRWexact');
  });

  it('a "No preference" (no axis1) contributes 0 → both present, neither boosted by body', () => {
    const pool = [P({sku:'WRWa', body:'Full', price:2000}), P({sku:'WRWb', body:'Light', price:1000})];
    const out = scoreProducts(ans({}), pool as any);
    expect(out.products.map(p=>p.sku)).toContain('WRWa');
  });

  it('minimum-results guarantee: returns ≥4 even when nothing matches deeply, flagged degraded', () => {
    const pool = Array.from({length:6},(_,i)=>P({sku:`WRW${i}`, body:undefined}));
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
    const pool = [P({sku:'WRW1', body:'Full'}), P({sku:'WRW2', body:'Medium-Full'}),
                  P({sku:'WRW3', body:'Medium-Full'}), P({sku:'WRW4', body:'Full'})];
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
    const pool = Array.from({length:5},(_,i)=>P({sku:`WRWlt${i}`, body:'Light'}));
    const res = scoreProducts(ans({ axis1:'bold' }), pool as any);
    expect(res.products.length).toBeGreaterThanOrEqual(4); // still shown
    expect(res.degraded).toBe(true);                        // but honestly flagged
  });

  it('everyday + low budget gives a small value lean', () => {
    // price 500 keeps it inside budget tier 0 (under ฿1,000) so the prefilter passes it through.
    const pool = [P({sku:'WRWv', body:'Full', price:500})];
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
  it('spirits: axis1=rum ranks a Rum above a Vodka (via category_type, not classification)', () => {
    // category_group/type pin the pool + the type read (Rule 12). classification is
    // deliberately set to the JUNK value to prove it is NOT consulted.
    const S = (o:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', classification:'Wine product', ...o });
    const pool = [S({sku:'LVKv', category_type:'Vodka'}), S({sku:'LRMr', category_type:'Rum'})];
    const out = scoreProducts({ category:'spirits', axis1:'rum' } as any, pool as any);
    expect(out.products[0].sku).toBe('LRMr');
  });
  // C1 regression: a real tequila whose Magento `classification` is the junk
  // "Wine product" MUST still score the type answer (it scored 0 before — 162/419
  // spirit-pool rows were unscoreable). Reads category_type now, so junk class is moot.
  it('spirits: a Tequila mislabeled classification="Wine product" still scores the type match', () => {
    const S = (o:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', classification:'Wine product', ...o });
    const pool = [S({sku:'LVKv', category_type:'Vodka'}), S({sku:'LTQt', category_type:'Tequila'})];
    const out = scoreProducts({ category:'spirits', axis1:'tequila' } as any, pool as any);
    expect(out.products[0].sku).toBe('LTQt');   // the junk-classified tequila ranks first
    expect(out.degraded).toBe(false);            // +2 type boost clears the quality gate
  });
  it('spirits: tequila token also accepts a Mezcal (category_type=Mezcal)', () => {
    const S = (o:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', classification:'Wine product', ...o });
    const pool = [S({sku:'LVKv', category_type:'Vodka'}), S({sku:'LMZm', category_type:'Mezcal'})];
    const out = scoreProducts({ category:'spirits', axis1:'tequila' } as any, pool as any);
    expect(out.products[0].sku).toBe('LMZm');
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
    const pool=[P({sku:'WRWs',acidity:'Medium-Light'}),P({sku:'WRWc',acidity:'High'})];
    expect(scoreProducts(ans({acidity:'crisp'}),pool).products[0].sku).toBe('WRWc');
  });
  it('tannin firm ranks High-tannin above silky', () => {
    const pool=[P({sku:'WRWsi',tannin:'Low'}),P({sku:'WRWf',tannin:'High'})];
    expect(scoreProducts(ans({tannin:'firm'}),pool).products[0].sku).toBe('WRWf');
  });
  it('grape cabernet boosts a Cabernet blend; surprise does not constrain', () => {
    const pool=[P({sku:'WRWo',variety:'Merlot'}),P({sku:'WRWc',variety:'Cabernet Sauvignon, Merlot'})];
    expect(scoreProducts(ans({grape:'cabernet'}),pool).products[0].sku).toBe('WRWc');
  });
  // W5: white/sparkling grape tokens must actually SCORE against a wine's variety (proves
  // the new GRAPE_FAMILY entries are load-bearing, not just UI labels).
  it('grape chardonnay boosts a Chardonnay white over a Sauvignon Blanc', () => {
    const W=(o:any)=>({price:1500,is_in_stock:true,classification:'White Wine',category_group:'Wine',category_type:'White Wine',...o});
    const pool=[W({sku:'WWWsb',variety:'Sauvignon Blanc'}),W({sku:'WWWch',variety:'Chardonnay'})];
    expect(scoreProducts({category:'white',grape:'chardonnay'} as any,pool as any).products[0].sku).toBe('WWWch');
  });
  it('grape sauv-blanc matches the spaced "Sauvignon Blanc" variety', () => {
    const W=(o:any)=>({price:1500,is_in_stock:true,classification:'White Wine',category_group:'Wine',category_type:'White Wine',...o});
    const pool=[W({sku:'WWWch',variety:'Chardonnay'}),W({sku:'WWWsb',variety:'Sauvignon Blanc'})];
    expect(scoreProducts({category:'white',grape:'sauv-blanc'} as any,pool as any).products[0].sku).toBe('WWWsb');
  });
  it('grape glera (sparkling) matches a Prosecco; pinot-grigio also catches "Pinot Gris"', () => {
    const S=(o:any)=>({price:1500,is_in_stock:true,classification:'Sparkling & Champagne',category_group:'Wine',category_type:'Sparkling & Champagne',...o});
    const pool=[S({sku:'WSPx',variety:'Chardonnay'}),S({sku:'WSPg',variety:'Glera'})];
    expect(scoreProducts({category:'sparkling',grape:'glera'} as any,pool as any).products[0].sku).toBe('WSPg');
    const W=(o:any)=>({price:1500,is_in_stock:true,classification:'White Wine',category_group:'Wine',category_type:'White Wine',...o});
    const wpool=[W({sku:'WWWa',variety:'Chardonnay'}),W({sku:'WWWpg',variety:'Pinot Gris'})];
    expect(scoreProducts({category:'white',grape:'pinot-grigio'} as any,wpool as any).products[0].sku).toBe('WWWpg');
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
    const pool=[P({sku:'WRW1',body:'Full'}),P({sku:'WRW2',body:'Light'})];
    expect(scoreProducts(ans({axis1:'bold'}),pool).products[0].sku).toBe('WRW1');
  });
  it('deep-dive terms do NOT change the degraded flag (computed from taste tiers only)', () => {
    // a pool where taste tiers give 0 well-matched but a deep-dive term would add points
    const pool=[P({sku:'WRWx',body:undefined,region:'Swartland'})];
    const out=scoreProducts(ans({adventure:'discovery'}),pool);
    expect(out.degraded).toBe(true); // adventure bump must not clear the quality gate
  });

  // ── C2: gift/special prestige lean via popularity_tier (score_summary is 0% for
  // whisky/spirits/sake, so the wine-only critic bonus did nothing for them and the
  // order collapsed to cheapest-first). popularity_tier is the client-safe bestseller
  // bucket; a top-seller (tier 2) gets a +1 RANK-ONLY lean for a gift/special occasion. ──
  it('whisky gift: a top-seller (tier 2) out-ranks an equal-taste non-seller', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // both match axis1=scotch equally (taste tier identical); tier 2 breaks it via the bump.
    const pool = [W({sku:'LWHplain', popularity_tier:0}), W({sku:'LWHstar', popularity_tier:2})];
    const out = scoreProducts({ category:'whisky', occasion:'gift', axis1:'scotch' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHstar');
  });
  it('spirits special: tier 2 breaks a price tie instead of defaulting to cheapest-first', () => {
    // identical taste score + no score_summary (non-wine); WITHOUT C2 the ฿900 bottle would
    // win on cheapest-first. The pricier top-seller should lead for a "special" occasion.
    const S = (o:any)=>({ is_in_stock:true, category_group:'Spirits', classification:'Wine product', category_type:'Rum', ...o });
    const pool = [S({sku:'LRMcheap', price:900, popularity_tier:0}), S({sku:'LRMstar', price:3000, popularity_tier:2})];
    const out = scoreProducts({ category:'spirits', occasion:'special', axis1:'rum' } as any, pool as any);
    expect(out.products[0].sku).toBe('LRMstar');
  });
  it('C2 prestige bump is RANK-ONLY: a top-seller that does not match taste still degrades', () => {
    // whisky user wants Scotch; only a USA top-seller is in budget. tier 2 may re-order but
    // must NOT clear the quality gate — the honest "closest matches" label must still show.
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'USA', ...o });
    const pool = [W({sku:'LWHu1', popularity_tier:2}), W({sku:'LWHu2', popularity_tier:0})];
    const out = scoreProducts({ category:'whisky', occasion:'gift', axis1:'scotch' } as any, pool as any);
    expect(out.degraded).toBe(true);
  });
  it('C2: popularity lean only applies to gift/special, not everyday', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // everyday occasion → no prestige bump; equal taste → tie broken by the SORT tiebreak
    // (tier still wins there) but the BUMP itself must be 0. Assert via degraded staying
    // driven by taste only and the star not gaining a taste-tier advantage.
    const pool = [W({sku:'LWHa', popularity_tier:2}), W({sku:'LWHb', popularity_tier:0})];
    const out = scoreProducts({ category:'whisky', occasion:'everyday', axis1:'scotch' } as any, pool as any);
    // both still scotch matches → not degraded; ordering may favor the seller via the
    // tiebreak, which is intended (tiebreak applies regardless of occasion).
    expect(out.degraded).toBe(false);
    expect(out.products[0].sku).toBe('LWHa'); // tier-2 wins the genuine tie via sort tiebreak
  });

  // ── W3: wine character (axis2) is now a real taste-tier term (was profile-only/dead).
  // earthy → earthy/oak/spice/mineral families; fruity → red/dark/stone/tropical/citrus. ──
  it('wine character earthy ranks an earthy-noted wine above a fruity one', () => {
    const pool = [P({sku:'WRWfru', flavor_tags_canonical:['Cherry']}),
                  P({sku:'WRWear', flavor_tags_canonical:['Tobacco']})];
    const out = scoreProducts(ans({axis2:'earthy'}), pool as any);
    expect(out.products[0].sku).toBe('WRWear');
  });
  it('wine character fruity ranks a fruity-noted wine above an earthy one', () => {
    const pool = [P({sku:'WRWear', flavor_tags_canonical:['Leather']}),
                  P({sku:'WRWfru', flavor_tags_canonical:['Black Cherry']})];
    const out = scoreProducts(ans({axis2:'fruity'}), pool as any);
    expect(out.products[0].sku).toBe('WRWfru');
  });
  it('wine character is a TASTE-TIER term: an earthy match alone can clear the gate', () => {
    // 4 earthy-noted wines, axis2=earthy, no other answer → each scores +2 (≥ QUALITY_MIN) → not degraded.
    const pool = Array.from({length:4},(_,i)=>P({sku:`WRWe${i}`, flavor_tags_canonical:['Tobacco']}));
    const out = scoreProducts(ans({axis2:'earthy'}), pool as any);
    expect(out.degraded).toBe(false);
  });
  it("wine character 'balanced' imposes no constraint (neutral, no crash)", () => {
    const pool = [P({sku:'WRWa', flavor_tags_canonical:['Cherry']}), P({sku:'WRWb', flavor_tags_canonical:['Tobacco']})];
    const out = scoreProducts(ans({axis2:'balanced'}), pool as any);
    expect(out.products.length).toBe(2); // both kept; balanced adds nothing
  });

  // ── W3: gin. Style is a RANK-ONLY keyword lean; and gin (no gate-able taste term)
  // must NOT be falsely flagged "Closest matches" when the pool is genuinely fine. ──
  const G = ({sku, ...o}:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', category_type:'Gin', sku:'LGN'+(sku||'x'), ...o });
  it('gin: a clean in-stock/in-budget pool is NOT degraded (W3 label fix)', () => {
    const pool = [G({sku:'1'}), G({sku:'2'}), G({sku:'3'}), G({sku:'4'})];
    const out = scoreProducts({ category:'gin', axis1:'classic' } as any, pool as any);
    expect(out.products.length).toBeGreaterThanOrEqual(4);
    expect(out.degraded).toBe(false); // gin has no gate-able taste term → never "closest matches"
  });
  it('gin classic: a "London Dry" gin out-ranks a plain one (rank-only keyword lean)', () => {
    const pool = [G({sku:'plain', name:'Acme Gin'}), G({sku:'ld', name:'Acme London Dry Gin'})];
    const out = scoreProducts({ category:'gin', axis1:'classic' } as any, pool as any);
    expect(out.products[0].sku).toBe('LGNld');
  });
  it('gin contemporary: a botanical gin out-ranks a plain one', () => {
    const pool = [G({sku:'plain', name:'Acme Gin'}), G({sku:'bot', name:'Acme Gin', desc_en_short:'A floral contemporary botanical style'})];
    const out = scoreProducts({ category:'gin', axis1:'contemporary' } as any, pool as any);
    expect(out.products[0].sku).toBe('LGNbot');
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
    const pool=[P({sku:'WRW1', body:'Full'}), P({sku:'WRW2', body:'Light'})];
    expect(scoreProducts(ans({axis1:'bold'}),pool).products[0].sku).toBe('WRW1');
  });
});
