// ============================================================
// Brain Hub v3.8 — Gmail Connector (client-side read helpers)
// ============================================================
// All operations are READ-ONLY against local Supabase tables.
// No Gmail API calls happen here; sync is performed server-side.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import { createAction, type AutomationAction } from "@/lib/action-queue";

export type GmailConnection = {
  id: string;
  user_id: string;
  brain_id: string | null;
  google_email: string | null;
  google_user_id: string | null;
  status: string;
  scopes: string[];
  connected_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  message_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GmailMessageRow = {
  id: string;
  user_id: string;
  brain_id: string | null;
  connection_id: string | null;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  internal_date: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_preview: string | null;
  label_ids: string[];
  is_unread: boolean;
  is_important: boolean;
  has_attachments: boolean;
  detected_category: string | null;
  detected_priority: string | null;
  suggested_action_type: string | null;
  linked_action_id: string | null;
  source_query: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GmailPriority = "high" | "medium" | "low";
export type GmailCategory =
  | "urgent"
  | "reply_needed"
  | "meeting"
  | "lead"
  | "finance"
  | "notification"
  | "general";

export type GmailListFilters = {
  range?: "today" | "7d" | "all";
  unreadOnly?: boolean;
  priority?: GmailPriority;
  category?: GmailCategory;
  withActionOnly?: boolean;
  withoutActionOnly?: boolean;
  limit?: number;
};

// ---------------- Heuristics ----------------

const RX_URGENT =
  /\b(urgente|urgent|scadenza|entro\s+oggi|asap|overdue|problema|errore|critical)\b/i;
const RX_REPLY =
  /\b(puoi|potresti|conferma|confermare|disponibilità|disponibilita|fammi\s+sapere|please\s+confirm|can\s+you|could\s+you|risposta|reply)\b|\?/i;
const RX_MEETING =
  /\b(meeting|call|appuntamento|calendario|invito|riunione|teams|zoom|google\s+meet)\b/i;
const RX_LEAD =
  /\b(richiesta\s+info|preventivo|interessato|immobile|capannone|visita|sopralluogo|info\s+request)\b/i;
const RX_FINANCE =
  /\b(fattura|invoice|pagamento|payment|bonifico|saldo|scadenza\s+pagamento)\b/i;

export function classifyEmail(input: {
  subject: string | null;
  body: string | null;
  from_email: string | null;
}): { category: GmailCategory; priority: GmailPriority } {
  const text = `${input.subject ?? ""}\n${input.body ?? ""}`.toLowerCase();
  const from = (input.from_email ?? "").toLowerCase();

  if (/^(no[-_.]?reply|noreply)@/.test(from) || /\bnotifica\s+automatica\b/.test(text)) {
    return { category: "notification", priority: "low" };
  }
  if (RX_URGENT.test(text)) return { category: "urgent", priority: "high" };
  if (RX_FINANCE.test(text)) return { category: "finance", priority: "high" };
  if (RX_LEAD.test(text)) return { category: "lead", priority: "high" };
  if (RX_MEETING.test(text)) return { category: "meeting", priority: "medium" };
  if (RX_REPLY.test(text)) return { category: "reply_needed", priority: "medium" };
  return { category: "general", priority: "low" };
}

export function suggestedActionTypeFor(
  category: GmailCategory,
): "email_review" | "email_followup" | "email_reply_draft_internal" {
  if (category === "urgent" || category === "finance" || category === "lead")
    return "email_followup";
  if (category === "reply_needed" || category === "meeting")
    return "email_reply_draft_internal";
  return "email_review";
}

// ---------------- DB helpers ----------------

export async function listGmailConnections(
  brainId?: string | null,
): Promise<GmailConnection[]> {
  let q = supabase
    .from("gmail_connection_settings")
    .select("id,user_id,brain_id,google_email,google_user_id,status,scopes,connected_at,disconnected_at,last_sync_at,last_sync_status,last_sync_error,message_count,metadata,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (brainId) q = q.or(`brain_id.eq.${brainId},brain_id.is.null`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as GmailConnection[];
}


export type GmailSummary = {
  connected: boolean;
  connection: GmailConnection | null;
  totalMessages: number;
  todayCount: number;
  highPriorityCount: number;
  actionSuggestedCount: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export async function getGmailSummary(
  brainId?: string | null,
): Promise<GmailSummary> {
  const conns = await listGmailConnections(brainId ?? null);
  const conn =
    conns.find((c) => c.status === "connected" || c.status === "active") ??
    conns[0] ??
    null;

  let totalMessages = 0;
  let todayCount = 0;
  let highPriorityCount = 0;
  let actionSuggestedCount = 0;

  if (conn) {
    // Messages are scoped by connection_id (already user/account-scoped).
    // brain_id on messages can be null when sync happened without brain context,
    // so we do NOT filter by brain_id here — would hide all rows.
    const { count: t } = await supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id);
    totalMessages = t ?? 0;

    const { count: tc } = await supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", startOfTodayIso());
    todayCount = tc ?? 0;

    const { count: hc } = await supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .eq("detected_priority", "high");
    highPriorityCount = hc ?? 0;

    // Count actions created from Gmail via metadata.source_label = 'gmail_connector'.
    // RLS already scopes to current user.
    const { count: ac } = await supabase
      .from("automation_actions")
      .select("id", { count: "exact", head: true })
      .filter("metadata->>source_label", "eq", "gmail_connector");
    actionSuggestedCount = ac ?? 0;
  }

  return {
    connected:
      !!conn && (conn.status === "connected" || conn.status === "active"),
    connection: conn,
    totalMessages,
    todayCount,
    highPriorityCount,
    actionSuggestedCount,
    lastSyncAt: conn?.last_sync_at ?? null,
    lastSyncStatus: conn?.last_sync_status ?? null,
  };
}


export async function listSyncedEmails(
  brainId?: string | null,
  filters: GmailListFilters = {},
): Promise<GmailMessageRow[]> {
  let q = supabase
    .from("gmail_message_map")
    .select("*")
    .order("internal_date", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
  if (brainId) q = q.eq("brain_id", brainId);
  if (filters.range === "today") q = q.gte("internal_date", startOfTodayIso());
  else if (filters.range === "7d") q = q.gte("internal_date", isoDaysAgo(7));
  if (filters.unreadOnly) q = q.eq("is_unread", true);
  if (filters.priority) q = q.eq("detected_priority", filters.priority);
  if (filters.category) q = q.eq("detected_category", filters.category);
  if (filters.withActionOnly) q = q.not("linked_action_id", "is", null);
  if (filters.withoutActionOnly) q = q.is("linked_action_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as GmailMessageRow[];
}

export async function getSyncedEmail(
  messageMapId: string,
): Promise<GmailMessageRow | null> {
  const { data, error } = await supabase
    .from("gmail_message_map")
    .select("*")
    .eq("id", messageMapId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as GmailMessageRow | null;
}

export async function getGmailActionSuggestions(
  brainId?: string | null,
): Promise<GmailMessageRow[]> {
  return listSyncedEmails(brainId, {
    range: "7d",
    priority: "high",
    withoutActionOnly: true,
    limit: 20,
  });
}

export async function createActionFromGmailMessage(
  messageMapId: string,
): Promise<AutomationAction> {
  const row = await getSyncedEmail(messageMapId);
  if (!row) throw new Error("Email non trovata");

  const category = (row.detected_category as GmailCategory | null) ?? "general";
  const actionType = suggestedActionTypeFor(category);
  const priorityRaw = (row.detected_priority as GmailPriority | null) ?? "low";
  const riskLevel = actionType === "email_review" ? "low" : "medium";

  const subject = (row.subject ?? "(nessun oggetto)").slice(0, 140);
  const fromLabel = row.from_name
    ? `${row.from_name} <${row.from_email ?? ""}>`
    : (row.from_email ?? "mittente sconosciuto");

  const title = `Email: ${subject}`;
  const description =
    `Da: ${fromLabel}\n` +
    `Categoria: ${category} · Priorità: ${priorityRaw}\n` +
    `Snippet: ${(row.snippet ?? "").slice(0, 280)}`;

  const action = await createAction({
    source: "user_manual",
    action_type: actionType as never,
    title,
    description,
    priority: priorityRaw,
    risk_level: riskLevel,
    brain_id: row.brain_id ?? undefined,
    metadata: {
      source_label: "gmail_connector",
      gmail_message_map_id: row.id,
      gmail_message_id: row.gmail_message_id,
      gmail_thread_id: row.gmail_thread_id,
      from_email: row.from_email,
      subject: row.subject,
      detected_category: row.detected_category,
      detected_priority: row.detected_priority,
    },
  });

  await supabase
    .from("gmail_message_map")
    .update({ linked_action_id: action.id, suggested_action_type: actionType } as never)
    .eq("id", row.id);

  await logGmailConnectorEvent("gmail_message_action_created", "Action creata da email", {
    action_id: action.id,
    message_map_id: row.id,
    detected_category: row.detected_category,
    detected_priority: row.detected_priority,
  });

  return action;
}

// ---------------- Warnings ----------------

export type GmailWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
  category: "Gmail / Email";
};

export async function getGmailWarnings(
  brainId?: string | null,
): Promise<GmailWarning[]> {
  const warnings: GmailWarning[] = [];
  const conns = await listGmailConnections(brainId ?? null);

  if (conns.length === 0) {
    return warnings; // no connection registered: no warning unless project demands email
  }

  const active = conns.find((c) => c.status === "connected") ?? null;

  if (!active) {
    warnings.push({
      id: "gmail-not-connected",
      level: "info",
      title: "Gmail non collegato",
      description:
        "Esiste una configurazione Gmail ma nessuna connessione attiva. Collega Gmail per abilitare la sync read-only.",
      cta: { label: "Apri Gmail Connector", to: "/gmail-connector" },
      category: "Gmail / Email",
    });
  }

  if (active && !active.last_sync_at) {
    warnings.push({
      id: "gmail-connected-never-synced",
      level: "warning",
      title: "Gmail collegato ma mai sincronizzato",
      description: "Esegui una prima sync per popolare la cache email locale.",
      cta: { label: "Apri Gmail Connector", to: "/gmail-connector" },
      category: "Gmail / Email",
    });
  }

  if (active && active.last_sync_status === "failed") {
    warnings.push({
      id: "gmail-last-sync-failed",
      level: "error",
      title: "Ultima sync Gmail fallita",
      description: active.last_sync_error?.slice(0, 200) ?? "Errore non specificato.",
      cta: { label: "Riprova", to: "/gmail-connector" },
      category: "Gmail / Email",
    });
  }

  for (const c of conns) {
    const bad = (c.scopes ?? []).filter((s) =>
      [
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.insert",
        "https://www.googleapis.com/auth/gmail.labels",
      ].includes(s),
    );
    if (bad.length > 0) {
      warnings.push({
        id: `gmail-scope-not-readonly-${c.id}`,
        level: "error",
        title: "Scope Gmail non read-only",
        description:
          "La connessione Gmail include scope di scrittura/invio. Disconnetti e ricollega con scope solo gmail.readonly.",
        cta: { label: "Apri Gmail Connector", to: "/gmail-connector" },
        category: "Gmail / Email",
      });
      break;
    }
  }

  if (active) {
    const yesterday = isoDaysAgo(1);
    let q = supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", active.id)
      .eq("detected_priority", "high")
      .is("linked_action_id", null)
      .lte("internal_date", yesterday);
    if (brainId) q = q.eq("brain_id", brainId);
    const { count } = await q;
    if ((count ?? 0) > 0) {
      warnings.push({
        id: "gmail-high-priority-without-action",
        level: "warning",
        title: `Email high priority senza action (${count})`,
        description: "Sono presenti email a priorità alta da oltre 24h senza action collegata.",
        cta: { label: "Rivedi email", to: "/gmail-connector" },
        category: "Gmail / Email",
      });
    }

    let q2 = supabase
      .from("gmail_message_map")
      .select("id,linked_action_id", { count: "exact", head: false })
      .eq("connection_id", active.id)
      .not("linked_action_id", "is", null)
      .limit(50);
    if (brainId) q2 = q2.eq("brain_id", brainId);
    const { data: linkedRows } = await q2;
    const linkedIds = (linkedRows ?? [])
      .map((r) => (r as { linked_action_id: string | null }).linked_action_id)
      .filter((x): x is string => !!x);
    if (linkedIds.length > 0) {
      const { data: actRows } = await supabase
        .from("automation_actions")
        .select("id,status")
        .in("id", linkedIds);
      const stale = (actRows ?? []).filter(
        (a) => (a as { status: string }).status === "suggested",
      ).length;
      if (stale > 0) {
        warnings.push({
          id: "gmail-action-created-not-reviewed",
          level: "info",
          title: `Action email da revisionare (${stale})`,
          description:
            "Action create da email risultano ancora come 'suggerite'. Aprile in Action Queue per decidere.",
          cta: { label: "Apri Action Queue", to: "/action-queue" },
          category: "Gmail / Email",
        });
      }
    }
  }

  return warnings;
}

// ---------------- Event log ----------------

export async function logGmailConnectorEvent(
  action: string,
  notes: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: null,
      action: action as never,
      notes,
      metadata,
    } as never);
  } catch {
    // non-blocking
  }
}
