// ============================================================
// Brain Hub v3.8.1 — Daily Operating Brief / Jack Briefing Engine
// ============================================================
// READ-ONLY aggregation engine + action suggestion.
// No external automation: no email send, no Telegram send,
// no n8n call, no Gmail/Drive/Calendar/GitHub modification,
// no external AI call. Aggregates data already present in Brain Hub.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import { createAction, type AutomationAction } from "@/lib/action-queue";

// ---------------- Types ----------------

export type DailyBriefStatus = "generated" | "stale" | "regenerated";

export type ImplementedItem = {
  at: string;
  action: string;
  notes: string | null;
};

export type OpenActionsSummary = {
  total: number;
  suggested: number;
  pending: number;
  approved: number;
  rejected_today: number;
  approved_today: number;
  created_today: number;
  high_risk: number;
  from_telegram: number;
  from_gmail: number;
  blocked_or_old: number;
  top: Array<{
    id: string;
    title: string;
    status: string;
    risk_level: string;
    priority: string;
    source: string;
  }>;
};

export type WarningsSummary = {
  total: number;
  error: number;
  warning: number;
  info: number;
  top: Array<{
    id: string;
    level: "error" | "warning" | "info";
    title: string;
    category: string | null;
  }>;
};

export type EmailSummary = {
  available: boolean;
  account: string | null;
  total_today: number;
  high_priority_today: number;
  with_action_today: number;
  without_action_today: number;
  top: Array<{
    id: string;
    subject: string | null;
    from: string | null;
    priority: string | null;
    category: string | null;
  }>;
};

export type CalendarSummary = {
  available: boolean;
  events_today: number;
  events_next_7d: number;
  upcoming: Array<{
    id: string;
    title: string;
    start: string | null;
    end: string | null;
  }>;
};

export type DriveSummary = {
  available: boolean;
  files_today: number;
  knowledge_sources_today: number;
};

export type AutomationSummary = {
  telegram_approved_today: number;
  telegram_rejected_today: number;
  telegram_pending: number;
  telegram_failed: number;
  n8n_runs_recent: number;
  n8n_errors_recent: number;
  actions_ready: number;
};

export type AgentSummary = {
  runs_today: number;
  output_to_review: number;
};

export type ProjectStatusSummary = {
  health: "healthy" | "warning" | "blocked" | "incomplete";
  reasons: string[];
};

export type NextActionItem = {
  id: string;
  title: string;
  description: string;
  source_module: string;
  risk_level: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  action_type: string;
  reason: string;
  verification: string;
  linked_object_id: string | null;
};

export type SourceCounts = Record<
  | "master_snapshot"
  | "action_queue"
  | "telegram"
  | "gmail"
  | "calendar"
  | "drive"
  | "loop_qa"
  | "agent_runs"
  | "n8n"
  | "code_handoffs"
  | "build_engines"
  | "timeline",
  { available: boolean; count: number; note?: string }
>;

export type DailyBriefRow = {
  id: string;
  user_id: string;
  brain_id: string | null;
  brief_date: string;
  status: string;
  generated_at: string;
  title: string;
  executive_summary: string;
  voice_summary_text: string | null;
  project_status_summary: string | null;
  today_activity_summary: string | null;
  implemented_today: ImplementedItem[];
  open_actions_summary: OpenActionsSummary;
  warnings_summary: WarningsSummary;
  email_summary: EmailSummary;
  calendar_summary: CalendarSummary;
  drive_summary: DriveSummary;
  automation_summary: AutomationSummary;
  agent_summary: AgentSummary;
  next_actions: NextActionItem[];
  source_counts: SourceCounts;
  created_action_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// ---------------- Helpers ----------------

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function safeStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function metaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ---------------- Event log ----------------

export type DailyBriefEvent =
  | "daily_brief_opened"
  | "daily_brief_generated"
  | "daily_brief_regenerated"
  | "daily_brief_action_created"
  | "daily_brief_bulk_actions_created"
  | "daily_brief_voice_summary_viewed"
  | "daily_brief_snapshot_update_clicked";

export async function logDailyBriefEvent(
  event: DailyBriefEvent,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const userId = await getUserId();
    if (!userId) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: userId,
      clipboard_item_id: null,
      action: event as never,
      notes,
      metadata,
    } as never);
  } catch {
    // non-blocking
  }
}

// ---------------- Source collectors ----------------

async function collectMasterSnapshot(brainId: string | null) {
  try {
    let q = supabase
      .from("master_snapshot_versions")
      .select("id,title,version_label,version_status,reason,updated_at,created_at,brain_id")
      .order("created_at", { ascending: false })
      .limit(5);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      version_label: string;
      version_status: string;
      reason: string | null;
      updated_at: string;
    }>;
    const current = rows.find((r) => r.version_status === "current") ?? rows[0] ?? null;
    return {
      available: true,
      count: rows.length,
      current_label: current?.version_label ?? null,
      last_updated: current?.updated_at ?? null,
      recent_reasons: rows.slice(0, 3).map((r) => r.reason).filter(Boolean) as string[],
    };
  } catch {
    return { available: false, count: 0, note: "fonte non disponibile" };
  }
}

