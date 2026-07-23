# Catalog Login System (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase-backed email+password and Google OAuth login/registration
to `apps/catalog`, and gate product price/promotion data so only logged-in,
email-confirmed users (or verified search-engine crawlers) can see it.

**Architecture:** Supabase Auth (session in an HTTP-only cookie via
`@supabase/ssr`) provides identity. The existing product-data cache
(`getAllProducts()`/`getProductBySku()` in `lib/catalog-data.ts`) is left
**completely unchanged** — it keeps returning full data including price, exactly
as today, so the 11 call sites that never display price are untouched. A new,
single, narrowly-scoped redaction helper (`redactPriceIfUnauthorized`) is applied
only at the 3 places price actually reaches a user: `ProductCard`, `PriceBlock`,
and the product JSON-LD builder. A new `getViewerAccess()` helper (session +
crawler-UA check) computes the one `includePrice` boolean per request.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase Auth + `@supabase/ssr`,
Resend (SMTP for confirmation emails), Vitest (existing test runner — confirm in
Task 0).

**Spec:** `docs/superpowers/specs/2026-07-23-catalog-login-system-design.md`

---

## Important corrections vs. the spec (read before starting)

The spec describes `getAllProducts()`/`getProductBySku()` gaining an
`includePrice` parameter directly. **This plan does NOT do that.** Investigation
during planning found:

- `_all`/`_bySku` in `lib/catalog-data.ts` are **module-level singletons**,
  populated once per server process by a lazy `load()`. Threading a per-request
  flag through them would require caching two full variants or re-projecting
  26MB of JSON per request — unnecessary complexity.
- These two functions are called from **14 files**, 11 of which
  (finder, blog, explore-map, recommendations API, search-index, featured.ts)
  never display price at all.
- `PublicProduct.price` is a **required** `number` field, not optional — so a
  function that omits it needs a different, wider return type, not a mutation
  of `PublicProduct` itself.

Instead: `getAllProducts()`/`getProductBySku()` are untouched. A new
`PublicProductDisplay` type and a new `redactPriceIfUnauthorized()` function are
added, and applied ONLY where price is rendered. This keeps the diff minimal,
keeps the security boundary in one auditable function, and avoids touching any
code path that was never a leak risk.

**Correction after plan review (verified against actual source, not assumed):**
the price-rendering surface is **larger than 3 call sites**. A full sweep found
these additional real leaks, none of which the original plan draft addressed:

- **`apps/catalog/app/catalogs/retail/full/page.tsx`** and
  **`apps/catalog/app/catalogs/retail/[group]/page.tsx`** — dedicated printable
  retail price-list pages. `robots: { index: false, follow: false }` (SEO-hidden)
  but **zero auth check**. Renders every SKU's price in a plain table via
  `CatalogDocument.tsx` / `lib/catalog-print.ts`. This is a live, complete,
  unauthenticated price-list leak today and directly contradicts this project's
  goal — see Task 9.5 below.
- **`apps/catalog/app/explore-map/[region]/page.tsx`** — computes
  `priceMin = Math.min(...regionProducts.map(p => p.price))` (line ~26-27) and
  interpolates it directly into visible page copy ("Prices from ฿X"), and feeds
  `top5` into `buildCollectionPage()` (`lib/seo/jsonld.ts`), which conditionally
  embeds `offers.price` per item into `CollectionPage` JSON-LD. See Task 7.5.
- **`apps/catalog/app/shop/[group]/page.tsx`** — sorts by price (line ~67) and
  feeds `top20` into `buildItemList()` (`lib/seo/jsonld.ts`), which also embeds
  `offers.price` per item into `ItemList` JSON-LD. See Task 7.5.
- **`apps/catalog/components/RecsCarousel.tsx`** — has its own
  `PublicProduct`-typed `RecItem` interface and its own `displayPrice()` helper
  (used to sort recommendation cards price-ascending), and renders `ProductCard`
  internally. Redacting products *before* handing them to `RecsCarousel` would
  break its price-based sort (a redacted item has no price to sort by). This
  needs its own type-widening task and a sequencing fix (sort first, redact
  after). See Task 9.6.

---

## File Structure

**New files:**
- `apps/catalog/lib/supabase/server.ts` — server-side Supabase client (cookie-aware)
- `apps/catalog/lib/supabase/client.ts` — browser Supabase client
- `apps/catalog/lib/supabase/middleware.ts` — session-refresh helper for `middleware.ts`
- `apps/catalog/lib/auth.ts` — `getSession()`, `getViewerAccess()`
- `apps/catalog/lib/price-access.ts` — `PublicProductDisplay` type + `redactPriceIfUnauthorized()`
- `apps/catalog/app/login/page.tsx`
- `apps/catalog/app/register/page.tsx`
- `apps/catalog/app/auth/callback/route.ts`
- `apps/catalog/lib/__tests__/price-access.test.ts`

**Modified files:**
- `apps/catalog/middleware.ts` — add session refresh, extend matcher (incl. `/catalogs/:path*` if Task 9.5 chooses the standard login gate)
- `apps/catalog/components/ProductCard.tsx` — accept `PublicProductDisplay`, add conditional price rendering
- `apps/catalog/components/product/PriceBlock.tsx` — no rendering logic change needed (already null-safe), but its prop types are re-examined in Task 6 so callers can pass `undefined` cleanly
- `apps/catalog/components/RecsCarousel.tsx` — widen `RecItem.product` to `PublicProductDisplay`, redact per-item AFTER its internal price-sort (Task 9.6)
- `apps/catalog/lib/seo/jsonld.ts` — `buildProductSchema()`, `buildCollectionPage()`, `buildItemList()` param types widen to accept `PublicProductDisplay`, conditional `offers` blocks (Tasks 7, 7.5)
- `apps/catalog/app/product/[sku]/page.tsx` — compute `includePrice`, pass redacted values to `PriceBlock`/`buildProductSchema`, pass `includePrice` to `RecsCarousel`
- `apps/catalog/app/shop/page.tsx` — compute `includePrice`, redact products before passing to `ProductCard`
- `apps/catalog/app/shop/[group]/page.tsx` — compute `includePrice`, redact sorted `top20` before `buildItemList()` (Task 7.5)
- `apps/catalog/app/explore-map/[region]/page.tsx` — compute `includePrice`, gate visible "Prices from ฿X" copy and redact `top5` before `buildCollectionPage()` (Task 7.5)
- `apps/catalog/app/catalogs/retail/full/page.tsx`, `[group]/page.tsx`, `page.tsx` — gate entirely behind login (or an internal-access mechanism, pending user decision) — was a complete unauthenticated price-list leak (Task 9.5, CRITICAL)
- `apps/catalog/app/page.tsx` — becomes dynamic if it renders `ProductCard` (verify in Task 11)
- `apps/catalog/package.json` — add `@supabase/ssr`
- `apps/catalog/.env.example` — document new/reused env vars

**Note on scope:** the original plan draft described this as touching "3 call
sites" for price redaction (`ProductCard`, `PriceBlock`, the JSON-LD builder).
Plan review found this undercounted the actual price-rendering surface — see
"Correction after plan review" above. The full set is now: `ProductCard`,
`PriceBlock`, `RecsCarousel`, `buildProductSchema`, `buildCollectionPage`,
`buildItemList`, plus the retail print-catalog pages as a distinct
whole-page gate rather than field-level redaction.

---

## Task 0: Confirm test runner and baseline

**Files:** none (verification only)

- [ ] **Step 1: Find the test command**

Run: `cat "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog/package.json" | grep -A3 '"scripts"'`

Expected: a `test` script (likely `vitest` based on existing `__tests__` dirs).

- [ ] **Step 2: Run the existing test suite to confirm a clean baseline**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm test -- --run 2>&1 | tail -40`

Expected: all existing tests pass. If any are already failing, note it — do not
attribute later failures to this work if they pre-exist.

- [ ] **Step 3: Confirm build works before starting**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run build 2>&1 | tail -60`

Expected: build succeeds. This is your rollback reference point.

