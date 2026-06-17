import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type ActionType =
  | "generate_fix_prompt"
  | "generate_first_prompt"
  | "send_next_prompt"
  | "save_lovable_result"
  | "link_log_to_roadmap"
  | "mark_roadmap_completed"
  | "mark_roadmap_needs_fix"
  | "create_roadmap_item"
  | "review_pending_result"
  | "clean_orphan_logs"
  | "open_project_console"
  | "manual_task"
  | "meeting_preparation"
  | "meeting_follow_up"
  | "calendar_deadline_check"
  | "calendar_content_check"
  | "code_review"
  | "code_fix"
  | "code_refactor"
  | "code_test"
  | "code_deploy_check"
  | "github_issue_draft"
  | "agent_recommendation"
  | "agent_setup"
  | "agent_review";


export type ActionStatus =
  | "suggested"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "ready_to_execute"
  | "executed"
  | "failed"
  | "cancelled";

export type ActionSource =
  | "project_health_check"
  | "roadmap_intelligence"
  | "next_prompt_generator"
  | "execution_tracking"
  | "user_manual"
  | "system_suggestion"
  | "google_calendar"
  | "github_operational"
  | "code_repository"
  | "agent_center";





export type RiskLevel = "low" | "medium" | "high";
export type Priority = "low" | "medium" | "high";

export type AutomationAction = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  roadmap_item_id: string | null;
  task_id: string | null;
  prompt_execution_log_id: string | null;
  parent_execution_log_id: string | null;
  source: ActionSource;
  action_type: ActionType;
  title: string;
  description: string | null;
  priority: Priority;
  risk_level: RiskLevel;
  status: ActionStatus;
  requires_confirmation: boolean;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
  result_text: string | null;
  error_text: string | null;
  metadata: Record<string, unknown>;
};

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  generate_fix_prompt: "Genera prompt di correzione",
  generate_first_prompt: "Genera primo prompt",
  send_next_prompt: "Invia next prompt",
  save_lovable_result: "Salva risultato Lovable",
  link_log_to_roadmap: "Collega log a roadmap",
  mark_roadmap_completed: "Segna roadmap completata",
  mark_roadmap_needs_fix: "Segna roadmap da correggere",
  create_roadmap_item: "Crea roadmap item",
  review_pending_result: "Verifica risultato in attesa",
  clean_orphan_logs: "Pulisci log scollegati",
  open_project_console: "Apri Project Console",
  manual_task: "Task manuale",
  meeting_preparation: "Preparare riunione",
  meeting_follow_up: "Follow-up dopo riunione",
  calendar_deadline_check: "Verifica scadenza calendario",
  calendar_content_check: "Verifica contenuto calendario",
  code_review: "Code review",
  code_fix: "Code fix",
  code_refactor: "Refactor codice",
  code_test: "Test codice",
  code_deploy_check: "Verifica deployment",
  github_issue_draft: "Bozza GitHub issue",
  agent_recommendation: "Raccomandazione agente",
  agent_setup: "Setup agente",
  agent_review: "Review agente",
};


export const ACTION_TYPE_RISK: Record<ActionType, RiskLevel> = {
  generate_fix_prompt: "medium",
  generate_first_prompt: "medium",
  send_next_prompt: "high",
  save_lovable_result: "medium",
  link_log_to_roadmap: "medium",
  mark_roadmap_completed: "high",
  mark_roadmap_needs_fix: "medium",
  create_roadmap_item: "medium",
  review_pending_result: "low",
  clean_orphan_logs: "medium",
  open_project_console: "low",
  manual_task: "low",
  meeting_preparation: "low",
  meeting_follow_up: "low",
  calendar_deadline_check: "low",
  calendar_content_check: "low",
  code_review: "low",
  code_fix: "medium",
  code_refactor: "medium",
  code_test: "low",
  code_deploy_check: "medium",
  github_issue_draft: "low",
  agent_recommendation: "low",
  agent_setup: "low",
  agent_review: "low",
};


export const STATUS_LABEL: Record<ActionStatus, string> = {
  suggested: "Suggerita",
  pending_approval: "In attesa approvazione",
  approved: "Approvata",
  rejected: "Rifiutata",
  ready_to_execute: "Pronta da eseguire",
  executed: "Eseguita",
  failed: "Fallita",
  cancelled: "Annullata",
};

