'use client';

import { useState } from 'react';
import { updatePasswordAction } from '@/actions/auth';

const MISMATCH_MESSAGE = 'Passwords do not match.';

export function UpdatePasswordForm() {
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    // Client-only confirm-password check: without it, a single mistyped
    // password field submits successfully and the user is redirected
    // believing their new password is what they intended, locking them out
    // until they repeat the whole forgot-password flow.
    if (formData.get('password') !== formData.get('confirmPassword')) {
      setError(MISMATCH_MESSAGE);
      return;
    }

    setPending(true);
    const result = await updatePasswordAction(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
    // On success, updatePasswordAction redirects server-side; this component unmounts.
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input
        type="password"
        name="password"
        placeholder="New password"
        required
        minLength={8}
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        type="password"
        name="confirmPassword"
        placeholder="Confirm new password"
        required
        minLength={8}
        className="rounded-md border border-border px-3 py-2"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