---

## Task 1: Supabase project decision + env vars

**Files:**
- Modify: `apps/catalog/.env.example`
- Modify: `apps/catalog/.env.local` (not committed — local only)

This task is manual/dashboard work, not code, but must be done before Task 2 can
be tested against a real backend.

- [ ] **Step 1: Decide same-project vs. new-project with the user**

Per the spec's open decision: recommend reusing the existing Supabase project
(the one behind root `.env`'s `SUPABASE_DB_URL` / `NEXT_PUBLIC_SUPABASE_URL`).
Confirm with the user before proceeding — this is a real infrastructure choice,
not a code default.

- [ ] **Step 2: In the Supabase dashboard, enable Auth providers**

- Enable Email provider (should be on by default).
- Enable Google provider: requires a Google Cloud OAuth Client ID/Secret
  (Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`).
  Get these from the user or have them create a Google Cloud OAuth consent
  screen + credentials if none exist yet.

- [ ] **Step 3: Copy env vars into `apps/catalog/.env.local`**

Reuse the existing var names from root `.env.local` (do NOT invent
`NEXT_PUBLIC_SUPABASE_ANON_KEY` — the existing name is
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`):

```
NEXT_PUBLIC_SUPABASE_URL=<same value as root .env.local>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same value as root .env.local>
```

`SUPABASE_SERVICE_ROLE_KEY` is NOT needed in the catalog app for phase 1 (no
server-side admin operations) — do not add it here, keeps blast radius small.

- [ ] **Step 4: Update `apps/catalog/.env.example`**

```
# Supabase Auth (shared project with root app's BI-sync — see docs/superpowers/specs/2026-07-23-catalog-login-system-design.md)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/.env.example
git commit -m "docs(catalog): document Supabase Auth env vars for login system"
```

(`.env.local` is gitignored — do not attempt to add it.)

---

## Task 2: Install `@supabase/ssr`

**Files:**
- Modify: `apps/catalog/package.json`

- [ ] **Step 1: Install**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm install @supabase/ssr @supabase/supabase-js`

Expected: both added to `dependencies` in `apps/catalog/package.json` (catalog
has its own `package.json`/`node_modules`, separate from root — confirmed during
research; root already depends on `@supabase/supabase-js` but catalog does not
inherit it).

- [ ] **Step 2: Verify install**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm ls @supabase/ssr @supabase/supabase-js`

Expected: both listed with resolved versions, no errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/package.json apps/catalog/package-lock.json
git commit -m "chore(catalog): add @supabase/ssr for auth"
```

---

## Task 3: Supabase client factories

**Files:**
- Create: `apps/catalog/lib/supabase/server.ts`
- Create: `apps/catalog/lib/supabase/client.ts`
- Test: `apps/catalog/lib/supabase/__tests__/server.test.ts`

- [ ] **Step 1: Write the server client factory**

```typescript
// apps/catalog/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Must be called fresh per-request (Server Component / Route Handler) —
 * do NOT cache the returned client across requests.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component (not a Route Handler/Server Action) —
            // cookies() is read-only there. Safe to ignore: middleware refreshes
            // the session on the next request instead.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 2: Write the browser client factory**

```typescript
// apps/catalog/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 3: Write a smoke test for the server factory**

```typescript
// apps/catalog/lib/supabase/__tests__/server.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

describe('createClient (server)', () => {
  it('constructs without throwing given env vars are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    const { createClient } = await import('../server');
    expect(() => createClient()).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/supabase/__tests__/server.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/supabase/
git commit -m "feat(catalog): add Supabase server/browser client factories"
```

---

## Task 4: `getSession()` / `getViewerAccess()`

**Files:**
- Create: `apps/catalog/lib/auth.ts`
- Test: `apps/catalog/lib/__tests__/auth.test.ts`

This is the core auth-state helper every gated page will call.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/catalog/lib/__tests__/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('../supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

describe('getSession', () => {
  beforeEach(() => mockGetUser.mockReset());

  it('returns null when no user is present', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { getSession } = await import('../auth');
    expect(await getSession()).toBeNull();
  });

  it('returns isConfirmed=true when email_confirmed_at is set', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '1', email: 'a@b.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });
    const { getSession } = await import('../auth');
    const session = await getSession();
    expect(session?.isConfirmed).toBe(true);
  });

  it('returns isConfirmed=false when email_confirmed_at is null', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '1', email: 'a@b.com', email_confirmed_at: null } },
      error: null,
    });
    const { getSession } = await import('../auth');
    const session = await getSession();
    expect(session?.isConfirmed).toBe(false);
  });
});

describe('getViewerAccess', () => {
  it('grants includePrice for a confirmed session with no crawler UA', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '1', email: 'a@b.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
      error: null,
    });
    const { getViewerAccess } = await import('../auth');
    expect((await getViewerAccess(null)).includePrice).toBe(true);
  });

  it('grants includePrice for a verified crawler UA with no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { getViewerAccess } = await import('../auth');
    expect((await getViewerAccess('Mozilla/5.0 (compatible; Googlebot/2.1)')).includePrice).toBe(true);
  });

  it('denies includePrice for logged-out non-crawler', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { getViewerAccess } = await import('../auth');
    expect((await getViewerAccess('Mozilla/5.0 (Macintosh)')).includePrice).toBe(false);
  });

  it('denies includePrice for an unconfirmed session even with no crawler UA', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '1', email: 'a@b.com', email_confirmed_at: null } },
      error: null,
    });
    const { getViewerAccess } = await import('../auth');
    expect((await getViewerAccess(null)).includePrice).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/auth.test.ts`

Expected: FAIL — `lib/auth.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/catalog/lib/auth.ts
import { createClient } from './supabase/server';

export interface Session {
  userId: string;
  email: string;
  isConfirmed: boolean;
}

/** Reads the current request's Supabase session. Null if not logged in. */
export async function getSession(): Promise<Session | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    isConfirmed: data.user.email_confirmed_at != null,
  };
}

// Same bot-detection pattern as middleware.ts's existing UA check — kept in
// sync intentionally, not shared via import, so this file has no dependency
// on middleware.ts's Edge-runtime constraints.
const CRAWLER_UA = /bot|crawler|spider|facebookexternalhit|Twitterbot|LinkedInBot/i;

export interface ViewerAccess {
  session: Session | null;
  isVerifiedCrawler: boolean;
  /** True if price/promotion data should be included in the response. */
  includePrice: boolean;
}

/**
 * Resolves whether the current request should see price. Logged-in +
 * confirmed sessions and known-crawler UAs both qualify; everyone else
 * (logged-out, unconfirmed) does not. See spec's "Crawler exception" section —
 * this is an SEO convenience, not a security boundary; the actual boundary is
 * that price is structurally absent from the redacted product object, not
 * this UA check.
 */
export async function getViewerAccess(userAgent: string | null): Promise<ViewerAccess> {
  const session = await getSession();
  const isVerifiedCrawler = CRAWLER_UA.test(userAgent ?? '');
  const includePrice = Boolean(session?.isConfirmed) || isVerifiedCrawler;
  return { session, isVerifiedCrawler, includePrice };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/auth.test.ts`

Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/auth.ts apps/catalog/lib/__tests__/auth.test.ts
git commit -m "feat(catalog): add getSession/getViewerAccess auth helpers"
```

---

## Task 5: `redactPriceIfUnauthorized()` — the actual security boundary

**Files:**
- Create: `apps/catalog/lib/price-access.ts`
- Test: `apps/catalog/lib/__tests__/price-access.test.ts`

This is the single function all price-gating correctness depends on. Test it
thoroughly.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/catalog/lib/__tests__/price-access.test.ts
import { describe, it, expect } from 'vitest';
import { redactPriceIfUnauthorized } from '../price-access';
import type { PublicProduct } from '../types';

function makeProduct(overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    sku: 'TEST-1',
    name: 'Test Wine',
    price: 1000,
    special_price: 800,
    sp_discount_pct: '20',
    ...overrides,
  } as PublicProduct;
}

describe('redactPriceIfUnauthorized', () => {
  it('strips price, special_price, sp_discount_pct when includePrice is false', () => {
    const result = redactPriceIfUnauthorized(makeProduct(), false);
    expect(result.price).toBeUndefined();
    expect(result.special_price).toBeUndefined();
    expect(result.sp_discount_pct).toBeUndefined();
  });

  it('preserves all other fields when redacting', () => {
    const result = redactPriceIfUnauthorized(makeProduct(), false);
    expect(result.sku).toBe('TEST-1');
    expect(result.name).toBe('Test Wine');
  });

  it('leaves price fields untouched when includePrice is true', () => {
    const result = redactPriceIfUnauthorized(makeProduct(), true);
    expect(result.price).toBe(1000);
    expect(result.special_price).toBe(800);
    expect(result.sp_discount_pct).toBe('20');
  });

  it('does not mutate the input object', () => {
    const input = makeProduct();
    redactPriceIfUnauthorized(input, false);
    expect(input.price).toBe(1000); // original untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/price-access.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/catalog/lib/price-access.ts
import type { PublicProduct } from './types';

/**
 * PublicProduct with price fields widened to optional, for the logged-out/
 * unconfirmed rendering path. Consumers that display price (ProductCard,
 * PriceBlock, JSON-LD) must accept this type, not PublicProduct, so
 * TypeScript forces them to handle the absent-price case rather than
 * assuming price is always there.
 */
export type PublicProductDisplay = Omit<
  PublicProduct,
  'price' | 'special_price' | 'sp_discount_pct'
> & {
  price?: number;
  special_price?: number;
  sp_discount_pct?: string;
};

/**
 * THE price-gating security boundary. When includePrice is false, price/
 * special_price/sp_discount_pct are structurally absent from the returned
 * object — not hidden in JSX, not styled away. Any Client Component that
 * receives this result has nothing to leak via the RSC payload/devtools.
 * See docs/superpowers/specs/2026-07-23-catalog-login-system-design.md.
 */
export function redactPriceIfUnauthorized(
  product: PublicProduct,
  includePrice: boolean,
): PublicProductDisplay {
  if (includePrice) return product;
  const { price, special_price, sp_discount_pct, ...rest } = product;
  void price;
  void special_price;
  void sp_discount_pct;
  return rest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/price-access.test.ts`

Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/price-access.ts apps/catalog/lib/__tests__/price-access.test.ts
git commit -m "feat(catalog): add redactPriceIfUnauthorized price-gating boundary"
```

---

## Task 6: Wire redaction into `ProductCard.tsx`

**Files:**
- Modify: `apps/catalog/components/ProductCard.tsx`
- Test: `apps/catalog/components/__tests__/ProductCard.test.tsx` (create if no
  existing test file covers this component — check first)

- [ ] **Step 1: Check for an existing ProductCard test file**

Run: `find "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" -iname "*ProductCard*test*"`

If one exists, add to it; otherwise create `apps/catalog/components/__tests__/ProductCard.test.tsx`.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/catalog/components/__tests__/ProductCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from '../ProductCard';
import type { PublicProductDisplay } from '@/lib/price-access';

function makeProduct(overrides: Partial<PublicProductDisplay> = {}): PublicProductDisplay {
  return {
    sku: 'TEST-1',
    name: 'Test Wine',
    price: 1000,
    is_in_stock: true,
    ...overrides,
  } as PublicProductDisplay;
}

describe('ProductCard price rendering', () => {
  it('renders the price when present', () => {
    render(<ProductCard product={makeProduct({ price: 1000 })} />);
    expect(screen.getByText(/1,000|1000/)).toBeInTheDocument();
  });

  it('renders NO price and no placeholder when price is undefined', () => {
    const { container } = render(<ProductCard product={makeProduct({ price: undefined })} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/\d/); // no stray numeric price
  });
});
```

(Adjust the import/render call to match `ProductCard`'s actual required props —
check the `ProductCardProps` interface at `components/ProductCard.tsx:33-67`
for other required props like `href`/`onQuickView` before finalizing this test;
fill in reasonable defaults/mocks for anything required.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run components/__tests__/ProductCard.test.tsx`

Expected: FAIL on the "no placeholder" assertion — current code renders `'—'`.

- [ ] **Step 4: Update the `product` prop type and non-sale branch**

In `apps/catalog/components/ProductCard.tsx`:

1. Change the import and prop type (around line 34):

```typescript
import type { PublicProductDisplay } from '@/lib/price-access';
// ...
interface ProductCardProps {
  product: PublicProductDisplay; // was: PublicProduct
  // ...unchanged other props
}
```

2. Replace the non-sale branch (current lines ~222-226):

```tsx
// Before:
) : (
  <p className="mt-2 text-lg font-semibold text-primary tabular-nums">
    {formatPrice(product.price)}
  </p>
)}

// After:
) : product.price !== undefined ? (
  <p className="mt-2 text-lg font-semibold text-primary tabular-nums">
    {formatPrice(product.price)}
  </p>
) : null}
```

3. Check `resolveSale()`'s call site (near the top of the component body) still
   works — it should, since `resolveSale(undefined, undefined)` already returns
   `null` per `lib/price-tiers.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run components/__tests__/ProductCard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run full test suite to check for type-error fallout**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx tsc --noEmit 2>&1 | head -60`

Expected: no new type errors. `ProductCard`'s callers currently pass
`PublicProduct` — since `PublicProduct` is structurally assignable to
`PublicProductDisplay` (all its price fields are a subtype of the optional
version), this should compile without changes at call sites. If TypeScript
complains at a specific call site, note it — do not paper over with `as any`.

Also check `compactAttrRows(p: PublicProduct)` (`ProductCard.tsx:70`, called
at line ~100) — its widened caller now passes `PublicProductDisplay`. Its
actual field reads (country/region/variety/vintage etc.) are already optional
on `PublicProduct` today, so this is expected to be a non-issue, but confirm
via this same `tsc --noEmit` run rather than assuming; widen its signature to
`PublicProductDisplay` too if the compiler flags it.

Note: `RecsCarousel.tsx` (a separate Client Component that also renders
`ProductCard` internally) has its OWN `PublicProduct`-typed prop interface —
that is handled separately in Task 9.6, not here, since it also needs a
redaction-sequencing fix (sort before redact) beyond a simple type widen.

- [ ] **Step 7: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/ProductCard.tsx apps/catalog/components/__tests__/
git commit -m "fix(catalog): ProductCard no longer renders '—' placeholder for absent price"
```

---

## Task 7: Wire redaction into `PriceBlock.tsx` + `buildProductSchema`

**Files:**
- Modify: `apps/catalog/lib/seo/jsonld.ts`
- Test: `apps/catalog/lib/seo/__tests__/jsonld.test.ts` (check for existing file first)

`PriceBlock.tsx` itself needs NO logic change — its `price` prop is already
`number | null | undefined` and it already calls `formatPrice(price)`, which
already returns `'—'` for missing values gracefully in terms of not crashing.
BUT `'—'` is still a placeholder, which violates the "no placeholder" UX
requirement — so the calling page (Task 9) must not call `PriceBlock` at all
when `includePrice` is false, rather than calling it with an undefined price.
Note this in a comment; do not add dead conditional logic inside `PriceBlock`
itself for a case its caller should prevent.

- [ ] **Step 1: Check for an existing jsonld test file**

Run: `find "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" -iname "*jsonld*test*"`

- [ ] **Step 2: Write the failing test**

```typescript
// apps/catalog/lib/seo/__tests__/jsonld.test.ts (add to existing file, or create)
import { describe, it, expect } from 'vitest';
import { buildProductSchema } from '../jsonld';
import type { PublicProductDisplay } from '@/lib/price-access';

function makeProduct(overrides: Partial<PublicProductDisplay> = {}): PublicProductDisplay {
  return {
    sku: 'TEST-1',
    name: 'Test Wine',
    price: 1000,
    is_in_stock: true,
    ...overrides,
  } as PublicProductDisplay;
}

describe('buildProductSchema price handling', () => {
  it('includes offers.price when price is present', () => {
    const schema = buildProductSchema(makeProduct({ price: 1000 })) as any;
    expect(schema.offers).toBeDefined();
    expect(schema.offers.price).toBe('1000');
  });

  it('omits the offers block entirely when price is undefined', () => {
    const schema = buildProductSchema(makeProduct({ price: undefined })) as any;
    expect(schema.offers).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/seo/__tests__/jsonld.test.ts`

Expected: FAIL — current code unconditionally builds `offers` with `String(undefined)` = `"undefined"`.

- [ ] **Step 4: Fix `buildProductSchema` (in `apps/catalog/lib/seo/jsonld.ts`, current lines ~94-114)**

Change the function's parameter type to accept `PublicProductDisplay` (import
from `@/lib/price-access`), and make the `offers` block conditional — mirroring
the pattern already used at lines 199 and 222 for `buildCollectionPage`:

