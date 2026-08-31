'use client';

import { useState } from 'react';
import { requestPasswordResetAction } from '@/actions/auth';

export function ForgotPasswordForm() {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await requestPasswordResetAction(formData);
    setState(result);
    setPending(false);
  }

  if (state.success) {
    return (
      <p className="text-sm text-muted-foreground">
        If an account exists for that email, we&apos;ve sent a link to reset your password.
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input
        type="email"
        name="email"
        placeholder="Email"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
