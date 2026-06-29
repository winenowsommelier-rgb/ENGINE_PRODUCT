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
- The public export script `scripts/refresh_live_export.py` uses `EXPORT_COLS`, which
  **deliberately excludes** `b2b_price` (grouped with forbidden margin fields). Public
  bundle never contains wholesale prices.
- The public catalog (`apps/catalog`) reads `data/live_products_export.json` and applies
  a hard `PUBLIC_FIELDS` allowlist in `lib/catalog-data.ts` (with a `satisfies` drift guard).
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

### Isolation guarantee
Because the B2B app is a **separate deploy** consuming a **separate data file**, wholesale
prices can never be present in the public site's JS bundle. The public pipeline is untouched
except for one footer link.

## Data Pipeline

New script **`scripts/refresh_b2b_export.py`** (parallel to `refresh_live_export.py`):

- Reads `data/db/products.db`.
- `B2B_EXPORT_COLS` = the public display columns **plus `b2b_price`, `b2b_discount_pct`**,
  and **minus retail `price`** (wholesale-only bundle — confirmed decision).
- **Filters: only rows WHERE `b2b_price IS NOT NULL`** (~7,267). "Hide missing" enforced
  at the data layer so such products never reach the app.
- **Never exports** `cost`, `margin_pct`, `b2b_margin_pct`, `b2b_margin_thb`.
- Writes **`data/b2b_products_export.json`**.

B2B app `lib/catalog-data.ts`:
- `B2B_PUBLIC_FIELDS` allowlist = public display fields + `b2b_price` (+ `b2b_discount_pct`
  if the detail page wants it), **minus** retail `price`. Keeps the `satisfies` drift guard.

Rule-9 discipline: any bulk DB write must regenerate **both** `live_products_export.json`
**and** `b2b_products_export.json`.

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
  unlocks; wrong password rejected; tampered cookie (bad HMAC) rejected.
- **Public-leak regression guard:** assert public `live_products_export.json` still has
  **no** `b2b_price` (pipelines never cross-contaminate).
- **Browser verification (Rule 7):** run B2B dev server, log in, confirm grid + list toggle
  render, prices show `฿{b2b_price}`, branding/badge correct, click through to a product
  detail page.

## Open Items for Planning

- Confirm the cross-app shared-import mechanism that builds under Next (alias vs shared pkg).
- Confirm whether `/product/[sku]` detail also shows `b2b_discount_pct` or just `b2b_price`
  (default: just `b2b_price`).
- DNS: add `b2b.wnlq9.shop` CNAME to the `wnlq9-b2b` Vercel project (deploy-time task).
