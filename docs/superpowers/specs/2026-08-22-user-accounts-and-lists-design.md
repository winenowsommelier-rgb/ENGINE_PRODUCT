# User Accounts + Lists — Design Spec

Date: 2026-08-22
Status: Draft, pending spec review
Scope: Sub-project 1 of a larger roadmap (accounts, lists, public feed, likes, structured reviews). This spec covers **accounts/auth + profile settings + list CRUD** only. Feed, likes, and reviews are separate follow-on specs that build on the seams this spec creates.

## Context

wnlq9.shop (`apps/catalog`, Next.js 14 App Router on Vercel) is currently a **fully static, JSON-driven site with zero live backend**. Confirmed by codebase survey (2026-08-22):

- No auth/session system in `apps/catalog` (only `apps/catalog-b2b` has a single shared-password Edge-cookie gate — no per-user identity, not reusable as more than a loose reference).
- No live database connection from the deployed app. All product/page data is read from `data/live_products_export.json` at build/request time (see Rule 9, CLAUDE.md). The SQLite `data/db/products.db` is an offline enrichment store never touched by the Next.js runtime.
- No existing per-user interaction data (co-purchase/BI data is anonymous and aggregate).
- `critic_scores` is professional sommelier-curated data, not user-generated — confirmed distinct from the reviews feature planned in a later spec.
- No transactional email sending capability anywhere in the repo.

Building accounts, lists, a public feed, likes, and reviews means introducing a live backend for the first time. Per CLAUDE.md Rule 11 ("build on skeletons, not from scratch" for reuse-potential work), this spec adopts **Supabase** (Postgres + built-in email/password auth + Storage + Row-Level Security) rather than hand-rolling auth/session/DB infrastructure. Supabase MCP tooling is available in this environment for provisioning and migrations.

## Goals (this spec)

1. Users can register and log in with email/password (email verification required).
2. Users can set/edit their username and avatar in an account settings page.
3. Users can create named lists, add/remove products (with quantity), and see an estimated total.
4. Lists have a stable, human-readable, screenshot-friendly ID for admin tracing.
5. Lists can be toggled public/private (public is the seam the future feed will read from; feed itself is out of scope here).
6. Product price display in lists respects the existing ฿-tier public price-unlock gate — no special-case bypass for list owners.

## Non-goals (deferred to later specs)

- The "Users Collection" public feed page and its card layout.
- Likes and like-history.
- Structured item reviews / tasting-note capture.
- Social login (explicitly future work per user).

## Architecture

### Backend

New Supabase project. Next.js integrates via `@supabase/ssr`, using cookie-based sessions compatible with App Router server components and route handlers. This is the first live backend the app has ever had — provisioning happens at implementation time (not during spec-writing), following the project's standard "get sign-off before spending/standing up infra" pattern (CLAUDE.md Rule 10 spirit, applied to infra stand-up rather than paid API spend).

### Auth

- Supabase email/password auth (`supabase.auth.signUp`, `signInWithPassword`).
- Email verification required before login succeeds. Uses Supabase's default email provider/template initially — no custom SMTP needed to ship v1.
- Session cookie handled by `@supabase/ssr` middleware, added alongside (not replacing) the existing bot-redirect logic in `apps/catalog/middleware.ts`.

### Avatars

- Supabase Storage bucket `avatars`, public-read, upload path scoped per user: `{user_id}/avatar.{ext}`.
- Default when unset: a deterministic identicon generated client-side from the user's ID (no image asset required, no empty-state placeholder).

### Data model (Postgres, via Supabase migration)

```sql
-- profiles: 1:1 with auth.users, created by trigger on auth.users insert
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- lists: a user-created collection
create table lists (
  id          uuid primary key default gen_random_uuid(),
  public_id   text unique not null,       -- e.g. "WNL-7K2Q9"; admin-facing, screenshot-safe
  owner_id    uuid not null references profiles(id) on delete cascade,
  name        text not null,               -- defaults to "{username}'s list"
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on lists (owner_id);
create index on lists (public_id);

-- list_items: products saved to a list
create table list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references lists(id) on delete cascade,
  sku         text not null,               -- matches PublicProduct.sku in the JSON export; not an FK (products aren't in Postgres)
  quantity    integer not null default 1,
  added_at    timestamptz not null default now(),
  unique (list_id, sku)
);
create index on list_items (list_id);
```

- `public_id` generation: short uppercase code, unambiguous alphabet (excludes `0/O/1/I`), format `WNL-XXXXX`, generated app-side or via Postgres function, checked for uniqueness against the `public_id` unique constraint (retry on collision).
- `sku` is a soft reference to `PublicProduct.sku` (`apps/catalog/lib/types.ts`) — the live JSON export, not a DB table, is authoritative for product existence/price. No DB-level FK is possible across that boundary.

### Row-Level Security

