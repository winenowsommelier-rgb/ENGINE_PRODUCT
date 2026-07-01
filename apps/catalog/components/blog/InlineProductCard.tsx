import Image from 'next/image';
import Link from 'next/link';
import type { PublicProduct } from '@/lib/types';

export function InlineProductCard({ product }: { product: PublicProduct }) {
  const price = product.price ? `฿${product.price.toLocaleString()}` : null;

  return (
    <aside className="my-4 flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-3 not-prose">
      {product.image_url && (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-0.5">
        <Link href={`/product/${product.sku}`} className="text-sm font-semibold text-foreground hover:text-primary">
          {product.name}
        </Link>
        {price && <span className="text-sm text-muted-foreground">{price}</span>}
      </div>
      <Link
        href="/contact"
        className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Order
      </Link>
    </aside>
  );
}
