import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserLists, getListItems } from '@/lib/lists';
import { getProductBySku } from '@/lib/catalog-data';
import { ListCard, MAX_PREVIEW_THUMBNAILS } from '@/components/lists/ListCard';
import { NewListForm } from '@/components/lists/NewListForm';

// Look up a few more than we display: some early items may have no
// resolvable image (deleted/discontinued SKU, filtered out by ListCard), so
// scanning only exactly MAX_PREVIEW_THUMBNAILS items could under-fill an
// otherwise-photogenic list. This still caps the per-list lookup instead of
// mapping every item just to show at most 4.
const PREVIEW_LOOKUP_SLICE = MAX_PREVIEW_THUMBNAILS * 3;

export default async function AccountListsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/lists');

  const lists = await getUserLists(supabase, user.id);
  const listsWithCounts = await Promise.all(
    lists.map(async (list) => {
      const items = await getListItems(supabase, list.id);
      return {
        list,
        itemCount: items.length,
        previewImages: items
          .slice(0, PREVIEW_LOOKUP_SLICE)
          .map((item) => getProductBySku(item.sku)?.image_url),
      };
    }),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Your lists</h1>
      <div className="mb-8">
        <NewListForm />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {listsWithCounts.map(({ list, itemCount, previewImages }) => (
          <ListCard key={list.id} list={list} itemCount={itemCount} previewImages={previewImages} />
        ))}
      </div>
      {listsWithCounts.length === 0 ? (
        <p className="text-muted-foreground">No lists yet — save a product to get started.</p>
      ) : null}
    </div>
  );
}
