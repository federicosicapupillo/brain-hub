import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ExternalLink,
  GitBranch,
  XCircle,
} from "lucide-react";
import {
  LoopStep,
  LoopWarning,
  LoopChainNode,
  LoopMultiChain,
  getLoopQaSummary,
  logLoopQaEvent,
  groupLoopWarnings,
  type LoopWarningArea,
} from "@/lib/loop-qa";
import { useServerFn } from "@tanstack/react-start";
import { getN8nHmacWarnings } from "@/lib/n8n-hmac.functions";
import {
  buildOperationalRemediationPlan,
  createRemediationActionForItem,
  REMEDIATION_AREA_LABEL,
  REMEDIATION_SEVERITY_LABEL,
  REMEDIATION_STATUS_LABEL,
  type RemediationItem,
  type RemediationStatus,
} from "@/lib/loop-remediation";

export const Route = createFileRoute("/_authenticated/loop-qa")({
  head: () => ({
    meta: [
      { title: "Loop QA — Brain Hub" },
      {
        name: "description",
        content:
          "Validazione end-to-end del ciclo operativo Brain Hub: action → review → learning loop → knowledge → roadmap → next prompt.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: LoopQaRoute,
});

type BrainRow = { id: string; name: string };

function LoopQaRoute() {
  const { brain } = useSearch({ from: "/_authenticated/loop-qa" });
  const navigate = useNavigate();
  const [brainId, setBrainId] = useState<string | null>(brain ?? null);

  useEffect(() => {
    void logLoopQaEvent("loop_qa_viewed", "Pagina Loop QA aperta", { brain_id: brainId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min-loopqa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brains").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ["loop-qa-summary", brainId],
    queryFn: () => getLoopQaSummary(brainId),
  });

  const hmacWarningsFn = useServerFn(getN8nHmacWarnings);
  const { data: hmacExtra } = useQuery({
    queryKey: ["loop-qa-hmac-warnings", brainId],
    queryFn: () => hmacWarningsFn({ data: { brain_id: brainId } }),
  });
  const mergedWarnings: LoopWarning[] = [
    ...(summary?.warnings ?? []),
    ...((hmacExtra?.warnings ?? []) as LoopWarning[]),
  ];

  const openSection = (to: string, label: string) => {
    void logLoopQaEvent("loop_qa_related_section_opened", `Apertura sezione: ${label}`, { to });
    navigate({ to: to as "/action-queue", search: {} as never });
  };

  const healthTone =
    summary?.health === "healthy"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : summary?.health === "warning"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-orange-500/10 text-orange-600 border-orange-500/30";

  const healthLabel =
    summary?.health === "healthy"
      ? "Ciclo sano"
      : summary?.health === "warning"
        ? "Ciclo con warning"
        : "Ciclo incompleto";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loop QA"
        subtitle="Valida il ciclo operativo Brain Hub end-to-end. Pagina read-only: nessuna automazione viene eseguita."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={brainId ?? "all"} onValueChange={(v) => setBrainId(v === "all" ? null : v)}>
          <SelectTrigger className="w-64">
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
        {summary && (
          <Badge variant="outline" className={healthTone}>
            {healthLabel}
          </Badge>
        )}
      </div>

      {isLoading || !summary ? (
        <p className="text-sm text-muted-foreground">Caricamento ciclo…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Actions" value={summary.counters.actions} />
            <Tile label="Reviews" value={summary.counters.reviews} />
            <Tile label="Suggerimenti" value={summary.counters.suggestions} />
            <Tile label="Suggerimenti applicati" value={summary.counters.suggestionsApplied} />
            <Tile label="Note knowledge (loop)" value={summary.counters.knowledgeNotes} />
            <Tile label="Roadmap updates pending" value={summary.counters.roadmapUpdateActions} />
            <Tile label="Next prompts generati" value={summary.counters.nextPromptCreated} />
          </div>

          <RemediationPlanCard brainId={brainId} />



          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ciclo operativo — checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.steps.map((s) => (
                <StepRow key={s.id} step={s} onOpen={openSection} />
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4" /> Warning intelligenti per area
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {mergedWarnings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessun warning rilevato.</p>
                ) : (
                  (() => {
                    const grouped = groupLoopWarnings(mergedWarnings);
                    const order: LoopWarningArea[] = [
                      "code_agent",
                      "github_registry",
                      "master_snapshot",
                      "automation_n8n",
                      "telegram",
                      "drive_calendar_gmail",
                      "jack",
                      "general",
                    ];
                    const labels: Record<LoopWarningArea, string> = {
                      code_agent: "Code Agent",
                      github_registry: "GitHub Registry",
                      master_snapshot: "Master Snapshot",
                      automation_n8n: "Automation / n8n",
                      telegram: "Telegram",
                      drive_calendar_gmail: "Drive / Calendar / Gmail",
                      jack: "Jack",
                      general: "General",
                    };
                    return order
                      .filter((a) => grouped[a].length > 0)
                      .map((a) => (
                        <div key={a} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {labels[a]}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {grouped[a].length} warning
                            </span>
                          </div>
                          {grouped[a].map((w) => (
                            <WarningRow
                              key={w.id}
                              w={w}
                              onOpen={(to, label) => {
                                void logLoopQaEvent(
                                  "loop_qa_warning_opened",
                                  `Warning aperto: ${w.title}`,
                                  { warning_id: w.id, area: a, to },
                                );
                                openSection(to, label);
                              }}
                            />
                          ))}
                        </div>
                      ));
                  })()
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4" /> Ultimi cicli operativi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.chains.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nessun ciclo recente. Crea una action o una review per iniziare.
                  </p>
                ) : (
                  summary.chains.map((c) => (
                    <ChainCard key={c.id} chain={c} onOpen={openSection} />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <CompanyOsRow brainId={brainId} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sezioni collegate</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/action-queue" search={{}}>
                  Action Queue
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/result-review" search={{}}>
                  Result Review
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/knowledge-map" search={{}}>
                  Knowledge Map
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/telegram-approvals" search={{}}>
                  Telegram Approvals
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/operating-dashboard" search={{}}>
                  Operating Dashboard
                </Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StepRow({
  step,
  onOpen,
}: {
  step: LoopStep;
  onOpen: (to: string, label: string) => void;
}) {
  const Icon =
    step.status === "ok"
      ? CheckCircle2
      : step.status === "warning"
        ? AlertTriangle
        : step.status === "na"
          ? Circle
          : XCircle;
  const tone =
    step.status === "ok"
      ? "text-emerald-600"
      : step.status === "warning"
        ? "text-amber-600"
        : step.status === "na"
          ? "text-muted-foreground"
          : "text-orange-600";
  return (
    <div className="flex items-center justify-between gap-3 rounded border p-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{step.label}</div>
          <div className="text-xs text-muted-foreground">
            {step.count} elementi
            {step.lastAt ? ` · ultimo: ${new Date(step.lastAt).toLocaleString()}` : ""}
          </div>
        </div>
      </div>
      {step.cta && (
        <Button size="sm" variant="ghost" onClick={() => onOpen(step.cta!.to, step.cta!.label)}>
          <ExternalLink className="mr-1 h-3 w-3" />
          {step.cta.label}
        </Button>
      )}
    </div>
  );
}

function WarningRow({
  w,
  onOpen,
}: {
  w: LoopWarning;
  onOpen: (to: string, label: string) => void;
}) {
  const tone =
    w.level === "error"
      ? "border-red-500/30 bg-red-500/5"
      : w.level === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border bg-muted/20";
  return (
    <div className={`rounded border p-2 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {w.category && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {w.category}
              </Badge>
            )}
            <div className="text-sm font-medium">{w.title}</div>
          </div>
          <div className="text-xs text-muted-foreground">{w.description}</div>
        </div>
        {w.cta && (
          <Button size="sm" variant="ghost" onClick={() => onOpen(w.cta!.to, w.cta!.label)}>
            <ExternalLink className="mr-1 h-3 w-3" />
            {w.cta.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function ChainNodeRow({ node }: { node: LoopChainNode }) {
  const label =
    node.kind === "action"
      ? "Action"
      : node.kind === "review"
        ? "Review"
        : node.kind === "suggestion"
          ? "Suggerimento"
          : node.kind === "knowledge"
            ? "Knowledge note"
            : node.kind === "automation_action"
              ? "Action (loop)"
              : node.kind === "telegram"
                ? "Telegram"
                : "Next prompt";
  const title =
    node.kind === "next_prompt"
      ? (node.preview.slice(0, 80) || "Prompt generato")
      : node.kind === "telegram"
        ? `Approval ${node.id.slice(0, 6)}`
        : (node as { title?: string }).title ?? "—";
  const status = "status" in node ? (node as { status?: string }).status : undefined;
  return (
    <div className="flex items-center gap-2 rounded border bg-background/40 p-2 text-xs">
      <Badge variant="outline" className="shrink-0">
        {label}
      </Badge>
      <div className="min-w-0 flex-1 truncate font-medium">{title}</div>
      {status && (
        <Badge variant="outline" className="shrink-0">
          {status}
        </Badge>
      )}
      <div className="shrink-0 text-muted-foreground">
        {new Date(node.created_at).toLocaleDateString()}
      </div>
    </div>
  );
}

function ChainCard({
  chain,
  onOpen,
}: {
  chain: LoopMultiChain;
  onOpen: (to: string, label: string) => void;
}) {
  const createdLabel =
    chain.createdObjectKind === "knowledge"
      ? "Knowledge note"
      : chain.createdObjectKind === "automation_action"
        ? "Action"
        : chain.createdObjectKind === "next_prompt"
          ? "Next prompt"
          : null;
  const hasTelegram = chain.nodes.some((n) => n.kind === "telegram");
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{chain.title || "Ciclo"}</div>
        {chain.reviewStatus && (
          <Badge variant="outline" className="shrink-0">
            review: {chain.reviewStatus}
          </Badge>
        )}
        <Badge variant="outline" className="shrink-0">
          {chain.suggestionsCount} sugg.
        </Badge>
        {createdLabel && (
          <Badge variant="outline" className="shrink-0">
            → {createdLabel}
          </Badge>
        )}
        <div className="shrink-0 text-xs text-muted-foreground">
          {new Date(chain.createdAt).toLocaleString()}
        </div>
      </div>
      <div className="space-y-1">
        {chain.nodes.map((n, i) => (
          <ChainNodeRow key={i} node={n} />
        ))}
      </div>
      {chain.stopStep && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <span className="font-medium text-amber-700">Si è fermato qui:</span>{" "}
          <span className="text-amber-700/90">{chain.stopStep}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {chain.reviewId && (
          <Button size="sm" variant="ghost" onClick={() => onOpen("/result-review", "Result Review")}>
            Apri Result Review
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onOpen("/action-queue", "Action Queue")}>
          Action Queue
        </Button>
        {chain.createdObjectKind === "knowledge" && (
          <Button size="sm" variant="ghost" onClick={() => onOpen("/knowledge-map", "Knowledge Map")}>
            Knowledge Map
          </Button>
        )}
        {hasTelegram && (
          <Button size="sm" variant="ghost" onClick={() => onOpen("/telegram-approvals", "Telegram Approvals")}>
            Telegram Approvals
          </Button>
        )}
      </div>
    </div>
  );
}

function CompanyOsRow({ brainId }: { brainId: string | null }) {
  const { data: summary } = useQuery({
    queryKey: ["company-os-loop-qa-row", brainId],
    queryFn: async () => {
      const { getCompanyOsSummary } = await import("@/lib/company-os");
      return getCompanyOsSummary(brainId);
    },
  });
  const configured = !!summary?.configured;
  const tone = configured
    ? "border-emerald-500/30 bg-emerald-500/5"
    : "border-amber-500/30 bg-amber-500/5";
  const onOpen = async () => {
    const { logCompanyOsEvent } = await import("@/lib/company-os");
    void logCompanyOsEvent(
      "company_os_opened_from_loop_qa",
      "Apertura Company OS da Loop QA",
      { brain_id: brainId },
    );
  };
  return (
    <div className={`rounded border p-3 text-sm ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            Company OS configurato: <span>{configured ? "Sì" : "No"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {configured
              ? summary?.companyName
                ? `Azienda: ${summary.companyName}`
                : "Profilo aziendale presente"
              : "Informativo — non influisce sulla salute del ciclo."}
          </div>
        </div>
        <Button asChild size="sm" variant="outline" onClick={onOpen}>
          <Link to="/company-os" search={{}}>
            {configured ? "Apri Company OS" : "Configura Company OS"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

type RemediationFilter = "all" | "open" | "with_action" | "closed";

function RemediationPlanCard({ brainId }: { brainId: string | null }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<RemediationFilter>("all");
  const { data: plan, isLoading } = useQuery({
    queryKey: ["loop-remediation-plan", brainId],
    queryFn: () => buildOperationalRemediationPlan(brainId),
  });

  async function handleCreateAction(item: RemediationItem) {
    void logLoopQaEvent("loop_remediation_item_viewed", "Item remediation aperto", {
      brain_id: brainId,
      warning_id: item.warning_id,
      area: item.area,
      severity: item.severity,
    });
    const res = await createRemediationActionForItem(item, brainId);
    if (!res.ok) {
      toast.error(`Errore creazione azione: ${res.error}`);
      return;
    }
    if (res.deduplicated) toast.info("Azione già presente in Action Queue.");
    else toast.success("Azione suggerita creata in Action Queue.");
    await qc.invalidateQueries({ queryKey: ["loop-remediation-plan", brainId] });
  }

  function handleCtaOpen(item: RemediationItem) {
    void logLoopQaEvent("loop_remediation_cta_opened", "CTA remediation aperta", {
      brain_id: brainId,
      warning_id: item.warning_id,
      area: item.area,
      to: item.cta_href,
    });
  }

  if (isLoading || !plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Piano di correzione consigliato</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Calcolo piano…</p>
        </CardContent>
      </Card>
    );
  }

  if (plan.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Piano di correzione consigliato</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nessun warning attivo. Sistema in stato sano.
          </p>
        </CardContent>
      </Card>
    );
  }

  const matchesFilter = (it: RemediationItem): boolean => {
    if (filter === "all") return true;
    if (filter === "open") return it.status === "open" || it.status === "regressed";
    if (filter === "with_action")
      return it.status === "action_created" || it.status === "action_in_progress";
    if (filter === "closed")
      return it.status === "resolved" || it.status === "action_completed" || it.status === "regressed";
    return true;
  };
  const filtered = plan.items.filter(matchesFilter).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Piano di correzione consigliato</span>
          <span className="flex flex-wrap gap-1 text-xs font-normal text-muted-foreground">
            <Badge variant="outline">{plan.open} aperte</Badge>
            <Badge variant="outline">
              {plan.action_created + plan.action_in_progress} con action
            </Badge>
            <Badge variant="outline">{plan.action_completed} completate</Badge>
            <Badge variant="outline">{plan.resolved} risolte</Badge>
            {plan.regressed > 0 && (
              <Badge variant="outline" className="border-red-500/30 text-red-600">
                {plan.regressed} riemerse
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.next && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline">Prossimo intervento</Badge>
              <Badge variant="outline">{REMEDIATION_AREA_LABEL[plan.next.area]}</Badge>
              <SeverityBadge severity={plan.next.severity} />
              <StatusBadge status={plan.next.status} />
            </div>
            <div className="mt-1 text-sm font-medium">{plan.next.title}</div>
            <div className="text-xs text-muted-foreground">{plan.next.explanation}</div>
            <div className="mt-1 text-xs">
              <span className="font-medium">Perché conta: </span>
              {plan.next.why_it_matters}
            </div>
            <div className="mt-1 text-xs">
              <span className="font-medium">Azione: </span>
              {plan.next.recommended_action}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild size="sm" onClick={() => handleCtaOpen(plan.next!)}>
                <a href={plan.next.cta_href}>{plan.next.cta_label}</a>
              </Button>
              {plan.next.can_create_action && (
                <Button size="sm" variant="outline" onClick={() => handleCreateAction(plan.next!)}>
                  Crea azione suggerita
                </Button>
              )}
              {plan.next.linked_action_id && (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/action-queue" search={{}}>Apri Action Queue</Link>
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1 text-[11px]">
          {(["all", "open", "with_action", "closed"] as RemediationFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "Tutte"
                : f === "open"
                  ? "Aperte"
                  : f === "with_action"
                    ? "Con action"
                    : "Risolte/Riapparse"}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map((it) => (
            <RemediationRow
              key={it.id}
              item={it}
              onCreate={() => handleCreateAction(it)}
              onCta={() => handleCtaOpen(it)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground">Nessun item per il filtro selezionato.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: RemediationStatus }) {
  const tone =
    status === "regressed"
      ? "border-red-500/30 text-red-600"
      : status === "open"
        ? "border-amber-500/30 text-amber-600"
        : status === "resolved" || status === "action_completed"
          ? "border-emerald-500/30 text-emerald-600"
          : "border-sky-500/30 text-sky-600";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {REMEDIATION_STATUS_LABEL[status]}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: "critical" | "warning" | "info" }) {
  const tone =
    severity === "critical"
      ? "bg-red-500/10 text-red-600 border-red-500/30"
      : severity === "warning"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-sky-500/10 text-sky-600 border-sky-500/30";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {REMEDIATION_SEVERITY_LABEL[severity]}
    </Badge>
  );
}

function RemediationRow({
  item,
  onCreate,
  onCta,
}: {
  item: RemediationItem;
  onCreate: () => void;
  onCta: () => void;
}) {
  return (
    <div className="rounded border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={item.severity} />
            <Badge variant="outline" className="text-[10px]">
              {REMEDIATION_AREA_LABEL[item.area]}
            </Badge>
            <StatusBadge status={item.status} />
            <div className="text-sm font-medium">{item.title}</div>
          </div>
          <div className="text-xs text-muted-foreground">{item.explanation}</div>
          <div className="text-xs mt-1">
            <span className="font-medium">Perché conta: </span>
            {item.why_it_matters}
          </div>
          <div className="text-xs">
            <span className="font-medium">Azione consigliata: </span>
            {item.recommended_action}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button asChild size="sm" variant="ghost" onClick={onCta}>
            <a href={item.cta_href}>
              <ExternalLink className="mr-1 h-3 w-3" />
              {item.cta_label}
            </a>
          </Button>
          {item.can_create_action && (
            <Button size="sm" variant="outline" onClick={onCreate}>
              Crea azione
            </Button>
          )}
          {item.linked_action_id && (
            <Button asChild size="sm" variant="ghost">
              <Link to="/action-queue" search={{}}>Apri Action Queue</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
