import { redirect } from 'next/navigation';
import { getCachedUser } from '@/lib/supabase/server';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';

export default async function ResetPasswordPage() {
  // Reached either via the recovery session app/auth/reset-password/route.ts
  // just established, or by an already-logged-in user changing their
  // password. No session at all (direct nav, expired/already-used link)
  // means there's nothing to update -- send them to request a fresh link.
  const user = await getCachedUser();
  if (!user) redirect('/forgot-password');

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Set a new password</h1>
      <UpdatePasswordForm />
    </div>
  );
}
