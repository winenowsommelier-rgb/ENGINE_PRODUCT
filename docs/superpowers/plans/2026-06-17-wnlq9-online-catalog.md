# WNLQ9 Online Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a customer-facing, accessibility-first product catalog ("WNLQ9") at `apps/catalog/` that browses ~11,436 products with Maison-style design, rule-based recommendations, and LINE/Facebook/WhatsApp contact buttons — live on Vercel within 2 days.

**Architecture:** A standalone Next.js 14 (App Router) app in `apps/catalog/`, separate from the existing internal PIM tool at repo root. It reads `data/live_products_export.json` (repo root, two levels up) **at build time** and statically generates (SSG) the home, shop, and per-product pages. A single `toPublicProduct()` allowlist serializer guarantees internal fields (margin/B2B) never reach the client. Images are served from the existing Magento CDN via `next/image` remote patterns (no download).

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, `next/image`, Vitest (unit tests). Reuses `StructuralGauges`/`TasteWheel` components from the internal app.

**Spec:** `docs/superpowers/specs/2026-06-17-wnlq9-online-catalog-design.md`

---

## File Structure

All new files live under `apps/catalog/` unless noted.

| File | Responsibility |
|---|---|
| `apps/catalog/package.json` | App deps + scripts (own Next/Tailwind) |
| `apps/catalog/next.config.js` | SSG config + `images.remotePatterns` for `th.wine-now.com` |
| `apps/catalog/tailwind.config.ts` | Maison palette, 18px base, accessibility tokens |
| `apps/catalog/tsconfig.json` | TS config + `@/` path alias |
| `apps/catalog/vitest.config.ts` | Unit test runner |
| `apps/catalog/app/globals.css` | Base styles, focus rings, type scale |
| `apps/catalog/lib/types.ts` | `PublicProduct` type + raw field types |
| `apps/catalog/lib/catalog-data.ts` | Build-time loader, `toPublicProduct()` allowlist, indexes |
| `apps/catalog/lib/category-groups.ts` | 44 classifications → ~7 friendly groups map |
| `apps/catalog/lib/price-tiers.ts` | THB bracket definitions + `formatPrice()` |
| `apps/catalog/lib/recommender.ts` | Rule-based "you might also like" (pluggable) |
| `apps/catalog/lib/contact.ts` | LINE/WhatsApp/FB deep-link builder |
| `apps/catalog/components/StorefrontImage.tsx` | `next/image` wrapper + placeholder |
| `apps/catalog/components/ProductCard.tsx` | Grid card + quick-view trigger |
| `apps/catalog/components/QuickView.tsx` | Modal with product essentials |
| `apps/catalog/components/Filters.tsx` | Big filters + "More filters" expander |
| `apps/catalog/components/ContactButtons.tsx` | Global + per-product contact buttons |
| `apps/catalog/components/Header.tsx` / `Footer.tsx` | Global frame, WNLQ9 wordmark |
| `apps/catalog/components/TrustBar.tsx` | "Browse freely · Contact to order" strip |
| `apps/catalog/app/page.tsx` | Home |
| `apps/catalog/app/shop/page.tsx` | Shop grid (SSG) |
| `apps/catalog/app/product/[sku]/page.tsx` | Product detail (SSG, `generateStaticParams`) |
| `apps/catalog/app/explore-map/page.tsx` | Ported map tool (later task) |
| `apps/catalog/app/about/page.tsx` / `contact/page.tsx` | Static pages |

**Test files** mirror under `apps/catalog/lib/__tests__/`.

---

## Task 0: Scaffold the app & verify it boots

