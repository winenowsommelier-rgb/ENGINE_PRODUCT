import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Nudge to settings once after verification, per spec -- does not
      // hard-block browsing (user can navigate away freely from there).
      return NextResponse.redirect(`${origin}/account/settings`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=verification_failed`);
}
