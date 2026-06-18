// Server functions for OpenAI Realtime / Jack GPT Mode.
// CRITICAL: OPENAI_API_KEY stays server-side. Client only receives an ephemeral client_secret.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash } from "crypto";
import {
  JACK_GPT_SYSTEM_INSTRUCTIONS,
  JACK_GPT_VOICE_DEFAULT,
} from "@/lib/jack-gpt-instructions";
import { JACK_GPT_TOOLS_SCHEMA } from "@/lib/jack-gpt-tools";

// Default realtime model (v3.12.1)
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";

// Allowlist of recommended realtime models. Unknown values fall back to default
// but do NOT block the app — we surface a warning instead.
const REALTIME_MODEL_ALLOWLIST = [
  "gpt-realtime-2",
  "gpt-realtime-1.5",
  "gpt-realtime",
  "gpt-realtime-mini",
] as const;

export type RealtimeModelSource = "env" | "default" | "fallback";

export type OpenAiRealtimeStatus = {
  configured: boolean;
  has_api_key: boolean;
  model: string;
  model_source: RealtimeModelSource;
  model_warning: string | null;
  realtime_ready: boolean;
  privacy_mode: "ephemeral_token_only";
  provider: "openai";
  server_time: string;
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function resolveModel(): {
  model: string;
  source: RealtimeModelSource;
  warning: string | null;
} {
  const raw = (process.env.OPENAI_REALTIME_MODEL ?? "").trim();
  if (!raw) return { model: DEFAULT_REALTIME_MODEL, source: "default", warning: null };
  if ((REALTIME_MODEL_ALLOWLIST as readonly string[]).includes(raw)) {
    return { model: raw, source: "env", warning: null };
  }
  return {
    model: DEFAULT_REALTIME_MODEL,
    source: "fallback",
    warning: `Modello "${raw}" non riconosciuto: uso ${DEFAULT_REALTIME_MODEL}.`,
  };
}

export const getOpenAiRealtimeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<OpenAiRealtimeStatus> => {
    const hasKey = !!process.env.OPENAI_API_KEY;
    const { model, source, warning } = resolveModel();
    return {
      configured: hasKey,
      has_api_key: hasKey,
      model,
      model_source: source,
      model_warning: warning,
      realtime_ready: hasKey,
      privacy_mode: "ephemeral_token_only",
      provider: "openai",
      server_time: new Date().toISOString(),
    };
  });

type SessionInput = {
  brain_id?: string | null;
  mode?: string;
  context_scope?: string | null;
  /** If true, omit tools/instructions from the create call so the client can send them via session.update. */
  minimal?: boolean;
};

export type CreateRealtimeSessionResult =
  | {
      ok: true;
      client_secret: string;
      expires_at: number | null;
      session_id: string | null;
      realtime_model: string;
      model_source: RealtimeModelSource;
      model_warning: string | null;
      safety_id: string;
      brain_id: string | null;
      mode: "full" | "minimal";
      instructions_for_update: string | null;
      tools_for_update: typeof JACK_GPT_TOOLS_SCHEMA | null;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      detail?: string;
    };

export const createJackRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => (d ?? {}) as SessionInput)
  .handler(async ({ data, context }): Promise<CreateRealtimeSessionResult> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, error: "not_configured" };

    const { model, source, warning } = resolveModel();
    const safetyId = sha256(context.userId).slice(0, 32);
    const minimal = data.minimal === true;

    const baseBody: Record<string, unknown> = {
      model,
      voice: JACK_GPT_VOICE_DEFAULT,
      modalities: ["audio", "text"],
      turn_detection: { type: "server_vad" },
      input_audio_transcription: { model: "whisper-1" },
    };
    if (!minimal) {
      baseBody.instructions = JACK_GPT_SYSTEM_INSTRUCTIONS;
      baseBody.tools = JACK_GPT_TOOLS_SCHEMA;
      baseBody.tool_choice = "auto";
    }

    try {
      const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        body: JSON.stringify(baseBody),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false,
          error: "openai_session_failed",
          status: res.status,
          detail: text.slice(0, 240).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]"),
        };
      }
      const json = (await res.json()) as {
        client_secret?: { value?: string; expires_at?: number };
        id?: string;
      };
      const clientSecret = json.client_secret?.value;
      if (!clientSecret) return { ok: false, error: "missing_client_secret" };

      return {
        ok: true,
        client_secret: clientSecret,
        expires_at: json.client_secret?.expires_at ?? null,
        session_id: json.id ?? null,
        realtime_model: model,
        model_source: source,
        model_warning: warning,
        safety_id: safetyId,
        brain_id: data.brain_id ?? null,
        mode: minimal ? "minimal" : "full",
        instructions_for_update: minimal ? JACK_GPT_SYSTEM_INSTRUCTIONS : null,
        tools_for_update: minimal ? JACK_GPT_TOOLS_SCHEMA : null,
      };
    } catch (err) {
      return {
        ok: false,
        error: "network_error",
        detail: String((err as Error).message ?? err).slice(0, 200),
      };
    }
  });
