import "server-only";

import { z } from "zod";

const adminEnvSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .strict();

export const adminEnv = adminEnvSchema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

export type AdminEnv = typeof adminEnv;
