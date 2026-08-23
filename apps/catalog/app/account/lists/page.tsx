import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserLists, getListItems } from '@/lib/lists';
import { ListCard } from '@/components/lists/ListCard';
import { NewListForm } from '@/components/lists/NewListForm';

export default async function AccountListsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/lists');

  const lists = await getUserLists(supabase, user.id);
  const listsWithCounts = await Promise.all(
    lists.map(async (list) => ({
      list,
      itemCount: (await getListItems(supabase, list.id)).length,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Your lists</h1>
      <div className="mb-8">
        <NewListForm />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {listsWithCounts.map(({ list, itemCount }) => (
          <ListCard key={list.id} list={list} itemCount={itemCount} />
        ))}
      </div>
      {listsWithCounts.length === 0 ? (
        <p className="text-muted-foreground">No lists yet — save a product to get started.</p>
      ) : null}
    </div>
  );
}