type ActionRow = {
  id: string;
  title: string;
  status: string;
  source: string;
  risk_level: string;
  priority: string;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  metadata: Record<string, unknown> | null;
};

async function collectActions(brainId: string | null): Promise<{
  rows: ActionRow[];
  summary: OpenActionsSummary;
  available: boolean;
}> {
  try {
    let q = supabase
      .from("automation_actions")
      .select(
        "id,title,status,source,risk_level,priority,created_at,approved_at,rejected_at,metadata",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as ActionRow[];
    const today = startOfTodayIso();

    const isOpen = (s: string) =>
      s === "suggested" || s === "pending_approval" || s === "approved" || s === "ready_to_execute";

    const top = rows
      .filter((r) => isOpen(r.status))
      .sort((a, b) => {
        const w = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
        return w(a.priority) - w(b.priority);
      })
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        risk_level: r.risk_level,
        priority: r.priority,
        source: r.source,
      }));

    const summary: OpenActionsSummary = {
      total: rows.length,
      suggested: rows.filter((r) => r.status === "suggested").length,
      pending: rows.filter((r) => r.status === "pending_approval").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected_today: rows.filter(
        (r) => r.rejected_at && r.rejected_at >= today,
      ).length,
      approved_today: rows.filter(
        (r) => r.approved_at && r.approved_at >= today,
      ).length,
      created_today: rows.filter((r) => r.created_at >= today).length,
      high_risk: rows.filter((r) => r.risk_level === "high" && isOpen(r.status))
        .length,
      from_telegram: rows.filter(
        (r) =>
          metaString(r.metadata, "approved_via") === "telegram" ||
          metaString(r.metadata, "rejected_via") === "telegram" ||
          metaString(r.metadata, "source_label") === "telegram",
      ).length,
      from_gmail: rows.filter(
        (r) => metaString(r.metadata, "source_label") === "gmail_connector",
      ).length,
      blocked_or_old: rows.filter((r) => {
        if (!isOpen(r.status)) return false;
        const ageHours = (Date.now() - new Date(r.created_at).getTime()) / 36e5;
        return ageHours > 48;
      }).length,
      top,
    };
    return { rows, summary, available: true };
  } catch {
    return {
      rows: [],
      available: false,
      summary: {
        total: 0,
        suggested: 0,
        pending: 0,
        approved: 0,
        rejected_today: 0,
        approved_today: 0,
        created_today: 0,
        high_risk: 0,
        from_telegram: 0,
        from_gmail: 0,
        blocked_or_old: 0,
        top: [],
      },
    };
  }
}

async function collectTelegram(brainId: string | null) {
  try {
    let q = supabase
      .from("telegram_approval_requests")
      .select(
        "id,status,brain_id,telegram_delivery_status,telegram_error_text,approved_at,rejected_at,created_at,metadata",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      status: string;
      telegram_delivery_status: string | null;
      telegram_error_text: string | null;
      approved_at: string | null;
      rejected_at: string | null;
      created_at: string;
      metadata: Record<string, unknown> | null;
    }>;
    const today = startOfTodayIso();
    return {
      available: true,
      total: rows.length,
      approved_today: rows.filter(
        (r) => r.approved_at && r.approved_at >= today,
      ).length,
      rejected_today: rows.filter(
        (r) => r.rejected_at && r.rejected_at >= today,
      ).length,
      pending: rows.filter(
        (r) =>
          (r.status === "pending" ||
            r.status === "pending_response" ||
            r.status === "sent") &&
          !r.approved_at &&
          !r.rejected_at,
      ).length,
      failed: rows.filter(
        (r) =>
          r.telegram_delivery_status === "failed" ||
          (r.telegram_error_text ?? "").length > 0,
      ).length,
    };
  } catch {
    return {
      available: false,
      total: 0,
      approved_today: 0,
      rejected_today: 0,
      pending: 0,
      failed: 0,
    };
  }
}

