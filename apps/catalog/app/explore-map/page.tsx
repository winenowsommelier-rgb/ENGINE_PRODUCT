import type { Metadata } from 'next';
import { loadExploreMapData } from '@/lib/explore/map-data.server';
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
    <section className="container py-6 sm:py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Explore by Region</h1>
      <p className="mt-2 text-base text-muted-foreground sm:text-lg">Discover the collection by place — tap a region to see what we carry there.</p>
      <div className="mt-5 sm:mt-6"><ExploreRegionClient data={data} /></div>
      <div className="mt-5 sm:mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
    </section>
  );
}