```typescript
// Before (line ~94-114):
const schema: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  sku: product.sku,
  ...(description ? { description } : {}),
  ...(product.image_url ? { image: product.image_url } : {}),
  ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
  ...(product.category_type ? { category: product.category_type } : {}),
  ...(product.country ? { countryOfOrigin: product.country } : {}),
  offers: {
    '@type': 'Offer',
    price: String(product.price),
    priceCurrency: 'THB',
    availability,
    url: `${BASE}/product/${product.sku}`,
    seller: { '@type': 'Organization', name: 'WNLQ9' },
  },
  ...(additionalProperty.length ? { additionalProperty } : {}),
};

// After:
const schema: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  sku: product.sku,
  ...(description ? { description } : {}),
  ...(product.image_url ? { image: product.image_url } : {}),
  ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
  ...(product.category_type ? { category: product.category_type } : {}),
  ...(product.country ? { countryOfOrigin: product.country } : {}),
  ...(product.price !== undefined
    ? {
        offers: {
          '@type': 'Offer',
          price: String(product.price),
          priceCurrency: 'THB',
          availability,
          url: `${BASE}/product/${product.sku}`,
          seller: { '@type': 'Organization', name: 'WNLQ9' },
        },
      }
    : {}),
  ...(additionalProperty.length ? { additionalProperty } : {}),
};
```