export const SOURCE_LABEL: Record<ActionSource, string> = {
  project_health_check: "Project Health Check",
  roadmap_intelligence: "Roadmap Intelligence",
  next_prompt_generator: "Next Prompt Generator",
  execution_tracking: "Execution Tracking",
  user_manual: "Manuale",

  system_suggestion: "Sistema",
  google_calendar: "Google Calendar",
  github_operational: "GitHub Operational",
  code_repository: "Repository codice",
};


export const RISK_TONE: Record<RiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  high: "bg-red-500/10 text-red-600 border-red-500/30",
};

async function logActionEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown>,
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

export type CreateActionInput = {
  source: ActionSource;
  action_type: ActionType;
  title: string;
  description?: string;
  priority?: Priority;
  risk_level?: RiskLevel;
  brain_id?: string | null;
  project_id?: string | null;
  roadmap_item_id?: string | null;
  task_id?: string | null;
  prompt_execution_log_id?: string | null;
  parent_execution_log_id?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createAction(input: CreateActionInput): Promise<AutomationAction> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const risk = input.risk_level ?? ACTION_TYPE_RISK[input.action_type] ?? "low";
  const requires_confirmation = risk !== "low";
  const initialStatus: ActionStatus = requires_confirmation ? "pending_approval" : "suggested";

  const payload = {
    user_id: u.user.id,
    source: input.source,
    action_type: input.action_type,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "medium",
    risk_level: risk,
    status: initialStatus,
    requires_confirmation,
    brain_id: input.brain_id ?? null,
    project_id: input.project_id ?? null,
    roadmap_item_id: input.roadmap_item_id ?? null,
    task_id: input.task_id ?? null,
    prompt_execution_log_id: input.prompt_execution_log_id ?? null,
    parent_execution_log_id: input.parent_execution_log_id ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;

  const created = data as unknown as AutomationAction;
  await logActionEvent("automation_action_created", `Azione creata: ${created.title}`, {
    action_id: created.id,
    source: created.source,
    action_type: created.action_type,
    risk_level: created.risk_level,
    brain_id: created.brain_id,
  });
  return created;
}

export async function listActions(filters: {
  brainId?: string;
  status?: ActionStatus[];
} = {}): Promise<AutomationAction[]> {
  let q = supabase
    .from("automation_actions" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (filters.brainId) q = q.eq("brain_id", filters.brainId);
  if (filters.status && filters.status.length > 0) q = q.in("status", filters.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AutomationAction[];
}

async function updateAction(id: string, patch: Partial<AutomationAction>): Promise<AutomationAction> {
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as AutomationAction;
}

export async function approveAction(a: AutomationAction): Promise<AutomationAction> {
  const next = await updateAction(a.id, {
    status: "approved",
    approved_at: new Date().toISOString(),
  });
  await logActionEvent("automation_action_approved", `Azione approvata: ${a.title}`, {
    action_id: a.id,
    risk_level: a.risk_level,
  });
  return next;
}

export async function rejectAction(a: AutomationAction): Promise<AutomationAction> {
  const next = await updateAction(a.id, {
    status: "rejected",
    rejected_at: new Date().toISOString(),
  });
  await logActionEvent("automation_action_rejected", `Azione rifiutata: ${a.title}`, {
    action_id: a.id,
  });
  return next;
}

export async function cancelAction(a: AutomationAction): Promise<AutomationAction> {
  const next = await updateAction(a.id, { status: "cancelled" });
  await logActionEvent("automation_action_cancelled", `Azione annullata: ${a.title}`, {
    action_id: a.id,
  });
  return next;
}

export async function markReadyToExecute(a: AutomationAction): Promise<AutomationAction> {
  const next = await updateAction(a.id, { status: "ready_to_execute" });
  await logActionEvent("automation_action_ready_to_execute", `Azione pronta: ${a.title}`, {
    action_id: a.id,
  });
  return next;
}

export async function markExecuted(
  a: AutomationAction,
  result_text?: string,
): Promise<AutomationAction> {
  const next = await updateAction(a.id, {
    status: "executed",
    executed_at: new Date().toISOString(),
    result_text: result_text ?? a.result_text,
  });
  await logActionEvent("automation_action_executed", `Azione eseguita: ${a.title}`, {
    action_id: a.id,
  });
  return next;
}

export async function markFailed(
  a: AutomationAction,
  error_text: string,
): Promise<AutomationAction> {
  const next = await updateAction(a.id, { status: "failed", error_text });
  await logActionEvent("automation_action_failed", `Azione fallita: ${a.title}`, {
    action_id: a.id,
    error_text,
  });
  return next;
}