async function collectGmail(brainId: string | null): Promise<{
  summary: EmailSummary;
  count: number;
}> {
  try {
    const { listGmailConnections } = await import("@/lib/gmail-connector");
    const conns = await listGmailConnections(brainId ?? null);
    const conn =
      conns.find((c) => c.status === "connected" || c.status === "active") ??
      conns[0] ??
      null;

    if (!conn) {
      return {
        count: 0,
        summary: {
          available: false,
          account: null,
          total_today: 0,
          high_priority_today: 0,
          with_action_today: 0,
          without_action_today: 0,
          top: [],
        },
      };
    }

    const todayIso = startOfTodayIso();
    const baseFilter = supabase
      .from("gmail_message_map")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .gte("internal_date", todayIso);

    const [
      { count: totalToday },
      { count: highToday },
      { count: withAction },
      { count: withoutAction },
      { data: topRows },
    ] = await Promise.all([
      baseFilter,
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
        .not("linked_action_id", "is", null),
      supabase
        .from("gmail_message_map")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", conn.id)
        .gte("internal_date", todayIso)
        .is("linked_action_id", null),
      supabase
        .from("gmail_message_map")
        .select(
          "id,subject,from_email,from_name,detected_priority,detected_category,internal_date",
        )
        .eq("connection_id", conn.id)
        .gte("internal_date", todayIso)
        .order("internal_date", { ascending: false })
        .limit(5),
    ]);

    const top = ((topRows ?? []) as Array<{
      id: string;
      subject: string | null;
      from_email: string | null;
      from_name: string | null;
      detected_priority: string | null;
      detected_category: string | null;
    }>).map((r) => ({
      id: r.id,
      subject: r.subject,
      from: r.from_name ? `${r.from_name} <${r.from_email ?? ""}>` : r.from_email,
      priority: r.detected_priority,
      category: r.detected_category,
    }));

    return {
      count: totalToday ?? 0,
      summary: {
        available: true,
        account: conn.google_email,
        total_today: totalToday ?? 0,
        high_priority_today: highToday ?? 0,
        with_action_today: withAction ?? 0,
        without_action_today: withoutAction ?? 0,
        top,
      },
    };
  } catch {
    return {
      count: 0,
      summary: {
        available: false,
        account: null,
        total_today: 0,
        high_priority_today: 0,
        with_action_today: 0,
        without_action_today: 0,
        top: [],
      },
    };
  }
}

async function collectCalendar(brainId: string | null): Promise<{
  summary: CalendarSummary;
}> {
  try {
    const todayIso = startOfTodayIso();
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
    let q = supabase
      .from("calendar_event_map")
      .select("id,title,start_at,end_at")
      .gte("start_at", todayIso)
      .lte("start_at", in7)
      .order("start_at", { ascending: true })
      .limit(20);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      id: string;
      title: string | null;
      start_at: string | null;
      end_at: string | null;
    }>;
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const eot = endOfToday.toISOString();
    return {
      summary: {
        available: true,
        events_today: rows.filter(
          (r) => r.start_at && r.start_at <= eot,
        ).length,
        events_next_7d: rows.length,
        upcoming: rows.slice(0, 5).map((r) => ({
          id: r.id,
          title: r.title ?? "(senza titolo)",
          start: r.start_at,
          end: r.end_at,
        })),
      },
    };
  } catch {
    return {
      summary: {
        available: false,
        events_today: 0,
        events_next_7d: 0,
        upcoming: [],
      },
    };
  }
}

async function collectDrive(brainId: string | null): Promise<{
  summary: DriveSummary;
}> {
  try {
    const todayIso = startOfTodayIso();
    let q1 = supabase
      .from("drive_file_map")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso);
    if (brainId) q1 = q1.eq("brain_id", brainId);

    let q2 = supabase
      .from("knowledge_sources")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso);
    if (brainId) q2 = q2.eq("brain_id", brainId);

    const [{ count: filesToday }, { count: ksToday }] = await Promise.all([q1, q2]);
    return {
      summary: {
        available: true,
        files_today: filesToday ?? 0,
        knowledge_sources_today: ksToday ?? 0,
      },
    };
  } catch {
    return { summary: { available: false, files_today: 0, knowledge_sources_today: 0 } };
  }
}

async function collectN8n(brainId: string | null): Promise<{
  runs_recent: number;
  errors_recent: number;
  available: boolean;
}> {
  try {
    const since = isoDaysAgo(3);
    let q = supabase
      .from("n8n_execution_logs")
      .select("id,success,error_text,created_at,brain_id")
      .gte("created_at", since)
      .limit(200);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ success: boolean | null; error_text: string | null }>;
    return {
      available: true,
      runs_recent: rows.length,
      errors_recent: rows.filter(
        (r) => r.success === false || (r.error_text ?? "").length > 0,
      ).length,
    };
  } catch {
    return { available: false, runs_recent: 0, errors_recent: 0 };
  }
}

