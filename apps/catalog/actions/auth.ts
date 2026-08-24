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
