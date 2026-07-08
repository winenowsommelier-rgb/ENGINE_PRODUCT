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
| `sake` | Sake & Japanese | Sake, Shochu, Japanese Whisky |

Sub-tags in the hero tiles are **static display strings** — not computed from post data. They serve as editorial hints only. "Japanese Whisky" appearing in the Sake tile is intentional: it is a discovery hint for visitors, not a tag-routing claim. Posts tagged `japanese-whisky` route to the `whisky` category (see §3.3).

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
  // wine — varietal and regional tags
  'wine': 'wine',
  'red-wine': 'wine',
  'white-wine': 'wine',
  'rosé': 'wine',        // accented — parser does NOT strip diacritics; both forms needed
  'rose': 'wine',        // unaccented fallback
  'sparkling': 'wine',
  'champagne': 'wine',
  'prosecco': 'wine',
  'chardonnay': 'wine',
  'sauvignon-blanc': 'wine',
  'pinot-noir': 'wine',
  'cabernet-sauvignon': 'wine',
  'merlot': 'wine',
  'malbec': 'wine',
  'carmenere': 'wine',
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
  'new-zealand': 'wine',   // wine-context only; oversimplification accepted
  'france': 'wine',
  'italy': 'wine',
  'spain': 'wine',
  'australia': 'wine',
  // whisky
  'whisky': 'whisky',
  'whiskey': 'whisky',
  'scotch': 'whisky',
  'japanese-whisky': 'whisky',
  'speyside': 'whisky',
  'islay': 'whisky',
  'scotland': 'whisky',
  // spirits
  'spirits': 'spirits',
  'gin': 'spirits',
  'tequila': 'spirits',
  'mezcal': 'spirits',
  'rum': 'spirits',
  'vodka': 'spirits',
  'cocktails': 'spirits',
  'mexico': 'spirits',
  // sake / japanese
  'sake': 'sake',
  'shochu': 'sake',
  'japanese-food': 'sake',
  'japan': 'sake',
  'sushi': 'sake',
}

export const PURPOSE_TAG_MAP: Record<string, PurposeSlug> = {
  'guide': 'guides',
  'pairing': 'pairings',
  'thai-food': 'pairings',   // pairing-intent tag even without 'pairing' present
  'deep-dive': 'deep-dives',
  'compare': 'comparisons',
  'curated': 'curated',
  'collection': 'curated',
  'gifting': 'gifting',
  'event': 'gifting',
  'celebration': 'gifting',
}
```

**Unmapped tags policy:** Tags not present in either map are silently ignored — a post that carries only unmapped tags (e.g. `bangkok`, `restaurants`, `sommelier`, `value`, `deals`) will appear in no drink-type or purpose category. This is intentional: such posts are location/editorial metadata and do not belong to a specific drink or content category. The `/blog` landing page "Latest Posts" section will still show them (no filtering applied there). If future posts should be routable, add their tags to the appropriate map.

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

**B. Hero strip** — full-width strip (white, bottom border). Two-column grid (`1fr 240px`). The right column of 4 stacked tiles drives the overall height; the featured post card on the left stretches to match it (use `align-items: stretch` or `height: 100%` on the card). No fixed height is specified — tile content height determines the strip height naturally.

- **Left: Featured post card** — dark background, serif title, content-type tag, date, "Read now →" CTA.  
  Featured post selection: find the first post where `featured === true` (iterate `listPostFilenames()` → `readPostFile()`). If none, fall back to `getAllPosts(1)[0]` (note: `getAllPosts(1)` returns an array; take index `[0]`). **Parser change required:** `local-posts.ts` must read the `FEATURED` key — see §8.

- **Right: Drink-type tiles** — 4 stacked tiles (Wine / Whisky / Spirits / Sake). Each tile: emoji icon, label, article count, static sub-tags (see §3.1). Clicking navigates to `/blog/category/[slug]`. Article counts are computed at build time by filtering all posts through `DRINK_TAG_MAP`.

**C. Browse by Purpose** — 6 compact cards in a single row (`repeat(6, 1fr)`): Guides, Pairings, Deep Dives, Curated Lists, Comparisons, Gifting & Events. Each card: icon, label, article count (computed at build time), and a short description clipped to ~6 words from `CATEGORY_META[slug].description` (shown as a visible sub-line on mobile; visible on desktop too — no hover-only hiding). Links to `/blog/category/[slug]`.

**D. Latest Posts** — 3-column grid of the 6 most recent posts (2 rows) from `getAllPosts(6)`. Each card uses the existing `PostCard` component unchanged.

No standalone "Browse by Category" drink-type card grid — the hero tiles serve that function.

---

## 6. Category Page (`/blog/category/[slug]`)

### 6.1 Data loading

Category pages are **Server Components** (Next.js App Router). They read `searchParams` for `page`. All posts are loaded at render time using `getAllPostsForCategory(slug)` (see §7).

`generateStaticParams` generates one entry per category slug (10 total: 4 drink + 6 purpose). This statically generates the base page for each category at build time.

Paginated routes (`?page=N`) are **not** pre-rendered — they render dynamically because the page component reads `searchParams`. In Next.js App Router, accessing `searchParams` in a Server Component makes the route dynamic automatically; no explicit `export const dynamic` declaration is required. The category page file should **not** set `dynamic = 'force-static'` — that would break pagination. The file should have no explicit `dynamic` export, relying on Next.js's default behaviour (static when `searchParams` unused, dynamic when used).

### 6.2 Layout (top → bottom)

**A. Category header** (white, border-bottom)
- Breadcrumb: `Journal › [Category Name]`
- H1: Category name (serif, 26px bold)
- Sub-title: `CATEGORY_META[slug].description` (full text, not clipped — see §7 for all 10 values)

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
`PostCard` renders all tags uniformly — no badge hierarchy change required.

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

This file is the single source of truth for all category logic. **Full `CATEGORY_META` values** (all 10 slugs — these are the exact strings to ship; do not invent alternatives):

```ts
export type DrinkSlug = 'wine' | 'whisky' | 'spirits' | 'sake'
export type PurposeSlug = 'guides' | 'pairings' | 'deep-dives' | 'curated' | 'comparisons' | 'gifting'
export type CategorySlug = DrinkSlug | PurposeSlug

