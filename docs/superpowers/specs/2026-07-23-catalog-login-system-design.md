# Catalog Login System — Phase 1 Design

**Status:** Approved by user, pending spec review
**Date:** 2026-07-23
**Scope:** Phase 1 only (registration/login + price-gating). Phase 2 (BI tier sync) is
documented briefly at the end for forward-compatibility, not built here.

## Goal

Users register/log in via email+password or Google OAuth on the WNLQ9 catalog
(`apps/catalog`). Email address must be confirmed before the account is treated
as "logged in." Logged-out (or unconfirmed) users cannot see product price or
promotion/special-price data anywhere in the catalog. Logged-in confirmed users
see prices exactly as today.

## Why this shape

- No auth exists in `apps/catalog` specifically today — no NextAuth/Clerk/
  session code, no `/login` route, no user table, in that workspace. This
  is net-new for the catalog app, but **not** net-new for Supabase in this
  monorepo (see below) — the login/register/callback routes and the
  `includePrice` gating logic are new; the Supabase client relationship
  is not.
- Per project Rule 11 (build on skeletons, not from scratch), this uses
  **Supabase Auth** rather than hand-rolled sessions. The **root**
  `package.json` already depends on `@supabase/supabase-js` (`^2.108.1`)
  and it is already used in production at `app/api/sync-analytics/route.ts`
  (a working `createClient()` pattern against `sync_log`/`gsc_pages`/
  `content_signals` tables, service-role key). Root `.env.example`/
  `.env.local` already define `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `SUPABASE_DB_URL`. **Open decision, must be resolved before implementation:**
  is catalog Auth added to this *same* Supabase project (reusing
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
  copying the `createClient()` pattern from `sync-analytics/route.ts` rather
  than inventing a new one), or a *separate* project? Reusing the same
  project is the default recommendation — it avoids a second Supabase
  account/billing surface — but enabling Auth on a project already used
  for service-role BI writes should be a stated, deliberate choice, and the
  new `lib/supabase/client.ts` should explicitly reuse the existing
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` env var name rather than
  introducing a differently-named `ANON_KEY` variable (the more common
  name in most `@supabase/ssr` docs/examples, which an implementer copying
  a tutorial verbatim might default to).
- **Price is not currently gated at all.** `PUBLIC_FIELDS` in
  `apps/catalog/lib/catalog-data.ts` includes `price`, `special_price`, and
  `sp_discount_pct` for every request. `toPublicProduct()` (the single
  projection chokepoint, line ~63) copies these onto every product object,
  which is then passed as a prop into `ProductCard.tsx` (a Client Component).
  Because Next.js serializes Client Component props into the RSC payload,
  anything present on that object is inspectable via browser devtools —
  hiding it only in JSX would not actually gate it. **The real gate has to
  happen in the data-projection layer, before the object is ever constructed
  for a logged-out request**, not in the display components.

## Architecture

### Auth backend

- Supabase Auth (email/password + Google OAuth provider enabled in the
  Supabase dashboard).
- Session stored in an HTTP-only cookie, managed via `@supabase/ssr`,
  readable from Next.js Server Components and middleware via `next/headers`.
- `auth.users` (Supabase built-in) is sufficient for phase 1. A thin
  `public.profiles` table (`user_id`, `email`, `created_at`) is created now
  so phase 2 (`tier` column) has somewhere to land without a schema migration
  under time pressure later.

### Rendering mode change

Pages that display price need per-request access to the session cookie.
Verified current state per page (this was previously described inaccurately
as uniform "static generation" — corrected here):

- **`app/shop/page.tsx`** — already `export const dynamic = 'force-dynamic'`
  (existing, for filter-freshness reasons unrelated to auth). **No rendering
  change needed here** — it already re-runs per request, so adding a
  `getSession()` call and threading `includePrice` through is additive only.
- **`app/page.tsx`** (homepage) — currently plain static generation. Needs
  to become dynamic (`force-dynamic`) so it can check the session per
  request. This is a real trade-off: loses CDN edge caching for the
  homepage, slightly higher TTFB. User-approved.
- **`app/product/[sku]/page.tsx`** — currently **ISR**, not plain SSG:
  `dynamicParams = true` with `revalidate = 3600` (hourly). This page also
  depends on `getRecsForSku()`, which reads a **prebuild-generated**
  `data/recs-cache.json` file — a pattern that exists specifically because
  per-page recommender precompute previously blew past Next's 60s
  static-generation timeout under multi-worker contention (see project
  memory: build-worker-precompute gotcha). Switching this page to
  `force-dynamic` removes the hourly ISR cache and the `generateStaticParams`
  prerender slice, meaning every request now runs live — including the
  `getRecsForSku()` call. **This is expected to remain safe** because
  `getRecsForSku()` reads the already-built `recs-cache.json` from disk at
  request time (cheap file read, not a recompute), and the only new
  per-request cost this design adds is a session-cookie check (`getSession()`),
  which is trivial by comparison. This assumption must be explicitly verified
  during implementation (confirm `recs-cache.json` is read, not regenerated,
  under `force-dynamic`) before shipping, given this exact page previously
  caused a build-breaking incident from underestimated per-request/per-worker
  cost.

