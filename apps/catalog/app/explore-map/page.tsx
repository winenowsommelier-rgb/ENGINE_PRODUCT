import type { Metadata } from 'next';
import { loadExploreMapData } from '@/lib/explore/map-data';
import { ExploreRegionClient } from './ExploreRegionClient';
import { RegionList } from '@/components/explore/RegionList';
import { EscapeHatch } from '@/components/explore/EscapeHatch';

export const metadata: Metadata = {
  title: 'Explore by Region — WNLQ9',
  description: 'Browse our wine, whisky and spirits by the regions they come from.',
};

export default function ExploreMapPage() {
  const data = loadExploreMapData();
  const total = data.countries.reduce((n, c) => n + c.total, 0);
  return (
    <section className="container py-10">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Explore by Region</h1>
      <p className="mt-3 text-lg text-muted-foreground">Discover the collection by place — tap a region to see what we carry there.</p>
      <div className="mt-8"><ExploreRegionClient data={data} /></div>
      <div className="mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
    </section>
  );
}
