import Link from 'next/link';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

export function RegionList({ regions, lens }: { regions: MapRegion[]; lens: LensKey }) {
  const shown = regions
    .map((r) => ({ r, n: lensCount(r, lens) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    <nav aria-label="Browse regions" className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-foreground">All regions</h2>
      <ul className="divide-y divide-border">
        {shown.map(({ r, n }) => (
          <li key={r.slug}>
            <Link href={`/explore-map/${r.slug}`}
              className="flex min-h-12 items-center justify-between py-3 text-base text-foreground hover:text-primary">
              <span>{r.name} <span className="text-muted-foreground">· {r.country}</span></span>
              <span className="text-muted-foreground">{n.toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
