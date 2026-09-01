# Public Lists Discovery Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/discover`, a new page in `apps/catalog` showing a reverse-chronological, keyset-paginated feed of individual pins ("saved items") drawn from every user's public lists, with each pin card actionable (re-savable via the existing `SaveToListButton`) and linking through to its source list and owner's profile.

**Architecture:** A new `getPublicPinsFeed` data helper in `lib/lists.ts` runs a flat query (`list_items` inner-joined to `lists` on the one real FK relationship, filtered to `is_public = true`) plus a second batched query for owner profiles — deliberately not a nested/embedded multi-table query, since PostgREST can't resolve an embed through the `public_profiles` view and no query in this codebase does multi-level embeds today. Pagination is a `(added_at, id)` keyset cursor, validated before use to avoid filter-injection. The page itself is a server component (`app/discover/page.tsx`) rendering an initial page, handed to a client component (`PinGrid`) that owns infinite-scroll state and calls a new `loadMorePinsAction` server action for subsequent pages. `PinCard` is the new per-pin card component, built from `ListItemRow`/`ListCard`'s existing patterns (Rule 6 unavailable-product guard, `PriceDisplay` price-unlock gate, `SaveToListButton` reuse).

**Tech Stack:** Next.js 14 App Router, Supabase (`@supabase/supabase-js` via `lib/supabase/server.ts`/`client.ts`), Vitest + Testing Library, Tailwind.

**Full spec:** `docs/superpowers/specs/2026-09-01-public-lists-discovery-feed-design.md` — read this first for the "why" behind every decision below; this plan implements it task-by-task and does not repeat its reasoning.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/catalog/lib/supabase/types.ts` | Modify: add `PublicPinRow` type |
| `apps/catalog/lib/lists.ts` | Modify: add `getPublicPinsFeed` (the two-step query + cursor validation) |
| `apps/catalog/lib/__tests__/lists.test.ts` | Create: first unit test file for `lib/lists.ts` (cursor validation logic; the Supabase-dependent query paths are exercised via the Rule 7 browser walkthrough, not mocked here — see Task 2 note) |
| `apps/catalog/actions/lists.ts` | Modify: add `loadMorePinsAction` (the only action in this file that does NOT call `requireUser()` — the feed is public) |
| `apps/catalog/components/lists/PinCard.tsx` | Create: one pin's card (thumbnail, price via `PriceDisplay`, attribution, `SaveToListButton`) |
| `apps/catalog/components/lists/__tests__/PinCard.test.tsx` | Create: unit tests for `PinCard`'s Rule-6/orphaned-owner render branches |
| `apps/catalog/components/lists/PinGrid.tsx` | Create: client component owning infinite-scroll state |
| `apps/catalog/components/lists/__tests__/PinGrid.test.tsx` | Create: unit tests for load-more triggering and cursor advancement |
| `apps/catalog/app/discover/page.tsx` | Create: server component, page 1 fetch + viewer session |
| `apps/catalog/components/Header.tsx` | Modify: add nav link to `/discover` |

---

## Task 1: `PublicPinRow` type

**Files:**
- Modify: `apps/catalog/lib/supabase/types.ts`

- [ ] **Step 1: Add the type**

Append to the end of the file:

```ts
export interface PublicPinRow {
  id: string;
  sku: string;
  quantity: number;
  added_at: string;
  list: {
    public_id: string;
    name: string;
  };
  owner: PublicProfile | null; // null when Step 2's profile lookup finds no match (orphaned owner_id) — see lib/lists.ts
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors (this is an additive, unused-so-far type).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/supabase/types.ts
git commit -m "feat(lists): add PublicPinRow type for discovery feed"
```

---

## Task 2: `getPublicPinsFeed` data helper with cursor validation

**Files:**
- Modify: `apps/catalog/lib/lists.ts`
- Test: `apps/catalog/lib/__tests__/lists.test.ts` (new file)

This is the highest-risk task in the plan (it's the piece that failed review twice — see spec's "Data access" section for the full history). Build it in three sub-steps: cursor validation first (pure function, easily unit-tested), then the two-step query (integration-shaped, verified by the Rule 7 browser walkthrough in Task 7 since it needs a real Supabase connection), then wire them together.

- [ ] **Step 1: Write the failing test for cursor validation**

Create `apps/catalog/lib/__tests__/lists.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isValidPinsCursor } from '../lists';

