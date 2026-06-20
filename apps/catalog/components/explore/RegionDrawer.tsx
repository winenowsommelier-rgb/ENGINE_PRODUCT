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
      className="flex h-full w-full max-w-sm flex-col gap-4 border-l border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Region · {region.country}</div>
          <h2 className="text-2xl font-semibold text-foreground">{region.name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <p className="text-base text-muted-foreground">
        {count.toLocaleString()} {count === 1 ? 'bottle' : 'bottles'}
        {priceLabel(region.priceRange.min, region.priceRange.max) && ` · ${priceLabel(region.priceRange.min, region.priceRange.max)}`}
      </p>
      {region.peeks.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {region.peeks.map((p) => (
            <li key={p.sku}>
              <Link href={`/product/${p.sku}`} className="block" aria-label={p.name}>
                <StorefrontImage src={p.image_url} alt={p.name} />
                <span className="mt-1 block truncate text-sm text-foreground">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={shopHref(region, lens)}
        className="mt-auto inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90">
        View all {count.toLocaleString()} →
      </Link>
    </aside>
  );
}
