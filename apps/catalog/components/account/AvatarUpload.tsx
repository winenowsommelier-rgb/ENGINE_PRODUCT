'use client';

import { useId, useRef, useState } from 'react';
import { updateAvatarAction } from '@/actions/profile';

export function AvatarUpload({ currentAvatarUrl }: { currentAvatarUrl: string | null }) {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set('avatar', file);

    setPending(true);
    setError(undefined);
    const result = await updateAvatarAction(formData);
    if (result.error) {
      setError(result.error);
    } else if (result.avatarUrl) {
      setAvatarUrl(result.avatarUrl);
    }
    setPending(false);
    // Allow re-selecting the same file to retry after an error.
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">Profile photo</span>
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          aria-describedby={error ? errorId : undefined}
          className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, not build-time optimizable
            <img src={avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
              Add photo
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[0.7rem] font-medium text-transparent transition-colors group-hover:bg-black/45 group-hover:text-white group-focus-visible:bg-black/45 group-focus-visible:text-white">
            {pending ? (
              <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              'Change'
            )}
          </span>
        </button>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 5MB</p>
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleChange}
          disabled={pending}
          className="sr-only"
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l6.048 10.752c.75 1.334-.213 2.982-1.743 2.982H3.952c-1.53 0-2.493-1.648-1.743-2.982L8.257 3.1zM11 14a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}
