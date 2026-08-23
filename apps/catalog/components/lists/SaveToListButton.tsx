'use client';

import { useState, useTransition } from 'react';
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
  const router = useRouter();

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
    startTransition(async () => {
      try {
        await pinToDefaultListAction(sku);
      } catch {
        setSaved(false); // revert on failure
      }
    });
  }

  function handlePickList(listId: string) {
    setPickerOpen(false);
    setSaved(true); // optimistic
    startTransition(async () => {
      try {
        await addItemToListAction(listId, sku);
      } catch {
        setSaved(false);
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
          <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
          <Bookmark className="h-4 w-4 text-foreground" aria-hidden="true" />
        )}
      </button>

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
