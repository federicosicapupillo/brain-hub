import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getGmailOauthStatus,
  startGmailOAuth,
  disconnectGmail,
  syncGmailMessages,
  createGmailActionFromMessage,
} from "@/lib/gmail-oauth.functions";
import {
  getGmailSummary,
  listSyncedEmails,
  type GmailListFilters,
  type GmailMessageRow,
  type GmailPriority,
  type GmailCategory,
  logGmailConnectorEvent,
} from "@/lib/gmail-connector";

export const Route = createFileRoute("/_authenticated/gmail-connector")({
  head: () => ({
    meta: [
      { title: "Gmail Connector — Brain Hub" },
      {
        name: "description",
        content:
          "Connettore Gmail read-only per Brain Hub: sincronizza email recenti, classifica e crea action manuali. Nessuna email viene inviata o modificata.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
    oauth: typeof s.oauth === "string" ? s.oauth : undefined,
    reason: typeof s.reason === "string" ? s.reason : undefined,
    count: typeof s.count === "string" ? s.count : undefined,
  }),
  component: GmailConnectorRoute,
});

type BrainRow = { id: string; name: string };

function GmailConnectorRoute() {
  const search = useSearch({ from: "/_authenticated/gmail-connector" });
  const navigate = useNavigate();
  const brainId = search.brain ?? null;

  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [query, setQuery] = useState<string>("");
  const [range, setRange] = useState<"today" | "7d" | "all">("7d");
  const [priority, setPriority] = useState<GmailPriority | "all">("all");
  const [category, setCategory] = useState<GmailCategory | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [actionFilter, setActionFilter] = useState<"all" | "with" | "without">("all");

  const startFn = useServerFn(startGmailOAuth);
  const disconnectFn = useServerFn(disconnectGmail);
  const syncFn = useServerFn(syncGmailMessages);
  const createActionFn = useServerFn(createGmailActionFromMessage);

  useEffect(() => {
    void logGmailConnectorEvent("gmail_connector_opened", "Apertura Gmail Connector", {
      brain_id: brainId,
    });
  }, [brainId]);

  useEffect(() => {
    if (search.oauth === "success") {
      toast.success(`Gmail collegato. ${search.count ?? 0} email sincronizzate.`);
      navigate({
        to: "/gmail-connector",
        search: { brain: brainId ?? undefined },
        replace: true,
      });
    } else if (search.oauth === "error") {
      toast.error(`OAuth Gmail fallito: ${search.reason ?? "errore"}`);
    }
  }, [search.oauth, search.reason, search.count, brainId, navigate]);

  useEffect(() => {
    supabase
      .from("brains")
      .select("id,name")
      .order("name")
      .then(({ data }) => setBrains((data ?? []) as BrainRow[]));
  }, []);

  const status = useQuery({
    queryKey: ["gmail-oauth-status"],
    queryFn: () => getGmailOauthStatus(),
  });

  const summary = useQuery({
    queryKey: ["gmail-summary", brainId],
    queryFn: () => getGmailSummary(brainId),
  });

  const filters: GmailListFilters = useMemo(
    () => ({
      range,
      unreadOnly,
      priority: priority === "all" ? undefined : priority,
      category: category === "all" ? undefined : category,
      withActionOnly: actionFilter === "with" || undefined,
      withoutActionOnly: actionFilter === "without" || undefined,
      limit: 100,
    }),
    [range, unreadOnly, priority, category, actionFilter],
  );

  const messages = useQuery({
    queryKey: ["gmail-messages", brainId, filters],
    queryFn: () => listSyncedEmails(brainId, filters),
  });

  const briefingToday = useQuery({
    queryKey: ["gmail-briefing", brainId],
    queryFn: () =>
      listSyncedEmails(brainId, { range: "today", limit: 10, priority: "high" }),
  });

  const needAction = useQuery({
    queryKey: ["gmail-need-action", brainId],
    queryFn: () =>
      listSyncedEmails(brainId, {
        range: "7d",
        priority: "high",
        withoutActionOnly: true,
        limit: 10,
      }),
  });

  const isConnected = !!summary.data?.connected;
  const conn = summary.data?.connection ?? null;

  async function handleConnect() {
    void logGmailConnectorEvent("gmail_oauth_started", "Avvio OAuth Gmail", {
      brain_id: brainId,
    });
    const res = await startFn({
      data: { brain_id: brainId, redirect_path: "/gmail-connector" },
    });
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    window.location.href = res.authUrl;
  }

  async function handleSync() {
    void logGmailConnectorEvent("gmail_sync_started", "Avvio sync Gmail", {
      brain_id: brainId,
      query,
    });
    const res = await syncFn({
      data: {
        brain_id: brainId,
        max_results: 50,
        query: query.trim() ? query.trim() : null,
      },
    });
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    if (res.requires_reauth) {
      window.location.href = res.authUrl;
    }
  }

  async function handleDisconnect() {
    if (!conn) return;
    if (!window.confirm("Disconnettere Gmail? La cache locale rimane disponibile.")) return;
    const res = await disconnectFn({ data: { connectionId: conn.id } });
    if (!res.ok) {
      toast.error(res.reason ?? "Errore");
      return;
    }
    void logGmailConnectorEvent("gmail_disconnected", "Gmail disconnesso", {
      connection_id: conn.id,
    });
    toast.success("Gmail disconnesso");
    void summary.refetch();
  }

  async function handleCreateAction(row: GmailMessageRow) {
    const res = await createActionFn({ data: { message_map_id: row.id } });
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    toast.success("Action creata");
    void messages.refetch();
    void needAction.refetch();
    void summary.refetch();
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Gmail Connector"
        subtitle="Connettore Gmail read-only: sincronizza email recenti, classifica e crea action manuali. Nessuna email viene inviata, modificata, archiviata o cancellata."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px]">
          <Select
            value={brainId ?? "all"}
            onValueChange={(v) =>
              navigate({
                to: "/gmail-connector",
                search: { brain: v === "all" ? undefined : v },
              })
            }
          >
            <SelectTrigger><SelectValue placeholder="Progetto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i progetti</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="h-3 w-3" /> Scope: gmail.readonly
        </Badge>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/email-daily-brief"
            search={{ brain: brainId ?? undefined }}
          >
            Apri Daily Brief
          </Link>
        </Button>
      </div>


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Connessione Gmail
            {isConnected ? (
              <Badge className="ml-2 bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Collegato</Badge>
            ) : (
              <Badge variant="outline" className="ml-2">Non collegato</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {status.data?.configured === false ? (
              <span className="text-destructive">
                Google OAuth non configurato. Aggiungi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e abilita lo scope <code>https://www.googleapis.com/auth/gmail.readonly</code> in Google Cloud Console.
              </span>
            ) : isConnected ? (
              <>Account: <strong>{conn?.google_email ?? "?"}</strong> · Ultima sync: {conn?.last_sync_at ? new Date(conn.last_sync_at).toLocaleString() : "—"}</>
            ) : (
              <>Nessun token Gmail viene salvato in database. Ogni sync passa da OAuth Google.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">Query Gmail (opzionale)</label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="es. newer_than:1d is:unread from:cliente@..."
              />
            </div>
            <Button onClick={handleConnect} disabled={status.data?.configured === false}>
              {isConnected ? "Ricollega Gmail" : "Collega Gmail"}
            </Button>
            <Button onClick={handleSync} variant="secondary" disabled={status.data?.configured === false}>
              <RefreshCw className="mr-2 h-4 w-4" /> Sincronizza
            </Button>
            {isConnected ? (
              <Button onClick={handleDisconnect} variant="outline">Disconnetti</Button>
            ) : null}
          </div>
          {conn?.last_sync_status === "failed" ? (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Ultima sync fallita: {conn.last_sync_error ?? "errore"}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Limite v3.8: il refresh token Gmail non viene salvato. Ogni nuova sync richiede di passare di nuovo da Google OAuth. Nessun token è esposto nel frontend.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Briefing email di oggi</CardTitle>
            <CardDescription>Email high priority arrivate oggi.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {briefingToday.data && briefingToday.data.length > 0
              ? briefingToday.data.map((m) => <MiniEmailRow key={m.id} row={m} />)
              : <p className="text-xs text-muted-foreground">Nessuna email high priority oggi.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Email che richiedono azione</CardTitle>
            <CardDescription>High priority degli ultimi 7 giorni senza action collegata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needAction.data && needAction.data.length > 0 ? (
              needAction.data.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2">
                  <MiniEmailRow row={m} />
                  <Button size="sm" variant="outline" onClick={() => handleCreateAction(m)}>
                    Crea action
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nessuna email che richiede action immediata.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Email sincronizzate</CardTitle>
          <CardDescription>Filtra per data, priorità, categoria, stato action.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Oggi</SelectItem>
                <SelectItem value="7d">Ultimi 7 giorni</SelectItem>
                <SelectItem value="all">Tutte</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte priorità</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte categorie</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="reply_needed">Reply needed</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="finance">Finance</SelectItem>
                <SelectItem value="notification">Notification</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as typeof actionFilter)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte</SelectItem>
                <SelectItem value="with">Con action</SelectItem>
                <SelectItem value="without">Senza action</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={unreadOnly ? "default" : "outline"}
              onClick={() => setUnreadOnly((u) => !u)}
            >
              Solo non lette
            </Button>
          </div>

          <div className="space-y-2">
            {messages.data && messages.data.length > 0 ? (
              messages.data.map((m) => (
                <EmailListItem
                  key={m.id}
                  row={m}
                  onCreateAction={() => handleCreateAction(m)}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nessuna email sincronizzata con questi filtri.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function priorityTone(p: string | null): string {
  if (p === "high") return "bg-red-500/10 text-red-600 border-red-500/30";
  if (p === "medium") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function MiniEmailRow({ row }: { row: GmailMessageRow }) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={priorityTone(row.detected_priority)}>
          {row.detected_priority ?? "low"}
        </Badge>
        <span className="font-medium truncate">{row.subject ?? "(no subject)"}</span>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {row.from_name ? `${row.from_name} ` : ""}&lt;{row.from_email ?? "?"}&gt;
      </div>
    </div>
  );
}

function EmailListItem({
  row,
  onCreateAction,
}: {
  row: GmailMessageRow;
  onCreateAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gmailLink = row.gmail_thread_id
    ? `https://mail.google.com/mail/u/0/#inbox/${row.gmail_thread_id}`
    : null;
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => setOpen((o) => !o)} className="text-left flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={priorityTone(row.detected_priority)}>
              {row.detected_priority ?? "low"}
            </Badge>
            <Badge variant="outline">{row.detected_category ?? "general"}</Badge>
            {row.is_unread ? <Badge>non letta</Badge> : null}
            {row.linked_action_id ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> action collegata
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {row.internal_date ? new Date(row.internal_date).toLocaleString() : "—"}
            </span>
          </div>
          <div className="mt-1 font-medium truncate">{row.subject ?? "(no subject)"}</div>
          <div className="text-xs text-muted-foreground truncate">
            {row.from_name ? `${row.from_name} ` : ""}&lt;{row.from_email ?? "?"}&gt;
          </div>
          <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{row.snippet ?? ""}</div>
        </button>
        <div className="flex flex-col gap-2">
          {!row.linked_action_id ? (
            <Button size="sm" variant="outline" onClick={onCreateAction}>
              Crea action <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          ) : null}
          {gmailLink ? (
            <Button asChild size="sm" variant="ghost">
              <a href={gmailLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" /> Apri in Gmail
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3 rounded bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          {row.body_preview ?? row.snippet ?? "(nessun contenuto)"}
        </div>
      ) : null}
    </div>
  );
}