async function collectAgentRuns(brainId: string | null): Promise<{
  summary: AgentSummary;
  available: boolean;
}> {
  try {
    const today = startOfTodayIso();
    let q = supabase
      .from("agent_run_logs")
      .select("id,run_status,created_at,brain_id")
      .gte("created_at", today)
      .limit(200);
    if (brainId) q = q.eq("brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ run_status: string }>;
    return {
      available: true,
      summary: {
        runs_today: rows.length,
        output_to_review: rows.filter(
          (r) =>
            r.run_status === "completed" ||
            r.run_status === "needs_review" ||
            r.run_status === "pending_review",
        ).length,
      },
    };
  } catch {
    return { available: false, summary: { runs_today: 0, output_to_review: 0 } };
  }
}

async function collectTimeline(brainId: string | null): Promise<{
  implemented: ImplementedItem[];
  todayCount: number;
  available: boolean;
}> {
  try {
    const today = startOfTodayIso();
    let q = supabase
      .from("clipboard_execution_logs")
      .select("id,action,notes,created_at,metadata")
      .gte("created_at", today)
      .order("created_at", { ascending: false })
      .limit(200);
    if (brainId) q = q.eq("metadata->>brain_id", brainId);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      action: string;
      notes: string | null;
      created_at: string;
    }>;

    const IMPL_TOKENS = [
      "implemented",
      "completed",
      "executed",
      "approved",
      "version_created",
      "snapshot",
      "callback_received",
      "connector",
      "sync_completed",
      "deployed",
    ];
    const implemented: ImplementedItem[] = rows
      .filter((r) =>
        IMPL_TOKENS.some((t) => r.action.toLowerCase().includes(t)),
      )
      .slice(0, 12)
      .map((r) => ({ at: r.created_at, action: r.action, notes: r.notes }));

    return { implemented, todayCount: rows.length, available: true };
  } catch {
    return { implemented: [], todayCount: 0, available: false };
  }
}

async function collectLoopQAWarnings(brainId: string | null): Promise<{
  summary: WarningsSummary;
  available: boolean;
}> {
  try {
    const { getLoopWarnings } = await import("@/lib/loop-qa");
    const warnings = await getLoopWarnings(brainId ?? null);
    const top = warnings
      .filter((w) => w.level === "error" || w.level === "warning")
      .slice(0, 6)
      .map((w) => ({
        id: w.id,
        level: w.level,
        title: w.title,
        category: w.category ?? null,
      }));
    return {
      available: true,
      summary: {
        total: warnings.length,
        error: warnings.filter((w) => w.level === "error").length,
        warning: warnings.filter((w) => w.level === "warning").length,
        info: warnings.filter((w) => w.level === "info").length,
        top,
      },
    };
  } catch {
    return {
      available: false,
      summary: { total: 0, error: 0, warning: 0, info: 0, top: [] },
    };
  }
}

// ---------------- Next actions composer ----------------

function composeNextActions(args: {
  email: EmailSummary;
  warnings: WarningsSummary;
  openActions: OpenActionsSummary;
  telegram: AutomationSummary;
  ms: { current_label: string | null; recent_reasons: string[] };
  impl: ImplementedItem[];
}): NextActionItem[] {
  const out: NextActionItem[] = [];

  // High priority email without action
  for (const e of args.email.top) {
    if (e.priority === "high" && out.length < 5) {
      out.push({
        id: `email:${e.id}`,
        title: `Rivedere email: ${e.subject ?? "(senza oggetto)"}`,
        description: `Email da ${e.from ?? "?"} a priorità alta senza action collegata.`,
        source_module: "gmail_connector",
        risk_level: "medium",
        priority: "high",
        action_type: "email_review",
        reason: "Email high priority oggi senza action collegata.",
        verification: "Aprire in Gmail Connector e decidere risposta o follow-up.",
        linked_object_id: e.id,
      });
    }
  }

  // Telegram pending too long
  if (args.telegram.telegram_pending > 0 && out.length < 5) {
    out.push({
      id: "telegram:pending",
      title: `Gestire ${args.telegram.telegram_pending} approvazioni Telegram pendenti`,
      description:
        "Sono presenti richieste Telegram inviate ma senza approvazione o rifiuto.",
      source_module: "telegram_approvals",
      risk_level: "low",
      priority: "medium",
      action_type: "manual_task",
      reason: "Pending Telegram in attesa di risposta.",
      verification: "Aprire Telegram Approvals e rispondere.",
      linked_object_id: null,
    });
  }

  // High risk open actions
  if (args.openActions.high_risk > 0 && out.length < 5) {
    out.push({
      id: "actions:high-risk",
      title: `Approvare/rifiutare ${args.openActions.high_risk} action high risk`,
      description:
        "Esistono action high risk aperte. Decidere prima di lasciarle invecchiare.",
      source_module: "action_queue",
      risk_level: "medium",
      priority: "high",
      action_type: "manual_task",
      reason: "Action high risk in coda.",
      verification: "Aprire Action Queue, filtrare per high risk, decidere.",
      linked_object_id: null,
    });
  }

  // Critical warnings
  if (args.warnings.error > 0 && out.length < 5) {
    out.push({
      id: "loopqa:errors",
      title: `Risolvere ${args.warnings.error} warning critici`,
      description: "Loop QA segnala warning di livello error.",
      source_module: "loop_qa",
      risk_level: "medium",
      priority: "high",
      action_type: "manual_task",
      reason: "Warning critici aperti.",
      verification: "Aprire Loop QA e rivedere i warning di livello error.",
      linked_object_id: null,
    });
  }

  // Master snapshot stale vs implementations
  if (args.impl.length > 0 && args.ms.current_label && out.length < 5) {
    out.push({
      id: "snapshot:update",
      title: "Aggiornare Master Snapshot",
      description: `Sono state completate ${args.impl.length} implementazioni oggi. Aggiornare snapshot da versione ${args.ms.current_label}.`,
      source_module: "master_snapshot",
      risk_level: "medium",
      priority: "medium",
      action_type: "manual_task",
      reason: "Implementazioni completate oggi, snapshot potenzialmente da aggiornare.",
      verification: "Aprire Master Snapshot e proporre nuova versione.",
      linked_object_id: null,
    });
  }

  // Fallback
  if (out.length === 0) {
    out.push({
      id: "review:general",
      title: "Rivedere Operating Dashboard",
      description: "Nessuna emergenza rilevata. Allineare lo stato dei progetti.",
      source_module: "operating_dashboard",
      risk_level: "low",
      priority: "low",
      action_type: "manual_task",
      reason: "Routine giornaliera.",
      verification: "Aprire Operating Dashboard.",
      linked_object_id: null,
    });
  }

  return out.slice(0, 5);
}

