import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type ApprovalStatus =
  | "draft"
  | "ready_to_send"
  | "sent"
  | "pending_response"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "failed";

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  draft: "Bozza",
  ready_to_send: "Pronta da inviare",
  sent: "Inviata",
  pending_response: "In attesa risposta",
  approved: "Approvata",
  rejected: "Rifiutata",
  expired: "Scaduta",
  cancelled: "Annullata",
  failed: "Fallita",
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  ready_to_send: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  sent: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  pending_response: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejected: "bg-red-500/10 text-red-600 border-red-500/30",
  expired: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
};

export type ApprovalType =
  | "n8n_execution"
  | "social_post_publish"
  | "email_send"
  | "calendar_create"
  | "media_generation"
  | "roadmap_status_change"
  | "file_organization"
  | "manual_action"
  | "custom";

export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  n8n_execution: "Esecuzione n8n",
  social_post_publish: "Pubblicazione social",
  email_send: "Invio email",
  calendar_create: "Evento calendario",
  media_generation: "Generazione media",
  roadmap_status_change: "Cambio stato roadmap",
  file_organization: "Organizzazione file",
  manual_action: "Azione manuale",
  custom: "Custom",
};

export type RiskLevel = "low" | "medium" | "high";

export type TelegramApprovalRequest = {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  project_id: string | null;
  brain_id: string | null;
  automation_action_id: string | null;
  n8n_execution_log_id: string | null;
  runbook_instance_id: string | null;
  approval_type: ApprovalType | string;
  title: string;
  message_preview: string | null;
  payload_preview: Record<string, unknown> | null;
  status: ApprovalStatus;
  risk_level: RiskLevel | string;
  requested_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  expired_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  telegram_message_id: string | null;
  telegram_chat_id: string | null;
  telegram_delivery_status: string | null;
  telegram_sent_at: string | null;
  telegram_error_text: string | null;
  telegram_receipt_json: Record<string, unknown> | null;
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

export type CreateApprovalInput = {
  brain_id?: string | null;
  project_id?: string | null;
  automation_action_id?: string | null;
  n8n_execution_log_id?: string | null;
  runbook_instance_id?: string | null;
  approval_type: ApprovalType;
  title: string;
  message_preview?: string | null;
  payload_preview?: Record<string, unknown> | null;
  risk_level?: RiskLevel;
  metadata?: Record<string, unknown>;
};

export async function createApprovalRequest(
  input: CreateApprovalInput,
): Promise<TelegramApprovalRequest> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .insert({
      user_id: u.user.id,
      brain_id: input.brain_id ?? null,
      project_id: input.project_id ?? null,
      automation_action_id: input.automation_action_id ?? null,
      n8n_execution_log_id: input.n8n_execution_log_id ?? null,
      runbook_instance_id: input.runbook_instance_id ?? null,
      approval_type: input.approval_type,
      title: input.title,
      message_preview: input.message_preview ?? null,
      payload_preview: input.payload_preview ?? null,
      risk_level: input.risk_level ?? "medium",
      status: "draft",
      metadata: input.metadata ?? {},
    } as never)
    .select()
    .single();
  if (error) throw error;
  const req = data as unknown as TelegramApprovalRequest;
  await logEvent(
    "telegram_approval_request_created",
    `Richiesta approvazione Telegram creata: ${req.title}`,
    { request_id: req.id, approval_type: req.approval_type, risk_level: req.risk_level },
  );
  return req;
}

