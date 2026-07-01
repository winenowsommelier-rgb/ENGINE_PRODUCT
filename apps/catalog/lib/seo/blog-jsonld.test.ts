// apps/catalog/lib/seo/blog-jsonld.test.ts
import { describe, it, expect } from 'vitest';
import { buildArticleSchema, buildFaqSchema } from './blog-jsonld';
import type { BlogPost } from '@/lib/blog/hashnode-posts';

const basePost: BlogPost = {
  id: 'abc',
  title: 'Best Burgundy Wines',
  slug: 'best-burgundy-wines',
  brief: 'A guide to Burgundy.',
  content: {
    html: '<p>Content</p>',
    markdown: `# Best Burgundy Wines\n\nIntro.\n\n## Frequently Asked Questions\n\n### What makes Burgundy special?\nTerrain and Pinot Noir.\n\n### How to store Burgundy?\nCool, dark place.\n\n### What food pairs with Burgundy?\nDuck and mushroom.`,
  },
  coverImage: { url: 'https://cdn.hashnode.com/cover.jpg' },
  tags: [{ name: 'Wine', slug: 'wine' }],
  publishedAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
  seo: { title: 'Best Burgundy | WNLQ9', description: 'Top picks.' },
  canonicalUrl: 'https://wnlq9.shop/blog/best-burgundy-wines',
};

describe('buildArticleSchema', () => {
  it('returns Article schema with correct fields', () => {
    const schema = buildArticleSchema(basePost, 'https://wnlq9.shop/blog/best-burgundy-wines') as Record<string, unknown>;
    expect(schema['@type']).toBe('Article');
    expect(schema.headline).toBe('Best Burgundy Wines');
    expect(schema.datePublished).toBe('2026-07-01T00:00:00.000Z');
    expect(schema.dateModified).toBe('2026-07-01T12:00:00.000Z');
    expect(schema.image).toBe('https://cdn.hashnode.com/cover.jpg');
    expect(schema.url).toBe('https://wnlq9.shop/blog/best-burgundy-wines');
    const author = schema.author as Record<string, string>;
    expect(author['@type']).toBe('Organization');
    expect(author.name).toBe('WNLQ9');
  });

  it('falls back to og-default.jpg when no coverImage', () => {
    const schema = buildArticleSchema(
      { ...basePost, coverImage: null },
      'https://wnlq9.shop/blog/test',
    ) as Record<string, unknown>;
    expect(schema.image).toBe('https://wnlq9.shop/og-default.jpg');
  });
});

describe('buildFaqSchema', () => {
  it('returns FAQPage schema when FAQ section present', () => {
    const schema = buildFaqSchema(basePost) as Record<string, unknown>;
    expect(schema).not.toBeNull();
    expect(schema['@type']).toBe('FAQPage');
    const entities = schema.mainEntity as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(3);
    expect(entities[0].name).toBe('What makes Burgundy special?');
    const answer = entities[0].acceptedAnswer as Record<string, string>;
    expect(answer.text).toContain('Terrain');
  });

  it('returns null when no FAQ section', () => {
    const post = { ...basePost, content: { html: '', markdown: '# Title\n\nNo FAQ here.' } };
    expect(buildFaqSchema(post)).toBeNull();
  });

  it('returns null when FAQ section has no valid Q+A pairs', () => {
    const post = {
      ...basePost,
      content: { html: '', markdown: '# Title\n\n## Frequently Asked Questions\n\nNo Q3 items.' },
    };
    expect(buildFaqSchema(post)).toBeNull();
  });
});