// ---------------- Voice summary ----------------

export function buildJackVoiceSummary(brief: {
  brief_date: string;
  executive_summary: string;
  email_summary: EmailSummary;
  open_actions_summary: OpenActionsSummary;
  warnings_summary: WarningsSummary;
  automation_summary: AutomationSummary;
  next_actions: NextActionItem[];
  implemented_today: ImplementedItem[];
}): string {
  const parts: string[] = [];
  const date = new Date(brief.brief_date).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  parts.push(`Federico, ecco il punto operativo di ${date}.`);

  if (brief.implemented_today.length > 0) {
    parts.push(
      `Oggi sono stati completati ${brief.implemented_today.length} passaggi operativi rilevanti.`,
    );
  } else {
    parts.push("Oggi non risultano implementazioni rilevanti registrate.");
  }

  if (brief.email_summary.available) {
    parts.push(
      `Gmail mostra ${brief.email_summary.total_today} email oggi, di cui ${brief.email_summary.high_priority_today} ad alta priorità e ${brief.email_summary.without_action_today} senza action.`,
    );
  }

  parts.push(
    `In Action Queue ci sono ${brief.open_actions_summary.suggested + brief.open_actions_summary.pending} action aperte, ${brief.open_actions_summary.high_risk} ad alto rischio.`,
  );

  if (brief.automation_summary.telegram_pending > 0) {
    parts.push(
      `Telegram ha ${brief.automation_summary.telegram_pending} approvazioni in attesa.`,
    );
  }

  if (brief.warnings_summary.error > 0) {
    parts.push(
      `Loop QA segnala ${brief.warnings_summary.error} warning critici.`,
    );
  }

  if (brief.next_actions[0]) {
    parts.push(`La prossima azione consigliata è: ${brief.next_actions[0].title}.`);
  }

  const text = parts.join(" ");
  return text.length > 1200 ? text.slice(0, 1197) + "…" : text;
}

// ---------------- Brief generation ----------------

