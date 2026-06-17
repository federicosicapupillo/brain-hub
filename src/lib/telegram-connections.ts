import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type TelegramConnection = {
  id: string;
  user_id: string;
  brain_id: string | null;
  label: string;
  chat_id: string;
  is_enabled: boolean;
  default_for_approvals: boolean;
  risk_levels: string[] | null;
  approval_types: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TelegramDeliveryAttempt = {
  id: string;
  user_id: string;
  brain_id: string | null;
  approval_request_id: string;
  connection_id: string | null;
  delivery_status: string;
  telegram_message_id: string | null;
  telegram_chat_id: string | null;
  error_text: string | null;
  receipt_json: Record<string, unknown> | null;
  attempt_number: number;
  created_at: string;
};

export const STALE_SENDING_MS = 5 * 60 * 1000;

export function getTelegramDeliveryAge(
  req: { telegram_delivery_status?: string | null; updated_at?: string | null },
): number | null {
  if (!req.updated_at) return null;
  const t = Date.parse(req.updated_at);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

export function isTelegramDeliveryStale(
  req: { telegram_delivery_status?: string | null; updated_at?: string | null },
): boolean {
  if (req.telegram_delivery_status !== "sending") return false;
  const age = getTelegramDeliveryAge(req);
  return age !== null && age > STALE_SENDING_MS;
}

const SENSITIVE_KEYS = [
  "token",
  "api_key",
  "secret",
  "authorization",
  "bearer",
  "password",
  "webhook_secret",
];

function sanitize(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitize(x));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) out[k] = "[REDACTED]";
    else out[k] = sanitize(v);
  }
  return out;
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitize(value);
}

export type DeliveryStatus = "not_sent" | "sending" | "sent" | "failed";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  not_sent: "Da inviare",
  sending: "Invio in corso",
  sent: "Inviata",
  failed: "Fallita",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, string> = {
  not_sent: "bg-muted text-muted-foreground border-border",
  sending: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-600 border-red-500/30",
};

async function logEvent(
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

export async function listTelegramConnections(
  brainId?: string | null,
): Promise<TelegramConnection[]> {
  let q = supabase
    .from("telegram_connection_settings" as never)
    .select("*")
    .order("default_for_approvals", { ascending: false })
    .order("created_at", { ascending: false });
  if (brainId) q = q.or(`brain_id.eq.${brainId},brain_id.is.null`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TelegramConnection[];
}

export async function createTelegramConnection(input: {
  label: string;
  chat_id: string;
  brain_id?: string | null;
  default_for_approvals?: boolean;
  risk_levels?: string[] | null;
  approval_types?: string[] | null;
}): Promise<TelegramConnection> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data, error } = await supabase
    .from("telegram_connection_settings" as never)
    .insert({
      user_id: u.user.id,
      label: input.label.trim(),
      chat_id: input.chat_id.trim(),
      brain_id: input.brain_id ?? null,
      default_for_approvals: !!input.default_for_approvals,
      is_enabled: true,
      risk_levels: input.risk_levels ?? null,
      approval_types: input.approval_types ?? null,
    } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logEvent("telegram_connection_created" as LogEventType, "Telegram destination created", {
    connection_id: (data as { id: string }).id,
    label: input.label,
    brain_id: input.brain_id ?? null,
  });
  return data as unknown as TelegramConnection;
}

export async function updateTelegramConnection(
  id: string,
  patch: Partial<
    Pick<
      TelegramConnection,
      | "label"
      | "chat_id"
      | "is_enabled"
      | "default_for_approvals"
      | "brain_id"
      | "risk_levels"
      | "approval_types"
    >
  >,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_connection_settings" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent("telegram_connection_updated" as LogEventType, "Telegram destination updated", {
    connection_id: id,
    patch: sanitize(patch) as Record<string, unknown>,
  });
  if (patch.is_enabled === false) {
    await logEvent(
      "telegram_connection_disabled" as LogEventType,
      "Telegram destination disabled",
      { connection_id: id },
    );
  }
}

export async function deleteTelegramConnection(id: string): Promise<void> {
  const { error } = await supabase
    .from("telegram_connection_settings" as never)
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function logSendStarted(approvalId: string, connectionId?: string) {
  await logEvent(
    "telegram_approval_send_started" as LogEventType,
    "Telegram approval send started",
    { approval_id: approvalId, connection_id: connectionId ?? null },
  );
}

export async function logSendOk(approvalId: string, messageId: string | null, chatId: string) {
  await logEvent(
    "telegram_approval_sent" as LogEventType,
    "Telegram approval sent",
    { approval_id: approvalId, message_id: messageId, chat_id: chatId },
  );
}

export async function logSendFailed(approvalId: string, error: string) {
  await logEvent(
    "telegram_approval_send_failed" as LogEventType,
    "Telegram approval send failed",
    { approval_id: approvalId, error: error.slice(0, 300) },
  );
}

export async function logResendRequested(approvalId: string) {
  await logEvent(
    "telegram_approval_resend_requested" as LogEventType,
    "Telegram approval resend requested",
    { approval_id: approvalId },
  );
}

export async function logRetryStarted(approvalId: string) {
  await logEvent(
    "telegram_delivery_retry_started" as LogEventType,
    "Telegram delivery retry started",
    { approval_id: approvalId },
  );
}

export async function logStaleDetected(approvalId: string) {
  await logEvent(
    "telegram_delivery_stale_detected" as LogEventType,
    "Telegram delivery stale detected",
    { approval_id: approvalId },
  );
}

export async function logDiagnosticsOpened(brainId: string | null) {
  await logEvent(
    "telegram_connection_diagnostics_opened" as LogEventType,
    "Telegram diagnostics opened",
    { brain_id: brainId },
  );
}

export async function listDeliveryAttempts(approvalId: string): Promise<TelegramDeliveryAttempt[]> {
  const { data, error } = await supabase
    .from("telegram_delivery_attempts" as never)
    .select("*")
    .eq("approval_id", approvalId)
    .order("attempt_number", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as unknown as TelegramDeliveryAttempt[];
}

export async function markTelegramDeliveryFailedManual(
  approvalId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_approval_requests" as never)
    .update({
      telegram_delivery_status: "failed",
      telegram_error_text: reason.slice(0, 500),
    } as never)
    .eq("id", approvalId);
  if (error) throw new Error(error.message);
  await logEvent(
    "telegram_delivery_unblocked" as LogEventType,
    "Telegram delivery unblocked manually",
    { approval_id: approvalId, reason: reason.slice(0, 200) },
  );
}