Also update the function signature (find `export function buildProductSchema(product: PublicProduct` near the top of the function) to accept `PublicProductDisplay` instead of `PublicProduct`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/seo/__tests__/jsonld.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/seo/jsonld.ts apps/catalog/lib/seo/__tests__/
git commit -m "fix(catalog): buildProductSchema omits offers block when price is absent"
```

---

## Task 7.5: Fix the remaining JSON-LD / visible-copy price leaks (`explore-map`, `shop/[group]`)

**Files:**
- Modify: `apps/catalog/lib/seo/jsonld.ts` (`buildCollectionPage`, `buildItemList`)
- Modify: `apps/catalog/app/explore-map/[region]/page.tsx`
- Modify: `apps/catalog/app/shop/[group]/page.tsx`
- Test: extend `apps/catalog/lib/seo/__tests__/jsonld.test.ts`

Found during plan review: `buildProductSchema` (Task 7) is not the only JSON-LD
function that embeds price. `buildCollectionPage` and `buildItemList` (both in
`lib/seo/jsonld.ts`) also conditionally embed `offers.price` per item, fed by
`explore-map/[region]/page.tsx` and `shop/[group]/page.tsx` respectively.
Neither page currently computes `includePrice` at all. `explore-map/[region]`
additionally interpolates a `priceMin` value directly into visible page copy
("Prices from ฿X"), which is a leak even before JSON-LD is considered.

- [ ] **Step 1: Write failing tests for `buildCollectionPage` and `buildItemList`**

Add to `apps/catalog/lib/seo/__tests__/jsonld.test.ts`:

```typescript
import { buildCollectionPage, buildItemList } from '../jsonld';

function makeDisplayProduct(overrides: Partial<PublicProductDisplay> = {}): PublicProductDisplay {
  return { sku: 'TEST-1', name: 'Test Wine', price: 1000, ...overrides } as PublicProductDisplay;
}

describe('buildCollectionPage price handling', () => {
  it('omits offers for items with redacted (undefined) price', () => {
    const schema = buildCollectionPage(
      'Region', 'region-slug', 'Country', 10,
      [makeDisplayProduct({ price: undefined })],
      'desc',
    ) as any;
    expect(schema.hasPart[0].offers).toBeUndefined();
  });
});

describe('buildItemList price handling', () => {
  it('omits offers for items with redacted (undefined) price', () => {
    const schema = buildItemList(
      [makeDisplayProduct({ price: undefined })],
      'Group', 'group-slug', 10,
    ) as any;
    // Inspect whatever key buildItemList uses per-item (check actual field name
    // in the real implementation — likely itemListElement[].item.offers or similar)
    expect(JSON.stringify(schema)).not.toMatch(/"offers"/);
  });
});
```

Adjust the exact assertion shape to match `buildItemList`'s real output
structure — read the function fully first (it wasn't reproduced in detail
here; confirm its exact per-item shape before writing the assertion).

- [ ] **Step 2: Run tests to verify they fail (or already pass by luck)**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/seo/__tests__/jsonld.test.ts`

Both functions already conditionally check `p.price` truthiness (`...(p.price ? {...} : {})`), so passing `price: undefined` may ALREADY produce the
right output today — if so, these tests will pass immediately, confirming the
functions themselves need no code change; only their callers need updating
(Step 3). Do not skip writing the test just because it might already pass —
this is the regression guard for the future.

- [ ] **Step 3: Update `buildCollectionPage`/`buildItemList` param types**

Change both functions' `PublicProduct[]` parameter types (e.g. `topProducts: PublicProduct[]`) to accept `PublicProductDisplay[]` instead, importing from
`@/lib/price-access`. This is a type-only change if Step 2's tests already pass.

- [ ] **Step 4: Wire `includePrice` into `explore-map/[region]/page.tsx` —
  TWO separate functions, not one**

**Read the file fully first — `priceMin` and the JSON-LD-feeding `top5` live
in TWO DIFFERENT exported functions with no shared scope**
(`generateMetadata()` at the top of the file, and the default-exported page
component further down, conventionally `RegionPage`). A fix that only touches
the page component will miss `generateMetadata()`'s leak entirely — this is
exactly the kind of gap that looks fixed but isn't, so treat these as two
separate edits:

**4a. Inside `generateMetadata({ params })`:** this function currently
computes `regionProducts`, `prices`, and `priceMin` (confirm exact line
numbers by reading the file — do not assume they match any earlier line
citation, since the file may have changed), and interpolates
`priceMin ? `. Prices from ฿${priceMin.toLocaleString()}` : ''` directly into
the `desc` string used for both the meta description AND the Open Graph
description. Next.js allows `generateMetadata` to call `headers()`/async code
just like a page component — add:

```typescript
import { headers } from 'next/headers';
import { getViewerAccess } from '@/lib/auth';

export async function generateMetadata({ params }: { params: { region: string } }): Promise<Metadata> {
  // ...existing setup unchanged...
  const { includePrice } = await getViewerAccess(headers().get('user-agent'));
  const priceMin = includePrice && prices.length ? Math.min(...prices) : null;
  // ...rest unchanged; priceMin's existing `priceMin ? ... : ''` conditional
  // in the desc string now naturally omits the price fragment when includePrice is false...
}
```

Note `generateMetadata`'s signature must become `async` (it may already be
synchronous today — check and update the return type to `Promise<Metadata>`
accordingly).

**4b. Inside the default-exported page component (`RegionPage` or similar):**
this is a SEPARATE function/scope from `generateMetadata` — it independently
computes `top5` (or whatever variable feeds `buildCollectionPage()`) and must
independently call `getViewerAccess()` again (calling it twice, once per
function, is normal and cheap — it's a single cookie/header read, not an
expensive operation):

```typescript
const { includePrice } = await getViewerAccess(headers().get('user-agent'));
```

