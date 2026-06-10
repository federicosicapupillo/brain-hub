import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FlaskConical, PlayCircle, AlertTriangle, CheckCircle2, ShieldAlert, Activity, Undo2 } from "lucide-react";
import {
  getAutomationRun,
  RUN_STATUS_LABELS,
  type DryRunMeta,
  type ItemLike,
} from "@/lib/automation-run";
import {
  DRY_RUN_SCENARIO_LABELS,
  isDryRunEligible,
  runDryRunScenario,
  restoreDryRunSnapshot,
  hasRealResult,
  type DryRunResult,
  type DryRunScenario,
} from "@/lib/dry-run";

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  automation_status: string | null;
  risk_level: string | null;
  output_result: string | null;
  updated_at: string;
};

type ExecLog = {
  id: string;
  clipboard_item_id: string | null;
  action: string;
  notes: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

const SCENARIO_ORDER: DryRunScenario[] = [
  "success_complete",
  "success_warning",
  "build_failed",
  "partial",
  "protected_areas",
  "invalid_callback",
];

const SCENARIO_DESC: Record<DryRunScenario, string> = {
  success_complete: "Run completata, build ok, console pulita, output coerente.",
  success_warning: "Build ok ma warning console: review consigliata.",
  build_failed: "Build fallita: run.failed + last_error valorizzato.",
  partial: "Modifica incompleta: review_status partial.",
  protected_areas: "Aree protette toccate: blocca loop o fix prompt.",
  invalid_callback: "Callback con run_id errato: validazione fallisce, nessuna modifica.",
};

async function fetchDryRunData() {
  const [itemsRes, logsRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,title,content,content_type,target_tool,automation_status,risk_level,metadata,output_result,updated_at",
      )
      .eq("content_type", "execution_package")
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("clipboard_execution_logs")
      .select("id,clipboard_item_id,action,notes,created_at,metadata")
      .in("action", [
        "automation_dry_run_started",
        "automation_dry_run_completed",
        "automation_dry_run_failed",
        "automation_dry_run_blocked",
        "automation_dry_run_restored",
      ] as never)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (logsRes.error) throw logsRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    logs: (logsRes.data ?? []) as ExecLog[],
  };
}

function dryRunMeta(i: ClipItem): DryRunMeta | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const direct = m.dry_run_last as DryRunMeta | undefined;
  if (direct?.enabled) return direct;
  const r = m.automation_run as { dry_run?: DryRunMeta } | undefined;
  return r?.dry_run ?? null;
}

