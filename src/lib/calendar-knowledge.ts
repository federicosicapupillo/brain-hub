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
// Create an automation_action from a calendar event (legacy v3.0).
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

// ============================================================
// Brain Hub v3.1 — Calendar Intelligence & Follow-up Actions
// ============================================================
// Read-only Calendar. Genera solo azioni interne suggested.
// ============================================================

export type CalendarEventClass =
  | "meeting"
  | "call_cliente"
  | "scadenza"
  | "appuntamento_tecnico"
  | "review_interna"
  | "contenuto_social"
  | "altro";

export type CalendarSuggestionType = "preparation" | "follow_up";

export type CalendarSuggestionPriority = "low" | "medium" | "high";

export type CalendarActionSuggestionItem = {
  id: string; // composite: `${event.id}:${suggestionType}`
  event: CalendarEvent;
  eventClass: CalendarEventClass;
  suggestionType: CalendarSuggestionType;
  actionType:
    | "meeting_preparation"
    | "meeting_follow_up"
    | "calendar_deadline_check"
    | "calendar_content_check";
  title: string;
  description: string;
  priority: CalendarSuggestionPriority;
  alreadyExists: boolean;
  ignored: boolean;
};

export function classifyCalendarEvent(event: CalendarEvent): CalendarEventClass {
  const title = (event.title ?? "").toLowerCase();
  const calName = (event.calendar_name ?? "").toLowerCase();
  const desc = (event.description ?? "").toLowerCase();
  const haystack = `${title} ${calName} ${desc}`;
  const hasHangout = !!event.hangout_link;
  const attendees = event.attendees_count ?? 0;

  if (/scadenz|deadline|due\b|consegn/.test(haystack)) return "scadenza";
  if (/social|post|reel|content|content[oi]|instagram|tiktok|linkedin/.test(haystack))
    return "contenuto_social";
  if (/review interna|retro|standup|stand-up|sync interno|team sync/.test(haystack))
    return "review_interna";
  if (/tecnic|installazione|sopralluogo|on[- ]?site|cantiere|intervento/.test(haystack))
    return "appuntamento_tecnico";
  if (/call|chiamat|cliente|client\b|customer|prospect|demo/.test(haystack))
    return "call_cliente";
  if (/meeting|riunion|incontro|kickoff|kick-off/.test(haystack) || hasHangout || attendees > 1)
    return "meeting";
  return "altro";
}

function priorityForEvent(
  event: CalendarEvent,
  cls: CalendarEventClass,
): CalendarSuggestionPriority {
  if (cls === "scadenza") return "high";
  if (cls === "call_cliente" || cls === "appuntamento_tecnico") return "high";
  const attendees = event.attendees_count ?? 0;
  if (attendees >= 3) return "medium";
  return "medium";
}

export function getEventPreparationSuggestion(
  event: CalendarEvent,
): CalendarActionSuggestionItem | null {
  const cls = classifyCalendarEvent(event);
  if (cls === "altro") return null;
  const evTitle = event.title || "Evento";
  const when = event.start_at ? new Date(event.start_at).toLocaleString() : "data sconosciuta";
  const ignored = isSuggestionIgnored(event, "preparation");
  let title = `Preparare: ${evTitle}`;
  let description = `Recupera documenti collegati, prepara scaletta, verifica materiali e controlla note precedenti.`;
  let actionType: CalendarActionSuggestionItem["actionType"] = "meeting_preparation";
  if (cls === "scadenza") {
    title = `Verifica scadenza: ${evTitle}`;
    description = `Controlla cosa è dovuto entro la scadenza e che tutto sia pronto.`;
    actionType = "calendar_deadline_check";
  } else if (cls === "contenuto_social") {
    title = `Verifica contenuto: ${evTitle}`;
    description = `Controlla che il contenuto sia pronto, approvato e schedulato correttamente.`;
    actionType = "calendar_content_check";
  }
  return {
    id: `${event.id}:preparation`,
    event,
    eventClass: cls,
    suggestionType: "preparation",
    actionType,
    title,
    description: `${description} (${when})`,
    priority: priorityForEvent(event, cls),
    alreadyExists: false,
    ignored,
  };
}

