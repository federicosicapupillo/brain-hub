import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  HeartPulse,
  Link2,
  ListChecks,
  Send,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { LogEventType } from "@/lib/automation-run";
import { enqueueFromCta, type CtaContext } from "@/lib/action-queue-cta";
import type { ActionType, RiskLevel } from "@/lib/action-queue";

async function logEvent(action: LogEventType, notes: string, metadata: Record<string, unknown>) {
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

type PEL = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  prompt_title: string;
  result_type: string | null;
  result_text: string | null;
  roadmap_item_id: string | null;
  parent_execution_log_id: string | null;
};

type RoadmapItem = {
  id: string;
  title: string;
  status: string;
};

type HealthStatus = "healthy" | "needs_attention" | "blocked" | "incomplete" | "unknown";

const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Sano",
  needs_attention: "Da controllare",
  blocked: "Bloccato",
  incomplete: "Incompleto",
  unknown: "Stato sconosciuto",
};

const STATUS_TONE: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  needs_attention: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  blocked: "bg-red-500/10 text-red-600 border-red-500/30",
  incomplete: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

type Issue = {
  id: string;
  label: string;
  cta?: { label: string; to?: string; onClick?: () => void; icon?: React.ReactNode };
};

type NextAction = {
  label: string;
  hint: string;
  to?: string;
  icon?: React.ReactNode;
};

