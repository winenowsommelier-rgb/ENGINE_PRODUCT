'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { CategoryLens } from '@/components/explore/CategoryLens';
import { CountryChips } from '@/components/explore/CountryChips';
import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { ExploreMapData, LensKey, MapRegion } from '@/lib/explore/types';
import { LENS_GROUPS, lensCount, lensHasStock, countryShopHref } from '@/lib/explore/map-data';
import { buildCountryPins, countryLensCount, type CountryPin } from '@/lib/explore/country-pins';

// MapLibre is WebGL + window-bound — client-only by nature. The dynamic import
// keeps it (and its ~250KB engine) out of SSR and out of every other route.
const MapLibreAtlas = dynamic(
  () => import('@/components/explore/MapLibreAtlas').then((m) => m.MapLibreAtlas),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse bg-neutral-100" aria-label="Loading map…" />
    ),
  },
);

export function ExploreRegionClient({ data, initialRegionSlug }: {
  data: ExploreMapData; initialRegionSlug?: string;
}) {
  const router = useRouter();
  const [lens, setLens] = useState<LensKey>('all');

  const countryPins = useMemo<CountryPin[]>(() => buildCountryPins(data), [data]);

  // Resolve the initial deep-link region → preselect it AND focus its country.
  const initialRegion = useMemo(
    () => data.regions.find((r) => r.slug === initialRegionSlug) ?? null,
    [data, initialRegionSlug],
  );
  const [focusCountry, setFocusCountry] = useState<CountryPin | null>(
    initialRegion ? countryPins.find((c) => c.name === initialRegion.country) ?? null : null,
  );
  const [selected, setSelected] = useState<MapRegion | null>(initialRegion);

  // A lens is offered if ANY region OR ANY country roll-up has stock reachable at
  // that lens (type-aware for sake — see lensHasStock — so a country with only
  // Shochu/Soju/Umeshu/Makgeolli, no real sake, does not offer the "Sake" button).
  const available = new Set<LensKey>();
  const addLensesFor = (countsByGroup: Record<string, number>, countsByGroupType?: Record<string, number>) => {
    for (const lk of Object.keys(LENS_GROUPS) as (keyof typeof LENS_GROUPS)[])
      if (lensHasStock(countsByGroup, countsByGroupType, lk)) available.add(lk as LensKey);
  };
  for (const r of data.regions) addLensesFor(r.countsByGroup, r.countsByGroupType);
  for (const c of data.countries) addLensesFor(c.countsByGroup, c.countsByGroupType);

  /**
   * Shallow URL sync (Next 14 native history support): selecting/deselecting a
   * region must NOT router.push between /explore-map and /explore-map/[slug] —
   * that navigates to a different route, remounting this whole client (map
   * re-init, country focus lost on close, RSC round-trip lag). pushState keeps
   * the deep-linkable URL in sync while state, camera and motion stay smooth.
   * Direct loads of /explore-map/[slug] still get the full SSG page.
   */
  const syncUrl = (path: string) => { window.history.pushState(null, '', path); };

  const goWorld = () => { setSelected(null); setFocusCountry(null); syncUrl('/explore-map'); };

  /**
   * Lens switch rule (spec): if the focused country has nothing under the new
   * lens, fall back to the world view; if only the selected region empties,
   * close the sheet but keep the country focus.
   */
  const applyLens = (l: LensKey) => {
    setLens(l);
    if (focusCountry && countryLensCount(focusCountry, l) === 0) {
      setSelected(null); setFocusCountry(null);
      syncUrl('/explore-map');
      return;
    }
    if (selected && lensCount(selected, l) === 0) {
      setSelected(null);
      syncUrl('/explore-map');
    }
  };

  // Map pins only ever focus countries WITH regions (the atlas handles region-less
  // pins internally with a popup card and never calls this for them).
  const goCountry = (c: CountryPin) => {
    if (c.regions.length === 0) return;
    setSelected(null);
    setFocusCountry(c);
  };
  // Chips are labeled buttons — a region-less country chip navigates to /shop
  // directly (expected for a button that names its destination).
  const goCountryFromChip = (c: CountryPin) => {
    if (c.regions.length === 0) {
      router.push(countryShopHref(c.name, lens));
      return;
    }
    goCountry(c);
  };

  const closeRegion = () => { setSelected(null); syncUrl('/explore-map'); };
  const selectRegion = (r: MapRegion) => {
    // Tapping the already-selected region (pin or chip) deselects — the same
    // gesture toggles, so users always have an obvious way back.
    if (selected?.slug === r.slug) { closeRegion(); return; }
    setSelected(r);
    if (!focusCountry) setFocusCountry(countryPins.find((c) => c.name === r.country) ?? null);
    syncUrl(`/explore-map/${r.slug}`);
  };

  return (
    <div className="relative">
      {/* Controls band above the map: lens pills + country/region chip rail. */}
      <div className="mb-4 flex flex-col gap-3">
        <CategoryLens active={lens} onSelect={applyLens} available={available} />
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {focusCountry ? `Regions in ${focusCountry.name}` : 'Browse by country'}
          </p>
          <CountryChips
            countries={countryPins}
            focusCountry={focusCountry}
            lens={lens}
            selectedSlug={selected?.slug}
            onSelectCountry={goCountryFromChip}
            onSelectRegion={selectRegion}
          />
        </div>
      </div>

      {/* The map is the hero: a tall immersive canvas on every viewport (vs the old
          ~150px mobile letterbox strip). The container is position:relative — the
          breadcrumb and the desktop region panel anchor inside it. */}
      <div className="relative h-[62vh] max-h-[760px] min-h-[420px] w-full overflow-hidden rounded-3xl border border-neutral-200 bg-neutral-100 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.18)]">
        {/* Breadcrumb — frosted pill, top-left, over the map. */}
        <nav
          aria-label="Breadcrumb"
          className="absolute left-3 top-3 z-20 flex items-center gap-0.5 rounded-full border border-border/70 bg-background/85 px-2 py-1 text-sm text-muted-foreground shadow-sm backdrop-blur-sm"
        >
          <button onClick={goWorld} className="rounded px-1.5 font-medium text-foreground hover:text-primary">
            World
          </button>
          {focusCountry && (
            <>
              <ChevronRight size={13} aria-hidden className="shrink-0" />
              <button
                onClick={() => goCountry(focusCountry)}
                className="rounded px-1.5 font-medium text-foreground hover:text-primary"
              >
                {focusCountry.name}
              </button>
            </>
          )}
          {selected && (
            <>
              <ChevronRight size={13} aria-hidden className="shrink-0" />
              <span className="px-1.5 font-medium text-primary">{selected.name}</span>
            </>
          )}
        </nav>

        <MapLibreAtlas
          countries={countryPins}
          focusCountry={focusCountry}
          lens={lens}
          selectedRegion={selected}
          onSelectCountry={goCountry}
          onSelectRegion={selectRegion}
        />

        {/* Region details over the map: bottom sheet (mobile) / side panel (desktop). */}
        {selected && (
          <RegionDrawer region={selected} lens={lens} onClose={closeRegion} />
        )}
      </div>

      {/* Hint */}
      {!focusCountry && (
        <p className="mt-3 text-sm text-muted-foreground">
          Tap a country to zoom in — pinch or use two fingers to move the map.
        </p>
      )}
    </div>
  );
}
