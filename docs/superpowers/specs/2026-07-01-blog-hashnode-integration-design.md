# Blog System Design — Hashnode Headless Integration

**Date:** 2026-07-01  
**Status:** Revised (post spec-review pass 2 — all blockers and warnings resolved)  
**Scope:** Phase 1 + Phase 2 (Phase 3 Notion sync deferred, revisit after Phase 2)

---

## Goal

Add a fully SEO/AEO-optimised blog to `wnlq9.shop/blog` using Hashnode as the headless CMS backend. Content is authored in two lanes:

- **Editorial lane:** Human team writes in Notion → deferred to Phase 3
- **AI lane:** Claude Code drafts and publishes directly via Hashnode API (Phase 1)

All content is stored in Hashnode. The Next.js app fetches and renders it, owns the canonical URL, and embeds live product cards from `live_products_export.json`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Content Creation                                           │
│  Claude Code ──────────────────────────────────────────┐   │
│                                                        ▼   │
│                                               Hashnode CMS  │
│                                               (source of    │
│                                                truth)       │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ GraphQL API (ISR, revalidate 3600s)
                          │ Endpoint: https://gql.hashnode.com
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/catalog (Next.js 14 App Router)                       │
│  app/blog/page.tsx           → /blog (index)                │
│  app/blog/[slug]/page.tsx    → /blog/best-burgundy-wines    │
│  app/blog/tag/[tag]/page.tsx → /blog/tag/wine-pairing       │
│  Each post page also reads:                                 │
│  data/live_products_export.json → ProductCard embeds        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              wnlq9.shop/blog/[slug]   ← Google indexes THIS URL
              (canonical URL set on every Hashnode post)
```

---

## Phase 1 — Core Blog Infrastructure

### 1.1 Hashnode Setup (manual, one-time)

1. Create a Hashnode account + publication (name: "WNLQ9 Journal")
2. In publication settings → **Advanced** → set custom domain to `wnlq9.shop` (used for canonical only — no DNS change needed since Next.js owns routing)
3. Generate a **Personal Access Token** (Settings → Developer → Access Tokens)
4. Copy the **Publication ID** from Settings → General (it's a hex string like `64a2f...`)
5. Add to `.env.local` (dev) and Vercel project `wnlq9-catalog` environment variables (prod):
   ```
   HASHNODE_TOKEN=<PAT from step 3>
   HASHNODE_PUBLICATION_ID=<hex ID from step 4>
   ```

### 1.2 Hashnode GraphQL Client

**New file:** `apps/catalog/lib/blog/hashnode-client.ts`

- Single `hashnodeQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T>` function
- Endpoint: `https://gql.hashnode.com`
- Headers: `Content-Type: application/json` (no auth needed for public reads; `Authorization: Bearer ${HASHNODE_TOKEN}` only for mutations in the publish script)
- Throws if response is non-200 or if `data.errors` is present

### 1.3 Post Fetching Functions + GraphQL Queries

**New file:** `apps/catalog/lib/blog/hashnode-posts.ts`

```typescript
export type BlogPost = {
  id: string
  title: string
  slug: string
  brief: string          // ~160 char excerpt
  content: { html: string; markdown: string }
  coverImage: { url: string } | null
  tags: { name: string; slug: string }[]
  publishedAt: string    // ISO 8601
  updatedAt: string      // ISO 8601 — used in sitemap
  seo: { title: string | null; description: string | null }
  canonicalUrl: string | null
}
```

**`getAllPosts(first = 12)`** — uses Hashnode publication posts query:
```graphql
query GetPosts($publicationId: ObjectId!, $first: Int!) {
  publication(id: $publicationId) {
    posts(first: $first) {
      edges {
        node {
          id title slug brief publishedAt updatedAt canonicalUrl
          coverImage { url }
          tags { name slug }
          seo { title description }
        }
      }
    }
  }
}
```
Returns `edges.map(e => e.node)`.

**`getPostBySlug(slug)`** — uses single post query:
```graphql
query GetPost($publicationId: ObjectId!, $slug: String!) {
  publication(id: $publicationId) {
    post(slug: $slug) {
      id title slug brief publishedAt updatedAt canonicalUrl
      coverImage { url }
      tags { name slug }
      seo { title description }
      content { html markdown }
    }
  }
}
```
Returns `publication.post` or `null` if not found.

