// apps/catalog/app/sitemap.ts
import type { MetadataRoute } from 'next';
import path from 'node:path';
import fs from 'node:fs';
import { loadExploreMapData } from '@/lib/explore/map-data.server';

const BASE = 'https://wnlq9.shop';

function getRawProducts(): Array<{ sku: string }> {
  const candidates = [
    // repo root when build runs from repo root (e.g. Vercel)
    path.join(process.cwd(), 'apps', 'catalog', 'data', 'live_products_export.json'),
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    // repo root when build runs from apps/catalog (local dev)
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error('live_products_export.json not found for sitemap');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const buildDate = new Date().toISOString().split('T')[0];
  const products = getRawProducts();
  const { regions } = loadExploreMapData();

  const core: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: buildDate, changeFrequency: 'daily' },
    { url: `${BASE}/shop`, lastModified: buildDate, changeFrequency: 'daily' },
    { url: `${BASE}/explore-map`, lastModified: buildDate, changeFrequency: 'weekly' },
    { url: `${BASE}/about`, lastModified: buildDate, changeFrequency: 'monthly' },
    { url: `${BASE}/contact`, lastModified: buildDate, changeFrequency: 'monthly' },
  ];

  // 10 static category group pages (built in Task 8)
  const groupSlugs = [
    'wine','whisky','spirits','sake--asian','liqueur',
    'beer--rtd','non-alcoholic','cigars','events','accessories',
  ];
  const groupUrls: MetadataRoute.Sitemap = groupSlugs.map((slug) => ({
    url: `${BASE}/shop/${slug}`,
    lastModified: buildDate,
    changeFrequency: 'daily' as const,
  }));

  const productUrls: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${BASE}/product/${p.sku}`,
    lastModified: buildDate,
    changeFrequency: 'weekly' as const,
  }));

  const regionUrls: MetadataRoute.Sitemap = regions.map((r) => ({
    url: `${BASE}/explore-map/${r.slug}`,
    lastModified: buildDate,
    changeFrequency: 'weekly' as const,
  }));

  return [...core, ...groupUrls, ...productUrls, ...regionUrls];
}
