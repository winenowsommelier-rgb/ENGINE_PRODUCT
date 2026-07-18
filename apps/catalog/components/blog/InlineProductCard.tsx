import Image from 'next/image';
import Link from 'next/link';
import type { PublicProduct } from '@/lib/types';

export function InlineProductCard({ product }: { product: PublicProduct }) {
  const price = product.price ? `฿${product.price.toLocaleString()}` : null;

  return (
    <aside className="my-6 flex items-center gap-5 rounded-2xl border border-stone-100 bg-stone-50/60 p-4 not-prose">
      {product.image_url ? (
        <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-stone-100 to-stone-50">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="80px"
            className="object-contain mix-blend-multiply"
          />
        </div>
      ) : (
        <div className="h-24 w-20 shrink-0 rounded-xl bg-stone-100" />
      )}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <Link
          href={`/product/${product.sku}`}
          className="text-base font-semibold leading-snug text-stone-900 hover:text-primary line-clamp-2"
        >
          {product.name}
        </Link>
        {price && <span className="text-sm font-medium text-stone-500">{price}</span>}
      </div>
      <Link
        href={`/product/${product.sku}`}
        className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors min-w-[72px] text-center"
      >
        Explore
      </Link>
    </aside>
  );
}
