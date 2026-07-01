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
    <section className="mt-12 border-t pt-8">
      <h2 className="mb-6 text-xl font-semibold">You might also like</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {related.map((product) => (
          <Link
            key={product.sku}
            href={`/product/${product.sku}`}
            className="group flex flex-col gap-2"
          >
            <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
              {product.image_url ? (
                <Image
                  src={product.image_url}
                  alt={product.name}
                  fill
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="h-full w-full bg-muted" />
              )}
            </div>
            <p className="text-sm font-medium leading-snug line-clamp-2">{product.name}</p>
            {product.price != null && (
              <p className="text-sm text-muted-foreground">฿{product.price.toLocaleString()}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
