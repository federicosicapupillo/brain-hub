import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Activity, Bot, Workflow, Gauge, AlertTriangle, CheckCircle2, Clock, Plug, ListChecks, ExternalLink, Send, FileJson, Copy } from "lucide-react";
import { testN8nWebhook, sendVerifiedPayloadToN8n } from "@/lib/n8n.functions";
import { AutomationRunPanel } from "@/components/AutomationRunPanel";
import { CallbackInboxSection, type CallbackPrefill } from "@/components/CallbackInboxSection";
import { useEffect } from "react";



export const Route = createFileRoute("/_authenticated/automation-control")({
  component: AutomationControlPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Pagina non trovata.</div>,
});

type ClipboardItem = {
  id: string;
  brain_id: string | null;
  title: string;
  content: string;
  target_tool: string;
  source_tool: string;
  status: string;
  approval_status: string;
  automation_status: string;
  automation_attempts: number;
  automation_connector_id: string | null;
  human_review_required: boolean;
  risk_level: string | null;
  output_result: string | null;
  updated_at: string;
  created_at: string;
  automation_completed_at: string | null;
  automation_last_run_at: string | null;
  project_tool_link_id: string | null;
  execution_instructions: string | null;
  expected_output: string | null;
  success_criteria: string | null;
  source_url: string | null;
  next_action: string | null;
  automation_payload: Record<string, unknown> | null;
};

