'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction } from '@/actions/auth';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    formData.set('next', next);
    const result = await loginAction(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
    // On success, loginAction redirects server-side; this component unmounts.
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
        className="rounded-md border border-border px-3 py-2"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
