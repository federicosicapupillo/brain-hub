// Server functions for OpenAI Realtime / Jack GPT Mode — GA migration (v3.12.3).
// CRITICAL: OPENAI_API_KEY stays server-side. Client only receives an ephemeral client_secret.
//
// GA endpoints:
//   - POST https://api.openai.com/v1/realtime/client_secrets  (server: mint ephemeral)
//   - POST https://api.openai.com/v1/realtime/calls           (browser: WebRTC SDP exchange)
// No "OpenAI-Beta: realtime=v1" header. No "?model=" in the SDP URL.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash } from "crypto";
import {
  JACK_GPT_SYSTEM_INSTRUCTIONS,
  JACK_GPT_VOICE_DEFAULT,
} from "@/lib/jack-gpt-instructions";
import { JACK_GPT_TOOLS_SCHEMA } from "@/lib/jack-gpt-tools";

// ---------- Constants ----------

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
export const REALTIME_INPUT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const REALTIME_INPUT_TRANSCRIPTION_LANGUAGE = "it";

// Recommended GA realtime model identifiers. Unknown values fall back with a warning.
const REALTIME_MODEL_ALLOWLIST = [
  "gpt-realtime",
  "gpt-realtime-mini",
  "gpt-realtime-2",
  "gpt-realtime-1.5",
  "gpt-4o-realtime-preview",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-realtime-preview-2024-12-17",
] as const;

export const REALTIME_CLIENT_SECRETS_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";
export const REALTIME_CALLS_ENDPOINT = "https://api.openai.com/v1/realtime/calls";

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
  api_mode: "ga";
  client_secrets_endpoint: string;
  webrtc_calls_endpoint: string;
  server_time: string;
};

// ---------- Helpers ----------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function redactDetail(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{12,}/g, "[REDACTED_KEY]")
    .replace(/ek_[A-Za-z0-9_\-]{12,}/g, "[REDACTED_EPHEMERAL]")
    .slice(0, 320);
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
  // Unknown model: keep user's value (OpenAI may know it), but warn.
  return {
    model: raw,
    source: "env",
    warning: `Modello "${raw}" non in allowlist locale: lo uso comunque ma potrebbe non essere supportato.`,
  };
}

// ---------- GA tools adapter ----------
// JACK_GPT_TOOLS_SCHEMA is already in GA shape ({type:"function", name, description, parameters}).
// This adapter is the single boundary in case OpenAI changes the wrapping.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type GaRealtimeTool = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonValue;
};

export function buildRealtimeGaToolsSchema(): GaRealtimeTool[] {
  return JACK_GPT_TOOLS_SCHEMA.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown as JsonValue,
  }));
}

export type GaRealtimeSessionConfig = {
  type: "realtime";
  model: string;
  instructions?: string;
  audio?: {
    input?: { transcription?: { model: string; language?: string } };
    output?: { voice: string };
  };
  tools?: GaRealtimeTool[];
  tool_choice?: "auto" | "none" | "required";
};

export function buildRealtimeGaSessionConfig(opts: {
  model: string;
  minimal: boolean;
}): GaRealtimeSessionConfig {
  const cfg: GaRealtimeSessionConfig = {
    type: "realtime",
    model: opts.model,
    audio: {
      input: {
        transcription: {
          model: REALTIME_INPUT_TRANSCRIPTION_MODEL,
          language: REALTIME_INPUT_TRANSCRIPTION_LANGUAGE,
        },
      },
      output: { voice: JACK_GPT_VOICE_DEFAULT },
    },
  };
  if (!opts.minimal) {
    cfg.instructions = JACK_GPT_SYSTEM_INSTRUCTIONS;
    cfg.tools = buildRealtimeGaToolsSchema();
    cfg.tool_choice = "auto";
  }
  return cfg;
}

// ---------- Status ----------

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
      api_mode: "ga",
      client_secrets_endpoint: REALTIME_CLIENT_SECRETS_ENDPOINT,
      webrtc_calls_endpoint: REALTIME_CALLS_ENDPOINT,
      server_time: new Date().toISOString(),
    };
  });