type BrainLite = { id: string; name: string };


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

  const [itemsRes, logsRes, connectorsRes, tasksRes, roadmapRes, brainsRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,title,content,target_tool,source_tool,status,approval_status,automation_status,automation_attempts,automation_connector_id,human_review_required,risk_level,output_result,updated_at,created_at,automation_completed_at,automation_last_run_at,project_tool_link_id,execution_instructions,expected_output,success_criteria,source_url,next_action,automation_payload"
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
    supabase.from("brains").select("id,name"),
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (connectorsRes.error) throw connectorsRes.error;

  return {
    items: (itemsRes.data ?? []) as ClipboardItem[],
    logs: (logsRes.data ?? []) as ExecLog[],
    connectors: (connectorsRes.data ?? []) as Connector[],
    brains: (brainsRes.data ?? []) as BrainLite[],
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
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["automation-control"],
    queryFn: fetchAll,
    refetchInterval: 15000,
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const testWebhookFn = useServerFn(testN8nWebhook);
  const sendVerifiedFn = useServerFn(sendVerifiedPayloadToN8n);

  const testWebhookMut = useMutation({
    mutationFn: async (connector: Connector) => {
      const r = await testWebhookFn({ data: { connector_id: connector.id } });
      if (!r.ok) throw new Error(r.errorMsg ?? `HTTP ${r.statusCode ?? "?"}`);
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Webhook OK (${r.statusCode})`);
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
    onError: (e: Error) => {
      toast.error(`Webhook fallito: ${e.message}`);
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
    onSettled: () => setTestingId(null),
  });

  const [previewItem, setPreviewItem] = useState<{ item: ClipboardItem; payload: Record<string, unknown> } | null>(null);
  const [sendItem, setSendItem] = useState<{ item: ClipboardItem; connector: Connector } | null>(null);
  const [simulateItem, setSimulateItem] = useState<{ item: ClipboardItem; mode: "done" | "failed" } | null>(null);
  const [simulateText, setSimulateText] = useState("");

  const verifyPayloadMut = useMutation({
    mutationFn: async ({ item, payload }: { item: ClipboardItem; payload: Record<string, unknown> }) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Non autenticato");
      const { error: upErr } = await supabase
        .from("clipboard_items")
        .update({ automation_payload: payload } as never)
        .eq("id", item.id);
      if (upErr) throw upErr;
      const { error: logErr } = await supabase.from("clipboard_execution_logs").insert({
        user_id: userData.user.id,
        clipboard_item_id: item.id,
        action: "n8n_payload_preview_verified",
        notes: "Payload n8n preview verificato manualmente",
        metadata: {
          connector_id: item.automation_connector_id,
          target_tool: item.target_tool,
          payload_mode: "execution_preview",
        },
      } as never);
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      toast.success("Payload verificato e salvato");
      setPreviewItem(null);
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
    onError: (e: Error) => toast.error(`Errore: ${e.message}`),
  });

  const sendVerifiedPayloadMut = useMutation({
    mutationFn: async ({ item }: { item: ClipboardItem; connector: Connector }) => {
      const r = await sendVerifiedFn({ data: { clipboard_item_id: item.id } });
      if (!r.ok) throw new Error(r.errorMsg ?? `HTTP ${r.statusCode ?? "?"}`);
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Payload inviato a n8n (${r.statusCode})`);
      setSendItem(null);
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
    onError: (e: Error) => {
      toast.error(`Invio fallito: ${e.message}`);
      setSendItem(null);
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
  });

  const simulateCallbackMut = useMutation({
    mutationFn: async ({ item, mode, text }: { item: ClipboardItem; mode: "done" | "failed"; text: string }) => {
      const body: Record<string, unknown> = {
        source: "n8n",
        item_id: item.id,
        status: mode,
        metadata: { mode: "ui_simulation", simulated: true },
      };
      if (mode === "done") body.output_result = text;
      else body.error_message = text;
      const res = await fetch("/api/public/n8n-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${resText}`);
      return { mode };
    },
    onSuccess: () => {
      toast.success("Simulazione callback completata");
      setSimulateItem(null);
      setSimulateText("");
      qc.invalidateQueries({ queryKey: ["automation-control"] });
    },
    onError: (e: Error) => toast.error(`Simulazione fallita: ${e.message}`),
  });



  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  if (!data) return null;


  const { items, logs, connectors, brains, tasksCount, todayStart } = data;

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

      <AutomationRunPanel />

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> n8n Webhook Test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(() => {
            const n8nConnectors = connectors.filter((c) => c.type === "n8n_webhook" && c.is_active);
            if (n8nConnectors.length === 0) {
              return <div className="text-sm text-muted-foreground">Nessun connector n8n_webhook attivo.</div>;
            }
            return n8nConnectors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.webhook_url ?? <span className="text-amber-300">webhook_url non configurata</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{c.target_tool}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!c.webhook_url || testingId === c.id}
                    onClick={() => {
                      setTestingId(c.id);
                      testWebhookMut.mutate(c);
                    }}
                  >
                    <Send className="mr-1 h-3 w-3" />
                    {testingId === c.id ? "Invio…" : "Test webhook"}
                  </Button>
                </div>
              </div>
            ));
          })()}
          <p className="text-[11px] text-muted-foreground">
            Invia un payload di test (mode=&quot;test&quot;) al webhook n8n. Nessun prompt reale, nessun item modificato. Esito registrato in clipboard_execution_logs.
          </p>
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

      <PayloadPreviewSection
        items={items}
        connectors={connectors}
        brains={brains}
        onPreview={(item, payload) => setPreviewItem({ item, payload })}
        onSend={(item, connector) => setSendItem({ item, connector })}
      />

      <N8nCallbackInfo />

      <N8nCallbackTestPanel
        items={items}
        connectors={connectors}
        onSimulate={(item, mode) => {
          setSimulateItem({ item, mode });
          setSimulateText(mode === "done" ? `Simulated n8n result for: ${item.title}` : `Simulated n8n failure for: ${item.title}`);
        }}
      />

      <Dialog open={!!sendItem} onOpenChange={(o) => { if (!o) setSendItem(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Conferma invio a n8n
            </DialogTitle>
          </DialogHeader>
          {sendItem && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <div className="text-muted-foreground">Item</div>
                <div className="font-medium">{sendItem.item.title || "(senza titolo)"}</div>
                <div className="text-muted-foreground">Target tool</div>
                <div>{sendItem.item.target_tool}</div>
                <div className="text-muted-foreground">Connector</div>
                <div>{sendItem.connector.name}</div>
                <div className="text-muted-foreground">Webhook URL</div>
                <div className="font-mono text-xs break-all">{maskWebhookUrl(sendItem.connector.webhook_url ?? "")}</div>
                <div className="text-muted-foreground">Risk level</div>
                <div>{sendItem.item.risk_level ?? "—"}</div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">automation_payload</div>
                <pre className="max-h-[40vh] overflow-auto rounded-md bg-muted p-3 text-xs">
{JSON.stringify(sendItem.item.automation_payload ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setSendItem(null)} disabled={sendVerifiedPayloadMut.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => sendItem && sendVerifiedPayloadMut.mutate(sendItem)}
              disabled={sendVerifiedPayloadMut.isPending}
            >
              <Send className="mr-1 h-3 w-3" />
              {sendVerifiedPayloadMut.isPending ? "Invio…" : "Conferma invio a n8n"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewItem} onOpenChange={(o) => { if (!o) setPreviewItem(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-4 w-4" /> n8n Payload Preview
            </DialogTitle>
          </DialogHeader>
          {previewItem && (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
{JSON.stringify(previewItem.payload, null, 2)}
            </pre>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setPreviewItem(null)}>Chiudi</Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!previewItem) return;
                  navigator.clipboard.writeText(JSON.stringify(previewItem.payload, null, 2));
                  toast.success("JSON copiato");
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> Copia JSON
              </Button>
              <Button
                onClick={() => previewItem && verifyPayloadMut.mutate(previewItem)}
                disabled={verifyPayloadMut.isPending}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {verifyPayloadMut.isPending ? "Salvataggio…" : "Segna payload verificato"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!simulateItem} onOpenChange={(o) => { if (!o) { setSimulateItem(null); setSimulateText(""); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {simulateItem?.mode === "done" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              Simula callback {simulateItem?.mode === "done" ? "DONE" : "FAILED"}
            </DialogTitle>
          </DialogHeader>
          {simulateItem && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-muted-foreground mb-1">Item</div>
                <div className="font-medium">{simulateItem.item.title || "(senza titolo)"}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">{simulateItem.mode === "done" ? "output_result" : "error_message"}</div>
                <Textarea
                  value={simulateText}
                  onChange={(e) => setSimulateText(e.target.value)}
                  rows={5}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => { setSimulateItem(null); setSimulateText(""); }} disabled={simulateCallbackMut.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => {
                if (!simulateItem) return;
                simulateCallbackMut.mutate({ item: simulateItem.item, mode: simulateItem.mode, text: simulateText });
              }}
              disabled={simulateCallbackMut.isPending}
            >
              {simulateCallbackMut.isPending ? "Simulazione…" : "Conferma simulazione"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildN8nPayload(
  item: ClipboardItem,
  brain: BrainLite | undefined,
): Record<string, unknown> {
  return {
    source: "brain_hub",
    mode: "execution_preview",
    item_id: item.id,
    title: item.title,
    target_tool: item.target_tool,
    connector_id: item.automation_connector_id,
    prompt: item.content ?? "",
    execution_instructions: item.execution_instructions ?? "",
    expected_output: item.expected_output ?? "",
    success_criteria: item.success_criteria ?? "",
    risk_level: item.risk_level ?? null,
    source_url: item.source_url ?? null,
    project_context: {
      brain_id: item.brain_id,
      brain_name: brain?.name ?? null,
    },
    metadata: {
      created_at: item.created_at,
      next_action: item.next_action ?? null,
      automation_payload: item.automation_payload ?? {},
    },
  };
}

function PayloadPreviewSection({
  items,
  connectors,
  brains,
  onPreview,
  onSend,
}: {
  items: ClipboardItem[];
  connectors: Connector[];
  brains: BrainLite[];
  onPreview: (item: ClipboardItem, payload: Record<string, unknown>) => void;
  onSend: (item: ClipboardItem, connector: Connector) => void;
}) {
  const connectorMap = new Map(connectors.map((c) => [c.id, c]));
  const brainMap = new Map(brains.map((b) => [b.id, b]));
  const previewable = items.filter(
    (i) =>
      i.automation_status === "queued" &&
      i.target_tool === "Lovable" &&
      !i.human_review_required &&
      (!i.approval_status || i.approval_status === "approved") &&
      (!i.output_result || i.output_result.trim() === ""),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileJson className="h-4 w-4" /> n8n Payload Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {previewable.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Nessun item pronto per la preview (queued, target Lovable, approvato, senza output).
          </div>
        )}
        {previewable.map((i) => {
          const c = i.automation_connector_id ? connectorMap.get(i.automation_connector_id) : null;
          const brain = i.brain_id ? brainMap.get(i.brain_id) : undefined;
          const payloadVerified =
            !!i.automation_payload && Object.keys(i.automation_payload).length > 0;
          const canSend =
            payloadVerified &&
            i.approval_status === "approved" &&
            !!c &&
            c.type === "n8n_webhook" &&
            c.is_active &&
            !!c.webhook_url;
          return (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px]">{i.target_tool}</Badge>
                  {i.risk_level && <Badge variant="outline" className="text-[10px]">risk: {i.risk_level}</Badge>}
                  <Badge variant="secondary" className="text-[10px]">{i.automation_status}</Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {c ? c.name : "no connector"}
                  </Badge>
                  {payloadVerified && (
                    <Badge variant="default" className="text-[10px]">payload verificato</Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPreview(i, buildN8nPayload(i, brain))}
                >
                  <FileJson className="mr-1 h-3 w-3" /> Preview n8n payload
                </Button>
                {canSend && c && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onSend(i, c)}
                  >
                    <Send className="mr-1 h-3 w-3" /> Invia payload verificato a n8n
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          Preview: nessun webhook chiamato. Invio: usa l&apos;automation_payload già verificato.
        </p>
      </CardContent>
    </Card>
  );
}

function N8nCallbackTestPanel({
  items,
  connectors,
  onSimulate,
}: {
  items: ClipboardItem[];
  connectors: Connector[];
  onSimulate: (item: ClipboardItem, mode: "done" | "failed") => void;
}) {
  const connectorMap = new Map(connectors.map((c) => [c.id, c]));
  const runningItems = items.filter(
    (i) => i.automation_status === "running" && i.target_tool === "Lovable"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> n8n Callback Test Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {runningItems.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Nessun item in stato <code>running</code> con target <code>Lovable</code>.
          </div>
        )}
        {runningItems.map((i) => {
          const c = i.automation_connector_id ? connectorMap.get(i.automation_connector_id) : null;
          return (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{i.title || "(senza titolo)"}</div>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px]">{i.target_tool}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{i.automation_status}</Badge>
                  {i.automation_last_run_at && (
                    <Badge variant="outline" className="text-[10px]">
                      run {new Date(i.automation_last_run_at).toLocaleString()}
                    </Badge>
                  )}
                  {c && <Badge variant="outline" className="text-[10px]">{c.name}</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onSimulate(i, "done")}>
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Simula DONE
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSimulate(i, "failed")}>
                  <AlertTriangle className="mr-1 h-3 w-3" /> Simula FAILED
                </Button>
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          Simula manualmente il ritorno di n8n senza configurare un workflow reale. Aggiorna lo stato dell&apos;item come se fosse tornato da n8n.
        </p>
      </CardContent>
    </Card>
  );
}

function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const visible = path.length > 12 ? path.slice(0, 6) + "***" + path.slice(-4) : "***";
    return `${u.origin}${visible}`;
  } catch {
    return url.length > 16 ? url.slice(0, 10) + "***" + url.slice(-4) : "***";
  }
}

function N8nCallbackInfo() {
  const callbackUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/n8n-callback` : "/api/public/n8n-callback";
  const examplePayload = {
    source: "n8n",
    item_id: "<UUID dell'item clipboard>",
    status: "done",
    output_result: "Testo del risultato prodotto dall'automazione",
    error_message: "",
    metadata: { workflow_id: "wf_123", run_id: "run_456" },
  };
  const exampleJson = JSON.stringify(examplePayload, null, 2);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4" /> n8n Callback Info
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Callback URL</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">{callbackUrl}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(callbackUrl);
                toast.success("URL copiato");
              }}
            >
              <Copy className="mr-1 h-3 w-3" /> Copia
            </Button>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Esempio payload (POST application/json)</div>
          <pre className="max-h-[40vh] overflow-auto rounded-md bg-muted p-3 text-xs">{exampleJson}</pre>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(exampleJson);
              toast.success("JSON copiato");
            }}
          >
            <Copy className="mr-1 h-3 w-3" /> Copia JSON
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Da configurare in n8n come ultimo step del workflow. Campi richiesti: <code>item_id</code>,{" "}
          <code>status</code> (<code>done</code> o <code>failed</code>). Se <code>status=done</code> serve{" "}
          <code>output_result</code>; se <code>status=failed</code> serve <code>error_message</code>. Se è impostato il
          secret <code>N8N_CALLBACK_SECRET</code>, includere l&apos;header <code>X-N8N-Secret</code>.
        </p>
      </CardContent>
    </Card>
  );
}


