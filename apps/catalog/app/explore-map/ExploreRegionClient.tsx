'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { CategoryLens } from '@/components/explore/CategoryLens';
import { RegionAtlas, type CountryPin } from '@/components/explore/RegionAtlas';
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

  return (
    <div className="relative">
      {/* Top controls: lens + breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CategoryLens active={lens} onSelect={(l) => { setLens(l); }} available={available} />
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
          <button onClick={goWorld} className="min-h-9 rounded px-2 font-medium text-foreground hover:text-primary">
            World
          </button>
          {focusCountry && (
            <>
              <ChevronRight size={14} aria-hidden />
              <button
                onClick={() => goCountry(focusCountry)}
                className="min-h-9 rounded px-2 font-medium text-foreground hover:text-primary"
              >
                {focusCountry.name}
              </button>
            </>
          )}
          {selected && (
            <>
              <ChevronRight size={14} aria-hidden />
              <span className="px-2 font-medium text-primary">{selected.name}</span>
            </>
          )}
        </nav>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <RegionAtlas
          countries={countryPins}
          focusCountry={focusCountry}
          lens={lens}
          selectedSlug={selected?.slug}
          onSelectCountry={goCountry}
          onSelectRegion={(r) => {
            setSelected(r);
            if (!focusCountry) setFocusCountry(countryPins.find((c) => c.name === r.country) ?? null);
            router.push(`/explore-map/${r.slug}`, { scroll: false });
          }}
        />
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
          Tap a country to zoom in and explore its regions.
        </p>
      )}
    </div>
  );
}