export type GenerateInput = {
  brain_id?: string | null;
  date?: string;
};

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function generateDailyOperatingBrief(
  input: GenerateInput = {},
): Promise<DailyBriefRow> {
  const userId = await getUserId();
  if (!userId) throw new Error("Non autenticato");

  const brainId = input.brain_id ?? null;
  const date = input.date ?? todayDateString();

  const [ms, actionsRes, tg, gmail, cal, drive, n8n, agent, timeline, loopq] =
    await Promise.all([
      collectMasterSnapshot(brainId),
      collectActions(brainId),
      collectTelegram(brainId),
      collectGmail(brainId),
      collectCalendar(brainId),
      collectDrive(brainId),
      collectN8n(brainId),
      collectAgentRuns(brainId),
      collectTimeline(brainId),
      collectLoopQAWarnings(brainId),
    ]);

  const automation: AutomationSummary = {
    telegram_approved_today: tg.approved_today,
    telegram_rejected_today: tg.rejected_today,
    telegram_pending: tg.pending,
    telegram_failed: tg.failed,
    n8n_runs_recent: n8n.runs_recent,
    n8n_errors_recent: n8n.errors_recent,
    actions_ready: actionsRes.rows.filter(
      (r) => r.status === "ready_to_execute",
    ).length,
  };

  const nextActions = composeNextActions({
    email: gmail.summary,
    warnings: loopq.summary,
    openActions: actionsRes.summary,
    telegram: automation,
    ms: { current_label: ms.current_label ?? null, recent_reasons: ms.recent_reasons ?? [] },
    impl: timeline.implemented,
  });

  // Project status heuristic
  const reasons: string[] = [];
  let health: ProjectStatusSummary["health"] = "healthy";
  if (loopq.summary.error > 0) {
    health = "blocked";
    reasons.push(`${loopq.summary.error} warning critici in Loop QA`);
  } else if (loopq.summary.warning > 2 || actionsRes.summary.blocked_or_old > 3) {
    health = "warning";
    if (loopq.summary.warning > 0)
      reasons.push(`${loopq.summary.warning} warning Loop QA`);
    if (actionsRes.summary.blocked_or_old > 0)
      reasons.push(`${actionsRes.summary.blocked_or_old} action vecchie`);
  } else if (!gmail.summary.available && !tg.available && !ms.available) {
    health = "incomplete";
    reasons.push("Connettori principali non disponibili");
  }

  // Activity summary
  const implLabels = timeline.implemented.slice(0, 4).map((i) => i.action).join(", ");
  const today_activity_summary =
    timeline.implemented.length > 0
      ? `Oggi sono stati completati ${timeline.implemented.length} eventi operativi: ${implLabels}.`
      : "Oggi non sono stati registrati eventi operativi rilevanti.";

  // Executive summary
  const exec_parts: string[] = [];
  exec_parts.push(
    `Stato generale: ${health.toUpperCase()}.${reasons.length ? " " + reasons.join("; ") + "." : ""}`,
  );
  if (gmail.summary.available) {
    exec_parts.push(
      `Email oggi: ${gmail.summary.total_today} totali, ${gmail.summary.high_priority_today} high, ${gmail.summary.without_action_today} senza action.`,
    );
  }
  exec_parts.push(
    `Action aperte: ${actionsRes.summary.suggested + actionsRes.summary.pending} (di cui ${actionsRes.summary.high_risk} high risk).`,
  );
  if (automation.telegram_pending > 0) {
    exec_parts.push(
      `Telegram pending: ${automation.telegram_pending}.`,
    );
  }
  if (nextActions[0]) {
    exec_parts.push(`Prossima azione: ${nextActions[0].title}.`);
  }
  const executive_summary = exec_parts.join(" ");

  const project_status_summary = `Progetto ${health}. ${reasons.join("; ") || "Nessun blocco rilevato."}`;

  const warnings_summary = loopq.summary;
  const email_summary = gmail.summary;
  const calendar_summary = cal.summary;
  const drive_summary = drive.summary;
  const agent_summary = agent.summary;

  const source_counts: SourceCounts = {
    master_snapshot: { available: ms.available, count: ms.count },
    action_queue: { available: actionsRes.available, count: actionsRes.summary.total },
    telegram: { available: tg.available, count: tg.total },
    gmail: { available: gmail.summary.available, count: gmail.count },
    calendar: { available: cal.summary.available, count: cal.summary.events_next_7d },
    drive: { available: drive.summary.available, count: drive.summary.files_today },
    loop_qa: { available: loopq.available, count: loopq.summary.total },
    agent_runs: { available: agent.available, count: agent.summary.runs_today },
    n8n: { available: n8n.available, count: n8n.runs_recent },
    code_handoffs: { available: false, count: 0, note: "non aggregato in questa versione" },
    build_engines: { available: false, count: 0, note: "non aggregato in questa versione" },
    timeline: { available: timeline.available, count: timeline.todayCount },
  };

  const title = `Daily Operating Brief — ${date}`;

  const voice = buildJackVoiceSummary({
    brief_date: date,
    executive_summary,
    email_summary,
    open_actions_summary: actionsRes.summary,
    warnings_summary,
    automation_summary: automation,
    next_actions: nextActions,
    implemented_today: timeline.implemented,
  });

  // Upsert: replace existing brief for same (user, brain, date)
  const existing = await getBriefForDate(brainId, date);
  const baseRow = {
    user_id: userId,
    brain_id: brainId,
    brief_date: date,
    status: existing ? "regenerated" : "generated",
    generated_at: new Date().toISOString(),
    title,
    executive_summary,
    voice_summary_text: voice,
    project_status_summary,
    today_activity_summary,
    implemented_today: timeline.implemented as unknown as Record<string, unknown>[],
    open_actions_summary: actionsRes.summary as unknown as Record<string, unknown>,
    warnings_summary: warnings_summary as unknown as Record<string, unknown>,
    email_summary: email_summary as unknown as Record<string, unknown>,
    calendar_summary: calendar_summary as unknown as Record<string, unknown>,
    drive_summary: drive_summary as unknown as Record<string, unknown>,
    automation_summary: automation as unknown as Record<string, unknown>,
    agent_summary: agent_summary as unknown as Record<string, unknown>,
    next_actions: nextActions as unknown as Record<string, unknown>[],
    source_counts: source_counts as unknown as Record<string, unknown>,
    metadata: {
      generator: "jack_briefing_engine",
      version: "3.8.1",
      health,
    },
  };

  if (existing) {
    const { data, error } = await supabase
      .from("daily_operating_briefs" as never)
      .update(baseRow as never)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    await logDailyBriefEvent("daily_brief_regenerated", `Brief rigenerato (${date})`, {
      brief_id: (data as { id: string }).id,
      brain_id: brainId,
    });
    return mapRow(data as RawRow);
  } else {
    const { data, error } = await supabase
      .from("daily_operating_briefs" as never)
      .insert(baseRow as never)
      .select()
      .single();
    if (error) throw error;
    await logDailyBriefEvent("daily_brief_generated", `Brief generato (${date})`, {
      brief_id: (data as { id: string }).id,
      brain_id: brainId,
    });
    return mapRow(data as RawRow);
  }
}

