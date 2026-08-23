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

  // RLS on `lists` filters correctly for anonymous/other-user viewers (the
  // select policy only returns is_public=true rows to a non-owner). But if
  // the PROFILE OWNER is logged in and viewing their own /u/[username] page,
  // their session makes RLS return ALL their lists (owner_id = auth.uid()
  // matches). The filter below is the only thing preventing a private list
  // from leaking onto the owner's own public profile page in that case --
  // do not remove it as "redundant," it is load-bearing for that scenario.
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
