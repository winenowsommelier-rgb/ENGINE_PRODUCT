'use client';

// RSC BOUNDARY: page.tsx is a Server Component and this is a Client Component —
// props must be SERIALIZABLE. A `getContactLinks` function prop would throw
// "Functions cannot be passed directly to Client Components" at build/render.
// So contact links are precomputed per item on the server and passed as data.

import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';
import type { Band } from '@/lib/types';
import type { ContactLinks } from '@/lib/contact';

interface RecItem {
  product: PublicProduct;
  band: Band;
  contactLinks: ContactLinks;
  /** Server-computed via lib/taste-adapter.ts:toStructural(product) — see ProductCard. */
  structural?: Record<string, string>;
}

interface RecsCarouselProps {
  items: RecItem[];
}

const BAND_LABEL: Record<Band, string | null> = {
  'similar': 'Similar style',
  'step-up': 'Step up ↑',
  'great-alternative': 'Great alternative',
};

export function RecsCarousel({ items }: RecsCarouselProps) {
  if (items.length === 0) return null;
  return (
    <div
      className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: 'none' }}
    >
      {items.map(({ product, band, contactLinks, structural }) => {
        const label = BAND_LABEL[band];
        return (
          <div
            key={product.sku}
            className="snap-start shrink-0 w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]"
          >
            {label ? (
              <span className="mb-2 inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {label}
              </span>
            ) : null}
            <ProductCard
              product={product}
              contactLinks={contactLinks}
              showDetails
              structural={structural}
            />
          </div>
        );
      })}
    </div>
  );
}
