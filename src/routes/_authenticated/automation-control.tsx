import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Bot, Workflow, Gauge, AlertTriangle, CheckCircle2, Clock, Plug, ListChecks, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/automation-control")({
  component: AutomationControlPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Pagina non trovata.</div>,
});

type ClipboardItem = {
  id: string;
  title: string;
  target_tool: string;
  source_tool: string;
  status: string;
  approval_status: string;
  automation_status: string;
  automation_attempts: number;
  automation_connector_id: string | null;
  human_review_required: boolean;
  risk_level: string | null;
  output_result: string;
  updated_at: string;
  automation_completed_at: string | null;
  project_tool_link_id: string | null;
};

type ExecLog = {
  id: string;
  clipboard_item_id: string | null;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  notes: string | null;
  created_at: string;
};


type Connector = {
  id: string;
  name: string;
  type: string;
  target_tool: string;
  is_active: boolean;
  webhook_url: string | null;
};


async function fetchAll() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [itemsRes, logsRes, connectorsRes, tasksRes, roadmapRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,title,target_tool,source_tool,status,approval_status,automation_status,automation_attempts,automation_connector_id,human_review_required,risk_level,output_result,updated_at,automation_completed_at,project_tool_link_id"
      )
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("clipboard_execution_logs")
      .select("id,clipboard_item_id,action,previous_status,new_status,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("automation_connectors")
      .select("id,name,type,target_tool,is_active,webhook_url")
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id", { count: "exact", head: true }),
    supabase.from("roadmap_items").select("id", { count: "exact", head: true }),
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (connectorsRes.error) throw connectorsRes.error;

  return {
    items: (itemsRes.data ?? []) as ClipboardItem[],
    logs: (logsRes.data ?? []) as ExecLog[],
    connectors: (connectorsRes.data ?? []) as Connector[],
    tasksCount: tasksRes.count ?? 0,
    roadmapCount: roadmapRes.count ?? 0,
    todayStart: todayStart.toISOString(),
  };
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof Activity; tone?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid h-10 w-10 place-items-center rounded-lg bg-muted ${tone ?? ""}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function AutomationControlPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["automation-control"],
    queryFn: fetchAll,
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  if (!data) return null;

  const { items, logs, connectors, tasksCount, todayStart } = data;

  const toApprove = items.filter((i) => i.human_review_required && i.approval_status !== "approved" && i.approval_status !== "blocked").length;
  const ready = items.filter((i) => i.automation_status === "ready_for_automation").length;
  const queued = items.filter((i) => i.automation_status === "queued").length;
  const running = items.filter((i) => i.automation_status === "running").length;
  const failed = items.filter((i) => i.automation_status === "failed").length;
  const completedToday = items.filter(
    (i) => i.automation_status === "done" && i.automation_completed_at && i.automation_completed_at >= todayStart
  ).length;
  const activeConnectors = connectors.filter((c) => c.is_active).length;

  const approvalQueue = items.filter((i) => i.human_review_required).slice(0, 10);
  const automationQueue = items.filter((i) =>
    ["ready_for_automation", "queued", "running", "failed"].includes(i.automation_status)
  ).slice(0, 15);
  const recentOutputs = items
    .filter((i) => (i.status === "used" || i.automation_status === "done") && i.output_result && i.output_result.trim() !== "")
    .slice(0, 10);

  const connectorMap = new Map(connectors.map((c) => [c.id, c]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Automation Control</h1>
          <p className="text-sm text-muted-foreground">
            Sala di controllo centrale per Clipboard AI e future automazioni Brain Hub.
          </p>
        </div>
        <Button asChild variant="default" size="sm">
          <Link to="/clipboard-ai">
            <ExternalLink className="mr-2 h-4 w-4" /> Apri Clipboard AI
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Da approvare" value={toApprove} icon={AlertTriangle} />
        <StatCard label="Pronti automazione" value={ready} icon={Workflow} />
        <StatCard label="In coda" value={queued} icon={Clock} />
        <StatCard label="In esecuzione" value={running} icon={Activity} />
        <StatCard label="Falliti" value={failed} icon={AlertTriangle} />
        <StatCard label="Completati oggi" value={completedToday} icon={CheckCircle2} />
        <StatCard label="Connector attivi" value={activeConnectors} icon={Plug} />
        <StatCard label="Task generati" value={tasksCount} icon={ListChecks} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Approval Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {approvalQueue.length === 0 && <div className="text-sm text-muted-foreground">Nessun item in attesa.</div>}
            {approvalQueue.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                  <div className="text-xs text-muted-foreground">{i.target_tool || i.source_tool}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {i.risk_level && <Badge variant="outline" className="text-[10px]">{i.risk_level}</Badge>}
                  <Badge variant="secondary" className="text-[10px]">{i.approval_status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" /> Automation Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {automationQueue.length === 0 && <div className="text-sm text-muted-foreground">Coda vuota.</div>}
            {automationQueue.map((i) => {
              const c = i.automation_connector_id ? connectorMap.get(i.automation_connector_id) : null;
              return (
                <div key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {i.target_tool}{c ? ` · ${c.name}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">tent. {i.automation_attempts}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{i.automation_status}</Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Recent Execution Logs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {logs.length === 0 && <div className="text-sm text-muted-foreground">Nessun log.</div>}
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 p-2 text-xs">
              <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
              <Badge variant="outline" className="text-[10px]">{l.action}</Badge>
              <span className="font-mono text-[10px] text-muted-foreground">{(l.clipboard_item_id ?? "connector").slice(0, 10)}</span>
              {(l.previous_status || l.new_status) && (
                <span className="text-muted-foreground">
                  {l.previous_status ?? "—"} → {l.new_status ?? "—"}
                </span>
              )}
              {l.notes && <span className="truncate text-muted-foreground">· {l.notes}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4 w-4" /> Connectors Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {connectors.length === 0 && <div className="text-sm text-muted-foreground">Nessun connector.</div>}
            {connectors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.type} · {c.target_tool}</div>
                </div>
                <Badge variant={c.is_active ? "default" : "secondary"} className="text-[10px]">
                  {c.is_active ? "attivo" : "off"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" /> Output Recenti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentOutputs.length === 0 && <div className="text-sm text-muted-foreground">Nessun output recente.</div>}
            {recentOutputs.map((i) => (
              <div key={i.id} className="rounded-md border border-border/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                  <Badge variant="outline" className="text-[10px]">{i.target_tool}</Badge>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.output_result}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
