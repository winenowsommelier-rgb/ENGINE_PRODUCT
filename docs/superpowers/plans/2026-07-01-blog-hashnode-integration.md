# Blog — Hashnode Headless Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully SEO/AEO-optimised blog at `wnlq9.shop/blog` backed by Hashnode as a free headless CMS, with a CLI publish script so Claude Code can write and publish posts directly.

**Architecture:** Next.js App Router server components fetch posts from Hashnode's public GraphQL API at request time (ISR, revalidate 3600s). The Next.js app owns all canonical URLs, metadata, and JSON-LD structured data. Phase 2 adds in-post product card embeds by parsing `<!-- product: SKU -->` HTML comments and resolving them against `live_products_export.json`.

**Tech Stack:** Next.js 14 App Router, Vitest, Hashnode GraphQL API (`https://gql.hashnode.com`), `dotenv` (for publish script only), Tailwind CSS / `prose` for post body styling.

**Spec:** `docs/superpowers/specs/2026-07-01-blog-hashnode-integration-design.md`

---

## Pre-Flight: Hashnode Account Setup (manual, one-time — do before Task 1)

These steps cannot be scripted. Do them in the browser before running any code:

1. Create a Hashnode account at `https://hashnode.com`
2. Create a new publication — name it "WNLQ9 Journal"
3. In publication Settings → **Advanced** → set custom domain to `wnlq9.shop` (for canonical URL signal — no DNS change needed)
4. Go to Settings → **Developer → Access Tokens** → generate a PAT token
5. Go to Settings → **General** → copy the Publication ID (long hex string)
6. Add to `.env.local` in the repo root:
   ```
   HASHNODE_TOKEN=<your PAT>
   HASHNODE_PUBLICATION_ID=<your publication hex ID>
   ```
7. Add both variables to the Vercel project `wnlq9-catalog` (Settings → Environment Variables → Production + Preview)

---

## File Map

### New Files (Phase 1)
```
apps/catalog/lib/blog/hashnode-client.ts      — hashnodeQuery<T>() fetch wrapper
apps/catalog/lib/blog/hashnode-posts.ts       — getAllPosts, getPostBySlug, getPostsByTag, getAllPostSlugs + BlogPost type
apps/catalog/lib/blog/hashnode-posts.test.ts  — unit tests (mock fetch)
apps/catalog/lib/seo/blog-jsonld.ts           — buildArticleSchema(), buildFaqSchema()
apps/catalog/lib/seo/blog-jsonld.test.ts      — unit tests
apps/catalog/app/blog/page.tsx                — /blog index (revalidate=3600, getAllPosts(12))
apps/catalog/app/blog/[slug]/page.tsx         — /blog/[slug] single post (ISR, dynamicParams=true)
apps/catalog/app/blog/tag/[tag]/page.tsx      — /blog/tag/[tag] filtered list
apps/catalog/components/blog/PostCard.tsx     — card for index/tag listing
apps/catalog/components/blog/PostBody.tsx     — post HTML renderer (Phase 1: direct; Phase 2: embed splitting)
scripts/blog-publish.ts                       — CLI: npx tsx scripts/blog-publish.ts
```

### New Files (Phase 2)
```
apps/catalog/lib/blog/resolve-product-embeds.ts       — resolveProductEmbeds(html, allProducts)
apps/catalog/lib/blog/resolve-product-embeds.test.ts  — unit tests
apps/catalog/components/blog/InlineProductCard.tsx    — per-SKU inline product card
apps/catalog/components/blog/RelatedProducts.tsx      — tag-matched product row at post bottom
```

### Modified Files
```
apps/catalog/components/Header.tsx    — add "Journal" nav link
apps/catalog/app/sitemap.ts           — convert to async + append blog post URLs (Phase 2)
apps/catalog/next.config.js           — add cdn.hashnode.com to remotePatterns (Phase 2)
```

---

## Phase 1 — Core Blog Infrastructure

---

### Task 1: Hashnode GraphQL client

**Files:**
- Create: `apps/catalog/lib/blog/hashnode-client.ts`

This is a thin fetch wrapper. No test needed — it is a one-function I/O adapter; errors surface in Task 2 tests via mocked fetch.

- [ ] **Step 1: Create the client**

```typescript
// apps/catalog/lib/blog/hashnode-client.ts
const ENDPOINT = 'https://gql.hashnode.com';

export async function hashnodeQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`Hashnode API error: ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(`Hashnode GQL error: ${json.errors[0].message}`);

  return json.data as T;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/lib/blog/hashnode-client.ts
git commit -m "feat(blog): add Hashnode GraphQL client"
```

---

### Task 2: Post fetching functions + BlogPost type

**Files:**
- Create: `apps/catalog/lib/blog/hashnode-posts.ts`
- Create: `apps/catalog/lib/blog/hashnode-posts.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd apps/catalog && npx vitest run lib/blog/hashnode-posts.test.ts
```

Expected: FAIL — `Cannot find module './hashnode-posts'`

- [ ] **Step 3: Implement hashnode-posts.ts**

```typescript
// apps/catalog/lib/blog/hashnode-posts.ts
import { hashnodeQuery } from './hashnode-client';