export function getEventFollowUpSuggestion(
  event: CalendarEvent,
): CalendarActionSuggestionItem | null {
  const cls = classifyCalendarEvent(event);
  if (cls === "altro" || cls === "scadenza") return null;
  const evTitle = event.title || "Evento";
  const when = event.start_at ? new Date(event.start_at).toLocaleString() : "data sconosciuta";
  const ignored = isSuggestionIgnored(event, "follow_up");
  return {
    id: `${event.id}:follow_up`,
    event,
    eventClass: cls,
    suggestionType: "follow_up",
    actionType: "meeting_follow_up",
    title: `Follow-up: ${evTitle}`,
    description: `Aggiorna note, assegna prossima azione, invia riepilogo, collega risultato a Result Review. (${when})`,
    priority: priorityForEvent(event, cls),
    alreadyExists: false,
    ignored,
  };
}

function isSuggestionIgnored(
  event: CalendarEvent,
  suggestionType: CalendarSuggestionType,
): boolean {
  const meta = event.metadata as Record<string, unknown> | null;
  const arr = (meta?.ignored_suggestions ?? []) as unknown;
  if (!Array.isArray(arr)) return false;
  return arr.includes(suggestionType);
}

export async function getCalendarActionSuggestions(
  brainId?: string | null,
): Promise<CalendarActionSuggestionItem[]> {
  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);
  const past3 = new Date(now);
  past3.setDate(past3.getDate() - 3);

  // upcoming next 7d
  let qUp = supabase
    .from("calendar_event_map" as never)
    .select("*")
    .gte("start_at", now.toISOString())
    .lte("start_at", in7.toISOString())
    .order("start_at", { ascending: true })
    .limit(100);
  if (brainId) qUp = qUp.eq("brain_id", brainId);
  const { data: upData, error: upErr } = await qUp;
  if (upErr) throw upErr;

  // past 3d
  let qPast = supabase
    .from("calendar_event_map" as never)
    .select("*")
    .gte("start_at", past3.toISOString())
    .lt("start_at", now.toISOString())
    .order("start_at", { ascending: false })
    .limit(100);
  if (brainId) qPast = qPast.eq("brain_id", brainId);
  const { data: pastData, error: pastErr } = await qPast;
  if (pastErr) throw pastErr;

  const upcoming = (upData ?? []) as unknown as CalendarEvent[];
  const past = (pastData ?? []) as unknown as CalendarEvent[];

  // existing v3.1 calendar actions (avoid duplicates)
  const eventIds = [...upcoming, ...past].map((e) => e.id);
  let existing: Array<{ metadata: Record<string, unknown> | null }> = [];
  if (eventIds.length > 0) {
    const { data: ex } = await supabase
      .from("automation_actions" as never)
      .select("metadata")
      .eq("source", "google_calendar");
    existing = (ex ?? []) as unknown as typeof existing;
  }
  const existsKey = new Set<string>();
  for (const a of existing) {
    const m = a.metadata ?? {};
    const evId = (m as Record<string, unknown>).calendar_event_map_id;
    const st = (m as Record<string, unknown>).suggestion_type;
    if (typeof evId === "string" && typeof st === "string") {
      existsKey.add(`${evId}:${st}`);
    }
  }

  const out: CalendarActionSuggestionItem[] = [];
  for (const ev of upcoming) {
    const s = getEventPreparationSuggestion(ev);
    if (s) {
      s.alreadyExists = existsKey.has(s.id);
      out.push(s);
    }
  }
  for (const ev of past) {
    const s = getEventFollowUpSuggestion(ev);
    if (s) {
      s.alreadyExists = existsKey.has(s.id);
      out.push(s);
    }
  }
  return out;
}

