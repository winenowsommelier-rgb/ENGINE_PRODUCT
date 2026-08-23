'use client';

import { useState } from 'react';
import { updateUsernameAction } from '@/actions/profile';

export function SettingsForm({ currentUsername }: { currentUsername: string }) {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await updateUsernameAction(formData);
    setState(result);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <label className="text-sm font-medium">Username</label>
      <input
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
        className="rounded-md border border-border px-3 py-2"
      />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save username'}
      </button>
    </form>
  );
}
