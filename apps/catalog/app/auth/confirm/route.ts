import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Separate from app/auth/callback/route.ts (PKCE `code` exchange, used for
// OAuth/login) -- this handles the Confirm-signup email template's
// token_hash link. PKCE's exchangeCodeForSession requires a code_verifier
// cookie set on the SAME browser that started the flow, which real users
// routinely violate (register on desktop, confirm from a phone's mail app),
// failing with "422: invalid flow state, flow state has expired". verifyOtp
// with token_hash carries its own proof in the link and needs no cookie
// from the originating device. Requires the Confirm signup email template
// to link here as {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// (set in the Supabase dashboard, out of band -- not in this repo).
//
// `type` is hardcoded to 'email' rather than read from the query string:
// EmailOtpType also includes 'recovery'/'email_change'/'invite', and this
// route's redirect/error handling was only reasoned about for signup
// confirmation. Trusting an attacker-influenced `type` param here would let
// a leaked or replayed recovery-template link (Referer, logs) silently
// establish a password-recovery session through a handler not designed for
// it. If magic-link support is needed later, allowlist it explicitly.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');

  if (token_hash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}/account/settings`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=verification_failed`);
}
