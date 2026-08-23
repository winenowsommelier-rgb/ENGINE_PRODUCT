import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getListByPublicId, getListItems } from '@/lib/lists';
import { getProductBySku } from '@/lib/catalog-data';
import { ListItemRow } from '@/components/lists/ListItemRow';
import { DeleteListButton } from '@/components/lists/DeleteListButton';
import { ToggleVisibilityButton } from '@/components/lists/ToggleVisibilityButton';
import { ListTotal } from '@/components/lists/ListTotal';
import { resolveSale } from '@/lib/price-tiers';

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ public_id: string }>;
}) {
  const { public_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const list = await getListByPublicId(supabase, public_id);
  // RLS already hides private lists from non-owners at the query layer above
  // (getListByPublicId uses the request-scoped client) -- a null here means
  // either "doesn't exist" or "exists but not visible to you," and both
  // cases render the same 404, which is the correct behavior (no leaking
  // "this list exists but is private" via a different error state).
  if (!list) notFound();

  const isOwner = user?.id === list.owner_id;
  const items = await getListItems(supabase, list.id);

  const itemsWithProducts = items.map((item) => ({
    ...item,
    product: getProductBySku(item.sku) ?? null,
  }));

  // Rule 6 invariant: every list_items row either renders with product data
  // or explicitly as "no longer available" (handled inside ListItemRow) --
  // never silently dropped.
  //
  // Uses resolveSale's special price when on sale, matching ListItemRow's
  // per-row display (Task 7) -- the total must never disagree with the sum
  // of what's actually shown on each row above it.
  const total = itemsWithProducts.reduce((sum, i) => {
    if (!i.product) return sum;
    const unitPrice = resolveSale(i.product.price, i.product.special_price)?.special ?? i.product.price ?? 0;
    return sum + unitPrice * i.quantity;
  }, 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{list.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{list.public_id}</p>
        </div>
        {isOwner ? (
          <div className="flex items-center gap-3">
            <ToggleVisibilityButton listId={list.id} isPublic={list.is_public} />
            <DeleteListButton listId={list.id} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col">
        {itemsWithProducts.map((item) => (
          <ListItemRow
            key={item.id}
            listId={list.id}
            sku={item.sku}
            quantity={item.quantity}
            product={item.product}
            isOwner={isOwner}
          />
        ))}
      </div>

      {itemsWithProducts.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">This list is empty.</p>
      ) : (
        <div className="mt-4 flex justify-between border-t border-border pt-4 font-medium">
          <span>Estimated total</span>
          <ListTotal total={total} />
        </div>
      )}
    </div>
  );
}