**Files:**
- Create: `apps/catalog/package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

- [ ] **Step 1: Create `apps/catalog/package.json`**

```json
{
  "name": "wnlq9-catalog",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3100",
    "build": "NODE_OPTIONS='--max-old-space-size=4096' next build",
    "start": "next start --port 3100",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "14.2.30",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "lucide-react": "^0.469.0",
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/catalog/next.config.js`** (the image-host allowlist — without it every image throws)

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'th.wine-now.com', pathname: '/media/**' },
    ],
  },
};
module.exports = nextConfig;
```

- [ ] **Step 3: Create `tsconfig.json`** — set `"baseUrl": "."` and `"paths": { "@/*": ["./*"] }` so `@/` resolves from `apps/catalog/` (NOT repo root). Create `tailwind.config.ts`, `postcss.config.js`; set Tailwind `content` to `./app/**/*.{ts,tsx}` and `./components/**/*.{ts,tsx}`.

- [ ] **Step 4: Create a minimal `app/layout.tsx`, `app/page.tsx` ("WNLQ9 — coming soon"), `app/globals.css`** with Tailwind directives.

- [ ] **Step 5: Install & boot**

Run: `cd apps/catalog && npm install && npm run dev`
Expected: dev server starts on `http://localhost:3100`, page shows "WNLQ9".

- [ ] **Step 6: Commit**

```bash
git add apps/catalog
git commit -m "feat(catalog): scaffold WNLQ9 storefront app"
```

---

## Task 1: Types & the public projection (margin-leak chokepoint)

**Files:**
- Create: `apps/catalog/lib/types.ts`, `apps/catalog/lib/catalog-data.ts`
- Test: `apps/catalog/lib/__tests__/catalog-data.test.ts`

- [ ] **Step 1: Write the failing test** — the allowlist guarantee is the most important invariant in the build (CLAUDE.md Rule: never expose margin).

```ts
// apps/catalog/lib/__tests__/catalog-data.test.ts
import { describe, it, expect } from 'vitest';
import { toPublicProduct, PUBLIC_FIELDS } from '../catalog-data';

const RAW = {
  sku: 'WRW2106AC', name: 'Test Red', price: 1600, currency: 'THB',
  image_url: 'https://th.wine-now.com/x.jpg', is_in_stock: true,
  margin_pct: 42.5, b2b_margin_pct: 30, enrichment_confidence: 0.9,
};

describe('toPublicProduct', () => {
  it('only emits allowlisted keys', () => {
    const pub = toPublicProduct(RAW as any);
    for (const k of Object.keys(pub)) expect(PUBLIC_FIELDS).toContain(k);
  });
  it('NEVER includes margin/B2B/internal fields', () => {
    const pub = toPublicProduct(RAW as any) as Record<string, unknown>;
    expect(pub.margin_pct).toBeUndefined();
    expect(pub.b2b_margin_pct).toBeUndefined();
    expect(pub.enrichment_confidence).toBeUndefined();
  });
  it('preserves safe fields', () => {
    const pub = toPublicProduct(RAW as any);
    expect(pub.sku).toBe('WRW2106AC');
    expect(pub.price).toBe(1600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/catalog-data.test.ts`
Expected: FAIL — `toPublicProduct` not defined.

- [ ] **Step 3: Write `lib/types.ts`** — define `PublicProduct` interface with ONLY safe fields (sku, name, brand, classification, wine_classification, grape_variety, vintage, country, region, subregion, appellation, wine_body, wine_acidity, wine_tannin, food_matching, flavor_tags, bottle_size, price, currency, desc_en_short, full_description, taste_profile, wine_color, image_url, score_summary, score_max, is_in_stock). Note: `id`, `margin_pct`, `b2b_margin_pct`, `enrichment_*`, `popularity_*` are deliberately ABSENT.

- [ ] **Step 4: Write `lib/catalog-data.ts` minimal**

```ts
import type { PublicProduct } from './types';

export const PUBLIC_FIELDS = [
  'sku','name','brand','classification','wine_classification','grape_variety',
  'vintage','country','region','subregion','appellation','wine_body','wine_acidity',
  'wine_tannin','food_matching','flavor_tags','bottle_size','price','currency',
  'desc_en_short','full_description','taste_profile','wine_color','image_url',
  'score_summary','score_max','is_in_stock',
] as const;

export function toPublicProduct(raw: Record<string, unknown>): PublicProduct {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  return out as unknown as PublicProduct;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/catalog-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/lib
git commit -m "feat(catalog): PublicProduct type + toPublicProduct allowlist (margin-leak chokepoint)"
```

---

## Task 2: Build-time data loader & indexes

**Files:**
- Modify: `apps/catalog/lib/catalog-data.ts`
- Test: `apps/catalog/lib/__tests__/catalog-data.loader.test.ts`

- [ ] **Step 1: Write failing test** — loads the real export, returns public products, builds a SKU index, and asserts NO product leaks margin.

```ts
import { describe, it, expect } from 'vitest';
import { getAllProducts, getProductBySku, PUBLIC_FIELDS } from '../catalog-data';

describe('catalog loader', () => {
  const all = getAllProducts();
  it('loads every product from the export', () => { expect(all.length).toBeGreaterThan(11000); });
  it('every product exposes only allowlisted keys', () => {
    for (const p of all.slice(0, 200))
      for (const k of Object.keys(p)) expect(PUBLIC_FIELDS).toContain(k);
  });
  it('looks up a known SKU', () => {
    expect(getProductBySku('WRW2106AC')?.sku).toBe('WRW2106AC');
  });
  it('price + image render for products that have them', () => {
    const withImg = all.filter(p => p.image_url);
    expect(withImg.length).toBeGreaterThan(11000);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd apps/catalog && npx vitest run lib/__tests__/catalog-data.loader.test.ts` — FAIL (`getAllProducts` undefined).

- [ ] **Step 3: Implement loader** in `catalog-data.ts`: resolve the export path **robustly** so it works whether cwd is the repo root (Vercel build, see Task 14) or `apps/catalog` (local dev). Use:

```ts
import fs from 'fs';
import path from 'path';
function exportPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),          // cwd = repo root (Vercel)
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'), // cwd = apps/catalog (dev)
    process.env.CATALOG_DATA_PATH ?? '',                                    // explicit override
  ];
  const found = candidates.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('live_products_export.json not found in any known location');
  return found;
}
```

Then `fs.readFileSync(exportPath())`, parse, map every row through `toPublicProduct`, cache in a module-level singleton (build-time only). Add `getProductBySku` backed by a `Map<string, PublicProduct>`. (Mirrors the existing root `app/api/products/route.ts` load pattern, which uses cwd-relative `data/`.)

- [ ] **Step 4: Run to verify pass.** Expected: PASS (4 tests).

- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): build-time loader + SKU index"`