describe('isValidPinsCursor', () => {
  it('accepts a well-formed cursor', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(true);
  });

  it('rejects a non-ISO addedAt', () => {
    expect(isValidPinsCursor({ addedAt: 'not-a-date', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: 'not-a-uuid' })).toBe(false);
  });

  it('rejects an id crafted to break out of the PostgREST filter string', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: '1,or(is_public.eq.true' })).toBe(false);
  });

  it('rejects an addedAt crafted to break out of the PostgREST filter string', () => {
    expect(isValidPinsCursor({ addedAt: '2026-01-01,or(id.gt.0', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/lists.test.ts`
Expected: FAIL — `isValidPinsCursor` is not exported from `../lists`.

- [ ] **Step 3: Implement `isValidPinsCursor` and export it**

Add to `apps/catalog/lib/lists.ts` (near the top, after existing imports):

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor for getPublicPinsFeed's keyset pagination is client-supplied
 * (round-tripped through the public, unauthenticated /discover page and
 * loadMorePinsAction) and gets string-interpolated into a PostgREST `or=`
 * filter, whose grammar uses comma/paren/period as syntax. An unvalidated
 * cursor is a filter-injection vector -- see the design spec's "Data access"
 * section for the full reasoning. Reject anything that isn't a genuine
 * ISO timestamp + UUID pair before it ever reaches the filter string.
 */
export function isValidPinsCursor(cursor: { addedAt: string; id: string }): boolean {
  return !Number.isNaN(Date.parse(cursor.addedAt)) && UUID_RE.test(cursor.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/lists.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/lists.ts apps/catalog/lib/__tests__/lists.test.ts
git commit -m "feat(lists): add isValidPinsCursor guard against filter-injection"
```

- [ ] **Step 6: Implement `getPublicPinsFeed`**

Add to `apps/catalog/lib/lists.ts`, after `upsertListItem`:

```ts
import type { PublicPinRow } from '@/lib/supabase/types';

/**
 * A page of public pins across ALL users' public lists, newest first.
 *
 * Deliberately NOT a single nested/embedded query (list_items -> lists ->
 * public_profiles). PostgREST embedding requires a real FK relationship;
 * list_items -> lists is one, but lists -> public_profiles is not (it's a
 * view, not an FK target of lists.owner_id). This codebase also has zero
 * precedent anywhere for embedded/nested select() queries -- every existing
 * query in this file is flat. So this does the join PostgREST *can* do
 * (list_items -> lists via !inner) in one query, then batches a second flat
 * query for owner profiles by distinct owner_id -- same shape as
 * ListDetailPage resolving each item's product via getProductBySku after
 * the DB read, not inside the query. See the design spec's "Data access"
 * section for the full history of why this isn't the nested-embed version.
 */
export async function getPublicPinsFeed(
  client: SupabaseClient,
  cursor?: { addedAt: string; id: string },
  limit = 24,
): Promise<{ pins: PublicPinRow[]; nextCursor: { addedAt: string; id: string } | null }> {
  if (cursor && !isValidPinsCursor(cursor)) {
    throw new Error('Invalid pagination cursor');
  }

  let query = client
    .from('list_items')
    .select('id, sku, quantity, added_at, lists!inner(public_id, name, owner_id, is_public)')
    .eq('lists.is_public', true)
    .order('added_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (cursor) {
    // Keyset tuple comparison (added_at, id) < (cursor.addedAt, cursor.id)
    // has no direct tuple-lt in supabase-js; expressed as the equivalent
    // OR of "strictly older" / "same instant, smaller id".
    query = query.or(
      `added_at.lt.${cursor.addedAt},and(added_at.eq.${cursor.addedAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    sku: string;
    quantity: number;
    added_at: string;
    lists: { public_id: string; name: string; owner_id: string; is_public: boolean };
  }>;

  if (rows.length === 0) return { pins: [], nextCursor: null };

  const ownerIds = [...new Set(rows.map((row) => row.lists.owner_id))];
  const profileById = new Map<string, { id: string; username: string; avatar_url: string | null }>();
  if (ownerIds.length > 0) {
    const { data: profiles, error: profileError } = await client
      .from('public_profiles')
      .select('id, username, avatar_url')
      .in('id', ownerIds);
    if (profileError) throw new Error(profileError.message);
    for (const p of profiles ?? []) profileById.set(p.id, p);
  }

  const pins: PublicPinRow[] = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    quantity: row.quantity,
    added_at: row.added_at,
    list: { public_id: row.lists.public_id, name: row.lists.name },
    owner: profileById.get(row.lists.owner_id) ?? null,
  }));

  const last = rows[rows.length - 1];
  const nextCursor = rows.length < limit ? null : { addedAt: last.added_at, id: last.id };

  return { pins, nextCursor };
}
```

- [ ] **Step 7: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors. If the Supabase-js generated types complain about `lists!inner(...)`'s shape, cast at the query boundary as shown (`as unknown as Array<...>`) rather than widening the function's public return type — the cast is scoped to the raw-row shape, not `PublicPinRow`.

- [ ] **Step 8: Commit**

```bash
git add apps/catalog/lib/lists.ts
git commit -m "feat(lists): add getPublicPinsFeed for the discovery feed"
```

**Note on test coverage for this step:** the query logic itself (steps 6-8) is not unit-tested here with a mocked Supabase client — mocking the `!inner` embed/`.or()` filter behavior accurately would test the mock, not the real PostgREST semantics that were the actual source of the two prior review failures. Correctness of the live query (private-list exclusion, `!inner` behavior, pagination continuity) is verified against the real database in Task 7's Rule 7 walkthrough and the manual verification query in Task 7 Step 2. If this codebase later adds a Supabase local-dev/test-database harness, add an integration test there; do not add a mocked unit test as a substitute — it would give false confidence on exactly the part that broke twice already.

---

## Task 3: `loadMorePinsAction` server action

**Files:**
- Modify: `apps/catalog/actions/lists.ts`

- [ ] **Step 1: Add the action**

Add to `apps/catalog/actions/lists.ts` (after imports, before `requireUser` or anywhere else at module scope — it does not use `requireUser`, unlike every other action in this file, since the feed is public):

```ts
import { getPublicPinsFeed } from '@/lib/lists';

/**
 * Unlike every other action in this file, this one does NOT call
 * requireUser() -- /discover is a public, unauthenticated-accessible feed.
 * Cursor validation happens inside getPublicPinsFeed itself.
 */
export async function loadMorePinsAction(cursor: { addedAt: string; id: string }) {
  const supabase = await createClient();
  return getPublicPinsFeed(supabase, cursor);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/actions/lists.ts
git commit -m "feat(lists): add loadMorePinsAction for discovery feed pagination"
```

---

## Task 4: `PinCard` component

**Files:**
- Create: `apps/catalog/components/lists/PinCard.tsx`
- Test: `apps/catalog/components/lists/__tests__/PinCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/catalog/components/lists/__tests__/PinCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PinCard } from '../PinCard';
import type { PublicPinRow } from '@/lib/supabase/types';
import type { PublicProduct } from '@/lib/types';

vi.mock('@/lib/catalog-data', () => ({
  getProductBySku: vi.fn(),
}));
vi.mock('@/components/PriceUnlockProvider', () => ({
  usePriceUnlock: () => ({ unlocked: true, openModal: vi.fn() }),
}));

const basePin: PublicPinRow = {
  id: 'pin-1',
  sku: 'ABC123',
  quantity: 1,
  added_at: '2026-09-01T00:00:00.000Z',
  list: { public_id: 'WNL-7K2Q9', name: "Alice's picks" },
  owner: { id: 'user-1', username: 'alice', avatar_url: null },
};

const baseProduct: PublicProduct = {
  sku: 'ABC123',
  name: 'Chateau Test 2020',
  price: 1500,
};

describe('PinCard', () => {
  it('renders product name, list name, and owner attribution when the product exists', async () => {
    const { getProductBySku } = await import('@/lib/catalog-data');
    vi.mocked(getProductBySku).mockReturnValue(baseProduct);

    render(<PinCard pin={basePin} isLoggedIn={false} userLists={[]} />);

    expect(screen.getByText('Chateau Test 2020')).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice's picks/i)).toBeInTheDocument();
  });

  it('renders "no longer available" and hides the save button when the product does not resolve', async () => {
    const { getProductBySku } = await import('@/lib/catalog-data');
    vi.mocked(getProductBySku).mockReturnValue(undefined);

    render(<PinCard pin={basePin} isLoggedIn={false} userLists={[]} />);

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save to list/i })).not.toBeInTheDocument();
  });

  it('renders an initial-letter avatar fallback and unavailable attribution when owner is null', async () => {
    const { getProductBySku } = await import('@/lib/catalog-data');
    vi.mocked(getProductBySku).mockReturnValue(baseProduct);

    render(<PinCard pin={{ ...basePin, owner: null }} isLoggedIn={false} userLists={[]} />);

    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run components/lists/__tests__/PinCard.test.tsx`
Expected: FAIL — `PinCard` module doesn't exist yet.

- [ ] **Step 3: Implement `PinCard`**

Create `apps/catalog/components/lists/PinCard.tsx`:

```tsx
import Link from 'next/link';
import { getProductBySku } from '@/lib/catalog-data';
import { resolveSale } from '@/lib/price-tiers';
import { PriceDisplay } from '@/components/PriceDisplay';
import { SaveToListButton } from '@/components/lists/SaveToListButton';
import type { PublicPinRow } from '@/lib/supabase/types';
import type { ListRow } from '@/lib/supabase/types';

export function PinCard({
  pin,
  isLoggedIn,
  userLists,
}: {
  pin: PublicPinRow;
  isLoggedIn: boolean;
  userLists: ListRow[];
}) {
  const product = getProductBySku(pin.sku);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      {product ? (
        <>
          <Link href={`/product/${product.sku}`} className="relative block">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.name} className="aspect-square w-full rounded-lg object-cover" />
            ) : null}
            <SaveToListButton
              sku={pin.sku}
              isLoggedIn={isLoggedIn}
              userLists={userLists}
              className="absolute right-2 top-2"
            />
          </Link>
          <Link href={`/product/${product.sku}`} className="text-sm font-medium hover:underline">
            {product.name}
          </Link>
          <PriceDisplay
            price={resolveSale(product.price, product.special_price)?.special ?? product.price}
            className="text-sm"
          />
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">{pin.sku} — no longer available</p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <Link href={`/lists/${pin.list.public_id}`} className="hover:underline">
          {pin.list.name}
        </Link>
        {pin.owner ? (
          <Link href={`/u/${pin.owner.username}`} className="flex items-center gap-1 hover:underline">
            {pin.owner.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pin.owner.avatar_url} alt={pin.owner.username} className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                {pin.owner.username.charAt(0).toUpperCase()}
              </span>
            )}
            {pin.owner.username}
          </Link>
        ) : (
          <span>unavailable</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run components/lists/__tests__/PinCard.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/components/lists/PinCard.tsx apps/catalog/components/lists/__tests__/PinCard.test.tsx
git commit -m "feat(lists): add PinCard component for discovery feed"
```

---

## Task 5: `PinGrid` client component (infinite scroll)

**Files:**
- Create: `apps/catalog/components/lists/PinGrid.tsx`
- Test: `apps/catalog/components/lists/__tests__/PinGrid.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/catalog/components/lists/__tests__/PinGrid.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PinGrid } from '../PinGrid';
import type { PublicPinRow } from '@/lib/supabase/types';

vi.mock('@/actions/lists', () => ({
  loadMorePinsAction: vi.fn(),
}));
vi.mock('@/lib/catalog-data', () => ({
  getProductBySku: vi.fn(() => ({ sku: 'X', name: 'X', price: 100 })),
}));
vi.mock('@/components/PriceUnlockProvider', () => ({
  usePriceUnlock: () => ({ unlocked: true, openModal: vi.fn() }),
}));

function pin(id: string): PublicPinRow {
  return {
    id,
    sku: 'X',
    quantity: 1,
    added_at: '2026-09-01T00:00:00.000Z',
    list: { public_id: 'WNL-1', name: 'List' },
    owner: { id: 'u1', username: 'alice', avatar_url: null },
  };
}

describe('PinGrid', () => {
  it('renders the initial pins', () => {
    render(
      <PinGrid
        initialPins={[pin('1'), pin('2')]}
        initialCursor={{ addedAt: '2026-09-01T00:00:00.000Z', id: '2' }}
        isLoggedIn={false}
        userLists={[]}
      />,
    );
    expect(screen.getAllByText('X')).toHaveLength(2);
  });

  it('appends more pins and advances the cursor when "Load more" is clicked', async () => {
    const { loadMorePinsAction } = await import('@/actions/lists');
    vi.mocked(loadMorePinsAction).mockResolvedValue({
      pins: [pin('3')],
      nextCursor: null,
    });

    render(
      <PinGrid
        initialPins={[pin('1')]}
        initialCursor={{ addedAt: '2026-09-01T00:00:00.000Z', id: '1' }}
        isLoggedIn={false}
        userLists={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getAllByText('X')).toHaveLength(2));
    expect(loadMorePinsAction).toHaveBeenCalledWith({ addedAt: '2026-09-01T00:00:00.000Z', id: '1' });
    // nextCursor is null -> "Load more" should no longer render
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('does not render "Load more" when initialCursor is already null (feed exhausted)', () => {
    render(<PinGrid initialPins={[pin('1')]} initialCursor={null} isLoggedIn={false} userLists={[]} />);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run components/lists/__tests__/PinGrid.test.tsx`
Expected: FAIL — `PinGrid` module doesn't exist yet.

- [ ] **Step 3: Implement `PinGrid`**

Create `apps/catalog/components/lists/PinGrid.tsx`:

```tsx
'use client';

import { useState, useRef, useEffect, useTransition } from 'react';
import { loadMorePinsAction } from '@/actions/lists';
import { PinCard } from '@/components/lists/PinCard';
import type { PublicPinRow, ListRow } from '@/lib/supabase/types';

export function PinGrid({
  initialPins,
  initialCursor,
  isLoggedIn,
  userLists,
}: {
  initialPins: PublicPinRow[];
  initialCursor: { addedAt: string; id: string } | null;
  isLoggedIn: boolean;
  userLists: ListRow[];
}) {
  const [pins, setPins] = useState(initialPins);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement>(null);

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const result = await loadMorePinsAction(cursor);
      setPins((prev) => [...prev, ...result.pins]);
      setCursor(result.nextCursor);
    });
  }

  // IntersectionObserver auto-loads on scroll; the manual button below stays
  // visible as a fallback for accessibility / no-JS-observer environments,
  // not hidden -- per the design spec's Page structure section.
  useEffect(() => {
    if (!cursor) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pins.map((pin) => (
          <PinCard key={pin.id} pin={pin} isLoggedIn={isLoggedIn} userLists={userLists} />
        ))}
      </div>
      {cursor ? (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run components/lists/__tests__/PinGrid.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/components/lists/PinGrid.tsx apps/catalog/components/lists/__tests__/PinGrid.test.tsx
git commit -m "feat(lists): add PinGrid infinite-scroll client component"
```

---

## Task 6: `/discover` page + nav link

**Files:**
- Create: `apps/catalog/app/discover/page.tsx`
- Modify: `apps/catalog/components/Header.tsx`

- [ ] **Step 1: Implement the page**

Create `apps/catalog/app/discover/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { getPublicPinsFeed, getUserLists } from '@/lib/lists';
import { PinGrid } from '@/components/lists/PinGrid';

export default async function DiscoverPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { pins, nextCursor } = await getPublicPinsFeed(supabase);
  const userLists = user ? await getUserLists(supabase, user.id) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Discover</h1>
      {pins.length === 0 ? (
        <p className="text-muted-foreground">No public pins yet.</p>
      ) : (
        <PinGrid initialPins={pins} initialCursor={nextCursor} isLoggedIn={!!user} userLists={userLists} />
      )}
    </div>
  );
}
```

This is a dynamic (per-request) server component by default in the App Router because it reads the request-scoped Supabase session — no `export const dynamic` override needed, but if a future change makes this page eligible for static optimization, revisit: a wrongly-cached `/discover` would show a stale feed to every visitor, not just the person who just saved (see spec's Rollout section).

- [ ] **Step 2: Add the nav link**

Read `apps/catalog/components/Header.tsx` first to find the existing nav link markup pattern (e.g. how `/collections` or another top-level route is linked), then add a `/discover` link alongside it using the same `<Link>` styling. Do not invent new nav styling — match whatever pattern is already there.

- [ ] **Step 3: Typecheck**

Run: `cd apps/catalog && npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Run full test suite**

Run: `cd apps/catalog && npm run test`
Expected: all tests pass, including the new ones from Tasks 2/4/5.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/app/discover/page.tsx apps/catalog/components/Header.tsx
git commit -m "feat(lists): add /discover page and nav link"
```

---

## Task 7: Verification (Rule 6/7/9 — required, not optional)

This task has no code changes of its own — it's the live-data and browser verification the spec's Testing section requires, and per this project's CLAUDE.md, no feature touching `list_items`/`lists` is "done" without it.

- [ ] **Step 1: Start the dev server**

Run: `cd apps/catalog && npm run dev`
Expected: server starts on port 3100.

- [ ] **Step 2: Verify private-list exclusion against the real database**

Before browser-testing, run a direct query to confirm the live query design actually excludes private lists (this is the exact thing that broke twice in spec review — verify it for real, don't assume the plan's code is correct just because it typechecks). Using the Supabase MCP `execute_sql` tool (or the Supabase dashboard SQL editor) against the `WNLQ9 PI DB` project:

```sql
-- Should return 0 rows: no private list's items should be selectable
-- through the anon-key path this feature uses.
select li.id, l.is_public
from list_items li
join lists l on l.id = li.list_id
where l.is_public = false
limit 5;
```
Then confirm that same `id` does NOT appear in `/discover`'s rendered output or in a manual call to `getPublicPinsFeed` against an anon-scoped client. If any private-list item is visible, STOP — this is the exact RLS/join failure mode the spec's three review rounds were trying to prevent; do not proceed to sign-off.

- [ ] **Step 3: Browser walkthrough — logged out**

Visit `http://localhost:3100/discover`:
- Confirm pins render (thumbnail, name, list name, owner attribution).
- Confirm prices render as ฿-tier icons (e.g. "฿฿฿"), not real numbers — click one to confirm the unlock modal opens (per the spec's Price display decision; this must NOT show raw prices to a not-yet-unlocked visitor).
- Click a pin's product image/name — confirm it navigates to `/product/[sku]`.
- Click a pin's list name — confirm it navigates to `/lists/[public_id]`.
- Click a pin's owner attribution — confirm it navigates to `/u/[username]`.
- Click a pin's save icon — confirm it redirects to `/login?next=/discover`.
- Scroll to the bottom (or click "Load more") — confirm a second page of pins appears with no duplicates and no gaps relative to the first page.

- [ ] **Step 4: Browser walkthrough — logged in**

Log in as a test account with at least one existing list:
- Revisit `/discover`, unlock prices via the passcode modal, confirm real prices now render.
- Click a pin's save icon — confirm it optimistically saves (matches `SaveToListButton`'s existing PDP/ProductCard behavior).
- Visit `/account/lists` — confirm the saved item now appears there.
- If you have 2+ lists, confirm the list-picker chevron on the feed's `SaveToListButton` works the same as it does elsewhere.

- [ ] **Step 5: Verify Rule 9 — this feature reads live Supabase directly, not the JSON export, for list/pin data**

Confirm this explicitly: `getPublicPinsFeed` and `getUserLists` query Supabase directly (not `data/live_products_export.json`), while `getProductBySku` (product name/price/image) reads the JSON export as usual. This is the same split every other lists page already has — no new export-refresh step is needed for this feature specifically, but note it here so a future debugging session isn't confused about which of the two data sources a `/discover` bug lives in.

- [ ] **Step 6: No commit for this task** — it's verification only. If any step fails, go back to the relevant task, fix, re-run that task's tests, then re-run this entire verification task from Step 1.

---

## Done

Once Task 7 passes in full, this feature is complete per the spec. Follow-on work (items 5 and 6 from the lists-v2 request list — the admin panel and 30-day soft-delete) are separate, unscoped features requiring their own brainstorming/spec/plan cycle — do not fold them into this branch.
