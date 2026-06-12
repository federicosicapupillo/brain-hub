import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Plus,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react";
import {
  ACTION_TYPE_LABEL,
  ACTION_TYPE_RISK,
  AutomationAction,
  ActionStatus,
  ActionSource,
  ActionType,
  RISK_TONE,
  SOURCE_LABEL,
  STATUS_LABEL,
  approveAction,
  cancelAction,
  createAction,
  listActions,
  markExecuted,
  markFailed,
  markReadyToExecute,
  rejectAction,
} from "@/lib/action-queue";
import type { LogEventType } from "@/lib/automation-run";
import {
  getReadiness,
  AUTOMATION_LEVEL_LABEL,
  AUTOMATION_LEVEL_TONE,
  EXECUTION_METHOD_LABEL,
} from "@/lib/automation-readiness";
import { listWorkflowsForActionType } from "@/lib/n8n-workflows";

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

const SOURCE_BADGE: Record<ActionSource, string> = {
  project_health_check: "Da Project Health",
  roadmap_intelligence: "Da Roadmap",
  next_prompt_generator: "Da Next Prompt",
  execution_tracking: "Da Execution Tracking",
  user_manual: "Manuale",
  system_suggestion: "Sistema",
};

export const Route = createFileRoute("/_authenticated/action-queue")({
  head: () => ({
    meta: [
      { title: "Automation Control · Action Queue — Brain Hub" },
      {
        name: "description",
        content:
          "Coda azioni operative approvabili: suggerimenti da Project Health Check, Roadmap Intelligence e Next Prompt Generator.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    brain: typeof search.brain === "string" ? search.brain : undefined,
  }),
  component: ActionQueueRoute,
});

type BrainRow = { id: string; name: string };

function ActionQueueRoute() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/action-queue" }) as { brain?: string };
  const [brainFilter, setBrainFilter] = useState<string>(search.brain ?? "all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [confirmHighId, setConfirmHighId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (search.brain && search.brain !== brainFilter) setBrainFilter(search.brain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.brain]);


  const { data: brains = [] } = useQuery<BrainRow[]>({
    queryKey: ["action-queue-brains"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brains")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const { data: actions = [] } = useQuery<AutomationAction[]>({
    queryKey: ["action-queue", brainFilter],
    queryFn: () =>
      listActions({ brainId: brainFilter === "all" ? undefined : brainFilter }),
  });

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (typeFilter !== "all" && a.action_type !== typeFilter) return false;
      if (riskFilter !== "all" && a.risk_level !== riskFilter) return false;
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      return true;
    });
  }, [actions, statusFilter, typeFilter, riskFilter, sourceFilter]);

  const summary = useMemo(() => {
    return {
      suggested: actions.filter((a) => a.status === "suggested").length,
      pending: actions.filter((a) => a.status === "pending_approval").length,
      approved: actions.filter((a) => a.status === "approved").length,
      executed: actions.filter((a) => a.status === "executed").length,
      failed: actions.filter((a) => a.status === "failed").length,
      high: actions.filter(
        (a) => a.risk_level === "high" && a.status !== "executed" && a.status !== "rejected" && a.status !== "cancelled",
      ).length,
    };
  }, [actions]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["action-queue"] });

  async function handleApprove(a: AutomationAction) {
    if (a.risk_level === "high") {
      setConfirmHighId(a.id);
      return;
    }
    try {
      await approveAction(a);
      toast.success("Azione approvata");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore approvazione");
    }
  }

  async function confirmHighApprove() {
    const a = actions.find((x) => x.id === confirmHighId);
    if (!a) return;
    try {
      await approveAction(a);
      toast.success("Azione high risk approvata");
      setConfirmHighId(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handleReject(a: AutomationAction) {
    try {
      await rejectAction(a);
      toast("Azione rifiutata");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handleCancel(a: AutomationAction) {
    try {
      await cancelAction(a);
      toast("Azione annullata");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function handlePrepare(a: AutomationAction) {
    try {
      // Dispatch by action_type. None of these execute automations externally —
      // they prepare the existing UI (Browser Bridge, Roadmap Intelligence, etc.)
      // or, for direct mutations, require explicit confirmation.
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      switch (a.action_type) {
        case "open_project_console": {
          await markExecuted(a, "Project Console aperta");
          await logEvent("automation_action_prepared", `Aperto Project Console: ${a.title}`, { action_id: a.id });
          invalidate();
          toast.success("Apro Project Console");
          void navigate({ to: "/project-console" });
          return;
        }
        case "send_next_prompt":
        case "generate_fix_prompt":
        case "generate_first_prompt":
        case "save_lovable_result":
        case "review_pending_result":
        case "link_log_to_roadmap":
        case "create_roadmap_item":
        case "clean_orphan_logs": {
          await markReadyToExecute(a);
          await logEvent("automation_action_prepared", `Azione preparata: ${a.title}`, {
            action_id: a.id,
            action_type: a.action_type,
          });
          invalidate();
          toast.success("Azione preparata — apro il componente collegato", {
            action: {
              label: "Apri ora",
              onClick: () => {
                if (a.action_type === "create_roadmap_item") void navigate({ to: "/roadmap" });
                else void navigate({ to: "/automation-control" });
              },
            },
          });
          return;
        }
        case "mark_roadmap_completed": {
          const ok = window.confirm(
            `Confermi: segnare la roadmap come COMPLETATA?\n\n${a.title}\n\nQuesta azione modifica direttamente la roadmap.`,
          );
          if (!ok) return;
          if (a.roadmap_item_id) {
            const { error } = await supabase
              .from("roadmap_items")
              .update({ status: "completed" } as never)
              .eq("id", a.roadmap_item_id);
            if (error) {
              await markFailed(a, error.message);
              toast.error(error.message);
              invalidate();
              return;
            }
            await logEvent("roadmap_item_marked_completed", `Roadmap completata via Action Queue: ${a.title}`, {
              roadmap_item_id: a.roadmap_item_id,
              action_id: a.id,
            });
          }
          await markExecuted(a, "Roadmap segnata come completata");
          invalidate();
          toast.success("Roadmap aggiornata");
          return;
        }
        case "mark_roadmap_needs_fix": {
          const ok = window.confirm(`Confermi: segnare la roadmap come DA CORREGGERE?\n\n${a.title}`);
          if (!ok) return;
          if (a.roadmap_item_id) {
            const { error } = await supabase
              .from("roadmap_items")
              .update({ status: "blocked" } as never)
              .eq("id", a.roadmap_item_id);
            if (error) {
              await markFailed(a, error.message);
              toast.error(error.message);
              invalidate();
              return;
            }
            await logEvent("roadmap_item_marked_needs_fix", `Roadmap da correggere via Action Queue: ${a.title}`, {
              roadmap_item_id: a.roadmap_item_id,
              action_id: a.id,
            });
          }
          await markExecuted(a, "Roadmap segnata da correggere");
          invalidate();
          toast.success("Roadmap aggiornata");
          return;
        }
        case "manual_task":
        default: {
          if (a.risk_level === "low") {
            await markExecuted(a, "Marcata eseguita (azione low risk)");
            toast.success("Azione eseguita");
          } else {
            await markReadyToExecute(a);
            toast.success("Azione preparata");
          }
          await logEvent("automation_action_prepared", `Azione preparata: ${a.title}`, { action_id: a.id });
          invalidate();
          // suppress unused meta warning
          void meta;
          return;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  function openLinkedObject(a: AutomationAction) {
    void logEvent("automation_action_linked_object_opened", `Oggetto collegato aperto: ${a.title}`, {
      action_id: a.id,
      brain_id: a.brain_id,
      roadmap_item_id: a.roadmap_item_id,
      prompt_execution_log_id: a.prompt_execution_log_id,
    });
    if (a.roadmap_item_id) void navigate({ to: "/roadmap" });
    else if (a.prompt_execution_log_id) void navigate({ to: "/automation-control" });
    else void navigate({ to: "/project-console" });
  }

  function openSource(a: AutomationAction) {
    void logEvent("automation_action_source_opened", `Sorgente azione aperta: ${SOURCE_LABEL[a.source]}`, {
      action_id: a.id,
      source: a.source,
    });
    if (a.source === "project_health_check" || a.source === "roadmap_intelligence") {
      void navigate({ to: "/project-console" });
    } else if (a.source === "execution_tracking" || a.source === "next_prompt_generator") {
      void navigate({ to: "/automation-control" });
    } else {
      void navigate({ to: "/action-queue" });
    }
  }

  const openDetail = actions.find((a) => a.id === openDetailId) ?? null;


  return (
    <div className="min-h-[calc(100vh-3rem)] space-y-4 p-4 lg:p-6">
      <PageHeader
        title="Automation Control · Action Queue"
        subtitle="Coda azioni operative approvabili. Niente è eseguito automaticamente."
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <SummaryTile label="Suggerite" value={summary.suggested} icon={<Zap className="h-3 w-3" />} />
        <SummaryTile label="In attesa" value={summary.pending} icon={<ListChecks className="h-3 w-3" />} />
        <SummaryTile label="Approvate" value={summary.approved} icon={<CheckCircle2 className="h-3 w-3" />} />
        <SummaryTile label="Eseguite" value={summary.executed} icon={<CheckCircle2 className="h-3 w-3" />} />
        <SummaryTile label="Fallite" value={summary.failed} icon={<XCircle className="h-3 w-3" />} />
        <SummaryTile label="High risk attive" value={summary.high} icon={<ShieldAlert className="h-3 w-3" />} tone="red" />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Filtri</CardTitle>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-3 w-3" /> Nuova azione manuale
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-5">
          <FilterSelect
            label="Progetto"
            value={brainFilter}
            onChange={setBrainFilter}
            options={[
              { value: "all", label: "Tutti" },
              ...brains.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <FilterSelect
            label="Stato"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "Tutti" },
              ...Object.entries(STATUS_LABEL).map(([v, l]) => ({ value: v, label: l })),
            ]}
          />
          <FilterSelect
            label="Tipo"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: "Tutti" },
              ...Object.entries(ACTION_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })),
            ]}
          />
          <FilterSelect
            label="Rischio"
            value={riskFilter}
            onChange={setRiskFilter}
            options={[
              { value: "all", label: "Tutti" },
              { value: "low", label: "low" },
              { value: "medium", label: "medium" },
              { value: "high", label: "high" },
            ]}
          />
          <FilterSelect
            label="Origine"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "all", label: "Tutte" },
              ...Object.entries(SOURCE_LABEL).map(([v, l]) => ({ value: v, label: l })),
            ]}
          />
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Azioni ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nessuna azione corrisponde ai filtri.
            </div>
          ) : (
            filtered.map((a) => (
              <ActionRow
                key={a.id}
                a={a}
                brainName={brains.find((b) => b.id === a.brain_id)?.name}
                onOpen={() => setOpenDetailId(a.id)}
                onApprove={() => handleApprove(a)}
                onReject={() => handleReject(a)}
                onCancel={() => handleCancel(a)}
                onPrepare={() => handlePrepare(a)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!openDetail} onOpenChange={(v) => !v && setOpenDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openDetail?.title}</DialogTitle>
            <DialogDescription>
              {openDetail ? ACTION_TYPE_LABEL[openDetail.action_type] : ""}
            </DialogDescription>
          </DialogHeader>
          {openDetail && <ActionDetail a={openDetail} brainName={brains.find((b) => b.id === openDetail.brain_id)?.name} />}
          <DialogFooter className="flex flex-wrap gap-2">
            {openDetail && (
              <>
                <Button variant="outline" size="sm" onClick={() => openLinkedObject(openDetail)}>
                  <ExternalLink className="mr-1 h-3 w-3" /> Apri oggetto collegato
                </Button>
                <Button variant="outline" size="sm" onClick={() => openSource(openDetail)}>
                  Vai alla sorgente
                </Button>
              </>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/automation-control">Apri Automation Control</Link>
            </Button>
            {openDetail?.brain_id && (
              <Button asChild variant="outline" size="sm">
                <Link to="/project-console">Apri progetto</Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpenDetailId(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* High risk confirm */}
      <Dialog open={!!confirmHighId} onOpenChange={(v) => !v && setConfirmHighId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-500" /> Azione high risk
            </DialogTitle>
            <DialogDescription>
              Questa azione può modificare lo stato operativo del progetto. Confermi?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmHighId(null)}>Annulla</Button>
            <Button variant="destructive" onClick={confirmHighApprove}>Confermo, approva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New manual action */}
      <NewActionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        brains={brains}
        onCreated={() => {
          setNewOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "red";
}) {
  return (
    <div
      className={`rounded-md border p-2 ${tone === "red" ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40"}`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ActionRow({
  a,
  brainName,
  onOpen,
  onApprove,
  onReject,
  onCancel,
  onPrepare,
}: {
  a: AutomationAction;
  brainName?: string;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onPrepare: () => void;
}) {
  const terminal = ["executed", "rejected", "cancelled", "failed"].includes(a.status);
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            className="text-left text-sm font-semibold hover:underline"
            onClick={onOpen}
          >
            {a.title}
          </button>
          {a.description && (
            <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{a.description}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px]">{ACTION_TYPE_LABEL[a.action_type]}</Badge>
            <Badge variant="secondary" className="text-[10px]">{SOURCE_BADGE[a.source]}</Badge>
            <Badge className={`border text-[10px] ${RISK_TONE[a.risk_level]}`} variant="outline">
              {a.risk_level}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[a.status]}</Badge>
            {brainName && <Badge variant="outline" className="text-[10px]">{brainName}</Badge>}
            {(a.metadata as Record<string, unknown> | null)?.duplicate_click_count ? (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600">
                ×{String((a.metadata as Record<string, unknown>).duplicate_click_count)} duplicati evitati
              </Badge>
            ) : null}
            <span className="text-[10px] text-muted-foreground">
              · {new Date(a.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {(a.status === "suggested" || a.status === "pending_approval") && (
            <>
              <Button size="sm" variant="default" onClick={onApprove}>Approva</Button>
              <Button size="sm" variant="outline" onClick={onReject}>Rifiuta</Button>
            </>
          )}
          {a.status === "approved" && (
            <Button size="sm" variant="default" onClick={onPrepare}>
              {a.risk_level === "low" ? "Esegui" : "Prepara"}
            </Button>
          )}
          {a.status === "ready_to_execute" && (
            <Button size="sm" variant="default" onClick={onPrepare}>Segna eseguita</Button>
          )}
          {!terminal && a.status !== "suggested" && a.status !== "pending_approval" && (
            <Button size="sm" variant="ghost" onClick={onCancel}>Annulla</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionDetail({ a, brainName }: { a: AutomationAction; brainName?: string }) {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const readiness = getReadiness(a.action_type);
  const { data: linkedWorkflows = [] } = useQuery({
    queryKey: ["n8n-workflows-for-action", a.action_type, a.brain_id],
    queryFn: () => listWorkflowsForActionType(a.action_type, a.brain_id ?? undefined),
  });
  return (
    <div className="space-y-3 text-sm">
      {linkedWorkflows.length > 0 && (
        <div className="rounded border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-violet-600">
            Workflow n8n collegato
          </div>
          {linkedWorkflows.map((w) => (
            <div key={w.id} className="mt-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{w.workflow_name}</span>
                <Badge variant="outline">{w.status}</Badge>
                <Badge variant="outline" className={RISK_TONE[w.risk_level]}>{w.risk_level}</Badge>
                {w.workflow_url && (
                  <a href={w.workflow_url} target="_blank" rel="noreferrer" className="ml-auto text-violet-600 underline">
                    Apri workflow
                  </a>
                )}
              </div>
              {w.expected_input_schema && (
                <div className="text-muted-foreground">Input attesi: <code className="text-[10px]">{Object.keys(w.expected_input_schema).join(", ") || "—"}</code></div>
              )}
              {w.expected_output_schema && (
                <div className="text-muted-foreground">Output attesi: <code className="text-[10px]">{Object.keys(w.expected_output_schema).join(", ") || "—"}</code></div>
              )}
              {w.verification_method && (
                <div className="text-muted-foreground">Verifica: {w.verification_method}</div>
              )}
            </div>
          ))}
          <div className="mt-2 text-[10px] text-muted-foreground">
            Il workflow non viene eseguito da Brain Hub. Apri n8n manualmente per testarlo.
          </div>
        </div>
      )}
      {linkedWorkflows.length === 0 && readiness?.execution_method === "n8n_workflow" && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          Workflow n8n mancante per questo action type.{" "}
          <Link to="/n8n-workflows" className="underline">Registra workflow</Link>
        </div>
      )}
      {readiness && (
        <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Automation Readiness
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className={AUTOMATION_LEVEL_TONE[readiness.automation_level_current]}>
              {AUTOMATION_LEVEL_LABEL[readiness.automation_level_current]}
            </Badge>
            <Badge variant="outline">
              {EXECUTION_METHOD_LABEL[readiness.execution_method]}
            </Badge>
            <Badge
              variant="outline"
              className={
                readiness.is_ready_for_automation
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  : "border-red-500/30 bg-red-500/10 text-red-600"
              }
            >
              {readiness.is_ready_for_automation ? "Pronta" : "Non pronta"}
            </Badge>
            {readiness.required_tool && (
              <Badge variant="outline">Tool: {readiness.required_tool}</Badge>
            )}
          </div>
          {readiness.blocking_reason && (
            <div className="mt-1 text-amber-700">Blocco: {readiness.blocking_reason}</div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <DetailItem label="Tipo" value={ACTION_TYPE_LABEL[a.action_type]} />
        <DetailItem label="Origine" value={SOURCE_LABEL[a.source]} />
        <DetailItem label="Rischio" value={a.risk_level} />
        <DetailItem label="Priorità" value={a.priority} />
        <DetailItem label="Stato" value={STATUS_LABEL[a.status]} />
        <DetailItem label="Progetto" value={brainName ?? a.brain_id ?? "—"} />
        <DetailItem label="Origine CTA" value={String(meta.source_cta ?? "—")} />
        <DetailItem label="Blocco sorgente" value={String(meta.source_block ?? "—")} />
        <DetailItem label="Oggetto collegato" value={a.roadmap_item_id ? "Roadmap item" : a.prompt_execution_log_id ? "Execution log" : a.task_id ? "Task" : "—"} />
        <DetailItem label="Azione già preparata?" value={a.status === "ready_to_execute" || a.status === "executed" ? "Sì" : "No"} />
      </div>
      {a.description && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Motivazione</div>
          <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">{a.description}</div>
        </div>
      )}
      <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
        <div className="font-semibold">Cosa succede se approvi</div>
        <div className="text-muted-foreground">
          {a.risk_level === "high"
            ? "Richiede conferma esplicita. Non viene eseguita automaticamente — viene preparata per esecuzione manuale."
            : a.risk_level === "medium"
              ? "L'azione passa in stato approvata e potrai prepararla per l'esecuzione."
              : "L'azione passa in stato approvata e può essere segnata come eseguita."}
        </div>
        <div className="mt-2 font-semibold">Cosa succede se rifiuti</div>
        <div className="text-muted-foreground">L'azione viene archiviata come rifiutata. Nessun dato viene cancellato.</div>
      </div>
      {(a.prompt_execution_log_id || a.roadmap_item_id || a.task_id) && (
        <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
          <div className="font-semibold mb-1">Dati collegati</div>
          {a.prompt_execution_log_id && <div>Execution log: <code>{a.prompt_execution_log_id}</code></div>}
          {a.roadmap_item_id && <div>Roadmap item: <code>{a.roadmap_item_id}</code></div>}
          {a.task_id && <div>Task: <code>{a.task_id}</code></div>}
        </div>
      )}
      {a.result_text && (
        <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
          <div className="font-semibold">Risultato</div>
          <div className="text-muted-foreground whitespace-pre-wrap">{a.result_text}</div>
        </div>
      )}
      {a.error_text && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
          <div className="font-semibold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Errore</div>
          <div className="text-muted-foreground whitespace-pre-wrap">{a.error_text}</div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function NewActionDialog({
  open,
  onOpenChange,
  brains,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brains: BrainRow[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ActionType>("manual_task");
  const [brainId, setBrainId] = useState<string>("");

  async function submit() {
    if (!title.trim()) {
      toast.error("Inserisci un titolo");
      return;
    }
    try {
      await createAction({
        source: "user_manual",
        action_type: type,
        title: title.trim(),
        description: description.trim() || undefined,
        brain_id: brainId || null,
      });
      toast.success("Azione creata");
      setTitle("");
      setDescription("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova azione manuale</DialogTitle>
          <DialogDescription>
            Crea un'azione da inserire nella coda. Le azioni medium/high richiedono approvazione esplicita.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Titolo</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Descrizione</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select value={type} onValueChange={(v) => setType(v as ActionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_TYPE_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l} · <span className="text-muted-foreground">{ACTION_TYPE_RISK[v as ActionType]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Progetto</label>
              <Select value={brainId} onValueChange={setBrainId}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  {brains.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={submit}>Crea</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Unused statuses re-export to silence unused-import for ActionStatus type
export type _Status = ActionStatus;
