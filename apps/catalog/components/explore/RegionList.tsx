import Link from 'next/link';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

export function RegionList({ regions, lens }: { regions: MapRegion[]; lens: LensKey }) {
  const shown = regions
    .map((r) => ({ r, n: lensCount(r, lens) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    // Collapsible so the full A–Z index doesn't cram the page — the map + chips are
    // the primary browse path; this is the "see everything" fallback, closed by
    // default. Two columns on wider screens so the open list stays compact.
    <details className="group mt-10 rounded-2xl border border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-base font-semibold text-foreground hover:bg-secondary">
        <span>All regions <span className="font-normal text-muted-foreground">· {shown.length}</span></span>
        <svg aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <nav aria-label="Browse all regions" className="border-t border-border px-5 pb-3">
        <ul className="grid sm:grid-cols-2 sm:gap-x-8">
          {shown.map(({ r, n }) => (
            <li key={r.slug} className="border-b border-border/60">
              <Link href={`/explore-map/${r.slug}`}
                className="flex min-h-12 items-center justify-between gap-3 py-3 text-base text-foreground hover:text-primary">
                <span>{r.name} <span className="text-muted-foreground">· {r.country}</span></span>
                <span className="tabular-nums text-muted-foreground">{n.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
