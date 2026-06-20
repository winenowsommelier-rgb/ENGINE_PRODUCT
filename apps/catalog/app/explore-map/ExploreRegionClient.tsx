'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CategoryLens } from '@/components/explore/CategoryLens';
import { RegionAtlas } from '@/components/explore/RegionAtlas';
import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { ExploreMapData, LensKey, MapRegion } from '@/lib/explore/types';
import { LENS_GROUPS } from '@/lib/explore/map-data';

export function ExploreRegionClient({ data, initialRegionSlug }: {
  data: ExploreMapData; initialRegionSlug?: string;
}) {
  const router = useRouter();
  const [lens, setLens] = useState<LensKey>('all');
  const [selected, setSelected] = useState<MapRegion | null>(
    data.regions.find((r) => r.slug === initialRegionSlug) ?? null,
  );
  const available = new Set<LensKey>();
  for (const r of data.regions)
    for (const [lk, groups] of Object.entries(LENS_GROUPS))
      if (groups.some((g) => (r.countsByGroup[g] ?? 0) > 0)) available.add(lk as LensKey);

  return (
    <div className="relative">
      <div className="mb-4"><CategoryLens active={lens} onSelect={setLens} available={available} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <RegionAtlas regions={data.regions} lens={lens} selectedSlug={selected?.slug}
          onSelect={(r) => { setSelected(r); router.push(`/explore-map/${r.slug}`, { scroll: false }); }} />
        {selected && (
          <RegionDrawer region={selected} lens={lens}
            onClose={() => { setSelected(null); router.push('/explore-map', { scroll: false }); }} />
        )}
      </div>
    </div>
  );
}