export const DRINK_SLUGS: DrinkSlug[] = ['wine', 'whisky', 'spirits', 'sake']
export const PURPOSE_SLUGS: PurposeSlug[] = ['guides', 'pairings', 'deep-dives', 'curated', 'comparisons', 'gifting']

export const CATEGORY_META: Record<CategorySlug, { label: string; description: string; icon: string }> = {
  wine:         { label: 'Wine',             icon: '🍷', description: 'Red, white, rosé, sparkling — from Bordeaux to Bangkok dinner tables' },
  whisky:       { label: 'Whisky',           icon: '🥃', description: 'Scotch, Japanese, bourbon — what\'s worth buying in Bangkok right now' },
  spirits:      { label: 'Spirits',          icon: '🍸', description: 'Gin, tequila, mezcal, rum — the Bangkok bar shelf decoded' },
  sake:         { label: 'Sake & Japanese',  icon: '🍶', description: 'Sake grades, food pairings, and what to order at Bangkok\'s Japanese restaurants' },
  guides:       { label: 'Guides',           icon: '📖', description: 'Practical knowledge for buying, storing, and serving' },
  pairings:     { label: 'Pairings',         icon: '🍽', description: 'What to drink with Thai food and beyond' },
  'deep-dives': { label: 'Deep Dives',       icon: '🔬', description: 'In-depth explorations of regions, grapes, and styles' },
  curated:      { label: 'Curated Lists',    icon: '✨', description: 'Handpicked selections for every occasion and budget' },
  comparisons:  { label: 'Comparisons',      icon: '⚖️', description: 'Side-by-side breakdowns to help you choose' },
  gifting:      { label: 'Gifting & Events', icon: '🎁', description: 'Perfect bottles for gifts, celebrations, and events' },
}

// Tag maps (full contents in §3.3)
export const DRINK_TAG_MAP: Record<string, DrinkSlug> = { /* see §3.3 */ }
export const PURPOSE_TAG_MAP: Record<string, PurposeSlug> = { /* see §3.3 */ }

export function getDrinkSlugForPost(tags: string[]): DrinkSlug | null { /* ... */ }
export function getPurposeSlugForPost(tags: string[]): PurposeSlug | null { /* ... */ }
```

### `getAllPostsForCategory(slug: CategorySlug): BlogPostPreview[]`

Add directly to `local-posts.ts` (not a separate file) so it can call `listPostFilenames` and `readPostFile` without exporting them:

```ts
// local-posts.ts — add after the existing getAllPosts() function
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

`listPostFilenames` and `readPostFile` remain **unexported** — `getAllPostsForCategory` lives in the same file and calls them directly. No export change needed for those two functions.

---

## 8. Parser & Type Changes

### 8.1 `FEATURED` frontmatter key — `local-posts.ts`

In `readPostFile()`, add this field to the returned object:

```ts
featured: data['FEATURED'] === 'true',
```

The frontmatter parser stores raw string values. `FEATURED: true` in a `.md` file is stored as the string `"true"`. The comparison `=== 'true'` is correct. Authors must write `FEATURED: true` without quotes; `FEATURED: "true"` will not match (the stored value would be `'"true"'`). Default is `false` (the comparison returns `false` when the key is absent).

