import Link from 'next/link';
import { StorefrontImage } from '@/components/StorefrontImage';
import { ReputationBadge } from '@/components/product/ReputationBadge';
import { formatPrice, resolveSale } from '@/lib/price-tiers';
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
      // Accessories (stoppers, glassware, etc.) can name-match drink keywords
      // ("Sparkling Wine Stopper") without being a drink themselves — exclude.
      if (p.category_group === 'Accessories') return false;

      const regionSlug = (p.region ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      const name = p.name.toLowerCase();
      const catGroup = (p.category_group ?? '').toLowerCase();
      const catType = (p.category_type ?? '').toLowerCase();

      return (
        // Match by region slug — guarded against empty region, which would
        // otherwise vacuously match every tag via ''.includes('').
        (regionSlug.length > 0 &&
          tagSlugs.some((s) => regionSlug.includes(s) || s.includes(regionSlug.replace(/-/g, ' ')))) ||
        // Match by product name
        tagNames.some((n) => name.includes(n)) ||
        // Match by category_group / category_type (canonical taxonomy, not raw classification)
        tagSlugs.some((s) => (catGroup.length > 0 && catGroup.includes(s)) || (catType.length > 0 && catType.includes(s)))
      );
    })
    .slice(0, 4);

  if (related.length === 0) return null;

  return (
    <section className="mt-14 border-t border-stone-200 pt-10">
      <h2 className="mb-7 text-xl font-semibold text-stone-900">You might also like</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
        {related.map((product) => {
          const sale = resolveSale(product.price, product.special_price);

          return (
            <Link
              key={product.sku}
              href={`/product/${product.sku}`}
              className="group flex flex-col rounded-xl border border-stone-200 bg-white overflow-hidden transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative">
                <StorefrontImage
                  src={product.image_url}
                  alt={product.name}
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="transition-transform duration-300 group-hover:scale-105"
                />
                <ReputationBadge tier={product.reputation_tier} className="absolute bottom-2 left-2" />
              </div>

              {/* Text area — name wraps to 2 lines instead of truncating */}
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="text-sm font-semibold leading-snug text-stone-800 line-clamp-2 min-h-[2.5em]">
                  {product.name}
                </p>
                {sale ? (
                  <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-sm font-semibold text-primary tabular-nums">
                      {formatPrice(sale.special)}
                    </span>
                    <span className="text-xs text-stone-400 line-through tabular-nums">
                      {formatPrice(product.price)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-auto text-sm font-medium text-stone-500 tabular-nums">
                    {formatPrice(product.price)}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
