import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type WorkflowStatus =
  | "draft"
  | "ready_to_test"
  | "tested"
  | "active"
  | "inactive"
  | "broken"
  | "deprecated";

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: "Bozza",
  ready_to_test: "Da testare",
  tested: "Testato",
  active: "Attivo",
  inactive: "Inattivo",
  broken: "Problema",
  deprecated: "Obsoleto",
};

export const WORKFLOW_STATUS_TONE: Record<WorkflowStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  ready_to_test: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  tested: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  inactive: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  broken: "bg-red-500/10 text-red-600 border-red-500/30",
  deprecated: "bg-amber-500/10 text-amber-600 border-amber-500/30",
};

export type WorkflowRisk = "low" | "medium" | "high";

export type N8nWorkflow = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  tool_link_id: string | null;
  workflow_name: string;
  workflow_description: string | null;
  workflow_url: string | null;
  webhook_url: string | null;
  webhook_method: string;
  status: WorkflowStatus;
  risk_level: WorkflowRisk;
  linked_action_types: string[];
  expected_input_schema: Record<string, unknown> | null;
  expected_output_schema: Record<string, unknown> | null;
  verification_method: string | null;
  last_manual_test_at: string | null;
  last_manual_test_status: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
};

export const SUPPORTED_WORKFLOW_CASES: { action_type: string; label: string }[] = [
  { action_type: "send_telegram_approval", label: "Approvazione Telegram" },
  { action_type: "publish_social_post", label: "Pubblicazione social" },
  { action_type: "generate_media_asset", label: "Generazione media (Runway/Higgsfield)" },
  { action_type: "check_github_status", label: "Verifica stato GitHub" },
  { action_type: "check_supabase_status", label: "Verifica stato Supabase" },
  { action_type: "verify_knowledge_source", label: "Verifica knowledge source" },
  { action_type: "organize_project_files", label: "Organizza file di progetto" },
  { action_type: "send_email_summary", label: "Riepilogo email" },
  { action_type: "calendar_event_create", label: "Crea evento calendario" },
  { action_type: "lovable_result_capture", label: "Cattura risultato Lovable" },
  { action_type: "social_analytics_fetch", label: "Analytics social" },
  { action_type: "lead_list_enrichment", label: "Arricchimento lead" },
  { action_type: "custom_workflow", label: "Workflow personalizzato" },
];

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

export async function listWorkflows(brainId?: string): Promise<N8nWorkflow[]> {
  let q = supabase
    .from("n8n_workflow_registry" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as N8nWorkflow[];
}

export async function listWorkflowsForActionType(
  actionType: string,
  brainId?: string,
): Promise<N8nWorkflow[]> {
  let q = supabase
    .from("n8n_workflow_registry" as never)
    .select("*")
    .contains("linked_action_types", JSON.stringify([actionType]) as never);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as unknown as N8nWorkflow[];
}

export type CreateWorkflowInput = Partial<
  Pick<
    N8nWorkflow,
    | "workflow_description"
    | "workflow_url"
    | "webhook_url"
    | "webhook_method"
    | "status"
    | "risk_level"
    | "linked_action_types"
    | "expected_input_schema"
    | "expected_output_schema"
    | "verification_method"
    | "notes"
    | "metadata"
    | "project_id"
    | "brain_id"
    | "tool_link_id"
  >
> & { workflow_name: string };

export async function createWorkflow(input: CreateWorkflowInput): Promise<N8nWorkflow> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const payload = {
    user_id: u.user.id,
    workflow_name: input.workflow_name,
    workflow_description: input.workflow_description ?? null,
    workflow_url: input.workflow_url ?? null,
    webhook_url: input.webhook_url ?? null,
    webhook_method: input.webhook_method ?? "POST",
    status: input.status ?? "draft",
    risk_level: input.risk_level ?? "medium",
    linked_action_types: input.linked_action_types ?? [],
    expected_input_schema: input.expected_input_schema ?? null,
    expected_output_schema: input.expected_output_schema ?? null,
    verification_method: input.verification_method ?? null,
    notes: input.notes ?? null,
    metadata: input.metadata ?? {},
    project_id: input.project_id ?? null,
    brain_id: input.brain_id ?? null,
    tool_link_id: input.tool_link_id ?? null,
  };

  const { data, error } = await supabase
    .from("n8n_workflow_registry" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  const wf = data as unknown as N8nWorkflow;
  await logEvent("n8n_workflow_registered", `Workflow registrato: ${wf.workflow_name}`, {
    workflow_id: wf.id,
    brain_id: wf.brain_id,
    linked_action_types: wf.linked_action_types,
  });
  return wf;
}

export async function updateWorkflow(
  id: string,
  patch: Partial<N8nWorkflow>,
): Promise<N8nWorkflow> {
  const { data, error } = await supabase
    .from("n8n_workflow_registry" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const wf = data as unknown as N8nWorkflow;
  await logEvent("n8n_workflow_updated", `Workflow aggiornato: ${wf.workflow_name}`, {
    workflow_id: wf.id,
  });
  return wf;
}

export async function setWorkflowStatus(
  wf: N8nWorkflow,
  status: WorkflowStatus,
): Promise<N8nWorkflow> {
  const next = await updateWorkflow(wf.id, { status });
  await logEvent("n8n_workflow_status_changed", `Stato workflow: ${wf.workflow_name} → ${status}`, {
    workflow_id: wf.id,
    previous_status: wf.status,
    new_status: status,
  });
  return next;
}

export async function markManualTest(
  wf: N8nWorkflow,
  status: "ok" | "failed",
  notes?: string,
): Promise<N8nWorkflow> {
  const next = await updateWorkflow(wf.id, {
    last_manual_test_at: new Date().toISOString(),
    last_manual_test_status: status,
    notes: notes ?? wf.notes,
  });
  await logEvent("n8n_workflow_manual_test_marked", `Test manuale: ${wf.workflow_name} → ${status}`, {
    workflow_id: wf.id,
    status,
  });
  return next;
}

export async function logWorkflowOpened(wf: N8nWorkflow) {
  await logEvent("n8n_workflow_opened", `Workflow aperto: ${wf.workflow_name}`, {
    workflow_id: wf.id,
  });
}

export type WorkflowSummary = {
  total: number;
  active: number;
  to_test: number;
  broken: number;
  covered_action_types: string[];
  uncovered_action_types: string[];
};

export function summarizeWorkflows(
  workflows: N8nWorkflow[],
  requiredActionTypes: string[],
): WorkflowSummary {
  const covered = new Set<string>();
  let active = 0;
  let to_test = 0;
  let broken = 0;
  for (const w of workflows) {
    if (w.status === "active") active++;
    if (w.status === "ready_to_test" || w.status === "draft") to_test++;
    if (w.status === "broken") broken++;
    for (const t of w.linked_action_types ?? []) covered.add(t);
  }
  const uncovered = requiredActionTypes.filter((t) => !covered.has(t));
  return {
    total: workflows.length,
    active,
    to_test,
    broken,
    covered_action_types: [...covered],
    uncovered_action_types: uncovered,
  };
}
