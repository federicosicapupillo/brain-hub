import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type N8nRealWorkflowRow = {
  id: string;
  workflow_name: string;
  brain_id: string | null;
  risk_level: string | null;
  webhook_environment: string | null;
  webhook_test_url: string | null;
  webhook_production_url: string | null;
  webhook_url: string | null;
  real_execution_enabled: boolean | null;
  requires_telegram_approval: boolean | null;
  last_real_execution_at: string | null;
  last_real_execution_status: string | null;
};

export type N8nRealLogRow = {
  id: string;
  created_at: string;
  workflow_registry_id: string | null;
  automation_action_id: string | null;
  execution_mode: string;
  success: boolean;
  response_status: number | null;
  error_text: string | null;
  metadata: Record<string, unknown> | null;
};

export type N8nRealExecutionSummary = {
  realEnabled: number;
  productionMode: number;
  runsToday: number;
  failedToday: number;
  lastExecutionAt: string | null;
  lastExecutionStatus: string | null;
  totalWorkflows: number;
};

export type N8nRealExecutionWarning = {
  id: string;
  level: "info" | "warning" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

function isValidExecutionUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const isLocal =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".local");
    return u.protocol === "https:" || isLocal;
  } catch {
    return false;
  }
}

export function effectiveWebhookUrl(wf: N8nRealWorkflowRow): string | null {
  const env = wf.webhook_environment ?? "test";
  if (env === "production") return wf.webhook_production_url ?? wf.webhook_url ?? null;
  return wf.webhook_test_url ?? wf.webhook_url ?? null;
}