- `lists`: `select` allowed if `is_public = true` OR `owner_id = auth.uid()`. `insert`/`update`/`delete` allowed only if `owner_id = auth.uid()`.
- `list_items`: readable/writable only through the parent list's visibility/ownership (policy joins to `lists`).
- `profiles`: `select` allowed to everyone (usernames/avatars are public by nature of the profile page); `update` restricted to `id = auth.uid()`.
- Enforcement lives in Postgres RLS, not just app-layer checks — this is a high-risk zone per CLAUDE.md ("Authentication" is explicitly called out), and RLS is the correct layer for it.

## Flows

### Signup / verification / login

1. `/register`: email + password → `supabase.auth.signUp()` → verification email sent.
2. On `auth.users` insert, a Postgres trigger creates the matching `profiles` row: `username` = email local-part, lowercased, non-alphanumeric characters stripped, collision-suffixed (`-2`, `-3`, ...) if taken; `avatar_url = null`. Doing this via trigger (not app code) means it can't be skipped by a code path that forgets to call it.
3. User clicks the verification link → account becomes usable → `/login` → `supabase.auth.signInWithPassword()`.
4. `/account/settings`: edit username (uniqueness re-checked on save) and upload/replace avatar. First login after verification may redirect here once as a nudge, but does not hard-block browsing elsewhere.

### Add-to-list ("pin" action)

- A save icon appears on every product card and the product detail page.
- Logged out → click redirects to `/login?next=<current-path>`.
- Logged in → click is an optimistic instant-add to the user's most-recently-used list (auto-creating a default list, `"{username}'s list"`, if the user has none yet).
- The icon opens a popover on click/hover: checkmarks for lists already containing the item, a quantity stepper, and an inline "+ New list" input. Changes apply immediately via optimistic UI backed by a server action.
- The same `sku` can appear in multiple different lists for one user. No cap on number of lists per user. Adding an already-saved SKU to the same list updates quantity rather than duplicating (enforced by the `(list_id, sku)` unique constraint).

### List detail page — `/lists/[public_id]`

- Shows list name (inline-editable by owner), items (thumbnail, name, quantity stepper, remove button — hard delete, no undo), and an estimated total.
- Total = sum of `product.price × quantity` per item, resolved by `sku` against the live JSON export at request time.
- Price/total display goes through the **same ฿-tier public unlock gate as the rest of the site** — being logged in and owning the list does not bypass it. This was explicitly confirmed with the user: the unlock is a one-time, browser-scoped action orthogonal to login.
- A SKU present in `list_items` but no longer found in the live export (discontinued product) renders as "no longer available," is excluded from the total, and does not error the page — this is the Rule 6 invariant guard for this feature (see Testing).
- Public/private toggle, visible only to the owner. New lists default to **public**.
- Deleting the whole list is instant — no confirmation step (explicit user decision, consistent with the "easy like a cart" interaction model requested).
- `public_id` is displayed on the page (small, near the title) specifically so it's legible in a screenshot for admin lookup.

### Profile page — `/u/[username]`

- Lists the owner's public (`is_public = true`) lists as cards.
- Private lists are visible only to the owner, via a separate `/account/lists` view (not the public profile).
- This page is the intentional seam for the future feed, likes, and reviews specs — no feed/like/review UI is built here, only the data shape that lets those specs attach cleanly.

## Testing

- RLS policy tests: anonymous read of a public list succeeds; anonymous/other-user read of a private list is rejected; writes rejected for non-owners.
- `list_items` upsert-on-duplicate-sku behavior; username collision handling at signup and at settings-edit time; `public_id` uniqueness/retry-on-collision.
- Rule 6 invariant test: every `list_items` row for a given `sku` either renders on the list page or is explicitly marked unavailable — never silently dropped or crashing.
- Rule 7 (browser verification): full walkthrough on the dev server — register → verify email → log in → save an item to a list → view the list → adjust quantity → remove an item → toggle a list private → delete a list. Repeat key steps in a logged-out state to confirm gating.

## Rollout

- Supabase project creation, migration application, and schema verification (`list_tables`/`execute_sql` via MCP) happen at implementation time, with explicit check before any app code lands, not during this design phase.
- No paid per-row API loop is introduced by this feature, so CLAUDE.md Rules 1/4/10 (paid-run verification) don't apply here — the applicable high-risk-zone rule is authentication (Rule 3 of the Code Review & Generation Standards section), which is why RLS is specified explicitly above rather than left as an app-layer assumption.

## Open items carried to later specs

- Public feed page ("Users Collection") reading `lists where is_public = true`.
- Likes: a `list_likes` table (user, list, timestamp) and like-history view — not designed here, but the `lists.public_id`/`is_public` shape above is built to support it without migration churn.
- Structured per-item reviews (0–10 score + comment + category-specific gauge/character/taste attributes), including the "log while tasting" UX the user described wanting to think through further.
