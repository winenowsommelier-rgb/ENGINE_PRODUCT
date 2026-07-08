# Blog Landing & Category Page — Design Spec
**Date:** 2026-07-08  
**Status:** Approved

---

## 1. Problem

The current `/blog` page is a flat 2-column grid of all posts with no categorisation. At 34 posts today it is manageable; at 300+ posts it becomes unusable. Visitors have no way to filter by drink type or content purpose, and search engines cannot crawl topic-scoped pages.

---

## 2. Goals

- Scale to 300+ posts without degrading discoverability
- Give visitors two entry paths: by drink type and by content purpose
- Make every category page independently crawlable by search engines (real URLs per page)
- Preserve the editorial, magazine-style feel of the WNLQ9 brand

---

## 3. Information Architecture

### 3.1 Drink-type categories (primary)

| Slug | Label | Sub-tags (static display labels, not computed) |
|------|-------|----------------|
| `wine` | Wine | France, Italy, New World, Sparkling |
| `whisky` | Whisky | Scotch, Japanese, Bourbon |
| `spirits` | Spirits | Gin, Tequila, Rum, Vodka |
| `sake` | Sake & Japanese | Sake, Shochu, Pairing |

Sub-tags in the hero tiles are **static display strings** — not computed from post data. They serve as editorial hints only.

### 3.2 Content-purpose categories (secondary)

| Slug | Label | Maps from pill |
|------|-------|----------------|
| `guides` | Guides | Guides pill |
| `pairings` | Pairings | Pairings pill |
| `deep-dives` | Deep Dives | Deep Dives pill |
| `curated` | Curated Lists | Curated Lists pill |
| `comparisons` | Comparisons | Comparisons pill |
| `gifting` | Gifting & Events | Gifting & Events pill |

Note: "Curated Lists" is its own slug (`curated`), distinct from `guides`. This matches the real tag corpus where `curated` is a separate high-frequency tag.

### 3.3 Tag-to-category mapping

Defined in `apps/catalog/lib/blog/categories.ts`. Built from the actual post tag corpus:

```ts
export const DRINK_TAG_MAP: Record<string, DrinkSlug> = {
  // wine
  'wine': 'wine',
  'red-wine': 'wine',
  'white-wine': 'wine',
  'rosé': 'wine',
  'rose': 'wine',
  'sparkling': 'wine',
  'champagne': 'wine',
  'prosecco': 'wine',
  'chardonnay': 'wine',
  'sauvignon-blanc': 'wine',
  'pinot-noir': 'wine',
  'cabernet-sauvignon': 'wine',
  'merlot': 'wine',
  'malbec': 'wine',
  'shiraz': 'wine',
  'syrah': 'wine',
  'grenache': 'wine',
  'nebbiolo': 'wine',
  'barolo': 'wine',
  'burgundy': 'wine',
  'bordeaux': 'wine',
  'tuscany': 'wine',
  'chianti': 'wine',
  'brunello': 'wine',
  'rhone-valley': 'wine',
  'piedmont': 'wine',
  'marlborough': 'wine',
  'new-zealand': 'wine',    // wine-context only; oversimplification accepted
  // whisky
  'whisky': 'whisky',
  'whiskey': 'whisky',
  'scotch': 'whisky',
  'japanese-whisky': 'whisky',
  'speyside': 'whisky',
  'islay': 'whisky',
  // spirits
  'spirits': 'spirits',
  'gin': 'spirits',
  'tequila': 'spirits',
  'mezcal': 'spirits',
  'rum': 'spirits',
  'vodka': 'spirits',
  'cocktails': 'spirits',
  // sake / japanese
  'sake': 'sake',
  'shochu': 'sake',
  'japanese-food': 'sake',
  'sushi': 'sake',
}

export const PURPOSE_TAG_MAP: Record<string, PurposeSlug> = {
  'guide': 'guides',
  'pairing': 'pairings',
  'deep-dive': 'deep-dives',
  'compare': 'comparisons',
  'curated': 'curated',
  'collection': 'curated',
  'gifting': 'gifting',
  'event': 'gifting',
}
```

A post belongs to a drink-type category if **any** of its tag slugs appears as a key in `DRINK_TAG_MAP`. Same logic for purpose. A post can belong to multiple categories. Unknown tags are silently ignored (no catch-all).

---

## 4. URL Structure

```
/blog                                        — landing page
/blog/category/[slug]                        — category page (page 1)
/blog/category/[slug]?page=N                 — category page (N ≥ 2)
/blog/[slug]                                 — individual post (unchanged)
```

Filter pill and sort are **client-side state only** (not in the URL). Only `page` is in the URL. This makes pagination SEO-friendly while keeping filter/sort state ephemeral.

---

## 5. Landing Page (`/blog`)

### Layout (top → bottom)

**A. Nav** — site-wide nav with "Journal" active.

**B. Hero strip** — full-width strip (white, bottom border). Two-column grid (`1fr 240px`):