// ---------------- Fetch helpers ----------------

type RawRow = Record<string, unknown>;

function mapRow(row: RawRow): DailyBriefRow {
  const get = <T>(k: string, dflt: T): T => {
    const v = row[k];
    return (v === undefined || v === null ? dflt : v) as T;
  };
  return {
    id: get("id", ""),
    user_id: get("user_id", ""),
    brain_id: (row.brain_id as string | null) ?? null,
    brief_date: get("brief_date", ""),
    status: get("status", "generated"),
    generated_at: get("generated_at", ""),
    title: get("title", ""),
    executive_summary: get("executive_summary", ""),
    voice_summary_text: (row.voice_summary_text as string | null) ?? null,
    project_status_summary: (row.project_status_summary as string | null) ?? null,
    today_activity_summary: (row.today_activity_summary as string | null) ?? null,
    implemented_today: get("implemented_today", [] as ImplementedItem[]),
    open_actions_summary: get("open_actions_summary", {} as OpenActionsSummary),
    warnings_summary: get("warnings_summary", {} as WarningsSummary),
    email_summary: get("email_summary", {} as EmailSummary),
    calendar_summary: get("calendar_summary", {} as CalendarSummary),
    drive_summary: get("drive_summary", {} as DriveSummary),
    automation_summary: get("automation_summary", {} as AutomationSummary),
    agent_summary: get("agent_summary", {} as AgentSummary),
    next_actions: get("next_actions", [] as NextActionItem[]),
    source_counts: get("source_counts", {} as SourceCounts),
    created_action_ids: get("created_action_ids", [] as string[]),
    metadata: get("metadata", {} as Record<string, unknown>),
    created_at: get("created_at", ""),
    updated_at: get("updated_at", ""),
  };
}

export async function getBriefForDate(
  brainId: string | null,
  date: string,
): Promise<DailyBriefRow | null> {
  let q = supabase
    .from("daily_operating_briefs" as never)
    .select("*")
    .eq("brief_date", date)
    .order("generated_at", { ascending: false })
    .limit(1);
  q = brainId ? q.eq("brain_id", brainId) : q.is("brain_id", null);
  const { data } = await q;
  const rows = (data ?? []) as RawRow[];
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getTodayOperatingBrief(
  brainId?: string | null,
): Promise<DailyBriefRow | null> {
  return getBriefForDate(brainId ?? null, todayDateString());
}

export async function listDailyOperatingBriefs(
  brainId?: string | null,
  limit = 20,
): Promise<DailyBriefRow[]> {
  let q = supabase
    .from("daily_operating_briefs" as never)
    .select("*")
    .order("brief_date", { ascending: false })
    .limit(limit);
  if (brainId) q = q.eq("brain_id", brainId);
  const { data } = await q;
  return ((data ?? []) as RawRow[]).map(mapRow);
}

// ---------------- Action creation from brief items ----------------

export async function createActionFromBriefItem(
  briefId: string,
  itemId: string,
): Promise<AutomationAction> {
  const { data, error } = await supabase
    .from("daily_operating_briefs" as never)
    .select("*")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Brief non trovato");
  const brief = mapRow(data as RawRow);

  const item = brief.next_actions.find((a) => a.id === itemId);
  if (!item) throw new Error("Item non trovato nel brief");

  const action = await createAction({
    source: "user_manual",
    action_type: "manual_task",
    title: item.title,
    description: `${item.description}\n\nReason: ${item.reason}\nVerification: ${item.verification}`,
    priority: item.priority,
    risk_level: item.risk_level,
    brain_id: brief.brain_id ?? undefined,
    metadata: {
      source_label: "daily_operating_brief",
      generated_from: "jack_briefing_engine",
      daily_operating_brief_id: brief.id,
      source_module: item.source_module,
      linked_object_id: item.linked_object_id,
      brief_item_id: item.id,
      original_action_type: item.action_type,
    },
  });

  const nextIds = [...brief.created_action_ids, action.id];
  await supabase
    .from("daily_operating_briefs" as never)
    .update({ created_action_ids: nextIds } as never)
    .eq("id", brief.id);

  await logDailyBriefEvent(
    "daily_brief_action_created",
    `Action creata da Daily Brief: ${item.title}`,
    { brief_id: brief.id, action_id: action.id, item_id: item.id },
  );

  return action;
}

export async function createAllSuggestedActionsFromBrief(
  briefId: string,
): Promise<{ created: number; skipped: number; ids: string[] }> {
  const { data, error } = await supabase
    .from("daily_operating_briefs" as never)
    .select("*")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Brief non trovato");
  const brief = mapRow(data as RawRow);

  const ids: string[] = [];
  let skipped = 0;
  for (const item of brief.next_actions) {
    // skip if already created (same brief_item_id)
    const { data: dupRows } = await supabase
      .from("automation_actions")
      .select("id,metadata")
      .contains("metadata", {
        daily_operating_brief_id: brief.id,
        brief_item_id: item.id,
      } as never);
    if ((dupRows ?? []).length > 0) {
      skipped++;
      continue;
    }
    try {
      const action = await createAction({
        source: "user_manual",
        action_type: "manual_task",
        title: item.title,
        description: `${item.description}\n\nReason: ${item.reason}\nVerification: ${item.verification}`,
        priority: item.priority,
        risk_level: item.risk_level,
        brain_id: brief.brain_id ?? undefined,
        metadata: {
          source_label: "daily_operating_brief",
          generated_from: "jack_briefing_engine",
          daily_operating_brief_id: brief.id,
          source_module: item.source_module,
          linked_object_id: item.linked_object_id,
          brief_item_id: item.id,
          original_action_type: item.action_type,
        },
      });
      ids.push(action.id);
    } catch {
      skipped++;
    }
  }

  if (ids.length > 0) {
    const nextIds = [...brief.created_action_ids, ...ids];
    await supabase
      .from("daily_operating_briefs" as never)
      .update({ created_action_ids: nextIds } as never)
      .eq("id", brief.id);
  }

  await logDailyBriefEvent(
    "daily_brief_bulk_actions_created",
    `Action bulk create da Daily Brief: ${ids.length} (skipped ${skipped})`,
    { brief_id: brief.id, created: ids.length, skipped },
  );

  return { created: ids.length, skipped, ids };
}

// ---------------- Daily brief warnings (used by Loop QA) ----------------

export type DailyBriefWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
  category: "Daily Brief / Jack";
};