### New files

| Path | Purpose |
|---|---|
| `apps/catalog/lib/supabase/server.ts` | Server-side Supabase client factory (cookie read/write via `@supabase/ssr`) |
| `apps/catalog/lib/supabase/client.ts` | Browser Supabase client, used by login/register forms |
| `apps/catalog/lib/auth.ts` | `getSession()` — returns `{ user, isConfirmed } \| null` from the request cookie |
| `apps/catalog/app/login/page.tsx` | Email+password login form, "Continue with Google" button, honors `?redirect=` |
| `apps/catalog/app/register/page.tsx` | Email+password sign-up form, "Continue with Google" button |
| `apps/catalog/app/auth/callback/route.ts` | Handles Supabase redirect after Google OAuth or email-confirmation click; exchanges code for session; redirects to `?redirect=` target or `/` |

### Modified files

| Path | Change |
|---|---|
| `apps/catalog/lib/catalog-data.ts` | `toPublicProduct()` gains an `includePrice: boolean` param. `price`, `special_price`, `sp_discount_pct` are only copied onto the returned object when `true`. `getAllProducts()` / `getProductBySku()` accept and thread through an `includePrice` option. |
| `apps/catalog/middleware.ts` | `matcher` extended to also run on `/`, `/product/:path*`, `/shop/:path*` for session-cookie refresh, using `@supabase/ssr`'s documented `updateSession()` middleware pattern. **Existing bot-vs-browser UA rewrite logic for `/shop/:group*` is preserved as-is** (verified: current matcher is `['/shop/:group*']` only, doesn't touch `/`, bare `/shop`, or `/product/*` today) — this is additive, not a replacement. **Must verify before implementation**: `middleware.ts` currently avoids importing from `lib/` specifically to stay Edge-runtime-compatible (see its own header comment); confirm `@supabase/ssr`'s middleware/server client works under Next's Edge middleware runtime before wiring it in, since Supabase's server auth helpers have historically had Node-only code paths. |
| `apps/catalog/components/ProductCard.tsx` | **Requires a real code change — verified, not assumed.** `resolveSale()` correctly returns `null` when `price`/`specialPrice` are `undefined`, so the *sale* branch (lines ~207-221) is already safe. But the *non-sale* branch (lines ~222-226) unconditionally renders `formatPrice(product.price)`, and `formatPrice(undefined)` returns the string `'—'` — **not nothing**. With `includePrice: false`, every logged-out product card that isn't on sale would render a visible `'—'` placeholder, directly violating the "no placeholder" UX requirement below. Fix: wrap the non-sale price paragraph in `{product.price !== undefined && (...)}`. |
| `apps/catalog/components/product/PriceBlock.tsx` | Same bug, second instance: line ~27's non-sale branch also unconditionally calls `formatPrice(price)`. Needs the identical conditional-rendering fix as `ProductCard.tsx` above. |

## Data flow (per request to a price-bearing page)

1. Request hits `/`, `/shop`, or `/product/[sku]` — now dynamically rendered.
2. Server Component calls `getSession()` → determine `isLoggedIn` (session
   present) and `isConfirmed` (`email_confirmed_at` non-null).
3. Also check if the request is from a verified crawler (UA match against
   Googlebot/Bingbot patterns, consistent with the existing bot-detection
   regex already in `middleware.ts`).
4. `includePrice = (isLoggedIn && isConfirmed) || isVerifiedCrawler`.
5. `getAllProducts({ includePrice })` / `getProductBySku(sku, { includePrice })`
   build product objects with or without price fields.
6. Product objects are passed to `ProductCard` / detail-page JSX as today.
   Structured data (`schema.org Product/Offer` JSON-LD) uses the same
   `includePrice` decision — crawlers get price in both visible HTML and
   structured data; anonymous human visitors get neither.

## Crawler exception (SEO/AEO)

Verified search/AI crawlers (Googlebot, Bingbot, etc., via User-Agent
matching — consistent with `middleware.ts`'s existing approach) see price
even though anonymous human visitors don't. This preserves rich snippets and
AI-answer-engine visibility for price, which matters for a price-sensitive
shopping vertical. **This is explicitly an SEO convenience, not a security
boundary** — a scraper spoofing a crawler UA also gets price, the same
trade-off the existing bot-detection in `middleware.ts` already accepts.
True scrape-resistance for logged-out users comes from the fact that price
is server-side absent from the payload, not from UA-based access control.

## Gate UX

Logged-out or unconfirmed users see the price area fully omitted — no
placeholder, no "log in to see price" CTA copy, no layout reservation. This
was a deliberate choice: simplicity over conversion-nudge copy for phase 1.

## Email confirmation

- Registration creates an unconfirmed Supabase Auth user and triggers
  Supabase's built-in confirmation email (magic link) automatically —
  no custom email-sending code required.
- Clicking the link redirects to `/auth/callback`, which exchanges the
  code for a session and sets `email_confirmed_at`.
- **Until confirmed, the account is treated as logged-out** for the price
  gate (`getSession().isConfirmed === false` ⇒ `includePrice = false`).
  No grace period.
- Google OAuth users are confirmed automatically on first login (Google
  already verified the email) — no confirmation step for that path. (This
  is Supabase's documented default behavior for OAuth identity providers;
  confirm against current Supabase Auth docs at implementation time in case
  this has changed.)
- Unconfirmed login attempts show: "Please confirm your email — check your
  inbox" with a "Resend confirmation email" action (Supabase's built-in
  resend API).

