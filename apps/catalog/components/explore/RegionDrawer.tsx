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

export function RegionDrawer({ region, lens, onClose }: {
  region: MapRegion; lens: LensKey; onClose: () => void;
}) {
  const count = lensCount(region, lens);
  return (
    <aside aria-label={`${region.name} details`}
      className="flex w-full flex-col rounded-2xl border border-border bg-card">
      {/* Header (sticky) */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-6 pb-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Region · {region.country}</div>
          <h2 className="text-2xl font-semibold text-foreground">{region.name}</h2>
          <p className="mt-1 text-base text-muted-foreground">
            {count.toLocaleString()} {count === 1 ? 'bottle' : 'bottles'}
            {priceLabel(region.priceRange.min, region.priceRange.max) && ` · ${priceLabel(region.priceRange.min, region.priceRange.max)}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground">✕</button>
      </div>

      {/* Body — full-width panel below the map, so it grows with content (no fixed
          height / inner scroll; the page scrolls naturally). */}
      <div className="flex flex-col gap-5 p-6">
        {region.description && (
          <p className="text-base leading-relaxed text-foreground">{region.description}</p>
        )}

        {region.peeks.length > 0 && (
          <div>
            <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">A few to explore</h3>
            {/* Luxury composition: large fluid tiles (≥12rem) with generous gaps; each
                bottle floats on a soft framed surface with breathing room, the name in
                a larger refined serif-weight, two-line clamp so layout stays even. */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-7 gap-y-10">
              {region.peeks.map((p) => (
                <li key={p.sku}>
                  <Link
                    href={`/product/${p.sku}`}
                    aria-label={p.name}
                    className="group block focus:outline-none"
                  >
                    <div className="overflow-hidden rounded-xl border border-border/60 bg-white p-5 shadow-sm transition-shadow duration-300 group-hover:shadow-md">
                      <StorefrontImage
                        src={p.image_url}
                        alt={p.name}
                        className="aspect-[3/4] transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                      />
                    </div>
                    <span className="mt-4 block text-[0.95rem] font-medium leading-snug tracking-tight text-foreground line-clamp-2 group-hover:text-primary">
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

      {/* Footer CTA (sticky) */}
      <div className="border-t border-border p-6 pt-4">
        <Link href={shopHref(region, lens)}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90">
          View all {count.toLocaleString()} →
        </Link>
      </div>
    </aside>
  );
}
