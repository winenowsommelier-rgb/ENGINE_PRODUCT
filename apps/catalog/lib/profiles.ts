import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUsername } from '@/lib/username';

/**
 * Checks username availability, excluding the current user's own existing
 * row (so re-saving your own unchanged username doesn't false-positive as
 * "taken"). Used both at settings-edit time and (via a thin RPC-less
 * client-side check) is NOT used at signup -- the trigger owns that path.
 */
export async function isUsernameAvailable(
  client: SupabaseClient,
  username: string,
  currentUserId: string,
): Promise<boolean> {
  const { data } = await client
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  return !data || data.id === currentUserId;
}

/**
 * Validates a submitted username for the settings-page update path.
 *
 * Regression guard: the DB's `handle_new_user` trigger derives usernames
 * from email local-parts with NO length cap, and `profiles.username` has
 * no CHECK constraint enforcing one either -- verified concretely, a
 * 40-char email local-part produces and stores a 40-char username with no
 * DB-side rejection. `isValidUsername` enforces a 30-char UX cap for NEW
 * usernames going forward, but applying that cap unconditionally here would
 * mean a real user with a long-local-part email gets told THEIR OWN
 * already-stored username is "invalid" the moment they resubmit the
 * settings form unchanged (e.g. just to update their avatar).
 *
 * Fix: a submission that is byte-for-byte identical to the user's current
 * stored username is always accepted, bypassing isValidUsername entirely
 * (so it's exempt from the length cap AND any future tightening of the
 * regex). Any username that differs from the stored value -- including a
 * brand-new user with no stored username yet (currentUsername === null) --
 * must pass the full isValidUsername check, 30-char cap included.
 */
export function isUsernameSubmissionValid(
  submitted: string,
  currentUsername: string | null,
): boolean {
  if (currentUsername !== null && submitted === currentUsername) {
    return true;
  }
  return isValidUsername(submitted);
}