export function DryRunOrchestrator() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["dry-run-orchestrator"],
    queryFn: fetchDryRunData,
    refetchInterval: 20000,
  });
  const [target, setTarget] = useState<ClipItem | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);

  const eligible = useMemo(
    () => (data?.items ?? []).filter((i) => isDryRunEligible(i)),
    [data],
  );

  const stats = useMemo(() => {
    const logs = data?.logs ?? [];
    const items = data?.items ?? [];
    const startedIds = new Set<string>();
    const completed: ExecLog[] = [];
    const failed: ExecLog[] = [];
    const blocked: ExecLog[] = [];
    const errors: string[] = [];
    for (const l of logs) {
      if (l.action === "automation_dry_run_started" && l.clipboard_item_id) startedIds.add(l.clipboard_item_id);
      if (l.action === "automation_dry_run_completed") completed.push(l);
      if (l.action === "automation_dry_run_failed") {
        failed.push(l);
        if (errors.length < 5 && l.notes) errors.push(l.notes);
      }
      if (l.action === "automation_dry_run_blocked") blocked.push(l);
    }
    const untested = items.filter((i) => !dryRunMeta(i));
    return {
      executed: startedIds.size,
      completed: completed.length,
      failed: failed.length,
      blocked: blocked.length,
      lastErrors: errors,
      untestedCount: untested.length,
    };
  }, [data]);

  const runMut = useMutation({
    mutationFn: async ({ item, scenario, allowDup }: { item: ClipItem; scenario: DryRunScenario; allowDup: boolean }) => {
      return runDryRunScenario(item, scenario, { allowRecentDup: allowDup });
    },
    onSuccess: (r: DryRunResult) => {
      const label = DRY_RUN_SCENARIO_LABELS[r.scenario];
      if (r.result === "success") toast.success(`Dry run "${label}" — success`);
      else if (r.result === "warning") toast.warning(`Dry run "${label}" — warning`);
      else if (r.result === "blocked") toast.error(`Dry run "${label}" — bloccato`);
      else toast.error(`Dry run "${label}" — failed`);
      setTarget(null);
      setConfirmDup(false);
      qc.invalidateQueries({ queryKey: ["dry-run-orchestrator"] });
      qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
      qc.invalidateQueries({ queryKey: ["automation-control"] });
      qc.invalidateQueries({ queryKey: ["callback-inbox-items"] });
      qc.invalidateQueries({ queryKey: ["project-loop"] });
    },
    onError: (e: Error, vars) => {
      if (/Dry run recente/.test(e.message) && !vars.allowDup) {
        const ok = window.confirm(`${e.message}\n\nVuoi rieseguirlo lo stesso?`);
        if (ok) {
          setConfirmDup(true);
          runMut.mutate({ ...vars, allowDup: true });
          return;
        }
      }
      toast.error(e.message);
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Stato test automazione
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Dry run eseguiti" value={stats.executed} />
            <StatTile label="Completati" value={stats.completed} tone="text-emerald-300" />
            <StatTile label="Falliti" value={stats.failed} tone="text-red-300" />
            <StatTile label="Bloccati" value={stats.blocked} tone="text-fuchsia-300" />
            <StatTile label="Non testati" value={stats.untestedCount} tone="text-amber-300" />
          </div>
          {stats.lastErrors.length > 0 && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300">
              <div className="mb-1 font-medium">Ultimi errori dry run</div>
              <ul className="list-disc pl-4">
                {stats.lastErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" /> Dry Run Orchestrator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Simula internamente l&apos;intero ciclo Brain Hub su un Execution Package. Nessuna chiamata esterna, nessun webhook reale.
          </p>
          {eligible.length === 0 && (
            <div className="text-sm text-muted-foreground">Nessun Execution Package eleggibile per dry run.</div>
          )}
          {eligible.map((i) => {
            const run = getAutomationRun(i);
            const dry = dryRunMeta(i);
            return (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">run: {RUN_STATUS_LABELS[run.run_status]}</Badge>
                    {i.risk_level && (
                      <Badge variant="outline" className="text-[10px]">risk: {i.risk_level}</Badge>
                    )}
                    {dry && (
                      <Badge variant="outline" className="text-[10px]">
                        ultimo dry run: {DRY_RUN_SCENARIO_LABELS[dry.scenario as DryRunScenario] ?? dry.scenario} ({dry.result})
                      </Badge>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setConfirmDup(false); setTarget(i); }}>
                  <PlayCircle className="mr-1 h-3 w-3" /> Esegui dry run
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setConfirmDup(false); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> Dry Run Automazione
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border/60 p-2">
                <div className="font-medium">{target.title}</div>
                <div className="text-xs text-muted-foreground">
                  run: {RUN_STATUS_LABELS[getAutomationRun(target).run_status]} · {target.risk_level ?? "no risk"}
                </div>
              </div>
              <div className="grid gap-2">
                {SCENARIO_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={runMut.isPending}
                    onClick={() => runMut.mutate({ item: target, scenario: s, allowDup: confirmDup })}
                    className="rounded-md border border-border/60 p-2 text-left hover:bg-muted/40 disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {s === "success_complete" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                      {s === "success_warning" && <AlertTriangle className="h-3 w-3 text-amber-300" />}
                      {s === "build_failed" && <AlertTriangle className="h-3 w-3 text-red-400" />}
                      {s === "partial" && <AlertTriangle className="h-3 w-3 text-amber-300" />}
                      {s === "protected_areas" && <ShieldAlert className="h-3 w-3 text-fuchsia-300" />}
                      {s === "invalid_callback" && <ShieldAlert className="h-3 w-3 text-red-400" />}
                      {DRY_RUN_SCENARIO_LABELS[s]}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{SCENARIO_DESC[s]}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Nessuna chiamata esterna, n8n, Playwright o browser. Simulazione locale completa.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={runMut.isPending}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
