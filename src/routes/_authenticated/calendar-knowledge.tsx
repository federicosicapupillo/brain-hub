import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  Plug,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createCalendarConnection,
  getCalendarKnowledgeSummary,
  listCalendarConnections,
  listUpcomingCalendarEvents,
  createActionFromCalendarEvent,
  logCalendarEvent,
  getCalendarActionSuggestions,
  createSuggestedActionsFromCalendarEvent,
  ignoreCalendarSuggestion,
  type CalendarConnection,
  type CalendarEvent,
  type CalendarActionSuggestion,
  type CalendarActionSuggestionItem,
} from "@/lib/calendar-knowledge";
import {
  getGoogleCalendarOauthStatus,
  startGoogleCalendarOAuth,
  disconnectGoogleCalendar,
} from "@/lib/calendar-oauth.functions";

const searchSchema = z.object({
  brain: z.string().optional(),
  oauth: z.enum(["success", "error"]).optional(),
  reason: z.string().optional(),
  events: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/calendar-knowledge")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Google Calendar — Brain Hub" },
      {
        name: "description",
        content:
          "Collega Google Calendar in modalità read-only e mappa riunioni e scadenze in Brain Hub.",
      },
    ],
  }),
  component: CalendarKnowledgePage,
});

type BrainRow = { id: string; name: string };

const FILTER_RANGES = [
  { id: "today", label: "Oggi" },
  { id: "week", label: "Settimana" },
  { id: "month", label: "Mese" },
] as const;
type RangeId = (typeof FILTER_RANGES)[number]["id"];

function computeRange(r: RangeId): { fromIso: string; toIso: string } {
  const now = new Date();
  const from = now.toISOString();
  const end = new Date(now);
  if (r === "today") end.setHours(23, 59, 59, 999);
  else if (r === "week") end.setDate(end.getDate() + 7);
  else end.setDate(end.getDate() + 30);
  return { fromIso: from, toIso: end.toISOString() };
}

