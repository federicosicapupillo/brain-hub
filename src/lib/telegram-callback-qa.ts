// Brain Hub v3.7.1 — Telegram Callback Loop QA Warnings (read-only).
// Genera warning diagnostici sul flusso Telegram bidirezionale, leggendo solo
// dati locali (telegram_approval_requests + automation_actions). Nessuna
// chiamata esterna, nessuna modifica di stato, nessuna esecuzione automatica.

import { supabase } from "@/integrations/supabase/client";

export type TelegramCallbackWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
  category: "Telegram Approval";
};

type ReqRow = {
  id: string;
  status: string;
  brain_id: string | null;
  automation_action_id: string | null;
  telegram_delivery_status: string | null;
  telegram_sent_at: string | null;
  telegram_error_text: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  expired_at: string | null;
  requested_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type ActionRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

const PENDING_TOO_LONG_MINUTES = 30;

function minutesAgo(iso: string | null): number {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function getMetaString(meta: Record<string, unknown> | null, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

const ACTIVE_ACTION_STATUSES = new Set([
  "suggested",
  "pending",
  "approved",
  "ready",
  "pending_execution",
  "queued",
  "running",
]);

export async function getTelegramCallbackWarnings(
  brainId?: string | null,
): Promise<TelegramCallbackWarning[]> {
  const warnings: TelegramCallbackWarning[] = [];

  let q = supabase
    .from("telegram_approval_requests")
    .select(
      "id,status,brain_id,automation_action_id,telegram_delivery_status,telegram_sent_at,telegram_error_text,approved_at,rejected_at,expired_at,requested_at,created_at,metadata",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data: reqsData } = await q;
  const reqs = (reqsData ?? []) as ReqRow[];

  if (reqs.length === 0) return warnings;

  // Load linked actions in one shot
  const actionIds = Array.from(
    new Set(reqs.map((r) => r.automation_action_id).filter((x): x is string => Boolean(x))),
  );
  const actionsById = new Map<string, ActionRow>();
  if (actionIds.length > 0) {
    const { data: actData } = await supabase
      .from("automation_actions")
      .select("id,status,metadata")
      .in("id", actionIds);
    for (const a of (actData ?? []) as ActionRow[]) actionsById.set(a.id, a);
  }

  // 1) pending too long
  const pendingTooLong = reqs.filter((r) => {
    const sentish =
      r.status === "pending_response" ||
      r.status === "sent" ||
      r.status === "pending" ||
      r.telegram_delivery_status === "sent";
    if (!sentish) return false;
    if (r.approved_at || r.rejected_at) return false;
    const cbStatus = getMetaString(r.metadata, "callback_status");
    if (cbStatus && cbStatus !== "pending") return false;
    const receivedAt = getMetaString(r.metadata, "telegram_callback_received_at");
    if (receivedAt) return false;
    const ref = r.telegram_sent_at ?? r.requested_at ?? r.created_at;
    return minutesAgo(ref) > PENDING_TOO_LONG_MINUTES;
  });
  if (pendingTooLong.length > 0) {
    warnings.push({
      id: "telegram-callback-pending-too-long",
      level: "warning",
      title: `Richiesta Telegram senza risposta (${pendingTooLong.length})`,
      description: `Una richiesta Telegram è stata inviata ma non ha ancora ricevuto approvazione o rifiuto da oltre ${PENDING_TOO_LONG_MINUTES} minuti.`,
      cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
      category: "Telegram Approval",
    });
  }

  // 2) invalid / expired callback
  const invalidCb = reqs.filter((r) => {
    const cb = getMetaString(r.metadata, "callback_status");
    return cb === "invalid" || cb === "expired" || cb === "not_found";
  });
  if (invalidCb.length > 0) {
    warnings.push({
      id: "telegram-callback-invalid",
      level: invalidCb.length >= 3 ? "error" : "warning",
      title: `Callback Telegram non valida (${invalidCb.length})`,
      description:
        "È stata ricevuta una callback Telegram non valida, scaduta o non riconosciuta.",
      cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
      category: "Telegram Approval",
    });
  }

  // 3) approved via Telegram but action not synced
  let approvedNotSynced = 0;
  let rejectedStillActive = 0;
  for (const r of reqs) {
    if (!r.automation_action_id) continue;
    const action = actionsById.get(r.automation_action_id);
    if (!action) continue;
    const aMeta = action.metadata ?? {};
    const tStatus = (aMeta as Record<string, unknown>).telegram_approval_status;
    const via =
      (aMeta as Record<string, unknown>).approved_via ??
      (aMeta as Record<string, unknown>).rejected_via;
    const cbStatus = getMetaString(r.metadata, "callback_status");
    const isApproved =
      r.status === "approved" ||
      cbStatus === "approved" ||
      getMetaString(r.metadata, "approved_via") === "telegram";
    const isRejected =
      r.status === "rejected" ||
      cbStatus === "rejected" ||
      getMetaString(r.metadata, "rejected_via") === "telegram";

    if (isApproved && (tStatus !== "approved" || via !== "telegram")) {
      approvedNotSynced++;
    }
    if (isRejected) {
      const stillActive = ACTIVE_ACTION_STATUSES.has(action.status);
      const metaMismatch = tStatus !== "rejected";
      if (stillActive || metaMismatch) rejectedStillActive++;
    }
  }
  if (approvedNotSynced > 0) {
    warnings.push({
      id: "telegram-approved-action-not-synced",
      level: "error",
      title: `Approvazione Telegram non sincronizzata (${approvedNotSynced})`,
      description:
        "Una richiesta è stata approvata via Telegram ma l’action collegata non risulta sincronizzata correttamente.",
      cta: { label: "Apri Action Queue", to: "/action-queue" },
      category: "Telegram Approval",
    });
  }
  if (rejectedStillActive > 0) {
    warnings.push({
      id: "telegram-rejected-action-still-active",
      level: "error",
      title: `Rifiuto Telegram non applicato (${rejectedStillActive})`,
      description:
        "Una richiesta è stata rifiutata via Telegram ma l’action collegata sembra ancora attiva o non sincronizzata.",
      cta: { label: "Apri Action Queue", to: "/action-queue" },
      category: "Telegram Approval",
    });
  }

  // 4) webhook configuration — solo dati locali: errori di consegna ricorrenti
  // con segnali tipo "302" nel testo o status failed dopo l'invio.
  const deliveryFailed = reqs.filter((r) => {
    const err = (r.telegram_error_text ?? "").toLowerCase();
    return err.includes("302") || err.includes("redirect") || err.includes("unauthorized");
  });
  if (deliveryFailed.length > 0) {
    warnings.push({
      id: "telegram-webhook-configuration-warning",
      level: "warning",
      title: "Webhook Telegram da controllare",
      description:
        "La configurazione webhook Telegram mostra errori di consegna o redirect non stabili nei log recenti.",
      cta: { label: "Apri Telegram Approvals", to: "/telegram-approvals" },
      category: "Telegram Approval",
    });
  }

  return warnings;
}
