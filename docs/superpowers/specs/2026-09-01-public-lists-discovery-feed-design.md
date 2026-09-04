# Public Lists Discovery Feed — Design Spec

Date: 2026-09-01 (revised 2026-09-04)
Status: V1 (real pins only) reviewed and revised across three rounds (RLS verification, query-mechanics fix, cursor-injection fix), price display decision resolved. **V2 revision (this update) adds multi-source seeding and masonry layout — pending its own spec-review pass before implementation.**
Scope: Item 4 of the lists-v2 follow-on requests (see `project_lists_feature_v2_requests` memory). Builds on the accounts/lists sub-project (`2026-08-22-user-accounts-and-lists-design.md`, shipped, PR #111/#113/#114) and PR #119 (thumbnails, save-to-list animation, PDP pin icon — merged 2026-08-31).

## Why this revision exists

Live data check on 2026-09-04, before implementation started: the entire platform has 29 registered profiles, only 4 users have ever created a list, and only 6 items have ever been saved (3 on public lists). A `/discover` feed built strictly to the V1 design below would show 3 cards and then nothing — the feature would launch functionally correct but practically empty, and wouldn't demonstrate the "Pinterest-like" discovery experience it's meant to deliver. Rather than ship an empty feed and wait for organic growth, this revision blends three additional content sources in with real pins so the feed has substance from day one, while keeping real user activity as the primary, growing signal. See "Multi-source feed" below.

## Context

`apps/catalog` currently has two lists surfaces, both scoped to a single owner:

- `/lists/[public_id]` — one list's detail page.
- `/u/[username]` — one user's public profile, showing that user's public lists as cards (`ListCard`).

No aggregate view exists across all users' public lists. The 2026-08-22 spec explicitly designed `lists.is_public` (default `true`) as "the seam the future feed will read from" and deferred the feed itself as out of scope. This spec is that follow-on.

Existing pieces this design reuses without modification:

- `lib/lists.ts` — `getListItems`, `getListByPublicId`, `getUserLists`, all built on Postgres RLS that gates `list_items` reads through the parent `lists.is_public`/`owner_id` policy (no separate RLS grant on `list_items` itself).
- `lib/catalog-data.ts` — `getProductBySku`, resolving a `sku` against the live JSON export (`data/live_products_export.json`, per CLAUDE.md Rule 9).
- `lib/price-tiers.ts` — `resolveSale`, used identically to `ListItemRow`'s per-row price display.
- `components/PriceDisplay.tsx` — the site-wide ฿-tier price-unlock gate (see Price display decision below).
- `components/lists/SaveToListButton.tsx` — the pin/save action, already handling logged-out redirect, optimistic add, and multi-list picker. Used as-is on this page.
- `components/lists/ListItemRow.tsx` / `ListCard.tsx` — sibling patterns this design's new `PinCard` follows structurally (not literally reused, since the data shape differs — see below).

### Price display decision

An earlier review pass asked whether `/discover`, as a new anonymous-first surface, needs to hide real prices from visitors who haven't unlocked pricing — flagged given this project's history with margin/price-leak incidents. Resolved: **no special-case needed, because the gate is already global, not page-scoped.**

`PriceDisplay` (`components/PriceDisplay.tsx`) is documented as "the single chokepoint for rendering a price anywhere in the storefront" — it shows the real price when `usePriceUnlock().unlocked` is true, else the coarse `priceTierIcon` behind a click-to-unlock button. `PriceUnlockProvider` mounts once in `app/layout.tsx` (root layout, every route), with unlock state in `sessionStorage` — it is not conditional on being logged in, owning a list, or which page is being viewed. Confirmed `ListItemRow` (the list-detail page's per-row price) already renders through `PriceDisplay`, not a raw `formatPrice` call — so there is no existing "unlocked-by-default" list-scoped exception for `PinCard` to accidentally inherit.

This is explicitly a **display gate, not a security boundary** (per `PriceUnlockProvider`'s own doc comment: the real price is already present in the page's data/HTML regardless of unlock state — a determined visitor can already find it in devtools on any page today). So `/discover` showing coarse ฿-icons to a not-yet-unlocked anonymous visitor, same as every other public product surface, is the correct and sufficient behavior — not a new leak, and not a new gate to build. **`PinCard`'s price line must render through `PriceDisplay` (matching `ListItemRow`'s existing call: `<PriceDisplay price={resolveSale(product.price, product.special_price)?.special ?? product.price} />`), not a raw `formatPrice`/inline price string** — this is the one concrete implementation requirement from this decision, called out explicitly so it isn't dropped as an unstated assumption.

## Goals

1. A new page shows a reverse-chronological stream of individual saved items ("pins") drawn from every user's public lists, not grouped by list or user.
2. Each pin card is actionable: a logged-in viewer can save the pinned item to their own list directly from the feed, using the existing `SaveToListButton`.
3. Each real pin links through to its source list (`/lists/[public_id]`) and its owner's public profile (`/u/[username]`), the two existing single-owner surfaces.
4. Pagination scales correctly as pin volume grows, without the classic offset-pagination bug (items shifting between pages as new pins land).
5. **(V2 revision)** The feed has visible substance from day one, independent of real-pin volume, by blending in Staff Pick, Trending, and Requested cards (see Multi-source feed) — without making the feed feel fake or misleading about what's a genuine user save vs. seeded content.
6. **(V2 revision)** The layout reads as a genuine Pinterest-like packed masonry grid, not a plain row-based grid with visible gaps.

## Non-goals (deferred)

- Deduplicating multiple pins of the same product into one "saved by N people" card. The feed is a stream of pins, not products — a product pinned by 3 users appears as 3 separate cards. This applies even when the same SKU is pinned both publicly (by one user) and privately (by another) — the private pin never appears (filtered by the `lists.is_public` join condition) and the public one renders normally; no `DISTINCT ON (sku)` or similar collapsing should be added, as that would silently violate this non-goal. This non-goal now also covers cross-source duplication: if the same SKU appears as both a real Pin and a Staff Pick or Trending card (see Multi-source feed below), both cards render — no collapsing across sources either.
- Randomized/shuffled ordering. Real pins are strictly `added_at desc`; Staff Pick/Trending/Requested cards use a synthetic timestamp interleaved into the same sort (see Multi-source feed), not a separate randomized placement.
- Any moderation or admin visibility into this feed (that's item 5, the separate admin panel, not designed here).
- Filtering/search within the feed (by category, region, user, source type, etc.) — pure chronological stream only.
- **Superseded by this revision, no longer a non-goal:** true masonry layout is now in scope (see Page structure). The original V1 spec deferred it in favor of a plain responsive grid; this revision pulls it in because a sparse feed (see "Why this revision exists") benefits more from a visually dense, Pinterest-like packed layout than a grid that would otherwise show mostly empty rows.

## Architecture

### Data access

This section covers the real-pins query path only — no schema change, no new RLS policy for that path specifically. (The V2 revision's Staff Pick/Trending/Requested sources do add two new tables; see "Multi-source feed" and "Rollout" below — this section's "no schema change" claim does not extend to those.) Verified directly against the live `WNLQ9 PI DB` Supabase project (`dsyplzckfezcxiuikkfm`) via `pg_policies` on 2026-09-01 — the actual deployed policies, not inherited from the 2026-08-22 spec's prose:

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
  // cursor is client-supplied (round-tripped through a public, unauthenticated
  // /discover page and loadMorePinsAction) and gets string-interpolated into a
  // PostgREST `or=` filter, whose grammar uses comma/paren/period as syntax.
  // An unvalidated cursor is a filter-injection vector -- e.g. a crafted
  // addedAt containing a comma could inject extra OR-branches and widen the
  // query beyond the intended keyset window. RLS still bounds the final
  // result to public lists regardless, but this must still be rejected
  // before it reaches the filter string, not relied on RLS as the only
  // backstop. Validate BOTH fields before building the filter:
  const isValidTimestamp = !Number.isNaN(Date.parse(cursor.addedAt));
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id);
  if (!isValidTimestamp || !isValidUuid) throw new Error('Invalid pagination cursor');

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
if (ownerIds.length === 0) return { pins: [], nextCursor: null }; // page 1 empty feed, or a page whose lists were all deleted between steps

const { data: profiles, error: profileError } = await client
  .from('public_profiles')
  .select('id, username, avatar_url')
  .in('id', ownerIds);
if (profileError) throw new Error(profileError.message);

const profileById = new Map(profiles.map((p) => [p.id, p]));
```

This is one extra round trip per page (not per row — bounded by the page's distinct owner count, at most `limit`), assembled in application code rather than the database, matching the flat-query-then-join-in-JS pattern already used for cross-cutting reads elsewhere in this feature (e.g. `ListDetailPage` resolving each item's product via `getProductBySku` after the DB read, not inside the query).

A `list_items`/`lists` row whose `owner_id` has no matching entry in `public_profiles` (e.g. a profile deleted in the narrow window between Step 1 and Step 2, or any other orphaned-owner edge case) resolves to `profileById.get(...)` returning `undefined`. `PinCard` (see Page structure below) must guard this the same way it guards a missing product — render an "unavailable" state for the attribution rather than crashing on a null username.

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

### Multi-source feed (V2 revision)

The feed blends four card sources into one chronologically-sorted stream:

| Source | Badge | Origin | Save-able | Sort timestamp |
|---|---|---|---|---|
| Real pin | "Pinned by {username}" | `list_items` via `getPublicPinsFeed` (Data access above, unchanged) | Yes (already was) | Real `added_at` |
| Staff Pick | "Staff Pick" | New `curated_pins` table, staff-authored | Yes | Real `created_at` on the row (a genuine event — staff added it at a real moment) |
| Trending | "Trending" | Existing `products.popularity_tier` / reputation columns (already in `data/live_products_export.json` per Rule 9 — no new data source) | Yes | Synthetic, see "Synthetic timestamps" below |
| Requested | "Requested" | New `requested_items` table, nightly-synced from the stock-check ticket sheet (see "Requested items sync" below) | Yes | Synthetic, see "Synthetic timestamps" below |

All four sources render through the same `PinCard` component and expose an identical `SaveToListButton` — a viewer cannot tell from the save action alone which source a card came from; only the badge differs. This was an explicit product decision (not a technical default): Staff Pick/Trending/Requested cards exist to make the catalog feel alive while real-pin volume grows, and letting viewers act on them the same way as real pins is what makes them useful rather than purely decorative.

**Why Trending doesn't need a new query:** `popularity_tier` and reputation fields are already present per-product in `data/live_products_export.json`, the same in-memory data `getProductBySku` already reads (Rule 6 invariant, below). Selecting the top-N by `popularity_tier` at render/build time is a synchronous in-memory operation, not a new DB table or sync job — the only genuinely new infrastructure this revision introduces is `curated_pins` (Staff Picks, editorial) and `requested_items` (the sheet sync).

**Requested items sync:**

Source: a published Google Sheet CSV (a customer-service stock-check ticket log — columns include `Ticket ID`, `Requester Name` (internal staff), `SKU`, `Item Name`, `Stock Status`, `Client Name`, among others). This sheet contains real customer names (`Client Name`) and internal staff names (`Requester Name`) — **neither may ever be read into `requested_items` or appear anywhere in this feature.** Only `SKU` is extracted.

- **Sync model:** nightly scheduled job, following the same pattern as the existing nightly price-sync (`chore(data): nightly price sync`) rather than a live per-request fetch — consistent with this codebase's established rule that user-facing surfaces read from the app's own data store, not a third-party URL directly (Rule 9's reasoning extended to a new source).
- **Filter:** rows are grouped by `SKU`; a SKU qualifies for `requested_items` only if it appears in **2 or more distinct tickets** (empirically, ~180 of ~650 distinct SKUs meet this bar over the sheet's ~3-week history as of 2026-09-04 — a large enough pool to matter, not so large it stops being a signal) **and** its "most recent" `Stock Status` in the sheet indicates in-stock (not `0`, not "Discontinue", not the Thai out-of-stock equivalents).
  - **"Most recent" is defined by the `Timestamp` column** (present in the sheet — each row is one ticket with its own timestamp), not sheet row order: for a given SKU, take the row with the latest `Timestamp` value and use only that row's `Stock Status`. This is well-defined regardless of manual reordering/editing in the sheet, since it doesn't depend on physical row position.
  - **Tie-break if two rows share the exact same `Timestamp` for the same SKU:** prefer whichever indicates in-stock is FALSE (i.e., treat the SKU as out-of-stock/excluded) — an availability claim should fail closed, not open, when the sync can't unambiguously determine the latest state. This is a deliberate conservative default, not an edge case left to be invented ad hoc at implementation time.
  - A SKU that later goes out of stock drops out of `requested_items` on the next sync, same as it would from `getProductBySku` resolving to nothing (Rule 6 invariant applies here too).
  - **Sync trusts the sheet's own free-text `Stock Status` value as-is for this filter** — it is not cross-checked against the live product export's own stock fields (`is_in_stock`/`custom_stock_status`/`wn_stock`/consign, per this repo's "Stock field semantics" note) at sync time, since the two are different, independently-maintained signals (one a manual customer-service log, one the authoritative catalog state) that can legitimately disagree or lag each other. The render-time `getProductBySku` Rule 6 guard (above) is the authoritative backstop against a stale/wrong "in stock" claim from the sheet ever actually reaching a user — the sync-time filter is a coarse pre-filter, not the source of truth.
- **Table shape:** `requested_items (sku text primary key, request_count int, last_synced_at timestamptz)`. No ticket ID, no requester, no client name, no order number — the sync job's extraction step must select only `SKU` and derive `request_count`/`last_synced_at` itself; it must not carry any other column from the source sheet into the table, even transiently in a way that could be logged.
- **Failure mode:** if the sheet URL is unreachable or returns malformed CSV, the sync job logs and skips that run, leaving `requested_items` at its last-synced state — never blocks or degrades the `/discover` page itself, which reads only from `requested_items`, not the sheet directly. **The failure/error log must never include a raw CSV row** — only the SKU (if parseable) and/or a row number/line number for debugging. The natural instinct when debugging a parse failure is to log the offending row verbatim, which would leak `Client Name`/`Requester Name` into log storage even though the `requested_items` table itself stays clean — this is a real, distinct leak vector from the table-level guarantee and must be called out explicitly in the sync job's implementation, not left to whoever writes the error handling to notice on their own.

**Synthetic timestamps (Trending, Requested):**

Popularity and demand are standing states, not discrete events — there is no real "this became trending at 3:47pm" moment to sort by, and forcing one (e.g., "surfaced_at = last sync run") would cluster every Trending/Requested card at the exact same instant, which reads as visibly artificial in a feed that's otherwise a believable activity stream. Instead, each Trending/Requested card is assigned a synthetic sort timestamp spread pseudo-randomly across a rolling 24-hour window at render/build time (seeded by `sku` so the same card doesn't jump around between page loads within that window). This is a deliberate, documented exception to "every timestamp is a real event" — call this out in code comments at the point the synthetic timestamp is generated, so a future reader doesn't mistake it for a real `added_at`/`created_at` and try to "fix" it into one.

**`curated_pins` table (Staff Pick):** `curated_pins (id uuid primary key, sku text, created_at timestamptz default now(), created_by uuid references profiles(id))` — a real table with a real insert-time timestamp, populated by staff through direct DB access or a small internal tool (out of scope for this spec; V1 of Staff Pick can be a manual SQL insert, matching how this codebase already treats several other low-volume editorial tables).

### Rule 6 invariant

Same guard as the list detail page: a pin whose `sku` no longer resolves via `getProductBySku` (discontinued product) renders as "no longer available" and is excluded from being actionable (no `SaveToListButton`, since there's nothing to save), but is not dropped from the feed silently — it still occupies its chronological slot so the invariant ("every list_items row either renders or is explicitly marked unavailable") holds here exactly as it does on `/lists/[public_id]`.

This invariant applies uniformly across all four card sources, not just real pins — a Staff Pick, Trending, or Requested card whose `sku` no longer resolves gets the same "no longer available" treatment. For Requested specifically, this is a second independent guard beyond the sync job's own in-stock filter (which only checks the sheet's own `Stock Status` column at sync time) — a SKU can go from in-stock to genuinely removed from the live export between syncs, and this render-time check catches that regardless of what the sheet says.

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
- Fetches page 1 via `getDiscoverFeed(supabase)` — renamed/expanded from `getPublicPinsFeed` to reflect that it now merges four sources, not one (see "Feed assembly" below).
- Fetches the viewer's own session + `getUserLists` (if logged in) once for the whole page — passed down to every `PinCard`'s `SaveToListButton`, not re-fetched per card.
- Renders `<PinGrid initialPins={...} initialCursor={...} isLoggedIn={...} userLists={...} />`.
- Empty state ("No public pins yet") if page 1 returns zero rows — kept as a guard even though the multi-source blend makes an empty first page unlikely; a future state where Staff Picks/Trending are also exhausted (e.g. a catalog data issue) should still degrade gracefully rather than assume this can't happen.

**Feed assembly (`getDiscoverFeed`) — merge-then-truncate with a per-source cursor:**

A single shared `(sort_ts, id)` cursor cannot correctly paginate across four independent sources — Postgres can't keyset-paginate across four heterogeneous tables/sources in one query, so this is necessarily an application-level merge: fetch up to `limit` rows from each of the four sources independently, sort the combined (up to `4 × limit`) rows by `sort_ts desc`, truncate to `limit` for the page actually returned. The critical correctness requirement this creates: **the next page's cursor must let each source resume independently from wherever its own contribution to the current page left off, not from one shared boundary value** — a Pin's `added_at` boundary has no meaningful relationship to Trending's synthetic timestamp stream, so a single cursor cannot describe "resume all four sources correctly."

The cursor is therefore a **per-source object**, not a single tuple:

```ts
type DiscoverCursor = {
  pins?: { addedAt: string; id: string };       // last Pin included on the current page, or absent if that source is exhausted
  curated?: { createdAt: string; id: string };   // last Staff Pick included, or absent if exhausted
  trending?: { sortTs: string; sku: string };     // last Trending card included, or absent if exhausted
  requested?: { sortTs: string; sku: string };    // last Requested card included, or absent if exhausted
};
```

Each key is populated only if that source contributed at least one row to the truncated page (i.e., at least one of its fetched-but-discarded rows was newer than the truncation boundary) — a source with zero contributions on this page keeps its PREVIOUS cursor value unchanged (it hasn't advanced), not a stale/incorrect one. `getDiscoverFeed(client, cursor?: DiscoverCursor, limit = 24)` runs four independent per-source queries, each using its own slice of `cursor` and each source's own existing keyset mechanism:

- **Pins**: exactly the V1 `getPublicPinsFeed` query/cursor-validation logic (Data access above), unmodified — reused as a sub-query, not reimplemented.
- **Staff Picks**: the same shape of query against `curated_pins`, ordered by `created_at desc, id desc`, with the same `Date.parse`/UUID cursor validation as Pins (real timestamp, real UUID `id` — no new validation logic needed beyond what V1 already proved).
- **Trending / Requested**: ordered by their synthetic `sort_ts desc, sku desc` (using `sku` itself as the tie-breaker id, since these sources have no natural row UUID — `sku` is unique per product, so it's a valid, always-present, always-string tie-breaker; no "UUID derived from sku" hashing scheme is needed, which also resolves the format-validity risk of a non-canonical synthetic UUID silently failing a UUID-shaped cursor validator). Validate `sortTs` the same way as `addedAt` (`Date.parse`); validate `sku` against the same allowlist character check `isValidUsername`-style patterns already use elsewhere in this codebase (alphanumeric + limited punctuation), not the UUID regex, since it's a different id type — this must reject anything that could inject into the `.or()` filter string, mirroring the V1 cursor-injection fix's reasoning but applied to a `sku`-shaped key instead of a UUID-shaped one.

**Collision handling (real pin `added_at` vs. a synthetic Trending/Requested `sort_ts` landing at/near the same instant):** because each source keyset-paginates independently using its own cursor slice, a same-instant collision between two DIFFERENT sources' rows is not a pagination-breaking event the way it would be under a single shared cursor — each source's own `(sort_ts/addedAt, tie-breaker)` pair only needs to be a strict total order WITHIN that source, which real `added_at`+UUID and synthetic `sort_ts`+`sku` both already are. The only new invariant to test (see Testing) is that the merge-sort step (`sort_ts desc` across all four combined rows) uses a stable sort, so two rows from different sources with an exactly-equal `sort_ts` don't nondeterministically swap order between an initial page load and a later page fetch within the same session — this is what "no visually-jumping cards" in the Rule 7 walkthrough is actually checking for.

**`PinGrid`** (client component):
- Holds `pins` array + `cursor` in state.
- IntersectionObserver on a sentinel element at the bottom triggers `loadMorePinsAction(cursor)`, appending results and advancing the cursor. Falls back to a manual "Load more" button (also present, not hidden) for accessibility/no-JS-observer edge cases.
- **Masonry layout (in scope per this revision):** CSS columns (`columns-2 sm:columns-3 lg:columns-4` with `break-inside-avoid` on each card) rather than a JS-measured packed grid — the simplest approach that gets genuine variable-height masonry without a new dependency or manual height calculation, at the cost of column-order (not strict row-order) card placement, which is an accepted tradeoff for a discovery feed (not one where left-to-right reading order matters, unlike a table). If this reads as visually unstable during infinite-scroll appends (new cards inserted mid-column shifting existing ones), the fallback is the original V1 responsive-grid layout — call this out explicitly during Rule 7 verification as something to actually look at, not assume works from the CSS alone.

**`PinCard`** (server-renderable, no client state of its own beyond what `SaveToListButton` needs):
- Thumbnail + product name + price, rendered through `PriceDisplay` exactly as `ListItemRow` does (see Price display decision above — not a raw `formatPrice` call), or "No longer available" state per the Rule 6 guard above.
- **Source badge** (top-left or inline near the attribution line, exact placement an implementation-time visual decision): "Pinned by {username}" with avatar for real pins (unchanged from V1), or "Staff Pick" / "Trending" / "Requested" for the other three sources — no avatar for those three, since there's no owning user.
- "Pinned by {username}" avatar handling unchanged from V1: `avatar_url` nullable, falls back to the initial-letter treatment from `/u/[username]/page.tsx`; an orphaned-owner lookup (Step 2's edge case) renders the attribution as unavailable rather than crashing.
- List name + link to `/lists/[public_id]` — real pins only; Staff Pick/Trending/Requested cards have no source list, so this line is omitted for those three (not rendered as broken/empty).
- `SaveToListButton` — present on **all four sources** (this was an explicit product decision — see Multi-source feed above), passed `sku`, `isLoggedIn`, `userLists`, identical props contract to its existing PDP/ProductCard usage regardless of source, no changes to that component required. **Verified by reading `components/lists/SaveToListButton.tsx` directly** (not assumed): its props are exactly `{ sku, isLoggedIn, userLists, className }`, its click handlers call `pinToDefaultListAction(sku)`/`addItemToListAction(listId, sku)` (both SKU-only, no dependency on a "pin"-shaped object), and its internal `saved` state is local component state that starts `false` on every mount regardless of source — this last point is a pre-existing V1 behavior (not introduced by this revision): the button always renders as "not saved" on first render even if the viewer already saved that exact SKU elsewhere, since it has no lookup against the viewer's existing lists. Worth a one-line mention in the plan as a known, accepted gap (already true today on PDP/ProductCard), not something this revision needs to fix.

### Nav entry point

A link to `/discover` is added to the main site header nav (placement/label — e.g. "Discover" — is an implementation-time visual decision, not an architectural one; flagging here so it isn't forgotten, not pre-deciding the exact wording/position).

## Testing

- `getPublicPinsFeed` unit test: seed one public and one private list, each with a distinct known `list_items.id`; assert the private list's item id is absent from the returned `pins` (not merely that `pins.length` matches an expected count, which would pass even under an RLS-bypass regression using a service-role client). Also: the `!inner` join on `lists` must be exercised against this fixture to confirm a private-parent row is excluded entirely, not returned with a null `lists` field. Keyset cursor produces no duplicates/gaps across two sequential page fetches when new pins are inserted between them (the property offset pagination would get wrong).
- Rule 6 invariant test (same pattern as list detail page): a `list_items` row whose `sku` isn't in the live export renders as "no longer available" in the feed rather than being dropped or crashing.
- Cursor validation test: `getPublicPinsFeed` rejects a malformed cursor (non-ISO `addedAt`, non-UUID `id`, or a value crafted with filter-syntax characters like a stray comma/paren) before it reaches the `.or()` filter string, rather than passing it through — this is the fix for the filter-injection risk identified in the second review pass, and needs its own test to stay fixed.
- `SaveToListButton` on a feed card: logged-out click redirects to `/login?next=/discover`; logged-in click optimistically saves, matching its existing behavior for ALL FOUR sources, not just real pins — no new test needed for the button itself, only that `PinCard` wires its props correctly regardless of source.
- **Requested-items sync job test:** given a sample sheet with a mix of single-mention and repeat-mention SKUs, and a mix of in-stock/out-of-stock `Stock Status` values, assert `requested_items` ends up containing only SKUs with 2+ distinct tickets AND currently in-stock. Assert no `Client Name`/`Requester Name`/ticket-id column value ever appears in the resulting table row (a direct check, not just an absence-of-column-in-the-insert-statement review — the extraction step should be tested against a fixture that includes those columns to confirm they're actually dropped, not merely never selected in the happy path).
- **Cross-source feed assembly test:** given a mix of real pins, a `curated_pins` row, and a `requested_items` row, `getDiscoverFeed` returns all of them in one correctly-ordered page; a discontinued-product SKU from any of the four sources renders "no longer available" (Rule 6 invariant, extended).
- **Per-source cursor pagination test (the actual gap the merge-then-truncate design creates):** seed enough rows in at least two sources (e.g. 30 real pins and 30 curated picks, more than one page's worth of each) that a single page can't include everything; fetch page 1, then page 2 using the returned per-source `DiscoverCursor`; assert every row appears exactly once across the two pages (no duplicates, no gaps) for BOTH sources independently, and assert a source that contributed zero rows to page 1 (e.g. Requested, if empty) still correctly starts contributing from its own beginning on page 2 rather than being skipped because its cursor key was absent.
- **Merge-sort stability test:** construct two rows from different sources with the exact same `sort_ts`/`addedAt` value; assert repeated calls to the merge step return them in the same relative order every time (not source-call-order-dependent), so a card doesn't visually swap position with another card between an initial load and a later fetch in the same session.
- **Synthetic timestamp test:** two calls to the Trending/Requested timestamp generator for the same `sku` within the same 24h window produce the same value (deterministic, not re-randomized per request) — this is what keeps a card from visually "jumping" position between an initial page load and a subsequent infinite-scroll append within one session.
- Rule 7 (browser verification): visit `/discover` logged out — confirm all four badge types render distinctly, masonry layout looks visually correct (not obviously broken/overlapping) at mobile/tablet/desktop widths, click through to a list and a profile from a real pin, click a save icon on each of the four source types → each redirects to login the same way; confirm prices render as ฿-tier icons, not real numbers, until the unlock passcode is entered — same as any other public product surface; log in and repeat (save a card from each source type, confirm all show up on `/account/lists`); scroll to trigger a second page load and confirm no duplicate/missing/visually-jumping cards across the boundary, including for Trending/Requested cards (this is the practical check for the synthetic-timestamp determinism above).

## Rollout

- **No paid API spend** — the Requested-items sync fetches a public CSV export, not an LLM/paid API, so CLAUDE.md Rule 1's cost-tracking requirements don't apply. **This revision DOES introduce a schema migration** (`curated_pins`, `requested_items` — new tables, not modifications to existing ones) and a new scheduled job, unlike the original V1 spec's "no schema migration" claim, which is now specific to the real-pins query path only.
- No new RLS policy on the *existing* `lists`/`list_items`/`profiles`/`public_profiles` tables. The exact deployed policy text was pulled from `pg_policies` against the live `WNLQ9 PI DB` project on 2026-09-01 (see Data access above) rather than trusted from the 2026-08-22 spec's prose — this is the first place `list_items` is queried across owners rather than within one list's or one user's scope, so CLAUDE.md's auth hyper-scrutiny zone applies to the *verification*, even though no new policy is written for those tables. The automated test in Testing above (private-list pins never appear) still guards against future policy drift, since a verified-correct policy today doesn't guarantee it stays that way. The two *new* tables (`curated_pins`, `requested_items`) do need their own RLS: both should be public-read (they're only ever surfaced on a public discovery page) and write-restricted to the sync job's service-role credential / staff-only insert path respectively — this needs to be specified precisely (exact policy SQL) in the implementation plan, not left implicit.
- These policies exist only as applied state on the live Supabase project — no `.sql` migration file for `lists`/`list_items`/`profiles`/`public_profiles` is currently tracked in `supabase/migrations/`. Not a blocker for this spec (the live policies are the source of truth checked above), but a pre-existing gap worth closing separately: capture the current schema+RLS as a baseline migration so future changes are diffable instead of only verifiable by live query. The two new tables this revision adds should NOT repeat this gap — their migration should be a proper tracked `.sql` file from the start, unlike the older tables.
- **Rule 10 (pre-flight checklist) applies to the sync job**, even without paid spend, because it's a new scheduled write path touching production data: before the nightly Requested-items sync runs unattended, verify it on a manual/canary run first (a handful of known SKUs from the sheet, confirm `requested_items` ends up with exactly the expected rows and no PII columns), the same discipline as any other bulk write in this codebase.
- Google Sheet URL dependency: the published CSV link is an external resource this repo doesn't control the uptime/schema of. The sync job's failure mode (log-and-skip, see Multi-source feed above) is the mitigation; there's no SLA on the sheet's availability, and the feed continuing to work off its last-synced `requested_items` state during an outage is intentional degradation, not a bug to fix by adding retries/alerting in v1.