export type BlogPost = {
  id: string
  title: string
  slug: string
  brief: string
  content: { html: string; markdown: string }
  coverImage: { url: string } | null
  tags: { name: string; slug: string }[]
  publishedAt: string
  updatedAt: string
  seo: { title: string | null; description: string | null }
  canonicalUrl: string | null
}

type PostNode = Omit<BlogPost, 'content'> & { content?: BlogPost['content'] }

const PUB_ID = process.env.HASHNODE_PUBLICATION_ID ?? '';

const POST_FIELDS = `
  id title slug brief publishedAt updatedAt canonicalUrl
  coverImage { url }
  tags { name slug }
  seo { title description }
`;

export async function getAllPosts(first = 12): Promise<BlogPost[]> {
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: PostNode }[] } } }>(
    `query GetPosts($publicationId: ObjectId!, $first: Int!) {
      publication(id: $publicationId) {
        posts(first: $first) {
          edges { node { ${POST_FIELDS} } }
        }
      }
    }`,
    { publicationId: PUB_ID, first },
  );
  return data.publication.posts.edges.map((e) => e.node as BlogPost);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const data = await hashnodeQuery<{ publication: { post: BlogPost | null } }>(
    `query GetPost($publicationId: ObjectId!, $slug: String!) {
      publication(id: $publicationId) {
        post(slug: $slug) {
          ${POST_FIELDS}
          content { html markdown }
        }
      }
    }`,
    { publicationId: PUB_ID, slug },
  );
  return data.publication.post;
}

export async function getPostsByTag(tag: string, first = 12): Promise<BlogPost[]> {
  // NOTE: verify filter: { tagSlugs } is supported by the live Hashnode schema before
  // shipping tag pages. If not, fetch getAllPosts and filter client-side by tag slug.
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: PostNode }[] } } }>(
    `query GetPostsByTag($publicationId: ObjectId!, $first: Int!, $tag: String!) {
      publication(id: $publicationId) {
        posts(first: $first, filter: { tagSlugs: [$tag] }) {
          edges { node { ${POST_FIELDS} } }
        }
      }
    }`,
    { publicationId: PUB_ID, first, tag },
  );
  return data.publication.posts.edges.map((e) => e.node as BlogPost);
}

export async function getAllPostSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  // Ceiling: 250 posts. Hashnode uses cursor-based pagination; first: 250 silently
  // truncates if publication exceeds 250 posts. Add pagination loop when needed.
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: { slug: string; updatedAt: string } }[] } } }>(
    `query GetSlugs($publicationId: ObjectId!) {
      publication(id: $publicationId) {
        posts(first: 250) {
          edges { node { slug updatedAt } }
        }
      }
    }`,
    { publicationId: PUB_ID },
  );
  return data.publication.posts.edges.map((e) => e.node);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/catalog && npx vitest run lib/blog/hashnode-posts.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/blog/hashnode-posts.ts apps/catalog/lib/blog/hashnode-posts.test.ts
git commit -m "feat(blog): add post fetching functions and BlogPost type"
```

---

### Task 3: Blog JSON-LD schemas (Article + FAQPage)

**Files:**
- Create: `apps/catalog/lib/seo/blog-jsonld.ts`
- Create: `apps/catalog/lib/seo/blog-jsonld.test.ts`

Follow the same pattern as `apps/catalog/lib/seo/jsonld.ts` and `faq-builder.ts`.

- [ ] **Step 1: Write failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/catalog && npx vitest run lib/seo/blog-jsonld.test.ts
```

Expected: FAIL — `Cannot find module './blog-jsonld'`

- [ ] **Step 3: Implement blog-jsonld.ts**

```typescript
// apps/catalog/lib/seo/blog-jsonld.ts
import type { BlogPost } from '@/lib/blog/hashnode-posts';

const BASE = 'https://wnlq9.shop';

export function buildArticleSchema(post: BlogPost, url: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    image: post.coverImage?.url ?? `${BASE}/og-default.jpg`,
    url,
    author: { '@type': 'Organization', name: 'WNLQ9', url: BASE },
    publisher: {
      '@type': 'Organization',
      name: 'WNLQ9',
      logo: { '@type': 'ImageObject', url: `${BASE}/og-default.jpg` },
    },
  };
}

export function buildFaqSchema(post: BlogPost): object | null {
  const parts = post.content.markdown.split('## Frequently Asked Questions');
  if (parts.length < 2) return null;

  const faqSection = parts[1];
  const regex = /^### (.+)\n+([\s\S]+?)(?=\n###|\n##|$)/gm;
  const pairs: { question: string; answer: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(faqSection)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer) pairs.push({ question, answer });
  }

  if (pairs.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/catalog && npx vitest run lib/seo/blog-jsonld.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/seo/blog-jsonld.ts apps/catalog/lib/seo/blog-jsonld.test.ts
git commit -m "feat(blog): add Article and FAQPage JSON-LD schema builders"
```

