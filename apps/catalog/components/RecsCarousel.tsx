'use client';

// RSC BOUNDARY: page.tsx is a Server Component and this is a Client Component —
// props must be SERIALIZABLE. A `getContactLinks` function prop would throw
// "Functions cannot be passed directly to Client Components" at build/render.
// So contact links are precomputed per item on the server and passed as data.

import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';
import type { Band } from '@/lib/types';
import type { ContactLinks } from '@/lib/contact';
import type { ListRow } from '@/lib/supabase/types';
import { resolveSale } from '@/lib/price-tiers';

interface RecItem {
  product: PublicProduct;
  band: Band;
  contactLinks: ContactLinks;
  /** Server-computed via lib/taste-adapter.ts:toStructural(product) — see ProductCard. */
  structural?: Record<string, string>;
}

interface RecsCarouselProps {
  items: RecItem[];
  /**
   * Page-level auth state, resolved once server-side by the caller and
   * threaded down to every ProductCard in the rail -- ListRow is a plain
   * data type (not a function), so it's safe to pass across the RSC
   * boundary. Defaults keep this component safe if a caller omits them.
   */
  isLoggedIn?: boolean;
  userLists?: ListRow[];
}

const BAND_LABEL: Record<Band, string | null> = {
  'similar': 'Similar style',
  'step-up': 'Step up ↑',
  'great-alternative': 'Great alternative',
};

/**
 * The price a shopper actually SEES on the card: special_price when a genuine
 * sale is active (same resolveSale check ProductCard itself uses for its
 * strikethrough price), else the regular price. Sorting on product.price
 * alone would order by the regular price while the card visibly shows the
 * discounted one — e.g. a ฿4,500 item on sale for ฿3,200 must sort next to
 * other ~฿3,200 items, not next to ฿4,500 ones.
 */
function displayPrice(p: PublicProduct): number | undefined {
  const sale = resolveSale(p.price, p.special_price);
  return sale ? sale.special : (p.price ?? undefined);
}

/**
 * Display order is price ascending, left to right — separate from SELECTION,
 * which stays governed by getRecommendationsWithBands' similar/step-up slot
 * preference (that logic decides WHICH 8 products qualify; this only decides
 * the order they're laid out in once chosen). Items with no price (rare —
 * PublicProduct.price is optional) sort last so a missing price can't land an
 * item out of place in the low-to-high scan.
 */
function byPriceAscending(items: RecItem[]): RecItem[] {
  return [...items].sort((a, b) => {
    const pa = displayPrice(a.product), pb = displayPrice(b.product);
    if (typeof pa !== 'number' && typeof pb !== 'number') return 0;
    if (typeof pa !== 'number') return 1;
    if (typeof pb !== 'number') return -1;
    return pa - pb;
  });
}

export function RecsCarousel({ items, isLoggedIn = false, userLists = [] }: RecsCarouselProps) {
  if (items.length === 0) return null;
  const ordered = byPriceAscending(items);
  return (
    <div
      className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: 'none' }}
    >
      {ordered.map(({ product, band, contactLinks, structural }) => {
        const label = BAND_LABEL[band];
        return (
          <div
            key={product.sku}
            className="snap-start shrink-0 w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]"
          >
            <ProductCard
              product={product}
              contactLinks={contactLinks}
              showDetails
              structural={structural}
              bandLabel={label ?? undefined}
              isLoggedIn={isLoggedIn}
              userLists={userLists}
            />
          </div>
        );
      })}
    </div>
  );
}
