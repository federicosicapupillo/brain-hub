import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  ArrowRight,
  ExternalLink,
  ListChecks,
  Pencil,
  Play,
  Plug,
  Plus,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import {
  N8nWorkflow,
  SUPPORTED_WORKFLOW_CASES,
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
  WorkflowStatus,
  WorkflowRisk,
  createWorkflow,
  listWorkflows,
  logWorkflowOpened,
  markManualTest,
  setWorkflowStatus,
  summarizeWorkflows,
  updateWorkflow,
} from "@/lib/n8n-workflows";
import { READINESS_MATRIX } from "@/lib/automation-readiness";
import { listToolLinks } from "@/lib/tool-connections";
import { RISK_TONE } from "@/lib/action-queue";

const searchSchema = z.object({ brain: z.string().optional() });

export const Route = createFileRoute("/_authenticated/n8n-workflows")({
  validateSearch: (s) => searchSchema.parse(s),
  component: N8nWorkflowsPage,
});

type BrainRow = { id: string; name: string; color: string };

function N8nWorkflowsPage() {
  const search = useSearch({ from: "/_authenticated/n8n-workflows" });
  const navigate = useNavigate();
  const qc = useQueryClient();

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
      void navigate({
        to: "/n8n-workflows",
        search: { brain: brainId },
        replace: true,
      });
    }
  }, [brainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: workflows = [] } = useQuery<N8nWorkflow[]>({
    queryKey: ["n8n-workflows", brainId],
    enabled: !!brainId,
    queryFn: () => listWorkflows(brainId),
  });

  const { data: toolLinks = [] } = useQuery({
    queryKey: ["tool-links-min", brainId],
    enabled: !!brainId,
    queryFn: () => listToolLinks(brainId),
  });

  const n8nToolConnected = useMemo(
    () =>
      toolLinks.some(
        (l) =>
          l.tool_name?.toLowerCase().includes("n8n") &&
          ["connected", "active"].includes((l.connection_status ?? "").toLowerCase()),
      ),
    [toolLinks],
  );

  // action_types that need n8n / external connector (from readiness matrix)
  const requiredActionTypes = useMemo(
    () =>
      READINESS_MATRIX.filter(
        (e) =>
          e.execution_method === "n8n_workflow" ||
          e.automation_level_future === "external_connector_required",
      ).map((e) => String(e.action_type)),
    [],
  );

  const summary = useMemo(
    () => summarizeWorkflows(workflows, requiredActionTypes),
    [workflows, requiredActionTypes],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<N8nWorkflow | null>(null);
  const [presetActionType, setPresetActionType] = useState<string | null>(null);

  function openCreate(actionType?: string) {
    setEditing(null);
    setPresetActionType(actionType ?? null);
    setDialogOpen(true);
  }
  function openEdit(w: N8nWorkflow) {
    setEditing(w);
    setPresetActionType(null);
    setDialogOpen(true);
  }

  async function changeStatus(w: N8nWorkflow, status: WorkflowStatus) {
    try {
      await setWorkflowStatus(w, status);
      toast.success(`Stato → ${WORKFLOW_STATUS_LABEL[status]}`);
      qc.invalidateQueries({ queryKey: ["n8n-workflows", brainId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  async function testMark(w: N8nWorkflow, status: "ok" | "failed") {
    try {
      await markManualTest(w, status);
      toast.success(`Test ${status === "ok" ? "OK" : "fallito"}`);
      qc.invalidateQueries({ queryKey: ["n8n-workflows", brainId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="n8n Workflow Registry"
        subtitle="Registra e organizza i workflow n8n. Nessuna esecuzione automatica — solo preparazione."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <div className="min-w-[220px]">
            <Select value={brainId} onValueChange={setBrainId}>
              <SelectTrigger>
                <SelectValue placeholder="Scegli cervello/progetto" />
              </SelectTrigger>
              <SelectContent>
                {brains.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge
            variant="outline"
            className={
              n8nToolConnected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                : "border-amber-500/30 bg-amber-500/10 text-amber-600"
            }
          >
            <Plug className="mr-1 h-3 w-3" />
            {n8nToolConnected ? "n8n collegato" : "n8n non collegato"}
          </Badge>
          <Button asChild variant="outline" size="sm">
            <Link to="/tool-connections" search={{ brain: brainId }}>
              Tool Connections <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/automation-readiness">Automation Readiness</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/action-queue" search={{}}>Action Queue</Link>
          </Button>
          <div className="ml-auto">
            <Button onClick={() => openCreate()} disabled={!brainId}>
              <Plus className="mr-1 h-4 w-4" /> Nuovo workflow
            </Button>
          </div>
        </CardContent>
      </Card>

      {!n8nToolConnected && brainId && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 pt-6 text-sm">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <span>
              n8n non è ancora collegato a questo progetto. I workflow registrati qui non potranno
              essere eseguiti finché non aggiungerai n8n in Tool Connections.
            </span>
            <Button asChild size="sm" variant="outline" className="ml-auto">
              <Link to="/tool-connections" search={{ brain: brainId }}>
                Aggiungi n8n
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Workflow totali" value={summary.total} />
        <Tile label="Attivi" value={summary.active} tone="green" />
        <Tile label="Da testare" value={summary.to_test} tone="amber" />
        <Tile label="Problemi" value={summary.broken} tone="red" />
        <Tile label="Azioni coperte" value={summary.covered_action_types.length} />
        <Tile label="Azioni scoperte" value={summary.uncovered_action_types.length} tone="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4" /> Workflow registrati ({workflows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {workflows.length === 0 && (
            <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Nessun workflow registrato. Aggiungine uno per iniziare a mappare le automazioni n8n.
            </div>
          )}
          {workflows.map((w) => (
            <div
              key={w.id}
              className="rounded border border-border/60 bg-background/40 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{w.workflow_name}</div>
                <Badge variant="outline" className={WORKFLOW_STATUS_TONE[w.status]}>
                  {WORKFLOW_STATUS_LABEL[w.status]}
                </Badge>
                <Badge variant="outline" className={RISK_TONE[w.risk_level]}>
                  rischio {w.risk_level}
                </Badge>
                {w.webhook_url && (
                  <Badge variant="outline">{w.webhook_method ?? "POST"} webhook</Badge>
                )}
                <div className="ml-auto flex flex-wrap gap-1">
                  {w.workflow_url && (
                    <Button asChild size="sm" variant="ghost" onClick={() => void logWorkflowOpened(w)}>
                      <a href={w.workflow_url} target="_blank" rel="noreferrer">
                        Apri <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openEdit(w)}>
                    <Pencil className="mr-1 h-3 w-3" /> Modifica
                  </Button>
                  <Select value={w.status} onValueChange={(v) => changeStatus(w, v as WorkflowStatus)}>
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(WORKFLOW_STATUS_LABEL) as WorkflowStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {WORKFLOW_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => testMark(w, "ok")}>
                    Test OK
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => testMark(w, "failed")}>
                    Test KO
                  </Button>
                </div>
              </div>
              {w.workflow_description && (
                <div className="mt-1 text-xs text-muted-foreground">{w.workflow_description}</div>
              )}
              {w.linked_action_types?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {w.linked_action_types.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      <ListChecks className="mr-1 h-3 w-3" /> {t}
                    </Badge>
                  ))}
                </div>
              )}
              {w.last_manual_test_at && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Ultimo test manuale: {new Date(w.last_manual_test_at).toLocaleString()} —{" "}
                  {w.last_manual_test_status}
                </div>
              )}
              <RealWebhookEditor
                workflow={w}
                onChanged={() => void qc.invalidateQueries({ queryKey: ["n8n-workflows"] })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-500" /> Azioni pronte per n8n ma scoperte (
            {summary.uncovered_action_types.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {summary.uncovered_action_types.length === 0 && (
            <div className="text-sm text-muted-foreground">Tutte le azioni richieste sono coperte.</div>
          )}
          {summary.uncovered_action_types.map((t) => {
            const entry = READINESS_MATRIX.find((e) => String(e.action_type) === t);
            return (
              <div
                key={t}
                className="flex items-center justify-between rounded border border-border/60 bg-background/40 p-2 text-sm"
              >
                <div>
                  <div className="font-medium">{entry?.label ?? t}</div>
                  <div className="text-[11px] text-muted-foreground">{t}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => openCreate(t)} disabled={!brainId}>
                  <Plus className="mr-1 h-3 w-3" /> Crea workflow
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <WorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        presetActionType={presetActionType}
        brainId={brainId}
        onSaved={() => {
          setDialogOpen(false);
          qc.invalidateQueries({ queryKey: ["n8n-workflows", brainId] });
        }}
      />
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
  tone?: "green" | "amber" | "red";
}) {
  const cls =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border/60 bg-background/40";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function WorkflowDialog({
  open,
  onOpenChange,
  editing,
  presetActionType,
  brainId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: N8nWorkflow | null;
  presetActionType: string | null;
  brainId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workflowUrl, setWorkflowUrl] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [status, setStatus] = useState<WorkflowStatus>("draft");
  const [risk, setRisk] = useState<WorkflowRisk>("medium");
  const [linked, setLinked] = useState<string[]>([]);
  const [verification, setVerification] = useState("");
  const [notes, setNotes] = useState("");
  const [inputSchema, setInputSchema] = useState("");
  const [outputSchema, setOutputSchema] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.workflow_name);
      setDescription(editing.workflow_description ?? "");
      setWorkflowUrl(editing.workflow_url ?? "");
      setWebhookUrl(editing.webhook_url ?? "");
      setMethod(editing.webhook_method ?? "POST");
      setStatus(editing.status);
      setRisk(editing.risk_level);
      setLinked(editing.linked_action_types ?? []);
      setVerification(editing.verification_method ?? "");
      setNotes(editing.notes ?? "");
      setInputSchema(
        editing.expected_input_schema ? JSON.stringify(editing.expected_input_schema, null, 2) : "",
      );
      setOutputSchema(
        editing.expected_output_schema
          ? JSON.stringify(editing.expected_output_schema, null, 2)
          : "",
      );
    } else {
      setName("");
      setDescription("");
      setWorkflowUrl("");
      setWebhookUrl("");
      setMethod("POST");
      setStatus("draft");
      setRisk("medium");
      setLinked(presetActionType ? [presetActionType] : []);
      setVerification("");
      setNotes("");
      setInputSchema("");
      setOutputSchema("");
    }
  }, [open, editing, presetActionType]);

  async function submit() {
    if (!name.trim()) {
      toast.error("Nome obbligatorio");
      return;
    }
    let parsedInput: Record<string, unknown> | null = null;
    let parsedOutput: Record<string, unknown> | null = null;
    try {
      if (inputSchema.trim()) parsedInput = JSON.parse(inputSchema);
    } catch {
      toast.error("expected_input_schema non è JSON valido");
      return;
    }
    try {
      if (outputSchema.trim()) parsedOutput = JSON.parse(outputSchema);
    } catch {
      toast.error("expected_output_schema non è JSON valido");
      return;
    }

    try {
      if (editing) {
        await updateWorkflow(editing.id, {
          workflow_name: name.trim(),
          workflow_description: description.trim() || null,
          workflow_url: workflowUrl.trim() || null,
          webhook_url: webhookUrl.trim() || null,
          webhook_method: method,
          status,
          risk_level: risk,
          linked_action_types: linked,
          verification_method: verification.trim() || null,
          notes: notes.trim() || null,
          expected_input_schema: parsedInput,
          expected_output_schema: parsedOutput,
        });
        toast.success("Workflow aggiornato");
      } else {
        await createWorkflow({
          workflow_name: name.trim(),
          workflow_description: description.trim() || null,
          workflow_url: workflowUrl.trim() || null,
          webhook_url: webhookUrl.trim() || null,
          webhook_method: method,
          status,
          risk_level: risk,
          linked_action_types: linked,
          verification_method: verification.trim() || null,
          notes: notes.trim() || null,
          expected_input_schema: parsedInput,
          expected_output_schema: parsedOutput,
          brain_id: brainId || null,
        });
        toast.success("Workflow registrato");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  function toggleLinked(t: string) {
    setLinked((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifica workflow" : "Nuovo workflow n8n"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Descrizione</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>URL workflow (n8n editor)</Label>
              <Input value={workflowUrl} onChange={(e) => setWorkflowUrl(e.target.value)} />
            </div>
            <div>
              <Label>Webhook URL</Label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://…"
              />
              <div className="mt-1 text-[10px] text-amber-600">
                Non inserire segreti o token nell'URL se non necessario.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Metodo</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["POST", "GET", "PUT", "PATCH", "DELETE"].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stato</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as WorkflowStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WORKFLOW_STATUS_LABEL) as WorkflowStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {WORKFLOW_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rischio</Label>
              <Select value={risk} onValueChange={(v) => setRisk(v as WorkflowRisk)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Basso</SelectItem>
                  <SelectItem value="medium">Medio</SelectItem>
                  <SelectItem value="high">Alto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Action type collegati</Label>
            <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-auto rounded border border-border/60 p-2">
              {SUPPORTED_WORKFLOW_CASES.map((c) => (
                <label
                  key={c.action_type}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    checked={linked.includes(c.action_type)}
                    onCheckedChange={() => toggleLinked(c.action_type)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Input atteso (JSON)</Label>
              <Textarea
                value={inputSchema}
                onChange={(e) => setInputSchema(e.target.value)}
                rows={4}
                placeholder='{ "field": "type" }'
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label>Output atteso (JSON)</Label>
              <Textarea
                value={outputSchema}
                onChange={(e) => setOutputSchema(e.target.value)}
                rows={4}
                placeholder='{ "result": "ok" }'
                className="font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <Label>Metodo di verifica</Label>
            <Input
              value={verification}
              onChange={(e) => setVerification(e.target.value)}
              placeholder="webhook_response, external_api_response, …"
            />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={submit}>
            <Play className="mr-1 h-3 w-3" /> {editing ? "Salva" : "Registra"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