---

### Task 4: PostCard and PostBody components

**Files:**
- Create: `apps/catalog/components/blog/PostCard.tsx`
- Create: `apps/catalog/components/blog/PostBody.tsx`

No unit tests — these are pure rendering components. Verified visually in Task 7.

- [ ] **Step 1: Create PostCard**

```typescript
// apps/catalog/components/blog/PostCard.tsx
import Image from 'next/image';
import Link from 'next/link';
import type { BlogPost } from '@/lib/blog/hashnode-posts';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function PostCard({ post }: { post: BlogPost }) {
  const brief = post.brief.length > 120 ? post.brief.slice(0, 120) + '…' : post.brief;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition-shadow hover:shadow-md">
      {post.coverImage && (
        <div className="relative aspect-video w-full overflow-hidden rounded-md">
          <Image
            src={post.coverImage.url}
            alt={post.title}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {post.tags.map((tag) => (
          <span key={tag.slug} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {tag.name}
          </span>
        ))}
      </div>
      <h2 className="text-lg font-semibold leading-snug text-foreground">{post.title}</h2>
      <p className="text-sm text-muted-foreground">{brief}</p>
      <div className="mt-auto flex items-center justify-between">
        <time className="text-xs text-muted-foreground" dateTime={post.publishedAt}>
          {formatDate(post.publishedAt)}
        </time>
        <Link
          href={`/blog/${post.slug}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Read more →
        </Link>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Create PostBody (Phase 1 — direct render, no embeds yet)**

```typescript
// apps/catalog/components/blog/PostBody.tsx
// Hashnode sanitizes content.html before delivery — we trust this output.
// Phase 2: split on <!-- product: SKU --> comments and render InlineProductCard nodes.
import type { BlogPost } from '@/lib/blog/hashnode-posts';

export function PostBody({ html }: { html: string }) {
  return (
    <div
      className="prose prose-neutral max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/blog/PostCard.tsx apps/catalog/components/blog/PostBody.tsx
git commit -m "feat(blog): add PostCard and PostBody components"
```

---

### Task 5: Blog index page (`/blog`)

**Files:**
- Create: `apps/catalog/app/blog/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// apps/catalog/app/blog/page.tsx
import type { Metadata } from 'next';
import { getAllPosts } from '@/lib/blog/hashnode-posts';
import { PostCard } from '@/components/blog/PostCard';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'WNLQ9 Journal — Wine, Whisky & Spirits',
  description:
    'Tasting notes, pairing guides, and regional deep-dives from WNLQ9, Bangkok.',
  alternates: { canonical: 'https://wnlq9.shop/blog' },
};

export default async function BlogIndexPage() {
  const posts = await getAllPosts(12);

  return (
    <main className="container py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Journal</h1>
      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet — check back soon.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/app/blog/page.tsx
git commit -m "feat(blog): add /blog index page"
```

---

### Task 6: Single post page (`/blog/[slug]`)

**Files:**
- Create: `apps/catalog/app/blog/[slug]/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// apps/catalog/app/blog/[slug]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts, getPostBySlug } from '@/lib/blog/hashnode-posts';
import { PostBody } from '@/components/blog/PostBody';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildArticleSchema, buildFaqSchema } from '@/lib/seo/blog-jsonld';

export const revalidate = 3600;
export const dynamicParams = true; // posts not in generateStaticParams served via ISR

const BASE = 'https://wnlq9.shop';

export async function generateStaticParams() {
  // Pre-render newest 50 at build; posts 51-250 served by ISR on first request
  const posts = await getAllPosts(50);
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  if (!post) return {};

  const url = `${BASE}/blog/${post.slug}`;
  return {
    title: post.seo.title ?? `${post.title} | WNLQ9 Journal`,
    description: post.seo.description ?? post.brief ?? '',
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: post.seo.title ?? post.title,
      description: post.seo.description ?? post.brief ?? '',
      images: post.coverImage
        ? [{ url: post.coverImage.url }]
        : [{ url: `${BASE}/og-default.jpg` }],
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const post = await getPostBySlug(params.slug);
  if (!post) notFound();

  const url = `${BASE}/blog/${post.slug}`;
  const faqSchema = buildFaqSchema(post);

  return (
    <main className="container max-w-3xl py-12">
      <article>
        <h1 className="mb-4 text-3xl font-bold leading-tight tracking-tight">{post.title}</h1>
        <time className="mb-8 block text-sm text-muted-foreground" dateTime={post.publishedAt}>
          {new Date(post.publishedAt).toLocaleDateString('en-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </time>
        <PostBody html={post.content.html} />
      </article>
      <JsonLd data={buildArticleSchema(post, url)} />
      {faqSchema && <JsonLd data={faqSchema} />}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/app/blog/[slug]/page.tsx
git commit -m "feat(blog): add /blog/[slug] single post page with Article+FAQ JSON-LD"
```

---

### Task 7: Tag page (`/blog/tag/[tag]`)

