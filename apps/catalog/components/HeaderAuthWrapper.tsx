import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';

/**
 * Server-component wrapper that resolves auth state for the header before
 * render, so logged-in shoppers never see a client-side login/logout flash.
 *
 * Deliberately thin: Header itself stays a client component (mobile-menu +
 * search-overlay open/close state can't be server-rendered), this wrapper's
 * only job is the one Supabase round-trip to fetch `user` + the matching
 * `profiles` row, then hand plain serializable props down.
 */
export async function HeaderAuthWrapper() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
