import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Requires a real (test) Supabase user's credentials to exercise the
// authenticated-write path. Set these in .env.local for local runs; CI
// should use a dedicated test account, never a real user's.
const TEST_EMAIL = process.env.TEST_SUPABASE_EMAIL;
const TEST_PASSWORD = process.env.TEST_SUPABASE_PASSWORD;

describe.skipIf(!TEST_EMAIL)('list RLS invariants', () => {
  let ownerClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;
  let privateListId: string;
  let publicListId: string;
  let privateListItemId: string;

  beforeAll(async () => {
    ownerClient = createClient(url, anonKey);
    anonClient = createClient(url, anonKey);

    await ownerClient.auth.signInWithPassword({ email: TEST_EMAIL!, password: TEST_PASSWORD! });

    const { data: pub } = await ownerClient
      .from('lists')
      .insert({ name: 'RLS test public list', is_public: true })
      .select()
      .single();
    publicListId = pub!.id;

    const { data: priv } = await ownerClient
      .from('lists')
      .insert({ name: 'RLS test private list', is_public: false })
      .select()
      .single();
    privateListId = priv!.id;

    // Seed a list_items row on the private list so we can independently
    // verify list_items_select_via_parent_list (a join-based EXISTS check
    // against the parent list's is_public/owner_id, not automatic
    // inheritance from the `lists` policy) actually denies anon reads too.
    const { data: item } = await ownerClient
      .from('list_items')
      .insert({ list_id: privateListId, sku: 'RLS-TEST-SKU', quantity: 1 })
      .select()
      .single();
    privateListItemId = item!.id;
  });

  afterAll(async () => {
    await ownerClient.from('list_items').delete().eq('id', privateListItemId);
    await ownerClient.from('lists').delete().eq('id', publicListId);
    await ownerClient.from('lists').delete().eq('id', privateListId);
  });

  it('anonymous read of a public list succeeds', async () => {
    const { data, error } = await anonClient.from('lists').select().eq('id', publicListId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(publicListId);
  });

  it('anonymous read of a private list returns nothing (not an error, just filtered)', async () => {
    const { data } = await anonClient.from('lists').select().eq('id', privateListId).maybeSingle();
    expect(data).toBeNull();
  });

  it('anonymous write to any list is rejected', async () => {
    const { error } = await anonClient.from('lists').update({ name: 'hacked' }).eq('id', publicListId);
    // RLS silently filters to zero affected rows rather than throwing in
    // some Postgres/PostgREST configurations -- assert no actual mutation
    // happened rather than asserting on `error` alone.
    const { data: check } = await ownerClient.from('lists').select('name').eq('id', publicListId).single();
    expect(check?.name).not.toBe('hacked');
  });

  it('anonymous read of a list_item belonging to a private list returns nothing', async () => {
    // list_items_select_via_parent_list is a separate, independent policy
    // (a join-based EXISTS check against the parent list's
    // is_public/owner_id) -- it does not automatically inherit from the
    // `lists` select policy tested above, so it needs its own coverage.
    const { data } = await anonClient
      .from('list_items')
      .select()
      .eq('id', privateListItemId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});
