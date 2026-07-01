// apps/catalog/lib/blog/hashnode-posts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the shape of data returned, not the network call.
// hashnodeQuery is mocked so tests are fast and offline.
vi.mock('./hashnode-client', () => ({
  hashnodeQuery: vi.fn(),
}));

import { hashnodeQuery } from './hashnode-client';
import { getAllPosts, getPostBySlug, getPostsByTag, getAllPostSlugs } from './hashnode-posts';

const mockPost = {
  id: 'abc123',
  title: 'Best Burgundy Wines',
  slug: 'best-burgundy-wines',
  brief: 'A guide to Burgundy.',
  publishedAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  canonicalUrl: 'https://wnlq9.shop/blog/best-burgundy-wines',
  coverImage: { url: 'https://cdn.hashnode.com/img.jpg' },
  tags: [{ name: 'Wine', slug: 'wine' }],
  seo: { title: 'Best Burgundy | WNLQ9', description: 'Our top picks.' },
  content: { html: '<p>Content</p>', markdown: '# Content' },
};

describe('getAllPosts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns array of posts from edges', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { posts: { edges: [{ node: mockPost }] } },
    });
    const posts = await getAllPosts(1);
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe('best-burgundy-wines');
  });

  it('returns empty array when no posts', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { posts: { edges: [] } },
    });
    const posts = await getAllPosts(12);
    expect(posts).toEqual([]);
  });
});

describe('getPostBySlug', () => {
  it('returns post when found', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { post: mockPost },
    });
    const post = await getPostBySlug('best-burgundy-wines');
    expect(post?.title).toBe('Best Burgundy Wines');
    expect(post?.content.html).toBe('<p>Content</p>');
  });

  it('returns null when post not found', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { post: null },
    });
    const post = await getPostBySlug('nonexistent');
    expect(post).toBeNull();
  });
});

describe('getAllPostSlugs', () => {
  it('returns slug and updatedAt pairs', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: {
        posts: {
          edges: [{ node: { slug: 'best-burgundy-wines', updatedAt: '2026-07-01T00:00:00.000Z' } }],
        },
      },
    });
    const slugs = await getAllPostSlugs();
    expect(slugs[0].slug).toBe('best-burgundy-wines');
    expect(slugs[0].updatedAt).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('getPostsByTag', () => {
  it('returns posts matching the tag', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { posts: { edges: [{ node: mockPost }] } },
    });
    const posts = await getPostsByTag('wine', 12);
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe('best-burgundy-wines');
  });

  it('returns empty array when no posts match', async () => {
    vi.mocked(hashnodeQuery).mockResolvedValue({
      publication: { posts: { edges: [] } },
    });
    const posts = await getPostsByTag('nonexistent-tag', 12);
    expect(posts).toEqual([]);
  });
});