export function ProjectHealthCheck({ brainId }: { brainId: string }) {
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  async function enqueueAndGo(
    action_type: ActionType,
    title: string,
    cta_label: string,
    risk_level: RiskLevel,
    extra: Partial<CtaContext> = {},
  ) {
    try {
      const { duplicated } = await enqueueFromCta({
        source: "project_health_check",
        source_block: "ProjectHealthCheck",
        source_cta: cta_label,
        action_type,
        title,
        risk_level,
        brain_id: brainId,
        ...extra,
      });
      toast.success(
        duplicated
          ? "Azione già in coda — duplicato evitato"
          : "Azione aggiunta alla Action Queue",
        {
          action: {
            label: "Apri Action Queue",
            onClick: () => void navigate({ to: "/action-queue" }),
          },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore enqueue azione");
    }
  }


  const { data: logs = [] } = useQuery<PEL[]>({
    queryKey: ["phc-pels", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_execution_logs")
        .select(
          "id,created_at,updated_at,status,prompt_title,result_type,result_text,roadmap_item_id,parent_execution_log_id",
        )
        .eq("brain_id", brainId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PEL[];
    },
  });

  const { data: roadmap = [] } = useQuery<RoadmapItem[]>({
    queryKey: ["phc-roadmap", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .select("id,title,status")
        .eq("brain_id", brainId);
      if (error) throw error;
      return (data ?? []) as RoadmapItem[];
    },
  });

  const analysis = useMemo(() => {
    const failed = logs.filter((l) => l.status === "failed");
    const pending = logs.filter((l) => l.status === "result_pending");
    const nextReady = logs.filter(
      (l) =>
        l.parent_execution_log_id &&
        (l.status === "draft" || l.status === "prepared"),
    );
    const unlinked = logs.filter((l) => !l.roadmap_item_id);
    const linkedIds = new Set(logs.map((l) => l.roadmap_item_id).filter(Boolean));
    const roadmapNoPrompts = roadmap.filter((r) => !linkedIds.has(r.id) && r.status !== "completed");
    const noRoadmap = roadmap.length === 0;
    const noData = logs.length === 0 && roadmap.length === 0;

    const critical: Issue[] = [];
    const warnings: Issue[] = [];
    const incomplete: Issue[] = [];

    if (failed.length > 0)
      critical.push({
        id: "failed",
        label: `${failed.length} prompt falliti da correggere`,
        cta: { label: "Genera fix prompt", to: "/automation-control", icon: <Wrench className="h-3 w-3" /> },
      });
    if (pending.length > 0)
      warnings.push({
        id: "pending",
        label: `${pending.length} risultati Lovable da salvare/verificare`,
        cta: { label: "Salva risultato", to: "/automation-control", icon: <CheckCircle2 className="h-3 w-3" /> },
      });
    if (nextReady.length > 0)
      warnings.push({
        id: "next_ready",
        label: `${nextReady.length} next prompt pronti ma non inviati`,
        cta: { label: "Invia next prompt", to: "/automation-control", icon: <Send className="h-3 w-3" /> },
      });
    if (unlinked.length > 0 && roadmap.length > 0)
      warnings.push({
        id: "unlinked",
        label: `${unlinked.length} prompt scollegati dalla roadmap`,
        cta: { label: "Collega alla roadmap", to: "/automation-control", icon: <Link2 className="h-3 w-3" /> },
      });
    if (noRoadmap)
      incomplete.push({
        id: "no_roadmap",
        label: "Manca una roadmap per questo progetto",
        cta: { label: "Crea roadmap", to: "/roadmap", icon: <ListChecks className="h-3 w-3" /> },
      });
    if (roadmapNoPrompts.length > 0)
      incomplete.push({
        id: "roadmap_no_prompts",
        label: `${roadmapNoPrompts.length} punti roadmap senza prompt operativo`,
        cta: { label: "Genera primo prompt", to: "/automation-control", icon: <Sparkles className="h-3 w-3" /> },
      });
    if (logs.length === 0 && !noRoadmap)
      incomplete.push({ id: "no_logs", label: "Nessun execution log presente" });

    let status: HealthStatus = "healthy";
    if (noData) status = "unknown";
    else if (failed.length > 0) status = "blocked";
    else if (pending.length > 0 || nextReady.length > 0 || unlinked.length > 0) status = "needs_attention";
    else if (incomplete.length > 0) status = "incomplete";

    // Score
    let score = 100;
    score -= failed.length * 18;
    score -= pending.length * 8;
    score -= nextReady.length * 5;
    score -= unlinked.length * 3;
    score -= roadmapNoPrompts.length * 6;
    if (noRoadmap) score -= 25;
    if (noData) score = 0;
    score = Math.max(0, Math.min(100, score));

    // Next action — single priority
    let next: NextAction;
    if (failed.length > 0)
      next = { label: "Genera prompt di correzione", hint: "Hai prompt falliti da risolvere", to: "/automation-control", icon: <Wrench className="h-4 w-4" /> };
    else if (pending.length > 0)
      next = { label: "Salva/verifica risultato Lovable", hint: "Ci sono risultati in attesa", to: "/automation-control", icon: <CheckCircle2 className="h-4 w-4" /> };
    else if (nextReady.length > 0)
      next = { label: "Invia next prompt", hint: "Next prompt pronti ma non inviati", to: "/automation-control", icon: <Send className="h-4 w-4" /> };
    else if (noRoadmap)
      next = { label: "Crea/importa roadmap", hint: "Manca una roadmap per il progetto", to: "/roadmap", icon: <ListChecks className="h-4 w-4" /> };
    else if (roadmapNoPrompts.length > 0)
      next = { label: "Genera primo prompt", hint: "Roadmap item senza prompt operativo", to: "/automation-control", icon: <Sparkles className="h-4 w-4" /> };
    else if (unlinked.length > 0)
      next = { label: "Collega log alla roadmap", hint: "Ci sono prompt scollegati", to: "/automation-control", icon: <Link2 className="h-4 w-4" /> };
    else if (noData)
      next = { label: "Inizia da una roadmap o un prompt", hint: "Nessun dato disponibile per ora", to: "/roadmap", icon: <Sparkles className="h-4 w-4" /> };
    else
      next = { label: "Passa al prossimo obiettivo", hint: "Il progetto sembra ordinato", to: "/automation-control", icon: <CheckCircle2 className="h-4 w-4" /> };

    return { status, score, critical, warnings, incomplete, next, noData };
  }, [logs, roadmap]);

  // Fire-and-forget event log on first compute per brain
  useEffect(() => {
    if (!brainId) return;
    void logEvent("project_health_check_completed", `Health: ${analysis.status} (${analysis.score})`, {
      brain_id: brainId,
      health_score: analysis.score,
      health_status: analysis.status,
      criticals: analysis.critical.length,
      warnings: analysis.warnings.length,
      incomplete: analysis.incomplete.length,
    });
    void logEvent("project_health_next_action_suggested", analysis.next.label, {
      brain_id: brainId,
      action: analysis.next.label,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainId, analysis.status, analysis.score]);

  const recent = useMemo(() => logs.slice(0, 5), [logs]);

  const visibleIssues = (list: Issue[]) => list.filter((i) => !ignored.has(i.id));

  function ignore(id: string) {
    setIgnored((s) => new Set(s).add(id));
    void logEvent("project_health_warning_ignored", `Warning ignorato: ${id}`, {
      brain_id: brainId,
      issue_id: id,
    });
    toast("Warning ignorato per questa sessione");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4" /> Project Health Check
            <Badge variant="outline" className="text-[10px]">v0.6</Badge>
          </CardTitle>
          <Badge className={`border ${STATUS_TONE[analysis.status]}`} variant="outline">
            {STATUS_LABEL[analysis.status]} · {analysis.score}/100
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health bar */}
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <div
            className={
              analysis.score >= 90
                ? "h-full bg-emerald-500"
                : analysis.score >= 70
                  ? "h-full bg-amber-500"
                  : analysis.score >= 40
                    ? "h-full bg-sky-500"
                    : "h-full bg-red-500"
            }
            style={{ width: `${analysis.score}%` }}
          />
        </div>

        {/* Next action */}
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkles className="h-3 w-3" /> Prossima azione consigliata
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{analysis.next.label}</div>
              <div className="text-[11px] text-muted-foreground">{analysis.next.hint}</div>
            </div>
            {analysis.next.to && (
              <Button asChild size="sm">
                <Link to={analysis.next.to}>
                  {analysis.next.icon}
                  <span className="ml-1">Vai</span>
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Issues grid */}
        <div className="grid gap-3 md:grid-cols-3">
          <IssueColumn
            title="Problemi critici"
            tone="red"
            icon={<XCircle className="h-3 w-3" />}
            issues={visibleIssues(analysis.critical)}
            onIgnore={ignore}
            emptyLabel="Nessun problema critico"
          />
          <IssueColumn
            title="Warning"
            tone="amber"
            icon={<AlertTriangle className="h-3 w-3" />}
            issues={visibleIssues(analysis.warnings)}
            onIgnore={ignore}
            emptyLabel="Nessun warning"
          />
          <IssueColumn
            title="Incompletezze"
            tone="sky"
            icon={<ListChecks className="h-3 w-3" />}
            issues={visibleIssues(analysis.incomplete)}
            onIgnore={ignore}
            emptyLabel="Nulla da completare"
          />
        </div>

        {/* Recent activity */}
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Activity className="h-3 w-3" /> Ultime attività
          </div>
          {recent.length === 0 ? (
            <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Nessuna attività recente
            </div>
          ) : (
            <ul className="space-y-1">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/40 px-2 py-1.5 text-xs"
                >
                  <span className="truncate">{r.prompt_title}</span>
                  <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <Link to="/automation-control">Apri Roadmap Intelligence</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/roadmap">Vai a Roadmap</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IssueColumn({
  title,
  tone,
  icon,
  issues,
  onIgnore,
  emptyLabel,
}: {
  title: string;
  tone: "red" | "amber" | "sky";
  icon: React.ReactNode;
  issues: Issue[];
  onIgnore: (id: string) => void;
  emptyLabel: string;
}) {
  const toneClass =
    tone === "red"
      ? "border-red-500/30 bg-red-500/5"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-sky-500/30 bg-sky-500/5";
  return (
    <div className={`rounded-md border ${toneClass} p-2`}>
      <div className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
        {icon} {title}
      </div>
      {issues.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">{emptyLabel}</div>
      ) : (
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <li key={i.id} className="rounded bg-background/60 p-1.5">
              <div className="text-xs">{i.label}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {i.cta?.to && (
                  <Button asChild size="sm" variant="outline" className="h-6 text-[10px]">
                    <Link to={i.cta.to}>
                      {i.cta.icon}
                      <span className="ml-1">{i.cta.label}</span>
                    </Link>
                  </Button>
                )}
                {i.cta?.onClick && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    onClick={i.cta.onClick}
                  >
                    {i.cta.icon}
                    <span className="ml-1">{i.cta.label}</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => onIgnore(i.id)}
                >
                  Ignora
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
