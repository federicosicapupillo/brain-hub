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

const DEFAULT_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export const getOpenAiRealtimeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const hasKey = !!process.env.OPENAI_API_KEY;
    const modelEnv = process.env.OPENAI_REALTIME_MODEL;
    return {
      configured: hasKey,
      model_configured: !!modelEnv,
      realtime_model: hasKey ? (modelEnv || DEFAULT_REALTIME_MODEL) : null,
      provider: "openai" as const,
    };
  });

type SessionInput = {
  brain_id?: string | null;
  mode?: string;
  context_scope?: string | null;
};

export const createJackRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => (d ?? {}) as SessionInput)
  .handler(async ({ data, context }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "not_configured" };
    }
    const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
    const safetyId = sha256(context.userId).slice(0, 32);

    const body = {
      model,
      voice: JACK_GPT_VOICE_DEFAULT,
      modalities: ["audio", "text"],
      instructions: JACK_GPT_SYSTEM_INSTRUCTIONS,
      tools: JACK_GPT_TOOLS_SCHEMA,
      tool_choice: "auto",
      turn_detection: { type: "server_vad" },
      input_audio_transcription: { model: "whisper-1" },
    };

    try {
      const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false as const,
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
      if (!clientSecret) {
        return { ok: false as const, error: "missing_client_secret" };
      }
      return {
        ok: true as const,
        client_secret: clientSecret,
        expires_at: json.client_secret?.expires_at ?? null,
        session_id: json.id ?? null,
        realtime_model: model,
        safety_id: safetyId,
        brain_id: data.brain_id ?? null,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: "network_error",
        detail: String((err as Error).message ?? err).slice(0, 200),
      };
    }
  });
