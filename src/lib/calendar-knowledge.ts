// ============================================================
// Brain Hub v3.0 — Calendar Knowledge (client-side helpers)
// ============================================================
// READ-ONLY. Letture dirette da Supabase tramite RLS user-scoped.
// ============================================================

import { supabase } from "@/integrations/supabase/client";
import type { LogEventType } from "@/lib/automation-run";

export type CalendarConnection = {
  id: string;
  user_id: string;
  brain_id: string | null;
  label: string;
  provider: string;
  connection_status: string;
  scopes: string[];
  last_sync_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  user_id: string;
  brain_id: string | null;
  connection_id: string | null;
  google_calendar_id: string | null;
  google_event_id: string | null;
  calendar_name: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string | null;
  event_type: string | null;
  hangout_link: string | null;
  html_link: string | null;
  attendees_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function listCalendarConnections(
  brainId?: string | null,
): Promise<CalendarConnection[]> {
  let q = supabase
    .from("calendar_connection_settings" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (brainId) q = q.eq("brain_id", brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CalendarConnection[];
}

export async function createCalendarConnection(input: {
  label: string;
  brainId?: string | null;
}): Promise<CalendarConnection> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const payload = {
    user_id: u.user.id,
    brain_id: input.brainId ?? null,
    label: input.label,
    provider: "google_calendar",
    connection_status: "not_configured",
    scopes: [] as string[],
    metadata: {},
  };
  const { data, error } = await supabase
    .from("calendar_connection_settings" as never)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CalendarConnection;
}

export async function listUpcomingCalendarEvents(opts: {
  brainId?: string | null;
  fromIso?: string;
  toIso?: string;
  limit?: number;
}): Promise<CalendarEvent[]> {
  const from = opts.fromIso ?? new Date().toISOString();
  let q = supabase
    .from("calendar_event_map" as never)
    .select("*")
    .gte("start_at", from)
    .order("start_at", { ascending: true })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.toIso) q = q.lte("start_at", opts.toIso);
  if (opts.brainId) q = q.eq("brain_id", opts.brainId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
}

export type CalendarKnowledgeSummary = {
  connections: number;
  connectedConnections: number;
  totalEvents: number;
  eventsToday: number;
  eventsThisWeek: number;
  nextEvent: CalendarEvent | null;
  hasNeverSynced: boolean;
  lastSyncFailed: boolean;
};

export async function getCalendarKnowledgeSummary(
  brainId?: string | null,
): Promise<CalendarKnowledgeSummary> {
  const connections = await listCalendarConnections(brainId ?? null);
  const events = await listUpcomingCalendarEvents({ brainId, limit: 100 });
  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now);
  endWeek.setDate(endWeek.getDate() + 7);
  const eventsToday = events.filter(
    (e) => e.start_at && new Date(e.start_at) <= endToday,
  ).length;
  const eventsThisWeek = events.filter(
    (e) => e.start_at && new Date(e.start_at) <= endWeek,
  ).length;
  const connected = connections.filter((c) => c.connection_status === "connected");
  const hasNeverSynced =
    connections.length > 0 && connections.every((c) => !c.last_sync_at);
  const lastSyncFailed = connections.some(
    (c) =>
      ((c.metadata as Record<string, unknown> | null)?.last_sync_status ?? "") ===
      "failed",
  );
  return {
    connections: connections.length,
    connectedConnections: connected.length,
    totalEvents: events.length,
    eventsToday,
    eventsThisWeek,
    nextEvent: events[0] ?? null,
    hasNeverSynced,
    lastSyncFailed,
  };
}

export type CalendarLoopWarning = {
  id: string;
  level: "warning" | "info" | "error";
  title: string;
  description: string;
  cta?: { label: string; to: string };
};

export async function getCalendarKnowledgeWarnings(
  brainId?: string | null,
): Promise<CalendarLoopWarning[]> {
  const out: CalendarLoopWarning[] = [];
  try {
    const s = await getCalendarKnowledgeSummary(brainId);
    const cta = { label: "Apri Calendar", to: "/calendar-knowledge" };
    if (s.connections === 0) {
      out.push({
        id: "calendar-not-configured",
        level: "info",
        title: "Google Calendar non configurato",
        description: "Nessuna connessione Calendar: riunioni e scadenze non sono mappate.",
        cta,
      });
    } else if (s.hasNeverSynced) {
      out.push({
        id: "calendar-never-synced",
        level: "warning",
        title: "Calendar mai sincronizzato",
        description: "Una connessione Calendar è configurata ma non è mai stata sincronizzata.",
        cta,
      });
    }
    if (s.lastSyncFailed) {
      out.push({
        id: "calendar-last-sync-failed",
        level: "warning",
        title: "Ultimo sync Calendar fallito",
        description: "L'ultima sincronizzazione del calendario non è andata a buon fine.",
        cta,
      });
    }
    if (s.totalEvents >= 20) {
      out.push({
        id: "calendar-many-unlinked-events",
        level: "info",
        title: `${s.totalEvents} eventi futuri non collegati`,
        description: "Considera di collegare riunioni e scadenze a progetti o action.",
        cta,
      });
    }
  } catch {
    // non-blocking
  }
  return out;
}

export async function logCalendarEvent(
  action: LogEventType,
  notes: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
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

// ============================================================
// Create an automation_action from a calendar event.
// We use action_type 'manual_task' so we don't add to the strict
// ActionType union. Source is 'user_manual'. Never executes anything.
// ============================================================
export type CalendarActionSuggestion =
  | "prepare_meeting"
  | "follow_up_meeting"
  | "check_deadline"
  | "create_reminder";

export async function createActionFromCalendarEvent(input: {
  event: CalendarEvent;
  suggestion: CalendarActionSuggestion;
}): Promise<{ action_id: string }> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");
  const suggestionTitles: Record<CalendarActionSuggestion, string> = {
    prepare_meeting: "Preparare riunione",
    follow_up_meeting: "Follow-up dopo riunione",
    check_deadline: "Controllare scadenza",
    create_reminder: "Creare reminder operativo",
  };
  const sTitle = suggestionTitles[input.suggestion];
  const evTitle = input.event.title || "Evento";
  const when = input.event.start_at
    ? new Date(input.event.start_at).toLocaleString()
    : "data sconosciuta";
  const payload = {
    user_id: u.user.id,
    source: "user_manual",
    action_type: "manual_task",
    title: `${sTitle}: ${evTitle}`,
    description: `Suggerita da Calendar (${when}). Calendario: ${
      input.event.calendar_name ?? "—"
    }.`,
    priority: "medium",
    risk_level: "low",
    status: "suggested",
    requires_confirmation: false,
    brain_id: input.event.brain_id ?? null,
    project_id: null,
    metadata: {
      from_calendar_event_id: input.event.id,
      google_event_id: input.event.google_event_id,
      google_calendar_id: input.event.google_calendar_id,
      suggestion: input.suggestion,
    },
  };
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  const created = data as { id: string };
  await logCalendarEvent(
    "google_calendar_action_created",
    `Action creata da evento Calendar: ${sTitle}`,
    {
      action_id: created.id,
      event_id: input.event.id,
      suggestion: input.suggestion,
    },
  );
  return { action_id: created.id };
}

export async function linkCalendarEventToBrain(input: {
  eventId: string;
  brainId: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("calendar_event_map" as never)
    .update({ brain_id: input.brainId } as never)
    .eq("id", input.eventId);
  if (error) throw error;
}
