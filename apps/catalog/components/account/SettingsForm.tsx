'use client';

import { useId, useState } from 'react';
import { updateUsernameAction } from '@/actions/profile';

export function SettingsForm({ currentUsername }: { currentUsername: string }) {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const errorId = useId();

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setState({});
    const result = await updateUsernameAction(formData);
    setState(result);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Username
        </label>
        <input
          id={inputId}
          type="text"
          name="username"
          defaultValue={currentUsername}
          required
          minLength={3}
          // No maxLength here: a legacy username derived from a long email
          // local-part (no DB-side length cap -- see lib/profiles.ts) can
          // exceed 30 chars, and the input must be able to display/resubmit
          // it unchanged. isUsernameSubmissionValid enforces the 30-char cap
          // server-side for any NEW/changed value; the browser-side
          // `pattern` below still catches disallowed characters early.
          // Hyphen is explicitly escaped (\-) rather than left bare -- an
          // unescaped hyphen (leading, trailing, or otherwise) is ambiguous
          // under the `v` (Unicode Sets) flag some browsers use to compile the
          // HTML `pattern` attribute, throwing "Invalid regular expression ...
          // Invalid character class" and silently disabling validation
          // entirely (an invalid pattern fails open, not visibly -- verified
          // both unescaped forms throw under `v` while this one does not).
          // Caught live during the Task 10 Rule 7 browser walkthrough.
          pattern="[a-z0-9\-]+"
          autoComplete="username"
          aria-describedby={state.error ? `${errorId} ${inputId}-hint` : `${inputId}-hint`}
          aria-invalid={state.error ? true : undefined}
          className="h-11 rounded-md border border-input bg-background px-3.5 text-[0.95rem] outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          3–30 characters — lowercase letters, numbers, and hyphens only.
        </p>
      </div>

      {state.error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l6.048 10.752c.75 1.334-.213 2.982-1.743 2.982H3.952c-1.53 0-2.493-1.648-1.743-2.982L8.257 3.1zM11 14a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"
              clipRule="evenodd"
            />
          </svg>
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-sm text-emerald-700">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
          Your username has been updated.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-fit items-center justify-center gap-2 rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Saving
          </>
        ) : (
          'Save changes'
        )}
      </button>
    </form>
  );
}
