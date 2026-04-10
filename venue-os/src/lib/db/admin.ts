import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminEnv } from "../config/admin-env";
import type { Database } from "./supabase";

export type SupabaseAdminClient = SupabaseClient<Database>;

export function createSupabaseAdminClient(): SupabaseAdminClient {
  return createClient<Database>(adminEnv.SUPABASE_URL, adminEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
