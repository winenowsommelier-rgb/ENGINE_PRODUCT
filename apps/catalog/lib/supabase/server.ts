import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

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

/**
 * `getUser()` deduped per-request via React's `cache()`.
 *
 * Multiple call sites (HeaderAuthWrapper, and most Task-7 pages needing
 * `isLoggedIn`/`userLists`) each need the current user within the same
 * request. Without this, every one of them makes its own round trip to
 * Supabase's auth server. `cache()` memoizes within a single request's
 * React render tree, so repeated calls from different Server Components in
 * the same request reuse one result -- it does NOT cache across requests or
 * users, and does NOT cover middleware.ts's own `updateSession()` call (a
 * separate Edge runtime request, outside this render tree, and it needs the
 * `{ data, error }` shape's error handling anyway).
 *
 * Callers needing the full `{ data, error }` shape should call
 * `createClient().auth.getUser()` directly instead of this helper.
 *
 * NOTE: only HeaderAuthWrapper has been migrated to this helper so far.
 * The Task-7 page call sites (homepage, /shop, product pages, /account/*,
 * /collections) still call `supabase.auth.getUser()` directly and were
 * intentionally left alone here -- adopting this helper there is a
 * follow-up, not part of this change.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
