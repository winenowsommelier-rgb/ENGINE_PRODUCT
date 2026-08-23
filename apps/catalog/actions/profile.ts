'use server';

import { createClient } from '@/lib/supabase/server';
import { isUsernameAvailable, isUsernameSubmissionValid } from '@/lib/profiles';
import { revalidatePath } from 'next/cache';

export async function updateUsernameAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim().toLowerCase();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not logged in.' };

  // Fetch the current stored username so an unchanged resubmission can be
  // exempted from isValidUsername's 30-char cap -- see lib/profiles.ts's
  // isUsernameSubmissionValid doc comment for why: the DB trigger that
  // derives usernames from email local-parts has no length cap, so a real
  // user's own already-stored username can legitimately exceed 30 chars.
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();
  const currentUsername = currentProfile?.username ?? null;

  if (!isUsernameSubmissionValid(username, currentUsername)) {
    return { error: 'Username must be 3-30 characters, lowercase letters, numbers, and hyphens only.' };
  }

  const available = await isUsernameAvailable(supabase, username, user.id);
  if (!available) {
    return { error: 'That username is already taken.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ username })
    .eq('id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/account/settings');
  return { success: true };
}

// Fixed allowlist -- do NOT derive the extension/content-type from the
// client-supplied filename or File.type. This is a public-read storage
// bucket (avatar_public_read policy grants anon select on the whole
// bucket); trusting a client-controlled extension would let a user upload
// e.g. "avatar.svg" or "avatar.html" to their own folder and have it served
// back over the public CDN, which is a content-type/XSS-adjacent risk in a
// CLAUDE.md-designated high-risk zone (file upload + public serving).
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function updateAvatarAction(formData: FormData) {
  const file = formData.get('avatar') as File | null;
  if (!file || file.size === 0) return { error: 'No file selected.' };

  const ext = ALLOWED_AVATAR_TYPES[file.type];
  if (!ext) {
    return { error: 'Only JPEG, PNG, or WebP images are allowed.' };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: 'Image must be under 5MB.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not logged in.' };

  const path = `${user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { error: uploadError.message };

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: urlData.publicUrl })
    .eq('id', user.id);

  if (updateError) return { error: updateError.message };

  revalidatePath('/account/settings');
  return { success: true, avatarUrl: urlData.publicUrl };
}
