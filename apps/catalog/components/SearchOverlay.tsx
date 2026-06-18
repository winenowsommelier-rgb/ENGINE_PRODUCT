'use client';

import { useMemo, useState } from 'react';
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
 * DATA FLOW (Task 12): the search index is built ONCE at build time
 * (buildSearchIndex() in a server boundary — app/layout.tsx) and passed down as
 * the `index` prop. This component never fetches; it filters the embedded array
 * on the client with the pure searchEntries() helper (substring, case-insensitive,
 * capped at 10) as the shopper types.
 *
 * The index holds ONLY {sku,name,brand,region} (all PUBLIC_FIELDS) — no
 * margin/internal field is reachable here.
 *
 * UX (Maison, 40+ eyesight): 18px input, 44px+ result rows, calm spacing. Empty
 * query shows hint text. Radix Dialog gives ESC-to-close, overlay-click-close and
 * focus management for free.
 */

interface SearchOverlayProps {
  index: SearchEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchOverlay({ index, open, onOpenChange }: SearchOverlayProps) {
  const [query, setQuery] = useState('');

  // Recompute results only when the query (or index) changes.
  const results = useMemo(() => searchEntries(index, query), [index, query]);
  const trimmed = query.trim();

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
          {trimmed === '' ? (
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
