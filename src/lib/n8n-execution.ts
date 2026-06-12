import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";
import type { AutomationAction } from "@/lib/action-queue";
import type { N8nWorkflow } from "@/lib/n8n-workflows";

export type ExecutionMode = "dry_run" | "live";

export type N8nExecutionLog = {
  id: string;
  created_at: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  automation_action_id: string | null;
  workflow_registry_id: string | null;
  runbook_instance_id: string | null;
  execution_mode: ExecutionMode;
  request_payload: Record<string, unknown> | null;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  success: boolean;
  error_text: string | null;
  receipt_json: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

async function logEvent(action: LogEventType, notes: string, metadata: Record<string, unknown>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("clipboard_execution_logs").insert({
    user_id: u.user.id,
    clipboard_item_id: null,
    action,
    notes,
    metadata,
  } as never);
}

// Sanitize: never include obviously sensitive keys
const SENSITIVE_KEYS = ["password", "token", "secret", "api_key", "apikey", "authorization", "bearer"];

function sanitize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitize) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = "[redacted]";
    } else {
      out[k] = sanitize(v);
    }
  }
  return out as T;
}

export function buildPayload(
  action: AutomationAction,
  workflow: N8nWorkflow,
  mode: ExecutionMode,
): Record<string, unknown> {
  const payload = {
    dry_run: mode === "dry_run",
    execution_mode: mode,
    brain_hub_version: "1.6",
    automation_action: {
      id: action.id,
      action_type: action.action_type,
      title: action.title,
      description: action.description,
      source: action.source,
      risk_level: action.risk_level,
      status: action.status,
    },
    context: {
      project_id: action.project_id ?? null,
      brain_id: action.brain_id ?? null,
      roadmap_item_id: action.roadmap_item_id ?? null,
      task_id: action.task_id ?? null,
      prompt_execution_log_id: action.prompt_execution_log_id ?? null,
      runbook_instance_id:
        (action.metadata as Record<string, unknown> | null)?.runbook_instance_id ?? null,
    },
    workflow: {
      id: workflow.id,
      name: workflow.workflow_name,
      expected_input_schema: workflow.expected_input_schema,
      expected_output_schema: workflow.expected_output_schema,
      verification_method: workflow.verification_method,
    },
    metadata: sanitize(action.metadata ?? {}),
  };
  return sanitize(payload);
}

export async function logPayloadPrepared(
  action: AutomationAction,
  workflow: N8nWorkflow,
  payload: Record<string, unknown>,
): Promise<N8nExecutionLog> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data, error } = await supabase
    .from("n8n_execution_logs" as never)
    .insert({
      user_id: u.user.id,
      project_id: action.project_id ?? null,
      brain_id: action.brain_id ?? null,
      automation_action_id: action.id,
      workflow_registry_id: workflow.id,
      runbook_instance_id:
        ((action.metadata as Record<string, unknown> | null)?.runbook_instance_id as string) ??
        null,
      execution_mode: "dry_run",
      request_payload: payload,
      success: false,
      metadata: { phase: "payload_prepared" },
    } as never)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "n8n_execution_payload_prepared",
    `Payload preparato per ${workflow.workflow_name}`,
    { action_id: action.id, workflow_id: workflow.id },
  );
  return data as unknown as N8nExecutionLog;
}

export type ExecuteResult = {
  log: N8nExecutionLog;
  success: boolean;
  status: number | null;
  body: unknown;
  error?: string;
};

async function callWebhook(
  workflow: N8nWorkflow,
  payload: Record<string, unknown>,
): Promise<{ status: number | null; body: unknown; error?: string }> {
  if (!workflow.webhook_url) {
    return { status: null, body: null, error: "Webhook URL non configurato" };
  }
  try {
    const method = (workflow.webhook_method || "POST").toUpperCase();
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = JSON.stringify(payload);
    }
    const res = await fetch(workflow.webhook_url, init);
    let body: unknown = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 2000);
    }
    return { status: res.status, body };
  } catch (e) {
    return {
      status: null,
      body: null,
      error: e instanceof Error ? e.message : "Errore rete sconosciuto",
    };
  }
}

