'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface SearchableSelectProps {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string | null) => void;
  placeholder?: string;
}

/**
 * Searchable typeahead for high-cardinality filters (Grape: 844 distinct,
 * Flavor: 5,521 distinct). Seeded with a capped `options` list but ALSO lets
 * the user free-type any value: pressing Enter on a query with no exact
 * (case-insensitive) match emits the raw query, so blends / long-tail values
 * still reach the backend's substring filter.
 *
 * Thin client component — it ONLY calls `onSelect`; the parent owns URL writes.
 */
export function SearchableSelect({
  label,
  value,
  options,
  onSelect,
  placeholder,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  // Defensive cap: callers pass a pre-capped list (~top 40/50), but never render
  // the full 844/5,521 if a future caller forgets — cmdk filters per keystroke.
  const visibleOptions = React.useMemo(() => options.slice(0, 50), [options]);

  const choose = React.useCallback(
    (next: string | null) => {
      onSelect(next);
      setQuery('');
      setOpen(false);
    },
    [onSelect]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const q = query.trim();
    if (!q) return;
    const hasExact = options.some((o) => o.toLowerCase() === q.toLowerCase());
    if (!hasExact) {
      // Free-type fallback: emit the raw query so blends still filter.
      event.preventDefault();
      choose(q);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery(''); // clear stale query so reopen starts fresh
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={value ? `${label}: ${value}` : label}
          className={cn(
            'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            !value && 'text-muted-foreground'
          )}
        >
          <span className="truncate">{value || label}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
            value={query}
            onValueChange={setQuery}
            onKeyDown={handleKeyDown}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim()
                ? `Press Enter to filter by “${query.trim()}”`
                : 'No results.'}
            </CommandEmpty>
            {value ? (
              <CommandGroup>
                <CommandItem value="__clear__" onSelect={() => choose(null)}>
                  <X className="h-4 w-4" />
                  Clear
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {visibleOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => choose(option === value ? null : option)}
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      option === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
