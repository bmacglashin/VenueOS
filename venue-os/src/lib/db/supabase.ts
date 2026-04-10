import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env } from "@/src/lib/config/env";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      venue_tenants: {
        Row: {
          id: string;
          name: string;
          ghl_location_id: string | null;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          ghl_location_id?: string | null;
          slug: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          ghl_location_id?: string | null;
          slug?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          ghl_contact_id: string | null;
          ghl_conversation_id: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          ghl_contact_id?: string | null;
          ghl_conversation_id?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          ghl_contact_id?: string | null;
          ghl_conversation_id?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: string;
          content: string;
          direction: string;
          ghl_message_id: string | null;
          source: string;
          status: string;
          raw_payload: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: string;
          content: string;
          direction: string;
          ghl_message_id?: string | null;
          source: string;
          status?: string;
          raw_payload?: Json;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: string;
          content?: string;
          direction?: string;
          ghl_message_id?: string | null;
          source?: string;
          status?: string;
          raw_payload?: Json;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};

export type SupabaseAnonClient = SupabaseClient<Database>;

export function createSupabaseBrowserClient(): SupabaseAnonClient {
  return createBrowserClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export async function createSupabaseServerClient(): Promise<SupabaseAnonClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // No-op in Server Components where cookie writes are not available.
        }
      },
    },
  });
}