Then pass `top5.map(p => redactPriceIfUnauthorized(p, includePrice))` into
`buildCollectionPage()` instead of the raw `top5`.

This page's rendering mode must also become dynamic (`force-dynamic`) for the
same reason as the product/shop pages — check its current mode first (it has
`generateStaticParams`, confirm whether it also has a `dynamic` export) and
add `force-dynamic` if it's currently static.

- [ ] **Step 5: Wire `includePrice` into `shop/[group]/page.tsx`**

Same pattern: compute `includePrice`, then pass
`top20.map(p => redactPriceIfUnauthorized(p, includePrice))` into
`buildItemList()` instead of the raw `top20`. Note this page's sort
(`(b.price ?? 0) - (a.price ?? 0)`) must happen BEFORE redaction (sort on the
real price, then redact the sorted result) — same sequencing concern as
Task 9.6's `RecsCarousel` fix below. Check this page's current rendering mode
too and add `force-dynamic` if needed.

- [ ] **Step 6: Run tests, then manual verification**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/seo/__tests__/jsonld.test.ts`

Then manually visit an `/explore-map/[region]` page and a `/shop/[group]` page
logged out; view-source and confirm no price appears in either visible copy or
JSON-LD `<script>` tags.

- [ ] **Step 7: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/seo/jsonld.ts apps/catalog/lib/seo/__tests__/ \
  apps/catalog/app/explore-map/\[region\]/page.tsx apps/catalog/app/shop/\[group\]/page.tsx
git commit -m "fix(catalog): gate price in explore-map and shop/[group] JSON-LD + visible copy"
```

---

## Task 8: Extend `middleware.ts` for session refresh

**Files:**
- Create: `apps/catalog/lib/supabase/middleware.ts`
- Modify: `apps/catalog/middleware.ts`

**Before starting:** confirm `@supabase/ssr`'s `createServerClient` works under
Next's Edge middleware runtime. Read `@supabase/ssr`'s README/docs (via
`node_modules/@supabase/ssr/README.md` after Task 2's install, or the package's
published docs) for its documented middleware pattern — do not improvise this
from the generic server-client pattern, middleware has a different cookie API
(`request.cookies`/`response.cookies`, no `next/headers`).

- [ ] **Step 1: Write the session-refresh helper following `@supabase/ssr`'s documented middleware pattern**

```typescript
// apps/catalog/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie if needed. Must be called from
 * middleware.ts (not a Server Component) — uses the NextRequest/NextResponse
 * cookie API, not next/headers.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers a token refresh if the session is near expiry.
  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 2: Wire it into `middleware.ts`, preserving the existing bot-redirect**

```typescript
// apps/catalog/middleware.ts — full updated file
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

const GROUP_SLUGS: Record<string, string> = {
  'wine': 'Wine',
  'whisky': 'Whisky',
  'spirits': 'Spirits',
  'sake--asian': 'Sake & Asian',
  'liqueur': 'Liqueur',
  'beer--rtd': 'Beer & RTD',
  'non-alcoholic': 'Non-Alcoholic',
  'cigars': 'Cigars',
  'events': 'Events',
  'accessories': 'Accessories',
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /shop/[group] → /shop?group=X for browser users
  // Bots see the static page with JSON-LD; browsers get the interactive shop.
  const match = pathname.match(/^\/shop\/([^/]+)$/);
  if (match) {
    const slug = match[1];
    const groupName = GROUP_SLUGS[slug];
    if (groupName) {
      const ua = request.headers.get('user-agent') ?? '';
      const isBot = /bot|crawler|spider|facebookexternalhit|Twitterbot|LinkedInBot/i.test(ua);
      if (!isBot) {
        const url = request.nextUrl.clone();
        url.pathname = '/shop';
        url.searchParams.set('group', groupName);
        return NextResponse.redirect(url, { status: 302 });
      }
    }
  }
  // Session refresh for all other matched routes (price-bearing pages).
  return updateSession(request);
}

export const config = {
  matcher: ['/shop/:group*', '/', '/product/:path*', '/shop'],
};
```

Note: the bot-redirect path returns early WITHOUT calling `updateSession` —
this is intentional and matches the spec (the existing bot logic is preserved
exactly, session refresh is additive on the other matched paths).

- [ ] **Step 3: Manual verification (no automated test — Edge runtime behavior)**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit `http://localhost:3100/` and `http://localhost:3100/shop/wine` in a
browser. Confirm:
- The `/shop/wine` → `/shop?group=Wine` redirect still works for a normal
  browser UA (existing behavior preserved).
- No middleware errors in the dev server console on `/` or `/product/[any-sku]`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/middleware.ts apps/catalog/lib/supabase/middleware.ts
git commit -m "feat(catalog): add Supabase session refresh to middleware, extend matcher"
```

---

## Task 9: Wire `includePrice` into the product detail page

**Files:**
- Modify: `apps/catalog/app/product/[sku]/page.tsx`

- [ ] **Step 1: Verify current rendering mode and recs-cache read path**

Read `apps/catalog/app/product/[sku]/page.tsx` in full first. Confirm
`getRecsForSku()` (defined near the top of the file) reads a `recs-cache.json`
file from disk via `loadRecsCache()`, and only falls back to
`precomputeRecommendations(getAllProducts())` if that file is missing or fails
to parse.

**Correction:** the file does NOT live at repo-root `data/recs-cache.json` —
`loadRecsCache()` actually probes multiple candidate paths (check its exact
logic in the file), and the real file on disk today is at
`apps/catalog/data/recs-cache.json` (confirmed present, ~3.4MB). Check the
correct path directly rather than assuming repo-root:

`ls -la "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog/data/recs-cache.json"`

Expected: file exists.

Existence alone doesn't prove the file is valid — `loadRecsCache()` catches
parse errors and silently falls through to the expensive live-precompute path
on ANY failure (missing file, malformed JSON, wrong shape), which is exactly
the failure mode being guarded against. Run a stronger check that actually
parses it and confirms it's non-empty:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/recs-cache.json', 'utf8'));
const keys = Object.keys(data);
console.log('parsed OK, ' + keys.length + ' sku entries, sample:', keys[0], data[keys[0]]);
if (keys.length === 0) { console.error('EMPTY CACHE — would trigger live precompute'); process.exit(1); }
"
```

Expected: prints a sku count > 0 and a sample entry, exits 0. If this fails or
prints an empty count, STOP and flag to the user before proceeding — switching
this page to dynamic rendering with a missing/empty/malformed cache would
trigger the expensive precompute path on every request, which is exactly the
failure mode the build-worker-precompute incident was about.

- [ ] **Step 2: Add `force-dynamic` and compute `includePrice`**

Near the top of the file (after imports), add:

```typescript
export const dynamic = 'force-dynamic';
```

Remove or reconcile the existing `export const dynamicParams = true;` and
`export const revalidate = 3600;` — `force-dynamic` supersedes ISR revalidation.
Also remove `generateStaticParams` (it has no effect once the route is fully
dynamic) — or leave it and confirm via `npm run build` output that it's a no-op
under `force-dynamic` rather than silently keeping stale prerendered params;
prefer removing it for clarity since a no-op function still gates the build's
understanding of this route.

In the `Page` function body (after `const product = getProductBySku(params.sku)`
around current line 293), add:

```typescript
import { headers } from 'next/headers';
import { getViewerAccess } from '@/lib/auth';
import { redactPriceIfUnauthorized } from '@/lib/price-access';

// ...inside Page():
const userAgent = headers().get('user-agent');
const { includePrice } = await getViewerAccess(userAgent);
const displayProduct = redactPriceIfUnauthorized(product, includePrice);
```

- [ ] **Step 3: Update `PriceBlock` and `buildProductSchema` call sites**

Current line ~396:
```tsx
// Before:
<PriceBlock price={product.price} specialPrice={product.special_price} />

// After:
{includePrice && (
  <PriceBlock price={displayProduct.price} specialPrice={displayProduct.special_price} />
)}
```

