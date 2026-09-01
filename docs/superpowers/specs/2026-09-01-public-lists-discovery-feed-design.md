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

- Deduplicating multiple pins of the same product into one "saved by N people" card. V1 is a stream of pins, not products — a product pinned by 3 users appears as 3 separate cards.
- Randomized/shuffled ordering. V1 is strictly `added_at desc`.
- Any moderation or admin visibility into this feed (that's item 5, the separate admin panel, not designed here).
- True masonry (variable-height, packed) layout — v1 uses a responsive grid consistent with the existing `ListCard`/profile-page grid.
- Filtering/search within the feed (by category, region, user, etc.) — pure chronological stream only for v1.

## Architecture

### Data access

No schema change, no new RLS policy. `list_items` already has no RLS grant of its own beyond visibility through its parent `lists` row, so a straight join reproduces the correct anonymous-safe filtering:

```sql
select li.id, li.sku, li.quantity, li.added_at,
       l.id as list_id, l.public_id, l.name as list_name,
       p.id as owner_id, p.username, p.avatar_url
from list_items li
join lists l on l.id = li.list_id and l.is_public = true
join public_profiles p on p.id = l.owner_id
order by li.added_at desc, li.id desc
limit :limit
-- keyset continuation:
-- where (li.added_at, li.id) < (:cursor_added_at, :cursor_id)
```

New helper in `lib/lists.ts`:

```ts
export async function getPublicPinsFeed(
  client: SupabaseClient,
  cursor?: { addedAt: string; id: string },
  limit = 24,
): Promise<{ pins: PublicPinRow[]; nextCursor: { addedAt: string; id: string } | null }>
```

`PublicPinRow` is a new type in `lib/supabase/types.ts` matching the query shape above. Supabase's query builder expresses the join as `list_items.select('*, lists!inner(id, public_id, name, is_public, public_profiles!inner(id, username, avatar_url))').eq('lists.is_public', true)`, ordered and keyset-filtered as above.

`nextCursor` is `null` when the page returned fewer than `limit` rows (end of feed).

### Rule 6 invariant

Same guard as the list detail page: a pin whose `sku` no longer resolves via `getProductBySku` (discontinued product) renders as "no longer available" and is excluded from being actionable (no `SaveToListButton`, since there's nothing to save), but is not dropped from the feed silently — it still occupies its chronological slot so the invariant ("every list_items row either renders or is explicitly marked unavailable") holds here exactly as it does on `/lists/[public_id]`.

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
- "Pinned by {username}" with avatar, linking to `/u/[username]`.
- List name, linking to `/lists/[public_id]`.
- `SaveToListButton` in the corner, passed `sku`, `isLoggedIn`, `userLists` — identical props contract to its existing PDP/ProductCard usage, no changes to that component required.

### Nav entry point

A link to `/discover` is added to the main site header nav (placement/label — e.g. "Discover" — is an implementation-time visual decision, not an architectural one; flagging here so it isn't forgotten, not pre-deciding the exact wording/position).

## Testing

- `getPublicPinsFeed` unit test: private-list pins never appear; keyset cursor produces no duplicates/gaps across two sequential page fetches when new pins are inserted between them (the property offset pagination would get wrong).
- Rule 6 invariant test (same pattern as list detail page): a `list_items` row whose `sku` isn't in the live export renders as "no longer available" in the feed rather than being dropped or crashing.
- `SaveToListButton` on a feed card: logged-out click redirects to `/login?next=/discover`; logged-in click optimistically saves, matching its existing behavior — no new test needed for the button itself, only that `PinCard` wires its props correctly.
- Rule 7 (browser verification): visit `/discover` logged out (see pins, click through to a list and a profile, click a pin's save icon → redirected to login); log in and repeat (save a pin from the feed to a list, confirm it shows up on `/account/lists`); scroll to trigger a second page load and confirm no duplicate/missing pins across the boundary.

## Rollout

- No paid API spend, no schema migration — CLAUDE.md Rules 1/4/10 don't apply.
- No new RLS policy is introduced (the query relies entirely on existing `lists`/`list_items`/`public_profiles` policies), so this stays out of the auth hyper-scrutiny zone in the sense of *new* surface area — but the join must be verified at implementation time to confirm a private list's items are actually excluded end-to-end (automated test above), since this is the first place `list_items` is queried across owners rather than within one list's or one user's scope.