export async function createSuggestedActionsFromCalendarEvent(
  eventId: string,
  options: { suggestionType: CalendarSuggestionType },
): Promise<{ action_id: string; duplicate: boolean }> {
  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) throw ue ?? new Error("Non autenticato");

  const { data: evData, error: evErr } = await supabase
    .from("calendar_event_map" as never)
    .select("*")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const event = evData as unknown as CalendarEvent;

  // anti-duplicate
  const { data: existing } = await supabase
    .from("automation_actions" as never)
    .select("id, metadata")
    .eq("source", "google_calendar")
    .eq("user_id", u.user.id);
  const dup = ((existing ?? []) as unknown as Array<{
    id: string;
    metadata: Record<string, unknown> | null;
  }>).find(
    (a) =>
      (a.metadata?.calendar_event_map_id as string | undefined) === eventId &&
      (a.metadata?.suggestion_type as string | undefined) === options.suggestionType,
  );
  if (dup) {
    return { action_id: dup.id, duplicate: true };
  }

  const suggestion =
    options.suggestionType === "preparation"
      ? getEventPreparationSuggestion(event)
      : getEventFollowUpSuggestion(event);
  if (!suggestion) throw new Error("Nessun suggerimento applicabile per questo evento");

  const payload = {
    user_id: u.user.id,
    source: "google_calendar",
    action_type: suggestion.actionType,
    title: suggestion.title,
    description: suggestion.description,
    priority: suggestion.priority,
    risk_level: "low",
    status: "suggested",
    requires_confirmation: true,
    brain_id: event.brain_id ?? null,
    project_id: null,
    metadata: {
      source: "google_calendar",
      calendar_event_map_id: event.id,
      google_event_id: event.google_event_id,
      google_calendar_id: event.google_calendar_id,
      suggestion_type: options.suggestionType,
      event_class: suggestion.eventClass,
      calendar_event_title: event.title,
      calendar_event_start_at: event.start_at,
    },
  };
  const { data, error } = await supabase
    .from("automation_actions" as never)
    .insert(payload as never)
    .select("id")
    .single();
  if (error) throw error;
  const created = data as { id: string };

  const logEvent: LogEventType =
    options.suggestionType === "preparation"
      ? "calendar_preparation_suggested"
      : "calendar_followup_suggested";
  await logCalendarEvent(logEvent, suggestion.title, {
    action_id: created.id,
    calendar_event_map_id: event.id,
    suggestion_type: options.suggestionType,
  });
  await logCalendarEvent("calendar_action_created", suggestion.title, {
    action_id: created.id,
    calendar_event_map_id: event.id,
    suggestion_type: options.suggestionType,
  });
  return { action_id: created.id, duplicate: false };
}

export async function ignoreCalendarSuggestion(
  eventId: string,
  suggestionType: CalendarSuggestionType,
): Promise<void> {
  const { data: evData, error: evErr } = await supabase
    .from("calendar_event_map" as never)
    .select("metadata")
    .eq("id", eventId)
    .single();
  if (evErr) throw evErr;
  const meta = ((evData as { metadata: Record<string, unknown> | null } | null)?.metadata ??
    {}) as Record<string, unknown>;
  const arr = Array.isArray(meta.ignored_suggestions)
    ? (meta.ignored_suggestions as string[])
    : [];
  if (!arr.includes(suggestionType)) arr.push(suggestionType);
  const newMeta = { ...meta, ignored_suggestions: arr };
  const { error } = await supabase
    .from("calendar_event_map" as never)
    .update({ metadata: newMeta } as never)
    .eq("id", eventId);
  if (error) throw error;
  await logCalendarEvent(
    "calendar_suggestion_ignored",
    `Suggerimento ${suggestionType} ignorato`,
    { calendar_event_map_id: eventId, suggestion_type: suggestionType },
  );
}

export type CalendarIntelligenceSummary = {
  upcomingMissingPreparation: number;
  pastMissingFollowUp: number;
  unlinkedEvents: number;
};

export async function getCalendarIntelligenceSummary(
  brainId?: string | null,
): Promise<CalendarIntelligenceSummary> {
  try {
    const suggestions = await getCalendarActionSuggestions(brainId ?? null);
    const upcomingMissingPreparation = suggestions.filter(
      (s) => s.suggestionType === "preparation" && !s.alreadyExists && !s.ignored,
    ).length;
    const pastMissingFollowUp = suggestions.filter(
      (s) => s.suggestionType === "follow_up" && !s.alreadyExists && !s.ignored,
    ).length;
    const events = await listUpcomingCalendarEvents({ brainId, limit: 100 });
    const unlinkedEvents = events.filter((e) => !e.brain_id).length;
    return { upcomingMissingPreparation, pastMissingFollowUp, unlinkedEvents };
  } catch {
    return { upcomingMissingPreparation: 0, pastMissingFollowUp: 0, unlinkedEvents: 0 };
  }
}