---

## Task 3: Category groups (44 → ~7)

**Files:**
- Create: `apps/catalog/lib/category-groups.ts`
- Test: `apps/catalog/lib/__tests__/category-groups.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupForClassification, CATEGORY_GROUPS } from '../category-groups';

describe('category grouping', () => {
  it('maps Red Wine → Wine', () => expect(groupForClassification('Red Wine')).toBe('Wine'));
  it('maps Whiskey and Whisky → Whisky', () => {
    expect(groupForClassification('Whisky')).toBe('Whisky');
    expect(groupForClassification('Whiskey')).toBe('Whisky');
  });
  it('splits pipe-delimited (Red Wine|Fruit Wine) → Wine', () =>
    expect(groupForClassification('Red Wine|Fruit Wine')).toBe('Wine'));
  it('unknown → Accessories (catch-all)', () =>
    expect(groupForClassification('Mystery')).toBe('Accessories'));
  it('exposes ~7 groups', () => expect(CATEGORY_GROUPS.length).toBeLessThanOrEqual(7));
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** `category-groups.ts` per spec §10.2-A: a map from each of the 44 known classifications to one of `Wine | Whisky | Spirits | Sake & Asian | Beer & RTD | Accessories`. `groupForClassification(c)` splits on `|`, takes the first segment, looks it up, defaults to `Accessories`.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): collapse 44 classifications into 7 friendly groups"`

---

## Task 4: Price tiers + formatPrice

**Files:**
- Create: `apps/catalog/lib/price-tiers.ts`
- Test: `apps/catalog/lib/__tests__/price-tiers.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { formatPrice, tierForPrice, PRICE_TIERS } from '../price-tiers';

describe('price tiers', () => {
  it('formats THB with ฿ and separators', () => expect(formatPrice(1600)).toBe('฿1,600'));
  it('buckets 500 → Under ฿1,000', () => expect(tierForPrice(500).label).toContain('Under'));
  it('buckets 20000 → ฿15,000+', () => expect(tierForPrice(20000).label).toContain('15,000'));
  it('has 5 brackets', () => expect(PRICE_TIERS.length).toBe(5));
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement** brackets from spec §10.2-B (`Under ฿1,000 · ฿1,000–3,000 · ฿3,000–7,000 · ฿7,000–15,000 · ฿15,000+`); `formatPrice` uses `new Intl.NumberFormat('en-US')` prefixed with `฿`.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): THB price tiers + formatPrice"`

---

## Task 5: Recommender (rule-based, pluggable)

**Files:**
- Create: `apps/catalog/lib/recommender.ts`
- Test: `apps/catalog/lib/__tests__/recommender.test.ts`

- [ ] **Step 1: Failing test** — asserts 4 valid, in-stock, de-duplicated, self-excluded recs, scored per spec §6.

