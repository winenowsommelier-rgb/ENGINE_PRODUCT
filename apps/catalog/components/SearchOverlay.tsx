'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { searchEntries, type SearchEntry } from '@/lib/search-index';

/**
 * SearchOverlay — the client search modal wired to the header search icon.
 *
 * DATA FLOW (perf fix): the search index is NO LONGER embedded in the page.
 * It is generated at build time as a single static asset
 * (public/search-index.json, holding ONLY {sku,name,brand,region}) and fetched
 * LAZILY the first time the overlay opens. The fetched array is cached in a
 * module-level memo so reopening search never re-fetches. Once loaded, the pure
 * searchEntries() helper (substring, case-insensitive, capped at 10) filters it
 * on the client as the shopper types.
 *
 * The index holds ONLY {sku,name,brand,region} (all PUBLIC_FIELDS) — no
 * margin/internal field is reachable here.
 *
 * UX (Maison, 40+ eyesight): 18px input, 44px+ result rows, calm spacing. Empty
 * query shows hint text; the very first open shows a brief "loading…" line while
 * the index streams in. Radix Dialog gives ESC-to-close, overlay-click-close and
 * focus management for free.
 */

/** Path to the static index emitted by scripts/gen-search-index.mjs. */
const SEARCH_INDEX_URL = '/search-index.json';

/**
 * Module-level cache so the ~1.4 MB index is fetched at most ONCE per page load,
 * shared across every open of the overlay (and any future remount).
 */
let indexCache: SearchEntry[] | null = null;
let indexPromise: Promise<SearchEntry[]> | null = null;

function loadSearchIndex(): Promise<SearchEntry[]> {
  if (indexCache) return Promise.resolve(indexCache);
  if (!indexPromise) {
    indexPromise = fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`search index ${res.status}`);
        return res.json();
      })
      .then((data: SearchEntry[]) => {
        indexCache = Array.isArray(data) ? data : [];
        return indexCache;
      })
      .catch((err) => {
        // Reset so a later open can retry; surface empty results meanwhile.
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

interface SearchOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchOverlay({ open, onOpenChange }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<SearchEntry[] | null>(indexCache);
  const [loading, setLoading] = useState(false);

  // Lazily fetch the static index the first time the overlay opens. Cached at
  // module level, so this is a no-op (and instant) on every subsequent open.
  useEffect(() => {
    if (!open || index) return;
    let cancelled = false;
    setLoading(true);
    loadSearchIndex()
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch(() => {
        if (!cancelled) setIndex([]); // fail soft: no matches, no crash
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, index]);

  // Recompute results only when the query (or loaded index) changes.
  const results = useMemo(
    () => searchEntries(index ?? [], query),
    [index, query],
  );
  const trimmed = query.trim();
  const isLoading = loading && index === null;

  // Reset the query whenever the overlay closes so it reopens clean.
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search the collection</DialogTitle>
        <DialogDescription className="sr-only">
          Type a name, brand or region to find a bottle.
        </DialogDescription>

        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search
            className="h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            placeholder="Search name, brand or region…"
            aria-label="Search the collection"
            className="h-11 w-full bg-transparent text-lg text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {/* Results / hint */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {isLoading ? (
            <p className="px-4 py-6 text-base text-muted-foreground">
              Loading…
            </p>
          ) : trimmed === '' ? (
            <p className="px-4 py-6 text-base text-muted-foreground">
              Start typing to search the collection by name, brand or region.
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-base text-muted-foreground">
              No matches for{' '}
              <span className="font-medium text-foreground">
                &ldquo;{trimmed}&rdquo;
              </span>
              .
            </p>
          ) : (
            <ul>
              {results.map((entry) => (
                <li key={entry.sku}>
                  <Link
                    href={`/product/${entry.sku}`}
                    onClick={() => handleOpenChange(false)}
                    className="flex min-h-[44px] flex-col justify-center gap-0.5 px-4 py-2.5 text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  >
                    <span className="text-base font-medium leading-snug">
                      {entry.name}
                    </span>
                    {entry.region ? (
                      <span className="text-sm text-muted-foreground">
                        {entry.region}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
