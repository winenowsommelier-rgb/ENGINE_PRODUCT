import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs');

const mockFs = vi.mocked(fs);

// Helper: build a minimal .md file string with frontmatter
function makePost(overrides: Record<string, string> = {}, body = '# Hello'): string {
  const fm: Record<string, string> = {
    TITLE: 'Test Post',
    SLUG: 'test-post',
    DATE: '2026-07-01',
    TAGS: 'red-wine,pairing',
    ...overrides,
  };
  const block = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${block}\n---\n${body}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // ensure fresh module import after mock changes
  mockFs.readdirSync = vi.fn().mockReturnValue(['2026-07-01-test-post.md']);
  mockFs.statSync = vi.fn().mockReturnValue({ mtime: new Date('2026-07-01') });
});

describe('getAllPostsForCategory — drink slug', () => {
  it('returns posts matching wine tags', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ TAGS: 'red-wine,pairing' }));
    const { getAllPostsForCategory } = await import('./local-posts');
    const posts = getAllPostsForCategory('wine');
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe('test-post');
  });

  it('returns empty array when no posts match the drink category', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ TAGS: 'bangkok,restaurants' }));
    const { getAllPostsForCategory } = await import('./local-posts');
    const posts = getAllPostsForCategory('sake');
    expect(posts).toHaveLength(0);
  });
});

describe('getAllPostsForCategory — purpose slug', () => {
  it('returns posts matching pairing tag', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ TAGS: 'red-wine,pairing' }));
    const { getAllPostsForCategory } = await import('./local-posts');
    const posts = getAllPostsForCategory('pairings');
    expect(posts).toHaveLength(1);
  });

  it('returns empty array for purpose category with no matching posts', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ TAGS: 'red-wine,france' }));
    const { getAllPostsForCategory } = await import('./local-posts');
    const posts = getAllPostsForCategory('gifting');
    expect(posts).toHaveLength(0);
  });
});

describe('featured frontmatter field', () => {
  it('sets featured=true when FEATURED: true in frontmatter (bare value, no quotes)', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ FEATURED: 'true', TAGS: 'wine' }));
    const { getAllPosts } = await import('./local-posts');
    const posts = getAllPosts(1);
    expect(posts[0].featured).toBe(true);
  });

  it('sets featured=false when FEATURED key is absent', async () => {
    mockFs.readFileSync = vi.fn().mockReturnValue(makePost({ TAGS: 'wine' }));
    const { getAllPosts } = await import('./local-posts');
    const posts = getAllPosts(1);
    expect(posts[0].featured).toBe(false);
  });
});

describe('briefFromMarkdown', () => {
  // Regression guard: Aug-2026 drip posts opened with a markdown image, and the
  // old brief fallback leaked raw "![alt](url)" text into category-page cards.
  it('strips a leading markdown image instead of leaking it into the brief', async () => {
    const { briefFromMarkdown } = await import('./local-posts');
    const brief = briefFromMarkdown(
      '![Riesling grapes](https://example.com/x.jpg)\n\nGUIDE  ·  WHITE WINE\n\nGerman wine has one of the most complex label systems in the world — and most buyers give up before they understand it.'
    );
    expect(brief).not.toContain('![');
    expect(brief).not.toContain('example.com');
    expect(brief).toMatch(/^German wine has/);
  });

  it('strips product-embed comments, headings, and emphasis markers', async () => {
    const { briefFromMarkdown } = await import('./local-posts');
    const brief = briefFromMarkdown(
      '## Heading\n\n<!-- product: WWW5371AB -->\n\nThis is the **first** real paragraph of prose, long enough to survive the label-line filter easily.'
    );
    expect(brief).not.toContain('#');
    expect(brief).not.toContain('product:');
    expect(brief).toMatch(/^This is the first real paragraph/);
  });
});
