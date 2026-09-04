import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery, normalizeShopParams } from '@/lib/shop-query';
import { lensPrimaryGroup, lensType, lensCount } from '@/lib/explore/map-data';
import { loadExploreMapData } from '@/lib/explore/map-data.server';

const PEEK_KEYS = new Set(['sku', 'name', 'price', 'image_url']);

/**
 * Build the /shop params for a pin EXACTLY as shopHref() does, keyed off pinLevel.
 * Kept in lockstep with lib/explore/map-data.ts — if that function's query shape
 * changes this must change with it, or the invariant stops testing the real link.
 */
function handoffParams(r: {
  name: string; country: string; pinLevel?: string; parentName?: string;
}) {
  const level = r.pinLevel ?? 'region';
  const geo =
    level === 'region'
      ? { region: r.name }
      : level === 'subregion'
        ? { region: r.parentName ?? undefined, subregion: r.name }
        : { appellation: r.name };
  // bev:1 (group axis) makes /shop count the SAME all-stock beverage subset the
  // generator counted. We deliberately do NOT pass inStock:1: the map counts
  // in-stock AND OOS beverages, and shopHref drops inStock:1 too, so the grid
  // must count both. Adding inStock:1 here would re-introduce the count != grid
  // gap (the map would show all stock; the grid would show only in-stock).
  //
  // normalizeShopParams is applied because that is the REAL user journey:
  // app/shop/page.tsx normalizes the URL params BEFORE calling applyShopQuery.
  // applyShopQuery does NOT normalize internally, so calling it directly here
  // would test a query no user can actually issue. Verified 2026-07-27: the pin
  // {region:'Highlands', subregion:'Highland'} ANDs to 0 rows unnormalized, but
  // /shop canonicalizes Highlands->Highland, drops the now-redundant subregion,
  // and shows 148.
  return normalizeShopParams({ bev: '1', country: r.country, ...geo });
}