- **Left: Featured post card** — dark background, serif title, content-type tag, date, "Read now →" CTA.  
  Featured post selection: if no post has a `FEATURED: true` frontmatter key, fall back to the most-recent post from `getAllPosts(1)`. **Parser change required:** `local-posts.ts` must read the `FEATURED` key and expose it as `featured: boolean` on `BlogPostPreview`. Default is `false`.

- **Right: Drink-type tiles** — 4 stacked tiles (Wine / Whisky / Spirits / Sake). Each tile: emoji icon, label, article count, static sub-tags (see §3.1). Clicking navigates to `/blog/category/[slug]`. Article counts are computed at build time by filtering all posts through `DRINK_TAG_MAP`.

**C. Browse by Purpose** — 6 compact cards in a single row (`repeat(6, 1fr)`): Guides, Pairings, Deep Dives, Curated Lists, Comparisons, Gifting & Events. Each card: icon, label, article count (computed at build time). Links to `/blog/category/[slug]`.

**D. Latest Posts** — 3-column grid of the 3 most recent posts from `getAllPosts(3)`. Each card uses the existing `PostCard` component unchanged.

No standalone "Browse by Category" drink-type card grid — the hero tiles serve that function.

---

## 6. Category Page (`/blog/category/[slug]`)

### 6.1 Data loading

Category pages are **Server Components** (Next.js App Router). They read `searchParams` for `page`. All posts are loaded at render time using a new `getAllPostsForCategory(slug)` function (see §7). No ISR needed — this is a static-first build; post data only changes when new `.md` files are added.

`generateStaticParams` generates one entry per category slug. Paginated routes (`?page=N`) are **not** pre-rendered as separate static pages — they render server-side on demand with `dynamic = 'force-static'` disabled. The SEO benefit is that each category has a real, crawlable base URL; pagination is secondary.

### 6.2 Layout (top → bottom)

**A. Category header** (white, border-bottom)
- Breadcrumb: `Journal › [Category Name]`
- H1: Category name (serif, 26px bold)
- Sub-title: static descriptor per slug (defined alongside slug metadata in `categories.ts`)

**B. Pill filter bar + sort toggle** (white, border-bottom)
- Left: pill tabs — `All | Guides | Pairings | Deep Dives | Curated Lists | Comparisons | Gifting & Events`  
  Only purpose categories applicable to the current drink-type category are shown (i.e. pills with zero matching posts are hidden).  
  Active pill: dark background, white text. Inactive: warm beige.  
  Selecting a pill is **client-side** — filters the currently-loaded post list in the browser. Does not trigger a navigation or page reload. Resets to page 1.
- Right: sort toggle — `Newest` / `Most Popular` (two pill buttons).  
  **Most Popular is visually disabled** (greyed out, `cursor: not-allowed`, `opacity: 0.4`) with a tooltip "Coming soon" until view-count data is available. It cannot be clicked. This prevents false affordance.

**C. Results meta** — `Showing 1–12 of [N] articles` where N is the filtered count.  
When a filter pill is active: `Showing 1–12 of [N] [Label] articles` (e.g. "Showing 1–12 of 8 Pairings articles").

**D. Post grid** — 3-column grid, 12 posts per page. Uses existing `PostCard` component.  
`PostCard` renders all tags uniformly — no badge hierarchy change required. The mockup's "content-type badge" is the existing `post-thumb-label` overlay on the cover image, which `PostCard` already renders via the first tag.

**E. Pagination** — classic numbered pagination:
```
← Prev  |  1  |  2  |  3  |  …  |  12  |  Next →
```
- Show at most 5 consecutive numbers with ellipsis compression
- Current page: dark fill
- Each number links to `?page=N` (server-side render)
- `← Prev` hidden on page 1; `Next →` hidden on last page
- Page 1 link has no query param (canonical: `/blog/category/[slug]`)

---

## 7. New Utility: `apps/catalog/lib/blog/categories.ts`

This file is the single source of truth for all category logic.

