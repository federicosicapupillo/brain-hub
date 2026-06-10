import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Copy, Play, CheckCircle2, AlertTriangle, XCircle, Shield, RefreshCw, FileJson, Workflow, Inbox } from "lucide-react";
import {
  buildAutomationPayload,
  defaultAutomationRun,
  findActiveRun,
  getAutomationRun,
  type AutomationRun,
  type ExecutionMode,
  type ItemLike,
  type LogEventType,
  type RunStatus,
  updateAutomationRun,
  RUN_STATUS_LABELS,
} from "@/lib/automation-run";
import { normalizeAutomationItem } from "@/lib/automation-normalize";

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  automation_status: string | null;
  risk_level: string | null;
  execution_instructions: string | null;
  expected_output: string | null;
  success_criteria: string | null;
  updated_at: string;
};

type Brain = { id: string; name: string };

const FILTERS = [
  "tutti",
  "da_approvare",
  "approvati",
  "in_coda",
  "in_esecuzione",
  "completati",
  "falliti",
  "alto_rischio",
  "fix_prompt",
  "next_prompt",
] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  tutti: "Tutti",
  da_approvare: "Da approvare",
  approvati: "Approvati",
  in_coda: "In coda",
  in_esecuzione: "In esecuzione",
  completati: "Completati",
  falliti: "Falliti",
  alto_rischio: "Alto rischio",
  fix_prompt: "Fix prompt",
  next_prompt: "Next prompt",
};


const RUN_BADGE: Record<RunStatus, string> = {
  draft: "bg-slate-500/15 text-slate-200",
  approved: "bg-blue-500/15 text-blue-300",
  queued: "bg-amber-500/15 text-amber-300",
  running: "bg-indigo-500/15 text-indigo-300",
  completed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  cancelled: "bg-zinc-500/15 text-zinc-300",
  blocked: "bg-fuchsia-500/15 text-fuchsia-300",
};

async function fetchData() {
  const [itemsRes, brainsRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,title,content,content_type,target_tool,automation_status,risk_level,metadata,execution_instructions,expected_output,success_criteria,updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("brains").select("id,name"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (brainsRes.error) throw brainsRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    brains: (brainsRes.data ?? []) as Brain[],
  };
}

function pkgType(i: ClipItem): string {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const pkg = m.execution_package as { package_type?: string } | undefined;
  return pkg?.package_type ?? "standard";
}

function reviewStatus(i: ClipItem): string | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const r = m.post_execution_review as { review_status?: string } | undefined;
  return r?.review_status ?? null;
}

