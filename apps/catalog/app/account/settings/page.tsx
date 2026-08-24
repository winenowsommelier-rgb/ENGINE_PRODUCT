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
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Account settings</h1>
      <div className="flex flex-col gap-8">
        <AvatarUpload currentAvatarUrl={profile?.avatar_url ?? null} />
        <SettingsForm currentUsername={profile?.username ?? ''} />
      </div>
    </div>
  );
}
