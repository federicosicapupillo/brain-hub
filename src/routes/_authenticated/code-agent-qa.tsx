import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
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
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  XCircle,
  ArrowRight,
  ShieldCheck,
  Workflow,
  ListChecks,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listCodeAgentJobs } from "@/lib/code-agent-orchestrator";
import {
  getCodeAgentQaSummary,
  getCodeAgentLifecycleChecklist,
  getCodeAgentBlockedJobs,
  getCodeAgentInconsistentJobs,
  getCodeAgentNextStepSuggestions,
  getCodeAgentRecentAuditEvents,
  getCodeAgentRunnerReadiness,
  getCodeAgentEndToEndSummary,
  getCodeAgentEndToEndFlow,
  logCodeAgentQaEvent,
  type CodeAgentEndToEndStep,
} from "@/lib/code-agent-qa";

export const Route = createFileRoute("/_authenticated/code-agent-qa")({
  head: () => ({
    meta: [
      { title: "Code Agent QA — Brain Hub" },
      {
        name: "description",
        content:
          "Console QA end-to-end per i Code Agent Jobs: lifecycle, job bloccati, incoerenze, audit, runner readiness, flusso manuale. Read-only.",
      },
    ],
  }),
  component: CodeAgentQaPage,
});

function CodeAgentQaPage() {
  const [brainId, setBrainId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    void logCodeAgentQaEvent("code_agent_qa_opened", {});
    void logCodeAgentQaEvent("code_agent_e2e_qa_viewed", { brainId });
  }, [brainId]);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-list-qa"],
    queryFn: async () => {
      const { data } = await supabase.from("brains").select("id,name").order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const summary = useQuery({
    queryKey: ["caj-qa-summary", brainId],
    queryFn: () => getCodeAgentQaSummary(brainId),
  });
  const checklist = useQuery({
    queryKey: ["caj-qa-checklist", brainId],
    queryFn: () => getCodeAgentLifecycleChecklist(brainId),
  });
  const blocked = useQuery({
    queryKey: ["caj-qa-blocked", brainId],
    queryFn: () => getCodeAgentBlockedJobs(brainId),
  });
  const inconsistent = useQuery({
    queryKey: ["caj-qa-inconsistent", brainId],
    queryFn: () => getCodeAgentInconsistentJobs(brainId),
  });
  const nextSteps = useQuery({
    queryKey: ["caj-qa-next-steps", brainId],
    queryFn: () => getCodeAgentNextStepSuggestions(brainId),
  });
  const audit = useQuery({
    queryKey: ["caj-qa-audit", brainId],
    queryFn: () => getCodeAgentRecentAuditEvents(brainId, 10),
  });
  const readiness = useQuery({
    queryKey: ["caj-qa-readiness", brainId],
    queryFn: () => getCodeAgentRunnerReadiness(brainId),
  });
  const e2eSummary = useQuery({
    queryKey: ["caj-qa-e2e-summary", brainId],
    queryFn: () => getCodeAgentEndToEndSummary(brainId),
  });
  const recentJobs = useQuery({
    queryKey: ["caj-qa-recent-jobs", brainId],
    queryFn: async () => {
      const items = await listCodeAgentJobs({ brainId });
      return items.slice(0, 12);
    },
  });
  const flow = useQuery({
    queryKey: ["caj-qa-e2e-flow", selectedJobId],
    queryFn: () => (selectedJobId ? getCodeAgentEndToEndFlow(selectedJobId) : null),
    enabled: !!selectedJobId,
  });

  return (
    <div className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Code Agent QA</h1>
          <p className="text-sm text-muted-foreground">
            Vista QA end-to-end del ciclo Code Agent. Read-only: nessun job viene modificato,
            nessun runner reale viene attivato.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={brainId ?? "all"}
            onValueChange={(v) => setBrainId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tutti i brain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i brain</SelectItem>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link to="/code-agent-jobs">
              <ArrowRight className="mr-1 h-3 w-3" /> Jobs
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/github-operational">
              <ArrowRight className="mr-1 h-3 w-3" /> GitHub
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/result-review">
              <ArrowRight className="mr-1 h-3 w-3" /> Review
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/master-snapshot">
              <ArrowRight className="mr-1 h-3 w-3" /> Snapshot
            </Link>
          </Button>
        </div>
      </header>

      {/* E2E summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="h-4 w-4" /> Flusso end-to-end manuale
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Totali" value={e2eSummary.data?.total ?? 0} />
            <Tile
              label="Pronti per test manuale"
              value={e2eSummary.data?.ready_for_manual_test ?? 0}
            />
            <Tile
              label="Bloccati da repo"
              value={e2eSummary.data?.blocked_repository ?? 0}
              tone={(e2eSummary.data?.blocked_repository ?? 0) > 0 ? "amber" : undefined}
            />
            <Tile
              label="Bloccati da approval"
              value={e2eSummary.data?.blocked_approval ?? 0}
              tone={(e2eSummary.data?.blocked_approval ?? 0) > 0 ? "amber" : undefined}
            />
            <Tile
              label="Inviati senza risultato"
              value={e2eSummary.data?.sent_without_result ?? 0}
              tone={(e2eSummary.data?.sent_without_result ?? 0) > 0 ? "amber" : undefined}
            />
            <Tile
              label="Result senza review"
              value={e2eSummary.data?.result_without_review ?? 0}
              tone={(e2eSummary.data?.result_without_review ?? 0) > 0 ? "amber" : undefined}
            />
            <Tile
              label="Pronti per snapshot"
              value={e2eSummary.data?.ready_for_snapshot ?? 0}
            />
            <Tile label="Completati" value={e2eSummary.data?.completed ?? 0} />
          </div>
        </CardContent>
      </Card>

      {/* Test manuale consigliato */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListChecks className="h-4 w-4" /> Test manuale consigliato
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="ml-5 list-decimal space-y-1">
            <li>Crea un Code Agent Job semplice.</li>
            <li>Seleziona repository <code>brain-hub</code>.</li>
            <li>Verifica che lo stato diventi <code>ready</code>.</li>
            <li>Copia il prompt Codex/Claude.</li>
            <li>Segna il job come inviato manualmente.</li>
            <li>Incolla un risultato di test.</li>
            <li>Crea la Result Review.</li>
            <li>Crea Next Action o Master Snapshot draft se consentito.</li>
          </ol>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            Nessun dato finto viene creato automaticamente. Nessun comando viene inviato. Nessuna
            chiamata Codex/Claude. Nessun commit/push/PR/deploy. Nessun invio Telegram automatico.
          </p>
        </CardContent>
      </Card>

      {/* Recent jobs + E2E flow inspector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Job recenti (seleziona per ispezionare il flusso)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(recentJobs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun job recente.</p>
          ) : (
            <ul className="space-y-1">
              {(recentJobs.data ?? []).map((j) => (
                <li key={j.id}>
                  <button
                    onClick={() => {
                      setSelectedJobId(j.id);
                      void logCodeAgentQaEvent(
                        "code_agent_e2e_job_checked",
                        { status: j.status, risk: j.risk_level },
                        j.id,
                      );
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted/30 ${
                      selectedJobId === j.id ? "border-primary" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Badge variant="outline">{j.status}</Badge>
                      <Badge variant="outline">risk:{j.risk_level}</Badge>
                      <span className="truncate">
                        {(j.command_text ?? "").slice(0, 80) || `Job ${j.id.slice(0, 8)}`}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(j.created_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedJobId && flow.data && (
            <div className="mt-4 rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{flow.data.jobTitle}</div>
                <Badge
                  variant={
                    flow.data.overall === "completed"
                      ? "default"
                      : flow.data.overall === "ready_for_manual_test"
                        ? "secondary"
                        : flow.data.overall === "blocked" || flow.data.overall === "failed"
                          ? "destructive"
                          : "outline"
                  }
                >
                  {flow.data.overall}
                </Badge>
              </div>
              <ul className="space-y-1">
                {flow.data.steps.map((s) => (
                  <StepRow key={s.id} step={s} />
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>



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

function StepRow({ step }: { step: CodeAgentEndToEndStep }) {
  const Icon =
    step.status === "done"
      ? CheckCircle2
      : step.status === "blocked"
        ? XCircle
        : step.status === "warning"
          ? AlertTriangle
          : Circle;
  const cls =
    step.status === "done"
      ? "text-emerald-500"
      : step.status === "blocked"
        ? "text-rose-500"
        : step.status === "warning"
          ? "text-amber-500"
          : "text-muted-foreground";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 ${cls}`} />
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <span>{step.label}</span>
          {step.nextActionLabel && step.nextActionTarget && (
            <Button asChild size="sm" variant="ghost">
              <Link to={step.nextActionTarget}>{step.nextActionLabel}</Link>
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{step.reason}</div>
      </div>
    </li>
  );
}
