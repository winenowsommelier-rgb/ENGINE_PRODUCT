# WNLQ9.B2B Wholesale Catalog — Design

**Date:** 2026-06-29
**Status:** Approved (pending spec review + user sign-off)
**Author:** Claude (brainstormed with user)

## Goal

Build a B2B (wholesale) variant of the existing public catalog (`wnlq9.shop`).
Same product engine and browsing experience, but:

- Shows **wholesale (`b2b_price`) prices only** to authenticated B2B users.
- Lives behind a **password gate** (B2B users are experts who get a link + password).
- Denser layout (more items per row + a list/table view) for fast expert browsing.
- Branded **WNLQ9 + "B2B" badge**.
- Reached from a **"B2B" link in the public site footer**.

## Non-Goals (v1)

- Per-user accounts, signup/approval flows, password reset (single shared password only).
- Showing retail price or savings/discount on the B2B catalog (wholesale price only).
- Ordering / checkout / cart (catalog is browse-only, same as public).
- Any change to how `b2b_price` is computed in the DB (we consume it as-is).

## Key Facts (verified 2026-06-29)

- `data/db/products.db` `products` table has: `b2b_price`, `b2b_discount_pct`,
  `b2b_margin_pct`, `b2b_margin_thb` (the last two are INTERNAL margin fields).
- `b2b_price` is populated for **7,267 of 11,934** products (~61%). The rest are NULL.
- The public export script `scripts/refresh_live_export.py` uses `EXPORT_COLS`. **Verified
  2026-06-29:** the raw `live_products_export.json` **DOES contain** `margin_pct`,
  `b2b_margin_pct`, and `cost` (kept for the curation/scoring engine). It does **NOT**
  contain `b2b_price`. So the raw export is NOT itself safe — the protection is the app layer.
- The public catalog (`apps/catalog`) reads `data/live_products_export.json` and applies
  a hard `PUBLIC_FIELDS` allowlist in `lib/catalog-data.ts` via `toPublicProduct()` (with a
  `satisfies` drift guard). **This allowlist — not file separation — is what keeps
  margin/cost out of the public JS bundle.**
- **Verified 2026-06-29:** several `PUBLIC_FIELDS` keys are NOT in the raw export and are
  **derived at the app layer** inside `getAllProducts`/`toPublicProduct`: `category_group`,
  `category_type`, `popularity_tier`, `flavor_tags_canonical`. Any reused finder / explore /
  drill-down code depends on these, so the B2B data layer must replicate the derivation.
- **Verified 2026-06-29:** `apps/catalog/app/sitemap.ts` hardcodes `BASE = 'https://wnlq9.shop'`
  and enumerates every product/shop/category/explore URL. `apps/catalog/app/robots.ts` exists.
  Both must be overridden for the private B2B site.
- Catalog stack: Next.js 14 App Router, TS, Tailwind, Radix, Vitest. Dev port 3100.
- Public Vercel project: `wnlq9-catalog`. Logo is a typographic wordmark, no image asset.

## Architecture

### App layout
- New sibling app **`apps/catalog-b2b`** — its own Next.js app, own `package.json`,
  own `.vercel/project.json`.
- **Reuses shared logic** from `apps/catalog` (taxonomy, price formatting, filters,
  finder, explore-map, product detail) rather than duplicating it. During planning we
  will verify the exact cross-app import mechanism that builds cleanly under Next
  (relative import, path alias, or a small shared package); structure is otherwise settled.
- B2B-specific overrides only:
  - `lib/catalog-data.ts` — loads the B2B export + `B2B_PUBLIC_FIELDS` allowlist.
  - `components/ProductCardB2B.tsx` + grid — denser, `b2b_price` only, keep critic pill.
  - `components/ProductListB2B.tsx` — compact table/list row view.
  - `middleware.ts` — auth gate.
  - `app/login/page.tsx` + `app/api/login/route.ts` — password gate.
  - `app/layout.tsx` / header / hero / footer — `WNLQ9` + `B2B` badge branding.

### Deployment
- Separate Vercel project **`wnlq9-b2b`** → domain **`b2b.wnlq9.shop`**.
- Root Directory = `apps/catalog-b2b` in the Vercel dashboard.
- Env vars: `B2B_PASSWORD`, a server secret for cookie HMAC (`B2B_AUTH_SECRET`),
  optional `B2B_AUTH_VERSION` for mass cookie invalidation, plus the existing contact
  env vars the public catalog uses.

### Isolation guarantee (corrected — read carefully)
There are TWO directions to protect, by TWO different mechanisms:

1. **Wholesale price must not leak to the PUBLIC site.** Guaranteed by the public pipeline
   being **untouched**: `live_products_export.json` has no `b2b_price`, and the public
   `PUBLIC_FIELDS` allowlist is unchanged. The B2B app is a separate deploy/data file, so
   nothing flows back. (One footer link is the only public-side change.)

