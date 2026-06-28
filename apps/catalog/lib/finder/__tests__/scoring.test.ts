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
  // Rule 5: the old `whisky: axis2=smoky ranks an Islay bottle above a Speyside bottle`
  // test asserted the removed region-guessing heuristic (axis2='smoky' → reward region=Islay).
  // Spec §11.8 verified that is WRONG and the whisky question-config no longer emits axis2.
  // Whisky smoke is now covered by the tasteFeel='smoky' smokiness/peated-allow-list tests
  // below ("whisky tasteFeel='smoky' …") and the positive-only peatScore tests — region is
  // never the peat signal. The dead axis2→region map + test were removed.
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

  // ── SAKE sweetness (tasteFeel) — reads taste_profile.axes.sweetness (~26% populated).
  // After TASK B, axis1 is the sub-type selector ('sake'/'shochu'/'umeshu'), so sweetness
  // is now keyed off tasteFeel: fragrant→sweet end, clean→dry end of the 4-level ladder.
  // LSK* prefix → Sake & Asian group so finderPrefilter passes them. ──
  const SK = (sku: string, sweetness?: string, o: any = {}) => ({
    sku, price: 4000, is_in_stock: true,
    taste_profile: sweetness ? { axes: { sweetness: { value: sweetness } } } : undefined,
    ...o,
  });
  it('sake: tasteFeel=fragrant ranks a Sweet bottle above a Very Dry one', () => {
    // fragrant → target 'sweet' end of ladder; 'Sweet' is exact match, 'Very Dry' is far end.
    const pool = [SK('LSKdry', 'Very Dry'), SK('LSKsweet', 'Sweet')];
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKsweet');
  });
  it('sake: tasteFeel=clean ranks a Dry bottle above a Sweet one', () => {
    // clean → target 'dry' end; 'Dry' is exact match (distance 0), 'Sweet' is far end.
    const pool = [SK('LSKsweet', 'Sweet'), SK('LSKdry', 'Dry')];
    const out = scoreProducts({ category:'sake', tasteFeel:'clean' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKdry');
  });
  it('sake: a sweetness match clears the quality gate (not degraded)', () => {
    // Off-dry is adjacent to the fragrant/Sweet target (ladder rung 3 ≥ QUALITY_MIN) → well-matched.
    const pool = [SK('LSK1','Sweet'), SK('LSK2','Off-dry'), SK('LSK3','Sweet'), SK('LSK4','Off-dry')];
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.degraded).toBe(false);
  });
  it('sake: no-sweetness-data products are NEUTRAL (kept, not penalized, not degraded by absence)', () => {
    // 74% of real sake has no sweetness signal. Such a pool must still return matches and
    // must NOT crash; absence scores 0 (degraded because nothing clears the gate).
    const pool = Array.from({length:5},(_,i)=>SK(`LSKn${i}`)); // no taste_profile
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.products.length).toBeGreaterThanOrEqual(4);
    expect(out.products.every(p => p.sku.startsWith('LSKn'))).toBe(true);
  });
  it("sake: tasteFeel='unsure' imposes no sweetness constraint (no crash, all kept)", () => {
    // 'unsure' has no SWEETNESS_TARGET entry → no constraint (same as old axis1='any').
    const pool = [SK('LSKa','Sweet'), SK('LSKb','Dry')];
    const out = scoreProducts({ category:'sake', tasteFeel:'unsure' } as any, pool as any);
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
  // Rule 5: the two old peat tests asserted REGION-BASED guessing (peat:'heavy' → reward
  // region=Islay; peat:'none' → reward non-Islay). Spec §11.8 verified that is WRONG — the
  // export false-negatives genuinely-smoky non-Islay malts (Talisker=Skye, Ledaig=Mull) and
  // mislabels clean Islay bottles. peatScore is now POSITIVE-ONLY on real smokiness/allow-list
  // and NEVER reads region. Rewritten below to assert the correct behavior.
  it('whisky: peat heavy boosts a real-smoky bottle (smokiness=heavy), region ignored', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // smoky bottle is in Speyside (NOT Islay) — region must not decide; smokiness does.
    const pool = [W({sku:'LWHclean', region:'Islay', smokiness:'none', name:'Clean Malt'}),
                  W({sku:'LWHsmoky', region:'Speyside', smokiness:'heavy', name:'Smoky Malt'})];
    const out = scoreProducts({ category:'whisky', peat:'heavy' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHsmoky');
  });
  it('whisky: peat heavy boosts a peated allow-list name even when smokiness=none (Talisker false-neg)', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHplain', smokiness:'none', name:'Glenfiddich 12'}),
                  W({sku:'LWHtali', smokiness:'none', name:'Talisker 10 Years'})];
    const out = scoreProducts({ category:'whisky', peat:'heavy' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHtali');
  });
  it('whisky: peat none NEVER penalizes/rewards on smokiness=none (no region, no smooth-assertion)', () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // peat='none' gives NO boost to anyone (positive-only design); order falls to price tie.
    const pool = [W({sku:'LWHa', region:'Islay', smokiness:'none', price:1000}),
                  W({sku:'LWHb', region:'Speyside', smokiness:'none', price:2000})];
    const out = scoreProducts({ category:'whisky', peat:'none' } as any, pool as any);
    // Neither gets a peat boost → tie broken by cheapest-first (price), region irrelevant.
    expect(out.products[0].sku).toBe('LWHa');
  });

  // ── TASK 7: whisky Layer-1 tasteFeel='smoky'. Positive-only smoky boost from real
  // smokiness='heavy' OR the peated-distillery name allow-list. NEVER excludes/penalizes
  // smokiness='none', NEVER reads region (spec §11.8 — fixes Talisker/Ledaig false-negatives).
  it("whisky tasteFeel='smoky' boosts a Talisker tagged smokiness=none (false-neg fix)", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHglen', smokiness:'none', name:'Glenfiddich 12'}),
                  W({sku:'LWHtali', smokiness:'none', name:'Talisker 10'})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'smoky' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHtali'); // peated allow-list wins despite smokiness=none
  });
  it("whisky tasteFeel='smoky' does NOT boost a non-peated Glenfiddich (smokiness=none)", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // a real-smoky bottle must out-rank the non-peated Glenfiddich; Glenfiddich gets no smoky boost.
    const pool = [W({sku:'LWHglen', smokiness:'none', name:'Glenfiddich 12', price:1000}),
                  W({sku:'LWHsmoky', smokiness:'heavy', name:'Smoky Malt', price:2000})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'smoky' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHsmoky');
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

  // ── W3 + TASK B: gin. Style is a RANK-ONLY keyword lean; and gin (no gate-able taste
  // term) must NOT be falsely flagged "Closest matches" when the pool is genuinely fine.
  // Rule 5 (Phase-2 rewire): these tests moved from axis1 (classic/contemporary) to the
  // plain `tasteFeel` step (classic/modern). ginStyleBump now reads a.tasteFeel; asserting
  // axis1 here would lock in the now-replaced field. Keyword logic is unchanged. ──
  const G = ({sku, ...o}:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', category_type:'Gin', sku:'LGN'+(sku||'x'), ...o });
  it('gin: a clean in-stock/in-budget pool is NOT degraded (W3 label fix)', () => {
    const pool = [G({sku:'1'}), G({sku:'2'}), G({sku:'3'}), G({sku:'4'})];
    const out = scoreProducts({ category:'gin', tasteFeel:'classic' } as any, pool as any);
    expect(out.products.length).toBeGreaterThanOrEqual(4);
    expect(out.degraded).toBe(false); // gin has no gate-able taste term → never "closest matches"
  });
  it('gin classic: a "London Dry" gin out-ranks a plain one (rank-only keyword lean)', () => {
    const pool = [G({sku:'plain', name:'Acme Gin'}), G({sku:'ld', name:'Acme London Dry Gin'})];
    const out = scoreProducts({ category:'gin', tasteFeel:'classic' } as any, pool as any);
    expect(out.products[0].sku).toBe('LGNld');
  });
  it('gin modern: a botanical gin out-ranks a plain one', () => {
    const pool = [G({sku:'plain', name:'Acme Gin'}), G({sku:'bot', name:'Acme Gin', desc_en_short:'A floral contemporary botanical style'})];
    const out = scoreProducts({ category:'gin', tasteFeel:'modern' } as any, pool as any);
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

  // ── TASK 5: red taste-feel → archetype scoring (body primary, tannin a soft nudge).
  // tasteFeel resolves to an archetype (taste-feel.ts) whose definingAttributes.body
  // (+ .tannin) drive the score. CRITICAL: body and tannin are INDEPENDENT additive
  // nudges — never an AND-filter (only ~10 low-tannin reds exist; requiring BOTH would
  // starve the pool, spec §11.1). The three fixtures span the archetype range:
  //   Light/Low-tannin  → bright-elegant-red  (body Light, tannin Low)
  //   Medium-Full/soft  → supple-everyday-red (body Medium, tannin Medium)
  //   Full/Medium-High  → bold-structured-red (body Full, tannin Medium-High)
  // Pin the Wine group + Red Wine type explicitly so finderPrefilter keeps them regardless
  // of SKU-prefix resolution (same belt-and-braces the W5 grape tests use).
  const RW = (o: any) => P({ category_group:'Wine', category_type:'Red Wine', ...o });
  const RF_LIGHT  = (o: any = {}) => RW({ sku:'WRWflight',  body:'Light',       tannin:'Low',         ...o });
  const RF_SUPPLE = (o: any = {}) => RW({ sku:'WRWfsupple', body:'Medium-Full', tannin:'Medium',      ...o });
  const RF_BOLD   = (o: any = {}) => RW({ sku:'WRWfbold',   body:'Full',        tannin:'Medium-High', ...o });

  it("tasteFeel='bold' ranks the Full/Medium-High red ABOVE the Light/Low-tannin one", () => {
    const pool = [RF_LIGHT(), RF_BOLD()];
    const out = scoreProducts(ans({ tasteFeel:'bold' }), pool as any);
    expect(out.products[0].sku).toBe('WRWfbold');
  });

  it("tasteFeel='smooth' ranks the Medium-Full/soft (supple) red at/above the gripping one", () => {
    // supple target = body Medium, tannin Medium. The Medium-Full/Medium bottle is nearer
    // than the bold Full/Medium-High one on BOTH body and tannin, so it must not rank below.
    const pool = [RF_BOLD(), RF_SUPPLE()];
    const out = scoreProducts(ans({ tasteFeel:'smooth' }), pool as any);
    const idxSupple = out.products.findIndex(p => p.sku === 'WRWfsupple');
    const idxBold   = out.products.findIndex(p => p.sku === 'WRWfbold');
    expect(idxSupple).toBeLessThanOrEqual(idxBold);
  });

  it("tasteFeel body & tannin are INDEPENDENT nudges, not an AND-filter (spec §11.1)", () => {
    // A Light-bodied red with HIGH (not low) tannin must still score on body alone — it is
    // NOT excluded for failing the tannin half. tasteFeel='light' wants body Light + tannin Low;
    // this bottle matches body exactly but misses tannin, yet must out-rank a Full/High mismatch.
    const lightHiTannin = RW({ sku:'WRWflhT', body:'Light', tannin:'High' });
    const fullHiTannin  = RW({ sku:'WRWffhT', body:'Full',  tannin:'High' });
    const out = scoreProducts(ans({ tasteFeel:'light' }), [lightHiTannin, fullHiTannin] as any);
    expect(out.products[0].sku).toBe('WRWflhT');
  });

  it("tasteFeel='unsure' resolves to the crowd-pleaser (supple) — no crash, ranks supple body up", () => {
    // 'unsure' has no archetype mapping → resolver falls back to CROWD_PLEASER.red (supple).
    const pool = [RF_BOLD(), RF_SUPPLE()];
    const out = scoreProducts(ans({ tasteFeel:'unsure' }), pool as any);
    expect(out.products.map(p=>p.sku)).toContain('WRWfsupple');
    expect(out.products[0].sku).toBe('WRWfsupple');
  });

  // ── TASK 6: WHITE taste-feel → archetype scoring. Acidity-LED (+ body), not sweetness.
  //   crisp    → crisp-zesty-white      (body Light, acidity High)
  //   rounded  → rich-textured-white    (body Full,  acidity Medium)
  //   aromatic → aromatic-balanced-white(body Medium,acidity Medium)
  const WW = (o: any) => ({ price:1500, is_in_stock:true, classification:'White Wine',
    category_group:'Wine', category_type:'White Wine', ...o });
  it("white tasteFeel='crisp' ranks a Light/High-acidity white ABOVE a Full/Medium one", () => {
    const pool = [WW({ sku:'WWWrich', body:'Full', acidity:'Medium' }),
                  WW({ sku:'WWWcrisp', body:'Light', acidity:'High' })];
    const out = scoreProducts({ category:'white', tasteFeel:'crisp' } as any, pool as any);
    expect(out.products[0].sku).toBe('WWWcrisp');
  });
  it("white tasteFeel='rounded' ranks a Full/round white at/above a Light/crisp one", () => {
    const pool = [WW({ sku:'WWWcrisp', body:'Light', acidity:'High' }),
                  WW({ sku:'WWWrich', body:'Full', acidity:'Medium' })];
    const out = scoreProducts({ category:'white', tasteFeel:'rounded' } as any, pool as any);
    const idxRich  = out.products.findIndex(p => p.sku === 'WWWrich');
    const idxCrisp = out.products.findIndex(p => p.sku === 'WWWcrisp');
    expect(idxRich).toBeLessThanOrEqual(idxCrisp);
  });
  it("white tasteFeel acidity is the secondary nudge (independent of body, spec §11.1)", () => {
    // crisp wants Light body + High acidity. A Light-body white with LOW acidity still
    // scores its body half and out-ranks a Full/High mismatch — not gated on the acidity half.
    const pool = [WW({ sku:'WWWlightLowAc', body:'Light', acidity:'Low' }),
                  WW({ sku:'WWWfullHiAc',   body:'Full',  acidity:'High' })];
    const out = scoreProducts({ category:'white', tasteFeel:'crisp' } as any, pool as any);
    expect(out.products[0].sku).toBe('WWWlightLowAc');
  });

  // ── TASK 8: grape scoring is WINE-ONLY (a spirit's `variety` is its base material, not a
  // wine grape — e.g. a Cognac/Vodka may carry 'Ugni Blanc'/grape-like text). Gating on
  // groupForProduct(p)==='Wine' so a spirit variety is NEVER read as a grape match. ──
  it('grape: a SPIRIT whose variety looks grape-like is NOT boosted (grape applies to wine only)', () => {
    // Both Vodkas; LVKgr carries a grape-family variety. Without the wine-gate it would get a
    // +2 grape boost and win; WITH the gate it gets 0, so the cheaper bottle leads on price tie.
    const V = (o:any)=>({ is_in_stock:true, category_group:'Spirits', category_type:'Vodka', ...o });
    const pool = [V({ sku:'LVKgr', price:2000, variety:'Cabernet Sauvignon' }),
                  V({ sku:'LVKplain', price:1000, variety:'Grain' })];
    const out = scoreProducts({ category:'spirits', grape:'cabernet' } as any, pool as any);
    // grape gives 0 to the spirit → no reorder → cheapest-first tiebreak wins.
    expect(out.products[0].sku).toBe('LVKplain');
  });
  it('grape: a WINE with the same variety IS still boosted (gate does not break wine grape scoring)', () => {
    // Regression guard for the gate: wine grape scoring must keep working.
    const W = (o:any)=>({ price:1500, is_in_stock:true, category_group:'Wine', category_type:'Red Wine', ...o });
    const pool = [W({ sku:'WRWplain', variety:'Merlot' }), W({ sku:'WRWcab', variety:'Cabernet Sauvignon' })];
    const out = scoreProducts({ category:'red', grape:'cabernet' } as any, pool as any);
    expect(out.products[0].sku).toBe('WRWcab');
  });

  // ── TASK 8: ginStyleBump must NOT read `classification` (Rule 12 — classification is a
  // stale TYPE duplicate). A 'classic' lean must score on name/desc keywords only; a junk
  // or grape-like `classification` must contribute nothing. (Rule 5 / TASK B: reads
  // tasteFeel='classic' now, not axis1 — the Phase-2 rewired field.) ──
  // ── TASK A (Phase-2 spirits): spiritsFeelScore. POSITIVE-ONLY age/grade lean. For
  // tasteFeel 'rich'/'aged', an aged/reposado/VSOP/XO-marked bottle (name or desc keyword)
  // scores +2; a plain bottle scores 0. 'light'/'smooth' impose no text requirement (small/
  // neutral). Rank-only (additive), like ginStyleBump. ──
  const SP = (o:any)=>({ price:2500, is_in_stock:true, category_group:'Spirits', category_type:'Rum', ...o });
  it("spirits tasteFeel='rich' boosts an aged/reposado bottle above a plain one", () => {
    const pool = [SP({ sku:'LRMplain', name:'Acme Rum' }),
                  SP({ sku:'LRMaged', name:'Acme Añejo Reserva Rum' })];
    const out = scoreProducts({ category:'spirits', tasteFeel:'rich' } as any, pool as any);
    expect(out.products[0].sku).toBe('LRMaged');
  });
  it("spirits tasteFeel='aged' boosts a VSOP/XO brandy via its description keyword", () => {
    const B = (o:any)=>({ price:5000, is_in_stock:true, category_group:'Spirits', category_type:'Cognac', ...o });
    const pool = [B({ sku:'LBRplain', name:'Acme Brandy', desc_en_short:'A young house style' }),
                  B({ sku:'LBRvsop', name:'Acme Brandy', desc_en_short:'A rich VSOP blend' })];
    const out = scoreProducts({ category:'spirits', tasteFeel:'aged' } as any, pool as any);
    expect(out.products[0].sku).toBe('LBRvsop');
  });
  it("spirits tasteFeel='rich' gives NO boost to a plain bottle (positive-only, no false uplift)", () => {
    // neither bottle carries an age/grade keyword → spiritsFeelScore=0 for both → cheapest wins.
    const pool = [SP({ sku:'LRMa', name:'Acme Rum', price:900 }),
                  SP({ sku:'LRMb', name:'Acme Rum', price:2000 })];
    const out = scoreProducts({ category:'spirits', tasteFeel:'rich' } as any, pool as any);
    expect(out.products[0].sku).toBe('LRMa'); // no age boost → tie broken cheapest-first
  });
  it("spirits tasteFeel='light' imposes no age-text requirement (plain bottle not penalized)", () => {
    const pool = [SP({ sku:'LVKlight', category_type:'Vodka', name:'Acme Vodka' })];
    const out = scoreProducts({ category:'spirits', tasteFeel:'light' } as any, pool as any);
    expect(out.products.length).toBe(1); // kept, no crash, no age requirement
  });

  // ── TASK B (Phase-2 sake): sakeAromaScore. Reads the STRUCTURED `variety`: ginjo/daiginjo
  // → fragrant class; junmai(without ginjo)/honjozo → clean class. +2 when the class matches
  // a.tasteFeel ('fragrant'/'clean'). Missing variety → 0. ──
  const SKv = (sku:string, variety?:string, o:any={})=>({
    sku, price:4000, is_in_stock:true, variety, ...o,
  });
  it("sake tasteFeel='fragrant' boosts a 'Junmai Ginjo' above a 'Honjozo'", () => {
    const pool = [SKv('LSKhonjo','Honjozo'), SKv('LSKginjo','Junmai Ginjo')];
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKginjo');
  });
  it("sake tasteFeel='clean' boosts a 'Honjozo' above a 'Daiginjo'", () => {
    const pool = [SKv('LSKdai','Daiginjo'), SKv('LSKhonjo','Honjozo')];
    const out = scoreProducts({ category:'sake', tasteFeel:'clean' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKhonjo');
  });
  it("sake tasteFeel='clean' boosts a plain 'Junmai' (no ginjo) as the clean class", () => {
    const pool = [SKv('LSKginjo','Junmai Ginjo'), SKv('LSKjun','Junmai')];
    const out = scoreProducts({ category:'sake', tasteFeel:'clean' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKjun');
  });
  it('sake: a product with no variety is NEUTRAL for the aroma feel (kept, not penalized)', () => {
    const pool = [SKv('LSKa'), SKv('LSKb')]; // no variety on either
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.products.length).toBe(2);
  });
  it('sake: sweetness scoring via tasteFeel is independent of sakeAromaScore (deep-dive)', () => {
    // Regression guard: tasteFeel='fragrant' drives sweetness scoring (taste-tier) AND
    // sakeAromaScore (rank-only). Both paths active simultaneously must not conflict —
    // the Sweet bottle still wins when both taste-tier and rank-only favor it.
    const pool = [SK('LSKdry2', 'Very Dry', { variety:'Junmai' }), SK('LSKsweet2', 'Sweet', { variety:'Daiginjo' })];
    const out = scoreProducts({ category:'sake', tasteFeel:'fragrant' } as any, pool as any);
    expect(out.products[0].sku).toBe('LSKsweet2');
  });

  // ── Whisky smooth/rich style leans (audit fix: both previously scored 0). ──
  // smooth → +1 when smokiness='none' (reliable unpeated indicator). Rank-only.
  // rich   → +1 when flavor_tags_canonical contains sherry/dried-fruit notes. Rank-only.
  // Both are weaker than the smoky +2 (positive-only, never gate quality).
  it("whisky tasteFeel='smooth' boosts a smokiness=none bottle above one with no smokiness data", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHnosig', smokiness:null, name:'Acme Malt'}),
                  W({sku:'LWHnone', smokiness:'none', name:'Smooth Malt'})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'smooth' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHnone');
  });
  it("whisky tasteFeel='smooth' is rank-only: the smooth bump never clears the quality gate alone", () => {
    // smooth lean is rank-only (in deepDiveBump, not `s`). With no axis1 and no other
    // taste-tier answer, s=0 for all → degraded=true. But the ordering IS affected by the
    // bump: smokiness=none bottles out-rank smokiness=heavy ones within the degraded pool.
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHheavy', smokiness:'heavy'}), W({sku:'LWHnone', smokiness:'none'})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'smooth' } as any, pool as any);
    // smooth bump re-orders even in a degraded result
    expect(out.products[0].sku).toBe('LWHnone');
    // degraded=true because s=0 for all (smooth lean is rank-only, never taste-tier)
    expect(out.degraded).toBe(true);
  });
  it("whisky tasteFeel='rich' boosts a bottle with sherry/dried-fruit flavor tags", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const pool = [W({sku:'LWHplain', flavor_tags_canonical:['Vanilla','Oak']}),
                  W({sku:'LWHrich', flavor_tags_canonical:['Dried Fruit','Sherry']})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'rich' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHrich');
  });
  it("whisky tasteFeel='rich' gives 0 to a vanilla-only bottle (vanilla excluded — too universal)", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    // both vanilla-only; neither gets rich boost → tie broken cheapest-first
    const pool = [W({sku:'LWHa', flavor_tags_canonical:['Vanilla'], price:1000}),
                  W({sku:'LWHb', flavor_tags_canonical:['Caramel'], price:2000})];
    const out = scoreProducts({ category:'whisky', tasteFeel:'rich' } as any, pool as any);
    expect(out.products[0].sku).toBe('LWHa'); // cheaper wins (no rich bump for vanilla/caramel)
  });
  it("whisky overlap: a sherried Speyside scores BOTH smooth (+1) and rich (+1) simultaneously", () => {
    const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
    const sherry = W({sku:'LWHsherry', smokiness:'none', flavor_tags_canonical:['Dried Fruit','Sherry']});
    const plainVanilla = W({sku:'LWHvanilla', smokiness:null, flavor_tags_canonical:['Vanilla']});
    const smoothOut = scoreProducts({ category:'whisky', tasteFeel:'smooth' } as any, [sherry, plainVanilla] as any);
    expect(smoothOut.products[0].sku).toBe('LWHsherry'); // wins on smooth lean too
    const richOut = scoreProducts({ category:'whisky', tasteFeel:'rich' } as any, [sherry, plainVanilla] as any);
    expect(richOut.products[0].sku).toBe('LWHsherry');   // wins on rich lean
  });

  // ── Spirits smooth lean (audit fix: 'smooth' previously scored 0 like 'light'). ──
  // smooth → +1 when smokiness='none'. Rank-only, positive-only.
  it("spirits tasteFeel='smooth' boosts a smokiness=none bottle (e.g. clean vodka/rum)", () => {
    const S = (o:any)=>({ price:2000, is_in_stock:true, category_group:'Spirits', category_type:'Vodka', ...o });
    const pool = [S({sku:'LVKnosig', smokiness:null, name:'Acme Vodka'}),
                  S({sku:'LVKsmooth', smokiness:'none', name:'Smooth Vodka'})];
    const out = scoreProducts({ category:'spirits', tasteFeel:'smooth' } as any, pool as any);
    expect(out.products[0].sku).toBe('LVKsmooth');
  });
  it("spirits tasteFeel='smooth' is rank-only and weaker than 'rich' aged-keyword lean", () => {
    // smooth gives +1 (none-smokiness), rich gives +2 (age keyword). A rich-aged bottle
    // with smokiness=none should lead when 'rich' is asked, not 'smooth'.
    const S = (o:any)=>({ price:2000, is_in_stock:true, category_group:'Spirits', category_type:'Rum', ...o });
    const pool = [S({sku:'LRMsmooth', smokiness:'none', name:'Acme Rum'}),
                  S({sku:'LRMaged', smokiness:'none', name:'Acme Añejo Rum'})];
    const richOut = scoreProducts({ category:'spirits', tasteFeel:'rich' } as any, pool as any);
    expect(richOut.products[0].sku).toBe('LRMaged'); // age keyword wins for 'rich'
    const smoothOut = scoreProducts({ category:'spirits', tasteFeel:'smooth' } as any, pool as any);
    // both have smokiness=none → tie → cheapest-first (both ฿2000) → either; just no crash
    expect(smoothOut.products.length).toBe(2);
  });

  it('gin: ginStyleBump ignores classification (Rule 12) — keyword in classification scores 0', () => {
    // 'classic' keyword 'london' lives ONLY in classification on LGNcls. If ginStyleBump still
    // read classification it would win; since it must NOT, LGNname (keyword in name) leads.
    const Gx = (o:any)=>({ price:1500, is_in_stock:true, category_group:'Spirits', category_type:'Gin', ...o });
    const pool = [Gx({ sku:'LGNcls', name:'Acme Gin', classification:'London Dry Gin' }),
                  Gx({ sku:'LGNname', name:'Acme London Dry Gin', classification:'Wine product' })];
    const out = scoreProducts({ category:'gin', tasteFeel:'classic' } as any, pool as any);
    expect(out.products[0].sku).toBe('LGNname'); // classification 'London Dry' must NOT score
  });
});
