import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/src/lib/config/env";
import type { Database } from "@/src/lib/db/supabase";

export type SupabaseAdminClient = SupabaseClient<Database>;

export function createSupabaseAdminClient(): SupabaseAdminClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
