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
    return { error: error.message };
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
    return { error: error.message };
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
    return { error: error.message };
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
