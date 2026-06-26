import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadExploreMapData } from '@/lib/explore/map-data.server';
import { ExploreRegionClient } from '../ExploreRegionClient';
import { RegionList } from '@/components/explore/RegionList';
import { EscapeHatch } from '@/components/explore/EscapeHatch';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildCollectionPage } from '@/lib/seo/jsonld';
import { buildFaqData } from '@/lib/seo/faq-builder';
import { buildRegionBlurb } from '@/lib/seo/region-blurb-builder';
import { getAllProducts } from '@/lib/catalog-data';
import { FaqAccordion } from './FaqAccordion';

export function generateStaticParams() {
  return loadExploreMapData().regions.map((r) => ({ region: r.slug }));
}

export function generateMetadata({ params }: { params: { region: string } }): Metadata {
  const data = loadExploreMapData();
  const r = data.regions.find((x) => x.slug === params.region);
  if (!r) return { title: 'Region — WNLQ9' };

  const all = getAllProducts();
  const rNameLower = r.name.toLowerCase().trim();
  const regionProducts = all.filter(p => p.region?.toLowerCase().trim() === rNameLower);
  const prices = regionProducts.map(p => p.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const topVariety = regionProducts.find(p => p.variety)?.variety?.split(',')[0]?.trim();

  const title = `Buy ${r.name} Wine & Spirits in Thailand — ${r.total} bottles | WNLQ9`;
  const desc = [
    `Browse ${r.total} bottles from ${r.name}, ${r.country} at WNLQ9`,
    topVariety ? `. Includes ${topVariety}` : '',
    priceMin ? `. Prices from ฿${priceMin.toLocaleString()}` : '',
    `. Order in Thailand via LINE or WhatsApp.`,
  ].join('');

  return {
    title: title.length > 70 ? `${r.name} Wine & Spirits | WNLQ9 Bangkok` : title,
    description: desc.slice(0, 160),
    alternates: { canonical: `https://wnlq9.shop/explore-map/${r.slug}` },
    openGraph: { title, description: desc.slice(0, 155), locale: 'en_TH', siteName: 'WNLQ9' },
  };
}

export default function RegionPage({ params }: { params: { region: string } }) {
  const data = loadExploreMapData();
  const region = data.regions.find((r) => r.slug === params.region);
  if (!region) notFound();
  const total = data.countries.reduce((n, c) => n + c.total, 0);

  const allProducts = getAllProducts();
  const regionNameLower = region.name.toLowerCase().trim();
  const regionProducts = allProducts.filter(p => p.region?.toLowerCase().trim() === regionNameLower);

  // Top 50 threshold: only the 50 largest regions get blurb + FAQ (avoids Google "scaled content" penalty)
  const allTotals = data.regions.map(r => r.total).sort((a, b) => b - a);
  const top50Threshold = allTotals[49] ?? 0;
  const isTop50 = region.total >= top50Threshold;

  const blurb = isTop50 ? buildRegionBlurb(region.name, region.country, regionProducts) : null;
  const faqData = isTop50 && regionProducts.length >= 10
    ? buildFaqData(region.slug, region.name, region.country, regionProducts, '/contact')
    : null;

  const top5 = [...regionProducts]
    .sort((a, b) => (b.score_max ?? 0) - (a.score_max ?? 0) || (b.price ?? 0) - (a.price ?? 0))
    .slice(0, 5);

  const collectionDesc = blurb ?? `Browse ${region.total} bottles from ${region.name}, ${region.country} at WNLQ9.`;
  const collectionSchema = buildCollectionPage(region.name, region.slug, region.country, region.total, top5, collectionDesc);

  return (
    <section className="container py-6 sm:py-10">
      <JsonLd data={collectionSchema} />
      {faqData && <JsonLd data={faqData.schema} />}
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Explore by Region</h1>
      {/* key on the slug forces a remount on region→region soft navigation so the
          drawer re-derives `selected` from the new initialRegionSlug (the state is
          only read in the useState initializer, which runs once per mount). */}
      <div className="mt-5 sm:mt-6"><ExploreRegionClient key={params.region} data={data} initialRegionSlug={params.region} /></div>
      <div className="mt-5 sm:mt-6"><EscapeHatch totalProducts={total} /></div>
      <RegionList regions={data.regions} lens="all" />
      {blurb && <p className="mt-6 text-base leading-relaxed text-muted-foreground">{blurb}</p>}
      {faqData && <FaqAccordion items={faqData.qaItems} />}
    </section>
  );
}
