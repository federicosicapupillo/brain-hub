// ============================================================
// Brain Hub v3.8.1 — Email Daily Brief / Next Actions
// ============================================================
// Read-only aggregation over gmail_message_map. No Gmail API
// calls happen here, no email is sent, modified or deleted.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import {
  listGmailConnections,
  listSyncedEmails,
  suggestedActionTypeFor,
  type GmailCategory,
  type GmailMessageRow,
  type GmailPriority,
} from "@/lib/gmail-connector";

export type DailyBriefBucket = {
  key: GmailCategory;
  label: string;
  emails: GmailMessageRow[];
};

export type NextActionSuggestion = {
  message: GmailMessageRow;
  suggestedActionType:
    | "email_review"
    | "email_followup"
    | "email_reply_draft_internal";
  reason: string;
  priority: GmailPriority;
  alreadyLinked: boolean;
};

export type DailyBriefStats = {
  totalToday: number;
  highPriorityToday: number;
  unreadToday: number;
  withoutActionToday: number;
  total7d: number;
  highPriority7d: number;
  withoutAction7d: number;
};

export type DailyBrief = {
  generatedAt: string;
  connected: boolean;
  account: string | null;
  lastSyncAt: string | null;
  stats: DailyBriefStats;
  todayHighlights: GmailMessageRow[];
  buckets: DailyBriefBucket[];
  nextActions: NextActionSuggestion[];
};

const CATEGORY_LABEL: Record<GmailCategory, string> = {
  urgent: "Urgenti",
  reply_needed: "Da rispondere",
  meeting: "Meeting / Calendario",
  lead: "Lead / Opportunità",
  finance: "Finance / Fatture",
  notification: "Notifiche",
  general: "Generali",
};

const REASON_BY_CATEGORY: Record<GmailCategory, string> = {
  urgent: "Email urgente: gestire entro oggi.",
  reply_needed: "Richiede una risposta esplicita.",
  meeting: "Riferimento a meeting / calendario.",
  lead: "Potenziale lead o richiesta info.",
  finance: "Fattura / pagamento: verificare scadenza.",
  notification: "Notifica automatica: solo review.",
  general: "Email generica: review opzionale.",
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

async function countMessages(
  connectionId: string,
  build: (q: ReturnType<typeof supabase.from>) => unknown,
): Promise<number> {
  // Helper kept for clarity, not used directly to keep types simple.
  void connectionId;
  void build;
  return 0;
}
void countMessages;

export async function getDailyBrief(
  brainId?: string | null,
): Promise<DailyBrief> {
  const generatedAt = new Date().toISOString();
  const conns = await listGmailConnections(brainId ?? null);
  const conn =
    conns.find((c) => c.status === "connected" || c.status === "active") ??
    conns[0] ??
    null;

  const empty: DailyBrief = {
    generatedAt,
    connected: false,
    account: null,
    lastSyncAt: null,
    stats: {
      totalToday: 0,
      highPriorityToday: 0,
      unreadToday: 0,
      withoutActionToday: 0,
      total7d: 0,
      highPriority7d: 0,
      withoutAction7d: 0,
    },
    todayHighlights: [],
    buckets: [],
    nextActions: [],
  };

  if (!conn) return empty;

  const todayIso = startOfTodayIso();
  const weekIso = isoDaysAgo(7);

  // Counts (head queries)
  const baseToday = supabase
    .from("gmail_message_map")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", conn.id)
    .gte("internal_date", todayIso);

  const [
    { count: totalTodayC },
    { count: highTodayC },
    { count: unreadTodayC },
    { count: withoutActionTodayC },
    { count: total7dC },
    { count: high7dC },
    { count: withoutAction7dC },
  ] = await Promise.all([
    baseToday,
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso)
      .eq("detected_priority", "high"),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso)
      .eq("is_unread", true),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso)
      .is("linked_action_id", null),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", weekIso),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", weekIso)
      .eq("detected_priority", "high"),
    supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", weekIso)
      .is("linked_action_id", null),
  ]);

  // Today highlights: high priority first, then medium
  const todayMsgs = await listSyncedEmails(brainId ?? null, {
    range: "today",
    limit: 50,
  });

  const todayHighlights = [...todayMsgs]
    .sort((a, b) => {
      const w = (p: string | null) =>
        p === "high" ? 0 : p === "medium" ? 1 : 2;
      return w(a.detected_priority) - w(b.detected_priority);
    })
    .slice(0, 8);

  // Buckets by category (last 7d)
  const weekMsgs = await listSyncedEmails(brainId ?? null, {
    range: "7d",
    limit: 200,
  });

  const groups = new Map<GmailCategory, GmailMessageRow[]>();
  for (const m of weekMsgs) {
    const cat = ((m.detected_category as GmailCategory | null) ??
      "general") as GmailCategory;
    const list = groups.get(cat) ?? [];
    list.push(m);
    groups.set(cat, list);
  }

  const bucketOrder: GmailCategory[] = [
    "urgent",
    "finance",
    "lead",
    "reply_needed",
    "meeting",
    "general",
    "notification",
  ];

  const buckets: DailyBriefBucket[] = bucketOrder
    .filter((k) => (groups.get(k)?.length ?? 0) > 0)
    .map((k) => ({
      key: k,
      label: CATEGORY_LABEL[k],
      emails: (groups.get(k) ?? []).slice(0, 5),
    }));

  // Next actions: high priority without action, then medium without action
  const candidates = weekMsgs
    .filter((m) => !m.linked_action_id)
    .filter(
      (m) =>
        m.detected_priority === "high" || m.detected_priority === "medium",
    )
    .sort((a, b) => {
      const w = (p: string | null) =>
        p === "high" ? 0 : p === "medium" ? 1 : 2;
      const dp = w(a.detected_priority) - w(b.detected_priority);
      if (dp !== 0) return dp;
      const da = a.internal_date ? Date.parse(a.internal_date) : 0;
      const db = b.internal_date ? Date.parse(b.internal_date) : 0;
      return db - da;
    })
    .slice(0, 10);

  const nextActions: NextActionSuggestion[] = candidates.map((m) => {
    const cat = ((m.detected_category as GmailCategory | null) ??
      "general") as GmailCategory;
    return {
      message: m,
      suggestedActionType: suggestedActionTypeFor(cat),
      reason: REASON_BY_CATEGORY[cat],
      priority: (m.detected_priority as GmailPriority | null) ?? "low",
      alreadyLinked: false,
    };
  });

  return {
    generatedAt,
    connected: conn.status === "connected" || conn.status === "active",
    account: conn.google_email,
    lastSyncAt: conn.last_sync_at,
    stats: {
      totalToday: totalTodayC ?? 0,
      highPriorityToday: highTodayC ?? 0,
      unreadToday: unreadTodayC ?? 0,
      withoutActionToday: withoutActionTodayC ?? 0,
      total7d: total7dC ?? 0,
      highPriority7d: high7dC ?? 0,
      withoutAction7d: withoutAction7dC ?? 0,
    },
    todayHighlights,
    buckets,
    nextActions,
  };
}

export function categoryLabel(cat: GmailCategory): string {
  return CATEGORY_LABEL[cat];
}
