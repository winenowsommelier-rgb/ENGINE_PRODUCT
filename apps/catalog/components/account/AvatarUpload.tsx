'use client';

import { useState } from 'react';
import { updateAvatarAction } from '@/actions/profile';

export function AvatarUpload({ currentAvatarUrl }: { currentAvatarUrl: string | null }) {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set('avatar', file);

    setPending(true);
    const result = await updateAvatarAction(formData);
    if (result.error) {
      setError(result.error);
    } else if (result.avatarUrl) {
      setAvatarUrl(result.avatarUrl);
      setError(undefined);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, not build-time optimizable
        <img src={avatarUrl} alt="Your avatar" className="h-20 w-20 rounded-full object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          No avatar
        </div>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        disabled={pending}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