// ---------- Client secret (GA) ----------

type SessionInput = {
  brain_id?: string | null;
  mode?: string;
  context_scope?: string | null;
  /** If true, omit tools/instructions; client will push them via session.update. */
  minimal?: boolean;
  /** If true, mint a client secret then immediately discard it (diagnostic test). */
  probe_only?: boolean;
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
      api_mode: "ga";
      webrtc_calls_endpoint: string;
      instructions_for_update: string | null;
      tools_for_update: GaRealtimeTool[] | null;
      openai_request_id: string | null;
      probe: false;
    }
  | {
      ok: true;
      probe: true;
      realtime_model: string;
      model_source: RealtimeModelSource;
      model_warning: string | null;
      expires_at: number | null;
      openai_request_id: string | null;
      api_mode: "ga";
      message: string;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      detail?: string;
      openai_request_id?: string | null;
      api_mode?: "ga";
    };

type GaClientSecretResponse = {
  // GA shape: the response IS the client secret (no nested client_secret).
  value?: string;
  expires_at?: number;
  session?: { id?: string };
  // Legacy/alternate shapes — kept for resilience.
  client_secret?: { value?: string; expires_at?: number };
  id?: string;
};

export const createJackRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => (d ?? {}) as SessionInput)
  .handler(async ({ data, context }): Promise<CreateRealtimeSessionResult> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, error: "not_configured", api_mode: "ga" };

    const { model, source, warning } = resolveModel();
    const safetyId = sha256(context.userId).slice(0, 32);
    const minimal = data.minimal === true;
    const probeOnly = data.probe_only === true;

    const sessionConfig = buildRealtimeGaSessionConfig({ model, minimal: minimal || probeOnly });
    const body = { session: sessionConfig };

    let res: Response;
    try {
      res = await fetch(REALTIME_CLIENT_SECRETS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: "network_error",
        detail: redactDetail(String((err as Error).message ?? err)),
        api_mode: "ga",
      };
    }

    const requestId = res.headers.get("x-request-id");

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "client_secret_failed",
        status: res.status,
        detail: redactDetail(text),
        openai_request_id: requestId,
        api_mode: "ga",
      };
    }

    let json: GaClientSecretResponse;
    try {
      json = (await res.json()) as GaClientSecretResponse;
    } catch (err) {
      return {
        ok: false,
        error: "client_secret_parse_failed",
        detail: redactDetail(String((err as Error).message ?? err)),
        openai_request_id: requestId,
        api_mode: "ga",
      };
    }

    const clientSecret = json.value ?? json.client_secret?.value ?? null;
    const expiresAt = json.expires_at ?? json.client_secret?.expires_at ?? null;
    const sessionId = json.session?.id ?? json.id ?? null;

    if (!clientSecret) {
      return {
        ok: false,
        error: "missing_client_secret",
        openai_request_id: requestId,
        api_mode: "ga",
      };
    }

    if (probeOnly) {
      // Discard the secret immediately — don't return it to client.
      return {
        ok: true,
        probe: true,
        realtime_model: model,
        model_source: source,
        model_warning: warning,
        expires_at: expiresAt,
        openai_request_id: requestId,
        api_mode: "ga",
        message: `Sessione GA creata correttamente per ${model}.`,
      };
    }

    return {
      ok: true,
      probe: false,
      client_secret: clientSecret,
      expires_at: expiresAt,
      session_id: sessionId,
      realtime_model: model,
      model_source: source,
      model_warning: warning,
      safety_id: safetyId,
      brain_id: data.brain_id ?? null,
      mode: minimal ? "minimal" : "full",
      api_mode: "ga",
      webrtc_calls_endpoint: REALTIME_CALLS_ENDPOINT,
      instructions_for_update: minimal ? JACK_GPT_SYSTEM_INSTRUCTIONS : null,
      tools_for_update: minimal ? buildRealtimeGaToolsSchema() : null,
      openai_request_id: requestId,
    };
  });
