import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "bearer",
  "webhook_secret",
];

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

function sanitizeText(text: string | null | undefined): string | null {
  if (!text) return null;
  let out = text;
  for (const key of SENSITIVE_KEYS) {
    const re = new RegExp(`(${key}["']?\\s*[:=]\\s*["']?)([^"'\\s,}]+)`, "gi");
    out = out.replace(re, "$1[REDACTED]");
  }
  return out.slice(0, 2000);
}

function truncateUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 12 ? `…${u.pathname.slice(-8)}` : u.pathname;
    return `${u.protocol}//${u.host}${tail}`;
  } catch {
    return url.slice(0, 16) + "…";
  }
}

function isValidWebhookUrl(url: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL non valido" };
  }
  const isLocal =
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname.endsWith(".local");
  if (u.protocol !== "https:" && !isLocal) {
    return { ok: false, reason: "URL deve essere HTTPS" };
  }
  return { ok: true };
}

const REAL_EXEC_TIMEOUT_MS = 20_000;

const inputSchema = z.object({
  workflow_id: z.string().uuid(),
  action_id: z.string().uuid().nullable().optional(),
  confirm: z.literal(true),
});

type WorkflowRow = {
  id: string;
  user_id: string;
  workflow_name: string;
  webhook_url: string | null;
  webhook_method: string;
  webhook_test_url: string | null;
  webhook_production_url: string | null;
  webhook_environment: string;
  real_execution_enabled: boolean;
  requires_telegram_approval: boolean;
  risk_level: string;
  status: string;
  brain_id: string | null;
  project_id: string | null;
};

type ActionRow = {
  id: string;
  user_id: string;
  brain_id: string | null;
  project_id: string | null;
  action_type: string;
  title: string;
  description: string | null;
  risk_level: string;
  status: string;
  metadata: Record<string, unknown> | null;
  telegram_approval_status: string | null;
  source: string | null;
};

