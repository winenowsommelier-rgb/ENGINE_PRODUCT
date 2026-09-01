import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListRow, ListItemRow, PublicPinRow } from '@/lib/supabase/types';

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
