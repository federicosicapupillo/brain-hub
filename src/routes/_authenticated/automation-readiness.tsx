import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listWorkflows } from "@/lib/n8n-workflows";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, CheckCircle2, ShieldAlert, XCircle, Zap, Plug } from "lucide-react";
import {
  READINESS_MATRIX,
  AUTOMATION_LEVEL_LABEL,
  AUTOMATION_LEVEL_TONE,
  EXECUTION_METHOD_LABEL,
  PERMISSION_LABEL,
  VERIFICATION_LABEL,
  FUTURE_INTEGRATIONS,
  summarizeReadiness,
  type ReadinessEntry,
  type AutomationLevel,
  type ExecutionMethod,
} from "@/lib/automation-readiness";
import { RISK_TONE } from "@/lib/action-queue";

export const Route = createFileRoute("/_authenticated/automation-readiness")({
  component: AutomationReadinessPage,
});

function AutomationReadinessPage() {
  const [risk, setRisk] = useState<string>("all");
  const [level, setLevel] = useState<string>("all");
  const [method, setMethod] = useState<string>("all");
  const [ready, setReady] = useState<string>("all");
  const [tool, setTool] = useState<string>("");
  const [detail, setDetail] = useState<ReadinessEntry | null>(null);

  const { data: workflows = [] } = useQuery({
    queryKey: ["n8n-workflows-all"],
    queryFn: () => listWorkflows(),
  });
  const workflowCoverage = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workflows) {
      for (const t of w.linked_action_types ?? []) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return m;
  }, [workflows]);

  const filtered = useMemo(() => {
    return READINESS_MATRIX.filter((e) => {
      if (risk !== "all" && e.risk_level !== risk) return false;
      if (level !== "all" && e.automation_level_current !== level) return false;
      if (method !== "all" && e.execution_method !== method) return false;
      if (ready === "ready" && !e.is_ready_for_automation) return false;
      if (ready === "not_ready" && e.is_ready_for_automation) return false;
      if (tool && !(e.required_tool ?? "").toLowerCase().includes(tool.toLowerCase()))
        return false;
      return true;
    });
  }, [risk, level, method, ready, tool]);

  const summary = useMemo(() => summarizeReadiness(), []);
  const internalReady = READINESS_MATRIX.filter(
    (e) =>
      e.is_ready_for_automation &&
      (e.execution_method === "internal_app" || e.execution_method === "browser_bridge"),
  );
  const futureNeeded = READINESS_MATRIX.filter(
    (e) =>
      e.automation_level_future === "external_connector_required" ||
      e.execution_method === "n8n_workflow" ||
      e.execution_method === "external_api" ||
      e.execution_method === "telegram_approval" ||
      e.execution_method === "playwright_browser_use",
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Automation Readiness Matrix"
        subtitle="Quali azioni Brain Hub può automatizzare, quali richiedono conferma, quali richiedono integrazioni esterne."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Tile label="Totali" value={summary.total} />
        <Tile label="Pronte ora" value={summary.ready_now} tone="green" />
        <Tile label="Approvazione" value={summary.approval_required} tone="amber" />
        <Tile label="Connettore" value={summary.external_connector_required} tone="violet" />
        <Tile label="Non automatizzabili" value={summary.not_automatable} tone="red" />
        <Tile label="Bloccate permessi" value={summary.blocked_by_permission} tone="amber" />
        <Tile label="Pronte futuro n8n" value={summary.future_n8n_ready} tone="sky" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtri</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger><SelectValue placeholder="Rischio" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i rischi</SelectItem>
                <SelectItem value="low">Basso</SelectItem>
                <SelectItem value="medium">Medio</SelectItem>
                <SelectItem value="high">Alto</SelectItem>
              </SelectContent>
            </Select>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger><SelectValue placeholder="Livello" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i livelli</SelectItem>
                {Object.entries(AUTOMATION_LEVEL_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue placeholder="Esecuzione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i metodi</SelectItem>
                {Object.entries(EXECUTION_METHOD_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ready} onValueChange={setReady}>
              <SelectTrigger><SelectValue placeholder="Pronto?" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="ready">Pronte</SelectItem>
                <SelectItem value="not_ready">Non pronte</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Tool richiesto…" value={tool} onChange={(e) => setTool(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matrice azioni ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.map((e) => (
            <div
              key={e.action_type}
              className="grid grid-cols-1 gap-2 rounded border border-border/60 bg-background/40 p-3 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-3">
                <div className="font-medium">{e.label}</div>
                <div className="text-[11px] text-muted-foreground">{e.action_type}</div>
              </div>
              <div className="md:col-span-1">
                <Badge variant="outline" className={RISK_TONE[e.risk_level]}>{e.risk_level}</Badge>
              </div>
              <div className="md:col-span-2">
                <Badge variant="outline" className={AUTOMATION_LEVEL_TONE[e.automation_level_current]}>
                  {AUTOMATION_LEVEL_LABEL[e.automation_level_current]}
                </Badge>
              </div>
              <div className="md:col-span-2 text-xs text-muted-foreground">
                {EXECUTION_METHOD_LABEL[e.execution_method]}
              </div>
              <div className="md:col-span-2 text-xs">
                {e.required_tool ? (
                  <span className="flex items-center gap-1">
                    <Plug className="h-3 w-3" /> {e.required_tool}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="md:col-span-1">
                {e.is_ready_for_automation ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Sì
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600">
                    <XCircle className="mr-1 h-3 w-3" /> No
                  </Badge>
                )}
              </div>
              <div className="md:col-span-1 flex justify-end gap-1">
                {e.cta_route && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={e.cta_route}>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setDetail(e)}>
                  Dettaglio
                </Button>
              </div>
              {e.blocking_reason && (
                <div className="md:col-span-12 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700">
                  <ShieldAlert className="h-3 w-3" /> {e.blocking_reason}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-emerald-500" /> Pronte per automazione interna
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {internalReady.map((e) => (
              <div key={e.action_type} className="flex items-center justify-between text-sm">
                <span>{e.label}</span>
                <Badge variant="outline" className={AUTOMATION_LEVEL_TONE[e.automation_level_future]}>
                  → {AUTOMATION_LEVEL_LABEL[e.automation_level_future]}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4 w-4 text-violet-500" /> Richiedono integrazioni future
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              {futureNeeded.map((e) => (
                <div key={e.action_type} className="flex items-center justify-between text-sm">
                  <span>{e.label}</span>
                  <span className="text-xs text-muted-foreground">{e.required_tool ?? "—"}</span>
                </div>
              ))}
            </div>
            <div className="rounded border border-border/60 bg-background/40 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tool futuri</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {FUTURE_INTEGRATIONS.map((f) => (
                  <Badge key={f.tool} variant="outline" className="text-[10px]" title={f.reason}>
                    {f.tool}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.label}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{detail.description}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Rischio" value={detail.risk_level} />
                <Field label="Livello attuale" value={AUTOMATION_LEVEL_LABEL[detail.automation_level_current]} />
                <Field label="Livello futuro" value={AUTOMATION_LEVEL_LABEL[detail.automation_level_future]} />
                <Field label="Esecuzione" value={EXECUTION_METHOD_LABEL[detail.execution_method]} />
                <Field label="Permesso" value={PERMISSION_LABEL[detail.permission_required]} />
                <Field label="Verifica" value={VERIFICATION_LABEL[detail.verification_method]} />
                <Field label="Tool richiesto" value={detail.required_tool ?? "—"} />
                <Field label="Pronto" value={detail.is_ready_for_automation ? "Sì" : "No"} />
              </div>
              {detail.blocking_reason && (
                <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                  <div className="font-semibold">Cosa blocca l'automazione</div>
                  <div className="text-muted-foreground">{detail.blocking_reason}</div>
                </div>
              )}
              {detail.next_setup_action && (
                <div className="rounded border border-border/60 bg-background/40 p-2 text-xs">
                  <div className="font-semibold">Prossimo setup</div>
                  <div className="text-muted-foreground">{detail.next_setup_action}</div>
                </div>
              )}
              {detail.required_tool && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/tool-connections">
                    Apri Tool Connections <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" | "violet" | "sky" }) {
  const cls =
    tone === "green" ? "border-emerald-500/30 bg-emerald-500/5"
    : tone === "amber" ? "border-amber-500/30 bg-amber-500/5"
    : tone === "red" ? "border-red-500/30 bg-red-500/5"
    : tone === "violet" ? "border-violet-500/30 bg-violet-500/5"
    : tone === "sky" ? "border-sky-500/30 bg-sky-500/5"
    : "border-border/60 bg-background/40";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
