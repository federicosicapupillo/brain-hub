// Brain Hub v3.35b — External Execute Dispatcher (sandbox foundation).
//
// SINGLE WRITE PATH for external action_type values declared in
// `./external-registry.ts`. Pipeline mirrors v3.35a.1 (gate-first
// idempotency) and reuses Governance Evaluator + RBAC unchanged.
//
//   1. Resolve action_type via the external registry (allowlist).
//      Unknown → rejected_unknown_action. enabled=false → rejected_disabled.
//   2. Validate payload (strict allowlist + sensitive-field rejection).
//   3. Live execute → require Confirm signal + confirmation_id metadata.
//   4. Governance Evaluator (action = "execute_external_action"; risk
//      from registry — sandbox is LOW).
//   5. Idempotency GATE (same gate-first scheme as v3.35a.1).
//   6. Write artifact row (reusing internal_execute_artifacts; payload
//      stores execute_scope:"external" + redacted payload preview).
//   7. Execute handler (dry_run = no network; live = sandbox endpoint).
//   8. Write immutable Receipt; stamp gate with receipt_id.
//
// NOT IMPLEMENTED in v3.35b (declared debt):
//   - Orphan Gate Reaper (winner crash before step 8 leaves a NULL
//     gate row). Inherited from v3.35a.1; scheduled for v3.35c.
//   - External rollback (registry says supports_rollback=false).
//   - HIGH external actions (none declared in registry).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateAction,
  type GovernanceRequest,
  type GovernanceResult,
} from "@/lib/governance/governanceEvaluator";
import type { Database } from "@/integrations/supabase/types";
import type { ExecuteReceipt } from "./types";
import {
  EXTERNAL_SANDBOX_TARGET_PATH,
  getExternalAction,
  type ExternalActionEntry,
} from "./external-registry";
import {
  hashRequest,
  previewResponseText,
  redactObject,
  validateExternalPayload,
} from "./external-validators";

const CONFIRM_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_PROJECT_ID = "brainhub-os";

type AdminClient = SupabaseClient<Database>;

export interface ExternalDispatchEnv {
  admin: AdminClient;
  userId: string;
  executor?: string;
  /** Absolute origin where the sandbox target endpoint is served. */
  selfOrigin: string;
}

export interface ExternalDispatchRequest {
  action_type: string;
  idempotency_key: string;
  /** Confirm signal is required for live_execute; ignored for dry_run. */
  confirmed_at?: string;
  confirmation_source?: "ui_button" | "voice_confirm" | "keyboard_enter";
  confirmation_id?: string | null;
  payload: Record<string, unknown>;
  project_id?: string;
  requested_by_label?: string;
}

export type ExternalDispatchStatus =
  | "executed"
  | "replayed"
  | "rejected_governance"
  | "rejected_confirm"
  | "rejected_validation"
  | "rejected_unknown_action"
  | "rejected_disabled"
  | "rejected_high_risk_blocked"
  | "rollback_not_supported"
  | "failed";

export interface ExternalDispatchResponse {
  ok: boolean;
  status: ExternalDispatchStatus;
  receipt: ExecuteReceipt | null;
  safe_message: string;
}

interface ReceiptRow {
  receipt_id: string;
  action_id: string | null;
  action_type: string;
  risk_level: string;
  requested_by: string;
  approved_by: string | null;
  executed_by: string;
  started_at: string;
  completed_at: string | null;
  result: string;
  rollback_available: boolean;
  external_reference: string | null;
  audit_record: unknown;
  related_receipt_id: string | null;
  idempotency_key: string | null;
  safe_error_message: string | null;
}

function rowToReceipt(r: ReceiptRow): ExecuteReceipt {
  return {
    receipt_id: r.receipt_id,
    action_id: r.action_id ?? "",
    action_type: r.action_type as ExecuteReceipt["action_type"],
    risk_level: r.risk_level as ExecuteReceipt["risk_level"],
    requested_by: r.requested_by,
    approved_by: r.approved_by,
    executed_by: r.executed_by,
    started_at: r.started_at,
    completed_at: r.completed_at,
    result: r.result as ExecuteReceipt["result"],
    rollback_available: r.rollback_available,
    external_reference: r.external_reference,
    audit_record:
      typeof r.audit_record === "string"
        ? r.audit_record
        : JSON.stringify(r.audit_record ?? {}),
    related_receipt_id: r.related_receipt_id,
    idempotency_key: r.idempotency_key,
    safe_error_message: r.safe_error_message,
  };
}

function safe(err: unknown, fb = "external_execute_failed"): string {
  const m = (err as { message?: string } | null)?.message ?? fb;
  return m
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/g, "[redacted-email]")
    .slice(0, 240);
}

