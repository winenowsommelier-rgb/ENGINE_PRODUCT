'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, BookmarkCheck, ChevronDown } from 'lucide-react';
import { pinToDefaultListAction, addItemToListAction } from '@/actions/lists';
import { cn } from '@/lib/utils';
import type { ListRow } from '@/lib/supabase/types';

/**
 * The "pin" icon on ProductCard/PDP. Logged-out click redirects to
 * /login?next=<current path>. Logged-in click optimistically adds to the
 * user's most-recently-used list (auto-creating a default list if none
 * exists), per spec.
 *
 * When the caller has 2+ lists (userLists.length > 1), a small chevron
 * appears next to the bookmark icon opening a lightweight dropdown to pick
 * a SPECIFIC target list instead of the default -- this is the minimal
 * reachable UI path for the spec's "same sku can appear in multiple
 * different lists" requirement (a plan review caught that without this,
 * addItemToListAction had no caller anywhere in the app and the
 * requirement was unreachable/untestable in the browser walkthrough). The
 * richer full popover (checkmarks per list already containing the item,
 * inline quantity stepper, inline "+ New list") remains a deferred
 * follow-up -- this is deliberately just enough to make the underlying
 * requirement real, not the full designed UX.
 */
export function SaveToListButton({
  sku,
  isLoggedIn,
  userLists = [],
  className,
}: {
  sku: string;
  isLoggedIn: boolean;
  /** Caller's own lists, needed only to decide whether to show the list-picker chevron. Omit/empty for logged-out or single-list users. */
  userLists?: ListRow[];
  className?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Drives a one-shot pop animation + "Saved" confirmation pill on a
  // successful pin -- previously the button just silently swapped icons,
  // giving the user no feedback that the click actually did anything.
  const [justSaved, setJustSaved] = useState(false);
  const celebrateTimeout = useRef<number | undefined>(undefined);
  const router = useRouter();

  useEffect(() => () => window.clearTimeout(celebrateTimeout.current), []);

  function celebrateSave() {
    window.clearTimeout(celebrateTimeout.current); // a rapid repeat click restarts the timer instead of racing it
    setJustSaved(true);
    celebrateTimeout.current = window.setTimeout(() => setJustSaved(false), 1400);
  }

  function goToLoginIfLoggedOut(e: React.MouseEvent): boolean {
    if (!isLoggedIn) {
      e.preventDefault();
      e.stopPropagation();
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return true;
    }
    return false;
  }

  function handlePinClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (goToLoginIfLoggedOut(e)) return;

    setSaved(true); // optimistic
    celebrateSave();
    startTransition(async () => {
      try {
        await pinToDefaultListAction(sku);
      } catch {
        setSaved(false); // revert on failure
        setJustSaved(false);
      }
    });
  }

  function handlePickList(listId: string) {
    setPickerOpen(false);
    setSaved(true); // optimistic
    celebrateSave();
    startTransition(async () => {
      try {
        await addItemToListAction(listId, sku);
      } catch {
        setSaved(false);
        setJustSaved(false);
      }
    });
  }

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={handlePinClick}
        disabled={pending}
        aria-label={saved ? 'Saved to list' : 'Save to list'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-border transition-colors hover:bg-background',
          className,
        )}
      >
        {saved ? (
          <BookmarkCheck
            className={cn('h-4 w-4 text-primary', justSaved && 'animate-in zoom-in-50 duration-300')}
            aria-hidden="true"
          />
        ) : (
          <Bookmark className="h-4 w-4 text-foreground" aria-hidden="true" />
        )}
      </button>

      {justSaved ? (
        <span
          role="status"
          className="animate-in fade-in slide-in-from-bottom-1 absolute -top-8 right-0 whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-sm duration-200"
        >
          Saved to list
        </span>
      ) : null}

      {isLoggedIn && userLists.length > 1 ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPickerOpen((open) => !open);
          }}
          aria-label="Choose a list"
          className="flex h-9 w-6 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-border hover:bg-background"
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}

      {pickerOpen ? (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          {userLists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => handlePickList(list.id)}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              {list.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
