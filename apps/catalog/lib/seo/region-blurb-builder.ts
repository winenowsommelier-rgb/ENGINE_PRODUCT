// apps/catalog/lib/seo/region-blurb-builder.ts
import type { PublicProduct } from '@/lib/types';

const MIN_PRODUCTS = 10;

function topVarieties(products: PublicProduct[], n = 3): string[] {
  const counts: Record<string, number> = {};
  for (const p of products) {
    if (!p.variety) continue;
    for (const v of p.variety.split(',').map(s => s.trim())) {
      counts[v] = (counts[v] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
}

export function buildRegionBlurb(
  regionName: string,
  countryName: string,
  products: PublicProduct[],
): string | null {
  if (products.length < MIN_PRODUCTS) return null;

  const prices = products.map(p => p.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  const varieties = topVarieties(products);

  let blurb = `${regionName} is represented at WNLQ9 by ${products.length} bottles from ${countryName}.`;
  if (varieties.length) {
    blurb += ` The selection spans ${varieties.join(', ')}.`;
  }
  if (priceMin && priceMax) {
    blurb += ` Prices range from ฿${priceMin.toLocaleString()} to ฿${priceMax.toLocaleString()}.`;
  }

  for (const p of products) {
    if (!p.score_summary) continue;
    try {
      const parsed = JSON.parse(p.score_summary);
      const critics: Array<{ critic: string; score_value: number }> = parsed?.critics ?? [];
      if (!critics.length) continue;
      const best = critics.reduce((a, b) => a.score_value >= b.score_value ? a : b);
      blurb += ` Critic-acclaimed bottles include ${p.name} (${best.score_value} pts, ${best.critic}).`;
      break;
    } catch { /* skip */ }
  }

  return blurb;
}
