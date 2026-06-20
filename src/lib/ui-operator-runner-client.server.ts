// Brain Hub v3.23.1 — UI Operator runner HTTP client (server-only).
// Talks to the external Node UI Operator Runner. Never imported by client code.
// All responses are JSON-safe. Never throws — always returns a typed payload.

import type {
  RunnerEndpoint,
  RunnerErrorResponse,
  RunnerExecuteActionRequest,
  RunnerExecuteActionResponse,
  RunnerHealthResponse,
  RunnerObserveRequest,
  RunnerObserveResponse,
  RunnerOpenRouteRequest,
  RunnerOpenRouteResponse,
  RunnerProposeActionRequest,
  RunnerProposeActionResponse,
  RunnerStartSessionRequest,
  RunnerStartSessionResponse,
  RunnerStopSessionRequest,
  RunnerStopSessionResponse,
} from "./ui-operator-runner-contract";

const DEFAULT_TIMEOUT_MS = 25_000;
const HEALTH_TIMEOUT_MS = 5_000;

export interface UiOperatorRunnerConfig {
  configured: boolean;
  runner_url_present: boolean;
  runner_secret_present: boolean;
  base_url: string | null;
}

export function getUiOperatorRunnerConfig(): UiOperatorRunnerConfig {
  const url = (process.env.UI_OPERATOR_RUNNER_URL ?? "").trim();
  const secret = (process.env.UI_OPERATOR_RUNNER_SECRET ?? "").trim();
  const urlOk = url.length > 0 && /^https?:\/\//i.test(url);
  return {
    configured: urlOk && secret.length > 0,
    runner_url_present: urlOk,
    runner_secret_present: secret.length > 0,
    base_url: urlOk ? url.replace(/\/+$/, "") : null,
  };
}

export function isUiOperatorRunnerConfigured(): boolean {
  return getUiOperatorRunnerConfig().configured;
}

function safeFail(
  status: RunnerErrorResponse["status"],
  error_code: string,
  safe_message: string,
): RunnerErrorResponse {
  return { ok: false, status, error_code, safe_message, data: null };
}

async function hmacHex(secret: string, body: string): Promise<string | null> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function callUiOperatorRunner<TRes>(
  endpoint: RunnerEndpoint,
  payload: unknown,
  opts?: { timeoutMs?: number; method?: "GET" | "POST" },
): Promise<TRes | RunnerErrorResponse> {
  const cfg = getUiOperatorRunnerConfig();
  if (!cfg.configured || !cfg.base_url) {
    return safeFail(
      "not_configured",
      "runner_not_configured",
      "UI Operator Runner non configurato.",
    );
  }
  const secret = (process.env.UI_OPERATOR_RUNNER_SECRET ?? "").trim();
  const method = opts?.method ?? "POST";
  const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
  const sig = method === "GET" ? null : await hmacHex(secret, body);
  const url = `${cfg.base_url}${endpoint}`;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        ...(sig ? { "x-brainhub-signature": sig } : {}),
      },
      body: method === "GET" ? undefined : body,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      return safeFail(
        res.status === 401 ? "unauthorized" : "error",
        `runner_http_${res.status}`,
        `Runner ha risposto con status ${res.status}.`,
      );
    }
    if (!parsed || typeof parsed !== "object") {
      return safeFail("error", "runner_invalid_payload", "Risposta runner non valida.");
    }
    return parsed as TRes;
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    return safeFail(
      aborted ? "timeout" : "unreachable",
      aborted ? "runner_timeout" : "runner_unreachable",
      aborted ? "Runner timeout." : "Runner non raggiungibile.",
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------- endpoint helpers ----------
export async function pingUiOperatorRunner(): Promise<RunnerHealthResponse> {
  const started = Date.now();
  const res = await callUiOperatorRunner<RunnerHealthResponse>("/health", null, {
    method: "GET",
    timeoutMs: HEALTH_TIMEOUT_MS,
  });
  if ("ok" in res && res.ok) return res;
  const fail = res as RunnerErrorResponse;
  return {
    ok: false,
    status: fail.status,
    safe_message: fail.safe_message,
    error_code: fail.error_code,
    data: { runner_version: undefined } as RunnerHealthResponse["data"],
    // expose latency budget via safe_message only
    ...(started ? {} : {}),
  };
}

export function startRunnerSession(
  input: RunnerStartSessionRequest,
): Promise<RunnerStartSessionResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerStartSessionResponse>("/session/start", input);
}

export function openRunnerRoute(
  input: RunnerOpenRouteRequest,
): Promise<RunnerOpenRouteResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerOpenRouteResponse>("/session/open-route", input);
}

export function observeRunnerScreen(
  input: RunnerObserveRequest,
): Promise<RunnerObserveResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerObserveResponse>("/session/observe", input);
}

export function proposeRunnerAction(
  input: RunnerProposeActionRequest,
): Promise<RunnerProposeActionResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerProposeActionResponse>("/action/propose", input);
}

export function executeRunnerAction(
  input: RunnerExecuteActionRequest,
): Promise<RunnerExecuteActionResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerExecuteActionResponse>("/action/execute", input);
}

export function stopRunnerSession(
  input: RunnerStopSessionRequest,
): Promise<RunnerStopSessionResponse | RunnerErrorResponse> {
  return callUiOperatorRunner<RunnerStopSessionResponse>("/session/stop", input);
}