### 8.2 Type additions — `hashnode-posts.ts`

**This is where `BlogPost` and `BlogPostPreview` are defined.** Both types need:

```ts
featured?: boolean
```

Add this field to both interfaces in `apps/catalog/lib/blog/hashnode-posts.ts`. `local-posts.ts` re-exports these types; no change needed there for the types themselves.

---

## 9. Component Map

| Component | Path | Status | Changes required |
|-----------|------|--------|-----------------|
| `PostCard` | `components/blog/PostCard.tsx` | **Unchanged** | None |
| `PillBar` | `components/blog/PillBar.tsx` | **New** | Pill tabs + disabled sort toggle |
| `Pagination` | `components/blog/Pagination.tsx` | **New** | Numbered pagination with ellipsis |
| `HeroStrip` | `components/blog/HeroStrip.tsx` | **New** | Featured post card + drink-type tiles |
| `categories.ts` | `lib/blog/categories.ts` | **New** | Tag maps, slugs, meta, filter helpers |
| `local-posts.ts` | `lib/blog/local-posts.ts` | **Modified** | Add `featured` field in `readPostFile()`; add `getAllPostsForCategory()` function |
| `hashnode-posts.ts` | `lib/blog/hashnode-posts.ts` | **Modified** | Add `featured?: boolean` to `BlogPost` and `BlogPostPreview` interfaces |
| Landing page | `app/blog/page.tsx` | **Rewrite** | New layout: HeroStrip + purpose cards + 6 latest posts |
| Category page | `app/blog/category/[slug]/page.tsx` | **New route** | Server Component; `generateStaticParams`; PillBar + Pagination |

---

## 10. SEO

### 10.1 Page titles and meta descriptions
- `/blog` landing page: `<title>` = `"The WNLQ9 Journal — Wine, Whisky, Spirits & Sake"` and `<meta name="description">` = `"Guides, pairings, and deep dives on wine, whisky, spirits, and sake — from Bangkok's finest selection."`.
- `/blog/category/[slug]`: `<title>` = `"{Label} — WNLQ9 Journal"` and `<meta name="description">` = `CATEGORY_META[slug].description`.

### 10.2 Canonical tags
- The canonical URL for each category is `/blog/category/[slug]` with no query param.
- The category page component must read `searchParams.page` and conditionally emit:
  - If `page` is absent or `"1"`: `<link rel="canonical" href="/blog/category/[slug]">` (strips `?page=1`)
  - If `page` is `"2"` or higher: `<link rel="canonical" href="/blog/category/[slug]?page=N">` (self-canonical)
- The pagination component never generates a `?page=1` link (page 1 links have no query param), but external sites may link with `?page=1` — the canonical tag handles this defensively.

### 10.3 Static generation and crawlability
- Each `/blog/category/[slug]` base page is statically generated via `generateStaticParams` and fully crawlable.
- Paginated `?page=N` pages: the category page Server Component accesses `searchParams`, which makes Next.js App Router render these routes dynamically (server-side on request). Do **not** add `export const dynamic = 'force-static'` — it would break pagination. No explicit `dynamic` export is needed.
- No `noindex` on any page.

### 10.4 Open Graph images
- `/blog/category/[slug]`: `og:image` = `getAllPostsForCategory(slug)[0]?.coverImage ?? '/images/og-journal-default.jpg'`
- `/blog` landing page: `og:image` = featured post's `coverImage`, with same fallback.
- The fallback file `/images/og-journal-default.jpg` must exist in the `public/` directory (create a placeholder or brand image before launch).

### 10.5 BreadcrumbList structured data
Category pages emit a JSON-LD `<script>` in `<head>` (via Next.js metadata or inline in the layout):

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Journal", "item": "https://wnlq9.shop/blog" },
    { "@type": "ListItem", "position": 2, "name": "{Label}", "item": "https://wnlq9.shop/blog/category/{slug}" }
  ]
}
```

Use the full absolute URL in `item` (schema.org requires it). Use `CATEGORY_META[slug].label` for `{Label}`.

---

## 11. Out of Scope

- Full-text search across posts
- Nested sub-category routes (e.g. `/blog/category/wine/france`)
- View-count tracking (reserved, not implemented — "Most Popular" sort is disabled)
- Author pages
- Tag pages beyond the defined category slugs
- Dynamic sub-tag computation in hero tiles
- **Editorial row / Editor's Picks** — reserved for future use. When needed, implement via a `FEATURED_RANK: 1–6` integer frontmatter key (extends the existing `FEATURED: true` boolean). The parser change is trivial; the landing page would add a 6-card curated row above "Latest Posts". Do not use `FEATURED: true` for multi-slot editorial curation — that field is single-post only.