**`getPostsByTag(tag, first = 12)`** — uses posts query with tag filter:
```graphql
query GetPostsByTag($publicationId: ObjectId!, $first: Int!, $tag: String!) {
  publication(id: $publicationId) {
    posts(first: $first, filter: { tagSlugs: [$tag] }) {
      edges { node { id title slug brief publishedAt updatedAt coverImage { url } tags { name slug } seo { title description } } }
    }
  }
}
```
**⚠️ Verify before building tag pages:** Hashnode's `posts` connection `filter: { tagSlugs }` argument availability varies by API version. Test this query against the live schema at `https://gql.hashnode.com` before implementing tag pages. If the filter is unsupported, the tag page must client-side filter the full post list instead.

**`getAllPostSlugs()`** — lightweight query for sitemap (slug + updatedAt only). Fetches up to 250 — this is the sitemap ceiling, not the SSG pre-render ceiling. `generateStaticParams` calls `getAllPosts(50)` separately and pre-renders only the 50 newest; posts 51–250 are served via ISR on first request (`dynamicParams = true`). The two numbers are intentionally different. **Known ceiling:** Hashnode uses cursor-based pagination; `first: 250` silently truncates if the publication exceeds 250 posts. This is an accepted constraint for now — add a paginator loop if the publication grows past 250.
```graphql
query GetSlugs($publicationId: ObjectId!) {
  publication(id: $publicationId) {
    posts(first: 250) {
      edges { node { slug updatedAt } }
    }
  }
}
```

All functions use `HASHNODE_PUBLICATION_ID` from `process.env`. ISR revalidation is set at the page level (not here).

### 1.4 Route Structure

```
apps/catalog/app/blog/
  page.tsx                   → /blog index
  [slug]/
    page.tsx                 → /blog/[slug] single post
  tag/
    [tag]/
      page.tsx               → /blog/tag/[tag] filtered list
```

**`app/blog/page.tsx`**
- `export const revalidate = 3600`
- Fetches latest 12 posts via `getAllPosts(12)`
- `generateMetadata`: `title: 'WNLQ9 Journal — Wine, Whisky & Spirits'`, `description: 'Tasting notes, pairing guides, and regional deep-dives from WNLQ9, Bangkok.'`
- Renders `<PostCard>` grid (2-col desktop, 1-col mobile)

**`app/blog/[slug]/page.tsx`**
- `export const revalidate = 3600`
- `export const dynamicParams = true` — posts not in `generateStaticParams` are served via ISR fallback (not 404)
- `generateStaticParams`: calls `getAllPosts(50)`, returns `{ slug }` array for pre-rendering latest 50 at build
- On request: calls `getPostBySlug(slug)`. If `null` → `notFound()`.
- `generateMetadata`: title = `post.seo.title ?? post.title + ' | WNLQ9 Journal'`, description = `post.seo.description ?? post.brief ?? ''` (both can be null — always fall back to `post.brief`, then empty string), OG image = `post.coverImage?.url ?? '/og-default.jpg'`
- **Canonical enforcement:** `alternates: { canonical: \`https://wnlq9.shop/blog/\${slug}\` }` — always set
- Renders: `<PostBody post={post} productMap={productMap} />`, `<JsonLd data={buildArticleSchema(post, url)} />`, conditionally `<JsonLd data={buildFaqSchema(post)} />`
- `productMap` (Phase 2): resolved by `resolveProductEmbeds(post.content.html)` called in the page server component before passing to PostBody

**`app/blog/tag/[tag]/page.tsx`**
- `export const revalidate = 3600`
- `export const dynamicParams = true`
- Calls `getPostsByTag(tag, 12)`; if empty array → `notFound()`

### 1.5 Post Template (enforced in Claude publish script)

Every post MUST follow this structure:

```markdown
# [H1 — exact target keyword or close variant]

[Intro — keyword appears in first 100 words, ~150 words total]

## [Section heading]
[Body]

## [Section heading]
[Body]

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

Rules:
- The `## Frequently Asked Questions` heading must be spelled exactly this way — the FAQ parser matches this string
- Each FAQ entry is an `###` H3 immediately followed by a paragraph (the answer)
- Minimum 3 FAQ entries per post

### 1.6 SEO Metadata + JSON-LD

**New file:** `apps/catalog/lib/seo/blog-jsonld.ts`

```typescript
export function buildArticleSchema(post: BlogPost, url: string): object
export function buildFaqSchema(post: BlogPost): object | null
```

**`buildArticleSchema`** emits schema.org `Article`:
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "<post.title>",
  "datePublished": "<post.publishedAt>",
  "dateModified": "<post.updatedAt>",
  "image": "<post.coverImage.url or og-default absolute URL>",
  "url": "<url>",
  "author": { "@type": "Organization", "name": "WNLQ9", "url": "https://wnlq9.shop" },
  "publisher": { "@type": "Organization", "name": "WNLQ9", "logo": { "@type": "ImageObject", "url": "https://wnlq9.shop/og-default.jpg" } }
}
```

**`buildFaqSchema`** — parses `post.content.markdown` (lowercase field, NOT `content.html`) for FAQ section:
- Splits markdown on `## Frequently Asked Questions`
- If section not found → returns `null`
- In the FAQ section, extracts `### <question>` + following paragraph pairs using regex: `/^### (.+)\n+([\s\S]+?)(?=\n###|\n##|$)/gm`
- Emits `FAQPage` schema with `mainEntity` array of `Question` objects
- No external parser dependency — pure string/regex on markdown source

**PostBody HTML sanitisation:** Hashnode's `content.html` is sanitized by Hashnode before delivery — we do not control attacker input on this field. `PostBody` renders it directly via `dangerouslySetInnerHTML` without an additional sanitizer pass. If defense-in-depth is desired in future, use `sanitize-html` (Node-native, no jsdom dependency) — do NOT use `isomorphic-dompurify`, which requires jsdom and is incompatible with Next.js App Router server components.

Both schemas emitted via the existing `<JsonLd>` component (`apps/catalog/components/seo/JsonLd.tsx`).

### 1.7 Claude → Hashnode Publish Script

**New file:** `scripts/blog-publish.ts` (run with `npx tsx scripts/blog-publish.ts`)

```
Usage:
  npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --file post.md
  npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --stdin
  npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-image https://...
  npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-sku WN0001
```

**Hashnode `publishPost` mutation:**
```graphql
mutation PublishPost($input: PublishPostInput!) {
  publishPost(input: $input) {
    post { id title slug url }
  }
}
```

**`PublishPostInput` fields used:**
```typescript
{
  publicationId: string,         // HASHNODE_PUBLICATION_ID
  title: string,                 // --title arg
  slug: string,                  // kebab-case derived from title (title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  contentMarkdown: string,       // markdown source (NOT html — Hashnode converts internally)
  freeformTags: string[],                  // --tags comma-separated list as string array; use freeformTags NOT tags (tags requires pre-existing Hashnode tag registry entries and silently drops unknown tags)
  coverImageOptions?: { coverImageURL: string },  // optional
  metaTags?: { title: string, description: string },  // optional --meta-title / --meta-desc flags
  canonicalUrl: string,          // always set: `https://wnlq9.shop/blog/${slug}`
  isNewsletterActivated: false,  // always false
  publishedAt: string,           // omit = publish immediately (ISO string if scheduling needed)
}
```

**`--cover-sku` image URL derivation:**
- Script must be run from the repo root (`/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT`) — document this in the script's usage comment
- Reads `data/live_products_export.json` via `path.join(process.cwd(), 'data', 'live_products_export.json')`
- Finds product where `sku === coverSku`
- If `product.image_url` is set → uses it directly
- Else → constructs Magento CDN path: `https://wnlq9.shop/media/catalog/product/${sku[0].toLowerCase()}/${sku[1].toLowerCase()}/${sku}.jpg` and prints a warning (`⚠ image_url is null for ${sku} — using constructed CDN path, verify the image is correct`) since 200 OK does not guarantee the right bottle image
- Sets as `coverImageOptions.coverImageURL`

