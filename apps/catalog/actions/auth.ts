'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next-path';

export async function registerAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  // No emailRedirectTo here: the Confirm-signup email template is set to
  // link directly to /auth/confirm?token_hash=...&type=email (built from
  // Supabase's own configured Site URL + {{ .TokenHash }}), not the
  // PKCE-oriented {{ .ConfirmationURL }} that this option would otherwise
  // control. See app/auth/confirm/route.ts for why.
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Same email-enumeration reasoning as requestPasswordResetAction below:
    // Supabase's signUp error for an existing email is the literal string
    // "User already registered" (see GoTrueClient's own doc comment), which
    // would let an attacker distinguish taken vs. available emails one
    // guess at a time. A password-strength/rate-limit error is a real,
    // actionable problem the user needs to see, so only THAT class is
    // surfaced; anything ambiguous (including "already registered") falls
    // back to the same success copy as a genuine new signup.
    if (error.code === 'weak_password' || error.code === 'over_email_send_rate_limit') {
      return { error: error.message };
    }
    console.error('[registerAction] signUp failed', error);
    return { success: true };
  }

  return { success: true };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const rawNext = String(formData.get('next') ?? '/');
  // See lib/safe-next-path.ts for why this guard exists (CWE-601 open
  // redirect via the user-controlled ?next= param).
  const next = safeNextPath(rawNext);

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // invalid_credentials is Supabase's own generic message for both
    // wrong-password and no-such-account (it does not distinguish), so
    // it's already enumeration-safe and fine to pass through. Anything else
    // (rate limit, provider/network error) is logged server-side and
    // replaced with a generic message instead of surfacing internals.
    if (error.code === 'invalid_credentials' || error.code === 'over_request_rate_limit') {
      return { error: error.message };
    }
    console.error('[loginAction] signIn failed', error);
    return { error: 'Something went wrong signing you in. Please try again.' };
  }

  redirect(next);
}

/**
 * Always returns { success: true } regardless of whether the email matches
 * an account -- resetPasswordForEmail's own error (if any) is swallowed on
 * purpose. Surfacing "no account with that email" would let an attacker
 * enumerate registered emails one guess at a time; a generic "check your
 * email" response is indistinguishable whether the address exists or not.
 *
 * No emailRedirectTo/redirectTo option, same reasoning as registerAction:
 * the Supabase "Reset Password" email template is configured (dashboard,
 * out of band) to link directly to
 * /auth/reset-password?token_hash={{ .TokenHash }}&type=recovery instead of
 * the PKCE-oriented {{ .ConfirmationURL }} -- see app/auth/reset-password/route.ts
 * for why (same cross-device flow_state_expired failure the signup-confirm
 * fix addressed).
 */
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  if (!email) {
    return { error: 'Email is required.' };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email);

  return { success: true };
}

/**
 * Requires an active session -- set by app/auth/reset-password/route.ts's
 * verifyOtp('recovery') call for the forgot-password flow, but also works
 * for a logged-in user changing their password from /account/settings.
 */
export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'weak_password' || error.code === 'same_password') {
      return { error: error.message };
    }
    console.error('[updatePasswordAction] updateUser failed', error);
    return { error: 'Something went wrong updating your password. Please try again.' };
  }

  redirect('/account/settings?password_updated=1');
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // No revalidatePath('/') here: the header/homepage already resolve auth
  // state fresh per-request (no ISR/force-static in this app today), so the
  // signed-out state renders correctly on the next request without it. If
  // any route later opts into static/ISR caching, add revalidatePath('/')
  // here or this redirect can land on a stale cached logged-in page.
  redirect('/');
}