export const executeN8nRealWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: wfRaw, error: wfErr } = await supabase
      .from("n8n_workflow_registry" as never)
      .select(
        "id,user_id,workflow_name,webhook_url,webhook_method,webhook_test_url,webhook_production_url,webhook_environment,real_execution_enabled,requires_telegram_approval,risk_level,status,brain_id,project_id",
      )
      .eq("id", data.workflow_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (wfErr) throw new Error(wfErr.message);
    if (!wfRaw) throw new Error("Workflow non trovato");
    const wf = wfRaw as unknown as WorkflowRow;

    if (!wf.real_execution_enabled) {
      throw new Error("Esecuzione reale non abilitata per questo workflow");
    }

    const targetUrl =
      wf.webhook_environment === "production"
        ? wf.webhook_production_url ?? wf.webhook_url
        : wf.webhook_test_url ?? wf.webhook_url;
    if (!targetUrl) throw new Error("Webhook URL non configurato");

    const urlCheck = isValidWebhookUrl(targetUrl);
    if (!urlCheck.ok) throw new Error(urlCheck.reason ?? "URL non valido");

    let action: ActionRow | null = null;
    if (data.action_id) {
      const { data: aRaw, error: aErr } = await supabase
        .from("automation_actions" as never)
        .select(
          "id,user_id,brain_id,project_id,action_type,title,description,risk_level,status,metadata,telegram_approval_status,source",
        )
        .eq("id", data.action_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      action = (aRaw as unknown as ActionRow) ?? null;
    }

    const effectiveRisk = (action?.risk_level ?? wf.risk_level ?? "medium").toLowerCase();
    const needsTelegram =
      wf.requires_telegram_approval || effectiveRisk === "high";

    if (needsTelegram) {
      let approved = false;
      if (action) {
        approved = action.telegram_approval_status === "approved";
        if (!approved) {
          const { data: appr } = await supabase
            .from("telegram_approval_requests" as never)
            .select("id,status")
            .eq("user_id", userId)
            .eq("automation_action_id", action.id)
            .eq("status", "approved")
            .limit(1);
          approved = !!(appr && (appr as unknown as unknown[]).length > 0);
        }
      }
      if (!approved) {
        await supabase.from("clipboard_execution_logs").insert({
          user_id: userId,
          clipboard_item_id: null,
          action: "n8n_real_execution_blocked_missing_approval",
          notes: `Blocco: manca approvazione Telegram per ${wf.workflow_name}`,
          metadata: {
            workflow_id: wf.id,
            action_id: action?.id ?? null,
            risk_level: effectiveRisk,
          },
        } as never);
        throw new Error(
          "Approvazione Telegram mancante per questo workflow/azione. Approva tramite Telegram Approvals prima di eseguire.",
        );
      }
    }

    const requestPayload = sanitize({
      action_id: action?.id ?? null,
      workflow_id: wf.id,
      brain_id: action?.brain_id ?? wf.brain_id,
      project_id: action?.project_id ?? wf.project_id,
      source: action?.source ?? "brain_hub",
      action_type: action?.action_type ?? null,
      title: action?.title ?? wf.workflow_name,
      description: action?.description ?? null,
      risk_level: effectiveRisk,
      requested_by: userId,
      timestamp: new Date().toISOString(),
      dry_run: false,
      environment: wf.webhook_environment,
      metadata: action?.metadata ?? {},
    }) as Record<string, unknown>;

    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: "n8n_real_execution_started",
      notes: `Esecuzione reale avviata: ${wf.workflow_name} (${wf.webhook_environment})`,
      metadata: {
        workflow_id: wf.id,
        action_id: action?.id ?? null,
        url_preview: truncateUrl(targetUrl),
      },
    } as never);

    const method = (wf.webhook_method || "POST").toUpperCase();
    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let success = false;
    let errorText: string | null = null;
    let responseSummary: Record<string, unknown> | null = null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REAL_EXEC_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      };
      if (method !== "GET" && method !== "HEAD") {
        init.body = JSON.stringify(requestPayload);
      }
      const res = await fetch(targetUrl, init);
      httpStatus = res.status;
      const text = (await res.text()).slice(0, 4000);
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { text };
      }
      responseSummary = sanitize(parsed) as Record<string, unknown> | null;
      success = res.status >= 200 && res.status < 300;
      if (!success) errorText = sanitizeText(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      errorText = sanitizeText(
        e instanceof Error
          ? e.name === "AbortError"
            ? "Timeout (20s)"
            : e.message
          : "Errore di rete",
      );
    } finally {
      clearTimeout(timeout);
    }
    const durationMs = Date.now() - startedAt;

    const { data: logRow, error: logErr } = await supabase
      .from("n8n_execution_logs" as never)
      .insert({
        user_id: userId,
        project_id: action?.project_id ?? wf.project_id,
        brain_id: action?.brain_id ?? wf.brain_id,
        automation_action_id: action?.id ?? null,
        workflow_registry_id: wf.id,
        execution_mode: "real",
        request_payload: requestPayload,
        response_status: httpStatus,
        response_body: responseSummary,
        success,
        error_text: errorText,
        receipt_json: {
          kind: success ? "real_ok" : "real_failed",
          status: httpStatus,
          duration_ms: durationMs,
          url_preview: truncateUrl(targetUrl),
          environment: wf.webhook_environment,
          at: new Date().toISOString(),
        },
        metadata: {
          phase: "real",
          duration_ms: durationMs,
          environment: wf.webhook_environment,
        },
      } as never)
      .select("id,success,response_status,error_text,created_at")
      .single();
    if (logErr) throw new Error(logErr.message);

    await supabase
      .from("n8n_workflow_registry" as never)
      .update({
        last_real_execution_at: new Date().toISOString(),
        last_real_execution_status: success ? "ok" : "failed",
      } as never)
      .eq("id", wf.id);

    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: success ? "n8n_real_execution_succeeded" : "n8n_real_execution_failed",
      notes: `${wf.workflow_name}: ${success ? "ok" : errorText ?? `HTTP ${httpStatus ?? "??"}`}`,
      metadata: {
        workflow_id: wf.id,
        action_id: action?.id ?? null,
        log_id: (logRow as { id: string }).id,
        http_status: httpStatus,
        duration_ms: durationMs,
      },
    } as never);

    return {
      ok: success,
      log_id: (logRow as { id: string }).id,
      http_status: httpStatus,
      duration_ms: durationMs,
      error_text: errorText,
      response_preview: responseSummary ? JSON.stringify(responseSummary).slice(0, 2000) : null,
    };
  });

const reviewInput = z.object({
  log_id: z.string().uuid(),
});

export const createReviewFromN8nLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: logRaw, error } = await supabase
      .from("n8n_execution_logs" as never)
      .select(
        "id,user_id,brain_id,project_id,automation_action_id,workflow_registry_id,success,response_body,error_text,execution_mode",
      )
      .eq("id", data.log_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!logRaw) throw new Error("Log non trovato");
    const log = logRaw as unknown as {
      id: string;
      brain_id: string | null;
      project_id: string | null;
      automation_action_id: string | null;
      workflow_registry_id: string | null;
      success: boolean;
      response_body: Record<string, unknown> | null;
      error_text: string | null;
      execution_mode: string;
    };

    const title = `n8n ${log.execution_mode} ${log.success ? "ok" : "failed"}`;
    const { data: review, error: rErr } = await supabase
      .from("result_review_items" as never)
      .insert({
        user_id: userId,
        source_type: "n8n_execution_log",
        source_id: log.id,
        title,
        result_text: log.response_body ? JSON.stringify(log.response_body).slice(0, 4000) : null,
        error_text: log.error_text ? sanitizeText(log.error_text) : null,
        brain_id: log.brain_id,
        project_id: log.project_id,
        linked_action_id: log.automation_action_id,
        linked_workflow_id: log.workflow_registry_id,
        review_status: "pending_review",
        metadata: { from_log_id: log.id, mode: log.execution_mode },
      } as never)
      .select("id")
      .single();
    if (rErr) throw new Error(rErr.message);

    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: "n8n_real_execution_review_created",
      notes: "Result Review creata da log n8n reale",
      metadata: { log_id: log.id, review_id: (review as { id: string }).id },
    } as never);

    return { review_id: (review as { id: string }).id };
  });
