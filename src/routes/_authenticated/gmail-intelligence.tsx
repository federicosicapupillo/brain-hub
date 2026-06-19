// Brain Hub v3.22 — Gmail Intelligence route (read-only)
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, RefreshCw, Sparkles, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  getGmailBrief,
  listImportantEmails,
  recomputeImportance,
  type ImportantEmail,
} from "@/lib/gmail-intelligence";
import {
  summarizeEmailFn,
  previewEmailActionFn,
} from "@/lib/gmail-intelligence.functions";
import { createActionFromGmailMessage } from "@/lib/gmail-connector";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/gmail-intelligence")({
  validateSearch: z
    .object({ brain: z.string().optional() })
    .parse.bind(z.object({ brain: z.string().optional() })),
  head: () => ({
    meta: [
      { title: "Gmail Intelligence — Brain Hub" },
      {
        name: "description",
        content:
          "Email importanti, riassunti read-only e preview action — Brain Hub v3.22.",
      },
    ],
  }),
  component: GmailIntelligenceRoute,
});

type Range = "today" | "7d" | "all";

function GmailIntelligenceRoute() {
  const search = useSearch({ from: "/_authenticated/gmail-intelligence" });
  const brainId = search.brain ?? null;

  const [range, setRange] = useState<Range>("7d");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [activeSummary, setActiveSummary] = useState<{
    gmail_message_id: string;
    payload: unknown;
  } | null>(null);

  const briefQ = useQuery({
    queryKey: ["gmail-intelligence-brief", brainId, range, unreadOnly],
    queryFn: () => getGmailBrief(brainId),
    throwOnError: false,
  });

  const listQ = useQuery({
    queryKey: ["gmail-intelligence-list", brainId, range, projectFilter],
    queryFn: () =>
      listImportantEmails({
        brainId,
        range,
        project: projectFilter === "all" ? null : projectFilter,
        limit: 50,
      }),
    throwOnError: false,
  });

  const summarize = useServerFn(summarizeEmailFn);
  const preview = useServerFn(previewEmailActionFn);

  useEffect(() => {
    void logGmailIntelligenceEvent("gmail_intelligence_opened", {
      brain_id: brainId,
    });
  }, [brainId]);

  const projects = useMemo(() => {
    const all = new Set<string>();
    (listQ.data ?? []).forEach((e) => {
      if (e.project_guess) all.add(e.project_guess);
    });
    return Array.from(all).sort();
  }, [listQ.data]);

  const handleRecompute = async () => {
    try {
      const r = await recomputeImportance({ brainId, limit: 200 });
      toast.success(`Importanza ricalcolata su ${r.updated} email`);
      void listQ.refetch();
      void briefQ.refetch();
      void logGmailIntelligenceEvent("gmail_sync_started", {
        action: "recompute_importance",
        updated: r.updated,
      });
    } catch (err) {
      toast.error(`Errore ricalcolo: ${(err as Error).message}`);
    }
  };

  const handleSummarize = async (e: ImportantEmail) => {
    try {
      const res = await summarize({
        data: { gmail_message_id: e.gmail_message_id, brain_id: brainId },
      });
      setActiveSummary({ gmail_message_id: e.gmail_message_id, payload: res });
    } catch (err) {
      toast.error(`Errore riassunto: ${(err as Error).message}`);
    }
  };

  const handlePreviewAction = async (e: ImportantEmail) => {
    try {
      const res = await preview({
        data: {
          gmail_message_id: e.gmail_message_id,
          brain_id: brainId,
          reason: `Email importante ${e.importance_level}: ${e.importance_reason ?? ""}`,
        },
      });
      if (res.ok) {
        toast.success("Preview action pronta. Conferma in Action Queue.");
      } else {
        toast.error("Preview non disponibile");
      }
    } catch (err) {
      toast.error(`Errore preview: ${(err as Error).message}`);
    }
  };

  const handleCreateAction = async (e: ImportantEmail) => {
    try {
      const action = await createActionFromGmailMessage(e.id);
      toast.success(`Action creata: ${action.title}`);
      void listQ.refetch();
    } catch (err) {
      toast.error(`Errore action: ${(err as Error).message}`);
    }
  };

  const connected = briefQ.data?.connected === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gmail Intelligence"
        description="Email importanti, riassunti read-only e preview action — privacy-safe."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Stato Gmail
            <Badge variant={connected ? "default" : "outline"} className="ml-auto">
              {connected ? "Collegato" : "Non collegato"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connessione read-only. Nessun invio, nessuna modifica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!connected ? (
            <Button asChild>
              <Link to="/gmail-connector" search={{ brain: brainId ?? undefined }}>
                Collega Gmail
              </Link>
            </Button>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Oggi" value={briefQ.data?.today_total ?? 0} />
                <Stat label="Non lette" value={briefQ.data?.today_unread ?? 0} />
                <Stat label="Important. oggi" value={briefQ.data?.important_today ?? 0} />
                <Stat label="Important. 7g" value={briefQ.data?.important_7d ?? 0} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleRecompute}>
                  <Sparkles className="mr-1 h-4 w-4" /> Ricalcola importanza
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void briefQ.refetch();
                    void listQ.refetch();
                  }}
                >
                  <RefreshCw className="mr-1 h-4 w-4" /> Aggiorna
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/gmail-connector" search={{ brain: brainId ?? undefined }}>
                    Gestione connessione <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              {briefQ.data?.last_sync_at ? (
                <p className="text-xs text-muted-foreground">
                  Ultima sync: {new Date(briefQ.data.last_sync_at).toLocaleString()}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {connected ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Email importanti</CardTitle>
            <CardDescription>
              Score ≥ 55. Riassunti e preview action sono on-demand.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={range} onValueChange={(v) => setRange(v as Range)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Oggi</SelectItem>
                  <SelectItem value="7d">Ultimi 7 giorni</SelectItem>
                  <SelectItem value="all">Tutto</SelectItem>
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Progetto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i progetti</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant={unreadOnly ? "default" : "outline"}
                onClick={() => setUnreadOnly((v) => !v)}
              >
                Solo non lette
              </Button>
            </div>

            <div className="space-y-2">
              {(listQ.data ?? [])
                .filter((e) => (unreadOnly ? e.is_unread : true))
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            e.importance_level === "high"
                              ? "destructive"
                              : e.importance_level === "medium"
                                ? "default"
                                : "outline"
                          }
                        >
                          {e.importance_level} · {e.importance_score}
                        </Badge>
                        {e.project_guess ? (
                          <Badge variant="secondary">{e.project_guess}</Badge>
                        ) : null}
                        {e.is_unread ? <Badge variant="outline">Non letta</Badge> : null}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">
                        {e.subject ?? "(senza oggetto)"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        Da {e.from_name ?? e.from_email ?? "—"} ·{" "}
                        {e.internal_date
                          ? new Date(e.internal_date).toLocaleString()
                          : "—"}
                      </div>
                      {e.importance_reason ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Motivo: {e.importance_reason}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void handleSummarize(e)}>
                        Riassumi
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void handlePreviewAction(e)}>
                        Preview action
                      </Button>
                      <Button size="sm" onClick={() => void handleCreateAction(e)}>
                        <Plus className="mr-1 h-3 w-3" /> Crea action
                      </Button>
                    </div>
                  </div>
                ))}
              {(listQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessuna email importante nel range selezionato.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeSummary ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Riassunto</CardTitle>
            <CardDescription>
              Solo summary generato lato server — il body completo non viene mostrato.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs">
              {JSON.stringify(activeSummary.payload, null, 2)}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setActiveSummary(null)}
            >
              Chiudi
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

async function logGmailIntelligenceEvent(
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: u.user.id,
      clipboard_item_id: null,
      action: event as never,
      notes: "gmail_intelligence",
      metadata,
    } as never);
  } catch {
    /* best-effort */
  }
}
