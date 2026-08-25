'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginAction } from '@/actions/auth';

const VERIFICATION_FAILED_MESSAGE =
  'That verification link is invalid or expired. Please try registering again or contact support.';
const RESET_FAILED_MESSAGE =
  'That password reset link is invalid or expired. Please request a new one.';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  // Surfaces app/auth/callback/route.ts's `?error=verification_failed` and
  // app/auth/reset-password/route.ts's `?error=reset_failed` redirects --
  // without this the user lands on a plain login page with no explanation
  // for why their link didn't work.
  const errorParam = searchParams.get('error');
  const callbackError =
    errorParam === 'verification_failed'
      ? VERIFICATION_FAILED_MESSAGE
      : errorParam === 'reset_failed'
      ? RESET_FAILED_MESSAGE
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
      <Link href="/forgot-password" className="-mt-2 self-end text-sm font-medium text-foreground underline">
        Forgot password?
      </Link>
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
