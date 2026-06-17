import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, PlayCircle, ShieldAlert, FileCheck2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { listWorkflowsForActionType, type N8nWorkflow } from "@/lib/n8n-workflows";
import { executeN8nRealWorkflow, createReviewFromN8nLog } from "@/lib/n8n-real-execution.functions";
import type { AutomationAction } from "@/lib/action-queue";

export function N8nRealExecutionPanel({ action }: { action: AutomationAction }) {
  const qc = useQueryClient();
  const exec = useServerFn(executeN8nRealWorkflow);
  const review = useServerFn(createReviewFromN8nLog);
  const [running, setRunning] = useState(false);
  const [lastLogId, setLastLogId] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["n8n-workflows-for-action-type", action.action_type, action.brain_id],
    queryFn: () => listWorkflowsForActionType(action.action_type, action.brain_id ?? undefined),
  });

  const wf: N8nWorkflow | undefined = workflows.find((w) => w.real_execution_enabled) ?? workflows[0];
  const enabled = !!wf?.real_execution_enabled;
  const hasUrl =
    !!wf &&
    !!(
      (wf.webhook_environment === "production" ? wf.webhook_production_url : wf.webhook_test_url) ??
      wf.webhook_url
    );
  const isHighRisk = (action.risk_level ?? wf?.risk_level ?? "").toLowerCase() === "high";
  const requiresApproval = !!wf?.requires_telegram_approval || isHighRisk;
  const approved =
    (action.metadata as Record<string, unknown> | null)?.telegram_approval_status === "approved";
  const blocked = requiresApproval && !approved;

  async function run() {
    if (!wf) return;
    if (
      !window.confirm(
        "Stai per chiamare un workflow n8n reale. Questa azione può produrre effetti esterni. Confermi?",
      )
    )
      return;
    setRunning(true);
    try {
      const res = await exec({
        data: { workflow_id: wf.id, action_id: action.id, confirm: true as const },
      });
      setLastLogId(res.log_id);
      setLastOk(res.ok);
      setLastStatus(res.http_status);
      if (res.ok) toast.success(`Workflow eseguito (HTTP ${res.http_status})`);
      else toast.error(`Esecuzione fallita: ${res.error_text ?? `HTTP ${res.http_status}`}`);
      void qc.invalidateQueries({ queryKey: ["n8n-workflows-for-action-type"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function makeReview() {
    if (!lastLogId) return;
    try {
      const res = await review({ data: { log_id: lastLogId } });
      toast.success("Result Review creata");
      void qc.invalidateQueries({ queryKey: ["result-reviews"] });
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  if (!wf) return null;

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PlayCircle className="h-4 w-4" /> Esecuzione reale n8n
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{wf.workflow_name}</span>
          <Badge variant="outline">{wf.webhook_environment ?? "test"}</Badge>
          <Badge variant="outline">{(action.risk_level ?? wf.risk_level).toUpperCase()}</Badge>
          {wf.last_real_execution_status && (
            <Badge
              variant="outline"
              className={
                wf.last_real_execution_status === "ok"
                  ? "border-emerald-500/40 text-emerald-600"
                  : "border-red-500/40 text-red-600"
              }
            >
              ultimo: {wf.last_real_execution_status}
            </Badge>
          )}
        </div>

        {!enabled && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <AlertTriangle className="h-3 w-3" /> Esecuzione reale non abilitata per questo workflow.
          </div>
        )}
        {enabled && !hasUrl && (
          <div className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Webhook URL mancante per l'ambiente selezionato.
          </div>
        )}
        {blocked && (
          <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-red-600">
            <div className="flex items-center gap-1 font-medium">
              <ShieldAlert className="h-3 w-3" /> Bloccato: serve approvazione Telegram approvata.
            </div>
            <Link to="/telegram-approvals" className="underline">
              Apri Telegram Approval
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={run}
            disabled={running || !enabled || !hasUrl || blocked}
            variant={isHighRisk ? "destructive" : "default"}
          >
            <PlayCircle className="mr-1 h-3 w-3" />
            {running ? "Esecuzione…" : "Esegui reale n8n"}
          </Button>
          {lastLogId && (
            <Button size="sm" variant="outline" onClick={makeReview}>
              <FileCheck2 className="mr-1 h-3 w-3" /> Crea Result Review
            </Button>
          )}
        </div>

        {lastOk !== null && (
          <div className="rounded border border-border/60 bg-background/40 p-2 text-[11px]">
            Receipt: {lastOk ? "OK" : "FAIL"} · HTTP {lastStatus ?? "?"} · log {lastLogId?.slice(0, 8)}
          </div>
        )}

        {wf.webhook_environment === "production" && (
          <div className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Ambiente production attivo.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