function summarizeBody(body: unknown): Record<string, unknown> | null {
  if (body == null) return null;
  if (typeof body === "string") return { text: body.slice(0, 2000) };
  if (typeof body === "object") {
    try {
      const json = JSON.stringify(body);
      if (json.length <= 4000) return body as Record<string, unknown>;
      return { truncated: true, preview: json.slice(0, 4000) };
    } catch {
      return { unserializable: true };
    }
  }
  return { value: String(body) };
}

export async function executeDryRun(
  action: AutomationAction,
  workflow: N8nWorkflow,
): Promise<ExecuteResult> {
  if (!["ready_to_test", "tested", "active"].includes(workflow.status)) {
    throw new Error("Workflow non in stato testabile (richiede ready_to_test/tested/active)");
  }
  const payload = { ...buildPayload(action, workflow, "dry_run"), dry_run: true };
  await logEvent("n8n_execution_dry_run_started", `Dry run avviato: ${workflow.workflow_name}`, {
    action_id: action.id,
    workflow_id: workflow.id,
  });

  const { status, body, error } = await callWebhook(workflow, payload);
  const success = !error && status !== null && status >= 200 && status < 300;
  const summary = summarizeBody(body);

  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data: logRow, error: insErr } = await supabase
    .from("n8n_execution_logs" as never)
    .insert({
      user_id: u.user.id,
      project_id: action.project_id ?? null,
      brain_id: action.brain_id ?? null,
      automation_action_id: action.id,
      workflow_registry_id: workflow.id,
      execution_mode: "dry_run",
      request_payload: payload,
      response_status: status,
      response_body: summary,
      success,
      error_text: error ?? null,
      receipt_json: success ? { kind: "dry_run_ok", status, at: new Date().toISOString() } : null,
      metadata: { phase: "dry_run" },
    } as never)
    .select()
    .single();
  if (insErr) throw insErr;
  const log = logRow as unknown as N8nExecutionLog;

  // Update workflow last_manual_test_*
  await supabase
    .from("n8n_workflow_registry" as never)
    .update({
      last_manual_test_at: new Date().toISOString(),
      last_manual_test_status: success ? "ok" : "failed",
    } as never)
    .eq("id", workflow.id);

  await logEvent(
    "n8n_execution_dry_run_completed",
    `Dry run completato: ${workflow.workflow_name} (${success ? "ok" : "failed"})`,
    { action_id: action.id, workflow_id: workflow.id, success, status },
  );
  return { log, success, status, body, error };
}