```ts
import { describe, it, expect } from 'vitest';
import { getRecommendations } from '../recommender';

const base = { sku:'A', name:'A', region:'Bordeaux', grape_variety:'Cabernet',
  country:'France', classification:'Red Wine', food_matching:'Beef, Lamb', price:1600, is_in_stock:true } as any;
const pool = [
  base,
  { ...base, sku:'B', name:'B', price:1700 },               // same everything → top
  { ...base, sku:'C', name:'C', region:'Napa', food_matching:'Beef', price:1800 },
  { ...base, sku:'D', name:'D', region:'X', grape_variety:'Y', country:'Z', food_matching:'Fish', price:50000 },
  { ...base, sku:'E', name:'E', is_in_stock:false },        // OOS → excluded
];

describe('recommender', () => {
  it('returns up to 4, excludes self and OOS, no dupes', () => {
    const recs = getRecommendations(base, pool);
    expect(recs.length).toBeLessThanOrEqual(4);
    expect(recs.find(r => r.sku === 'A')).toBeUndefined();
    expect(recs.find(r => r.sku === 'E')).toBeUndefined();
    expect(new Set(recs.map(r => r.sku)).size).toBe(recs.length);
  });
  it('ranks the most-similar product first', () => {
    expect(getRecommendations(base, pool)[0].sku).toBe('B');
  });
  it('a far-out-of-band product (price 50000 vs 1600, no shared attrs) ranks last or is dropped', () => {
    const recs = getRecommendations(base, pool);
    const dIdx = recs.findIndex(r => r.sku === 'D');
    expect(dIdx === -1 || dIdx === recs.length - 1).toBe(true);
  });
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement** `getRecommendations(product, all)` with the §6 scoring (region +3, grape +2, country +1, food overlap +1/shared, same classification +1, price within ±40% +1); filter self + OOS, sort desc, slice 4. Structure it so a future `coPurchaseStrategy` can be checked first (comment the seam).

> **PERF NOTE (avoid O(n²) blow-up at build).** `getRecommendations` is O(n) per call.
> Calling it during SSG of all ~11,436 product pages would be O(n²) ≈ 130M ops and can
> stall the build. **Mitigation (implemented in Task 11):** precompute recommendations
> ONCE into a `Map<sku, sku[]>` and have product pages read from the map, not recompute.
> Add a `precomputeRecommendations(all): Map<string,string[]>` export here that bucketizes
> candidates by `region`/`classification` first to shrink each comparison set.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): rule-based recommender (BI-swap ready)"`

---

## Task 6: Contact deep-link builder

**Files:**
- Create: `apps/catalog/lib/contact.ts`
- Test: `apps/catalog/lib/__tests__/contact.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildContactLinks } from '../contact';

describe('contact links', () => {
  const env = { line:'https://line.me/R/ti/p/@wnlq9', wa:'66812345678', fb:'wnlq9' };
  it('per-product WhatsApp pre-fills name + sku', () => {
    const l = buildContactLinks(env, { name:'Château Test', sku:'WRW2106AC' });
    expect(l.whatsapp).toContain('wa.me/66812345678');
    expect(decodeURIComponent(l.whatsapp)).toContain('Château Test');
    expect(decodeURIComponent(l.whatsapp)).toContain('WRW2106AC');
  });
  it('global (no product) builds general links', () => {
    const l = buildContactLinks(env);
    expect(l.line).toContain('line.me');
    expect(l.facebook).toContain('m.me/wnlq9');
  });
});
```

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement** `buildContactLinks(env, product?)` reading handles from params (callers pass `process.env` values); WhatsApp `https://wa.me/<num>?text=<encoded>`, FB `https://m.me/<page>`, LINE passthrough. Pre-fill text: `I'm interested in <name> — <sku>` when product given.

> **ENV CONTRACT (resolved — read before Tasks 9 & 14).** Env var names match the
> spec **exactly** and have **NO `NEXT_PUBLIC_` prefix**: `LINE_OFFICIAL_URL`,
> `WHATSAPP_NUMBER`, `FB_MESSENGER_PAGE`. `buildContactLinks` is a **pure function** —
> it never touches `process.env` itself. Links are computed **at build time in server
> components** (pages are SSG) by reading `process.env.LINE_OFFICIAL_URL` etc. and
> calling `buildContactLinks`. The resulting **plain string links are passed as props**
> into `ContactButtons` and any client modal (`QuickView`). Therefore NO `NEXT_PUBLIC_`
> var is needed — the browser only ever sees the finished URL strings, not the env. This
> keeps a single env-name set across spec, Task 9, and Task 14.
- [ ] **Step 4: Run, PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): contact deep-link builder"`

