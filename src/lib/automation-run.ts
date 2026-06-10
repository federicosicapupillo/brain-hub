import { supabase } from "@/integrations/supabase/client";

export type RunStatus =
  | "draft"
  | "approved"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type ExecutionMode =
  | "manual_copy"
  | "semi_automatic"
  | "n8n_webhook"
  | "playwright_browser"
  | "external_agent";

export type AutomationRun = {
  run_id: string;
  run_status: RunStatus;
  target: string;
  execution_mode: ExecutionMode;
  approved_by_user: boolean;
  approved_at: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  blocked_at: string | null;
  last_error: string | null;
  retry_count: number;
  execution_notes: string;
  external_result_reference: string | null;
  payload_version: number;
  updated_at: string;
};

export type ItemLike = {
  id: string;
  brain_id: string | null;
  title: string;
  content?: string | null;
  content_type?: string | null;
  target_tool?: string | null;
  risk_level?: string | null;
  automation_status?: string | null;
  metadata: Record<string, unknown> | null;
};

const ACTIVE_RUN_STATUSES: RunStatus[] = ["approved", "queued", "running"];

export function defaultAutomationRun(): AutomationRun {
  return {
    run_id: `run_${Date.now()}`,
    run_status: "draft",
    target: "lovable",
    execution_mode: "manual_copy",
    approved_by_user: false,
    approved_at: null,
    queued_at: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    blocked_at: null,
    last_error: null,
    retry_count: 0,
    execution_notes: "",
    external_result_reference: null,
    payload_version: 1,
    updated_at: new Date().toISOString(),
  };
}

/** Read metadata.automation_run. If missing, return an in-memory draft default (does NOT persist). */
export function getAutomationRun(item: ItemLike): AutomationRun {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const r = m.automation_run as Partial<AutomationRun> | undefined;
  if (!r || typeof r !== "object") return defaultAutomationRun();
  return { ...defaultAutomationRun(), ...r };
}

/** Find a run already active (approved/queued/running). Returns null otherwise. */
export function findActiveRun(item: ItemLike): AutomationRun | null {
  const run = getAutomationRun(item);
  return ACTIVE_RUN_STATUSES.includes(run.run_status) ? run : null;
}

export function buildAutomationPayload(
  item: ItemLike,
  ctx: { project_id?: string | null; brain_name?: string | null; project_name?: string | null },
): Record<string, unknown> {
  const m = (item.metadata as Record<string, unknown> | null) ?? {};
  const pkg = (m.execution_package as Record<string, unknown> | undefined) ?? {};
  const run = getAutomationRun(item);
  return {
    execution_package_id: item.id,
    project_id: ctx.project_id ?? null,
    brain_id: item.brain_id,
    project_name: ctx.project_name ?? null,
    brain_name: ctx.brain_name ?? null,
    package_type: (pkg.package_type as string | undefined) ?? "standard",
    risk_level: item.risk_level ?? (pkg.riskLevel as string | undefined) ?? null,
    target: run.target,
    execution_mode: run.execution_mode,
    prompt: (pkg.promptOnly as string | undefined) ?? item.content ?? "",
    success_criteria: (pkg.successCriteria as string | undefined) ?? "",
    expected_output: (pkg.expectedOutput as string | undefined) ?? "",
    protected_areas: (pkg.protectedAreas as string | undefined) ?? "",
    callback_required: true,
    callback_expected_fields: [
      "build_status",
      "console_errors",
      "modified_files",
      "summary",
      "notes",
    ],
  };
}

export type LogEventType =
  | "automation_approved"
  | "automation_queued"
  | "automation_started"
  | "automation_completed"
  | "automation_failed"
  | "automation_cancelled"
  | "automation_blocked"
  | "automation_retried"
  | "automation_payload_copied"
  | "automation_callback_received"
  | "automation_dry_run_started"
  | "automation_dry_run_completed"
  | "automation_dry_run_failed"
  | "automation_dry_run_blocked"
  | "automation_dry_run_restored";

const LOG_TITLES: Record<LogEventType, string> = {
  automation_approved: "Run approvata",
  automation_queued: "Run messa in coda",
  automation_started: "Run in esecuzione",
  automation_completed: "Run completata",
  automation_failed: "Run fallita",
  automation_cancelled: "Run cancellata",
  automation_blocked: "Run bloccata",
  automation_retried: "Run riprovata",
  automation_payload_copied: "Payload automazione copiato",
  automation_callback_received: "Callback ricevuta",
  automation_dry_run_started: "Dry run avviato",
  automation_dry_run_completed: "Dry run completato",
  automation_dry_run_failed: "Dry run fallito",
  automation_dry_run_blocked: "Dry run bloccato",
  automation_dry_run_restored: "Stato pre dry run ripristinato",
};

export type PreviousStateSnapshot = {
  run_status: RunStatus;
  output_result: string | null;
  result_meta: Record<string, unknown> | null;
  post_execution_review: Record<string, unknown> | null;
  captured_at: string;
};

export type DryRunMeta = {
  enabled: boolean;
  scenario: string;
  executed_at: string;
  result: "success" | "warning" | "failed" | "blocked";
  notes: string;
  previous_state_snapshot?: PreviousStateSnapshot | null;
};

/** Stable FNV-1a hash for callback dedupe. */
export function computeCallbackHash(parts: {
  execution_package_id: string;
  run_id?: string | null;
  status?: string | null;
  build_status?: string | null;
  summary?: string | null;
  raw_output?: string | null;
}): string {
  const s = [
    parts.execution_package_id,
    parts.run_id ?? "",
    parts.status ?? "",
    parts.build_status ?? "",
    (parts.summary ?? "").trim(),
    (parts.raw_output ?? "").trim(),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Merge patch into metadata.automation_run, persist on clipboard_items, write log row. */
export async function updateAutomationRun(
  item: ItemLike,
  patch: Partial<AutomationRun>,
  eventType: LogEventType,
  opts: { notes?: string } = {},
): Promise<AutomationRun> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Non autenticato");

  const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
  const prevRun = getAutomationRun(item);
  const nextRun: AutomationRun = {
    ...prevRun,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const newMeta = { ...prevMeta, automation_run: nextRun };

  const { error: upErr } = await supabase
    .from("clipboard_items")
    .update({ metadata: newMeta } as never)
    .eq("id", item.id);
  if (upErr) throw upErr;

  const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
    user_id: userData.user.id,
    clipboard_item_id: item.id,
    action: eventType,
    previous_status: prevRun.run_status,
    new_status: nextRun.run_status,
    notes: opts.notes ?? LOG_TITLES[eventType],
    metadata: {
      clipboard_item_id: item.id,
      brain_id: item.brain_id,
      run_id: nextRun.run_id,
      from_status: prevRun.run_status,
      to_status: nextRun.run_status,
      execution_mode: nextRun.execution_mode,
      target: nextRun.target,
      risk_level: item.risk_level ?? null,
      retry_count: nextRun.retry_count,
    },
  } as never);
  if (logErr) throw logErr;

  return nextRun;
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: "Bozza",
  approved: "Approvata",
  queued: "In coda",
  running: "In esecuzione",
  completed: "Completata",
  failed: "Fallita",
  cancelled: "Cancellata",
  blocked: "Bloccata",
};