**Auth:** The script uses `Authorization: Bearer ${process.env.HASHNODE_TOKEN}`. It loads `.env.local` via `dotenv.config({ path: '.env.local' })` (NOT `import 'dotenv/config'` which loads `.env` only, silently missing the token in dev).

**Output:** Prints `✓ Published: https://wnlq9.shop/blog/${slug}` on success.

### 1.8 New UI Components

**`apps/catalog/components/blog/PostCard.tsx`** (server component)
- Props: `post: BlogPost`
- Renders: cover image (`next/image`, `sizes="(max-width:768px) 100vw, 50vw"`), H2 title, brief excerpt (truncate at 120 chars), tag chips, formatted `publishedAt` date, `<Link href={/blog/${post.slug}}>Read more</Link>`

**`apps/catalog/components/blog/PostBody.tsx`** (server component, Phase 1)
- Props: `html: string` (Hashnode-sanitized html — trust Hashnode's output directly), `productMap?: Map<string, PublicProduct>` (Phase 2, optional)
- Phase 1: renders `<div dangerouslySetInnerHTML={{ __html: html }} className="prose prose-neutral max-w-none" />` — no additional sanitizer needed (Hashnode sanitizes before delivery; do NOT use isomorphic-dompurify, incompatible with RSC)
- Phase 2: split `html` on `<!-- product: SKU -->` comment boundaries into alternating string segments and `<InlineProductCard>` React nodes. Render as a React node array — do NOT use `ReactDOMServer.renderToStaticMarkup` (string injection bypasses React reconciliation)

**`apps/catalog/components/Header.tsx`** — add "Journal" nav link pointing to `/blog` alongside existing nav items.

**`apps/catalog/app/layout.tsx`** — no change needed; Header is already included in layout.

---

## Phase 2 — Product Integration

### 2.1 In-Post Product Card Embeds

Writers signal a product embed with an HTML comment in the markdown:

```markdown
<!-- product: WN0001 -->
```

Hashnode preserves HTML comments in its rendered output.

**`apps/catalog/lib/blog/resolve-product-embeds.ts`**
- `resolveProductEmbeds(html: string, allProducts: PublicProduct[]): Map<string, PublicProduct>`
- Accepts the already-loaded product list — caller reads `live_products_export.json` once at the page level and passes it in (avoids a redundant full-file read per post request)
- Scans `html` for `<!-- product: ([A-Z0-9]+) -->` (case-insensitive SKU), extracts matched SKU set
- Returns `Map<sku, PublicProduct>` for matched SKUs only (unmatched SKUs silently skipped — no embed rendered)
- Called in `app/blog/[slug]/page.tsx`: page loads full product list once, calls `resolveProductEmbeds(html, allProducts)`, passes `productMap` to `PostBody`

**`apps/catalog/components/blog/InlineProductCard.tsx`** (server component)
- Props: `product: PublicProduct`
- Renders: bottle image (48×48px thumbnail), product name, formatted price, "Order via LINE" CTA (same LINE URL pattern as existing product detail page)
- Styled as an inline card (border, rounded, padding) that sits within prose text flow

### 2.2 Related Products Section

**`apps/catalog/components/blog/RelatedProducts.tsx`** (server component)
- Props: `tags: BlogPost['tags']`
- Matching logic (case-insensitive, applied in order):
  1. Tag slug matches `product.region` (normalised: lowercase, spaces→hyphens)
  2. Tag name appears in `product.name` (substring, case-insensitive)
  3. Tag slug matches `product.category_group` (lowercase)
- Deduplicates by SKU, filters to `isInStock(product.is_in_stock) === true`, takes first 4
- Renders horizontal scrolling row of compact product cards on mobile, 4-col grid on desktop

### 2.3 Sitemap Includes Blog Posts

Extend `apps/catalog/app/sitemap.ts`:
- Convert function to `async` (currently synchronous — this is a breaking signature change, required)
- Add `try/catch` around the Hashnode fetch: if Hashnode API is down at build time, catch the error and return `[]` for blog entries (build must not fail)
- Call `getAllPostSlugs()` (the lightweight GraphQL query defined in 1.3)
- Append to sitemap: `{ url: \`https://wnlq9.shop/blog/\${slug}\`, lastModified: new Date(updatedAt), changeFrequency: 'weekly', priority: 0.6 }`

### 2.4 Image Pipeline

- Blog index: `og-default.jpg` (already exists at `public/og-default.jpg`)
- Post covers: Hashnode CDN URL — rendered via `next/image` with `unoptimized={false}` (add `images.remotePatterns` for `cdn.hashnode.com` in `next.config.js`)
- Inline product images: existing catalog CDN (`/media/catalog/product/...`)
- `--cover-sku` in publish script sets catalog bottle image as post cover (derivation specified in 1.7)

**`next.config.js` addition required:**
```js
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'cdn.hashnode.com' },
    // existing patterns remain
  ]
}
```

---

## Phase 3 — Deferred (revisit after Phase 2)

Notion → Hashnode sync pipeline. Not specced here.

---

## File Map

### New Files
```
apps/catalog/
  app/blog/
    page.tsx
    [slug]/page.tsx
    tag/[tag]/page.tsx
  lib/blog/
    hashnode-client.ts
    hashnode-posts.ts
    resolve-product-embeds.ts    ← Phase 2
  lib/seo/
    blog-jsonld.ts
  components/blog/
    PostCard.tsx
    PostBody.tsx
    InlineProductCard.tsx        ← Phase 2
    RelatedProducts.tsx          ← Phase 2

scripts/
  blog-publish.ts
```

### Modified Files
```
apps/catalog/components/Header.tsx   ← add "Journal" /blog nav link
apps/catalog/app/sitemap.ts          ← async + blog post URLs (Phase 2)
apps/catalog/next.config.js          ← add cdn.hashnode.com to remotePatterns (Phase 2)
.env.local                           ← HASHNODE_TOKEN, HASHNODE_PUBLICATION_ID
```

### New Dependencies
```
dotenv                 ← .env.local loading in blog-publish.ts script (Phase 1); use dotenv.config({ path: '.env.local' })
tsx                    ← already likely present; needed for npx tsx scripts/blog-publish.ts
```
No sanitization library needed — Hashnode sanitizes `content.html` before delivery. Do NOT add `isomorphic-dompurify` (RSC-incompatible) or `sanitize-html` unless a future threat model requires defense-in-depth on this field.

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `HASHNODE_TOKEN` | Vercel `wnlq9-catalog` project + `.env.local` | PAT for publish mutations (write-only use) |
| `HASHNODE_PUBLICATION_ID` | Vercel `wnlq9-catalog` project + `.env.local` | Hex publication ID from Hashnode settings |

Public post reads use the unauthenticated Hashnode GraphQL endpoint — `HASHNODE_TOKEN` is NOT sent on read queries.

---

## SEO / AEO Checklist

| Signal | Implementation | Phase |
|---|---|---|
| Canonical URL | `generateMetadata` alternates + Hashnode post `canonicalUrl` field | 1 |
| `Article` JSON-LD | `buildArticleSchema()` on every post page | 1 |
| `FAQPage` JSON-LD | `buildFaqSchema()` when `## Frequently Asked Questions` present | 1 |
| OG image tag | `generateMetadata` with post cover or og-default | 1 |
| HTML sanitization | `isomorphic-dompurify` in PostBody | 1 |
| Hashnode backlink | Posts also at `wnlq9.hashnode.dev` — DA boost | 1 |
| Sitemap entries | `getAllPostSlugs()` appended to sitemap.ts | 2 |
| Internal product links | `InlineProductCard` via `<!-- product: SKU -->` embeds | 2 |
| Related products section | `RelatedProducts` at post bottom | 2 |

---

## Constraints & Non-Goals

- **No self-hosted CMS** — Hashnode is the backend; zero new infra
- **No client-side GraphQL** — all fetches are server-side RSC with ISR
- **No newsletter** — `isNewsletterActivated: false` on all posts
- **No comments** — Hashnode comments disabled
- **No pagination in Phase 1** — index shows latest 12; extend in Phase 2 if needed
- **No Notion sync** — Phase 3, deferred
