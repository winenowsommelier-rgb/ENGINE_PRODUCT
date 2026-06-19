'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Wine } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * StorefrontImage — the public, LIGHT-THEME product image.
 *
 * Bottle photos on th.wine-now.com sit on white/whitespace backgrounds, so we
 * use `object-contain` (NOT cover) to avoid cropping the bottle. The container
 * is `relative` with an aspect ratio so next/image `fill` has a box to fill.
 *
 * When `src` is missing (~110 of 11,436 products have no image) OR the image
 * fails to load, we render a calm Maison placeholder (light neutral box with a
 * muted Wine icon) — never a broken-image glyph.
 *
 * This is DELIBERATELY separate from the internal dark ProductImage component;
 * the public theme is near-white, so colours/placeholder differ.
 *
 * Client component: it owns onError state to swap to the placeholder.
 */

interface StorefrontImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  /** Passed through to next/image for responsive sizing hints. */
  sizes?: string;
  /** Eager-load + high priority (use for above-the-fold hero images). */
  priority?: boolean;
}

export function StorefrontImage({
  src,
  alt,
  className,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  priority = false,
}: StorefrontImageProps) {
  const [errored, setErrored] = useState(false);
  const showPlaceholder = !src || errored;

  return (
    <div
      className={cn(
        'relative aspect-[3/4] w-full overflow-hidden bg-white',
        className,
      )}
    >
      {showPlaceholder ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-secondary"
          role="img"
          aria-label={alt}
          data-testid="storefront-image-placeholder"
        >
          <Wine
            className="h-12 w-12 text-muted-foreground/50"
            aria-hidden="true"
          />
        </div>
      ) : (
        <Image
          src={src as string}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          onError={() => setErrored(true)}
          className="object-contain"
        />
      )}
    </div>
  );
}
