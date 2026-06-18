import { getAllProducts } from '@/lib/catalog-data';
import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';

/**
 * TEMPORARY scratch route for Task 8 visual review — /preview-task8.
 * (NOTE: an `app/_preview` folder would be IGNORED by Next.js App Router —
 * leading-underscore folders are private and never become routes — so this
 * lives at a routable path instead.)
 *
 * Renders a small grid of REAL products through ProductCard so a reviewer can
 * screenshot the Maison card + StorefrontImage + QuickView. NOT linked from
 * navigation; safe to delete after review.
 *
 * Picks: a few in-stock products WITH images, one WITHOUT an image (placeholder
 * path), and one forced out-of-stock (the live export currently has no genuine
 * out-of-stock row, so we override is_in_stock on a real product to exercise the
 * badge — see the data concern in the Task 8 report).
 */
export const dynamic = 'force-static';

export default function PreviewPage() {
  const all = getAllProducts();

  const withImages = all.filter((p) => p.image_url).slice(0, 4);
  const noImage = all.find((p) => !p.image_url);
  const baseForOos = all.find((p) => p.image_url);

  const products: PublicProduct[] = [...withImages];
  if (noImage) products.push(noImage);
  if (baseForOos) {
    products.push({
      ...baseForOos,
      sku: `${baseForOos.sku}-OOS-PREVIEW`,
      is_in_stock: '0' as unknown as boolean, // real export shape
    });
  }

  return (
    <main className="container py-10">
      <h1 className="mb-6 text-2xl font-semibold">Task 8 — ProductCard preview</h1>
      <p className="mb-8 text-muted-foreground">
        {products.length} sample products. Hover (desktop) or tap the eye button
        to open Quick View. The last two tiles exercise the no-image placeholder
        and the out-of-stock badge.
      </p>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.sku} product={p} />
        ))}
      </div>
    </main>
  );
}
