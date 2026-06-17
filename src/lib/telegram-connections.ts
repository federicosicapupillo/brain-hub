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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

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
  patch: Partial<Pick<TelegramConnection, "label" | "chat_id" | "is_enabled" | "default_for_approvals" | "brain_id">>,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_connection_settings" as never)
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await logEvent("telegram_connection_updated" as LogEventType, "Telegram destination updated", {
    connection_id: id,
    patch,
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
