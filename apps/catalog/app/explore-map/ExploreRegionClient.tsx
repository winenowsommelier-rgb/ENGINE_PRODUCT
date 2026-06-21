'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { CategoryLens } from '@/components/explore/CategoryLens';
import { RegionAtlas, type CountryPin } from '@/components/explore/RegionAtlas';
import { CountryChips } from '@/components/explore/CountryChips';
import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { ExploreMapData, LensKey, MapRegion } from '@/lib/explore/types';
import { LENS_GROUPS } from '@/lib/explore/map-data';

export function ExploreRegionClient({ data, initialRegionSlug }: {
  data: ExploreMapData; initialRegionSlug?: string;
}) {
  const router = useRouter();
  const [lens, setLens] = useState<LensKey>('all');

  // Group curated regions under their dominant country → the world-view country pins.
  const countryPins = useMemo<CountryPin[]>(() => {
    const byCountry = new Map<string, MapRegion[]>();
    for (const r of data.regions) {
      if (!r.country) continue;
      (byCountry.get(r.country) ?? byCountry.set(r.country, []).get(r.country)!).push(r);
    }
    // Country coords: reuse the country roll-up's lat/lng (every country in the
    // roll-up has coords); fall back to the mean of its regions if absent.
    const countryCoord = new Map(data.countries.map((c) => [c.name, { lat: c.lat, lng: c.lng, slug: c.slug }]));
    return [...byCountry.entries()]
      .map(([name, regions]) => {
        const cc = countryCoord.get(name);
        const lat = cc?.lat ?? regions.reduce((s, r) => s + r.lat, 0) / regions.length;
        const lng = cc?.lng ?? regions.reduce((s, r) => s + r.lng, 0) / regions.length;
        const slug = cc?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return { name, slug, lat, lng, regions };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Resolve the initial deep-link region → preselect it AND focus its country.
  const initialRegion = useMemo(
    () => data.regions.find((r) => r.slug === initialRegionSlug) ?? null,
    [data, initialRegionSlug],
  );
  const [focusCountry, setFocusCountry] = useState<CountryPin | null>(
    initialRegion ? countryPins.find((c) => c.name === initialRegion.country) ?? null : null,
  );
  const [selected, setSelected] = useState<MapRegion | null>(initialRegion);

  const available = new Set<LensKey>();
  for (const r of data.regions)
    for (const [lk, groups] of Object.entries(LENS_GROUPS))
      if (groups.some((g) => (r.countsByGroup[g] ?? 0) > 0)) available.add(lk as LensKey);

  const goWorld = () => { setSelected(null); setFocusCountry(null); router.push('/explore-map', { scroll: false }); };
  const goCountry = (c: CountryPin) => { setSelected(null); setFocusCountry(c); };
  const selectRegion = (r: MapRegion) => {
    setSelected(r);
    if (!focusCountry) setFocusCountry(countryPins.find((c) => c.name === r.country) ?? null);
    router.push(`/explore-map/${r.slug}`, { scroll: false });
  };

  return (
    <div className="relative">
      {/* Top controls: lens only (breadcrumb moved onto the map). */}
      <div className="mb-4">
        <CategoryLens active={lens} onSelect={(l) => { setLens(l); }} available={available} />
      </div>

      {/* Full-width map; the region detail panel renders BELOW it (vertical stack,
          all viewports). The map always spans the container width; the panel is
          full-width too so its bottle grid can fan out / resize fluidly. */}
      <div className="flex flex-col gap-4">
        {/* Chip menu ABOVE the map (not overlaid) — a single scroll row so it stays a
            thin band and never covers the country pins, which must stay tappable. */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {focusCountry ? `Regions in ${focusCountry.name}` : 'Browse by country'}
          </p>
          <CountryChips
            countries={countryPins}
            focusCountry={focusCountry}
            lens={lens}
            selectedSlug={selected?.slug}
            onSelectCountry={goCountry}
            onSelectRegion={selectRegion}
          />
        </div>

        <div className="relative">
          {/* Breadcrumb overlaid on the map's top-left corner (frosted pill). Small
              corner element — clear of the pin cluster. */}
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

          <RegionAtlas
            countries={countryPins}
            focusCountry={focusCountry}
            lens={lens}
            selectedSlug={selected?.slug}
            onSelectCountry={goCountry}
            onSelectRegion={selectRegion}
          />
        </div>

        {selected && (
          <RegionDrawer
            region={selected}
            lens={lens}
            onClose={() => { setSelected(null); router.push('/explore-map', { scroll: false }); }}
          />
        )}
      </div>

      {/* Hint */}
      {!focusCountry && (
        <p className="mt-3 text-sm text-muted-foreground">
          Tap a country pin or chip to zoom in and explore its regions.
        </p>
      )}
    </div>
  );
}
