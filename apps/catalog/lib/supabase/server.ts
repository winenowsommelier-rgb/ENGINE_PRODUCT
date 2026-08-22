import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Must be called fresh per-request (never module-scoped --
 * cookies() is request-bound).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component (not a Server Action/Route
            // Handler) -- cookies() is read-only there. Safe to ignore: the
            // middleware's session refresh (a later task) already keeps the
            // session cookie current for the next request.
          }
        },
      },
    },
  );
}
