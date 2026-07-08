import Link from 'next/link';
import Image from 'next/image';
import type { PublicProduct } from '@/lib/types';

interface RelatedProductsProps {
  tags: Array<{ name: string; slug: string }>;
  allProducts: PublicProduct[];
}

export function RelatedProducts({ tags, allProducts }: RelatedProductsProps) {
  if (tags.length === 0) return null;

  const tagSlugs = tags.map((t) => t.slug.toLowerCase());
  const tagNames = tags.map((t) => t.name.toLowerCase());

  const related = allProducts
    .filter((p) => {
      // is_in_stock is a boolean (per types.ts line 85)
      if (!p.is_in_stock) return false;

      const regionSlug = (p.region ?? '').toLowerCase().replace(/\s+/g, '-');
      const name = p.name.toLowerCase();
      const catGroup = (p.category_group ?? '').toLowerCase();

      return (
        // Match by region slug
        tagSlugs.some((s) => regionSlug.includes(s) || s.includes(regionSlug.replace(/-/g, ' '))) ||
        // Match by product name
        tagNames.some((n) => name.includes(n)) ||
        // Match by category_group
        tagSlugs.some((s) => catGroup.includes(s))
      );
    })
    .slice(0, 4);

  if (related.length === 0) return null;

  return (
    <section className="mt-14 border-t border-stone-200 pt-10">
      <h2 className="mb-7 text-xl font-semibold text-stone-900">You might also like</h2>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        {related.map((product) => (
          <Link
            key={product.sku}
            href={`/product/${product.sku}`}
            className="group flex flex-col rounded-xl border border-stone-200 bg-white overflow-hidden hover:border-stone-400 transition-colors"
          >
            {/* Fixed image area — consistent height across all cards */}
            <div className="relative h-56 w-full shrink-0">
              {product.image_url ? (
                <Image
                  src={product.image_url}
                  alt={product.name}
                  fill
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="h-full w-full bg-white" />
              )}
            </div>
            {/* Text area — fixed height so all cards align */}
            <div className="flex flex-col gap-1.5 border-t border-stone-100 p-3 h-20 justify-between">
              <p className="text-sm font-semibold leading-snug line-clamp-2 text-stone-800">{product.name}</p>
              {product.price != null && (
                <p className="text-sm font-medium text-stone-500">฿{product.price.toLocaleString()}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
