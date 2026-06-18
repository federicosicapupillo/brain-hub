import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Mail,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getDailyBrief,
  categoryLabel,
  type NextActionSuggestion,
} from "@/lib/gmail-daily-brief";
import type { GmailMessageRow } from "@/lib/gmail-connector";
import { logGmailConnectorEvent } from "@/lib/gmail-connector";
import { createGmailActionFromMessage } from "@/lib/gmail-oauth.functions";

export const Route = createFileRoute("/_authenticated/email-daily-brief")({
  head: () => ({
    meta: [
      { title: "Email Daily Brief — Brain Hub" },
      {
        name: "description",
        content:
          "Briefing email giornaliero read-only con prossime azioni suggerite. Nessuna email viene inviata o modificata.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: EmailDailyBriefRoute,
});

type BrainRow = { id: string; name: string };

function EmailDailyBriefRoute() {
  const search = useSearch({ from: "/_authenticated/email-daily-brief" });
  const navigate = useNavigate();
  const brainId = search.brain ?? null;

  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const createActionFn = useServerFn(createGmailActionFromMessage);

  useEffect(() => {
    void logGmailConnectorEvent(
      "email_daily_brief_opened",
      "Apertura Email Daily Brief",
      { brain_id: brainId },
    );
  }, [brainId]);

  useEffect(() => {
    supabase
      .from("brains")
      .select("id,name")
      .order("name")
      .then(({ data }) => setBrains((data ?? []) as BrainRow[]));
  }, []);

  const brief = useQuery({
    queryKey: ["gmail-daily-brief", brainId],
    queryFn: () => getDailyBrief(brainId),
  });

  async function handleCreate(item: NextActionSuggestion) {
    setBusyId(item.message.id);
    try {
      const res = await createActionFn({
        data: { message_map_id: item.message.id },
      });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success("Action creata da brief");
      void logGmailConnectorEvent(
        "email_daily_brief_action_created",
        "Action creata dal Daily Brief",
        {
          message_map_id: item.message.id,
          suggested_action_type: item.suggestedActionType,
          priority: item.priority,
        },
      );
      void brief.refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateAllHigh() {
    const targets = (brief.data?.nextActions ?? []).filter(
      (a) => a.priority === "high",
    );
    if (targets.length === 0) {
      toast.info("Nessuna email high priority senza action.");
      return;
    }
    if (
      !window.confirm(
        `Creare ${targets.length} action dalle email high priority? Le action restano in Action Queue per approvazione manuale.`,
      )
    )
      return;
    let ok = 0;
    let fail = 0;
    for (const t of targets) {
      setBusyId(t.message.id);
      const res = await createActionFn({
        data: { message_map_id: t.message.id },
      });
      if (res.ok) ok += 1;
      else fail += 1;
    }
    setBusyId(null);
    void logGmailConnectorEvent(
      "email_daily_brief_batch_actions",
      "Batch action create dal Daily Brief",
      { ok, fail, brain_id: brainId },
    );
    toast.success(`Action create: ${ok} · errori: ${fail}`);
    void brief.refetch();
  }

  const data = brief.data;
  const stats = data?.stats;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Email Daily Brief"
        subtitle="Riepilogo giornaliero delle email sincronizzate e prossime azioni suggerite. Read-only: nessuna email viene inviata, modificata, archiviata o cancellata."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px]">
          <Select
            value={brainId ?? "all"}
            onValueChange={(v) =>
              navigate({
                to: "/email-daily-brief",
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
        <Button asChild variant="outline" size="sm">
          <Link
            to="/gmail-connector"
            search={{ brain: brainId ?? undefined }}
          >
            <Mail className="mr-2 h-4 w-4" /> Gmail Connector
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => brief.refetch()}
          disabled={brief.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${brief.isFetching ? "animate-spin" : ""}`}
          />
          Aggiorna
        </Button>
      </div>

      {!data?.connected ? (
        <Card>
          <CardHeader>
            <CardTitle>Gmail non collegato</CardTitle>
            <CardDescription>
              Collega Gmail dal Gmail Connector per generare il brief giornaliero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link
                to="/gmail-connector"
                search={{ brain: brainId ?? undefined }}
              >
                Apri Gmail Connector <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Brief del giorno
              </CardTitle>
              <CardDescription>
                Account: <strong>{data.account ?? "?"}</strong> · Ultima sync:{" "}
                {data.lastSyncAt
                  ? new Date(data.lastSyncAt).toLocaleString()
                  : "—"}{" "}
                · Generato:{" "}
                {new Date(data.generatedAt).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Oggi" value={stats?.totalToday ?? 0} />
                <Stat
                  label="High priority oggi"
                  value={stats?.highPriorityToday ?? 0}
                  tone="high"
                />
                <Stat
                  label="Non lette oggi"
                  value={stats?.unreadToday ?? 0}
                />
                <Stat
                  label="Senza action oggi"
                  value={stats?.withoutActionToday ?? 0}
                />
                <Stat label="Totali 7gg" value={stats?.total7d ?? 0} />
                <Stat
                  label="High 7gg"
                  value={stats?.highPriority7d ?? 0}
                  tone="high"
                />
                <Stat
                  label="Senza action 7gg"
                  value={stats?.withoutAction7d ?? 0}
                />
                <Stat
                  label="Next actions"
                  value={data.nextActions.length}
                  tone="accent"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Highlights di oggi</CardTitle>
                <CardDescription>
                  Email arrivate oggi, ordinate per priorità.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.todayHighlights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nessuna email oggi.
                  </p>
                ) : (
                  data.todayHighlights.map((m) => (
                    <MiniEmailRow key={m.id} row={m} />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">Prossime azioni suggerite</CardTitle>
                  <CardDescription>
                    Email senza action collegata, ordinate per priorità.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCreateAllHigh}
                  disabled={
                    !data.nextActions.some((a) => a.priority === "high")
                  }
                >
                  Crea tutte high priority
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.nextActions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nessuna azione suggerita.
                  </p>
                ) : (
                  data.nextActions.map((a) => (
                    <NextActionRow
                      key={a.message.id}
                      item={a}
                      busy={busyId === a.message.id}
                      onCreate={() => handleCreate(a)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Email per categoria (ultimi 7 giorni)
              </CardTitle>
              <CardDescription>
                Top 5 email per ciascuna categoria attiva.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {data.buckets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nessuna email negli ultimi 7 giorni.
                </p>
              ) : (
                data.buckets.map((b) => (
                  <div key={b.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{categoryLabel(b.key)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {b.emails.length}
                      </span>
                    </div>
                    {b.emails.map((m) => (
                      <MiniEmailRow key={m.id} row={m} />
                    ))}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function priorityTone(p: string | null): string {
  if (p === "high") return "bg-red-500/10 text-red-600 border-red-500/30";
  if (p === "medium") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "high" | "accent";
}) {
  const cls =
    tone === "high"
      ? "border-red-500/30"
      : tone === "accent"
        ? "border-primary/30"
        : "";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function MiniEmailRow({ row }: { row: GmailMessageRow }) {
  const gmailLink = row.gmail_thread_id
    ? `https://mail.google.com/mail/u/0/#inbox/${row.gmail_thread_id}`
    : null;
  return (
    <div className="text-sm border rounded-md p-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={priorityTone(row.detected_priority)}>
          {row.detected_priority ?? "low"}
        </Badge>
        <Badge variant="outline">{row.detected_category ?? "general"}</Badge>
        {row.linked_action_id ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> action
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground ml-auto">
          {row.internal_date
            ? new Date(row.internal_date).toLocaleString()
            : "—"}
        </span>
      </div>
      <div className="mt-1 font-medium truncate">
        {row.subject ?? "(no subject)"}
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {row.from_name ? `${row.from_name} ` : ""}&lt;
        {row.from_email ?? "?"}&gt;
      </div>
      {gmailLink ? (
        <a
          href={gmailLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Apri in Gmail
        </a>
      ) : null}
    </div>
  );
}

function NextActionRow({
  item,
  busy,
  onCreate,
}: {
  item: NextActionSuggestion;
  busy: boolean;
  onCreate: () => void;
}) {
  const row = item.message;
  return (
    <div className="flex items-start justify-between gap-3 border rounded-md p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={priorityTone(item.priority)}>
            {item.priority}
          </Badge>
          <Badge variant="outline">{item.suggestedActionType}</Badge>
        </div>
        <div className="mt-1 font-medium truncate text-sm">
          {row.subject ?? "(no subject)"}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {row.from_name ? `${row.from_name} ` : ""}&lt;
          {row.from_email ?? "?"}&gt;
        </div>
        <div className="text-xs text-muted-foreground mt-1">{item.reason}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onCreate} disabled={busy}>
        {busy ? "…" : "Crea action"}{" "}
        <ArrowRight className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}
