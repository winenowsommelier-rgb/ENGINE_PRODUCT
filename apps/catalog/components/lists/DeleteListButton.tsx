'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteListAction } from '@/actions/lists';

/** Instant hard delete, no confirm dialog -- explicit spec decision ("easy like a cart"). */
export function DeleteListButton({ listId }: { listId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await deleteListAction(listId);
          router.push('/account/lists');
        })
      }
      disabled={pending}
      className="text-sm text-destructive hover:underline"
    >
      Delete list
    </button>
  );
}
