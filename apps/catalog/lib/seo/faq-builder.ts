// apps/catalog/lib/seo/faq-builder.ts
import type { PublicProduct } from '@/lib/types';

const BASE = 'https://wnlq9-catalog.vercel.app';

export interface QAItem { question: string; answer: string; }
export interface FaqData { qaItems: QAItem[]; schema: Record<string, unknown> & { mainEntity: unknown[] }; }

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

function priceRange(products: PublicProduct[]): { min: number; max: number } | null {
  const prices = products.map(p => p.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function topScoredProducts(products: PublicProduct[], n = 3): Array<{ name: string; score: number; critic: string }> {
  return products
    .flatMap((p) => {
      if (!p.score_summary) return [];
      try {
        const parsed = JSON.parse(p.score_summary);
        const critics: Array<{ critic: string; score_value: number }> = parsed?.critics ?? [];
        if (!critics.length) return [];
        const best = critics.reduce((a, b) => a.score_value >= b.score_value ? a : b);
        return [{ name: p.name, score: best.score_value, critic: best.critic }];
      } catch { return []; }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function buildFaqData(
  regionSlug: string,
  regionName: string,
  countryName: string,
  products: PublicProduct[],
  contactUrl: string,
): FaqData {
  const varieties = topVarieties(products);
  const range = priceRange(products);
  const scored = topScoredProducts(products);
  const n = products.length;

  const q1Answer = [
    `WNLQ9 stocks ${n} bottles from ${regionName}, ${countryName}`,
    varieties.length ? `, including ${varieties.join(', ')}` : '',
    range ? `. Prices range from ฿${range.min.toLocaleString()} to ฿${range.max.toLocaleString()}` : '',
    `. Browse the collection: ${BASE}/explore-map/${regionSlug}`,
  ].join('');

  const qaItems: QAItem[] = [
    {
      question: `What ${regionName} wines and spirits does WNLQ9 carry?`,
      answer: q1Answer,
    },
  ];

  if (scored.length > 0) {
    const scoreText = scored.map(s => `${s.name} (${s.score} pts, ${s.critic})`).join('; ');
    qaItems.push({
      question: `What are the top-rated ${regionName} bottles at WNLQ9?`,
      answer: `Critic-acclaimed ${regionName} bottles at WNLQ9 include: ${scoreText}.`,
    });
  }

  qaItems.push({
    question: `How do I order ${regionName} wine from WNLQ9 in Thailand?`,
    answer: `WNLQ9 is a Bangkok-based retailer. Contact the team via LINE or WhatsApp to place an order: ${BASE}/contact`,
  });

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qaItems.map(qa => ({
      '@type': 'Question',
      name: qa.question,
      acceptedAnswer: { '@type': 'Answer', text: qa.answer },
    })),
  };

  return { qaItems, schema };
}