function isFreshConfirm(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const age = Date.now() - t;
  return age >= 0 && age <= CONFIRM_MAX_AGE_MS;
}

async function findExistingReceipt(
  env: ExternalDispatchEnv,
  idempotency_key: string,
): Promise<ExecuteReceipt | null> {
  const ATTEMPTS = 20;
  const DELAY_MS = 100;
  for (let i = 0; i < ATTEMPTS; i++) {
    const { data: idem, error } = await env.admin
      .from("execute_idempotency")
      .select("receipt_id")
      .eq("owner_id", env.userId)
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();
    if (error || !idem) return null;
    if (idem.receipt_id) {
      const { data: r } = await env.admin
        .from("execute_receipts")
        .select("*")
        .eq("receipt_id", idem.receipt_id)
        .maybeSingle();
      return r ? rowToReceipt(r as ReceiptRow) : null;
    }
    await new Promise((res) => setTimeout(res, DELAY_MS));
  }
  return null;
}

async function writeReceipt(
  env: ExternalDispatchEnv,
  partial: Omit<ExecuteReceipt, "receipt_id">,
): Promise<ExecuteReceipt | null> {
  const { data, error } = await env.admin
    .from("execute_receipts")
    .insert({
      owner_id: env.userId,
      action_id: partial.action_id || null,
      action_type: partial.action_type,
      risk_level: partial.risk_level,
      requested_by: partial.requested_by,
      approved_by: partial.approved_by,
      executed_by: partial.executed_by,
      started_at: partial.started_at,
      completed_at: partial.completed_at,
      result: partial.result,
      rollback_available: partial.rollback_available,
      external_reference: partial.external_reference,
      audit_record:
        typeof partial.audit_record === "string"
          ? safeParseJson(partial.audit_record)
          : partial.audit_record,
      related_receipt_id: partial.related_receipt_id ?? null,
      idempotency_key: partial.idempotency_key ?? null,
      safe_error_message: partial.safe_error_message ?? null,
    } as never)
    .select("*")
    .single();
  if (error || !data) return null;
  return rowToReceipt(data as ReceiptRow);
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

// ---------------------------------------------------------------------------
// Handlers — explicit map. Adding a handler REQUIRES adding a registry
// entry too. No dynamic string-based handler lookup is allowed.
// ---------------------------------------------------------------------------

interface HandlerContext {
  env: ExternalDispatchEnv;
  entry: ExternalActionEntry;
  payload: {
    message: string;
    correlation_id: string;
    dry_run: boolean;
    live_execute: boolean;
    confirmation_id: string | null;
  };
}

interface HandlerResult {
  ok: boolean;
  external_reference: string | null;
  response_preview_redacted: string;
  http_status: number | null;
  timing_ms: number;
  error?: string;
}

async function handlerExternalWebhookTestPing(
  ctx: HandlerContext,
): Promise<HandlerResult> {
  const started = Date.now();
  if (ctx.payload.dry_run) {
    return {
      ok: true,
      external_reference: null,
      response_preview_redacted: JSON.stringify({
        mode: "dry_run",
        message: ctx.payload.message.slice(0, 80),
        correlation_id: ctx.payload.correlation_id,
      }),
      http_status: null,
      timing_ms: Date.now() - started,
    };
  }
  const url = new URL(EXTERNAL_SANDBOX_TARGET_PATH, ctx.env.selfOrigin).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.entry.timeout_ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: ctx.payload.message,
        correlation_id: ctx.payload.correlation_id,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    const preview = previewResponseText(
      text,
      ctx.entry.expected_response_shape.max_preview_bytes,
      ctx.entry.sensitive_fields_redaction,
    );
    return {
      ok: res.ok,
      external_reference: res.headers.get("x-correlation-id"),
      response_preview_redacted: preview,
      http_status: res.status,
      timing_ms: Date.now() - started,
      error: res.ok ? undefined : `http_${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      external_reference: null,
      response_preview_redacted: "",
      http_status: null,
      timing_ms: Date.now() - started,
      error: safe(err, "fetch_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

const HANDLERS: Readonly<Record<string, (c: HandlerContext) => Promise<HandlerResult>>> =
  Object.freeze({
    external_webhook_test_ping: handlerExternalWebhookTestPing,
  });

// ---------------------------------------------------------------------------

export async function executeExternalAction(
  env: ExternalDispatchEnv,
  req: ExternalDispatchRequest,
): Promise<ExternalDispatchResponse> {
  const started_at = new Date().toISOString();
  const executor = env.executor ?? "system:external-execute-dispatcher";
  const requested_by = req.requested_by_label ?? `user:${env.userId}`;

  // 1. Registry lookup.
  const entry = getExternalAction(req.action_type);
  if (!entry) {
    return {
      ok: false,
      status: "rejected_unknown_action",
      receipt: null,
      safe_message: `unknown_external_action:${req.action_type}`,
    };
  }
  if (!entry.enabled) {
    return {
      ok: false,
      status: "rejected_disabled",
      receipt: null,
      safe_message: `disabled_external_action:${req.action_type}`,
    };
  }
  if (entry.risk_level === "high" || entry.risk_level === "critical") {
    return {
      ok: false,
      status: "rejected_high_risk_blocked",
      receipt: null,
      safe_message: `high_risk_external_blocked:${req.action_type}`,
    };
  }
  const handler = HANDLERS[entry.handler_name];
  if (!handler) {
    return {
      ok: false,
      status: "rejected_unknown_action",
      receipt: null,
      safe_message: `handler_not_registered:${entry.handler_name}`,
    };
  }

  // 2. Payload validation.
  const validation = validateExternalPayload(entry, req.payload);
  if (!validation.ok) {
    return {
      ok: false,
      status: "rejected_validation",
      receipt: null,
      safe_message: validation.message,
    };
  }
  const payload = validation.value;
  if (payload.live_execute && !entry.supports_live_execute) {
    return {
      ok: false,
      status: "rejected_validation",
      receipt: null,
      safe_message: "live_execute_not_supported",
    };
  }
  if (payload.dry_run && !entry.supports_dry_run) {
    return {
      ok: false,
      status: "rejected_validation",
      receipt: null,
      safe_message: "dry_run_not_supported",
    };
  }

  // 3. Confirm gate (live only).
  if (payload.live_execute) {
    if (entry.requires_confirmation) {
      if (!isFreshConfirm(req.confirmed_at) || !payload.confirmation_id) {
        return {
          ok: false,
          status: "rejected_confirm",
          receipt: null,
          safe_message: "confirm_missing_or_stale",
        };
      }
    }
  }

  // 4. Governance.
  const govRequest: GovernanceRequest = {
    action: "execute_external_action",
    entity: { type: "user", id: env.userId },
    project_id: req.project_id ?? DEFAULT_PROJECT_ID,
    context_active_project_id: req.project_id ?? DEFAULT_PROJECT_ID,
    risk_level: entry.risk_level,
    requires_confirmation: payload.live_execute && entry.requires_confirmation,
  };
  let gov: GovernanceResult;
  try {
    gov = evaluateAction(govRequest);
  } catch (err) {
    return {
      ok: false,
      status: "rejected_governance",
      receipt: null,
      safe_message: safe(err, "governance_crash"),
    };
  }
  if (!gov.allowed) {
    const failed = await writeReceipt(env, {
      action_id: "",
      action_type: entry.action_type as unknown as ExecuteReceipt["action_type"],
      risk_level: entry.risk_level,
      requested_by,
      approved_by: requested_by,
      executed_by: executor,
      started_at,
      completed_at: new Date().toISOString(),
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record: JSON.stringify({
        ...gov.audit_record,
        execute_scope: "external",
        external_action_type: entry.action_type,
        connector_name: entry.connector_name,
      }),
      idempotency_key: req.idempotency_key,
      safe_error_message: `governance_denied:${gov.reason}`,
    });
    return {
      ok: false,
      status: "rejected_governance",
      receipt: failed,
      safe_message: `governance_denied:${gov.reason}`,
    };
  }

  // 5. Idempotency gate-first (race-safe). Reuse v3.35a.1 pattern.
  //    NOTE (v3.35b debt): winner crash between gate insert and
  //    receipt_id stamping leaves a NULL row → "orphan gate". Reaper
  //    intentionally NOT implemented; scheduled for v3.35c.
  const { error: gateErr } = await env.admin
    .from("execute_idempotency")
    .insert({
      owner_id: env.userId,
      idempotency_key: req.idempotency_key,
      receipt_id: null,
      action_type: entry.action_type,
    } as never);
  if (gateErr) {
    const canonical = await findExistingReceipt(env, req.idempotency_key);
    if (canonical) {
      return {
        ok: true,
        status: "replayed",
        receipt: canonical,
        safe_message: "idempotent_replay",
      };
    }
    return {
      ok: false,
      status: "failed",
      receipt: null,
      safe_message: safe(gateErr, "idempotency_gate_failed"),
    };
  }

  // 6. Write artifact (reuses internal_execute_artifacts table; the
  //    payload column carries execute_scope and redacted preview).
  const request_hash = hashRequest({
    a: entry.action_type,
    p: payload,
  });
  const redactedPayloadPreview = redactObject(
    payload as unknown as Record<string, unknown>,
    entry.sensitive_fields_redaction,
  );
  let artifactId = "";
  try {
    const { data: artifact, error: artErr } = await env.admin
      .from("internal_execute_artifacts")
      .insert({
        owner_id: env.userId,
        action_type: entry.action_type,
        risk_level: entry.risk_level,
        title: `[external] ${entry.action_type} ${payload.correlation_id}`,
        payload: {
          execute_scope: "external",
          external_action_type: entry.action_type,
          connector_name: entry.connector_name,
          handler_name: entry.handler_name,
          dry_run: payload.dry_run,
          live_execute: payload.live_execute,
          confirmation_id: payload.confirmation_id,
          request_hash,
          payload_preview_redacted: redactedPayloadPreview,
        },
      } as never)
      .select("id")
      .single();
    if (artErr || !artifact) throw new Error(artErr?.message ?? "insert_failed");
    artifactId = artifact.id;
  } catch (err) {
    const failed = await writeReceipt(env, {
      action_id: "",
      action_type: entry.action_type as unknown as ExecuteReceipt["action_type"],
      risk_level: entry.risk_level,
      requested_by,
      approved_by: requested_by,
      executed_by: executor,
      started_at,
      completed_at: new Date().toISOString(),
      result: "failure",
      rollback_available: false,
      external_reference: null,
      audit_record: JSON.stringify({
        ...gov.audit_record,
        execute_scope: "external",
        external_action_type: entry.action_type,
        failure_stage: "artifact_insert",
      }),
      idempotency_key: req.idempotency_key,
      safe_error_message: safe(err, "artifact_insert_failed"),
    });
    if (failed) {
      await env.admin
        .from("execute_idempotency")
        .update({ receipt_id: failed.receipt_id } as never)
        .eq("owner_id", env.userId)
        .eq("idempotency_key", req.idempotency_key);
    }
    return {
      ok: false,
      status: "failed",
      receipt: failed,
      safe_message: safe(err, "artifact_insert_failed"),
    };
  }

  // 7. Run handler.
  const handlerResult = await handler({ env, entry, payload });

  // 8. Write Receipt + stamp gate.
  const auditRecord = {
    ...gov.audit_record,
    execute_scope: "external",
    external_action_type: entry.action_type,
    connector_name: entry.connector_name,
    handler_name: entry.handler_name,
    dry_run: payload.dry_run,
    live_execute: payload.live_execute,
    confirmation_id: payload.confirmation_id,
    confirmation_source: req.confirmation_source ?? null,
    confirmed_at: req.confirmed_at ?? null,
    request_hash,
    payload_preview_redacted: redactedPayloadPreview,
    response_preview_redacted: handlerResult.response_preview_redacted,
    http_status: handlerResult.http_status,
    timing_ms: handlerResult.timing_ms,
    rollback_supported: entry.supports_rollback,
    orphan_gate_reaper: "not_implemented_v3_35b_debt_v3_35c",
  };
  const receipt = await writeReceipt(env, {
    action_id: artifactId,
    action_type: entry.action_type as unknown as ExecuteReceipt["action_type"],
    risk_level: entry.risk_level,
    requested_by,
    approved_by: requested_by,
    executed_by: executor,
    started_at,
    completed_at: new Date().toISOString(),
    result: handlerResult.ok ? "success" : "failure",
    rollback_available: entry.supports_rollback,
    external_reference: handlerResult.external_reference,
    audit_record: JSON.stringify(auditRecord),
    idempotency_key: req.idempotency_key,
    safe_error_message: handlerResult.ok ? null : handlerResult.error ?? "handler_failed",
  });
  if (!receipt) {
    return {
      ok: false,
      status: "failed",
      receipt: null,
      safe_message: "receipt_write_failed",
    };
  }
  await env.admin
    .from("execute_idempotency")
    .update({ receipt_id: receipt.receipt_id } as never)
    .eq("owner_id", env.userId)
    .eq("idempotency_key", req.idempotency_key);

  return {
    ok: handlerResult.ok,
    status: handlerResult.ok ? "executed" : "failed",
    receipt,
    safe_message: handlerResult.ok ? "ok" : handlerResult.error ?? "handler_failed",
  };
}

/**
 * Rollback stub (v3.35b). External rollback is intentionally NOT
 * supported in this patch — registry says supports_rollback=false and
 * any caller must receive a deterministic refusal.
 */
export function rollbackExternalActionNotSupported(
  action_type: string,
): ExternalDispatchResponse {
  return {
    ok: false,
    status: "rollback_not_supported",
    receipt: null,
    safe_message: `rollback_not_supported:${action_type}`,
  };
}
