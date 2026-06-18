// Classifier for Jack GPT realtime start errors. No `any`, no leakage of raw payloads.

export type RealtimeStartErrorKind =
  | "model_not_found"
  | "tool_schema_validation"
  | "auth_missing"
  | "auth_invalid"
  | "network"
  | "microphone"
  | "sdp_exchange"
  | "unknown";

export type ClassifiedRealtimeStartError = {
  kind: RealtimeStartErrorKind;
  retryable_with_minimal: boolean;
  user_message: string;
  technical_message?: string;
  suggested_action?: string;
  status?: number;
};

export type RealtimeStartErrorInput = {
  error?: string;
  status?: number;
  detail?: string;
  message?: string;
};

const MODEL_HINTS = ["model_not_found", "model not found", "does not exist", "no such model"];
const VALIDATION_HINTS = [
  "invalid_request_error",
  "tools",
  "schema",
  "validation",
  "unsupported parameter",
  "unknown parameter",
  "session",
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

  if (input.error === "not_configured") {
    return {
      kind: "auth_missing",
      retryable_with_minimal: false,
      user_message: "OpenAI non è configurato. Aggiungi OPENAI_API_KEY nei secrets.",
      suggested_action: "Configura OPENAI_API_KEY nei secrets del progetto.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "auth_invalid",
      retryable_with_minimal: false,
      user_message: "Chiave OpenAI non valida o senza accesso a Realtime.",
      suggested_action: "Verifica OPENAI_API_KEY e i permessi del piano OpenAI.",
      status,
    };
  }

  if (status === 404 || looksLike(blob, MODEL_HINTS)) {
    return {
      kind: "model_not_found",
      retryable_with_minimal: false,
      user_message:
        "Il modello realtime configurato non risulta disponibile per questo account. Cambia OPENAI_REALTIME_MODEL nei secrets.",
      suggested_action:
        "Prova uno tra: gpt-realtime-2, gpt-realtime-1.5, gpt-realtime, gpt-realtime-mini.",
      status,
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
    };
  }

  if (input.error === "network_error") {
    return {
      kind: "network",
      retryable_with_minimal: false,
      user_message: "Errore di rete verso OpenAI. Riprova tra qualche istante.",
      technical_message: input.detail?.slice(0, 160),
    };
  }

  if (input.error === "sdp_exchange_failed") {
    return {
      kind: "sdp_exchange",
      retryable_with_minimal: true,
      user_message: "Negoziazione WebRTC fallita. Riprovo in modalità compatibile.",
      status,
    };
  }

  return {
    kind: "unknown",
    retryable_with_minimal: false,
    user_message: "Errore sconosciuto nell'avvio di Jack GPT.",
    technical_message: blob.slice(0, 160) || undefined,
    status,
  };
}

export const SUGGESTED_REALTIME_MODELS = [
  "gpt-realtime-2",
  "gpt-realtime-1.5",
  "gpt-realtime",
  "gpt-realtime-mini",
] as const;
