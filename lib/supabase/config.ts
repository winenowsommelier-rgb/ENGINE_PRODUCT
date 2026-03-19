export const supabaseProject = {
  projectRef: 'xfcvliyxxguhihehqwkg',
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xfcvliyxxguhihehqwkg.supabase.co',
  publishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    'sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel',
  databaseUrl:
    process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:[YOUR-PASSWORD]@db.xfcvliyxxguhihehqwkg.supabase.co:5432/postgres'
} as const;

export function getSupabaseReadiness() {
  return {
    hasUrl: Boolean(supabaseProject.url),
    hasPublishableKey: Boolean(supabaseProject.publishableKey),
    hasDatabasePassword: !supabaseProject.databaseUrl.includes('[YOUR-PASSWORD]')
  };
}