**Files:**
- Create: `apps/catalog/app/blog/tag/[tag]/page.tsx`

**Important:** Before implementing, test that the `getPostsByTag` GraphQL filter works against the live Hashnode API. If `filter: { tagSlugs }` is not supported, replace the call with `getAllPosts(50)` and filter by `post.tags.some(t => t.slug === tag)` in the page component.

- [ ] **Step 1: Create the page**

```typescript
// apps/catalog/app/blog/tag/[tag]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPostsByTag } from '@/lib/blog/hashnode-posts';
import { PostCard } from '@/components/blog/PostCard';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: { tag: string };
}): Promise<Metadata> {
  const label = params.tag.replace(/-/g, ' ');
  return {
    title: `${label} | WNLQ9 Journal`,
    description: `Posts tagged "${label}" from WNLQ9 Journal.`,
    alternates: { canonical: `https://wnlq9.shop/blog/tag/${params.tag}` },
  };
}

export default async function TagPage({ params }: { params: { tag: string } }) {
  const posts = await getPostsByTag(params.tag, 12);
  if (posts.length === 0) notFound();

  const label = params.tag.replace(/-/g, ' ');

  return (
    <main className="container py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight capitalize">{label}</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/app/blog/tag/[tag]/page.tsx
git commit -m "feat(blog): add /blog/tag/[tag] filtered post listing page"
```

---

### Task 8: Add "Journal" to navigation

**Files:**
- Modify: `apps/catalog/components/Header.tsx` — add `{ href: '/blog', label: 'Journal' }` to `NAV_LINKS`

- [ ] **Step 1: Edit Header.tsx**

In `apps/catalog/components/Header.tsx`, locate the `NAV_LINKS` constant (search for `const NAV_LINKS`) and add the Journal link:

```typescript
const NAV_LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/finder', label: 'Find Your Match' },
  { href: '/explore-map', label: 'Explore by Map' },
  { href: '/blog', label: 'Journal' },           // ← add this line
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/components/Header.tsx
git commit -m "feat(blog): add Journal nav link to header"
```

---

### Task 9: CLI publish script

**Files:**
- Create: `scripts/blog-publish.ts`
- Requires: `dotenv` package (check if already in `package.json`; if not, `npm install dotenv -w apps/catalog` or add to root)

- [ ] **Step 1: Check dotenv availability**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && grep '"dotenv"' package.json apps/catalog/package.json 2>/dev/null || echo "not found — install needed"
```

If not found: `npm install dotenv` from repo root (or whichever package.json owns scripts deps).

- [ ] **Step 2: Create the publish script**

```typescript
// scripts/blog-publish.ts
// Usage (run from repo root):
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --file post.md
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --stdin
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-image https://...
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-sku WN0001
//
// Must be run from repo root. --cover-sku reads data/live_products_export.json.
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

dotenv.config({ path: '.env.local' }); // loads .env.local from repo root

const TOKEN = process.env.HASHNODE_TOKEN;
const PUB_ID = process.env.HASHNODE_PUBLICATION_ID;

if (!TOKEN || !PUB_ID) {
  console.error('Missing HASHNODE_TOKEN or HASHNODE_PUBLICATION_ID in .env.local');
  process.exit(1);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? 'true';
      i++;
    }
  }
  return args;
}

async function readStdin(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveProductImageUrl(coverSku: string): string {
  const exportPath = path.join(process.cwd(), 'data', 'live_products_export.json');
  const products: Array<{ sku: string; image_url?: string | null }> = JSON.parse(
    fs.readFileSync(exportPath, 'utf8'),
  );
  const product = products.find((p) => p.sku === coverSku);
  if (!product) {
    console.warn(`⚠ SKU ${coverSku} not found in live_products_export.json`);
    const s = coverSku;
    return `https://wnlq9.shop/media/catalog/product/${s[0].toLowerCase()}/${s[1].toLowerCase()}/${s}.jpg`;
  }
  if (product.image_url) return product.image_url;
  console.warn(
    `⚠ image_url is null for ${coverSku} — using constructed CDN path, verify the image is correct`,
  );
  return `https://wnlq9.shop/media/catalog/product/${coverSku[0].toLowerCase()}/${coverSku[1].toLowerCase()}/${coverSku}.jpg`;
}