async function fetchWorkflows(brainId?: string | null): Promise<N8nRealWorkflowRow[]> {
  let q = supabase
    .from("n8n_workflow_registry" as never)
    .select(
      "id,workflow_name,brain_id,risk_level,webhook_environment,webhook_test_url,webhook_production_url,webhook_url,real_execution_enabled,requires_telegram_approval,last_real_execution_at,last_real_execution_status",
    )
    .order("last_real_execution_at", { ascending: false, nullsFirst: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  return (data ?? []) as unknown as N8nRealWorkflowRow[];
}

async function fetchRealLogs(
  brainId?: string | null,
  limit = 50,
): Promise<N8nRealLogRow[]> {
  let q = supabase
    .from("n8n_execution_logs" as never)
    .select(
      "id,created_at,workflow_registry_id,automation_action_id,execution_mode,success,response_status,error_text,metadata",
    )
    .eq("execution_mode", "real")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  return (data ?? []) as unknown as N8nRealLogRow[];
}

export async function getN8nRealExecutionSummary(
  brainId?: string | null,
): Promise<N8nRealExecutionSummary> {
  const [wfs, logs] = await Promise.all([fetchWorkflows(brainId), fetchRealLogs(brainId, 100)]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayMs = startOfDay.getTime();
  const todays = logs.filter((l) => new Date(l.created_at).getTime() >= todayMs);
  return {
    totalWorkflows: wfs.length,
    realEnabled: wfs.filter((w) => !!w.real_execution_enabled).length,
    productionMode: wfs.filter(
      (w) => !!w.real_execution_enabled && (w.webhook_environment ?? "test") === "production",
    ).length,
    runsToday: todays.length,
    failedToday: todays.filter((l) => !l.success).length,
    lastExecutionAt: logs[0]?.created_at ?? null,
    lastExecutionStatus: logs[0] ? (logs[0].success ? "ok" : "failed") : null,
  };
}

export async function getRecentN8nRealExecutions(
  brainId?: string | null,
  limit = 5,
): Promise<N8nRealLogRow[]> {
  const logs = await fetchRealLogs(brainId, limit);
  return logs.slice(0, limit);
}

export async function getRecentN8nRealExecutionsForWorkflow(
  workflowId: string,
  limit = 3,
): Promise<N8nRealLogRow[]> {
  const { data } = await supabase
    .from("n8n_execution_logs" as never)
    .select(
      "id,created_at,workflow_registry_id,automation_action_id,execution_mode,success,response_status,error_text,metadata",
    )
    .eq("execution_mode", "real")
    .eq("workflow_registry_id", workflowId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as N8nRealLogRow[];
}

export async function getN8nRealExecutionWarnings(
  brainId?: string | null,
): Promise<N8nRealExecutionWarning[]> {
  const [wfs, logs] = await Promise.all([fetchWorkflows(brainId), fetchRealLogs(brainId, 30)]);
  const warnings: N8nRealExecutionWarning[] = [];

  for (const w of wfs) {
    if (!w.real_execution_enabled) continue;
    const risk = (w.risk_level ?? "medium").toLowerCase();
    if (risk === "high" && !w.requires_telegram_approval) {
      warnings.push({
        id: `n8n_high_no_tg_${w.id}`,
        level: "error",
        title: `High-risk reale senza Telegram approval: ${w.workflow_name}`,
        description: "Un workflow high-risk è abilitato all'esecuzione reale ma non richiede approvazione Telegram.",
        cta: { label: "Apri n8n Workflows", to: "/n8n-workflows" },
      });
    } else if (!w.requires_telegram_approval) {
      warnings.push({
        id: `n8n_real_no_tg_${w.id}`,
        level: "warning",
        title: `Esecuzione reale senza Telegram approval: ${w.workflow_name}`,
        description: "Workflow reale abilitato senza richiesta di approvazione Telegram.",
        cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
      });
    }
    const url = effectiveWebhookUrl(w);
    if (!url) {
      warnings.push({
        id: `n8n_real_no_url_${w.id}`,
        level: "error",
        title: `URL mancante per ambiente attivo: ${w.workflow_name}`,
        description: `Ambiente "${w.webhook_environment ?? "test"}" attivo ma URL non configurato.`,
        cta: { label: "Apri n8n Workflows", to: "/n8n-workflows" },
      });
    } else if (!isValidExecutionUrl(url)) {
      warnings.push({
        id: `n8n_real_bad_url_${w.id}`,
        level: "warning",
        title: `URL non HTTPS: ${w.workflow_name}`,
        description: "L'URL del webhook reale non è HTTPS (e non è localhost).",
        cta: { label: "Apri n8n Workflows", to: "/n8n-workflows" },
      });
    }
    if ((w.webhook_environment ?? "test") === "production") {
      warnings.push({
        id: `n8n_real_prod_${w.id}`,
        level: "info",
        title: `Production attivo: ${w.workflow_name}`,
        description: "Ogni esecuzione produce effetti reali esterni.",
        cta: { label: "Apri n8n Workflows", to: "/n8n-workflows" },
      });
    }
    if (w.last_real_execution_status === "failed") {
      warnings.push({
        id: `n8n_real_last_failed_${w.id}`,
        level: "warning",
        title: `Ultima esecuzione fallita: ${w.workflow_name}`,
        description: "L'ultimo run reale non è andato a buon fine.",
        cta: { label: "Apri Action Queue", to: "/action-queue" },
      });
    }
  }

  const failedCount = logs.filter((l) => !l.success).length;
  if (failedCount >= 3) {
    warnings.push({
      id: "n8n_real_many_failures",
      level: "warning",
      title: `${failedCount} esecuzioni reali fallite recenti`,
      description: "Troppi fallimenti recenti: verifica i webhook prima di nuove esecuzioni.",
      cta: { label: "Apri Action Queue", to: "/action-queue" },
    });
  }

  return warnings;
}

export async function logN8nRealExecutionEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
) {
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

export function validateRealExecutionConfig(input: {
  enabled: boolean;
  environment: string;
  testUrl: string | null;
  prodUrl: string | null;
  risk: string;
  requiresTelegram: boolean;
}): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.enabled) return { ok: true, errors, warnings };
  const env = input.environment === "production" ? "production" : "test";
  const url = env === "production" ? input.prodUrl : input.testUrl;
  if (!url) errors.push(`URL ${env} mancante: richiesto per abilitare l'esecuzione reale.`);
  else if (!isValidExecutionUrl(url))
    errors.push(`URL ${env} non valido: deve essere HTTPS (o localhost in dev).`);
  if (input.risk.toLowerCase() === "high" && !input.requiresTelegram)
    errors.push("Workflow high-risk: l'approvazione Telegram è obbligatoria.");
  if (env === "production" && !input.requiresTelegram)
    warnings.push("Production attivo senza approvazione Telegram: rischio alto.");
  if (env === "production") warnings.push("Production attivo: gli effetti saranno reali.");
  return { ok: errors.length === 0, errors, warnings };
}