Current line ~500:
```tsx
// Before:
<JsonLd data={buildProductSchema(product)} />

// After:
<JsonLd data={buildProductSchema(displayProduct)} />
```

Leave `generateMetadata` (uses `getProductBySku` independently, no price
rendered there — verified in research, only `desc_en_short`/`full_description`/
`vintage`/`image_url` are used) and the `ViewItemTracker` analytics event
(`priceValue` at current line 335) **unchanged** — analytics events are not
rendered UI and are out of scope for the visible-price gate per the spec; note
this explicitly in a code comment so a future reviewer doesn't assume it was
missed:

```typescript
// priceValue feeds an analytics event (ViewItemTracker), not rendered UI —
// intentionally NOT gated by includePrice; out of scope per the login-system
// spec (docs/superpowers/specs/2026-07-23-catalog-login-system-design.md).
const priceValue = product.price ? Math.round(product.price) : undefined;
```

- [ ] **Step 4: `RecsCarousel` redaction — do NOT redact here**

**Leave the `recs` array (current lines ~320-333) unchanged — pass full,
unredacted `PublicProduct` objects into it, exactly as today.**
`RecsCarousel.tsx` sorts recommendation cards by real price internally
(`byPriceAscending`); redacting before that sort would break card ordering for
logged-out users. The actual `RecsCarousel` fix — widening its prop type and
redacting AFTER its internal sort, immediately before render — is handled
separately in **Task 9.6**, which also updates this page's `<RecsCarousel>`
call site to pass `includePrice`. Do this task's Step 1-3 first, then jump to
Task 9.6 before returning to Step 5 below.

- [ ] **Step 5: Manual test**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit a product page while logged out (no session cookie): confirm no price
renders anywhere (main price block, recs carousel cards), and `view-source:`
the page — confirm no price string appears in the raw HTML, including inside
the `application/ld+json` script tags.

- [ ] **Step 6: Run build to check for `force-dynamic` fallout**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run build 2>&1 | tail -60`

Expected: build succeeds, no timeout. Confirm the build log no longer shows a
prerendered-params slice for `/product/[sku]` (since the route is now fully
dynamic).

- [ ] **Step 7: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/product/\[sku\]/page.tsx
git commit -m "feat(catalog): gate price on product detail page behind includePrice"
```

---

## Task 9.5: Gate the retail print-catalog pages (CRITICAL — found in plan review)

**Files:**
- Modify: `apps/catalog/app/catalogs/retail/full/page.tsx`
- Modify: `apps/catalog/app/catalogs/retail/[group]/page.tsx`
- Modify: `apps/catalog/app/catalogs/retail/page.tsx`

Found during plan review: these pages render a **complete printable retail
price list** (every in-stock SKU's price, in a plain HTML table via
`CatalogDocument.tsx` / `lib/catalog-print.ts`) with **no auth check
whatsoever** today. They are `robots: { index: false, follow: false }`
(hidden from search engines) but that provides zero protection against a
logged-out human visitor who navigates there directly — this is a live,
complete price-list leak that directly contradicts the project's stated goal
("logged-out users cannot see product price... anywhere in the catalog").
This is not an edge case; it's the single largest price surface in the app,
larger than any individual product/shop page.

**Before writing code, resolve one open question with the user:** should
these pages require full login (same `includePrice` gate as everywhere else),
or are they intentionally an internal/staff tool that should be gated
differently (e.g. a separate internal auth mechanism, matching the pattern
already used by the B2B catalog worktree's `B2B_AUTH_SECRET` shared-key gate
mentioned in the design spec's research) — since a *complete* exportable price
list is a different risk profile (bulk scrape-and-resell) than a per-product
page view. Do not assume; ask.

- [ ] **Step 1: Confirm scope decision with the user**

Present the finding and the B2B-shared-key-gate precedent as an option
alongside the standard `includePrice` login gate. Get an explicit decision
before proceeding.

- [ ] **Step 2a: If gating via the standard login/`includePrice` mechanism**

Add near the top of each of the 3 page components:

```typescript
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getViewerAccess } from '@/lib/auth';

const userAgent = headers().get('user-agent');
const { includePrice } = await getViewerAccess(userAgent);
if (!includePrice) {
  // Build the redirect target from THIS request's actual path, not a
  // hardcoded string — /catalogs/retail/full has no params, but
  // /catalogs/retail/[group]/page.tsx must interpolate its own `params.group`
  // (e.g. `/catalogs/retail/${params.group}`) so the user returns to the
  // right group after logging in, not always to /full.
  redirect('/login?redirect=' + encodeURIComponent(currentPath));
}
```

Where `currentPath` is the page's own actual route: for `full/page.tsx` this
is the literal string `/catalogs/retail/full`; for `[group]/page.tsx` and
`page.tsx` it must be built from that page's own `params`/route (e.g.
`` `/catalogs/retail/${params.group}` `` for the group variant) — do not copy
the same literal string into all three files.

Unlike the product/shop pages (which omit price but still render), these
pages exist ONLY to show price — so the correct gate is a hard redirect to
`/login`, not a partial render with prices stripped from an otherwise-empty
table.

- [ ] **Step 2b: If gating via a separate internal-access mechanism**

Follow whatever pattern the user specifies (e.g. adapt the `.worktrees/b2b-catalog`
`lib/auth.ts` HMAC-signed-cookie pattern found during spec research). Write
this as its own sub-plan once the decision is made — do not improvise a new
auth mechanism inline here.

- [ ] **Step 3: Verify the route also gets covered by `middleware.ts`'s session
  refresh if using the standard login gate**

If 2a was chosen, add `/catalogs/:path*` to the `matcher` array in
`apps/catalog/middleware.ts` (Task 8) so session cookies refresh correctly on
this route too.

- [ ] **Step 4: Manual test**

