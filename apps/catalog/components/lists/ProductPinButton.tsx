import { createClient, getCachedUser } from '@/lib/supabase/server';
import { getUserLists } from '@/lib/lists';
import { SaveToListButton } from '@/components/lists/SaveToListButton';

/**
 * Server-component wrapper that resolves auth state for the PDP's
 * save-to-list pin, mirroring HeaderAuthWrapper's pattern.
 *
 * Deliberately isolated from the PDP's own render (app/product/[sku]/page.tsx
 * stays a plain function reading zero cookies) rather than threading
 * isLoggedIn/userLists through the page body the way /shop does. The PDP is
 * prerendered with ISR (dynamicParams=true, revalidate=3600) across the
 * whole catalog; getCachedUser() reads cookies() and is request-bound, so
 * this subtree renders dynamically per-request while the surrounding page
 * segment keeps its own static/ISR boundary -- same as HeaderAuthWrapper
 * already does from the root layout for every page. getCachedUser() is
 * React-cache deduped per request, so this costs nothing extra beyond what
 * Header already pays in the same request.
 */
export async function ProductPinButton({ sku, className }: { sku: string; className?: string }) {
  const user = await getCachedUser();
  if (!user) return <SaveToListButton sku={sku} isLoggedIn={false} className={className} />;

  const supabase = await createClient();
  const userLists = await getUserLists(supabase, user.id);

  return <SaveToListButton sku={sku} isLoggedIn userLists={userLists} className={className} />;
}
