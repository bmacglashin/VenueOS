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
          outbound_mode_override: string | null;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          ghl_location_id?: string | null;
          outbound_mode_override?: string | null;
          slug: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          ghl_location_id?: string | null;
          outbound_mode_override?: string | null;
          slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
        Relationships: [];
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
          policy_decision: string | null;
          policy_reasons: Json;
          policy_evaluated_at: string | null;
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
          policy_decision?: string | null;
          policy_reasons?: Json;
          policy_evaluated_at?: string | null;
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
          policy_decision?: string | null;
          policy_reasons?: Json;
          policy_evaluated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          tenant_id: string;
          event_type: string;
          request_id: string;
          trace_id: string;
          error_type: string | null;
          payload: Json;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_type: string;
          request_id: string;
          trace_id: string;
          error_type?: string | null;
          payload?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_type?: string;
          request_id?: string;
          trace_id?: string;
          error_type?: string | null;
          payload?: Json;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      processed_webhook_events: {
        Row: {
          id: string;
          source: string;
          idempotency_key: string;
          tenant_id: string | null;
          status: string;
          upstream_event_id: string | null;
          upstream_message_id: string | null;
          request_id: string;
          trace_id: string;
          payload: Json;
          response_payload: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          idempotency_key: string;
          tenant_id?: string | null;
          status?: string;
          upstream_event_id?: string | null;
          upstream_message_id?: string | null;
          request_id: string;
          trace_id: string;
          payload?: Json;
          response_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          idempotency_key?: string;
          tenant_id?: string | null;
          status?: string;
          upstream_event_id?: string | null;
          upstream_message_id?: string | null;
          request_id?: string;
          trace_id?: string;
          payload?: Json;
          response_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_sources: {
        Row: {
          id: string;
          tenant_id: string;
          source_type: string;
          source_name: string;
          source_ref: string | null;
          file_name: string | null;
          content: string;
          checksum: string;
          revision: string;
          ingested_at: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          source_type: string;
          source_name: string;
          source_ref?: string | null;
          file_name?: string | null;
          content: string;
          checksum: string;
          revision: string;
          ingested_at?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          source_type?: string;
          source_name?: string;
          source_ref?: string | null;
          file_name?: string | null;
          content?: string;
          checksum?: string;
          revision?: string;
          ingested_at?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
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
