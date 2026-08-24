'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createListAction } from '@/actions/lists';

/**
 * Minimal "+ New list" affordance. Deliberately not the full popover the
 * spec describes as the richer follow-on UI (checkmarks per list, inline
 * creation from the save-to-list popover) -- this is the smallest UI that
 * gives the spec's "unlimited lists per user, same SKU can appear in
 * multiple lists" requirement an actual reachable path to create a SECOND
 * list, so that behavior can be exercised in Task 10's browser walkthrough
 * (combined with SaveToListButton's list-picker chevron, Task 7) instead of
 * being both untested and unreachable.
 */
export function NewListForm() {
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const list = await createListAction(name.trim());
      setName('');
      router.refresh();
      void list;
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New list name"
        className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Creating…' : '+ New list'}
      </button>
    </form>
  );
}
