'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, LockOpen } from 'lucide-react';
import { toggleListVisibilityAction } from '@/actions/lists';

/**
 * Owner-only public/private toggle for a list. Spec: "Public/private toggle,
 * visible only to the owner. New lists default to public."
 *
 * toggleListVisibilityAction(listId, isPublic) writes isPublic as the NEW
 * state directly (no read-then-flip inside the action), so this button must
 * pass the toggle TARGET (!isPublic), not the current value.
 *
 * The action only calls revalidatePath('/account/lists') -- it does not
 * revalidate this list-detail route (/lists/[public_id]) -- so without an
 * explicit router.refresh() here the label would show the toggled state
 * only optimistically in this component's own render, and a manual page
 * reload would still be needed to see it "for real." router.refresh() after
 * the transition matches NewListForm's existing precedent for the same gap.
 */
export function ToggleVisibilityButton({
  listId,
  isPublic,
}: {
  listId: string;
  isPublic: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      await toggleListVisibilityAction(listId, !isPublic);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={isPublic ? 'Make list private' : 'Make list public'}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
    >
      {isPublic ? (
        <LockOpen className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Lock className="h-4 w-4" aria-hidden="true" />
      )}
      {pending ? 'Updating…' : isPublic ? 'Public' : 'Private'}
    </button>
  );
}
