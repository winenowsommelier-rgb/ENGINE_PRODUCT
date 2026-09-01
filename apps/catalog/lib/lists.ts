import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListRow, ListItemRow, PublicPinRow } from '@/lib/supabase/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Strictly anchored ISO-8601 timestamp (e.g. 2026-09-01T12:00:00.000Z).
// Deliberately NOT `Date.parse`: Date.parse is far more permissive than ISO
// and accepts loosely-structured date strings that can themselves carry
// comma/paren filter syntax (e.g. 'Wed,or(x.eq.1) 01 Sep 2026' parses to a
// valid timestamp under Date.parse), which would defeat the exact
// filter-injection protection this function exists to provide. This regex
// cannot itself contain the characters PostgREST's `or=` grammar treats as
// syntax, so nothing that matches it can carry an injected filter.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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
  return ISO_TIMESTAMP_RE.test(cursor.addedAt) && UUID_RE.test(cursor.id);
}

export function defaultListName(username: string): string {
  return `${username}'s list`;
}

/**
 * The user's most-recently-used list, or null if they have none yet.
 *
 * IMPORTANT: "most-recently-used" means most recently ADDED TO, not most
 * recently created or renamed. `lists.updated_at` is only bumped by the
 * `lists_set_updated_at` trigger, which fires on UPDATE of the `lists` row
 * itself (rename/visibility toggle) -- it does NOT fire when a `list_items`
 * row is inserted/updated/deleted, because that's a different table. Relying
 * on `lists.updated_at` alone would silently resolve to whatever list was
 * last renamed/toggled, not the list the user is actually pinning into.
 *
 * Fix: `upsertListItem` (below) explicitly bumps the parent list's
 * `updated_at` after every write, so ordering by `lists.updated_at` here is
 * correct AS LONG AS every list_items mutation goes through upsertListItem
 * (or otherwise re-touches the parent list). Do not add a new list_items
 * write path without this.
 */
export async function getMostRecentList(
  client: SupabaseClient,
  ownerId: string,
): Promise<ListRow | null> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as ListRow | null;
}

export async function getOrCreateDefaultList(
  client: SupabaseClient,
  ownerId: string,
  username: string,
): Promise<ListRow> {
  const existing = await getMostRecentList(client, ownerId);
  if (existing) return existing;

  const { data, error } = await client
    .from('lists')
    .insert({ owner_id: ownerId, name: defaultListName(username) })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to create default list');
  return data as ListRow;
}

export async function getListByPublicId(
  client: SupabaseClient,
  publicId: string,
): Promise<ListRow | null> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('public_id', publicId)
    .maybeSingle();

  return data as ListRow | null;
}

export async function getListItems(
  client: SupabaseClient,
  listId: string,
): Promise<ListItemRow[]> {
  const { data } = await client
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('added_at', { ascending: true });

  return (data as ListItemRow[]) ?? [];
}

export async function getUserLists(
  client: SupabaseClient,
  ownerId: string,
): Promise<ListRow[]> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  return (data as ListRow[]) ?? [];
}

/**
 * Upserts (list_id, sku): adds if absent, else bumps quantity by 1.
 *
 * Also touches the parent list's `updated_at` explicitly -- the
 * `lists_set_updated_at` trigger only fires on UPDATE of the `lists` table
 * itself, never on writes to the child `list_items` table, so without this
 * explicit touch `getMostRecentList`'s ordering would silently go stale the
 * moment a user pins into an existing (not just-renamed) list. Any future
 * list_items write path (bulk import, admin tooling, etc.) must do the same
 * touch or "most recently used" resolution breaks again.
 *
 * Every write below checks `error` and throws rather than swallowing it.
 * This isn't just style: the read-then-write here is two round trips, not
 * atomic, so two near-simultaneous calls for the same (list_id, sku) can
 * both read "no existing row" and both attempt an insert -- the
 * `unique(list_id, sku)` constraint is the intended backstop that makes the
 * race loser's insert fail rather than double-insert. Before this fix that
 * failure was silently discarded, so the loser's caller (and any caller hit
 * by an RLS denial or transient DB error) would proceed as if the item had
 * been saved when it hadn't -- exactly the "optimistic UI says saved, DB
 * write actually failed" gap CLAUDE.md Rule 2 warns about. Throwing here
 * makes that failure visible to the caller instead.
 */
export async function upsertListItem(
  client: SupabaseClient,
  listId: string,
  sku: string,
): Promise<void> {
  const { data: existing } = await client
    .from('list_items')
    .select('quantity')
    .eq('list_id', listId)
    .eq('sku', sku)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from('list_items')
      .update({ quantity: existing.quantity + 1 })
      .eq('list_id', listId)
      .eq('sku', sku);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client.from('list_items').insert({ list_id: listId, sku, quantity: 1 });
    if (error) throw new Error(error.message);
  }

  const { error: touchError } = await client
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', listId);
  if (touchError) throw new Error(touchError.message);
}

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

  type RawRow = {
    id: string;
    sku: string;
    quantity: number;
    added_at: string;
    lists: { public_id: string; name: string; owner_id: string; is_public: boolean };
  };

  // list_items -> lists is many-to-one (a list_items row has exactly one
  // parent list via list_id), so PostgREST embeds it as a singular object,
  // not an array -- but this codebase has no generated Supabase types and
  // no prior usage of !inner anywhere to confirm that against, so the cast
  // below is paired with a runtime shape check rather than trusted blindly.
  // A wrong assumption here would otherwise silently null every pin's owner
  // (row.lists.owner_id reading as undefined off an array) with no type
  // error to catch it -- exactly the kind of silent-failure risk this
  // feature's spec review process was built to catch. Fail loudly instead.
  const rawRows = (data ?? []) as unknown[];
  const rows: RawRow[] = rawRows.map((r) => {
    const row = r as { id: string; sku: string; quantity: number; added_at: string; lists: unknown };
    if (Array.isArray(row.lists)) {
      throw new Error(
        'getPublicPinsFeed: expected lists!inner embed as a singular object, got an array -- ' +
          'PostgREST embed shape assumption was wrong, fix the RawRow type and mapping below',
      );
    }
    return row as RawRow;
  });

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
