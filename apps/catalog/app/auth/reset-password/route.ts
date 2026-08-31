import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Separate from app/auth/confirm/route.ts (signup confirmation, type='email')
// and app/auth/callback/route.ts (PKCE `code` exchange, OAuth/login) -- this
// handles the "Reset Password" email template's token_hash link. Same
// verifyOtp(token_hash) approach as /auth/confirm for the same reason: PKCE's
// exchangeCodeForSession requires a code_verifier cookie set on the SAME
// browser that started the flow, which real users routinely violate
// (request the reset on desktop, open the email on a phone), failing with
// "422: invalid flow state, flow state has expired". Requires the Reset
// Password email template to link here as
// {{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery
// (set in the Supabase dashboard, out of band -- not in this repo).
//
// `type` is hardcoded to 'recovery' rather than read from the query string,
// mirroring /auth/confirm's hardcoded 'email' -- EmailOtpType also covers
// 'email'/'email_change'/'invite', and trusting an attacker-influenced
// `type` param here would let a leaked/replayed signup-confirmation link
// silently drive an unintended flow through this handler instead.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');

  if (token_hash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}/account/reset-password`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=reset_failed`);
}