async function publish(
  title: string,
  tags: string[],
  contentMarkdown: string,
  slug: string,
  coverImageURL?: string,
  metaTitle?: string,
  metaDesc?: string,
): Promise<void> {
  const input: Record<string, unknown> = {
    publicationId: PUB_ID,
    title,
    slug,
    contentMarkdown,
    freeformTags: tags,
    canonicalUrl: `https://wnlq9.shop/blog/${slug}`,
    isNewsletterActivated: false,
  };
  if (coverImageURL) input.coverImageOptions = { coverImageURL };
  if (metaTitle || metaDesc) input.metaTags = { title: metaTitle, description: metaDesc };

  const res = await fetch('https://gql.hashnode.com', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        mutation PublishPost($input: PublishPostInput!) {
          publishPost(input: $input) {
            post { id title slug url }
          }
        }
      `,
      variables: { input },
    }),
  });

  const json = await res.json();
  if (json.errors?.length) {
    console.error('Publish failed:', json.errors[0].message);
    process.exit(1);
  }

  const post = json.data.publishPost.post;
  console.log(`✓ Published: https://wnlq9.shop/blog/${post.slug}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const title = args.title;
  if (!title) { console.error('--title is required'); process.exit(1); }

  const tags = (args.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const slug = args.slug ?? slugify(title);

  let contentMarkdown: string;
  if (args.file) {
    contentMarkdown = fs.readFileSync(args.file, 'utf8');
  } else if (args.stdin !== undefined) {
    contentMarkdown = await readStdin();
  } else {
    console.error('Provide --file <path> or --stdin');
    process.exit(1);
  }

  let coverImageURL: string | undefined;
  if (args['cover-image']) coverImageURL = args['cover-image'];
  else if (args['cover-sku']) coverImageURL = resolveProductImageUrl(args['cover-sku']);

  await publish(
    title,
    tags,
    contentMarkdown,
    slug,
    coverImageURL,
    args['meta-title'],
    args['meta-desc'],
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Smoke-test (dry run — no real publish)**

Verify the script parses arguments without errors:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
echo "# Test\n\nContent." > /tmp/test-post.md
# This will fail at the publish step (no real Hashnode token yet) but should parse cleanly
npx tsx scripts/blog-publish.ts --title "Test Post" --tags "wine" --file /tmp/test-post.md 2>&1 | head -5
```

Expected: Either `✓ Published:` (if token is set) or `Missing HASHNODE_TOKEN` (if not — correct error).

- [ ] **Step 4: Commit**

```bash
git add scripts/blog-publish.ts
git commit -m "feat(blog): add CLI publish script for Claude→Hashnode direct posting"
```

---

### Task 10: Run full test suite + build check

- [ ] **Step 1: Run all tests**

```bash
cd apps/catalog && npx vitest run
```

Expected: all existing tests + new blog-jsonld + hashnode-posts tests PASS

- [ ] **Step 2: Build check**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run build 2>&1 | tail -20
```

Expected: build succeeds. If TypeScript errors, fix them before proceeding.

- [ ] **Step 3: Start dev server and verify `/blog` renders**

```bash
cd apps/catalog && npm run dev -- --port 3100
```

Open `http://localhost:3100/blog` — expect:
- "Journal" heading
- Either a post grid (if Hashnode publication has posts) or "No posts yet" message
- No console errors

Open `http://localhost:3100` — verify Journal link appears in the header nav.

- [ ] **Step 4: Publish a test post and verify it renders**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cat > /tmp/test-wine-post.md << 'EOF'
# Top 3 Burgundy Wines to Try in Bangkok

Burgundy is the spiritual home of Pinot Noir. Here are our picks for 2026.

## Why Burgundy?

The combination of limestone soils and continental climate produces wines of unmatched elegance.

## Our Top Picks

Gevrey-Chambertin, Chambolle-Musigny, and Vosne-Romanée are the villages to know.

## Frequently Asked Questions

### What makes Burgundy wine special?
Burgundy's terroir — chalky limestone soils and a cool continental climate — gives Pinot Noir a minerality and finesse found nowhere else in the world.

### How much does Burgundy wine cost in Bangkok?
At WNLQ9, village-level Burgundy starts around ฿2,500. Premier Cru bottles range from ฿5,000–฿25,000 depending on producer and vintage.

### Can I order Burgundy wine for delivery in Bangkok?
Yes — contact WNLQ9 via LINE or WhatsApp at wnlq9.shop/contact and we will arrange same-day or next-day delivery within Bangkok.

---
*Explore our wine collection at [WNLQ9](https://wnlq9.shop/shop).*
EOF
npx tsx scripts/blog-publish.ts --title "Top 3 Burgundy Wines to Try in Bangkok" --tags "wine,burgundy,france" --file /tmp/test-wine-post.md
```

Then open `http://localhost:3100/blog` — the post card should appear (after ISR or dev server refresh).
Open the post — verify Article and FAQPage JSON-LD appear in page source (`<script type="application/ld+json">`).

- [ ] **Step 5: Commit any fixes, then tag Phase 1 complete**

```bash
git tag blog-phase-1
```

---

## Phase 2 — Product Integration

---

### Task 11: In-post product embed resolver

**Files:**
- Create: `apps/catalog/lib/blog/resolve-product-embeds.ts`
- Create: `apps/catalog/lib/blog/resolve-product-embeds.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/catalog/lib/blog/resolve-product-embeds.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProductEmbeds } from './resolve-product-embeds';
import type { PublicProduct } from '@/lib/types';

const makeProduct = (sku: string): PublicProduct =>
  ({ sku, name: `Product ${sku}`, price: 1000 } as unknown as PublicProduct);

const products = [makeProduct('WN0001'), makeProduct('WN0002'), makeProduct('WS0001')];

describe('resolveProductEmbeds', () => {
  it('returns map of matched SKUs', () => {
    const html = '<p>Try this <!-- product: WN0001 --> with dinner.</p>';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(1);
    expect(map.get('WN0001')?.name).toBe('Product WN0001');
  });

  it('handles multiple embeds', () => {
    const html = '<!-- product: WN0001 --> and <!-- product: WS0001 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(2);
    expect(map.has('WN0001')).toBe(true);
    expect(map.has('WS0001')).toBe(true);
  });

  it('silently skips unmatched SKUs', () => {
    const html = '<!-- product: ZZ9999 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(0);
  });

  it('is case-insensitive for SKU matching', () => {
    const html = '<!-- product: wn0001 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(1);
  });

  it('returns empty map when no embeds', () => {
    const map = resolveProductEmbeds('<p>No embeds here.</p>', products);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/catalog && npx vitest run lib/blog/resolve-product-embeds.test.ts
```

- [ ] **Step 3: Implement resolve-product-embeds.ts**

```typescript
// apps/catalog/lib/blog/resolve-product-embeds.ts
import type { PublicProduct } from '@/lib/types';

export function resolveProductEmbeds(
  html: string,
  allProducts: PublicProduct[],
): Map<string, PublicProduct> {
  const productBySku = new Map(allProducts.map((p) => [p.sku.toUpperCase(), p]));
  const result = new Map<string, PublicProduct>();

  // Regex created inside function — a module-level /gi regex maintains lastIndex state
  // on the object and would produce "skips every other match" bugs if called outside
  // an exhausted loop (e.g. after refactoring or early return).
  const re = /<!--\s*product:\s*([A-Z0-9]+)\s*-->/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const sku = match[1].toUpperCase();
    const product = productBySku.get(sku);
    if (product) result.set(sku, product);
  }

  return result;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/catalog && npx vitest run lib/blog/resolve-product-embeds.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/blog/resolve-product-embeds.ts apps/catalog/lib/blog/resolve-product-embeds.test.ts
git commit -m "feat(blog): add resolveProductEmbeds for inline product card resolution"
```

---

### Task 12: InlineProductCard component

**Files:**
- Create: `apps/catalog/components/blog/InlineProductCard.tsx`

- [ ] **Step 1: Check how the LINE contact URL is built in existing product pages**

```bash
grep -r "LINE\|line\.me\|lineUrl\|contact" apps/catalog/lib/contact.ts apps/catalog/lib/contact-env.ts 2>/dev/null | head -10
```

Use the same URL pattern. Typically: `process.env.NEXT_PUBLIC_LINE_URL` or equivalent.

- [ ] **Step 2: Create InlineProductCard**

```typescript
// apps/catalog/components/blog/InlineProductCard.tsx
import Image from 'next/image';
import Link from 'next/link';
import type { PublicProduct } from '@/lib/types';

export function InlineProductCard({ product }: { product: PublicProduct }) {
  const price = product.price ? `฿${product.price.toLocaleString()}` : null;

  return (
    <aside className="my-4 flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-3 not-prose">
      {product.image_url && (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-0.5">
        <Link href={`/product/${product.sku}`} className="text-sm font-semibold text-foreground hover:text-primary">
          {product.name}
        </Link>
        {price && <span className="text-sm text-muted-foreground">{price}</span>}
      </div>
      <Link
        href="/contact"
        className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Order
      </Link>
    </aside>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/blog/InlineProductCard.tsx
git commit -m "feat(blog): add InlineProductCard for in-post product embeds"
```

---

### Task 13: Wire product embeds into PostBody + [slug] page

**Files:**
- Modify: `apps/catalog/components/blog/PostBody.tsx` — split HTML on embed comments, render React node array
- Modify: `apps/catalog/app/blog/[slug]/page.tsx` — load products, call resolveProductEmbeds, pass productMap

- [ ] **Step 1: Update PostBody to render embed nodes**

Replace the Phase 1 `PostBody` implementation:

```typescript
// apps/catalog/components/blog/PostBody.tsx
// Hashnode sanitizes content.html before delivery — we trust this output.
// Product embed comments (<!-- product: SKU -->) are replaced with InlineProductCard nodes.
import type React from 'react';
import type { PublicProduct } from '@/lib/types';
import { InlineProductCard } from './InlineProductCard';

export function PostBody({
  html,
  productMap,
}: {
  html: string;
  productMap?: Map<string, PublicProduct>;
}) {
  if (!productMap || productMap.size === 0) {
    return <div className="prose prose-neutral max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Split on embed comments and interleave InlineProductCard React nodes.
  // This avoids ReactDOMServer.renderToStaticMarkup (string injection bypasses reconciliation).
  // Regex created inside function scope — avoids lastIndex state bugs with module-level /gi regex.
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  const re = /<!--\s*product:\s*([A-Z0-9]+)\s*-->/gi;

  while ((match = re.exec(html)) !== null) {
    const sku = match[1].toUpperCase();
    const product = productMap.get(sku);
    if (match.index > lastIndex) {
      parts.push(html.slice(lastIndex, match.index));
    }
    if (product) {
      parts.push(<InlineProductCard key={`embed-${sku}-${i++}`} product={product} />);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) parts.push(html.slice(lastIndex));

  return (
    <div className="prose prose-neutral max-w-none">
      {parts.map((part, idx) =>
        typeof part === 'string' ? (
          <span key={idx} dangerouslySetInnerHTML={{ __html: part }} />
        ) : (
          part
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update [slug]/page.tsx to load products and pass productMap**

Add these imports to `apps/catalog/app/blog/[slug]/page.tsx`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { PublicProduct } from '@/lib/types';
import { resolveProductEmbeds } from '@/lib/blog/resolve-product-embeds';
```

Add a helper to load products (below imports, above the page component):

```typescript
function loadAllProducts(): PublicProduct[] {
  const candidates = [
    path.join(process.cwd(), 'apps', 'catalog', 'data', 'live_products_export.json'),
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
```

In the `BlogPostPage` component, before the return statement, add:

```typescript
const allProducts = loadAllProducts();
const productMap = resolveProductEmbeds(post.content.html, allProducts);
```

And update the `<PostBody>` render call to:

```typescript
<PostBody html={post.content.html} productMap={productMap} />
```

- [ ] **Step 3: Run full test suite**

```bash
cd apps/catalog && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/blog/PostBody.tsx apps/catalog/app/blog/[slug]/page.tsx
git commit -m "feat(blog): wire product embeds into PostBody and [slug] page"
```

---

### Task 14: RelatedProducts component

**Files:**
- Create: `apps/catalog/components/blog/RelatedProducts.tsx`

`RelatedProducts` accepts `allProducts` as a prop — the page already loads the product list once for `resolveProductEmbeds`, so we pass the same array here instead of reading the file a second time.

- [ ] **Step 1: Create RelatedProducts**

```typescript
// apps/catalog/components/blog/RelatedProducts.tsx
import Link from 'next/link';
import Image from 'next/image';
import type { BlogPost } from '@/lib/blog/hashnode-posts';
import type { PublicProduct } from '@/lib/types';
import { isInStock } from '@/lib/utils';

function normalize(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '-');
}

function matchesTag(product: PublicProduct, tagSlug: string, tagName: string): boolean {
  if (product.region && normalize(product.region) === tagSlug) return true;
  if (product.name.toLowerCase().includes(tagName.toLowerCase())) return true;
  if (product.category_group && normalize(product.category_group) === tagSlug) return true;
  return false;
}

export function RelatedProducts({
  tags,
  allProducts,
}: {
  tags: BlogPost['tags'];
  allProducts: PublicProduct[];
}) {
  const seen = new Set<string>();
  const matched: PublicProduct[] = [];

  for (const product of allProducts) {
    if (!isInStock(product.is_in_stock)) continue;
    if (seen.has(product.sku)) continue;
    if (tags.some((t) => matchesTag(product, t.slug, t.name))) {
      seen.add(product.sku);
      matched.push(product);
    }
    if (matched.length >= 4) break;
  }

  if (matched.length === 0) return null;

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="mb-4 text-xl font-semibold">You might also like</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {matched.map((p) => (
          <Link
            key={p.sku}
            href={`/product/${p.sku}`}
            className="flex flex-col gap-2 rounded-lg border border-border p-3 transition-shadow hover:shadow-md"
          >
            {p.image_url && (
              <div className="relative aspect-square w-full overflow-hidden rounded-md">
                <Image src={p.image_url} alt={p.name} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
              </div>
            )}
            <span className="line-clamp-2 text-xs font-medium text-foreground">{p.name}</span>
            {p.price && <span className="text-xs text-muted-foreground">฿{p.price.toLocaleString()}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add RelatedProducts to [slug]/page.tsx**

In `apps/catalog/app/blog/[slug]/page.tsx`, import and add below `<PostBody>`. The page already has `allProducts` loaded (from Task 13 Step 2) — pass it as a prop so we don't read the file twice:

```typescript
import { RelatedProducts } from '@/components/blog/RelatedProducts';

// Inside BlogPostPage, after <PostBody>:
<RelatedProducts tags={post.tags} allProducts={allProducts} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/components/blog/RelatedProducts.tsx apps/catalog/app/blog/[slug]/page.tsx
git commit -m "feat(blog): add RelatedProducts section to post pages"
```

---

### Task 15: Sitemap + next.config.js updates

**Files:**
- Modify: `apps/catalog/app/sitemap.ts` — convert to async + append blog URLs
- Modify: `apps/catalog/next.config.js` — add cdn.hashnode.com to remotePatterns

- [ ] **Step 1: Update next.config.js**

In `apps/catalog/next.config.js`, add `cdn.hashnode.com` to `remotePatterns`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'th.wine-now.com', pathname: '/media/**' },
      { protocol: 'https', hostname: 'cdn.hashnode.com' },
    ],
  },
};
module.exports = nextConfig;
```

- [ ] **Step 2: Update sitemap.ts to async with blog entries**

Convert `sitemap.ts` to async and add blog posts. The function signature changes from `() => MetadataRoute.Sitemap` to `async () => Promise<MetadataRoute.Sitemap>`:

```typescript
// apps/catalog/app/sitemap.ts — add this import at the top with the other imports:
import { getAllPostSlugs } from '@/lib/blog/hashnode-posts';

// Then replace the export default function with:
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const buildDate = new Date().toISOString().split('T')[0];
  const products = getRawProducts();
  const { regions } = loadExploreMapData();

  // ... (keep all existing core/groupUrls/productUrls/regionUrls logic unchanged) ...

  // Blog posts — wrapped in try/catch so build never fails if Hashnode is down
  let blogUrls: MetadataRoute.Sitemap = [];
  try {
    const slugs = await getAllPostSlugs();
    blogUrls = slugs.map(({ slug, updatedAt }) => ({
      url: `${BASE}/blog/${slug}`,
      lastModified: new Date(updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }));
  } catch (err) {
    console.warn('sitemap: failed to fetch blog posts from Hashnode, skipping blog URLs', err);
  }

  return [...core, ...groupUrls, ...productUrls, ...regionUrls, ...blogUrls];
}
```

Also add the blog index URL to `core`:
```typescript
{ url: `${BASE}/blog`, lastModified: buildDate, changeFrequency: 'weekly' as const },
```

- [ ] **Step 3: Run build to confirm sitemap compiles**

```bash
cd apps/catalog && npm run build 2>&1 | grep -E 'error|warn|sitemap' | head -20
```

Expected: no TypeScript errors related to sitemap or async/await.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/next.config.js apps/catalog/app/sitemap.ts
git commit -m "feat(blog): extend sitemap with blog post URLs + add cdn.hashnode.com image domain"
```

---

### Task 16: Final Phase 2 verification

- [ ] **Step 1: Run all tests**

```bash
cd apps/catalog && npx vitest run
```

Expected: all tests PASS (including new resolve-product-embeds tests)

- [ ] **Step 2: Build check**

```bash
cd apps/catalog && npm run build 2>&1 | tail -30
```

Expected: successful build

- [ ] **Step 3: Dev server — verify product embeds render**

Start dev server (`npm run dev -- --port 3100`), publish a post with a product embed:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cat > /tmp/embed-test.md << 'EOF'
# Wine Pairing Guide for Thai Cuisine

Pairing wine with Thai food is an art. Here is our favourite bottle to start with.

<!-- product: WN0001 -->

The floral aromatics complement the lemongrass and galangal in tom kha beautifully.

## Frequently Asked Questions

### What wine goes best with spicy Thai food?
Off-dry Riesling and Gewürztraminer work well — their residual sugar counterbalances chilli heat.

### Can red wine pair with Thai food?
Yes — light-bodied reds like Pinot Noir or Gamay work, especially with less spicy dishes.

### Where can I buy wine for Thai food pairing in Bangkok?
WNLQ9 stocks a curated selection — contact us via LINE at wnlq9.shop/contact.
EOF
npx tsx scripts/blog-publish.ts --title "Wine Pairing Guide for Thai Cuisine" --tags "wine,pairing,thai-food" --file /tmp/embed-test.md
```

Open the post page — verify:
- The `<!-- product: WN0001 -->` comment is replaced with an `InlineProductCard` (bottle image, name, price, Order button)
- Related products section appears at the bottom
- Page source contains `Article` and `FAQPage` JSON-LD
- No console errors

- [ ] **Step 4: Tag Phase 2 complete**

```bash
git tag blog-phase-2
```

---

## Appendix: How to write and publish a blog post

```bash
# From the repo root:
npx tsx scripts/blog-publish.ts \
  --title "My Post Title" \
  --tags "wine,burgundy" \
  --file /path/to/post.md

# With a product cover image:
npx tsx scripts/blog-publish.ts \
  --title "My Post Title" \
  --tags "wine" \
  --file post.md \
  --cover-sku WN0001

# With a direct cover image URL:
npx tsx scripts/blog-publish.ts \
  --title "My Post Title" \
  --tags "wine" \
  --file post.md \
  --cover-image https://example.com/image.jpg

# With custom SEO meta:
npx tsx scripts/blog-publish.ts \
  --title "My Post Title" \
  --tags "wine" \
  --file post.md \
  --meta-title "Custom SEO Title" \
  --meta-desc "Custom meta description under 160 chars"
```

## Post template (copy this for every new post)

```markdown
# [H1 — exact target keyword or close variant]

[Intro — keyword appears in first 100 words, ~150 words total]

## [Section heading]
[Body]

## [Section heading]
[Body]

<!-- product: WN0001 -->

## Frequently Asked Questions

### [Question phrased as a user search query]
[Answer — 2-4 sentences, factual, self-contained]

### [Question 2]
[Answer]

### [Question 3]
[Answer]

---
*Explore our [category] collection at [WNLQ9](https://wnlq9.shop/shop).*
```
