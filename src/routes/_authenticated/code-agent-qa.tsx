import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Circle, XCircle, ArrowRight, ShieldCheck } from "lucide-react";
import {
  getCodeAgentQaSummary,
  getCodeAgentLifecycleChecklist,
  getCodeAgentBlockedJobs,
  getCodeAgentInconsistentJobs,
  getCodeAgentNextStepSuggestions,
  getCodeAgentRecentAuditEvents,
  getCodeAgentRunnerReadiness,
  logCodeAgentQaEvent,
} from "@/lib/code-agent-qa";

export const Route = createFileRoute("/_authenticated/code-agent-qa")({
  head: () => ({
    meta: [
      { title: "Code Agent QA — Brain Hub" },
      {
        name: "description",
        content:
          "Console QA end-to-end per i Code Agent Jobs: lifecycle, job bloccati, incoerenze, audit, runner readiness. Read-only.",
      },
    ],
  }),
  component: CodeAgentQaPage,
});

function CodeAgentQaPage() {
  useEffect(() => {
    void logCodeAgentQaEvent("code_agent_qa_opened", {});
  }, []);

  const summary = useQuery({
    queryKey: ["caj-qa-summary"],
    queryFn: () => getCodeAgentQaSummary(null),
  });
  const checklist = useQuery({
    queryKey: ["caj-qa-checklist"],
    queryFn: () => getCodeAgentLifecycleChecklist(null),
  });
  const blocked = useQuery({
    queryKey: ["caj-qa-blocked"],
    queryFn: () => getCodeAgentBlockedJobs(null),
  });
  const inconsistent = useQuery({
    queryKey: ["caj-qa-inconsistent"],
    queryFn: () => getCodeAgentInconsistentJobs(null),
  });
  const nextSteps = useQuery({
    queryKey: ["caj-qa-next-steps"],
    queryFn: () => getCodeAgentNextStepSuggestions(null),
  });
  const audit = useQuery({
    queryKey: ["caj-qa-audit"],
    queryFn: () => getCodeAgentRecentAuditEvents(null, 10),
  });
  const readiness = useQuery({
    queryKey: ["caj-qa-readiness"],
    queryFn: () => getCodeAgentRunnerReadiness(null),
  });

  return (
    <div className="container mx-auto space-y-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Code Agent QA</h1>
          <p className="text-sm text-muted-foreground">
            Vista QA end-to-end del ciclo Code Agent. Read-only: nessun job viene modificato,
            nessun runner reale viene attivato.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/code-agent-jobs">
            <ArrowRight className="mr-1 h-3 w-3" /> Code Agent Jobs
          </Link>
        </Button>
      </header>

      {/* Summary tiles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Stato generale</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Totali" value={summary.data?.total ?? 0} />
            <Tile label="Aperti" value={summary.data?.open ?? 0} />
            <Tile label="Bloccati" value={summary.data?.blocked ?? 0} tone="amber" />
            <Tile label="Incoerenti" value={summary.data?.inconsistent ?? 0} tone="red" />
            <Tile label="In approvazione" value={summary.data?.awaitingApproval ?? 0} />
            <Tile label="Da revisionare" value={summary.data?.awaitingReview ?? 0} />
            <Tile label="Transition blocked 24h" value={summary.data?.transitionBlocked24h ?? 0} tone="amber" />
            <Tile label="Bulk sync err 24h" value={summary.data?.bulkSyncErrors24h ?? 0} tone="amber" />
          </div>
        </CardContent>
      </Card>

      {/* Lifecycle checklist */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Lifecycle checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(checklist.data ?? []).map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-sm">
                {it.status === "done" && <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />}
                {it.status === "warning" && <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />}
                {it.status === "missing" && <XCircle className="mt-0.5 h-4 w-4 text-rose-500" />}
                {it.status === "not_applicable" && <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <div>
                  <div>{it.label}</div>
                  {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Runner readiness */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4" /> Prontezza per runner reale
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Badge
              variant={
                readiness.data?.status === "ready_for_design_only"
                  ? "default"
                  : readiness.data?.status === "almost_ready"
                    ? "secondary"
                    : "destructive"
              }
            >
              {readiness.data?.status ?? "loading"}
            </Badge>
          </div>
          <ul className="space-y-1 text-sm">
            {(readiness.data?.criteria ?? []).map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 text-rose-500" />
                )}
                <div>
                  <div>{c.label}</div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            {readiness.data?.note}
          </p>
        </CardContent>
      </Card>

      {/* Next step suggestions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Prossimi step consigliati</CardTitle>
        </CardHeader>
        <CardContent>
          {(nextSteps.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna azione consigliata.</p>
          ) : (
            <ul className="space-y-2">
              {(nextSteps.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {s.label} <Badge variant="outline">{s.count}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{s.suggestion}</div>
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link to={s.cta.to}>{s.cta.label}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Blocked jobs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Job bloccati ({blocked.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {(blocked.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun job bloccato.</p>
          ) : (
            <ul className="space-y-2">
              {(blocked.data ?? []).slice(0, 30).map((j) => (
                <li key={`${j.id}-${j.category}`} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{j.title}</span>
                    <Badge variant="outline">{j.status}</Badge>
                    <Badge variant="outline">risk: {j.risk_level}</Badge>
                    <Badge variant="secondary">{j.category}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Approval: {j.approval_status}
                    {j.repository_resolution_status && ` · Repo: ${j.repository_resolution_status}`}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs">→ {j.next_step}</span>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={j.cta.to}>{j.cta.label}</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Inconsistent jobs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Job incoerenti ({inconsistent.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {(inconsistent.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna incoerenza rilevata.</p>
          ) : (
            <ul className="space-y-2">
              {(inconsistent.data ?? []).slice(0, 30).map((j, idx) => (
                <li key={`${j.id}-${idx}`} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">{j.title}</span>
                    <Badge variant="outline">{j.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{j.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ultimi eventi audit</CardTitle>
        </CardHeader>
        <CardContent>
          {(audit.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun evento recente.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {(audit.data ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border p-1.5">
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                  <Badge variant="outline">{e.event_type}</Badge>
                  <span className="font-mono">{e.job_id_short}</span>
                  {e.job_title && <span className="text-muted-foreground">· {e.job_title}</span>}
                  {e.reason && <span>· reason: {e.reason}</span>}
                  {e.code && <span>· code: {e.code}</span>}
                  {e.status && <span>· status: {e.status}</span>}
                  {e.risk_level && <span>· risk: {e.risk_level}</span>}
                  {e.source && <span>· src: {e.source}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const toneCls =
    tone === "red"
      ? "border-rose-500/40 bg-rose-500/10"
      : tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-border";
  return (
    <div className={`rounded-md border p-2 ${toneCls}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
