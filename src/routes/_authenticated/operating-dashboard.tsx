import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { ProjectHealthCheck } from "@/components/ProjectHealthCheck";
import { AutomationControlBlock } from "@/components/AutomationControlBlock";
import { RunbooksBlock } from "@/components/RunbooksBlock";
import { ToolConnectionsBlock } from "@/components/ToolConnectionsBlock";
import { KnowledgeMapBlock } from "@/components/KnowledgeMapBlock";
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
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Layers,
  LayoutDashboard,
  Map as MapIcon,
  Play,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  ACTION_TYPE_LABEL,
  AutomationAction,
  RISK_TONE,
  STATUS_LABEL,
  listActions,
} from "@/lib/action-queue";
import { summarizeReadiness } from "@/lib/automation-readiness";
import {
  RUNBOOK_STATUS_LABEL,
  RUNBOOK_STATUS_TONE,
  RunbookInstance,
  listRunbookInstances,
} from "@/lib/runbooks";
import { loadConfigForBrain, PRESETS } from "@/lib/project-console";
import {
  APPROVAL_STATUS_LABEL,
  APPROVAL_STATUS_TONE,
  listApprovalRequests,
  summarizeApprovals,
} from "@/lib/telegram-approvals";

export const Route = createFileRoute("/_authenticated/operating-dashboard")({
  head: () => ({
    meta: [
      { title: "Operating Dashboard — Brain Hub" },
      {
        name: "description",
        content:
          "Cabina di comando operativa: stato progetto, prossima azione, Action Queue, Runbooks, Roadmap ed Execution in sintesi.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    brain: typeof s.brain === "string" ? s.brain : undefined,
  }),
  component: OperatingDashboardRoute,
});

type BrainRow = { id: string; name: string; color: string };
type PEL = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  prompt_title: string;
  result_type: string | null;
  roadmap_item_id: string | null;
};
type RM = { id: string; title: string; status: string };
type Tool = {
  id: string;
  tool_name: string;
  url: string | null;
  connection_status: string | null;
};
type LogRow = {
  id: string;
  action: string;
  notes: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function OperatingDashboardRoute() {
  const search = useSearch({ from: "/_authenticated/operating-dashboard" });
  const navigate = useNavigate();

  const { data: brains = [] } = useQuery({
    queryKey: ["brains-min"],
    queryFn: async (): Promise<BrainRow[]> => {
      const { data, error } = await supabase
        .from("brains")
        .select("id,name,color")
        .order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const [brainId, setBrainId] = useState<string>(search.brain ?? "");
  useEffect(() => {
    if (!brainId && brains.length > 0) setBrainId(brains[0].id);
  }, [brains, brainId]);
  useEffect(() => {
    if (brainId && brainId !== search.brain) {
      void navigate({ to: "/operating-dashboard", search: { brain: brainId }, replace: true });
    }
  }, [brainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: config } = useQuery({
    queryKey: ["operating-dashboard-config", brainId],
    enabled: !!brainId,
    queryFn: () => (brainId ? loadConfigForBrain(brainId) : Promise.resolve(null)),
  });

  const { data: actions = [] } = useQuery<AutomationAction[]>({
    queryKey: ["operating-dashboard-actions", brainId],
    enabled: !!brainId,
    queryFn: () => listActions({ brainId }),
  });

  const { data: instances = [] } = useQuery<RunbookInstance[]>({
    queryKey: ["operating-dashboard-runbooks", brainId],
    enabled: !!brainId,
    queryFn: () => listRunbookInstances({ brainId }),
  });

  const { data: pel = [] } = useQuery<PEL[]>({
    queryKey: ["operating-dashboard-pel", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_execution_logs")
        .select("id,created_at,updated_at,status,prompt_title,result_type,roadmap_item_id")
        .eq("brain_id", brainId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PEL[];
    },
  });

  const { data: roadmap = [] } = useQuery<RM[]>({
    queryKey: ["operating-dashboard-roadmap", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roadmap_items")
        .select("id,title,status")
        .eq("brain_id", brainId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RM[];
    },
  });

  const { data: tools = [] } = useQuery<Tool[]>({
    queryKey: ["operating-dashboard-tools", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_tool_links")
        .select("id,tool_name,url,connection_status")
        .eq("brain_id", brainId);
      if (error) throw error;
      return (data ?? []) as Tool[];
    },
  });

  const { data: logs = [] } = useQuery<LogRow[]>({
    queryKey: ["operating-dashboard-logs", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clipboard_execution_logs")
        .select("id,action,notes,created_at,metadata")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });

  const execStats = useMemo(() => {
    const pending = pel.filter((p) => p.status === "result_pending");
    const failed = pel.filter((p) => p.status === "failed");
    const saved = pel.filter((p) => p.status === "completed" || p.result_type);
    const nextPromptReady = pel.filter(
      (p) => p.status === "next_ready" || p.status === "draft",
    );
    return { pending, failed, saved, nextPromptReady, lastSent: pel[0] ?? null };
  }, [pel]);

  const roadmapStats = useMemo(() => {
    const linkedIds = new Set(pel.map((p) => p.roadmap_item_id).filter(Boolean));
    const inProgress = roadmap.filter((r) => r.status === "in_progress");
    const completed = roadmap.filter((r) => r.status === "completed");
    const blocked = roadmap.filter((r) => r.status === "blocked");
    const withoutPrompt = roadmap.filter(
      (r) => !linkedIds.has(r.id) && r.status !== "completed",
    );
    const next =
      inProgress[0] ??
      withoutPrompt[0] ??
      roadmap.find((r) => r.status !== "completed") ??
      null;
    return { inProgress, completed, blocked, withoutPrompt, next };
  }, [roadmap, pel]);

  const runbookStats = useMemo(() => {
    const active = instances.filter(
      (i) => i.status === "active" || i.status === "in_progress" || i.status === "waiting_approval",
    );
    const blocked = instances.filter((i) => i.status === "blocked");
    const completed = instances.filter((i) => i.status === "completed").slice(0, 3);
    return { active, blocked, completed, next: active[0] ?? null };
  }, [instances]);

  const actionStats = useMemo(() => {
    const pendingApproval = actions.filter(
      (a) => a.status === "pending_approval" || a.status === "suggested",
    );
    const highPending = pendingApproval.filter((a) => a.risk_level === "high");
    return {
      pendingApproval,
      highPending,
      approved: actions.filter((a) => a.status === "approved" || a.status === "ready_to_execute"),
      failed: actions.filter((a) => a.status === "failed"),
    };
  }, [actions]);

  // Priority next action (single)
  const priorityAction = useMemo(() => {
    if (actionStats.highPending[0]) {
      const a = actionStats.highPending[0];
      return {
        title: a.title,
        hint: `Azione high risk in attesa di approvazione — ${ACTION_TYPE_LABEL[a.action_type]}`,
        cta: { label: "Apri Action Queue", to: "/action-queue" as const, search: { brain: brainId } },
        tone: "red" as const,
      };
    }
    if (execStats.failed[0]) {
      return {
        title: `Correggi prompt fallito: ${execStats.failed[0].prompt_title}`,
        hint: "Prompt failed → genera fix prompt da Execution Tracking",
        cta: { label: "Apri Execution Tracking", to: "/clipboard-ai" as const, search: undefined },
        tone: "red" as const,
      };
    }
    if (execStats.pending[0]) {
      return {
        title: `Salva risultato: ${execStats.pending[0].prompt_title}`,
        hint: "Result pending → verifica e salva l'output Lovable",
        cta: { label: "Apri Execution Tracking", to: "/clipboard-ai" as const, search: undefined },
        tone: "amber" as const,
      };
    }
    if (runbookStats.blocked[0]) {
      return {
        title: `Runbook bloccato: ${runbookStats.blocked[0].title}`,
        hint: "Sblocca o cancella il runbook dalla pagina Runbooks",
        cta: { label: "Apri Runbooks", to: "/runbooks" as const, search: undefined },
        tone: "red" as const,
      };
    }
    if (actionStats.pendingApproval[0]) {
      const a = actionStats.pendingApproval[0];
      return {
        title: a.title,
        hint: `${ACTION_TYPE_LABEL[a.action_type]} — in attesa di approvazione`,
        cta: { label: "Apri Action Queue", to: "/action-queue" as const, search: { brain: brainId } },
        tone: "amber" as const,
      };
    }
    if (roadmapStats.withoutPrompt[0]) {
      return {
        title: `Genera primo prompt: ${roadmapStats.withoutPrompt[0].title}`,
        hint: "Roadmap item senza prompt collegato",
        cta: { label: "Apri Roadmap Intelligence", to: "/project-console" as const, search: undefined },
        tone: "sky" as const,
      };
    }
    if (roadmapStats.next) {
      return {
        title: `Prossimo step roadmap: ${roadmapStats.next.title}`,
        hint: "Progetto sano — continua con il prossimo item",
        cta: { label: "Apri Roadmap", to: "/roadmap" as const, search: undefined },
        tone: "sky" as const,
      };
    }
    return {
      title: "Nessuna azione prioritaria",
      hint: "Configura blocchi e priorità in Project Console",
      cta: { label: "Apri Project Console", to: "/project-console" as const, search: undefined },
      tone: "muted" as const,
    };
  }, [actionStats, execStats, runbookStats, roadmapStats, brainId]);

  const presetLabel = config?.preset && PRESETS[config.preset]?.label;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Operating Dashboard"
        subtitle="Cabina di comando operativa del progetto"
        actions={
          <>
            <Badge variant="outline" className="text-[10px]">v1.0</Badge>
            <Button asChild size="sm" variant="outline">
              <Link to="/company-home">
                Apri Home Azienda <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/project-console">
                Apri Project Console <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </>
        }
      />

      {/* Project selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={brainId} onValueChange={setBrainId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Seleziona progetto/cervello" />
            </SelectTrigger>
            <SelectContent>
              {brains.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {config?.project_priority && (
            <Badge variant="outline" className="text-xs">
              Priorità: {config.project_priority}
            </Badge>
          )}
          {presetLabel && (
            <Badge variant="secondary" className="text-xs">
              Preset: {presetLabel}
            </Badge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            {brains.find((b) => b.id === brainId)?.name ?? "—"}
          </div>
        </CardContent>
      </Card>

      {!brainId ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Seleziona un progetto per vedere la dashboard.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Priority action */}
          <Card
            className={
              priorityAction.tone === "red"
                ? "border-red-500/40 bg-red-500/5"
                : priorityAction.tone === "amber"
                ? "border-amber-500/40 bg-amber-500/5"
                : priorityAction.tone === "sky"
                ? "border-sky-500/40 bg-sky-500/5"
                : ""
            }
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" /> Prossima azione prioritaria
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-lg font-semibold">{priorityAction.title}</div>
                <div className="text-sm text-muted-foreground">{priorityAction.hint}</div>
              </div>
              <Button asChild>
                <Link to={priorityAction.cta.to} search={priorityAction.cta.search as never}>
                  {priorityAction.cta.label} <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Health */}
          <ProjectHealthCheck brainId={brainId} />

          {/* 4 snapshot cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            <AutomationControlBlock brainId={brainId} />
            <RunbooksBlock brainId={brainId} />
            <AutomationReadinessMini />
            <N8nControlledExecutionMini brainId={brainId} />
            <TelegramApprovalsMini brainId={brainId} />
            <ResultReviewMini brainId={brainId} />
            <LoopQaMini brainId={brainId} />
            <CompanyOsMini brainId={brainId} />
            <BuildEnginesMini brainId={brainId} />
            <MvpFactoryMini brainId={brainId} />



            {/* Roadmap snapshot */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <MapIcon className="h-4 w-4" /> Roadmap
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/roadmap">
                      Apri <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <Tile label="Totale" value={roadmap.length} />
                  <Tile label="In corso" value={roadmapStats.inProgress.length} />
                  <Tile label="Bloccati" value={roadmapStats.blocked.length} tone={roadmapStats.blocked.length > 0 ? "red" : undefined} />
                  <Tile label="Senza prompt" value={roadmapStats.withoutPrompt.length} />
                </div>
                {roadmapStats.next && (
                  <div className="rounded border border-primary/30 bg-primary/5 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-primary">
                      Prossimo roadmap item
                    </div>
                    <div className="text-sm font-medium truncate">{roadmapStats.next.title}</div>
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      {roadmapStats.next.status}
                    </Badge>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/project-console">Roadmap Intelligence</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Execution snapshot */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4" /> Execution
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/clipboard-ai">
                      Apri <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <Tile label="Inviati" value={pel.length} />
                  <Tile label="Pending" value={execStats.pending.length} tone={execStats.pending.length > 0 ? "amber" : undefined} />
                  <Tile label="Falliti" value={execStats.failed.length} tone={execStats.failed.length > 0 ? "red" : undefined} />
                  <Tile label="Salvati" value={execStats.saved.length} />
                </div>
                {execStats.lastSent && (
                  <div className="rounded border border-border/60 bg-background/40 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Ultimo prompt
                    </div>
                    <div className="text-xs font-medium truncate">
                      {execStats.lastSent.prompt_title}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {execStats.lastSent.status} ·{" "}
                      {new Date(execStats.lastSent.updated_at).toLocaleString()}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Timeline + tools */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4" /> Timeline attività
                </CardTitle>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Nessuna attività recente.
                  </div>
                ) : (
                  <ul className="space-y-2 max-h-80 overflow-y-auto">
                    {logs.slice(0, 20).map((l) => (
                      <li
                        key={l.id}
                        className="flex items-start gap-2 rounded border border-border/60 bg-background/40 p-2 text-xs"
                      >
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {l.action.replace(/_/g, " ")}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{l.notes ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(l.created_at).toLocaleString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <ToolConnectionsBlock brainId={brainId} />
              <KnowledgeMapBlock brainId={brainId} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber";
}) {
  return (
    <div
      className={`rounded border p-2 ${
        tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border/60 bg-background/40"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function AutomationReadinessMini() {
  const summary = summarizeReadiness();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Automation Readiness
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/automation-readiness">
              Apri <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pronte</div>
            <div className="text-lg font-semibold">{summary.ready_now}</div>
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Bloccate permessi</div>
            <div className="text-lg font-semibold">{summary.blocked_by_permission}</div>
          </div>
          <div className="rounded border border-violet-500/30 bg-violet-500/5 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Future n8n</div>
            <div className="text-lg font-semibold">{summary.future_n8n_ready}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function N8nControlledExecutionMini({ brainId }: { brainId: string | null }) {
  const { data: workflows = [] } = useQuery({
    queryKey: ["op-dash-n8n-workflows", brainId],
    queryFn: async () => {
      let q = supabase.from("n8n_workflow_registry" as never).select("*");
      if (brainId) q = q.eq("brain_id", brainId);
      const { data, error } = await q;
      if (error) return [];
      return (data ?? []) as Array<{ status: string; linked_action_types: string[] }>;
    },
  });
  const { data: logs = [] } = useQuery({
    queryKey: ["op-dash-n8n-logs", brainId],
    queryFn: async () => {
      let q = supabase
        .from("n8n_execution_logs" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (brainId) q = q.eq("brain_id", brainId);
      const { data, error } = await q;
      if (error) return [];
      return (data ?? []) as Array<{ success: boolean; execution_mode: string; created_at: string }>;
    },
  });
  const { data: readyActions = 0 } = useQuery({
    queryKey: ["op-dash-n8n-ready-actions", brainId, workflows.length],
    queryFn: async () => {
      const covered = new Set<string>();
      for (const w of workflows) {
        if (w.status === "active" || w.status === "tested") {
          for (const t of w.linked_action_types ?? []) covered.add(t);
        }
      }
      if (covered.size === 0) return 0;
      let q = supabase
        .from("automation_actions")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "ready_to_execute"])
        .in("action_type", [...covered]);
      if (brainId) q = q.eq("brain_id", brainId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const activeN8n = workflows.filter((w) => w.status === "active" || w.status === "tested").length;
  const recentErrors = logs.filter((l) => !l.success && l.execution_mode === "live").length;
  const recentRuns = logs.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" /> n8n Controlled Execution
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/action-queue" search={{}}>
              Apri Action Queue <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <Tile label="Workflow attivi" value={activeN8n} />
          <Tile label="Azioni pronte n8n" value={readyActions} />
          <Tile label="Run recenti" value={recentRuns} />
          <Tile label="Errori recenti" value={recentErrors} tone={recentErrors > 0 ? "red" : undefined} />
        </div>
        <div className="mt-2 flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/n8n-workflows">Apri n8n Workflows</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


function TelegramApprovalsMini({ brainId }: { brainId: string | null }) {
  const { data: requests = [] } = useQuery({
    queryKey: ["telegram-approvals", brainId],
    queryFn: () => listApprovalRequests(brainId),
    enabled: !!brainId,
  });
  const summary = summarizeApprovals(requests);
  const recent = requests.slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Telegram Approvals
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to="/telegram-approvals" search={{ brain: brainId ?? undefined }}>
              Apri <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <MiniTile label="Pending" value={summary.pending} tone={summary.pending > 0 ? "amber" : undefined} />
          <MiniTile label="High risk" value={summary.high_risk} tone={summary.high_risk > 0 ? "red" : undefined} />
          <MiniTile label="Approvate" value={summary.approved} />
          <MiniTile label="Rifiutate" value={summary.rejected} tone={summary.rejected > 0 ? "red" : undefined} />
        </div>
        {recent.length === 0 ? (
          <div className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
            Nessuna richiesta. Le approvazioni Telegram appariranno qui.
          </div>
        ) : (
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="rounded border border-border/60 bg-background/40 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <Badge variant="outline" className={`text-[10px] ${APPROVAL_STATUS_TONE[r.status]}`}>
                    {APPROVAL_STATUS_LABEL[r.status]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MiniTile({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const cls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-600"
      : tone === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
      : "border-border bg-background/40";
  return (
    <div className={`rounded border p-2 text-center ${cls}`}>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function ResultReviewMini({ brainId }: { brainId: string | null }) {
  const { data: items = [] } = useQuery({
    queryKey: ["result-review-mini", brainId],
    queryFn: async () => {
      let q = supabase
        .from("result_review_items" as never)
        .select("id,title,review_status,created_at,brain_id")
        .order("created_at", { ascending: false })
        .limit(20);
      if (brainId) q = q.eq("brain_id", brainId);
      const { data } = await q;
      return (data ?? []) as Array<{ id: string; title: string; review_status: string; created_at: string }>;
    },
  });
  const pending = items.filter((i) => i.review_status === "pending_review").length;
  const needsFix = items.filter((i) => i.review_status === "needs_fix").length;
  const last = items[0];

  const { data: llSummary } = useQuery({
    queryKey: ["ll-summary-mini", brainId],
    queryFn: async () => {
      let q = supabase
        .from("learning_loop_suggestions" as never)
        .select("suggestion_status")
        .limit(500);
      if (brainId) q = q.eq("brain_id", brainId);
      const { data } = await q;
      const rows = (data ?? []) as Array<{ suggestion_status: string }>;
      return {
        suggested: rows.filter((r) => r.suggestion_status === "suggested").length,
        applied: rows.filter((r) => r.suggestion_status === "applied").length,
      };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Result Review</span>
          <Button asChild size="sm" variant="outline">
            <Link to="/result-review" search={{}}>Apri <ArrowRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Da rivedere" value={pending} tone={pending > 0 ? "amber" : undefined} />
          <Tile label="Da correggere" value={needsFix} tone={needsFix > 0 ? "red" : undefined} />
          <Tile label="Totali" value={items.length} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Learning suggeriti" value={llSummary?.suggested ?? 0} tone={(llSummary?.suggested ?? 0) > 0 ? "amber" : undefined} />
          <Tile label="Learning applicati" value={llSummary?.applied ?? 0} />
        </div>
        {last ? (
          <div className="rounded border bg-background/40 p-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ultimo risultato</div>
            <div className="truncate font-medium">{last.title}</div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nessuna review.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LoopQaMini({ brainId }: { brainId: string | null }) {
  const { data: summary } = useQuery({
    queryKey: ["loop-qa-mini", brainId],
    queryFn: async () => {
      const { getLoopQaSummary } = await import("@/lib/loop-qa");
      return getLoopQaSummary(brainId);
    },
  });
  const health = summary?.health ?? "incomplete";
  const tone =
    health === "healthy"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : health === "warning"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
        : "bg-orange-500/10 text-orange-600 border-orange-500/30";
  const label =
    health === "healthy" ? "Sano" : health === "warning" ? "Warning" : "Incompleto";
  const pendingReview = summary?.steps.find((s) => s.id === "3_review_created")?.count ?? 0;
  const pendingSuggestions = summary?.counters.suggestions ?? 0;
  const applied = summary?.counters.suggestionsApplied ?? 0;
  const loopActionsPending = (summary?.warnings.find((w) => w.id === "pending_loop_actions")?.title.match(/\d+/)?.[0]) ?? "0";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Loop QA</span>
          <Badge variant="outline" className={tone}>{label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Reviews" value={pendingReview} />
          <Tile label="Suggerimenti" value={pendingSuggestions} tone={pendingSuggestions > applied ? "amber" : undefined} />
          <Tile label="Action loop pending" value={Number(loopActionsPending)} />
        </div>
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link to="/loop-qa" search={{}}>Apri Loop QA <ArrowRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CompanyOsMini({ brainId }: { brainId: string | null }) {
  const { data: summary } = useQuery({
    queryKey: ["company-os-mini", brainId],
    queryFn: async () => {
      const { getCompanyOsSummary } = await import("@/lib/company-os");
      return getCompanyOsSummary(brainId);
    },
  });
  const { data: latestBlueprint } = useQuery({
    queryKey: ["company-blueprint-latest-mini", brainId],
    enabled: !!brainId,
    queryFn: async () => {
      if (!brainId) return null;
      const { getLatestBlueprint } = await import("@/lib/company-blueprint");
      return getLatestBlueprint(brainId);
    },
  });
  const configured = !!summary?.configured;
  const tone = configured
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
    : "bg-amber-500/10 text-amber-600 border-amber-500/30";
  const onOpen = async () => {
    const { logCompanyOsEvent } = await import("@/lib/company-os");
    void logCompanyOsEvent(
      "company_os_opened_from_operating_dashboard",
      "Apertura Company OS da Operating Dashboard",
      { brain_id: brainId },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><LayoutDashboard className="h-4 w-4" /> Company OS</span>
          <Badge variant="outline" className={tone}>{configured ? "Configurato" : "Non configurato"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {configured ? (
          <>
            <div className="space-y-1 text-xs">
              <div><span className="text-muted-foreground">Azienda:</span> <span className="font-medium">{summary?.companyName ?? "—"}</span></div>
              {summary?.presetLabel && (
                <div><span className="text-muted-foreground">Preset:</span> <span className="font-medium">{summary.presetLabel}</span></div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Aree attive" value={summary?.activeDepartments ?? 0} />
              <Tile label="Moduli attivi" value={summary?.preferredModules ?? 0} />
            </div>
            {summary?.nextSetupAction && (
              <div className="rounded border bg-background/40 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Prossima azione consigliata</div>
                <div className="truncate font-medium">{summary.nextSetupAction.title}</div>
              </div>
            )}
            <div className="rounded border bg-background/40 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ultimo blueprint</div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{latestBlueprint ? "Presente" : "Assente"}</span>
                <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                  <Link to="/company-blueprint" search={{}}>Apri Blueprint</Link>
                </Button>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="w-full" onClick={onOpen}>
              <Link to="/company-os" search={{}}>Apri Company OS <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Profilo aziendale non ancora configurato.</p>
            <Button asChild size="sm" variant="outline" className="w-full" onClick={onOpen}>
              <Link to="/company-os" search={{}}>Configura Company OS <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BuildEnginesMini({ brainId }: { brainId: string | null }) {
  const { data: handoffs = [] } = useQuery({
    queryKey: ["build-engines-mini", brainId],
    queryFn: async () => {
      const { listBuildEngineHandoffs } = await import("@/lib/build-engines");
      return listBuildEngineHandoffs(brainId);
    },
  });
  const drafts = handoffs.filter((h) => h.handoff_status === "draft" || h.handoff_status === "ready").length;
  const last = handoffs[0];
  const onOpen = async () => {
    const { logBuildEngineEvent } = await import("@/lib/build-engines");
    void logBuildEngineEvent(
      "build_engine_opened_from_operating_dashboard",
      "Apertura Build Engines da Operating Dashboard",
      { brain_id: brainId },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><LayoutDashboard className="h-4 w-4" /> Build Engines</span>
          <Badge variant="outline">{drafts} draft/ready</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded border bg-background/40 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ultimo engine usato</div>
          <div className="truncate font-medium">{last ? last.engine_key : "—"}</div>
        </div>
        <Button asChild size="sm" variant="outline" className="w-full" onClick={onOpen}>
          <Link to="/build-engines" search={{}}>Apri Build Engines <ArrowRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function MvpFactoryMini({ brainId }: { brainId: string | null }) {
  const { data: projects = [] } = useQuery({
    queryKey: ["mvp-factory-mini", brainId],
    queryFn: async () => {
      const { listMvpProjects } = await import("@/lib/mvp-factory");
      return listMvpProjects({ brain_id: brainId || undefined });
    },
  });
  const draft = projects.filter((p) => p.status === "draft").length;
  const ready = projects.filter(
    (p) => p.status === "generated" || p.status === "approved",
  ).length;
  const last = projects[0];
  const onOpen = async () => {
    const { logMvpFactoryEvent } = await import("@/lib/mvp-factory");
    void logMvpFactoryEvent(
      "mvp_opened_from_operating_dashboard",
      "Apertura MVP Factory da Operating Dashboard",
      { brain_id: brainId },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> MVP Factory</span>
          <Badge variant="outline">{draft} draft · {ready} ready</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="rounded border bg-background/40 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ultimo MVP</div>
          <div className="truncate font-medium">{last?.title ?? "—"}</div>
          {last?.recommended_engine ? (
            <div className="mt-1 text-[10px] text-muted-foreground">Engine: {last.recommended_engine}</div>
          ) : null}
        </div>
        <Button asChild size="sm" variant="outline" className="w-full" onClick={onOpen}>
          <Link to="/mvp-factory" search={{ brain: brainId || undefined }}>
            Apri MVP Factory <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