export function AutomationRunPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("tutti");

  const { data, isLoading, error } = useQuery({
    queryKey: ["automation-run-panel"],
    queryFn: fetchData,
    refetchInterval: 20000,
  });

  const [approveTarget, setApproveTarget] = useState<ClipItem | null>(null);
  const [approveForm, setApproveForm] = useState({
    promptComplete: true,
    riskAcceptable: true,
    protectedAreasNoted: true,
    successCriteriaPresent: true,
    expectedOutputClear: true,
    targetCorrect: true,
    humanNeeded: false,
    target: "lovable",
    execution_mode: "manual_copy" as ExecutionMode,
    confirmHighRisk: false,
  });

  const [completeTarget, setCompleteTarget] = useState<ClipItem | null>(null);
  const [completeForm, setCompleteForm] = useState({ notes: "", reference: "" });

  const [failTarget, setFailTarget] = useState<ClipItem | null>(null);
  const [failForm, setFailForm] = useState({ error: "", notes: "" });

  const [cancelTarget, setCancelTarget] = useState<ClipItem | null>(null);
  const [cancelNotes, setCancelNotes] = useState("");

  const [blockTarget, setBlockTarget] = useState<ClipItem | null>(null);
  const [blockNotes, setBlockNotes] = useState("");

  const [payloadTarget, setPayloadTarget] = useState<ClipItem | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
    qc.invalidateQueries({ queryKey: ["automation-control"] });
    qc.invalidateQueries({ queryKey: ["project-loop"] });
  };

  const mutate = useMutation({
    mutationFn: async ({
      item,
      patch,
      event,
      notes,
    }: {
      item: ClipItem;
      patch: Partial<AutomationRun>;
      event: LogEventType;
      notes?: string;
    }) => updateAutomationRun(item, patch, event, { notes }),
    onSuccess: (_r, vars) => {
      toast.success(`Run aggiornata: ${RUN_STATUS_LABELS[vars.patch.run_status ?? "draft"]}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);

  const normalized = useMemo(
    () => items.map((i) => ({ item: i, norm: normalizeAutomationItem(i) })),
    [items],
  );

  const filtered = useMemo(() => {
    return normalized
      .filter(({ norm }) => norm.isEligibleForRunLedger)
      .filter(({ item, norm }) => {
        const run = getAutomationRun(item);
        switch (filter) {
          case "tutti":
            return true;
          case "da_approvare":
            return norm.isPendingApproval;
          case "approvati":
            return run.run_status === "approved";
          case "in_coda":
            return run.run_status === "queued";
          case "in_esecuzione":
            return run.run_status === "running";
          case "completati":
            return run.run_status === "completed";
          case "falliti":
            return run.run_status === "failed";
          case "alto_rischio":
            return item.risk_level === "alto";
          case "fix_prompt":
            return pkgType(item) === "fix_prompt";
          case "next_prompt":
            return pkgType(item) === "next_prompt";
        }
      })
      .map(({ item }) => item);
  }, [normalized, filter]);

  const diagnostics = useMemo(() => {
    const totalLoaded = items.length;
    const nativeCT = normalized.filter((n) => n.norm.detectionSource === "content_type").length;
    const viaMetadata = normalized.filter((n) => n.norm.detectionSource === "metadata").length;
    const viaFields = normalized.filter((n) => n.norm.detectionSource === "instructions_fields").length;
    const executionPackages = normalized.filter((n) => n.norm.isExecutionPackage).length;
    const legacyCount = normalized.filter((n) => n.norm.isLegacyPackage).length;
    const pendingApproval = normalized.filter((n) => n.norm.isPendingApproval).length;
    const visibleInFilter = filtered.length;
    const excluded = normalized
      .filter((n) => n.norm.exclusionReason)
      .map((n) => ({ id: n.item.id, title: n.item.title, reason: n.norm.exclusionReason }));
    return { totalLoaded, nativeCT, viaMetadata, viaFields, executionPackages, legacyCount, pendingApproval, visibleInFilter, excluded };
  }, [normalized, items.length, filtered.length]);

  const legacyItems = useMemo(
    () => normalized.filter((n) => n.norm.isLegacyPackage).map((n) => n.item),
    [normalized],
  );

  const normalizeLegacyMut = useMutation({
    mutationFn: async () => {
      const ids = legacyItems.map((i) => i.id);
      if (ids.length === 0) return { updated: 0 };
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({ content_type: "execution_package" } as never)
        .in("id", ids);
      if (upErr) throw upErr;
      return { updated: ids.length };
    },
    onSuccess: (r) => {
      toast.success(`Normalizzati ${r.updated} Execution Package legacy`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento Run Ledger…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;

  function openApprove(item: ClipItem) {
    const run = getAutomationRun(item);
    setApproveForm((f) => ({
      ...f,
      target: run.target || "lovable",
      execution_mode: run.execution_mode || "manual_copy",
      confirmHighRisk: false,
    }));
    setApproveTarget(item);
  }

  function doApprove() {
    if (!approveTarget) return;
    if (approveTarget.risk_level === "alto" && !approveForm.confirmHighRisk) {
      toast.error("Conferma esplicita richiesta per item ad alto rischio");
      return;
    }
    const existing = findActiveRun(approveTarget);
    if (existing) {
      toast.error(`Run già attiva (${RUN_STATUS_LABELS[existing.run_status]}). Aggiorno quella esistente.`);
    }
    const now = new Date().toISOString();
    mutate.mutate(
      {
        item: approveTarget,
        event: "automation_approved",
        notes: "Run approvata da Automation Control",
        patch: {
          run_status: "approved",
          approved_by_user: true,
          approved_at: now,
          target: approveForm.target,
          execution_mode: approveForm.execution_mode,
        },
      },
      { onSuccess: () => setApproveTarget(null) },
    );
  }

  function doQueue(item: ClipItem) {
    mutate.mutate({
      item,
      event: "automation_queued",
      patch: { run_status: "queued", queued_at: new Date().toISOString() },
    });
  }

  function doStart(item: ClipItem) {
    mutate.mutate({
      item,
      event: "automation_started",
      patch: { run_status: "running", started_at: new Date().toISOString() },
    });
  }

  function doComplete() {
    if (!completeTarget) return;
    mutate.mutate(
      {
        item: completeTarget,
        event: "automation_completed",
        notes: completeForm.notes || undefined,
        patch: {
          run_status: "completed",
          completed_at: new Date().toISOString(),
          execution_notes: completeForm.notes,
          external_result_reference: completeForm.reference || null,
        },
      },
      {
        onSuccess: () => {
          setCompleteTarget(null);
          setCompleteForm({ notes: "", reference: "" });
        },
      },
    );
  }

  function doFail() {
    if (!failTarget) return;
    mutate.mutate(
      {
        item: failTarget,
        event: "automation_failed",
        notes: failForm.error || failForm.notes || undefined,
        patch: {
          run_status: "failed",
          failed_at: new Date().toISOString(),
          last_error: failForm.error,
          execution_notes: failForm.notes,
        },
      },
      {
        onSuccess: () => {
          setFailTarget(null);
          setFailForm({ error: "", notes: "" });
        },
      },
    );
  }

  function doRetry(item: ClipItem) {
    const run = getAutomationRun(item);
    if (["approved", "queued", "running"].includes(run.run_status)) {
      toast.error("Run già attiva, retry non consentito");
      return;
    }
    const prevError = run.last_error;
    const notes = prevError
      ? `${run.execution_notes ?? ""}\n[retry #${run.retry_count + 1}] precedente errore: ${prevError}`.trim()
      : run.execution_notes ?? "";
    mutate.mutate({
      item,
      event: "automation_retried",
      notes: `Retry #${run.retry_count + 1}`,
      patch: {
        run_status: "queued",
        queued_at: new Date().toISOString(),
        retry_count: run.retry_count + 1,
        execution_notes: notes,
      },
    });
  }

  function doCancel() {
    if (!cancelTarget) return;
    mutate.mutate(
      {
        item: cancelTarget,
        event: "automation_cancelled",
        notes: cancelNotes || undefined,
        patch: {
          run_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          execution_notes: cancelNotes,
        },
      },
      {
        onSuccess: () => {
          setCancelTarget(null);
          setCancelNotes("");
        },
      },
    );
  }

  function doBlock() {
    if (!blockTarget) return;
    mutate.mutate(
      {
        item: blockTarget,
        event: "automation_blocked",
        notes: blockNotes || undefined,
        patch: {
          run_status: "blocked",
          blocked_at: new Date().toISOString(),
          execution_notes: blockNotes,
        },
      },
      {
        onSuccess: () => {
          setBlockTarget(null);
          setBlockNotes("");
        },
      },
    );
  }

  async function copyPayload(item: ClipItem) {
    const brain = item.brain_id ? brainMap.get(item.brain_id) : null;
    const payload = buildAutomationPayload(item, {
      brain_name: brain?.name ?? null,
      project_id: null,
      project_name: null,
    });
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      toast.success("Payload automazione copiato");
    } catch {
      toast.error("Impossibile copiare negli appunti");
      return;
    }
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        await supabase.from("clipboard_execution_logs").insert({
          user_id: userData.user.id,
          clipboard_item_id: item.id,
          action: "automation_payload_copied",
          notes: "Payload automazione copiato",
          metadata: {
            clipboard_item_id: item.id,
            brain_id: item.brain_id,
            target: payload.target,
            execution_mode: payload.execution_mode,
            risk_level: item.risk_level,
          },
        } as never);
        invalidate();
      }
    } catch {
      /* non-fatal */
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" /> Automation Run Ledger
        </CardTitle>
        <Badge variant="outline" className="text-[10px]">
          {filtered.length} / {items.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              className="h-7 text-[11px]"
            >
              {FILTER_LABELS[f]}
            </Button>
          ))}
        </div>

        {import.meta.env.DEV && (
          <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-200/90 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono uppercase tracking-wide text-amber-300">[dev] Run Ledger diagnostics</div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                disabled={diagnostics.legacyCount === 0 || normalizeLegacyMut.isPending}
                onClick={() => normalizeLegacyMut.mutate()}
              >
                Normalizza Execution Package legacy ({diagnostics.legacyCount})
              </Button>
            </div>
            <div>raw caricati: <b>{diagnostics.totalLoaded}</b> · execution_package totali: <b>{diagnostics.executionPackages}</b> · nativi (content_type): <b>{diagnostics.nativeCT}</b> · via metadata.execution_package: <b>{diagnostics.viaMetadata}</b> · via instructions/expected/success: <b>{diagnostics.viaFields}</b></div>
            <div>legacy: <b>{diagnostics.legacyCount}</b> · da_approvare normalizzati: <b>{diagnostics.pendingApproval}</b> · visibili nel filtro "{FILTER_LABELS[filter]}": <b>{diagnostics.visibleInFilter}</b></div>
            {diagnostics.excluded.length > 0 && (
              <details>
                <summary className="cursor-pointer">Esclusi ({diagnostics.excluded.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {diagnostics.excluded.slice(0, 20).map((e) => (
                    <li key={e.id} className="truncate">· {(e.title || e.id).slice(0, 60)} — {e.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
            Nessun Execution Package per questo filtro.
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((i) => {
            const run = getAutomationRun(i);
            const brain = i.brain_id ? brainMap.get(i.brain_id) : null;
            const review = reviewStatus(i);
            const pkg = pkgType(i);
            return (
              <div key={i.id} className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {brain?.name ?? "—"} · {pkg} · target: {run.target} · mode: {run.execution_mode}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      ultima modifica: {new Date(run.updated_at || i.updated_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(() => {
                      const m = (i.metadata as Record<string, unknown> | null) ?? {};
                      const rm = m.result_meta as { is_simulated?: boolean } | undefined;
                      const dry = (m.dry_run_last as { enabled?: boolean } | undefined) ?? (m.automation_run as { dry_run?: { enabled?: boolean } } | undefined)?.dry_run;
                      if (rm?.is_simulated || dry?.enabled) {
                        return <Badge className="bg-amber-500/20 text-amber-300 text-[10px] uppercase">DRY RUN / SIMULAZIONE</Badge>;
                      }
                      return null;
                    })()}
                    {i.content_type !== "execution_package" && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">
                        legacy package{import.meta.env.DEV && i.content_type ? ` (${i.content_type})` : ""}
                      </Badge>
                    )}
                    {i.risk_level && (
                      <Badge variant="outline" className="text-[10px]">risk: {i.risk_level}</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      pkg: {i.automation_status}
                    </Badge>
                    <Badge className={`text-[10px] ${RUN_BADGE[run.run_status]}`}>
                      run: {RUN_STATUS_LABELS[run.run_status]}
                    </Badge>
                    {review && (
                      <Badge variant="outline" className="text-[10px]">review: {review}</Badge>
                    )}
                    {run.retry_count > 0 && (
                      <Badge variant="outline" className="text-[10px]">retry: {run.retry_count}</Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(run.run_status === "draft" || i.automation_status === "da_approvare") && (
                    <Button size="sm" onClick={() => openApprove(i)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Approva esecuzione
                    </Button>
                  )}
                  {run.run_status === "approved" && (
                    <Button size="sm" onClick={() => doQueue(i)}>
                      <Workflow className="mr-1 h-3 w-3" /> Metti in coda
                    </Button>
                  )}
                  {run.run_status === "queued" && (
                    <Button size="sm" onClick={() => doStart(i)}>
                      <Play className="mr-1 h-3 w-3" /> Segna in esecuzione
                    </Button>
                  )}
                  {run.run_status === "running" && (
                    <>
                      <Button size="sm" onClick={() => setCompleteTarget(i)}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Completa run
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setFailTarget(i)}>
                        <AlertTriangle className="mr-1 h-3 w-3" /> Segna fallita
                      </Button>
                    </>
                  )}
                  {["queued", "approved"].includes(run.run_status) && (
                    <Button size="sm" variant="destructive" onClick={() => setFailTarget(i)}>
                      <AlertTriangle className="mr-1 h-3 w-3" /> Segna fallita
                    </Button>
                  )}
                  {["failed", "completed", "cancelled"].includes(run.run_status) && (
                    <Button size="sm" variant="outline" onClick={() => doRetry(i)}>
                      <RefreshCw className="mr-1 h-3 w-3" /> Riprova
                    </Button>
                  )}
                  {["draft", "approved", "queued", "running", "failed"].includes(run.run_status) && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelTarget(i)}>
                      <XCircle className="mr-1 h-3 w-3" /> Cancella
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setBlockTarget(i)}>
                    <Shield className="mr-1 h-3 w-3" /> Blocca
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copyPayload(i)}>
                    <Copy className="mr-1 h-3 w-3" /> Copia payload automazione
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPayloadTarget(i)}>
                    <FileJson className="mr-1 h-3 w-3" /> Vedi payload
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("automation:simulate-callback", {
                          detail: {
                            execution_package_id: i.id,
                            run_id: run.run_id,
                            status: "completed",
                            build_status: "not_verified",
                            console_errors: false,
                            modified_files: [],
                            summary: "",
                            notes: "",
                            external_result_reference: "",
                            raw_output: "",
                          },
                        }),
                      );
                    }}
                  >
                    <Inbox className="mr-1 h-3 w-3" /> Simula callback
                  </Button>
                </div>

                {run.last_error && (
                  <div className="rounded-md bg-red-500/5 px-2 py-1 text-[11px] text-red-300">
                    Ultimo errore: {run.last_error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Approve dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approva esecuzione</DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">{approveTarget.title}</div>
              <ChecklistRow
                label="Il prompt è completo?"
                checked={approveForm.promptComplete}
                onChange={(v) => setApproveForm((f) => ({ ...f, promptComplete: v }))}
              />
              <ChecklistRow
                label="Il risk level è accettabile?"
                checked={approveForm.riskAcceptable}
                onChange={(v) => setApproveForm((f) => ({ ...f, riskAcceptable: v }))}
              />
              <ChecklistRow
                label="Aree protette indicate?"
                checked={approveForm.protectedAreasNoted}
                onChange={(v) => setApproveForm((f) => ({ ...f, protectedAreasNoted: v }))}
              />
              <ChecklistRow
                label="Criteri di successo presenti?"
                checked={approveForm.successCriteriaPresent}
                onChange={(v) => setApproveForm((f) => ({ ...f, successCriteriaPresent: v }))}
              />
              <ChecklistRow
                label="Output atteso chiaro?"
                checked={approveForm.expectedOutputClear}
                onChange={(v) => setApproveForm((f) => ({ ...f, expectedOutputClear: v }))}
              />
              <ChecklistRow
                label="Target automazione corretto?"
                checked={approveForm.targetCorrect}
                onChange={(v) => setApproveForm((f) => ({ ...f, targetCorrect: v }))}
              />
              <ChecklistRow
                label="Serve intervento umano prima?"
                checked={approveForm.humanNeeded}
                onChange={(v) => setApproveForm((f) => ({ ...f, humanNeeded: v }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Target</div>
                  <Input
                    value={approveForm.target}
                    onChange={(e) => setApproveForm((f) => ({ ...f, target: e.target.value }))}
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Execution mode</div>
                  <Select
                    value={approveForm.execution_mode}
                    onValueChange={(v) =>
                      setApproveForm((f) => ({ ...f, execution_mode: v as ExecutionMode }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual_copy">manual_copy</SelectItem>
                      <SelectItem value="semi_automatic">semi_automatic</SelectItem>
                      <SelectItem value="n8n_webhook">n8n_webhook</SelectItem>
                      <SelectItem value="playwright_browser">playwright_browser</SelectItem>
                      <SelectItem value="external_agent">external_agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {approveTarget.risk_level === "alto" && (
                <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2">
                  <ChecklistRow
                    label="Confermo: questo Execution Package è ad alto rischio."
                    checked={approveForm.confirmHighRisk}
                    onChange={(v) => setApproveForm((f) => ({ ...f, confirmHighRisk: v }))}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Annulla</Button>
            <Button onClick={doApprove} disabled={mutate.isPending}>Approva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete dialog */}
      <Dialog open={!!completeTarget} onOpenChange={(o) => !o && setCompleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Completa run</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Note esecuzione</div>
              <Textarea
                rows={3}
                value={completeForm.notes}
                onChange={(e) => setCompleteForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Riferimento risultato esterno (opzionale)</div>
              <Input
                value={completeForm.reference}
                onChange={(e) => setCompleteForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteTarget(null)}>Annulla</Button>
            <Button onClick={doComplete} disabled={mutate.isPending}>Conferma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fail dialog */}
      <Dialog open={!!failTarget} onOpenChange={(o) => !o && setFailTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Segna run fallita</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Errore principale</div>
              <Input
                value={failForm.error}
                onChange={(e) => setFailForm((f) => ({ ...f, error: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Note</div>
              <Textarea
                rows={3}
                value={failForm.notes}
                onChange={(e) => setFailForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailTarget(null)}>Annulla</Button>
            <Button variant="destructive" onClick={doFail} disabled={mutate.isPending}>Segna fallita</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancella run</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <Textarea
              rows={3}
              placeholder="Note (opzionale)"
              value={cancelNotes}
              onChange={(e) => setCancelNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Indietro</Button>
            <Button onClick={doCancel} disabled={mutate.isPending}>Conferma cancellazione</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block dialog */}
      <Dialog open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Blocca run</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <Textarea
              rows={3}
              placeholder="Motivo blocco"
              value={blockNotes}
              onChange={(e) => setBlockNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)}>Indietro</Button>
            <Button onClick={doBlock} disabled={mutate.isPending}>Blocca</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payload preview */}
      <Dialog open={!!payloadTarget} onOpenChange={(o) => !o && setPayloadTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Payload futuro automazione</DialogTitle></DialogHeader>
          {payloadTarget && (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
{JSON.stringify(
  buildAutomationPayload(payloadTarget, {
    brain_name: payloadTarget.brain_id ? brainMap.get(payloadTarget.brain_id)?.name ?? null : null,
  }),
  null,
  2,
)}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayloadTarget(null)}>Chiudi</Button>
            <Button onClick={() => payloadTarget && copyPayload(payloadTarget)}>
              <Copy className="mr-1 h-3 w-3" /> Copia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ChecklistRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{label}</span>
    </label>
  );
}

// Silence unused-import lint when default values change
export const _DEFAULT_RUN = defaultAutomationRun;
