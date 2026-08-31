import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SettingsForm } from '@/components/account/SettingsForm';
import { AvatarUpload } from '@/components/account/AvatarUpload';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/settings');

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, avatar_url')
    .eq('id', user.id)
    .single();

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Account settings</h1>
        <p className="mt-1.5 text-[0.95rem] text-muted-foreground">
          Manage your profile photo and username.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card px-6 py-8 shadow-sm sm:px-8">
        <div className="flex flex-col gap-8">
          <AvatarUpload currentAvatarUrl={profile?.avatar_url ?? null} />
          <div className="h-px bg-border" />
          <SettingsForm currentUsername={profile?.username ?? ''} />
        </div>
      </div>
    </div>
  );
}
