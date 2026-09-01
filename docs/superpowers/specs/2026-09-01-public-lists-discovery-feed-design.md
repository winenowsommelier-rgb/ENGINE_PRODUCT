# Public Lists Discovery Feed — Design Spec

Date: 2026-09-01
Status: Draft, pending spec review
Scope: Item 4 of the lists-v2 follow-on requests (see `project_lists_feature_v2_requests` memory). Builds on the accounts/lists sub-project (`2026-08-22-user-accounts-and-lists-design.md`, shipped, PR #111/#113/#114) and PR #119 (thumbnails, save-to-list animation, PDP pin icon — merged 2026-08-31).

## Context

`apps/catalog` currently has two lists surfaces, both scoped to a single owner:

- `/lists/[public_id]` — one list's detail page.
- `/u/[username]` — one user's public profile, showing that user's public lists as cards (`ListCard`).

No aggregate view exists across all users' public lists. The 2026-08-22 spec explicitly designed `lists.is_public` (default `true`) as "the seam the future feed will read from" and deferred the feed itself as out of scope. This spec is that follow-on.

Existing pieces this design reuses without modification:

- `lib/lists.ts` — `getListItems`, `getListByPublicId`, `getUserLists`, all built on Postgres RLS that gates `list_items` reads through the parent `lists.is_public`/`owner_id` policy (no separate RLS grant on `list_items` itself).
- `lib/catalog-data.ts` — `getProductBySku`, resolving a `sku` against the live JSON export (`data/live_products_export.json`, per CLAUDE.md Rule 9).
- `lib/price-tiers.ts` — `resolveSale`, used identically to `ListItemRow`'s per-row price display.
- `components/lists/SaveToListButton.tsx` — the pin/save action, already handling logged-out redirect, optimistic add, and multi-list picker. Used as-is on this page.
- `components/lists/ListItemRow.tsx` / `ListCard.tsx` — sibling patterns this design's new `PinCard` follows structurally (not literally reused, since the data shape differs — see below).

## Goals

1. A new page shows a reverse-chronological stream of individual saved items ("pins") drawn from every user's public lists, not grouped by list or user.
2. Each pin card is actionable: a logged-in viewer can save the pinned item to their own list directly from the feed, using the existing `SaveToListButton`.
3. Each pin links through to its source list (`/lists/[public_id]`) and its owner's public profile (`/u/[username]`), the two existing single-owner surfaces.
4. Pagination scales correctly as pin volume grows, without the classic offset-pagination bug (items shifting between pages as new pins land).

## Non-goals (deferred)

- Deduplicating multiple pins of the same product into one "saved by N people" card. V1 is a stream of pins, not products — a product pinned by 3 users appears as 3 separate cards. This applies even when the same SKU is pinned both publicly (by one user) and privately (by another) — the private pin never appears (filtered by the `lists.is_public` join condition) and the public one renders normally; no `DISTINCT ON (sku)` or similar collapsing should be added, as that would silently violate this non-goal.
- Randomized/shuffled ordering. V1 is strictly `added_at desc`.
- Any moderation or admin visibility into this feed (that's item 5, the separate admin panel, not designed here).
- True masonry (variable-height, packed) layout — v1 uses a responsive grid consistent with the existing `ListCard`/profile-page grid.
- Filtering/search within the feed (by category, region, user, etc.) — pure chronological stream only for v1.

## Architecture

### Data access

No schema change, no new RLS policy. Verified directly against the live `WNLQ9 PI DB` Supabase project (`dsyplzckfezcxiuikkfm`) via `pg_policies` on 2026-09-01 — the actual deployed policies, not inherited from the 2026-08-22 spec's prose:

```
list_items_select_via_parent_list (SELECT):
  EXISTS (SELECT 1 FROM lists l WHERE l.id = list_items.list_id
          AND (l.is_public = true OR l.owner_id = auth.uid()))

lists_select_public_or_own (SELECT):
  is_public = true OR owner_id = auth.uid()

profiles: only "profiles_select_own" (id = auth.uid()) exists — no public
grant on the base table. Public reads go through the public_profiles VIEW
(SELECT id, username, avatar_url FROM get_public_profiles(...)), confirmed
to expose only those three columns, matching the 2026-08-22 spec's intent.
```

This confirms `list_items` has no RLS grant of its own beyond visibility through its parent `lists` row. The conceptual join this needs is:

```sql
select li.id, li.sku, li.quantity, li.added_at,
       l.id as list_id, l.public_id, l.name as list_name,
       l.owner_id
from list_items li
join lists l on l.id = li.list_id and l.is_public = true
order by li.added_at desc, li.id desc
limit :limit
-- keyset continuation:
-- where (li.added_at, li.id) < (:cursor_added_at, :cursor_id)
```

**Revision note (2026-09-01, second review pass):** an earlier draft of this section proposed a single Supabase-js query embedding `lists!inner(..., public_profiles!inner(...))` three levels deep. That doesn't work: PostgREST embedding requires a real foreign-key relationship, and while `list_items → lists` is one (this part is fine), `lists → public_profiles` is not — `public_profiles` is a view over `profiles`/`get_public_profiles()`, not an FK target of `lists.owner_id`. There is also no precedent anywhere in this codebase (`lib/lists.ts`, `actions/lists.ts`) for embedded/nested `select()` queries — every existing query is a flat single-table `select('*')` or `select('column')`, and this spec should not be the first to depart from that without a proven reason. The design below reverts to that same flat-query idiom: one query for the join that *is* a real FK relationship (`list_items → lists`), then a second flat query to batch-fetch owner profiles — matching how `actions/lists.ts` already fetches `profiles` separately (`getUsername`-style flat select) rather than embedding.

**Step 1 — page of pins, joined only through the real FK (`list_items → lists`):**

```ts
let query = client
  .from('list_items')
  .select('id, sku, quantity, added_at, lists!inner(id, public_id, name, owner_id, is_public)')
  .eq('lists.is_public', true)
  .order('added_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(limit);

if (cursor) {
  // Keyset tuple comparison has no direct tuple-lt in supabase-js; expressed
  // as the equivalent OR of "strictly older" / "same instant, smaller id" —
  // this is the standard (added_at, id) < (cursor) expansion, not a shortcut.
  query = query.or(
    `added_at.lt.${cursor.addedAt},and(added_at.eq.${cursor.addedAt},id.lt.${cursor.id})`,
  );
}

const { data, error } = await query;
if (error) throw new Error(error.message);
```

`!inner` on `lists` is load-bearing here — without it, a `list_items` row whose parent list is private would return with `lists: null` rather than being excluded, since `.eq('lists.is_public', true)` alone only filters which embedded row is attached, not whether the parent `list_items` row is returned at all. `!inner` converts the embed into an inner join, so a non-matching (private) parent excludes the row entirely — this must be verified against a real private-list fixture in the unit test (see Testing), not assumed from the client library's documentation alone, since this codebase has no prior usage of `!inner` to check the assumption against.

**Step 2 — batch-fetch owner profiles for the page's distinct `owner_id`s:**

```ts
const ownerIds = [...new Set(data.map((row) => row.lists.owner_id))];
const { data: profiles, error: profileError } = await client
  .from('public_profiles')
  .select('id, username, avatar_url')
  .in('id', ownerIds);
if (profileError) throw new Error(profileError.message);

const profileById = new Map(profiles.map((p) => [p.id, p]));
```

This is one extra round trip per page (not per row — bounded by the page's distinct owner count, at most `limit`), assembled in application code rather than the database, matching the flat-query-then-join-in-JS pattern already used for cross-cutting reads elsewhere in this feature (e.g. `ListDetailPage` resolving each item's product via `getProductBySku` after the DB read, not inside the query).

New helper in `lib/lists.ts`, combining both steps:

```ts
export async function getPublicPinsFeed(
  client: SupabaseClient,
  cursor?: { addedAt: string; id: string },
  limit = 24,
): Promise<{ pins: PublicPinRow[]; nextCursor: { addedAt: string; id: string } | null }>
```

`limit = 24` chosen as a 3-wide-grid-friendly multiple (matches the `sm:grid-cols-2`/`lg:grid-cols-3` step below with clean row counts at each breakpoint), not a load-bearing threshold — free to tune at implementation time, unlike the confidence/retry constants CLAUDE.md Rule 3 is concerned with.

`PublicPinRow` is a new type in `lib/supabase/types.ts`, assembled from the two steps above (`list_items` fields + `lists.public_id`/`name` + the matched `profileById` entry).

`nextCursor` is `null` when the page returned fewer than `limit` rows (end of feed); otherwise it's the `(added_at, id)` of the last row in `data`.

`list_items.id`/`added_at` column types were confirmed against `information_schema.columns` on the live project (not inherited from the 2026-08-22 spec's prose): `id uuid default gen_random_uuid()`, `added_at timestamptz default now()`. `id` is therefore a random v4 UUID, not sortable by insertion order. As a tie-breaker this is still correct (it makes the ordering stable and gap-free, which is all keyset pagination strictly requires), but two pins added in the same instant will tie-break in random UUID order, not true insertion order. The feed is therefore stable and duplicate/gap-free across pages, but not perfectly chronological down to sub-timestamp granularity — an acceptable, worth-stating tradeoff, not a bug.

### Rule 6 invariant

Same guard as the list detail page: a pin whose `sku` no longer resolves via `getProductBySku` (discontinued product) renders as "no longer available" and is excluded from being actionable (no `SaveToListButton`, since there's nothing to save), but is not dropped from the feed silently — it still occupies its chronological slot so the invariant ("every list_items row either renders or is explicitly marked unavailable") holds here exactly as it does on `/lists/[public_id]`.

`getProductBySku` (`lib/catalog-data.ts`) is a synchronous in-memory `Map.get()` against the already-loaded JSON export, not a network/DB round trip — calling it once per card in a render loop (as `ListDetailPage` already does) is O(1) per call, not an N+1 query. Noted explicitly so a future reader doesn't "fix" this into an unnecessary async batch-fetch.

### Visibility and deletion races during pagination

Each page of the feed is a fresh, independently-RLS-filtered query. If a list is toggled private, or deleted, between the viewer loading page 1 and requesting page 2, that list's pins simply stop appearing in the later page — `list_items` cascades on `lists` delete (per the 2026-08-22 schema), so there's no dangling reference, and RLS re-evaluates visibility on every query rather than trusting client-held state. Neither case is a bug or needs special handling; it's the same property that makes the keyset cursor safe against *insertion* races, applied to removal/visibility-change instead. No stale card the viewer already has on screen is retroactively hidden (v1 does not poll already-rendered cards for revocation) — the same "already visible, not further verified" tradeoff every other page in this feature accepts.

### Page structure

```
app/discover/page.tsx          — server component: page 1 + viewer session/lists
components/lists/PinCard.tsx   — new: one pin's card
components/lists/PinGrid.tsx   — new: client component, owns infinite-scroll state
actions/lists.ts               — add loadMorePinsAction(cursor) server action
```

**`app/discover/page.tsx`** (server component):
- Fetches page 1 via `getPublicPinsFeed(supabase)`.
- Fetches the viewer's own session + `getUserLists` (if logged in) once for the whole page — passed down to every `PinCard`'s `SaveToListButton`, not re-fetched per card.
- Renders `<PinGrid initialPins={...} initialCursor={...} isLoggedIn={...} userLists={...} />`.
- Empty state ("No public pins yet") if page 1 returns zero rows.

**`PinGrid`** (client component):
- Holds `pins` array + `cursor` in state.
- IntersectionObserver on a sentinel element at the bottom triggers `loadMorePinsAction(cursor)`, appending results and advancing the cursor. Falls back to a manual "Load more" button (also present, not hidden) for accessibility/no-JS-observer edge cases.
- Responsive grid: same Tailwind grid classes as the `/u/[username]` page's `grid grid-cols-1 gap-4 sm:grid-cols-2`, extended with a `lg:grid-cols-3` or `4` step for a wider feed page (not a single fixed max-width column like the profile page, since this page is meant to browse, not just list one user's handful of lists).

**`PinCard`** (server-renderable, no client state of its own beyond what `SaveToListButton` needs):
- Thumbnail + product name + price (mirrors `ListItemRow`'s resolve-sale display), or "No longer available" state per the Rule 6 guard above.
- "Pinned by {username}" with avatar, linking to `/u/[username]`. `avatar_url` is nullable — falls back to the same initial-letter avatar treatment already used on `/u/[username]/page.tsx`, not a new empty state. This matters more here than on the profile page: a dense scrolling feed with dozens of cards makes a missing-fallback broken-image state far more visible than a single profile header.
- List name, linking to `/lists/[public_id]`.
- `SaveToListButton` in the corner, passed `sku`, `isLoggedIn`, `userLists` — identical props contract to its existing PDP/ProductCard usage, no changes to that component required.

### Nav entry point

A link to `/discover` is added to the main site header nav (placement/label — e.g. "Discover" — is an implementation-time visual decision, not an architectural one; flagging here so it isn't forgotten, not pre-deciding the exact wording/position).

## Testing

- `getPublicPinsFeed` unit test: seed one public and one private list, each with a distinct known `list_items.id`; assert the private list's item id is absent from the returned `pins` (not merely that `pins.length` matches an expected count, which would pass even under an RLS-bypass regression using a service-role client). Also: the `!inner` join on `lists` must be exercised against this fixture to confirm a private-parent row is excluded entirely, not returned with a null `lists` field. Keyset cursor produces no duplicates/gaps across two sequential page fetches when new pins are inserted between them (the property offset pagination would get wrong).
- Rule 6 invariant test (same pattern as list detail page): a `list_items` row whose `sku` isn't in the live export renders as "no longer available" in the feed rather than being dropped or crashing.
- `SaveToListButton` on a feed card: logged-out click redirects to `/login?next=/discover`; logged-in click optimistically saves, matching its existing behavior — no new test needed for the button itself, only that `PinCard` wires its props correctly.
- Rule 7 (browser verification): visit `/discover` logged out (see pins, click through to a list and a profile, click a pin's save icon → redirected to login); log in and repeat (save a pin from the feed to a list, confirm it shows up on `/account/lists`); scroll to trigger a second page load and confirm no duplicate/missing pins across the boundary.

## Rollout

- No paid API spend, no schema migration — CLAUDE.md Rules 1/4/10 don't apply.
- No new RLS policy is introduced. The exact deployed policy text was pulled from `pg_policies` against the live `WNLQ9 PI DB` project on 2026-09-01 (see Data access above) rather than trusted from the 2026-08-22 spec's prose — this is the first place `list_items` is queried across owners rather than within one list's or one user's scope, so CLAUDE.md's auth hyper-scrutiny zone applies to the *verification*, even though no new policy is written. The automated test in Testing above (private-list pins never appear) still guards against future policy drift, since a verified-correct policy today doesn't guarantee it stays that way.
- These policies exist only as applied state on the live Supabase project — no `.sql` migration file for `lists`/`list_items`/`profiles`/`public_profiles` is currently tracked in `supabase/migrations/`. Not a blocker for this spec (the live policies are the source of truth checked above), but a pre-existing gap worth closing separately: capture the current schema+RLS as a baseline migration so future changes are diffable instead of only verifiable by live query.
