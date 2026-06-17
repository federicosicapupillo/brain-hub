import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, PlayCircle, ShieldAlert, FileCheck2, History } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { listWorkflowsForActionType, type N8nWorkflow } from "@/lib/n8n-workflows";
import { executeN8nRealWorkflow, createReviewFromN8nLog } from "@/lib/n8n-real-execution.functions";
import { getN8nHmacSecretStatus } from "@/lib/n8n-hmac.functions";
import { DEFAULT_HMAC_SECRET_ENV_KEY } from "@/lib/n8n-hmac";
import {
  getRecentN8nRealExecutionsForWorkflow,
  logN8nRealExecutionEvent,
  type N8nRealLogRow,
} from "@/lib/n8n-real-execution";
import type { AutomationAction } from "@/lib/action-queue";

const DUPLICATE_WINDOW_MS = 30_000;

export function N8nRealExecutionPanel({ action }: { action: AutomationAction }) {
  const qc = useQueryClient();
  const exec = useServerFn(executeN8nRealWorkflow);
  const review = useServerFn(createReviewFromN8nLog);
  const hmacStatusFn = useServerFn(getN8nHmacSecretStatus);
  const [running, setRunning] = useState(false);
  const [lastLogId, setLastLogId] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["n8n-workflows-for-action-type", action.action_type, action.brain_id],
    queryFn: () => listWorkflowsForActionType(action.action_type, action.brain_id ?? undefined),
  });

  const wf: N8nWorkflow | undefined = workflows.find((w) => w.real_execution_enabled) ?? workflows[0];

  const { data: recentLogs = [] } = useQuery<N8nRealLogRow[]>({
    queryKey: ["n8n-real-recent-logs", wf?.id, action.id, lastLogId],
    enabled: !!wf?.id,
    queryFn: () => getRecentN8nRealExecutionsForWorkflow(wf!.id, 3),
  });

  const hmacEnvKey = wf?.hmac_secret_env_key || DEFAULT_HMAC_SECRET_ENV_KEY;
  const hmacEnabled = !!wf?.hmac_signing_enabled;
  const { data: hmacStatus } = useQuery({
    queryKey: ["n8n-hmac-secret-status-panel", hmacEnvKey],
    enabled: !!wf,
    queryFn: () => hmacStatusFn({ data: { env_keys: [hmacEnvKey] } }),
  });
  const hmacSecretConfigured = !!hmacStatus?.configured?.[hmacEnvKey];
  const hmacBlocked = hmacEnabled && !hmacSecretConfigured;

  const enabled = !!wf?.real_execution_enabled;
  const env = wf?.webhook_environment ?? "test";
  const targetUrl =
    wf && (env === "production" ? wf.webhook_production_url : wf.webhook_test_url) || wf?.webhook_url || null;
  const hasUrl = !!targetUrl;
  const isHighRisk = (action.risk_level ?? wf?.risk_level ?? "").toLowerCase() === "high";
  const requiresApproval = !!wf?.requires_telegram_approval || isHighRisk;
  const approved =
    (action.metadata as Record<string, unknown> | null)?.telegram_approval_status === "approved";
  const blocked = requiresApproval && !approved;

  const lastReal = recentLogs[0];
  const recentlyRan =
    lastReal && Date.now() - new Date(lastReal.created_at).getTime() < DUPLICATE_WINDOW_MS;

  async function run() {
    if (!wf || running) return;
    if (
      !window.confirm(
        "Stai per chiamare un workflow n8n reale. Questa azione può produrre effetti esterni. Confermi?",
      )
    )
      return;
    if (recentlyRan) {
      const okDup = window.confirm(
        "Hai già eseguito questo workflow da poco. Vuoi continuare?",
      );
      if (!okDup) return;
      void logN8nRealExecutionEvent(
        "n8n_real_execution_duplicate_run_confirmed",
        `Run reale duplicata confermata per ${wf.workflow_name}`,
        { workflow_id: wf.id, action_id: action.id },
      );
    }
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
      void qc.invalidateQueries({ queryKey: ["n8n-real-recent-logs"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function makeReview(logId: string) {
    try {
      const res = await review({ data: { log_id: logId } });
      toast.success("Result Review creata");
      void qc.invalidateQueries({ queryKey: ["result-reviews"] });
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  useEffect(() => {
    if (!enabled) return;
    if (!hasUrl) {
      void logN8nRealExecutionEvent(
        "n8n_real_execution_environment_validation_failed",
        `URL ambiente ${env} mancante per ${wf?.workflow_name ?? "workflow"}`,
        { workflow_id: wf?.id, environment: env },
      );
    }
  }, [enabled, hasUrl, env, wf?.id, wf?.workflow_name]);

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
          <Badge variant="outline">{env}</Badge>
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
          <Badge
            variant="outline"
            className={
              hmacEnabled
                ? hmacSecretConfigured
                  ? "border-emerald-500/40 text-emerald-600"
                  : "border-red-500/40 text-red-600"
                : "border-slate-500/40 text-slate-600"
            }
          >
            HMAC {hmacEnabled ? (hmacSecretConfigured ? "ON · secret OK" : "ON · secret missing") : "OFF"}
          </Badge>
        </div>

        {!enabled && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <AlertTriangle className="h-3 w-3" /> Esecuzione reale non abilitata per questo workflow.
          </div>
        )}
        {enabled && !hasUrl && (
          <div className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Webhook URL mancante per l'ambiente "{env}".
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
        {recentlyRan && (
          <div className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Run eseguita meno di 30s fa.
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
            <Button size="sm" variant="outline" onClick={() => makeReview(lastLogId)}>
              <FileCheck2 className="mr-1 h-3 w-3" /> Crea Result Review
            </Button>
          )}
        </div>

        {lastOk !== null && (
          <div className="rounded border border-border/60 bg-background/40 p-2 text-[11px]">
            Receipt: {lastOk ? "OK" : "FAIL"} · HTTP {lastStatus ?? "?"} · log {lastLogId?.slice(0, 8)}
          </div>
        )}

        {env === "production" && (
          <div className="flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Ambiente production attivo.
          </div>
        )}

        {recentLogs.length > 0 && (
          <div className="rounded border border-border/50 bg-background/30 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <History className="h-3 w-3" /> Ultimi log reali
            </div>
            <ul className="space-y-1 text-[11px]">
              {recentLogs.map((log) => {
                const duration =
                  (log.metadata as { duration_ms?: number } | null)?.duration_ms ?? null;
                return (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-center gap-2 border-t border-border/30 pt-1 first:border-t-0 first:pt-0"
                  >
                    <Badge
                      variant="outline"
                      className={
                        log.success
                          ? "border-emerald-500/40 text-emerald-600"
                          : "border-red-500/40 text-red-600"
                      }
                    >
                      {log.success ? "ok" : "fail"}
                    </Badge>
                    <span>HTTP {log.response_status ?? "?"}</span>
                    {duration !== null && <span>{duration}ms</span>}
                    <span className="text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-2 text-[11px]"
                      onClick={() => {
                        void logN8nRealExecutionEvent(
                          "n8n_real_execution_recent_log_opened",
                          `Log reale aperto: ${log.id}`,
                          { log_id: log.id, workflow_id: wf.id },
                        );
                        void makeReview(log.id);
                      }}
                    >
                      <FileCheck2 className="mr-1 h-3 w-3" /> Crea review
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