2. **Internal margin/cost must not leak to the B2B BUNDLE.** This is the subtle one. The raw
   export already carries `margin_pct`/`b2b_margin_pct`/`cost`, so **file separation is NOT
   the guard** — the **app-layer `B2B_PUBLIC_FIELDS` allowlist + `toPublicProduct` is.**
   Therefore the B2B export script must **NOT** be a copy of `EXPORT_COLS` (which includes
   margin). It starts from a **minimal explicit display column list** and adds only `b2b_price`
   (+ `b2b_discount_pct` if the detail page needs it). The Rule-6 invariant test asserts the
   **generated `b2b_products_export.json`** contains no `margin_pct`/`b2b_margin_pct`/`cost`/
   retail `price`.

## Data Pipeline

New script **`scripts/refresh_b2b_export.py`**:

- Reads `data/db/products.db`.
- `B2B_EXPORT_COLS` = a **minimal, explicit display-column list** (NOT a copy of the public
  `EXPORT_COLS`, which carries margin/cost) **plus `b2b_price`, `b2b_discount_pct`**, and
  **minus retail `price`** (wholesale-only bundle — confirmed decision).
- **Filters: only rows WHERE `b2b_price IS NOT NULL`** (~7,267). "Hide missing" enforced
  at the data layer so such products never reach the app.
- **Never exports** `cost`, `margin_pct`, `b2b_margin_pct`, `b2b_margin_thb`, retail `price`.
- Writes **`data/b2b_products_export.json`**.

B2B app `lib/catalog-data.ts`:
- `B2B_PUBLIC_FIELDS` allowlist = public display fields + `b2b_price` (+ `b2b_discount_pct`
  if the detail page wants it), **minus** retail `price`/`special_price`/`sp_discount_pct`.
  Keeps the `satisfies` drift guard.
- **Replicates the public app-layer derivation** for `category_group`, `category_type`,
  `popularity_tier`, `flavor_tags_canonical` (these are NOT raw export columns — they are
  computed in `getAllProducts`/`toPublicProduct`). Reused finder/explore/drill-down depend
  on them. Prefer **sharing** that derivation code (see Cross-app spike) over re-implementing.

### Rule-9 enforcement (dual regeneration)
Any bulk DB write must regenerate **both** exports. To prevent the documented Rule-9
staleness failure, provide a **single wrapper** `scripts/refresh_all_exports.py` (or have
`refresh_live_export.py` call the B2B one) so "refresh the export" regenerates both. The
invariant test includes a **staleness check**: B2B export mtime ≥ DB mtime.

## Auth

- `middleware.ts` protects all routes except `/login`, `/api/login`, and static assets.
  Checks a signed cookie `b2b_auth`; if missing/invalid → 302 to `/login`.
- `/login` — password form. POST → `app/api/login/route.ts`:
  - Constant-time compare against `B2B_PASSWORD` env.
  - On success: set **HttpOnly, Secure, SameSite=Lax** cookie holding an **HMAC-signed
    token** (signed with `B2B_AUTH_SECRET`, includes `B2B_AUTH_VERSION`), ~30-day expiry.
    Never store the raw password in the cookie.
  - On failure: generic error; light rate-limit; never log the password or put it in a URL.
- Rotation: change `B2B_PASSWORD` (and/or bump `B2B_AUTH_VERSION` to invalidate all
  existing cookies), redeploy.

The cookie is the access gate. Data is already B2B-filtered at build time; a leaked bundle
exposes only wholesale prices to someone who passed the password — acceptable for v1.

### Auth gaps to respect (named explicitly)
- **Middleware matcher precision IS the entire security boundary.** Exempt only `/login`,
  `/api/login`, and the framework asset paths — and cover the non-obvious ones: `_next/static`,
  `_next/data` (RSC/route JSON), `_next/image`, `favicon`/icons. An over-broad static exemption
  or a missed `_next/data` path serves gated data unauthenticated. HIGH-SCRUTINY: a matcher typo
  here = full leak. A required auth test fetches a `_next/data`/RSC route unauthenticated and
  asserts redirect.
- **Rate-limiting is best-effort only.** On Vercel serverless there is no shared in-memory
  state across lambda instances, so an in-process limiter is not real brute-force protection.
  For a single shared secret this is acceptable for v1; the spec does NOT claim real
  brute-force defense.

## UI / Branding / Layout

### Branding
- Wordmark = `WNLQ9` + a small accent-colored `B2B` pill badge (header, hero, footer).
- `<title>` / OG metadata: "WNLQ9 B2B — Wholesale Catalogue". Footer copyright `© 2026 WNLQ9`.

### Product display
- **Grid density:** 3 / 4 / 6 columns (mobile / tablet / desktop) vs public 2/3/4.
- **`ProductCardB2B`:** smaller image, tighter text, single bold `฿{b2b_price}` line,
  **keep the critic score pill**, reuse stock badges (Express / Archive).