---

## Task 7: Tailwind theme + global frame (Maison, accessibility-first)

**Files:**
- Modify: `apps/catalog/tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`
- Create: `components/Header.tsx`, `components/Footer.tsx`, `components/TrustBar.tsx`

- [ ] **Step 1: Theme tokens** — set base font 18px, near-black `#1a1a1a` on white, one accent color, generous spacing; visible `:focus-visible` outline in `globals.css`.
- [ ] **Step 2: Header** — big bold `WNLQ9` wordmark (left), nav (Shop · Explore by Map · About · Contact), search icon, sticky. Tap targets ≥44px.
- [ ] **Step 3: Footer** — WNLQ9, contact links, category links.
- [ ] **Step 4: TrustBar** — "Browse freely · Contact us to order · No online payment yet."
- [ ] **Step 5: Wire into `layout.tsx`**; verify in browser at `localhost:3100` (header sticky, focus rings visible on Tab).
- [ ] **Step 6: Commit.** `git commit -m "feat(catalog): Maison theme + accessible global frame"`

---

## Task 8: Storefront image + product card + quick-view

**Files:**
- Create: `components/StorefrontImage.tsx`, `components/ProductCard.tsx`, `components/QuickView.tsx`

- [ ] **Step 1: `StorefrontImage`** — `next/image` with `fill`/sizes, lazy by default, light placeholder when `src` missing (110 products). NOT the internal dark `ProductImage`.
- [ ] **Step 2: `ProductCard`** — large image, name, `formatPrice(price)`, OOS badge if `!is_in_stock`, "Quick look" button. Min 44px targets, 18px name.
- [ ] **Step 3: `QuickView`** — modal (focus-trapped, ESC to close) with image, name, price, key attributes, per-product contact buttons (built in Task 9), link to full page.
- [ ] **Step 4: Browser-verify** a card + quick-view render against a real product on a temp test page.
- [ ] **Step 5: Commit.** `git commit -m "feat(catalog): storefront image, product card, quick-view"`

---

## Task 9: Contact buttons + Filters components

**Files:**
- Create: `components/ContactButtons.tsx`, `components/Filters.tsx`

- [ ] **Step 1: `ContactButtons`** — receives **ready-made link strings as props** (`{ line, whatsapp, facebook }`), computed by the parent server component via `buildContactLinks` reading the non-prefixed env vars (see ENV CONTRACT in Task 6). Renders LINE/WhatsApp/FB buttons; all `target="_blank" rel="noopener"`. It does NOT read env itself, so it works inside client modals without `NEXT_PUBLIC_`.
- [ ] **Step 2: `Filters`** — big visible row (Price tiers, Country, Type=group, In-stock) + Sort dropdown + "More filters" expander (region, grape, body, acidity, tannin, flavor tags, critic score). State reflected in URL query.
- [ ] **Step 3: Browser-verify** filters toggle and a contact button opens the right pre-filled link.
- [ ] **Step 4: Commit.** `git commit -m "feat(catalog): contact buttons + accessible filters"`

---

## Task 10: Shop page (SSG grid + filtering + pagination)

**Files:**
- Create: `apps/catalog/app/shop/page.tsx`

- [ ] **Step 1: Implement** server component: read `getAllProducts()`, apply group/country/price-tier/in-stock filters + sort from `searchParams`, paginate 24/page, render `ProductCard` grid (3→2→1 responsive) + pagination + `Filters` + `TrustBar`. Filtering happens server-side before slicing.
- [ ] **Step 2: Browser-verify** the full journey: load `/shop`, switch category groups, apply a price tier, toggle in-stock, change sort, open "More filters", page through. Confirm margin/B2B never appear in page source.
- [ ] **Step 3: Commit.** `git commit -m "feat(catalog): shop grid with filters, sort, pagination"`

---

## Task 11: Product detail page (SSG + attribute-first + taste viz)

