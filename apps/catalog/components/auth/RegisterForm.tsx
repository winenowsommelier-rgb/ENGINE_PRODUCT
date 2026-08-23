'use client';

import { useState } from 'react';
import { registerAction } from '@/actions/auth';

export function RegisterForm() {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await registerAction(formData);
    setState(result);
    setPending(false);
  }

  if (state.success) {
    return (
      <p className="text-sm text-muted-foreground">
        Check your email to verify your account before logging in.
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
      <input
        type="password"
        name="password"
        placeholder="Password"
        required
        minLength={8}
        className="rounded-md border border-border px-3 py-2"
      />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