### SMTP / email delivery

Supabase's default shared SMTP is rate-limited to a handful of emails/hour
and explicitly not meant for production traffic. Production confirmation
emails are sent via **Resend** (free tier: 3,000 emails/month, 100/day),
configured as Supabase's custom SMTP under Auth → SMTP Settings. Requires
verifying a sending subdomain (e.g. `mail.wnlq9.shop`) via DNS records —
one-time setup, no code. Email template (subject/body/branding) is
customized in the Supabase dashboard, not in application code.
**Dependency to track:** until the Resend domain is DNS-verified, Supabase
falls back to its shared SMTP, which is rate-limited to a handful of
emails/hour — fine for development, but registration must not be opened to
real users until DNS verification is confirmed complete.

Deployment note: `apps/catalog` deploys as its own Vercel project
(`wnlq9-catalog`, distinct Root Directory from the repo root's other env
consumers — see project memory on catalog Vercel deploy). Whichever
Supabase project/keys are chosen above must be added to **that** Vercel
project's env config specifically; it is not inherited from the root app's
environment automatically.

## Error handling

- **Wrong password / unknown email:** generic "Invalid email or password" —
  do not reveal which field was wrong (avoids account enumeration).
- **Expired confirmation link:** "This link has expired — request a new
  one," with a resend action.
- **Google OAuth cancelled/denied:** redirect to `/login` with a dismissible
  error banner.
- **Session expired mid-browse:** middleware attempts silent token refresh;
  if it fails, the next server-rendered request simply treats the user as
  logged-out (price re-hides). No hard error surfaced.
- **Crawler UA spoofing:** explicitly out of scope for phase 1 (see
  Crawler exception above).
- **Direct API/devtools inspection (RSC payload):** since `toPublicProduct()`
  never puts `price` on the object when `includePrice` is false, there is no
  serialized RSC payload chunk containing a price value — a real, structural
  guarantee, not an illusion.
- **JSON-LD / structured data leak (separate surface, must not be conflated
  with the RSC-payload guarantee above):** `schema.org` Product/Offer
  structured data is server-rendered directly into raw HTML `<script
  type="application/ld+json">` tags, not delivered via the RSC payload. If
  the JSON-LD builder's `includePrice` branch has any bug (e.g. forgets to
  omit `offers.price`, or a derived field elsewhere in that payload leaks a
  price-derived value), that leaks into visible page source — a real gap the
  RSC-payload argument doesn't cover. This must be independently tested (see
  Testing, below), not assumed safe by analogy to the RSC case.

## Testing

- Unit test: `toPublicProduct({ includePrice: false })` — assert `price`,
  `special_price`, `sp_discount_pct` are `undefined` on the result. This is
  the actual security-boundary regression guard.
- Unit test: `toPublicProduct({ includePrice: true })` — assert price fields
  are present and unchanged from current behavior.
- Integration test: unauthenticated request to `/product/[sku]` — assert the
  **full rendered HTML response body** (not just the RSC payload) contains no
  price value anywhere, including inside JSON-LD `<script>` tags, meta tags,
  or any other server-rendered microdata. Also explicitly assert no literal
  `'—'` (em-dash placeholder) artifact is left behind in the price DOM
  location, per the `formatPrice(undefined)` bug identified above.
- Integration test: mocked confirmed session — assert price renders as it
  does today (no regression for logged-in users).
- Manual browser walkthrough (project Rule 7, required for any UI change):
  register with email → receive and click Resend-delivered confirmation
  link → log in → confirm price now visible; log out → confirm price
  hidden again; complete the Google OAuth path end-to-end.

## Phase 2 direction (not built in this phase)

- `public.profiles` gains a `tier` column, synced from the BI API
  (`wnlq9-bi-api.vercel.app`) via a scheduled job, keyed by `user_id` or
  matched email.
- Order history surfaced from BI, likely a new `/account/orders` page
  reading server-side from the BI API.
- No phase-1 schema decision should block this — `profiles.user_id`
  (Supabase UUID) is deliberately created now as the future join key.

## Out of scope for phase 1

- Facebook/LINE social login (Google only, per user decision — can be added
  later, Supabase supports both with additional OAuth app registration).
- Any BI/tier/order-history integration.
- Grace-period access for unconfirmed accounts.
- "Log in to see price" CTA copy/placeholder UI.
- True bot-proof price protection (UA-based crawler detection is an SEO
  convenience only, not a security control).