export async function getDailyBriefWarnings(
  brainId?: string | null,
): Promise<DailyBriefWarning[]> {
  const warnings: DailyBriefWarning[] = [];
  try {
    const today = todayDateString();
    const todayBrief = await getBriefForDate(brainId ?? null, today);

    // Today timeline activity
    const startToday = startOfTodayIso();
    let q = supabase
      .from("clipboard_execution_logs")
      .select("id,created_at,action", { count: "exact", head: false })
      .gte("created_at", startToday)
      .limit(50);
    if (brainId) q = q.eq("metadata->>brain_id", brainId);
    const { data: logs, count: todayCount } = await q;
    const logsArr = (logs ?? []) as Array<{ action: string; created_at: string }>;

    // 1) missing today
    if ((todayCount ?? 0) >= 5 && !todayBrief) {
      warnings.push({
        id: "daily-brief-missing-today",
        level: "warning",
        title: "Daily Brief mancante",
        description:
          "Oggi sono stati registrati eventi operativi ma nessun Daily Brief è stato generato.",
        cta: { label: "Apri Daily Brief", to: "/daily-brief" },
        category: "Daily Brief / Jack",
      });
    }

    // 2) stale
    if (todayBrief) {
      const lastLog = logsArr[0];
      if (lastLog && new Date(lastLog.created_at) > new Date(todayBrief.generated_at)) {
        warnings.push({
          id: "daily-brief-stale",
          level: "info",
          title: "Daily Brief non aggiornato",
          description:
            "Sono stati registrati eventi dopo l'ultima generazione del Daily Brief.",
          cta: { label: "Rigenera Daily Brief", to: "/daily-brief" },
          category: "Daily Brief / Jack",
        });
      }
    }

    // 3) actions not created
    if (
      todayBrief &&
      todayBrief.next_actions.length > 0 &&
      todayBrief.created_action_ids.length === 0
    ) {
      warnings.push({
        id: "daily-brief-actions-not-created",
        level: "info",
        title: "Action suggerite non create",
        description:
          "Il Daily Brief contiene prossime azioni ma nessuna è ancora stata creata in Action Queue.",
        cta: { label: "Apri Daily Brief", to: "/daily-brief" },
        category: "Daily Brief / Jack",
      });
    }

    // 4) master snapshot not updated after impl in brief
    if (todayBrief && todayBrief.implemented_today.length > 0) {
      let msq = supabase
        .from("master_snapshot_versions")
        .select("id,updated_at,created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (brainId) msq = msq.eq("brain_id", brainId);
      const { data: ms } = await msq;
      const last = (ms ?? [])[0] as { updated_at: string } | undefined;
      if (
        last &&
        new Date(last.updated_at) < new Date(todayBrief.generated_at)
      ) {
        warnings.push({
          id: "daily-brief-master-snapshot-not-updated",
          level: "info",
          title: "Master Snapshot non aggiornato",
          description:
            "Il Daily Brief riporta implementazioni completate ma il Master Snapshot non è stato aggiornato dopo.",
          cta: { label: "Apri Master Snapshot", to: "/master-snapshot" },
          category: "Daily Brief / Jack",
        });
      }
    }
  } catch {
    // non-blocking
  }
  return warnings;
}

// Suppress unused warnings for helpers that are referenced via type-only paths
void safeStr;
