// Server function per esporre alla UI lo stato del secret HMAC
// (senza mai esporre il valore del secret).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_HMAC_SECRET_ENV_KEY, hasHmacSecret } from "@/lib/n8n-hmac";

const inputSchema = z.object({
  env_keys: z.array(z.string().min(1).max(256)).max(20).optional(),
});

export const getN8nHmacSecretStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const keys = (data.env_keys && data.env_keys.length > 0
      ? data.env_keys
      : [DEFAULT_HMAC_SECRET_ENV_KEY]) as string[];
    const status: Record<string, boolean> = {};
    for (const k of keys) status[k] = hasHmacSecret(k);
    return {
      default_env_key: DEFAULT_HMAC_SECRET_ENV_KEY,
      configured: status,
    };
  });
