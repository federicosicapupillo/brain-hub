// Classifier for Jack GPT realtime start errors — GA migration (v3.12.3).
// No `any`, no leakage of raw payloads.

export type RealtimeStartErrorKind =
  | "model_not_available"
  | "tool_schema_validation"
  | "auth_missing"
  | "auth_invalid"
  | "billing_or_project_access"
  | "client_secret_failed"
  | "sdp_call_failed"
  | "ga_endpoint_mismatch"
  | "network"
  | "microphone"
  | "unknown";

export type ClassifiedRealtimeStartError = {
  kind: RealtimeStartErrorKind;
  retryable_with_minimal: boolean;
  user_message: string;
  technical_message?: string;
  suggested_action?: string;
  status?: number;
  openai_request_id?: string | null;
};

export type RealtimeStartErrorInput = {
  error?: string;
  status?: number;
  detail?: string;
  message?: string;
  openai_request_id?: string | null;
};

const MODEL_HINTS = ["model_not_found", "model not found", "does not exist", "no such model"];
const VALIDATION_HINTS = [
  "invalid_request_error",
  "tools",
  "schema",
  "validation",
  "unsupported parameter",
  "unknown parameter",
  "unsupported value",
];
const BILLING_HINTS = [
  "billing",
  "quota",
  "insufficient_quota",
  "project_access",
  "no access",
  "not enabled",
];
const ENDPOINT_HINTS = [
  "endpoint",
  "not found",
  "404",
  "/v1/realtime/sessions",
  "realtime/sessions",
  "method not allowed",
];

function looksLike(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

export function classifyRealtimeStartError(
  input: RealtimeStartErrorInput,
): ClassifiedRealtimeStartError {
  const status = input.status;
  const blob = `${input.error ?? ""} ${input.detail ?? ""} ${input.message ?? ""}`.trim();
  const reqId = input.openai_request_id ?? null;

  if (input.error === "not_configured") {
    return {
      kind: "auth_missing",
      retryable_with_minimal: false,
      user_message: "OpenAI non è configurato. Aggiungi OPENAI_API_KEY nei secrets.",
      suggested_action: "Configura OPENAI_API_KEY nei secrets del progetto.",
      openai_request_id: reqId,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "auth_invalid",
      retryable_with_minimal: false,
      user_message: "Chiave OpenAI non valida o senza accesso a Realtime GA.",
      suggested_action: "Verifica OPENAI_API_KEY e i permessi del project OpenAI.",
      status,
      openai_request_id: reqId,
    };
  }

  if (status === 402 || looksLike(blob, BILLING_HINTS)) {
    return {
      kind: "billing_or_project_access",
      retryable_with_minimal: false,
      user_message:
        "Accesso al modello Realtime negato dal project OpenAI (billing o permessi).",
      suggested_action: "Controlla billing attivo e permessi project Realtime su OpenAI.",
      status,
      openai_request_id: reqId,
    };
  }

  if (status === 404 || looksLike(blob, MODEL_HINTS)) {
    return {
      kind: "model_not_available",
      retryable_with_minimal: false,
      user_message:
        "Il modello è configurato, ma la chiamata Realtime GA non è riuscita. Possibile endpoint Realtime non aggiornato, permessi project o formato sessione non valido.",
      suggested_action:
        "Prova un modello tra: gpt-realtime, gpt-realtime-mini, gpt-4o-realtime-preview.",
      status,
      openai_request_id: reqId,
    };
  }

  if (input.error === "client_secret_failed") {
    if (looksLike(blob, ENDPOINT_HINTS)) {
      return {
        kind: "ga_endpoint_mismatch",
        retryable_with_minimal: false,
        user_message:
          "Endpoint Realtime GA non raggiungibile. Verifica che il server usi /v1/realtime/client_secrets.",
        status,
        openai_request_id: reqId,
      };
    }
    return {
      kind: "client_secret_failed",
      retryable_with_minimal: status === 400 || status === 422,
      user_message: "Creazione client secret fallita su OpenAI.",
      technical_message: blob.slice(0, 160) || undefined,
      status,
      openai_request_id: reqId,
    };
  }

  if (status === 400 || status === 422 || looksLike(blob, VALIDATION_HINTS)) {
    return {
      kind: "tool_schema_validation",
      retryable_with_minimal: true,
      user_message:
        "La sessione completa è stata rifiutata da OpenAI. Riprovo in modalità compatibile.",
      technical_message: blob.slice(0, 160) || undefined,
      status,
      openai_request_id: reqId,
    };
  }

  if (input.error === "network_error") {
    return {
      kind: "network",
      retryable_with_minimal: false,
      user_message: "Errore di rete verso OpenAI. Riprova tra qualche istante.",
      technical_message: input.detail?.slice(0, 160),
      openai_request_id: reqId,
    };
  }

  if (input.error === "sdp_call_failed" || input.error === "sdp_exchange_failed") {
    return {
      kind: "sdp_call_failed",
      retryable_with_minimal: true,
      user_message: "Negoziazione WebRTC GA fallita (/v1/realtime/calls).",
      status,
      openai_request_id: reqId,
    };
  }

  return {
    kind: "unknown",
    retryable_with_minimal: false,
    user_message: "Errore sconosciuto nell'avvio di Jack GPT.",
    technical_message: blob.slice(0, 160) || undefined,
    status,
    openai_request_id: reqId,
  };
}

export const SUGGESTED_REALTIME_MODELS = [
  "gpt-realtime",
  "gpt-realtime-mini",
  "gpt-4o-realtime-preview",
] as const;
