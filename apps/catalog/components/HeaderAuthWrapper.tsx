import { createClient, getCachedUser } from '@/lib/supabase/server';
import { Header } from '@/components/Header';

/**
 * Server-component wrapper that resolves auth state for the header before
 * render, so logged-in shoppers never see a client-side login/logout flash.
 *
 * Deliberately thin: Header itself stays a client component (mobile-menu +
 * search-overlay open/close state can't be server-rendered), this wrapper's
 * only job is fetching `user` (via the request-deduped `getCachedUser()` --
 * see lib/supabase/server.ts, the header renders on every page so this is
 * the call site most likely to double up with a Task-7 page's own
 * `getUser()` call in the same request) + the matching `profiles` row, then
 * handing plain serializable props down.
 */
export async function HeaderAuthWrapper() {
  const user = await getCachedUser();
  const supabase = await createClient();

  let profile: { username: string; avatar_url: string | null } | null = null;

  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', user.id)
      .single();
    profile = data ?? null;
  }

  return (
    <Header
      user={user ? { id: user.id, email: user.email ?? null } : null}
      profile={profile}
    />
  );
}
