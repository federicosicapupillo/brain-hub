import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Inbox,
  Mail,
  RefreshCw,
  Sparkles,
  Volume2,
  Wand2,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  generateDailyOperatingBrief,
  getTodayOperatingBrief,
  createActionFromBriefItem,
  createAllSuggestedActionsFromBrief,
  logDailyBriefEvent,
  type DailyBriefRow,
  type NextActionItem,
} from "@/lib/daily-operating-brief";

export const Route = createFileRoute("/_authenticated/daily-brief")({
  head: () => ({
    meta: [
      { title: "Daily Operating Brief — Brain Hub" },
      {
        name: "description",
        content:
          "Briefing operativo giornaliero multi-sorgente per Brain Hub. Read-only: aggrega Master Snapshot, Action Queue, Telegram, Gmail, Calendar, Drive, Loop QA. Nessuna automazione esterna.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: DailyBriefRoute,
});

type BrainRow = { id: string; name: string };

function DailyBriefRoute() {
  const search = useSearch({ from: "/_authenticated/daily-brief" });
  const navigate = useNavigate();
  const brainId = search.brain ?? null;

  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState<string | null>(null);

  useEffect(() => {
    void logDailyBriefEvent("daily_brief_opened", "Apertura Daily Brief", {
      brain_id: brainId,
    });
  }, [brainId]);

  useEffect(() => {
    supabase
      .from("brains")
      .select("id,name")
      .order("name")
      .then(({ data }) => setBrains((data ?? []) as BrainRow[]));
  }, []);

  const briefQ = useQuery({
    queryKey: ["daily-brief", brainId],
    queryFn: () => getTodayOperatingBrief(brainId),
  });

  const brief: DailyBriefRow | null = briefQ.data ?? null;

  async function handleGenerate() {
    setBusy(true);
    try {
      await generateDailyOperatingBrief({ brain_id: brainId });
      toast.success(brief ? "Brief rigenerato" : "Brief generato");
      void briefQ.refetch();
    } catch (e) {
      toast.error("Errore generazione brief: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateOne(item: NextActionItem) {
    if (!brief) return;
    setItemBusy(item.id);
    try {
      await createActionFromBriefItem(brief.id, item.id);
      toast.success("Action creata in Action Queue");
      void briefQ.refetch();
    } catch (e) {
      toast.error("Errore: " + String(e));
    } finally {
      setItemBusy(null);
    }
  }

  async function handleCreateAll() {
    if (!brief) return;
    if (
      !window.confirm(
        `Creare ${brief.next_actions.length} action suggerite in Action Queue? Restano per approvazione manuale.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await createAllSuggestedActionsFromBrief(brief.id);
      toast.success(`Create ${res.created} action (skipped ${res.skipped})`);
      void briefQ.refetch();
    } catch (e) {
      toast.error("Errore: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Daily Operating Brief"
        subtitle="Briefing operativo giornaliero multi-sorgente. Read-only: nessuna email inviata, nessun Telegram automatico, nessun n8n, nessuna modifica Gmail/Drive/Calendar/GitHub."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px]">
          <Select
            value={brainId ?? "all"}
            onValueChange={(v) =>
              navigate({
                to: "/daily-brief",
                search: { brain: v === "all" ? undefined : v },
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Progetto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i progetti</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="h-3 w-3" /> Read-only · aggregator
        </Badge>
        <Button onClick={handleGenerate} disabled={busy} size="sm">
          <Wand2 className="mr-2 h-4 w-4" />
          {brief ? "Rigenera briefing" : "Genera briefing di oggi"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => briefQ.refetch()}
          disabled={briefQ.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${briefQ.isFetching ? "animate-spin" : ""}`}
          />
          Aggiorna
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/action-queue">Apri Action Queue</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/gmail-connector" search={{ brain: brainId ?? undefined }}>
            <Mail className="mr-1 h-4 w-4" /> Gmail Connector
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/loop-qa">Loop QA</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          onClick={() =>
            void logDailyBriefEvent(
              "daily_brief_snapshot_update_clicked",
              "CTA Master Snapshot da Daily Brief",
              { brief_id: brief?.id ?? null },
            )
          }
        >
          <Link to="/master-snapshot">Aggiorna Master Snapshot</Link>
        </Button>
      </div>

      {!brief ? (
        <Card>
          <CardHeader>
            <CardTitle>Nessun briefing per oggi</CardTitle>
            <CardDescription>
              Genera il briefing operativo di oggi per vedere il riepilogo
              multi-sorgente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleGenerate} disabled={busy}>
              <Wand2 className="mr-2 h-4 w-4" /> Genera briefing di oggi
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> {brief.title}
                <Badge variant="outline" className="ml-2">
                  {brief.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                Generato:{" "}
                {new Date(brief.generated_at).toLocaleString()} ·{" "}
                {brief.brain_id ? `Brain: ${brief.brain_id}` : "Tutti i progetti"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Section title="Sintesi operativa">
                <p className="text-sm whitespace-pre-wrap">
                  {brief.executive_summary}
                </p>
              </Section>
              <Section
                title="Sintesi per Jack (voice)"
                icon={<Volume2 className="h-3 w-3" />}
                onView={() =>
                  void logDailyBriefEvent(
                    "daily_brief_voice_summary_viewed",
                    "Voice summary visualizzato",
                    { brief_id: brief.id },
                  )
                }
              >
                <p className="text-sm italic text-muted-foreground whitespace-pre-wrap">
                  {brief.voice_summary_text ?? "—"}
                </p>
              </Section>
              <Section title="Cosa è successo oggi">
                <p className="text-sm">{brief.today_activity_summary ?? "—"}</p>
                {brief.implemented_today.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {brief.implemented_today.slice(0, 8).map((i, idx) => (
                      <li key={idx} className="border rounded-md p-2">
                        <Badge variant="outline" className="mr-2">
                          {new Date(i.at).toLocaleTimeString()}
                        </Badge>
                        <span className="font-mono">{i.action}</span>
                        {i.notes ? (
                          <span className="ml-2 text-muted-foreground">
                            — {i.notes}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>
              <Section title="Stato progetti">
                <p className="text-sm">{brief.project_status_summary ?? "—"}</p>
              </Section>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Email
                </CardTitle>
                <CardDescription>
                  {brief.email_summary.available
                    ? `Account: ${brief.email_summary.account ?? "?"}`
                    : "Gmail non disponibile"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Stats
                  rows={[
                    ["Oggi", brief.email_summary.total_today],
                    ["High", brief.email_summary.high_priority_today],
                    ["Con action", brief.email_summary.with_action_today],
                    ["Senza action", brief.email_summary.without_action_today],
                  ]}
                />
                {brief.email_summary.top.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {brief.email_summary.top.map((e) => (
                      <li key={e.id} className="border rounded-md p-2">
                        <Badge variant="outline" className="mr-1">
                          {e.priority ?? "low"}
                        </Badge>
                        <Badge variant="outline" className="mr-2">
                          {e.category ?? "general"}
                        </Badge>
                        <span className="font-medium">
                          {e.subject ?? "(no subject)"}
                        </span>
                        <div className="text-muted-foreground truncate">
                          {e.from ?? "?"}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Inbox className="h-4 w-4" /> Automazioni
                </CardTitle>
                <CardDescription>
                  Telegram, n8n, Action Queue (read-only).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Stats
                  rows={[
                    ["Tg approvati", brief.automation_summary.telegram_approved_today],
                    ["Tg rifiutati", brief.automation_summary.telegram_rejected_today],
                    ["Tg pending", brief.automation_summary.telegram_pending],
                    ["Tg failed", brief.automation_summary.telegram_failed],
                    ["n8n run", brief.automation_summary.n8n_runs_recent],
                    ["n8n errori", brief.automation_summary.n8n_errors_recent],
                    ["Action ready", brief.automation_summary.actions_ready],
                  ]}
                />
                <Stats
                  rows={[
                    ["Open suggested", brief.open_actions_summary.suggested],
                    ["Open pending", brief.open_actions_summary.pending],
                    ["High risk open", brief.open_actions_summary.high_risk],
                    ["Create oggi", brief.open_actions_summary.created_today],
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Warning
              </CardTitle>
              <CardDescription>
                Aggregato da Loop QA — letture passive.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Stats
                rows={[
                  ["Errori", brief.warnings_summary.error],
                  ["Warning", brief.warnings_summary.warning],
                  ["Info", brief.warnings_summary.info],
                  ["Totale", brief.warnings_summary.total],
                ]}
              />
              {brief.warnings_summary.top.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {brief.warnings_summary.top.map((w) => (
                    <li key={w.id} className="border rounded-md p-2">
                      <Badge
                        variant="outline"
                        className={
                          w.level === "error"
                            ? "bg-red-500/10 text-red-600 border-red-500/30 mr-2"
                            : "bg-amber-500/10 text-amber-600 border-amber-500/30 mr-2"
                        }
                      >
                        {w.level}
                      </Badge>
                      <span className="font-medium">{w.title}</span>
                      {w.category ? (
                        <span className="ml-2 text-muted-foreground">
                          [{w.category}]
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nessun warning critico.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Prossime azioni
                </CardTitle>
                <CardDescription>
                  Max 5 azioni suggerite. Vanno in Action Queue come{" "}
                  <code>suggested</code> per approvazione manuale.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCreateAll}
                disabled={busy || brief.next_actions.length === 0}
              >
                Crea tutte le action consigliate
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {brief.next_actions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nessuna prossima azione.
                </p>
              ) : (
                brief.next_actions.map((a) => (
                  <NextActionRow
                    key={a.id}
                    item={a}
                    busy={itemBusy === a.id}
                    onCreate={() => handleCreateOne(a)}
                  />
                ))
              )}
              {brief.created_action_ids.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Action già create da questo brief:{" "}
                  {brief.created_action_ids.length}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  onView,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onView?: () => void;
}) {
  useEffect(() => {
    onView?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Stats({ rows }: { rows: Array<[string, number]> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border p-2 text-center">
          <div className="text-base font-semibold">{value}</div>
          <div className="text-[10px] uppercase text-muted-foreground">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function NextActionRow({
  item,
  busy,
  onCreate,
}: {
  item: NextActionItem;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border rounded-md p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className={
              item.priority === "high"
                ? "bg-red-500/10 text-red-600 border-red-500/30"
                : item.priority === "medium"
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                  : ""
            }
          >
            {item.priority}
          </Badge>
          <Badge variant="outline">{item.risk_level}</Badge>
          <Badge variant="outline">{item.source_module}</Badge>
        </div>
        <div className="mt-1 font-medium text-sm">{item.title}</div>
        <div className="text-xs text-muted-foreground">
          {item.description}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          <strong>Reason:</strong> {item.reason} ·{" "}
          <strong>Verification:</strong> {item.verification}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onCreate} disabled={busy}>
        {busy ? "…" : "Crea action"} <ArrowRight className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}