export async function executeLive(
  action: AutomationAction,
  workflow: N8nWorkflow,
): Promise<ExecuteResult> {
  if (!["approved", "ready_to_execute"].includes(action.status)) {
    throw new Error("Azione non in stato eseguibile (richiede approved o ready_to_execute)");
  }
  if (!["tested", "active"].includes(workflow.status)) {
    throw new Error("Workflow non in stato eseguibile (richiede tested o active)");
  }
  if (!workflow.webhook_url) throw new Error("Webhook URL mancante");

  const payload = buildPayload(action, workflow, "live");
  await logEvent("n8n_execution_started", `Esecuzione live avviata: ${workflow.workflow_name}`, {
    action_id: action.id,
    workflow_id: workflow.id,
    risk_level: workflow.risk_level,
  });

  const { status, body, error } = await callWebhook(workflow, payload);
  const success = !error && status !== null && status >= 200 && status < 300;
  const summary = summarizeBody(body);
  const receipt = {
    kind: success ? "live_ok" : "live_failed",
    status,
    workflow_id: workflow.id,
    action_id: action.id,
    at: new Date().toISOString(),
  };

  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data: logRow, error: insErr } = await supabase
    .from("n8n_execution_logs" as never)
    .insert({
      user_id: u.user.id,
      project_id: action.project_id ?? null,
      brain_id: action.brain_id ?? null,
      automation_action_id: action.id,
      workflow_registry_id: workflow.id,
      execution_mode: "live",
      request_payload: payload,
      response_status: status,
      response_body: summary,
      success,
      error_text: error ?? null,
      receipt_json: receipt,
      metadata: { phase: "live" },
    } as never)
    .select()
    .single();
  if (insErr) throw insErr;
  const log = logRow as unknown as N8nExecutionLog;

  // Update automation_action
  const existingMeta = (action.metadata ?? {}) as Record<string, unknown>;
  const actionPatch: Record<string, unknown> = success
    ? {
        status: "executed",
        executed_at: new Date().toISOString(),
        result_text:
          typeof summary === "object" && summary
            ? JSON.stringify(summary).slice(0, 2000)
            : "Eseguito tramite n8n",
        error_text: null,
        metadata: {
          ...existingMeta,
          n8n_executed: true,
          n8n_failed: false,
          n8n_last_log_id: log.id,
          n8n_last_run_at: new Date().toISOString(),
        },
      }
    : {
        status: "failed",
        error_text:
          error ??
          `HTTP ${status ?? "??"} — ${
            typeof summary === "object" && summary ? JSON.stringify(summary).slice(0, 500) : "errore"
          }`,
        metadata: {
          ...existingMeta,
          n8n_executed: false,
          n8n_failed: true,
          n8n_last_log_id: log.id,
          n8n_last_run_at: new Date().toISOString(),
        },
      };
  await supabase
    .from("automation_actions" as never)
    .update(actionPatch as never)
    .eq("id", action.id);

  await logEvent(
    success ? "n8n_execution_completed" : "n8n_execution_failed",
    `${workflow.workflow_name}: ${success ? "ok" : error ?? `HTTP ${status}`}`,
    { action_id: action.id, workflow_id: workflow.id, status, success },
  );
  await logEvent("n8n_execution_receipt_saved", `Receipt salvata per ${workflow.workflow_name}`, {
    log_id: log.id,
  });
  return { log, success, status, body, error };
}

export async function markExecutionFailedManual(
  action: AutomationAction,
  workflow: N8nWorkflow,
  reason: string,
): Promise<N8nExecutionLog> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data, error } = await supabase
    .from("n8n_execution_logs" as never)
    .insert({
      user_id: u.user.id,
      project_id: action.project_id ?? null,
      brain_id: action.brain_id ?? null,
      automation_action_id: action.id,
      workflow_registry_id: workflow.id,
      execution_mode: "live",
      success: false,
      error_text: reason,
      metadata: { phase: "manual_failed_mark" },
    } as never)
    .select()
    .single();
  if (error) throw error;
  await supabase
    .from("automation_actions" as never)
    .update({ status: "failed", error_text: reason } as never)
    .eq("id", action.id);
  await logEvent("n8n_execution_failed", `Segnata fallita manualmente: ${workflow.workflow_name}`, {
    action_id: action.id,
    workflow_id: workflow.id,
    reason,
  });
  return data as unknown as N8nExecutionLog;
}

export async function listExecutionLogsForAction(actionId: string): Promise<N8nExecutionLog[]> {
  const { data, error } = await supabase
    .from("n8n_execution_logs" as never)
    .select("*")
    .eq("automation_action_id", actionId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as N8nExecutionLog[];
}

export async function listRecentExecutionLogs(brainId?: string, limit = 20): Promise<N8nExecutionLog[]> {
  let q = supabase
    .from("n8n_execution_logs" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as unknown as N8nExecutionLog[];
}

export type ExecutionSummary = {
  total: number;
  live_ok: number;
  live_failed: number;
  dry_runs: number;
};

export function summarizeExecutions(logs: N8nExecutionLog[]): ExecutionSummary {
  let live_ok = 0;
  let live_failed = 0;
  let dry_runs = 0;
  for (const l of logs) {
    if (l.execution_mode === "dry_run") dry_runs++;
    else if (l.success) live_ok++;
    else live_failed++;
  }
  return { total: logs.length, live_ok, live_failed, dry_runs };
}
