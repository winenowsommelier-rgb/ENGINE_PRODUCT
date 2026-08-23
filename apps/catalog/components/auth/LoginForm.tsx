'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction } from '@/actions/auth';

const VERIFICATION_FAILED_MESSAGE =
  'That verification link is invalid or expired. Please try registering again or contact support.';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  // Surfaces app/auth/callback/route.ts's `?error=verification_failed`
  // redirect -- without this the user lands on a plain login page with no
  // explanation for why their verification link didn't work.
  const callbackError = searchParams.get('error') === 'verification_failed'
    ? VERIFICATION_FAILED_MESSAGE
    : undefined;
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const displayError = error ?? callbackError;

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
      {displayError ? <p className="text-sm text-destructive">{displayError}</p> : null}
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