```ts
export type DrinkSlug = 'wine' | 'whisky' | 'spirits' | 'sake'
export type PurposeSlug = 'guides' | 'pairings' | 'deep-dives' | 'curated' | 'comparisons' | 'gifting'
export type CategorySlug = DrinkSlug | PurposeSlug

export const DRINK_SLUGS: DrinkSlug[] = ['wine', 'whisky', 'spirits', 'sake']
export const PURPOSE_SLUGS: PurposeSlug[] = ['guides', 'pairings', 'deep-dives', 'curated', 'comparisons', 'gifting']

export const CATEGORY_META: Record<CategorySlug, { label: string; description: string; icon: string }> = {
  wine:        { label: 'Wine',           icon: '🍷', description: 'Red, white, rosé, sparkling — from Bordeaux to Bangkok dinner tables' },
  whisky:      { label: 'Whisky',         icon: '🥃', description: 'Scotch, Japanese, bourbon — what\'s worth buying in Bangkok right now' },
  spirits:     { label: 'Spirits',        icon: '🍸', description: 'Gin, tequila, mezcal, rum — the Bangkok bar shelf decoded' },
  sake:        { label: 'Sake & Japanese',icon: '🍶', description: 'Sake grades, food pairings, and what to order at Bangkok\'s Japanese restaurants' },
  guides:      { label: 'Guides',         icon: '📖', description: 'Practical knowledge for buying, storing, and serving' },
  pairings:    { label: 'Pairings',       icon: '🍽', description: 'What to drink with Thai food and beyond' },
  'deep-dives':{ label: 'Deep Dives',     icon: '🔬', description: 'In-depth explorations of regions, grapes, and styles' },
  curated:     { label: 'Curated Lists',  icon: '✨', description: 'Handpicked selections for every occasion and budget' },
  comparisons: { label: 'Comparisons',    icon: '⚖️', description: 'Side-by-side breakdowns to help you choose' },
  gifting:     { label: 'Gifting & Events',icon:'🎁', description: 'Perfect bottles for gifts, celebrations, and events' },
}

// Tag maps (see §3.3 for full contents)
export const DRINK_TAG_MAP: Record<string, DrinkSlug> = { ... }
export const PURPOSE_TAG_MAP: Record<string, PurposeSlug> = { ... }

export function getDrinkSlugForPost(tags: string[]): DrinkSlug | null { ... }
export function getPurposeSlugForPost(tags: string[]): PurposeSlug | null { ... }
```

### `getAllPostsForCategory(slug: CategorySlug): BlogPostPreview[]`

New function to add to `local-posts.ts` (or `categories.ts` calling into `local-posts.ts`):

```ts
// Calls listPostFilenames() without slicing, maps all posts, filters by category.
// Build-time only — filesystem reads are acceptable here.
export function getAllPostsForCategory(slug: CategorySlug): BlogPostPreview[] {
  const isDrink = (DRINK_SLUGS as string[]).includes(slug)
  return listPostFilenames()
    .map(f => readPostFile(f))
    .filter((p): p is BlogPost => p !== null)
    .filter(p => {
      const tagSlugs = p.tags.map(t => t.slug)
      if (isDrink) return tagSlugs.some(t => DRINK_TAG_MAP[t] === slug)
      return tagSlugs.some(t => PURPOSE_TAG_MAP[t] === slug)
    })
    .map(({ content: _, ...preview }) => preview as BlogPostPreview)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}
```

`listPostFilenames` and `readPostFile` must be exported from `local-posts.ts` (currently unexported) so `categories.ts` can call them, OR `getAllPostsForCategory` is added directly to `local-posts.ts`.

---

## 8. Parser Change: `FEATURED` frontmatter key

`local-posts.ts` `readPostFile` must read the `FEATURED` key and include it on the returned object:

```ts
// In readPostFile():
featured: data['FEATURED'] === 'true',

// BlogPost / BlogPostPreview types (hashnode-posts.ts) need:
featured?: boolean
```

Frontmatter usage in a post file:
```
FEATURED: true
```

---

## 9. Component Map

| Component | Path | Status |
|-----------|------|--------|
| `PostCard` | `components/blog/PostCard.tsx` | **Unchanged** — used as-is |
| `PillBar` | `components/blog/PillBar.tsx` | **New** — pill tabs + disabled sort toggle |
| `Pagination` | `components/blog/Pagination.tsx` | **New** — numbered pagination |
| `HeroStrip` | `components/blog/HeroStrip.tsx` | **New** — featured post + category tiles |
| `categories.ts` | `lib/blog/categories.ts` | **New** — tag maps, slugs, meta, filter logic |
| `local-posts.ts` | `lib/blog/local-posts.ts` | **Modified** — add `FEATURED` field + export `listPostFilenames`/`readPostFile` |
| `hashnode-posts.ts` | `lib/blog/hashnode-posts.ts` | **Modified** — add `featured?: boolean` to types |
| Landing page | `app/blog/page.tsx` | **Rewrite** |
| Category page | `app/blog/category/[slug]/page.tsx` | **New route** |

---

## 10. SEO

- Each `/blog/category/[slug]` page (base, no `?page`) is statically generated via `generateStaticParams` and fully crawlable.
- Paginated `?page=N` pages render server-side on demand — not pre-generated as static HTML, but not blocked from crawling. Google can follow `Next →` links to discover them.
- Each category page has a unique `<title>` (`{Label} — WNLQ9 Journal`) and `<meta description>` from `CATEGORY_META[slug].description`.
- No `noindex` on any page.

---

## 11. Out of Scope

- Full-text search across posts
- Nested sub-category routes (e.g. `/blog/category/wine/france`)
- View-count tracking (reserved, not implemented — "Most Popular" sort is disabled)
- Author pages
- Tag pages beyond the defined category slugs
- Dynamic sub-tag computation in hero tiles