- **Grid | List toggle:** plus a compact list/table view — row = thumb + name + brand +
  region + critic score + `฿{b2b_price}` — for maximum SKUs on screen.
- Reused as-is: shop filters, category drill-down, search, finder, explore-map. Product
  detail page (`/product/[sku]`) reused but shows `b2b_price`.

### Price-field mapping (avoid blank/฿NaN)
Retail `price`/`special_price`/`sp_discount_pct` are absent from the B2B bundle. **Every**
component that currently reads those — `ProductCard` (→ `ProductCardB2B`), the product
**detail page**, and any shared `formatPrice`/sale-badge helper — must read `b2b_price`
instead. The product detail page IS a required override (not "reused as-is" for price).
No reused component may silently fall back to `special_price`/`sp_discount_pct`.

### SEO / crawlability (private site)
The B2B site is **private, not an SEO property.** Required overrides:
- `app/robots.ts` → `disallow: '/'` (block all crawlers).
- `app/sitemap.ts` → **omit** (do not reuse — the public one hardcodes `wnlq9.shop` and
  enumerates every SKU, which would publish a crawlable list of gated wholesale pages).
- Layout metadata → `noindex, nofollow`.

### Public site change
- One link added to the public `apps/catalog` Footer Info column:
  **"B2B" → `https://b2b.wnlq9.shop`**. This is the only change to the existing public app.

## Testing & Verification (per project CLAUDE.md rules)

- **Data invariant (Rule 6):** `b2b_products_export.json` row count ==
  DB `COUNT(*) WHERE b2b_price IS NOT NULL`; every row has a numeric `b2b_price`;
  **no** row contains `cost` / `margin_pct` / `b2b_margin_pct` / `b2b_margin_thb` /
  retail `price`.
- **Allowlist drift guard:** `B2B_PUBLIC_FIELDS satisfies` check compiles.
- **Auth tests:** unauthenticated → redirect to `/login`; correct password sets cookie +
  unlocks; wrong password rejected; tampered cookie (bad HMAC) rejected; **unauthenticated
  fetch of a `_next/data`/RSC route asserts redirect** (matcher-precision guard).
- **Public-leak regression guard:** assert public `live_products_export.json` still has
  **no** `b2b_price`, AND the generated `b2b_products_export.json` has **no** `cost`/
  `margin_pct`/`b2b_margin_pct`/`b2b_margin_thb`/retail `price` (pipelines never
  cross-contaminate, in both directions).
- **Staleness guard:** B2B export mtime ≥ DB mtime (Rule-9 enforcement).
- **Browser verification (Rule 7):** run B2B dev server, log in, confirm grid + list toggle
  render, prices show `฿{b2b_price}`, branding/badge correct, click through to a product
  detail page.

## Gating Planning Spike (must complete FIRST)

**Cross-app shared-import mechanism.** This is the top feasibility risk and blocks all other
B2B work. With Vercel Root Directory = `apps/catalog-b2b`, importing `../catalog/lib/...` is
not trivial (files outside project root; `transpilePackages` / `outputFileTracingRoot` /
documented monorepo build gotchas). Critically, reused finder/explore/detail code internally
imports `@/lib/catalog-data` — a path alias that resolves to the **public** `catalog-data.ts`,
not the B2B override. Re-pointing that alias per-app is the crux of whether "reuse" works.

The spike evaluates and picks one, with a recommendation up front (Rule 11):
- **Recommended: a small shared internal package** `packages/catalog-core` holding the engine
  (taxonomy, filters, finder, explore, price-format, derivation helpers) with the data loader
  injected/parameterized, so each app supplies its own export + allowlist. More robust skeleton;
  adds monorepo config (workspaces/transpilePackages).
- Alternative: path-alias override per app (`@/lib/catalog-data` → B2B file). Less config but
  fragile across the reused `@/`-aliased modules.

No other B2B task starts until the spike resolves this.

## Resolved Edge Cases

- **Direct URL to a non-B2B SKU:** `/product/[sku]` for a SKU without `b2b_price` **404s** via
  `not-found` because `generateStaticParams` is driven by the **B2B export** (~7,267). No
  retail fallback path exists. (Confirm `generateStaticParams` reads the B2B export.)
- **Search index / finder / explore:** built from the B2B export only, so they structurally
  cannot reference a non-B2B SKU. State this explicitly; no extra filtering needed.
- **`/product/[sku]` detail pricing:** shows `b2b_price` only by default (decide in planning
  whether to also show `b2b_discount_pct`).

## Deploy-Time Tasks

- Add `b2b.wnlq9.shop` DNS (CNAME) to the `wnlq9-b2b` Vercel project; set Root Directory =
  `apps/catalog-b2b`; set env vars `B2B_PASSWORD`, `B2B_AUTH_SECRET`, `B2B_AUTH_VERSION`,
  and contact env vars.
