import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserLists, getListItems } from '@/lib/lists';
import { ListCard } from '@/components/lists/ListCard';

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (!profile) notFound();

  // is_public filter happens via RLS automatically (anon/other-user select
  // policy on `lists` only returns is_public=true rows for a non-owner) --
  // no need to filter client-side.
  const lists = await getUserLists(supabase, profile.id);
  const publicLists = lists.filter((l) => l.is_public);

  const listsWithCounts = await Promise.all(
    publicLists.map(async (list) => ({
      list,
      itemCount: (await getListItems(supabase, list.id)).length,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-6 flex items-center gap-4">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt={profile.username} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-medium">
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="text-2xl font-semibold">{profile.username}</h1>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {listsWithCounts.map(({ list, itemCount }) => (
          <ListCard key={list.id} list={list} itemCount={itemCount} />
        ))}
      </div>
      {listsWithCounts.length === 0 ? (
        <p className="text-muted-foreground">No public lists yet.</p>
      ) : null}
    </div>
  );
}
