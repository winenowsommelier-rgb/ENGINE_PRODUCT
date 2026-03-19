import { createClient } from '@supabase/supabase-js';
import { supabaseProject } from '@/lib/supabase/config';

export function createSupabaseBrowserClient() {
  return createClient(supabaseProject.url, supabaseProject.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        'x-application-name': 'winenow-flavor-intelligence-system'
      }
    }
  });
}