Visit `/catalogs/retail/full` logged out — confirm redirect to `/login` (2a)
or the chosen internal-access gate (2b) fires, with NO price table rendered
at any point, even momentarily.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/catalogs/retail/
git commit -m "fix(catalog): gate retail print-catalog pages — was a complete unauthenticated price-list leak"
```

---

## Task 9.6: Fix `RecsCarousel.tsx`'s own `PublicProduct` typing + redaction sequencing

**Files:**
- Modify: `apps/catalog/components/RecsCarousel.tsx`
- Modify: `apps/catalog/app/product/[sku]/page.tsx` (sequencing fix)

Found during plan review: `RecsCarousel.tsx` has its own `RecItem` interface
typed `product: PublicProduct` (not `PublicProductDisplay`), and its own
`displayPrice()`/`byPriceAscending()` helpers that sort recommendation cards
by price. Two problems:

1. Task 9 Step 4 tells the implementer to redact products before building the
   `recs` array passed into `RecsCarousel`, but `RecsCarousel`'s prop type
   still expects full `PublicProduct` — a redacted `PublicProductDisplay`
   object is not assignable to it, so this will not compile as originally
   written.
2. `byPriceAscending()` sorts using each item's real price. If redaction
   happens BEFORE the array reaches `RecsCarousel`, every item loses its price
   and the sort degrades to an arbitrary/insertion-order tiebreak — the
   "step-up"/"similar" card ordering breaks for logged-out users even though
   they were never supposed to see the sort order change, only the price
   labels.

**Fix: sort first (on real, unredacted price), redact second, right before
render — not before sorting.**

- [ ] **Step 1: Widen `RecsCarousel`'s prop type**

In `apps/catalog/components/RecsCarousel.tsx`, change:

```typescript
import type { PublicProduct } from '@/lib/types';
// ...
interface RecItem {
  product: PublicProduct;
  // ...
}
```

to:

```typescript
import type { PublicProductDisplay } from '@/lib/price-access';
// ...
interface RecItem {
  product: PublicProductDisplay;
  // ...
}
```

Update `displayPrice(p: PublicProduct)` and `byPriceAscending`'s internal
usage to accept `PublicProductDisplay` too (`resolveSale` already tolerates
`undefined` inputs per Task 7's verification, so no logic change needed there
— type signature only).

- [ ] **Step 2: Fix the sequencing in `app/product/[sku]/page.tsx`**

Re-examine Task 9's `recs` array construction (the `.map(...)` building
`{ product: p, band, contactLinks, ... }`). The array is built directly from
`getRecsForSku()` output, which is ALREADY in a fixed band order (similar/
step-up/great-alternative), not yet price-sorted — `RecsCarousel` does its own
`byPriceAscending` sort internally at render time using real prices. So the
correct fix is simpler than re-ordering pipeline stages: pass the FULL
(unredacted) `PublicProduct` into the `recs` array as today, and apply
`redactPriceIfUnauthorized` only inside `RecsCarousel` itself, immediately
before each card is rendered — AFTER `byPriceAscending` has already sorted
using the real prices.

In `apps/catalog/components/RecsCarousel.tsx`, update the render loop:

```tsx
// Before (current):
{ordered.map(({ product, band, contactLinks, structural }) => {
  // ...
  <ProductCard product={product} .../>

// After:
{ordered.map(({ product, band, contactLinks, structural }) => {
  const displayProduct = redactPriceIfUnauthorized(product, includePrice);
  // ...
  <ProductCard product={displayProduct} .../>
```

This requires threading `includePrice: boolean` into `RecsCarouselProps` as a
new required prop, set by the page from the same `getViewerAccess()` call
already added in Task 9. Since `byPriceAscending` sorts `ordered` from the
full-price `items` BEFORE this per-item redaction line runs, sort order is
preserved for all viewers while only the rendered price differs.

Revert Task 9 Step 4's original instruction (which redacted before building
the `recs` array) — that approach is superseded by this task.

- [ ] **Step 3: Update `RecsCarouselProps` and its caller**

```typescript
interface RecsCarouselProps {
  items: RecItem[];
  includePrice: boolean;
}
```

Update `apps/catalog/app/product/[sku]/page.tsx`'s `<RecsCarousel items={recs} />` call site to `<RecsCarousel items={recs} includePrice={includePrice} />`.

- [ ] **Step 4: Run full type check**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx tsc --noEmit 2>&1 | head -60`

Expected: no new errors. If `compactAttrRows` or other `ProductCard`-internal
helpers complain about the widened `PublicProductDisplay` type, widen their
signatures too (their actual field usage — country/region/variety/vintage —
is already optional on `PublicProduct`, so this is expected to be a type
compatibility non-issue, but verify rather than assume).

- [ ] **Step 5: Manual test**

Visit a product page logged out with recommendations present. Confirm: no
price/placeholder shown on any recommendation card, AND the card ORDER looks
sensible (not randomly shuffled) — compare visually against the same page
logged in, where the order should be identical, just with prices shown.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/components/RecsCarousel.tsx apps/catalog/app/product/\[sku\]/page.tsx
git commit -m "fix(catalog): RecsCarousel accepts PublicProductDisplay, redacts after price-sort not before"
```

---

## Task 10: Wire `includePrice` into the shop page

**Files:**
- Modify: `apps/catalog/app/shop/page.tsx`

- [ ] **Step 1: Confirm current rendering mode**

Already `force-dynamic` (verified in research, line 9) — no rendering-mode
change needed, only the redaction wiring.

- [ ] **Step 2: Compute `includePrice` and redact before rendering `ProductCard`**

Near the top of the page component (where `const products = getAllProducts()`
appears at current line 146, inside the component that renders the page body —
not the two module-level calls at lines 66/69/94 which build filter option
lists and never touch `ProductCard`, so leave those untouched):

```typescript
import { headers } from 'next/headers';
import { getViewerAccess } from '@/lib/auth';
import { redactPriceIfUnauthorized } from '@/lib/price-access';

// ...
const userAgent = headers().get('user-agent');
const { includePrice } = await getViewerAccess(userAgent);
```

Then at the `<ProductCard` call site (current line ~259), redact the product
being passed:

```tsx
// Before:
<ProductCard product={p} ... />

// After:
<ProductCard product={redactPriceIfUnauthorized(p, includePrice)} ... />
```

(Adjust variable name to match whatever the loop variable actually is at that
exact line — re-read the surrounding ~20 lines before editing to get the exact
prop-spread syntax right, since `ProductCard` likely receives several other
props alongside `product` at that call site.)

- [ ] **Step 3: Manual test**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit `/shop` logged out: confirm no product card shows a price or a `'—'`
placeholder. `view-source:` the page and confirm no price values leak.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/shop/page.tsx
git commit -m "feat(catalog): gate price on shop page behind includePrice"
```

---

## Task 11: Wire `includePrice` into the homepage (if needed)

**Files:**
- Modify: `apps/catalog/app/page.tsx` (only if it renders `ProductCard`)

- [ ] **Step 1: Confirm whether the homepage renders `ProductCard`**

Research found `app/page.tsx` does not call `getAllProducts()` directly, but
uses `resolveFeatured`/`resolveIcons` from `lib/featured.ts` (which internally
calls `getAllProducts`/`getProductBySku`). Check:

Run: `grep -n "ProductCard" "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog/app/page.tsx"`

- [ ] **Step 2a: If `ProductCard` IS rendered on the homepage**

Add `export const dynamic = 'force-dynamic';`, compute `includePrice` via
`getViewerAccess()` the same way as Task 10, and redact each product passed to
`ProductCard`. Follow the exact pattern from Task 10, Step 2.

- [ ] **Step 2b: If `ProductCard` is NOT rendered on the homepage**

No change needed to this file. Note in the commit message that this was
verified, not assumed.

- [ ] **Step 3: Manual test (only if 2a applied)**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit `/` logged out, confirm no price/placeholder leaks, same as Task 10 Step 3.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/page.tsx
git commit -m "feat(catalog): gate price on homepage behind includePrice (or: confirm no change needed)"
```

---

## Task 12: Login page

**Files:**
- Create: `apps/catalog/app/login/page.tsx`

- [ ] **Step 1: Write the login form (Client Component)**

```tsx
// apps/catalog/app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsConfirmation(false);
    setLoading(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError) {
      setError('Invalid email or password.');
      return;
    }
    if (data.user && !data.user.email_confirmed_at) {
      setNeedsConfirmation(true);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function handleResendConfirmation() {
    const supabase = createClient();
    await supabase.auth.resend({ type: 'signup', email });
  }

  async function handleGoogleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}` },
    });
  }

  return (
    <main className="container mx-auto flex max-w-md flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Log in</h1>

      <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {needsConfirmation && (
          <p className="text-sm text-muted-foreground">
            Please confirm your email — check your inbox.{' '}
            <button type="button" onClick={handleResendConfirmation} className="underline">
              Resend confirmation email
            </button>
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <button
        type="button"
        onClick={handleGoogleLogin}
        className="rounded-md border border-border px-4 py-2"
      >
        Continue with Google
      </button>

      <p className="text-sm text-muted-foreground">
        No account? <a href="/register" className="underline">Register</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Manual test**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit `http://localhost:3100/login`. Confirm the form renders. Full auth-flow
testing happens in Task 15 once registration/callback exist too.

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/login/
git commit -m "feat(catalog): add /login page (email+password, Google OAuth)"
```

---

## Task 13: Register page

**Files:**
- Create: `apps/catalog/app/register/page.tsx`

- [ ] **Step 1: Write the registration form**

```tsx
// apps/catalog/app/register/page.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    setRegistered(true);
  }

  async function handleGoogleRegister() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  if (registered) {
    return (
      <main className="container mx-auto flex max-w-md flex-col gap-4 py-12">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-muted-foreground">
          We sent a confirmation link to {email}. Click it to activate your account.
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto flex max-w-md flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Register</h1>

      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {loading ? 'Registering…' : 'Register'}
        </button>
      </form>

      <button
        type="button"
        onClick={handleGoogleRegister}
        className="rounded-md border border-border px-4 py-2"
      >
        Continue with Google
      </button>

      <p className="text-sm text-muted-foreground">
        Already have an account? <a href="/login" className="underline">Log in</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Manual test (form renders only — full flow in Task 15)**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

Visit `http://localhost:3100/register`, confirm the form renders.

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/register/
git commit -m "feat(catalog): add /register page (email+password, Google OAuth)"
```

---

## Task 14: Auth callback route

**Files:**
- Create: `apps/catalog/app/auth/callback/route.ts`

- [ ] **Step 1: Write the callback handler**

```typescript
// apps/catalog/app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirect') || '/';

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // OAuth error, denied consent, or missing code — send back to login with a
  // generic error flag (avoid leaking Supabase's internal error detail).
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
```

- [ ] **Step 2: Update `/login` to surface the `error=auth_failed` query param**

In `apps/catalog/app/login/page.tsx`, add near the top of the component:

```typescript
const authError = searchParams.get('error');
```

And render it alongside the existing `error` state (e.g. right after the form
opening, before the email field): `{authError === 'auth_failed' && <p className="text-sm text-destructive">Login failed — please try again.</p>}`.

- [ ] **Step 3: Manual test**

Full flow tested end-to-end in Task 15 (requires Task 1's Supabase project to
be live). For now, confirm the route file compiles:

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx tsc --noEmit 2>&1 | head -30`

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/app/auth/callback/ apps/catalog/app/login/page.tsx
git commit -m "feat(catalog): add /auth/callback route for OAuth + email confirmation"
```

---

## Task 15: Resend SMTP configuration (dashboard, no code)

**Files:** none — Supabase dashboard configuration

- [ ] **Step 1: Sign up for Resend, verify a sending subdomain**

With the user: create a Resend account, add a sending domain (e.g.
`mail.wnlq9.shop`), add the DNS records Resend provides (SPF/DKIM/DMARC-related
TXT/CNAME records) to the domain's DNS host. This can take up to 72 hours to
propagate — flag this lead time to the user early.

- [ ] **Step 2: Configure Supabase custom SMTP**

In the Supabase dashboard: Authentication → Settings → SMTP Settings. Enter
Resend's SMTP credentials (host, port, username = `resend`, password = Resend
API key). Set sender email to something like `noreply@mail.wnlq9.shop`.

- [ ] **Step 3: Customize the confirmation email template (optional polish)**

Authentication → Email Templates → Confirm signup. Adjust copy/branding if
desired — not required to ship phase 1.

- [ ] **Step 4: Send a real test registration and confirm delivery**

Register a real test account via `/register` (running dev server against the
live Supabase project). Confirm the email arrives via Resend within a minute
or two, and the confirmation link redirects correctly to `/auth/callback` →
`/`.

- [ ] **Step 5: No commit** (dashboard-only configuration; nothing to add to git)

---

## Task 16: End-to-end integration test

**Files:**
- Test: `apps/catalog/lib/__tests__/price-gate.integration.test.ts`

This is the invariant test from the spec: "if not logged in / not confirmed,
no price value appears anywhere in the rendered response."

- [ ] **Step 1: Write the test**

Check what testing utilities the project already uses for route/page rendering
(look for existing integration tests under `apps/catalog/app/**/__tests__/` or
similar, e.g. `apps/catalog/app/api/internal/recommendations/__tests__/route.test.ts`
found in research) and follow the same pattern/mock style. Sketch:

```typescript
// apps/catalog/lib/__tests__/price-gate.integration.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getViewerAccess: vi.fn(),
}));

describe('price gate invariant', () => {
  it('a logged-out, unconfirmed, non-crawler request never includes a price value', async () => {
    const { getViewerAccess } = await import('@/lib/auth');
    (getViewerAccess as any).mockResolvedValue({
      session: null,
      isVerifiedCrawler: false,
      includePrice: false,
    });
    const { redactPriceIfUnauthorized } = await import('@/lib/price-access');
    const { getAllProducts } = await import('@/lib/catalog-data');

    const products = getAllProducts().slice(0, 20);
    const displayed = products.map((p) =>
      redactPriceIfUnauthorized(p, false),
    );

    for (const p of displayed) {
      expect(p.price).toBeUndefined();
      expect(p.special_price).toBeUndefined();
      expect(p.sp_discount_pct).toBeUndefined();
      expect(JSON.stringify(p)).not.toMatch(/—/); // no placeholder leaked into the object itself
    }
  });
});
```

(This is a lighter-weight invariant test at the data layer, not a full
rendered-HTML test — a true full-page rendered-HTML test requires whatever
this project's convention is for testing Next.js Server Components end-to-end,
which should be confirmed against existing test patterns rather than invented
here. If the project has no existing pattern for full-page rendering tests,
this data-layer test plus the manual browser walkthrough in Task 17 is the
pragmatic substitute — flag this gap to the user rather than inventing a new
heavyweight test harness for one feature.)

- [ ] **Step 2: Run the test**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/price-gate.integration.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the FULL test suite one more time**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm test -- --run 2>&1 | tail -60`

Expected: all tests pass, including everything from Task 0's baseline.

- [ ] **Step 4: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add apps/catalog/lib/__tests__/price-gate.integration.test.ts
git commit -m "test(catalog): add price-gate invariant test"
```

---

## Task 17: Manual browser verification (Rule 7 — required, not optional)

**Files:** none — manual QA pass

- [ ] **Step 1: Start the dev server**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run dev`

- [ ] **Step 2: Logged-out walkthrough**

- Visit `/`, `/shop`, `/shop/[group]` (e.g. `/shop/wine`), `/explore-map/[region]`,
  and 2-3 `/product/[sku]` pages (including at least one with recommendations
  showing) in an incognito window.
- Confirm: no price, no `'—'` placeholder, no layout gap, anywhere — including
  recommendation carousel cards, and no "Prices from ฿X" text on the
  explore-map region page.
- View page source on a product page, a shop/[group] page, and an
  explore-map/[region] page — confirm no price string in the raw HTML on any
  of them (including inside every `<script type="application/ld+json">` block —
  there are multiple JSON-LD blocks per page, check all of them, not just the
  first).
- Visit `/catalogs/retail/full` directly by URL — confirm it redirects to
  `/login` (or the chosen internal-access gate from Task 9.5) and does not
  render any price table, even momentarily before a redirect.

- [ ] **Step 3: Registration + email confirmation walkthrough**

- Register a new account via `/register` with a real email you control.
- Confirm you're NOT shown price yet (unconfirmed state).
- Retrieve the confirmation email (sent via Resend per Task 15) and click the
  link.
- Confirm you land back on the site logged in, and price NOW appears on the
  same pages checked in Step 2.

- [ ] **Step 4: Login walkthrough**

- Log out. Log back in with the same email/password. Confirm price appears
  immediately (already-confirmed account, no re-confirmation needed).
- Try an intentionally wrong password — confirm the generic "Invalid email or
  password" message, not a field-specific hint.

- [ ] **Step 5: Google OAuth walkthrough**

- Register/log in via "Continue with Google" with a Google test account.
- Confirm no email-confirmation step is required — price should appear
  immediately after the OAuth redirect completes.

- [ ] **Step 6: Crawler-UA spot check**

Run (from a terminal, simulating a crawler UA against the deployed or local
dev server):

```bash
curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  http://localhost:3100/product/<a-real-sku> | grep -o '"price":"[0-9]*"'
```

Expected: a price value IS present (crawler exception working as designed).
Then repeat with a normal browser UA string and confirm no price appears.

- [ ] **Step 7: Report results to the user**

Summarize pass/fail for each of the above steps before considering this plan
complete. Per project CLAUDE.md Rule 7, "TypeScript compiles" / "tests pass"
is necessary but not sufficient — this manual pass is what actually verifies
the feature works.

---

## Task 18: Final review and merge decision

**Files:** none

- [ ] **Step 1: Full build + test run**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npm run build && npm test -- --run`

Expected: both succeed.

- [ ] **Step 2: Use the finishing-a-development-branch skill**

Invoke `superpowers:finishing-a-development-branch` to decide how to integrate
this work (PR vs. direct merge), per the user's usual workflow for this repo.
