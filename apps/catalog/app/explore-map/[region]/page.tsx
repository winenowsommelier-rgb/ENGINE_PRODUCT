import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadExploreMapData } from '@/lib/explore/map-data.server';
import { ExploreRegionClient } from '../ExploreRegionClient';
import { RegionList } from '@/components/explore/RegionList';
import { EscapeHatch } from '@/components/explore/EscapeHatch';

export function generateStaticParams() {
  return loadExploreMapData().regions.map((r) => ({ region: r.slug }));
}

export function generateMetadata({ params }: { params: { region: string } }): Metadata {
  const r = loadExploreMapData().regions.find((x) => x.slug === params.region);
  if (!r) return { title: 'Region — WNLQ9' };
  return {
    title: `${r.name} — Explore by Region — WNLQ9`,
    description: `Browse our ${r.total} bottles from ${r.name}, ${r.country}.`,
  };
}

export default function RegionPage({ params }: { params: { region: string } }) {
  const data = loadExploreMapData();
  const region = data.regions.find((r) => r.slug === params.region);
  if (!region) notFound();
  const total = data.countries.reduce((n, c) => n + c.total, 0);
  return (
    <section className="container py-10">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Explore by Region</h1>
      {/* key on the slug forces a remount on region→region soft navigation so the
          drawer re-derives `selected` from the new initialRegionSlug (the state is
          only read in the useState initializer, which runs once per mount). */}
      <div className="mt-8"><ExploreRegionClient key={params.region} data={data} initialRegionSlug={params.region} /></div>
      <div className="mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
    </section>
  );
}