export async function markReadyToSend(req: TelegramApprovalRequest): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({ status: "ready_to_send" } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "telegram_approval_request_ready",
    `Richiesta pronta da inviare: ${req.title}`,
    { request_id: req.id },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function markSent(
  req: TelegramApprovalRequest,
  telegram_chat_id?: string,
  telegram_message_id?: string,
): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({
      status: "pending_response",
      requested_at: new Date().toISOString(),
      telegram_chat_id: telegram_chat_id ?? null,
      telegram_message_id: telegram_message_id ?? null,
    } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "telegram_approval_request_sent",
    `Richiesta inviata (predisposta): ${req.title}`,
    { request_id: req.id },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function simulateApprove(
  req: TelegramApprovalRequest,
  approved_by = "manual_ui",
): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by,
    } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  // Propaga eventualmente all'automation_action collegata
  if (req.automation_action_id) {
    await supabase
      .from("automation_actions" as never)
      .update({
        metadata: {
          ...((req.metadata ?? {}) as Record<string, unknown>),
          telegram_approval_status: "approved",
          telegram_approval_id: req.id,
          telegram_approved_at: new Date().toISOString(),
        },
      } as never)
      .eq("id", req.automation_action_id);
  }
  await logEvent(
    "telegram_approval_request_approved",
    `Approvazione simulata: ${req.title}`,
    { request_id: req.id, automation_action_id: req.automation_action_id },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function simulateReject(
  req: TelegramApprovalRequest,
  reason: string,
): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  if (req.automation_action_id) {
    await supabase
      .from("automation_actions" as never)
      .update({
        metadata: {
          ...((req.metadata ?? {}) as Record<string, unknown>),
          telegram_approval_status: "rejected",
          telegram_approval_id: req.id,
          telegram_rejected_at: new Date().toISOString(),
          telegram_rejection_reason: reason,
        },
      } as never)
      .eq("id", req.automation_action_id);
  }
  await logEvent(
    "telegram_approval_request_rejected",
    `Rifiuto simulato: ${req.title} — ${reason}`,
    { request_id: req.id, reason },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function cancelApproval(req: TelegramApprovalRequest): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({ status: "cancelled" } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "telegram_approval_request_cancelled",
    `Richiesta annullata: ${req.title}`,
    { request_id: req.id },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function markFailed(
  req: TelegramApprovalRequest,
  reason: string,
): Promise<TelegramApprovalRequest> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({
      status: "failed",
      rejection_reason: reason,
    } as never)
    .eq("id", req.id)
    .select()
    .single();
  if (error) throw error;
  await logEvent(
    "telegram_approval_request_failed",
    `Richiesta fallita: ${req.title} — ${reason}`,
    { request_id: req.id, reason },
  );
  return data as unknown as TelegramApprovalRequest;
}

export async function listApprovalRequests(brainId?: string | null): Promise<TelegramApprovalRequest[]> {
  let q = supabase
    .from("telegram_approval_requests" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TelegramApprovalRequest[];
}

export async function listApprovalsForAction(actionId: string): Promise<TelegramApprovalRequest[]> {
  const { data, error } = await supabase
    .from("telegram_approval_requests" as never)
    .select("*")
    .eq("automation_action_id", actionId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as TelegramApprovalRequest[];
}

export type ApprovalSummary = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  high_risk: number;
  ready_to_send: number;
  failed: number;
};

const PENDING_STATUSES: ApprovalStatus[] = ["draft", "ready_to_send", "sent", "pending_response"];

export function summarizeApprovals(reqs: TelegramApprovalRequest[]): ApprovalSummary {
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let high_risk = 0;
  let ready_to_send = 0;
  let failed = 0;
  for (const r of reqs) {
    if (PENDING_STATUSES.includes(r.status)) pending++;
    if (r.status === "approved") approved++;
    if (r.status === "rejected") rejected++;
    if (r.status === "failed") failed++;
    if (r.status === "ready_to_send") ready_to_send++;
    if (r.risk_level === "high" && PENDING_STATUSES.includes(r.status)) high_risk++;
  }
  return {
    total: reqs.length,
    pending,
    approved,
    rejected,
    high_risk,
    ready_to_send,
    failed,
  };
}

export function buildMessagePreview(opts: {
  title: string;
  project?: string | null;
  risk_level: string;
  approval_type: ApprovalType | string;
  what_happens_if_approved?: string;
  what_happens_if_rejected?: string;
  extra?: string;
}): string {
  const lines = [
    `🤖 Brain Hub — Approvazione richiesta`,
    ``,
    `Azione: ${opts.title}`,
    `Tipo: ${APPROVAL_TYPE_LABEL[opts.approval_type as ApprovalType] ?? opts.approval_type}`,
    opts.project ? `Progetto: ${opts.project}` : null,
    `Rischio: ${opts.risk_level}`,
    ``,
    `✅ Se approvi: ${opts.what_happens_if_approved ?? "l'azione verrà segnata come approvata in Brain Hub."}`,
    `🛑 Se rifiuti: ${opts.what_happens_if_rejected ?? "l'azione resterà bloccata in attesa di nuova revisione."}`,
    opts.extra ? `\n${opts.extra}` : null,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}