**Files:**
- Create: `apps/catalog/app/product/[sku]/page.tsx`, `apps/catalog/lib/taste-adapter.ts`
- Copy: `components/product/StructuralGauges.tsx` + `TasteWheel.tsx` into `apps/catalog/components/product/` (port; adapt styles to light theme)
- Test: `apps/catalog/lib/__tests__/taste-adapter.test.ts`

- [ ] **Step 0: Build the taste-data adapter (REQUIRED — ported components need re-keyed data).** Verified prop shapes: `TasteWheel` wants `tiers: {primary, secondary, tertiary}` (each `Note[]` = `{note, intensity}`); `StructuralGauges` wants `structural: Record<string,string>` keyed `body/acidity/tannin`. The raw export has `taste_profile.tiers` (NESTED — pass `taste_profile.tiers`, not the whole object) and FLAT `wine_body`/`wine_acidity`/`wine_tannin`. Write `taste-adapter.ts`:
  - `toTiers(taste_profile)` → returns `taste_profile?.tiers ?? null` (guarding missing tiers per component's own `?? []` handling).
  - `toStructural(p)` → `{ body: p.wine_body, acidity: p.wine_acidity, tannin: p.wine_tannin }` (drop nulls).
  Test both with a real product (e.g. `taste_profile.structure === 'tiered'`) and a product with no taste data (returns null/empty → components render nothing). Test-first: write the failing test, run FAIL, implement, run PASS.

- [ ] **Step 1: `generateStaticParams`** returns all SKUs from `getAllProducts()` (SSG all ~11,436 pages). **Call `precomputeRecommendations(getAllProducts())` once at module load** (Task 5) and have the page read recs from the `Map<sku,sku[]>` — do NOT call `getRecommendations` per page (avoids O(n²), see Task 5 PERF NOTE). **Fallback:** if the full SSG build proves too slow/memory-heavy in Task 14 Step 1, switch product pages to ISR (`export const dynamicParams = true` + `revalidate`) and pre-render only a top slice; note this is the escape hatch, SSG is the default.
- [ ] **Step 2: Implement page** — image left; right: name, formatPrice, attributes (country/region/grape/vintage/bottle size/body/acidity/tannin — **omit `alcohol`**), description (if present), food pairing, critic badge (only with `score_summary`), stock. Render `StructuralGauges`/`TasteWheel` when taste data present. **When no description, the attribute matrix + taste viz are the hero (§10.2-C).** Per-product `ContactButtons`. Recommended-together rail via `getRecommendations`.
- [ ] **Step 3: Per-product SEO** — `generateMetadata` sets title/description/OG image.
- [ ] **Step 4: Unknown SKU → `notFound()`** (clean 404 with link to Shop).
- [ ] **Step 5: Browser-verify** a described product, a description-less product (attribute-hero), an OOS product, and a bad SKU (404). Verify each contact button's pre-filled text.
- [ ] **Step 6: Commit.** `git commit -m "feat(catalog): product detail w/ attribute-first + taste viz"`

---

## Task 12: Home page + search index

**Files:**
- Create: `apps/catalog/app/page.tsx` (replace placeholder), `lib/search-index.ts`, `components/SearchOverlay.tsx`

- [ ] **Step 1: Home** — hero, featured products (manual SKU list in config, fallback to in-stock + `score_summary`; never labeled "best-selling"), "Shop by Category" (7 groups), footer band.
- [ ] **Step 2: Search** — build-time lightweight index (sku+name+brand+region via `toPublicProduct`); client overlay does substring/case-insensitive match → links to product pages. Note the index size caveat (§8.1).
- [ ] **Step 3: Browser-verify** home renders, category links go to filtered `/shop`, search finds a product.
- [ ] **Step 4: Commit.** `git commit -m "feat(catalog): home page + client search"`

---

## Task 13: About / Contact pages + Explore-by-Map placeholder

**Files:**
- Create: `app/about/page.tsx`, `app/contact/page.tsx`, `app/explore-map/page.tsx`

- [ ] **Step 1: About/Contact** static pages with global `ContactButtons`.
- [ ] **Step 2: Explore-by-Map = simple placeholder (DEFAULT path).** Ship a clean page explaining the map view is coming and linking to the internal tool. The full port is **Task 15 (optional)** — do NOT attempt the port here; the placeholder is what ships for the 2-day launch.
- [ ] **Step 3: Browser-verify** nav reaches all three.
- [ ] **Step 4: Commit.** `git commit -m "feat(catalog): about/contact + explore-map placeholder"`

---

## Task 15 (OPTIONAL — only if time remains after launch): Port the full Explore-by-Map

Skip for the 2-day launch unless Tasks 0–14 are done with buffer to spare.

**Files:** copy `components/explore/*` (13 files), `lib/explore/*` (5 files), and the
required `data/taxonomy/explore-taxonomy.json` into the catalog app.

- [ ] **Step 1: Inventory dependencies** — the map is a custom SVG `ExploreMap.tsx`
  (dynamic-imported, `ssr:false`) plus a 13-component tree, a 5-file lib tree, and a
  taxonomy JSON that is NOT the products export. Confirm all are copied and the taxonomy
  path resolves.
- [ ] **Step 2: Replace the placeholder** route with the ported client UI.
- [ ] **Step 3: Browser-verify** the map renders and navigates; it's a secondary path,
  so a dark theme here is acceptable if restyling risks time.
- [ ] **Step 4: Commit.** `git commit -m "feat(catalog): port full explore-by-map"`

---

## Task 14: Production build + Vercel deploy verification

**Files:**
- Create: `apps/catalog/.env.example`, root-level `vercel.catalog.json` or use dashboard settings
- Verify: root `.vercelignore` does NOT strip `apps/catalog` or `data/live_products_export.json` (it strips `data/db/`, `*.py`, `scripts/` — none of which the catalog needs; the export is git-tracked and not ignored — verified)

> **VERCEL MONOREPO DATA-PATH (resolved — the #1 late-stage risk).** Do NOT set the new
> project's Root Directory to `apps/catalog` — that would put repo-root `data/` outside
> the build context and `fs` would `ENOENT` at build. Instead:
> - **Root Directory = repo root** (`.`), so `process.cwd()` is the repo root and
>   `data/live_products_export.json` is in the build context (cwd-relative path resolves —
>   this is why the loader's first candidate is `cwd/data/...`).
> - **Build Command** = `cd apps/catalog && npm install && npm run build`
> - **Output Directory** = `apps/catalog/.next`
> - **Install Command** = `npm install --prefix apps/catalog` (or part of build)
> This is the standard "build a sub-app from repo root" pattern and is the configuration
> the Step-6 deploy verifies. The loader's multi-candidate `exportPath()` (Task 2) makes
> both this and local dev work without edits.

- [ ] **Step 1: Full local production build** — Run: `cd apps/catalog && npm run build`. Expected: SSG emits home + shop + ~11,436 product pages with no errors; build reads `../../data/live_products_export.json` successfully.
- [ ] **Step 2: `npm run start`** and smoke-test the production build locally on `:3100`.
- [ ] **Step 3: Run all unit tests** — Run: `cd apps/catalog && npm run test`. Expected: all green.
- [ ] **Step 4: Margin-leak grep gate** — Run: `grep -rl "margin_pct\|b2b_margin" apps/catalog/.next || echo "CLEAN"`. Expected: `CLEAN` (no internal field in any built output).
- [ ] **Step 5: Create new Vercel project** using the **VERCEL MONOREPO DATA-PATH** config above (Root Directory = repo root, build command targets `apps/catalog`). Set env vars **per the ENV CONTRACT (Task 6) — non-prefixed**: `LINE_OFFICIAL_URL`, `WHATSAPP_NUMBER`, `FB_MESSENGER_PAGE`. Assign the primary WNLQ9 domain (keep the existing internal project; no deletion).
- [ ] **Step 6: Deploy + verify on the live URL** (CLAUDE.md Rule 7 — browser verification is the only proof): home → shop → filter/sort → product detail → each contact button (verify pre-filled LINE/WhatsApp/FB) → bad SKU 404 → images load from CDN. Confirm prices show ฿ formatting.
- [ ] **Step 7: Commit.** `git commit -m "chore(catalog): production build, env, Vercel deploy verified"`

---

## Definition of Done
- [ ] All unit tests pass (`npm run test`)
- [ ] `npm run build` produces the static catalog with no errors
- [ ] Margin/B2B fields absent from `.next` output (grep gate clean)
- [ ] Live on Vercel at the primary domain, internal project untouched
- [ ] Full user journey browser-verified on the live URL (Rule 7)
- [ ] Images load from `th.wine-now.com` via `next/image`
- [ ] Contact buttons open correct pre-filled LINE/WhatsApp/FB messages

## Out of scope (Phase 2)
Cart → list → emailed order summary; real BI co-purchase data; online payment; accounts.
