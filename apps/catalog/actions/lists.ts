'use server';

import { createClient } from '@/lib/supabase/server';
import { getOrCreateDefaultList, upsertListItem } from '@/lib/lists';
import { revalidatePath } from 'next/cache';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  return { supabase, user };
}

/**
 * Every mutation below relies on RLS (owner_id = auth.uid()) to reject
 * writes against a list_id the caller doesn't own -- verified safe because
 * lib/supabase/server.ts's client always uses the anon key, never the
 * service role key, so RLS is genuinely enforced per-request. But Supabase
 * does NOT raise an error when an UPDATE/DELETE matches zero rows under
 * RLS -- it just silently affects nothing. Without this helper, a stale or
 * tampered listId would produce no error and no effect, and the caller
 * (and revalidatePath) would proceed as if it had succeeded. This helper
 * makes that failure visible instead of silent, by checking the mutation
 * actually touched a row.
 */
async function assertRowAffected<T>(
  result: { data: T[] | T | null; error: { message: string } | null; count?: number | null },
  actionDescription: string,
) {
  if (result.error) throw new Error(result.error.message);
  const affected = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
  if (affected === 0) {
    throw new Error(`${actionDescription} affected no rows -- list not found or not owned by you.`);
  }
}

export async function pinToDefaultListAction(sku: string) {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single();

  const list = await getOrCreateDefaultList(supabase, user.id, profile?.username ?? 'my');
  await upsertListItem(supabase, list.id, sku);

  revalidatePath('/account/lists');
  return { listId: list.id, listPublicId: list.public_id };
}

export async function createListAction(name: string) {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from('lists')
    .insert({ owner_id: user.id, name })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  revalidatePath('/account/lists');
  return data;
}

export async function addItemToListAction(listId: string, sku: string) {
  const { supabase } = await requireUser();
  await upsertListItem(supabase, listId, sku);
  revalidatePath('/account/lists');
}

export async function setItemQuantityAction(listId: string, sku: string, quantity: number) {
  const { supabase } = await requireUser();
  if (quantity <= 0) {
    const result = await supabase.from('list_items').delete().eq('list_id', listId).eq('sku', sku).select();
    await assertRowAffected(result, 'Remove item');
  } else {
    const result = await supabase
      .from('list_items')
      .update({ quantity })
      .eq('list_id', listId)
      .eq('sku', sku)
      .select();
    await assertRowAffected(result, 'Update item quantity');
  }
  // Bump parent list's updated_at -- see upsertListItem's comment; this
  // write path bypasses upsertListItem so it must do the same touch itself.
  await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', listId);
  revalidatePath('/account/lists');
}

export async function removeItemAction(listId: string, sku: string) {
  const { supabase } = await requireUser();
  const result = await supabase.from('list_items').delete().eq('list_id', listId).eq('sku', sku).select();
  await assertRowAffected(result, 'Remove item');
  // Same updated_at touch as setItemQuantityAction's zero-quantity branch --
  // removing a row via this button and removing it by stepping quantity to
  // 0 are the same underlying mutation from the user's point of view, and
  // must agree on whether it counts as "using" the list.
  await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', listId);
  revalidatePath('/account/lists');
}

export async function toggleListVisibilityAction(listId: string, isPublic: boolean) {
  const { supabase } = await requireUser();
  const result = await supabase.from('lists').update({ is_public: isPublic }).eq('id', listId).select();
  await assertRowAffected(result, 'Toggle list visibility');
  revalidatePath('/account/lists');
}

export async function renameListAction(listId: string, name: string) {
  const { supabase } = await requireUser();
  const result = await supabase.from('lists').update({ name }).eq('id', listId).select();
  await assertRowAffected(result, 'Rename list');
  revalidatePath('/account/lists');
}

export async function deleteListAction(listId: string) {
  const { supabase } = await requireUser();
  // No confirm step, hard delete, per spec's "easy like a cart" decision.
  const result = await supabase.from('lists').delete().eq('id', listId).select();
  await assertRowAffected(result, 'Delete list');
  revalidatePath('/account/lists');
}
