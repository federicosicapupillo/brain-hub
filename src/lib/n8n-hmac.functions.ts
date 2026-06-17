// Server function per esporre alla UI lo stato del secret HMAC
// (senza mai esporre il valore del secret).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_HMAC_SECRET_ENV_KEY } from "@/lib/n8n-hmac";
import { hasHmacSecret } from "@/lib/n8n-hmac.server";

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

const warningsInput = z.object({
  brain_id: z.string().uuid().nullable().optional(),
});

export type N8nHmacWarning = {
  id: string;
  level: "info" | "warning" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export const getN8nHmacWarnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => warningsInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("n8n_workflow_registry" as never)
      .select(
        "id,workflow_name,real_execution_enabled,webhook_environment,hmac_signing_enabled,hmac_secret_env_key",
      )
      .eq("user_id", userId);
    if (data.brain_id) q = q.eq("brain_id", data.brain_id);
    const { data: rows } = await q;
    type Row = {
      id: string;
      workflow_name: string;
      real_execution_enabled: boolean | null;
      webhook_environment: string | null;
      hmac_signing_enabled: boolean | null;
      hmac_secret_env_key: string | null;
    };
    const list = (rows ?? []) as unknown as Row[];
    const warnings: N8nHmacWarning[] = [];
    for (const w of list) {
      if (!w.real_execution_enabled) continue;
      const envKey = (w.hmac_secret_env_key || DEFAULT_HMAC_SECRET_ENV_KEY).trim();
      if (w.hmac_signing_enabled) {
        if (!hasHmacSecret(envKey)) {
          warnings.push({
            id: `n8n_hmac_secret_missing_${w.id}`,
            level: "error",
            title: `HMAC richiesto ma secret mancante: ${w.workflow_name}`,
            description: `La variabile d'ambiente "${envKey}" non è configurata sul server. L'esecuzione sarà bloccata.`,
            cta: { label: "Apri n8n Workflows", to: "/n8n-workflows" },
          });
        }
      }
    }
    return { warnings };
  });
