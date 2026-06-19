// Server-only helper for best-effort Jack GPT telemetry.
// Lives in a *.server.ts module so it can import server-only APIs without
// triggering the client import-protection plugin from createServerFn callers.
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type JackGptLogInput = {
  event: string;
  metadata: Record<string, unknown>;
};

export type JackGptLogResult =
  | { ok: true }
  | { ok: false; skipped: "env" | "no_auth" | "no_token" | "invalid_token" | "error" };

export async function writeJackGptEventLog(
  data: JackGptLogInput,
): Promise<JackGptLogResult> {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return { ok: false, skipped: "env" };
    }

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return { ok: false, skipped: "no_auth" };
    const token = authHeader.slice(7);
    if (!token) return { ok: false, skipped: "no_token" };

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (claimsErr || !userId) return { ok: false, skipped: "invalid_token" };

    let safe: Record<string, unknown> = {};
    try {
      safe = JSON.parse(
        JSON.stringify(data.metadata).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"),
      ) as Record<string, unknown>;
    } catch {
      safe = { _serialize_error: true };
    }

    await supabase.from("app_logs").insert({
      user_id: userId,
      entity_type: "jack_gpt",
      action: data.event,
      message: data.event,
      severity: "info",
      metadata: safe as never,
    });
    return { ok: true };
  } catch {
    return { ok: false, skipped: "error" };
  }
}
