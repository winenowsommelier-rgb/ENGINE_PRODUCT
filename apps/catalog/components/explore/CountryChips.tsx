'use client';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';
import type { CountryPin } from './RegionAtlas';

/**
 * CountryChips — the discoverable "menu" of what's available, below the map.
 *
 * World level  → a chip per country that has data (with its region count),
 *                so a user sees every place we cover without hunting the map.
 * Country level → that country's region chips (with bottle counts), so they can
 *                pick a region directly. Selecting a chip drives the same state as
 *                clicking a map pin (zoom / select), keeping map + list in sync.
 *
 * Counts respect the active lens; chips with 0 under the lens are hidden (never a
 * dead chip). Mirrors CategoryLens styling for a consistent, 40+-friendly target.
 */

// Compact chips (they can sit overlaid on the map's lower edge, so keep them light
// and small). Still ≥36px tall for a comfortable tap. Frosted background so they
// stay legible over the map art.
const chipBase =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ' +
  'shadow-sm backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-150 ease-out';
const chipIdle =
  'border-border/70 bg-background/85 text-foreground hover:border-primary/60 hover:bg-background';
const chipActive = 'border-primary bg-primary text-primary-foreground shadow';

function Count({ n, active }: { n: number; active?: boolean }) {
  return (
    <span className={['tabular-nums text-xs', active ? 'opacity-90' : 'text-muted-foreground'].join(' ')}>
      {n.toLocaleString()}
    </span>
  );
}

export function CountryChips({
  countries,
  focusCountry,
  lens,
  selectedSlug,
  onSelectCountry,
  onSelectRegion,
}: {
  countries: CountryPin[];
  focusCountry: CountryPin | null;
  lens: LensKey;
  selectedSlug?: string;
  onSelectCountry: (c: CountryPin) => void;
  onSelectRegion: (r: MapRegion) => void;
}) {
  // Single horizontal scroll row (no wrap) keeps the overlay a thin band at the very
  // top of the map, clear of the country pins below.
  const rowClass =
    'flex gap-2.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

  // COUNTRY LEVEL: this country's region chips.
  if (focusCountry) {
    const regions = focusCountry.regions
      .map((r) => ({ r, n: lensCount(r, lens) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    return (
      <div role="group" aria-label={`Regions in ${focusCountry.name}`} className={rowClass}>
        {regions.map(({ r, n }) => {
          const active = r.slug === selectedSlug;
          return (
            <button
              key={r.slug}
              type="button"
              onClick={() => onSelectRegion(r)}
              aria-pressed={active}
              className={[chipBase, active ? chipActive : chipIdle].join(' ')}
            >
              {r.name}
              <Count n={n} active={active} />
            </button>
          );
        })}
      </div>
    );
  }

  // WORLD LEVEL: a chip per country that has data under the lens.
  const withData = countries
    .map((c) => ({ c, n: c.regions.reduce((s, r) => s + lensCount(r, lens), 0), regions: c.regions.filter((r) => lensCount(r, lens) > 0).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    <div role="group" aria-label="Countries with bottles available" className={rowClass}>
      {withData.map(({ c, n, regions }) => (
        <button
          key={c.slug}
          type="button"
          onClick={() => onSelectCountry(c)}
          className={[chipBase, chipIdle].join(' ')}
        >
          {c.name}
          <span className="text-xs text-muted-foreground">
            {regions} {regions === 1 ? 'region' : 'regions'}
          </span>
          <Count n={n} />
        </button>
      ))}
    </div>
  );
}
