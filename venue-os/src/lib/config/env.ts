import "server-only";

import { z } from "zod";

import { OUTBOUND_MODES } from "@/src/lib/config/outbound";

const envSchema = z
  .object({
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    GOOGLE_MODEL: z.string().min(1),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    OUTBOUND_MODE: z.enum(OUTBOUND_MODES).default("review_only"),
  })
  .strict();

export const env = envSchema.parse({
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  GOOGLE_MODEL: process.env.GOOGLE_MODEL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  OUTBOUND_MODE: process.env.OUTBOUND_MODE,
});

export type Env = typeof env;