describe('explore-map invariant: panel count == /shop grid total', () => {
  const data = loadExploreMapData();
  const all = getAllProducts();

  /**
   * `total` is DEFINED as "the count this pin's own /shop hand-off returns", and the
   * generator computes it by running that same predicate rather than deriving it
   * from the node tree. Neither ownTotal nor inclusiveTotal can serve here:
   * /shop's region filter matches ANCESTORS, so ?region=California returns 620 while
   * the subtree holds 534 and the node itself 191. Measured 2026-07-27.
   */
  it('every pin: map total === /shop grid total for its OWN level hand-off (STRICT)', () => {
    for (const r of data.regions) {
      const grid = applyShopQuery(all, handoffParams(r) as never);
      expect(
        grid.total,
        `count mismatch for ${r.country}/${r.name} [${r.pinLevel ?? 'region'}]`,
      ).toBe(r.total);
      expect(r.total, `empty grid for ${r.country}/${r.name}`).toBeGreaterThan(0);
    }
  });

  /**
   * The tree identity: a node's inclusiveTotal is its own rows plus every
   * descendant's inclusiveTotal. This is what makes ancestor double-counting
   * structurally impossible rather than merely avoided. Children are matched by
   * parentName + country, the same pairing the generator folds on.
   *
   * Scoped to pins present in the emitted file. Nodes without coordinates (and the
   * suppressed name==country degenerates) never reach the output, so a parent's
   * emitted inclusiveTotal can legitimately exceed the sum of its EMITTED children
   * — hence >= for the children's share, with exact equality asserted for leaves.
   */
  it('inclusiveTotal === ownTotal + Σ children (by parentName + country)', () => {
    const byParent = new Map<string, number>();
    for (const r of data.regions) {
      if (!r.parentName) continue;
      const k = `${r.country}\u0000${r.parentName}`;
      byParent.set(k, (byParent.get(k) ?? 0) + (r.inclusiveTotal ?? 0));
    }
    for (const r of data.regions) {
      if (r.ownTotal === undefined || r.inclusiveTotal === undefined) continue;
      const childSum = byParent.get(`${r.country}\u0000${r.name}`) ?? 0;
      expect(
        r.inclusiveTotal,
        `subtree identity broken for ${r.country}/${r.name}: own=${r.ownTotal} children=${childSum} inclusive=${r.inclusiveTotal}`,
      ).toBeGreaterThanOrEqual(r.ownTotal + childSum);
      if (childSum === 0) expect(r.inclusiveTotal).toBe(r.ownTotal);
    }
  });

  it('no subregion pin is emitted without a parentName', () => {
    // A subregion hand-off with no region= is stripped by normalizeShopParams and
    // silently widens to the whole country (measured: Islay 59 rows -> 612).
    const orphans = data.regions.filter((r) => r.pinLevel === 'subregion' && !r.parentName);
    expect(orphans.map((r) => `${r.country}/${r.name}`)).toEqual([]);
  });

  it('no pin is emitted without a country', () => {
    // A country-less pin omits country= from its hand-off and so matches its region
    // name in EVERY country (measured: a stray 'Lombardy' node with own=1 claimed
    // total=48 by sweeping up Italy's rows).
    expect(data.regions.filter((r) => !r.country).map((r) => r.name)).toEqual([]);
  });

  it('no pin is emitted whose name equals its country', () => {
    // normalizeShopParams strips region==country, so such a pin can never link to
    // the grid it claims to describe (measured: France/France 62 rows -> 0).
    const degenerate = data.regions.filter(
      (r) => r.name.trim().toLowerCase() === r.country.trim().toLowerCase(),
    );
    expect(degenerate.map((r) => `${r.country}/${r.name}`)).toEqual([]);
  });

  it('the named Phase-A regions are pinned at their correct levels', () => {
    // These five collapsed into California / Central Valley / South Australia before
    // the resolver was wired in. Barolo is deliberately absent: appellation-level
    // pinning is deferred while the appellation column sits at 8% populated.
    const find = (n: string) => data.regions.find((r) => r.name === n);
    expect(find('Napa Valley')?.pinLevel).toBe('subregion');
    expect(find('Napa Valley')?.parentName).toBe('California');
    expect(find('Sonoma County')?.pinLevel).toBe('subregion');
    expect(find('Colchagua Valley')?.pinLevel).toBe('subregion');
    expect(find('Barossa Valley')?.pinLevel).toBe('subregion');
  });

  it('lens handoff group is a real /shop group for a represented lens', () => {
    const r = data.regions.find((x) => (x.countsByGroup['Wine'] ?? 0) > 0)!;
    const grid = applyShopQuery(
      all,
      { ...handoffParams(r), group: lensPrimaryGroup('wine')! } as never,
    );
    expect(grid.total).toBeGreaterThan(0);
  });

  /**
   * REGRESSION GUARD for the LSJ0024DG/Chum Churum bug report (2026-09-01): the
   * "Sake" lens must isolate real sake (category_type "Sake / Shochu") from
   * Shochu/Soju/Umeshu/Makgeolli, which all share the "Sake & Asian" group. This
   * runs the REAL generated data through the REAL /shop query engine — the same
   * count == grid invariant as the strict test above, but for a typed (class=)
   * lens hand-off instead of a group-only one.
   */
  it('sake lens: drawer count == /shop grid total AND excludes non-sake types (STRICT, real data)', () => {
    const sakeRegions = data.regions.filter((r) => lensCount(r, 'sake') > 0);
    expect(sakeRegions.length, 'no region has real-sake stock — fixture/data problem').toBeGreaterThan(0);
    for (const r of sakeRegions) {
      const grid = applyShopQuery(
        all,
        { ...handoffParams(r), group: lensPrimaryGroup('sake')!, class: lensType('sake')! } as never,
      );
      expect(grid.total, `sake count mismatch for ${r.country}/${r.name}`).toBe(lensCount(r, 'sake'));
      for (const p of grid.items) {
        expect(p.category_type, `non-sake product leaked into sake grid: ${p.sku} (${p.category_type})`).toBe('Sake / Shochu');
      }
    }
  });

  it('a country with Sake & Asian stock but NO real sake does not offer the sake lens (Vietnam/Thailand)', () => {
    // LSJ0024DG "Kai Lemongrass Ginger" (Vietnam, category_type Shochu) is the bug
    // report this fix addresses: browsing Sake & Asian + Vietnam surfaced it under
    // the "Sake" button. It stays reachable via the group-level "Sake & Asian"
    // lens/grid — only the TYPED sake button must exclude it.
    for (const c of data.countries) {
      if (c.name !== 'Vietnam' && c.name !== 'Thailand') continue;
      expect(
        (c.countsByGroupType?.[`Sake & Asian\u0000Sake / Shochu`] ?? 0),
        `${c.name} unexpectedly has real sake stock`,
      ).toBe(0);
    }
  });

  it('NO peek carries a non-allowlisted (margin) field', () => {
    for (const r of data.regions) {
      for (const peek of r.peeks) {
        for (const k of Object.keys(peek)) expect(PEEK_KEYS.has(k)).toBe(true);
      }
    }
  });

  // REGRESSION GUARD. `slug` is the identity key for /explore-map/[region], for the
  // map click handler, and for the chip active-state — all of which resolve it with
  // `.find(x => x.slug === …)`, i.e. FIRST WINS. Slugs were derived from the name
  // alone, which was collision-free at 94 region-level pins; adding subregion pins
  // created 6 same-name-different-country pairs (Highland Scotland/Mexico, Cognac
  // France/China, Kentucky USA/Taiwan, Sauternes France/Scotland, Douro
  // Portugal/Spain, Islands Scotland/Japan). Each collision made the loser's detail
  // page unreachable (19 products) and made generateStaticParams emit duplicate
  // params. The generator now qualifies the losers with their country; this asserts
  // it stays that way, since the symptom is silent — the page 200s with the WRONG
  // region's content rather than erroring.
  it('every region slug is unique (detail routes + React keys depend on it)', () => {
    const bySlug = new Map<string, string[]>();
    for (const r of data.regions) {
      const label = `${r.name} (${r.country})`;
      bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), label]);
    }
    const collisions = [...bySlug.entries()].filter(([, v]) => v.length > 1);
    expect(
      collisions.map(([slug, v]) => `${slug} -> ${v.join(' | ')}`),
    ).toEqual([]);
  });

  it('every region slug round-trips to the SAME pin the detail route would render', () => {
    for (const r of data.regions) {
      // This is exactly what app/explore-map/[region]/page.tsx does.
      const resolved = data.regions.find((x) => x.slug === r.slug);
      expect(`${resolved?.name} (${resolved?.country})`).toBe(`${r.name} (${r.country})`);
    }
  });
});