function CalendarKnowledgePage() {
  const search = useSearch({ from: "/_authenticated/calendar-knowledge" });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const statusFn = useServerFn(getGoogleCalendarOauthStatus);
  const startFn = useServerFn(startGoogleCalendarOAuth);
  const disconnectFn = useServerFn(disconnectGoogleCalendar);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-calendar"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase
        .from("brains")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const [brainId, setBrainId] = useState<string>(search.brain ?? "__all__");
  const effectiveBrain = brainId !== "__all__" ? brainId : null;

  const [range, setRange] = useState<RangeId>("week");
  const [calendarFilter, setCalendarFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [newConnLabel, setNewConnLabel] = useState("Google Calendar");

  useEffect(() => {
    if (search.oauth === "success") {
      toast.success(`Calendar collegato. Eventi sincronizzati: ${search.events ?? "?"}`);
      void navigate({
        to: "/calendar-knowledge",
        search: { brain: effectiveBrain ?? undefined },
        replace: true,
      });
    } else if (search.oauth === "error") {
      toast.error(`OAuth fallito: ${search.reason ?? "errore"}`);
      void navigate({
        to: "/calendar-knowledge",
        search: { brain: effectiveBrain ?? undefined },
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.oauth]);

  const { data: oauthStatus } = useQuery({
    queryKey: ["calendar-oauth-status"],
    queryFn: () => statusFn({}),
  });
  const { data: connections = [], refetch: refetchConns } = useQuery({
    queryKey: ["calendar-connections", effectiveBrain],
    queryFn: () => listCalendarConnections(effectiveBrain),
  });
  const { data: summary } = useQuery({
    queryKey: ["calendar-summary-page", effectiveBrain],
    queryFn: () => getCalendarKnowledgeSummary(effectiveBrain),
  });

  const rangeWindow = useMemo(() => computeRange(range), [range]);
  const { data: events = [] } = useQuery({
    queryKey: ["calendar-events", effectiveBrain, range],
    queryFn: () =>
      listUpcomingCalendarEvents({
        brainId: effectiveBrain,
        fromIso: rangeWindow.fromIso,
        toIso: rangeWindow.toIso,
        limit: 200,
      }),
  });

  const { data: suggestions = [], refetch: refetchSuggestions } = useQuery({
    queryKey: ["calendar-suggestions", effectiveBrain],
    queryFn: () => getCalendarActionSuggestions(effectiveBrain),
  });

  const calendarNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.calendar_name) set.add(e.calendar_name);
    return [...set];
  }, [events]);
  const eventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.event_type) set.add(e.event_type);
    return [...set];
  }, [events]);

  const filteredEvents = events.filter((e) => {
    if (calendarFilter !== "__all__" && e.calendar_name !== calendarFilter) return false;
    if (typeFilter !== "__all__" && (e.event_type ?? "") !== typeFilter) return false;
    return true;
  });

  async function handleCreateConn() {
    try {
      const c = await createCalendarConnection({
        label: newConnLabel || "Google Calendar",
        brainId: effectiveBrain,
      });
      toast.success("Connessione creata");
      await refetchConns();
      return c;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
      return null;
    }
  }

  async function handleAuthorize(conn: CalendarConnection) {
    const res = await startFn({
      data: {
        connectionId: conn.id,
        returnTo: `/calendar-knowledge?brain=${effectiveBrain ?? ""}`,
      },
    });
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    window.location.href = res.authUrl;
  }

  async function handleDisconnect(conn: CalendarConnection) {
    const res = await disconnectFn({ data: { connectionId: conn.id } });
    if (res.ok) {
      toast.success("Disconnesso");
      void qc.invalidateQueries({ queryKey: ["calendar-connections"] });
    } else toast.error(res.reason ?? "Errore");
  }

  async function handleResync(conn: CalendarConnection) {
    // No refresh tokens persisted → re-OAuth required.
    await handleAuthorize(conn);
  }

  async function handleCreateAction(
    ev: CalendarEvent,
    suggestion: CalendarActionSuggestion,
  ) {
    try {
      await createActionFromCalendarEvent({ event: ev, suggestion });
      toast.success("Action creata in Action Queue");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handleCreateSuggested(s: CalendarActionSuggestionItem) {
    try {
      const res = await createSuggestedActionsFromCalendarEvent(s.event.id, {
        suggestionType: s.suggestionType,
      });
      if (res.duplicate) {
        toast.info("Action già presente in Action Queue");
      } else {
        toast.success("Action suggerita creata in Action Queue");
      }
      await refetchSuggestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handleIgnoreSuggested(s: CalendarActionSuggestionItem) {
    try {
      await ignoreCalendarSuggestion(s.event.id, s.suggestionType);
      toast.success("Suggerimento ignorato");
      await refetchSuggestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  const configured = !!oauthStatus?.configured;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Google Calendar"
        subtitle="Collegamento read-only: leggi riunioni e scadenze, suggerisci azioni. Brain Hub non crea, non modifica e non cancella eventi."
      />

      {/* Status banner */}
      <Card className={configured ? "border-emerald-500/30" : "border-amber-500/40"}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <ShieldCheck className={configured ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600"} />
          {configured ? (
            <span>
              OAuth configurato — scope: <code>{oauthStatus?.scope}</code>
            </span>
          ) : (
            <span>
              OAuth non configurato. Imposta sul server <code>GOOGLE_CLIENT_ID</code>,{" "}
              <code>GOOGLE_CLIENT_SECRET</code> e{" "}
              <code>GOOGLE_CALENDAR_OAUTH_REDIRECT_URL</code> (oppure riusa{" "}
              <code>GOOGLE_OAUTH_REDIRECT_URL</code>).
            </span>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={brainId} onValueChange={setBrainId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Cervello" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tutti i cervelli</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as RangeId)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_RANGES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={calendarFilter} onValueChange={setCalendarFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Calendario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tutti i calendari</SelectItem>
              {calendarNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tipo evento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tutti i tipi</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-2 text-xs">
            <Badge variant="outline">Oggi: {summary?.eventsToday ?? 0}</Badge>
            <Badge variant="outline">Settimana: {summary?.eventsThisWeek ?? 0}</Badge>
            <Badge variant="outline">Totali futuri: {summary?.totalEvents ?? 0}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Connections */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plug className="h-4 w-4" /> Connessioni Google Calendar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newConnLabel}
              onChange={(e) => setNewConnLabel(e.target.value)}
              placeholder="Etichetta connessione"
              className="max-w-[260px]"
            />
            <Button size="sm" onClick={handleCreateConn} disabled={!configured}>
              Collega Google Calendar
            </Button>
            {!configured && (
              <span className="text-xs text-amber-600">
                Configura OAuth prima di creare connessioni.
              </span>
            )}
          </div>
          {connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nessuna connessione. Crea una connessione e poi autorizza Google Calendar.
            </p>
          ) : (
            <ul className="space-y-2">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2"
                >
                  <span className="font-medium">{c.label}</span>
                  <Badge
                    variant="outline"
                    className={
                      c.connection_status === "connected"
                        ? "border-emerald-500/40 text-emerald-600"
                        : "border-slate-500/40 text-slate-600"
                    }
                  >
                    {c.connection_status}
                  </Badge>
                  {c.last_sync_at && (
                    <span className="text-xs text-muted-foreground">
                      ultimo sync: {new Date(c.last_sync_at).toLocaleString()}
                    </span>
                  )}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="default" onClick={() => handleAuthorize(c)} disabled={!configured}>
                      <PlugZap className="mr-1 h-3 w-3" /> Autorizza Google Calendar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleResync(c)} disabled={!configured}>
                      <RefreshCw className="mr-1 h-3 w-3" /> Sincronizza eventi
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDisconnect(c)}>
                      Disconnetti
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Brain Hub non crea, modifica o cancella eventi. Non invia inviti. I token di
            accesso non vengono salvati: per sincronizzare di nuovo, riautorizza.
          </p>
        </CardContent>
      </Card>

      {/* v3.1 — Suggested actions from calendar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4" /> Azioni suggerite dal calendario (
            {suggestions.filter((s) => !s.alreadyExists && !s.ignored).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.filter((s) => !s.alreadyExists && !s.ignored).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nessuna azione suggerita dal calendario in questo momento.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {suggestions
                .filter((s) => !s.alreadyExists && !s.ignored)
                .map((s) => (
                  <li key={s.id} className="space-y-1 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.event.title || "Evento"}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {s.event.start_at
                          ? new Date(s.event.start_at).toLocaleString()
                          : "—"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {s.suggestionType === "preparation" ? "Preparazione" : "Follow-up"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {s.eventClass}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          s.priority === "high"
                            ? "border-red-500/40 text-red-600 text-[10px]"
                            : s.priority === "medium"
                              ? "border-amber-500/40 text-amber-600 text-[10px]"
                              : "border-emerald-500/40 text-emerald-600 text-[10px]"
                        }
                      >
                        {s.priority}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">{s.description}</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleCreateSuggested(s)}
                      >
                        + Crea action
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleIgnoreSuggested(s)}
                      >
                        Ignora
                      </Button>
                      {s.event.html_link && (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                        >
                          <a href={s.event.html_link} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3 w-3" /> Apri evento
                          </a>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Events list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4" /> Eventi futuri ({filteredEvents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun evento per i filtri attuali.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {filteredEvents.map((e) => (
                <li key={e.id} className="space-y-1 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {e.start_at ? new Date(e.start_at).toLocaleString() : "—"}
                    </Badge>
                    {e.calendar_name && (
                      <Badge variant="outline" className="text-[10px]">
                        {e.calendar_name}
                      </Badge>
                    )}
                    {e.event_type && (
                      <Badge variant="outline" className="text-[10px]">
                        {e.event_type}
                      </Badge>
                    )}
                    {e.attendees_count !== null && e.attendees_count > 0 && (
                      <span className="text-muted-foreground">
                        {e.attendees_count} partecipanti
                      </span>
                    )}
                  </div>
                  {e.location && <div className="text-muted-foreground">📍 {e.location}</div>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {e.html_link && (
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                        <a href={e.html_link} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" /> Apri evento
                        </a>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => handleCreateAction(e, "prepare_meeting")}
                    >
                      + Crea action: Preparare
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => handleCreateAction(e, "follow_up_meeting")}
                    >
                      + Follow-up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => handleCreateAction(e, "check_deadline")}
                    >
                      + Scadenza
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => handleCreateAction(e, "create_reminder")}
                    >
                      + Reminder
                    </Button>
                    {brains.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() =>
                          void logCalendarEvent(
                            "google_calendar_action_created",
                            "Apertura collegamento evento↔brain (UI placeholder)",
                            { event_id: e.id },
                          )
                        }
                      >
                        Collega a brain/progetto
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Loop QA quick link */}
      {summary && (summary.hasNeverSynced || summary.lastSyncFailed) && (
        <Card className="border-amber-500/30">
          <CardContent className="flex items-center gap-2 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>
              {summary.hasNeverSynced
                ? "Calendar configurato ma mai sincronizzato."
                : "L'ultima sincronizzazione è fallita."}
            </span>
            <Button asChild size="sm" variant="outline" className="ml-auto">
              <Link to="/loop-qa" search={{ brain: effectiveBrain ?? undefined }}>
                Apri Loop QA
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
