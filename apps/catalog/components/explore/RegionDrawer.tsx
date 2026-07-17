'use client';
import Link from 'next/link';
import { StorefrontImage } from '@/components/StorefrontImage';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount, shopHref } from '@/lib/explore/map-data';

function priceLabel(min: number | null, max: number | null): string {
  if (min === null || max === null) return '';
  const f = (n: number) => `฿${n.toLocaleString()}`;
  return min === max ? f(min) : `${f(min)}–${f(max)}`;
}

/**
 * RegionDrawer — the region detail surface, shown OVER the map so map context is
 * never lost: a bottom sheet on mobile, a right-side panel on desktop (absolute
 * inside the map container, which is position:relative).
 */
export function RegionDrawer({ region, lens, onClose }: {
  region: MapRegion; lens: LensKey; onClose: () => void;
}) {
  const count = lensCount(region, lens);
  return (
    <>
      {/* Mobile backdrop — tap to dismiss. Desktop keeps the map interactive. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/25 md:hidden"
      />
      <aside
        aria-label={`${region.name} details`}
        className={[
          'z-50 flex flex-col overflow-hidden bg-card',
          // Mobile: fixed bottom sheet.
          'fixed inset-x-0 bottom-0 max-h-[72vh] rounded-t-3xl border-t border-border shadow-[0_-12px_40px_-12px_rgba(60,30,20,0.35)]',
          // Desktop: side panel pinned inside the (relative) map container.
          'md:absolute md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:z-30 md:max-h-none md:w-[24rem] md:rounded-2xl md:border md:shadow-xl',
        ].join(' ')}
      >
        {/* Drag-handle affordance (mobile only, visual). */}
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5 pb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Region · {region.country}</div>
            <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{region.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {count.toLocaleString()} {count === 1 ? 'bottle' : 'bottles'}
              {priceLabel(region.priceRange.min, region.priceRange.max) && ` · ${priceLabel(region.priceRange.min, region.priceRange.max)}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Body — scrolls inside the sheet/panel; the map stays put behind it. */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          {region.description && (
            <p className="text-sm leading-relaxed text-foreground sm:text-base">{region.description}</p>
          )}

          {region.peeks.length > 0 && (
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">A few to explore</h3>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-6">
                {region.peeks.map((p) => (
                  <li key={p.sku}>
                    <Link
                      href={`/product/${p.sku}`}
                      aria-label={p.name}
                      className="group block focus:outline-none"
                    >
                      <div className="overflow-hidden rounded-xl border border-border/60 bg-white p-3 shadow-sm transition-shadow duration-300 group-hover:shadow-md">
                        <StorefrontImage
                          src={p.image_url}
                          alt={p.name}
                          className="aspect-[3/4] transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                        />
                      </div>
                      <span className="mt-2.5 block text-sm font-medium leading-snug tracking-tight text-foreground line-clamp-2 group-hover:text-primary">
                        {p.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {region.subregions && region.subregions.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subregions</h3>
              <ul className="flex flex-col gap-2">
                {region.subregions.map((s) => (
                  <li key={s.name} className="text-sm">
                    <span className="font-medium text-foreground">{s.name}</span>
                    {s.description && (
                      <span className="text-muted-foreground"> — {s.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer CTA — always visible at the sheet/panel foot. */}
        <div className="border-t border-border p-5 pt-4">
          <Link href={shopHref(region, lens)}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90">
            View all {count.toLocaleString()} →
          </Link>
        </div>
      </aside>
    </>
  );
}
