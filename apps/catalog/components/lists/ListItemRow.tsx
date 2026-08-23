'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { setItemQuantityAction, removeItemAction } from '@/actions/lists';
import { PriceDisplay } from '@/components/PriceDisplay';
import { resolveSale } from '@/lib/price-tiers';
import type { PublicProduct } from '@/lib/types';

export function ListItemRow({
  listId,
  sku,
  quantity,
  product,
  isOwner,
}: {
  listId: string;
  sku: string;
  quantity: number;
  product: PublicProduct | null;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!product) {
    return (
      <div className="flex items-center justify-between border-b border-border py-3 text-sm text-muted-foreground">
        <span>{sku} — no longer available</span>
        {isOwner ? (
          <button onClick={() => startTransition(() => removeItemAction(listId, sku))} aria-label="Remove">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <Link href={`/product/${product.sku}`} className="flex-1 text-sm font-medium hover:underline">
        {product.name}
      </Link>
      {isOwner ? (
        <input
          type="number"
          min={1}
          defaultValue={quantity}
          disabled={pending}
          onBlur={(e) => {
            const qty = parseInt(e.target.value, 10);
            if (!Number.isNaN(qty)) startTransition(() => setItemQuantityAction(listId, sku, qty));
          }}
          className="w-14 rounded border border-border px-2 py-1 text-center text-sm"
        />
      ) : (
        <span className="text-sm text-muted-foreground">×{quantity}</span>
      )}
      <span className="w-20 text-right text-sm tabular-nums">
        {/* Respects sale pricing the same way ProductCard/PDP do -- a
            discounted SKU must show its special_price here too, not just
            on the grid/detail pages, or the list total (computed in the
            page below) would silently disagree with what's displayed. */}
        <PriceDisplay price={resolveSale(product.price, product.special_price)?.special ?? product.price} />
      </span>
      {isOwner ? (
        <button
          onClick={() => startTransition(() => removeItemAction(listId, sku))}
          disabled={pending}
          aria-label={`Remove ${product.name}`}
        >
          <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </button>
      ) : null}
    </div>
  );
}
