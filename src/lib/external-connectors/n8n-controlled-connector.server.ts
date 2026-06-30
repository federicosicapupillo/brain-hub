// Brain Hub v3.36 — External MEDIUM Connector: n8n controlled service.
//
// Service Layer Pattern (ADR-003 / Principio 3): returns ServiceOutcome.
// The dispatcher is the only caller — never imported from a route, the
// UI or a client bundle. The webhook URL is read exclusively from the
// workflow's declared env var (never from the client, never persisted).
//
// Failure-mode contract:
//   - env var missing           → trust.status="missing", data=null
//   - timeout / network error   → trust.status="error",   data has error_kind="network"
//   - non-2xx                   → trust.status="error",   data has http_status
//   - non-JSON / shape invalid  → trust.status="error",   data has error_kind="shape"
//   - 2xx + shape valid         → trust.status="live"

import {
  type ServiceOutcome,
  liveOutcome,
  missingOutcome,
} from "@/lib/service-outcome";
import type { DataTrust } from "@/lib/data-trust/types";
import {
  previewResponseText,
  redactString,
} from "@/lib/execute-dispatcher/external-validators";
import type { N8nControlledWorkflowEntry } from "@/lib/execute-dispatcher/n8n-controlled-workflows";

const SERVICE_FN = "n8nControlledConnector.invoke";
const SOURCE_TABLES: string[] = []; // pure outbound — no DB read

export interface N8nControlledConnectorRequest {
  workflow: N8nControlledWorkflowEntry;
  title: string;
  message: string;
  correlation_id: string;
  metadata?: Record<string, unknown> | null;
}

export interface N8nControlledConnectorResult {
  ok: boolean;
  http_status: number | null;
  external_reference_id: string | null;
  response_preview_redacted: string;
  timing_ms: number;
  error_kind:
    | "none"
    | "env_missing"
    | "network"
    | "timeout"
    | "http_4xx"
    | "http_5xx"
    | "shape";
  safe_error_message: string | null;
}

function safeMessage(err: unknown, fallback: string): string {
  const m = (err as { message?: string } | null)?.message ?? fallback;
  return redactString(m).slice(0, 240);
}

/**
 * Invoke the controlled n8n webhook. NEVER throws — always returns a
 * ServiceOutcome that the dispatcher can serialize into a receipt.
 */
export async function invokeN8nControlledWorkflow(
  req: N8nControlledConnectorRequest,
): Promise<ServiceOutcome<N8nControlledConnectorResult>> {
  const meta = {
    source_tables: SOURCE_TABLES,
    source_function: SERVICE_FN,
  };
  const t0 = Date.now();

  // 1. Resolve URL only from env. NEVER from the client.
  const envVarName = req.workflow.endpoint_env_var;
  const url = (process.env as Record<string, string | undefined>)[envVarName];
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return missingOutcome<N8nControlledConnectorResult>(
      meta,
      `endpoint_env_missing:${envVarName}`,
    );
  }

  // 2. Build redacted-safe payload. Never forward Authorization headers.
  const body = {
    workflow_key: req.workflow.workflow_key,
    title: req.title,
    message: req.message,
    correlation_id: req.correlation_id,
    metadata: req.metadata ?? null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.workflow.timeout_ms);
  let http_status: number | null = null;
  let response_preview_redacted = "";
  let external_reference_id: string | null = null;
  let error_kind: N8nControlledConnectorResult["error_kind"] = "none";
  let safe_error_message: string | null = null;
  let ok = false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    http_status = res.status;
    const text = await res.text();
    response_preview_redacted = previewResponseText(
      text,
      req.workflow.expected_response_shape.max_preview_bytes,
      req.workflow.redaction_rules,
    );
    if (!res.ok) {
      ok = false;
      error_kind = res.status >= 500 ? "http_5xx" : "http_4xx";
      safe_error_message = `http_${res.status}`;
    } else {
      // Shape check (lenient): expect JSON object if declared.
      if (req.workflow.expected_response_shape.kind === "json_object") {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            ok = false;
            error_kind = "shape";
            safe_error_message = "invalid_response_shape";
          } else {
            ok = true;
            const ref =
              (parsed as Record<string, unknown>).external_reference_id ??
              (parsed as Record<string, unknown>).executionId ??
              (parsed as Record<string, unknown>).id;
            if (typeof ref === "string" && ref.length <= 240) {
              external_reference_id = redactString(ref);
            } else if (typeof ref === "number") {
              external_reference_id = String(ref);
            }
          }
        } catch {
          ok = false;
          error_kind = "shape";
          safe_error_message = "invalid_response_shape";
        }
      } else {
        ok = true;
      }
    }
  } catch (err) {
    const aborted =
      (err as { name?: string } | null)?.name === "AbortError" ||
      controller.signal.aborted;
    ok = false;
    error_kind = aborted ? "timeout" : "network";
    safe_error_message = aborted
      ? "n8n_timeout"
      : safeMessage(err, "n8n_network_failed");
  } finally {
    clearTimeout(timer);
  }

  const duration_ms = Date.now() - t0;
  const data: N8nControlledConnectorResult = {
    ok,
    http_status,
    external_reference_id,
    response_preview_redacted,
    timing_ms: duration_ms,
    error_kind,
    safe_error_message,
  };
  if (ok) {
    return liveOutcome(data, meta, duration_ms);
  }
  const errorTrust: DataTrust = {
    status: "error",
    confidence: 0,
    calculation_method: "direct_source",
    provenance: {
      source_tables: meta.source_tables,
      source_functions: [meta.source_function],
    },
    freshness: null,
    warnings: [`n8n_${error_kind}`],
  };
  return {
    data,
    trust: errorTrust,
    error_safe_message: safe_error_message ?? "n8n_failed",
    duration_ms,
  };
}
