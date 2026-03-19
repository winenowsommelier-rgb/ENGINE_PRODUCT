import { supabaseProject } from '@/lib/supabase/config';

export type SupabaseBrowserClientConfig = {
  url: string;
  publishableKey: string;
  headers: Record<string, string>;
};

export function createSupabaseBrowserClient(): SupabaseBrowserClientConfig {
  return {
    url: supabaseProject.url,
    publishableKey: supabaseProject.publishableKey,
    headers: {
      apikey: supabaseProject.publishableKey,
      Authorization: `Bearer ${supabaseProject.publishableKey}`,
      'x-application-name': 'winenow-flavor-intelligence-system'
    }
  };
}
