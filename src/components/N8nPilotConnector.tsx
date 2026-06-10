import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Workflow,
  FileJson,
  Copy,
  Inbox,
  Save,
  AlertTriangle,
  ShieldCheck,
  ListChecks,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  buildAutomationPayload,
  getAutomationRun,
  updateAutomationRun,
  RUN_STATUS_LABELS,
  type ItemLike,
  type LogEventType,
} from "@/lib/automation-run";

export const N8N_CALLBACK_SCHEMA_VERSION = 1;

export const N8N_PAYLOAD_SCHEMA = {
  required: [
    "execution_package_id",
    "run_id",
    "project_id",
    "brain_id",
    "prompt",
    "success_criteria",
    "expected_output",
    "callback_required",
    "callback_schema_version",
  ],
  optional: ["protected_areas", "risk_level", "package_type", "target", "execution_mode", "created_at"],
};

export const N8N_CALLBACK_SCHEMA = {
  required: ["execution_package_id", "run_id", "status", "callback_schema_version"],
  optional: [
    "build_status",
    "console_errors",
    "modified_files",
    "summary",
    "notes",
    "raw_output",
    "external_result_reference",
  ],
  status_allowed: ["completed", "failed"],
  build_status_allowed: ["ok", "failed", "not_verified"],
};

export type ContractStatus = "valid" | "incomplete" | "not_ready";

export function validateN8nContract(
  payload: Record<string, unknown>,
  callbackTpl: Record<string, unknown>,
): { status: ContractStatus; errors: string[] } {
  const errors: string[] = [];
  const need = (obj: Record<string, unknown>, k: string, label: string) => {
    const v = obj[k];
    if (v === undefined || v === null || v === "") errors.push(`${label}.${k} mancante`);
  };
  for (const k of ["execution_package_id", "run_id", "project_id", "brain_id", "prompt", "success_criteria", "expected_output"]) {
    need(payload, k, "payload");
  }
  if (payload.callback_required !== true) errors.push("payload.callback_required deve essere true");
  if (payload.callback_schema_version !== N8N_CALLBACK_SCHEMA_VERSION)
    errors.push(`payload.callback_schema_version deve essere ${N8N_CALLBACK_SCHEMA_VERSION}`);

  for (const k of ["execution_package_id", "run_id", "status"]) need(callbackTpl, k, "callback");
  if (!N8N_CALLBACK_SCHEMA.status_allowed.includes(String(callbackTpl.status)))
    errors.push("callback.status deve essere completed|failed");
  if (callbackTpl.build_status && !N8N_CALLBACK_SCHEMA.build_status_allowed.includes(String(callbackTpl.build_status)))
    errors.push("callback.build_status deve essere ok|failed|not_verified");
  if (callbackTpl.callback_schema_version !== N8N_CALLBACK_SCHEMA_VERSION)
    errors.push(`callback.callback_schema_version deve essere ${N8N_CALLBACK_SCHEMA_VERSION}`);
  const hasRef = !!callbackTpl.external_result_reference;
  const hasBody = !!(callbackTpl.raw_output || callbackTpl.summary);
  if (!hasRef) errors.push("callback.external_result_reference assente o non generabile");
  if (!hasBody) errors.push("callback.raw_output o summary richiesto");

  if (errors.length === 0) return { status: "valid", errors };
  // Distinguish "not_ready" if too many critical fields missing
  const criticalMissing = errors.filter((e) => e.includes("execution_package_id") || e.includes("prompt") || e.includes("brain_id"));
  return { status: criticalMissing.length > 0 ? "not_ready" : "incomplete", errors };
}

type ClipItem = ItemLike & {
  content: string | null;
  content_type: string | null;
  target_tool: string | null;
  automation_status: string | null;
  risk_level: string | null;
  output_result: string | null;
  updated_at: string;
};

type Brain = { id: string; name: string };

async function fetchData() {
  const [itemsRes, brainsRes] = await Promise.all([
    supabase
      .from("clipboard_items")
      .select(
        "id,brain_id,title,content,content_type,target_tool,automation_status,risk_level,output_result,metadata,updated_at",
      )
      .eq("content_type", "execution_package")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("brains").select("id,name"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (brainsRes.error) throw brainsRes.error;
  return {
    items: (itemsRes.data ?? []) as ClipItem[],
    brains: (brainsRes.data ?? []) as Brain[],
  };
}

function reviewStatus(i: ClipItem): string | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const r = m.post_execution_review as { review_status?: string } | undefined;
  return r?.review_status ?? null;
}

function resultMeta(i: ClipItem): Record<string, unknown> | null {
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  return (m.result_meta as Record<string, unknown> | null) ?? null;
}

function externalConnector(i: ClipItem):
  | {
      connector?: string;
      webhook_url_label?: string;
      webhook_url_saved?: boolean;
      mode?: string;
      updated_at?: string;
      last_payload_at?: string;
      last_payload_version?: number;
      last_callback_template_at?: string;
      last_sent_to_inbox_at?: string;
    }
  | null {
  const run = getAutomationRun(i);
  const m = (i.metadata as Record<string, unknown> | null) ?? {};
  const fromMeta = (m.external_connector as Record<string, unknown> | undefined) ?? null;
  const fromRun = ((run as unknown) as { external_connector?: Record<string, unknown> }).external_connector ?? null;
  return (fromRun ?? fromMeta) as ReturnType<typeof externalConnector>;
}

function isEligible(i: ClipItem): { ok: boolean; reason?: string; hasRealResult: boolean } {
  if (i.content_type !== "execution_package") return { ok: false, reason: "non execution_package", hasRealResult: false };
  const run = getAutomationRun(i);
  const eligibleStatus = run.run_status === "approved" || run.run_status === "queued";
  const rm = resultMeta(i);
  const isSimulated = rm?.is_simulated === true || rm?.source === "dry_run";
  const reviewed = reviewStatus(i);
  const hasRealResult =
    !isSimulated && (reviewed === "approvato" || run.run_status === "completed");
  if (!eligibleStatus) return { ok: false, reason: `run_status: ${run.run_status}`, hasRealResult };
  // Dry run actively running on same item
  const dryRunMeta = (run as unknown as { dry_run?: { enabled?: boolean } }).dry_run;
  if (dryRunMeta?.enabled === true && run.run_status === "running") {
    return { ok: false, reason: "dry run attivo", hasRealResult };
  }
  return { ok: true, hasRealResult };
}

type PreparedPayload = {
  item: ClipItem;
  payload: Record<string, unknown>;
};

type CallbackTemplate = {
  item: ClipItem;
  json: string;
};

export function N8nPilotConnector() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["n8n-pilot-connector"],
    queryFn: fetchData,
    refetchInterval: 30000,
  });

  const [payloadDialog, setPayloadDialog] = useState<PreparedPayload | null>(null);
  const [callbackDialog, setCallbackDialog] = useState<CallbackTemplate | null>(null);
  const [webhookEdit, setWebhookEdit] = useState<Record<string, string>>({});

  const items = data?.items ?? [];
  const brains = data?.brains ?? [];
  const brainMap = useMemo(() => new Map(brains.map((b) => [b.id, b])), [brains]);

  const eligible = useMemo(() => {
    return items
      .map((i) => ({ item: i, info: isEligible(i) }))
      .filter((x) => x.info.ok);
  }, [items]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["n8n-pilot-connector"] });
    qc.invalidateQueries({ queryKey: ["automation-run-panel"] });
    qc.invalidateQueries({ queryKey: ["automation-control"] });
    qc.invalidateQueries({ queryKey: ["project-loop"] });
  };

  function buildN8nPayload(item: ClipItem): Record<string, unknown> {
    const brain = item.brain_id ? brainMap.get(item.brain_id) : null;
    const base = buildAutomationPayload(item, {
      brain_name: brain?.name ?? null,
      project_id: null,
      project_name: null,
    });
    return {
      ...base,
      source: "brain_hub",
      connector: "n8n_pilot",
      callback_mode: "manual_or_webhook_future",
      callback_schema_version: N8N_CALLBACK_SCHEMA_VERSION,
      dry_run: false,
      created_at: new Date().toISOString(),
    };
  }

  function buildCallbackTemplateObj(item: ClipItem): Record<string, unknown> {
    const run = getAutomationRun(item);
    const stamp = Date.now().toString(36);
    return {
      execution_package_id: item.id,
      run_id: run.run_id,
      status: "completed",
      build_status: "not_verified",
      console_errors: false,
      modified_files: [] as string[],
      summary: "Risultato generato da n8n pilot",
      notes: "",
      external_result_reference: `n8n_pilot_${stamp}`,
      raw_output: "",
      callback_schema_version: N8N_CALLBACK_SCHEMA_VERSION,
    };
  }

  function buildCallbackTemplate(item: ClipItem): string {
    return JSON.stringify(buildCallbackTemplateObj(item), null, 2);
  }


  async function logEvent(item: ClipItem, action: LogEventType, notes: string, extra?: Record<string, unknown>) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;
    await supabase.from("clipboard_execution_logs").insert({
      user_id: userData.user.id,
      clipboard_item_id: item.id,
      action,
      notes,
      metadata: {
        clipboard_item_id: item.id,
        brain_id: item.brain_id,
        connector: "n8n_pilot",
        ...(extra ?? {}),
      },
    } as never);
  }

  async function persistExternalConnector(item: ClipItem, patch: Record<string, unknown>) {
    const prevMeta = (item.metadata as Record<string, unknown> | null) ?? {};
    const prevRun = getAutomationRun(item);
    const prevExt = ((prevRun as unknown) as { external_connector?: Record<string, unknown> }).external_connector ?? {};
    const nextRun = {
      ...prevRun,
      external_connector: {
        connector: "n8n",
        mode: "pilot_manual",
        ...prevExt,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase
      .from("clipboard_items")
      .update({ metadata: { ...prevMeta, automation_run: nextRun } } as never)
      .eq("id", item.id);
    if (upErr) throw upErr;
  }

  const prepareMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const elig = isEligible(item);
      if (elig.hasRealResult) {
        const ok = window.confirm(
          "Esiste già un risultato reale approvato. Continuare a preparare un nuovo payload n8n?",
        );
        if (!ok) throw new Error("Annullato");
      }
      if (item.risk_level === "alto") {
        const ok = window.confirm(
          "Item ad alto rischio. Confermi la preparazione del payload n8n?",
        );
        if (!ok) throw new Error("Annullato");
      }
      const payload = buildN8nPayload(item);
      await persistExternalConnector(item, {
        last_payload_at: new Date().toISOString(),
        last_payload_version: ((payload.payload_version as number | undefined) ?? 1),
      });
      await logEvent(item, "n8n_payload_prepared", "Payload n8n preparato", {
        target: payload.target,
        execution_mode: payload.execution_mode,
        risk_level: item.risk_level,
      });
      return { item, payload };
    },
    onSuccess: (r) => {
      setPayloadDialog(r);
      invalidate();
    },
    onError: (e: Error) => {
      if (e.message !== "Annullato") toast.error(e.message);
    },
  });

  async function copyPayload() {
    if (!payloadDialog) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payloadDialog.payload, null, 2));
      toast.success("Payload n8n copiato");
      await logEvent(payloadDialog.item, "automation_payload_copied", "Payload n8n copiato negli appunti", {
        target: payloadDialog.payload.target,
        execution_mode: payloadDialog.payload.execution_mode,
      });
      invalidate();
    } catch {
      toast.error("Impossibile copiare negli appunti");
    }
  }

  const generateCallbackMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const json = buildCallbackTemplate(item);
      await persistExternalConnector(item, {
        last_callback_template_at: new Date().toISOString(),
      });
      await logEvent(item, "n8n_callback_template_generated", "Template callback n8n generato");
      return { item, json };
    },
    onSuccess: (r) => {
      setCallbackDialog(r);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyCallback() {
    if (!callbackDialog) return;
    try {
      await navigator.clipboard.writeText(callbackDialog.json);
      toast.success("Template callback copiato");
    } catch {
      toast.error("Impossibile copiare negli appunti");
    }
  }

  async function sendCallbackToInbox() {
    if (!callbackDialog) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(callbackDialog.json);
    } catch {
      toast.error("Template non valido");
      return;
    }
    try {
      await persistExternalConnector(callbackDialog.item, {
        last_sent_to_inbox_at: new Date().toISOString(),
      });
      await logEvent(callbackDialog.item, "n8n_callback_sent_to_inbox", "Callback n8n inviata alla inbox");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("automation:simulate-callback", { detail: parsed }),
    );
    setCallbackDialog(null);
    toast.success("Inviata alla Callback Inbox");
  }

  const saveWebhookMut = useMutation({
    mutationFn: async ({ item, label }: { item: ClipItem; label: string }) => {
      await persistExternalConnector(item, {
        webhook_url_label: label,
        webhook_url_saved: label.trim().length > 0,
      });
      // Log via updateAutomationRun-equivalent: produce a generic payload_copied for trail
      await logEvent(item, "n8n_payload_prepared", "Webhook URL n8n salvato (solo etichetta)", {
        webhook_url_saved: label.trim().length > 0,
      });
      return { id: item.id };
    },
    onSuccess: (r) => {
      toast.success("Webhook label salvato");
      setWebhookEdit((s) => {
        const next = { ...s };
        delete next[r.id];
        return next;
      });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type ReadinessCheck = { label: string; ok: boolean; critical: boolean };
  function readinessFor(item: ClipItem): { checks: ReadinessCheck[]; contract: ReturnType<typeof validateN8nContract>; canMark: boolean } {
    const run = getAutomationRun(item);
    const rm = resultMeta(item);
    const ext = externalConnector(item);
    const reviewed = reviewStatus(item);
    const dryActive = ((run as unknown) as { dry_run?: { enabled?: boolean } }).dry_run?.enabled === true && run.run_status === "running";
    const realApproved = rm?.source !== "dry_run" && rm?.is_simulated !== true && (reviewed === "approvato" || run.run_status === "completed");
    const payload = buildN8nPayload(item);
    const tpl = buildCallbackTemplateObj(item);
    const contract = validateN8nContract(payload, tpl);
    const checks: ReadinessCheck[] = [
      { label: "Run approvata o in coda", ok: run.run_status === "approved" || run.run_status === "queued", critical: true },
      { label: "Risk level non alto", ok: item.risk_level !== "alto", critical: true },
      { label: "Payload contratto valido", ok: contract.status === "valid", critical: true },
      { label: "Callback schema valido (v" + N8N_CALLBACK_SCHEMA_VERSION + ")", ok: contract.status === "valid", critical: true },
      { label: "Nessun dry run attivo", ok: !dryActive, critical: true },
      { label: "Nessun risultato reale già approvato", ok: !realApproved, critical: true },
      { label: "Review precedente non bloccante", ok: reviewed !== "non_approvato_blocca", critical: true },
      { label: "Webhook URL solo etichetta, nessun token salvato", ok: true, critical: false },
      { label: "Test manuale/pilota consapevole", ok: true, critical: false },
    ];
    const canMark = checks.filter((c) => c.critical).every((c) => c.ok);
    return { checks, contract, canMark };
  }

  const markReadyMut = useMutation({
    mutationFn: async (item: ClipItem) => {
      const r = readinessFor(item);
      if (!r.canMark) throw new Error("Checklist non completa: alcuni controlli critici falliscono");
      await persistExternalConnector(item, {
        contract_status: r.contract.status,
        callback_schema_version: N8N_CALLBACK_SCHEMA_VERSION,
        ready_for_real_test: true,
        ready_marked_at: new Date().toISOString(),
      });
      await logEvent(item, "n8n_ready_for_real_test", "Execution Package pronto per test n8n controllato", {
        contract_status: r.contract.status,
        callback_schema_version: N8N_CALLBACK_SCHEMA_VERSION,
      });
    },
    onSuccess: () => {
      toast.success("Execution Package pronto per test n8n controllato");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });



  // Ledger touch helper: increment run touched timestamp without changing status
  async function touchRun(item: ClipItem) {
    try {
      await updateAutomationRun(item, {}, "n8n_payload_prepared", { notes: "Touch n8n pilot" });
    } catch {
      /* ignore */
    }
  }
  void touchRun; // available for future use, prevents unused warning

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento n8n Pilot…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;

  const instructions = `Trigger: Webhook n8n
Input atteso: payload generato da Brain Hub (vedi "Prepara payload n8n")
Step manuale o AI agent: esegue il prompt su Lovable o altro target
Output finale: JSON callback compatibile con Brain Hub

Callback richiesta:
- execution_package_id
- run_id
- status: completed | failed
- build_status: ok | failed | not_verified
- console_errors: true | false
- modified_files: string[]
- summary
- notes
- raw_output
- external_result_reference`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4" /> n8n Pilot Connector
          <Badge variant="outline" className="ml-2 text-[10px]">pilot · no external calls</Badge>
          <Badge variant="outline" className="text-[10px]">{eligible.length} eligibili</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3 w-3 text-amber-400" /> Modalità preparazione
          </div>
          <p className="text-muted-foreground">
            Questa sezione prepara payload e template callback per un futuro workflow n8n. Nessuna chiamata esterna viene effettuata. La consegna del payload e l&apos;applicazione del risultato restano manuali via Callback Inbox.
          </p>
        </div>

        <details className="rounded-md border border-border/60 p-3">
          <summary className="cursor-pointer text-sm font-medium">Istruzioni workflow n8n</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{instructions}</pre>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(instructions);
                toast.success("Istruzioni copiate");
              } catch {
                toast.error("Impossibile copiare");
              }
            }}
          >
            <Copy className="mr-1 h-3 w-3" /> Copia istruzioni
          </Button>
        </details>

        <details className="rounded-md border border-border/60 p-3" open>
          <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="h-3 w-3 text-emerald-400" /> Webhook Contract (schema v{N8N_CALLBACK_SCHEMA_VERSION})
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border/40 p-2 text-xs space-y-1">
              <div className="font-medium">Payload in uscita</div>
              <div className="text-muted-foreground">Obbligatori:</div>
              <div className="font-mono text-[10px]">{N8N_PAYLOAD_SCHEMA.required.join(", ")}</div>
              <div className="text-muted-foreground mt-1">Opzionali:</div>
              <div className="font-mono text-[10px]">{N8N_PAYLOAD_SCHEMA.optional.join(", ")}</div>
            </div>
            <div className="rounded-md border border-border/40 p-2 text-xs space-y-1">
              <div className="font-medium">Callback attesa</div>
              <div className="text-muted-foreground">Obbligatori:</div>
              <div className="font-mono text-[10px]">{N8N_CALLBACK_SCHEMA.required.join(", ")}</div>
              <div className="text-muted-foreground mt-1">Opzionali:</div>
              <div className="font-mono text-[10px]">{N8N_CALLBACK_SCHEMA.optional.join(", ")}</div>
              <div className="text-muted-foreground mt-1">status: {N8N_CALLBACK_SCHEMA.status_allowed.join(" | ")}</div>
              <div className="text-muted-foreground">build_status: {N8N_CALLBACK_SCHEMA.build_status_allowed.join(" | ")}</div>
            </div>
          </div>
        </details>

        <details className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-3 w-3 text-amber-400" /> Istruzioni sicurezza n8n
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
            <li>Non salvare token nel frontend.</li>
            <li>Non esporre secret in chiaro.</li>
            <li>Il primo test deve essere fatto su un solo Execution Package.</li>
            <li>Il risultato deve rientrare come callback JSON compatibile.</li>
            <li>Se la callback non valida il contratto, non applicarla.</li>
            <li>Se il risultato modifica aree protette, passare da Post Execution Review e Fix Prompt.</li>
          </ul>
        </details>



        {eligible.length === 0 && (
          <div className="rounded-md border border-border/60 p-4 text-sm text-muted-foreground">
            Nessun Execution Package eleggibile (richiede run_status approved o queued, senza dry run attivo).
          </div>
        )}

        <div className="space-y-2">
          {eligible.map(({ item, info }) => {
            const run = getAutomationRun(item);
            const brain = item.brain_id ? brainMap.get(item.brain_id) : null;
            const pkg = ((item.metadata as Record<string, unknown> | null)?.execution_package as { package_type?: string } | undefined)?.package_type ?? "standard";
            const rm = resultMeta(item);
            const ext = externalConnector(item);
            const editing = webhookEdit[item.id];
            const callbackState = rm?.source === "callback_inbox" ? "applicata" : ext?.last_sent_to_inbox_at ? "inviata alla inbox" : ext?.last_callback_template_at ? "template generato" : "nessuna";
            return (
              <div key={item.id} className="rounded-md border border-border/60 p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.title || "(senza titolo)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {brain?.name ?? "—"} · {pkg} · target: {run.target} · mode: {run.execution_mode}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      ultimo payload: {ext?.last_payload_at ? new Date(ext.last_payload_at).toLocaleString() : "—"} · callback: {callbackState}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {info.hasRealResult && (
                      <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px]">risultato reale</Badge>
                    )}
                    {item.risk_level && (
                      <Badge variant="outline" className="text-[10px]">risk: {item.risk_level}</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">pkg: {item.automation_status}</Badge>
                    <Badge className="bg-blue-500/15 text-blue-300 text-[10px]">
                      run: {RUN_STATUS_LABELS[run.run_status]}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => prepareMut.mutate(item)} disabled={prepareMut.isPending}>
                    <FileJson className="mr-1 h-3 w-3" /> Prepara payload n8n
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => generateCallbackMut.mutate(item)} disabled={generateCallbackMut.isPending}>
                    <Inbox className="mr-1 h-3 w-3" /> Genera esempio callback n8n
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="text-[11px] text-muted-foreground shrink-0">URL webhook n8n (solo etichetta):</div>
                  <Input
                    className="h-7 text-xs flex-1 min-w-[200px]"
                    placeholder={ext?.webhook_url_label ?? "es. n8n-pilot-001"}
                    value={editing ?? ext?.webhook_url_label ?? ""}
                    onChange={(e) => setWebhookEdit((s) => ({ ...s, [item.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      saveWebhookMut.mutate({ item, label: editing ?? ext?.webhook_url_label ?? "" })
                    }
                    disabled={saveWebhookMut.isPending}
                  >
                    <Save className="mr-1 h-3 w-3" /> Salva
                  </Button>
                  {ext?.webhook_url_saved && (
                    <Badge variant="outline" className="text-[10px]">saved</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Dialog open={!!payloadDialog} onOpenChange={(o) => !o && setPayloadDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileJson className="h-4 w-4" /> Payload n8n — {payloadDialog?.item.title}
              </DialogTitle>
            </DialogHeader>
            <Textarea
              rows={20}
              className="font-mono text-xs"
              readOnly
              value={payloadDialog ? JSON.stringify(payloadDialog.payload, null, 2) : ""}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayloadDialog(null)}>Chiudi</Button>
              <Button onClick={copyPayload}><Copy className="mr-1 h-3 w-3" /> Copia payload n8n</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!callbackDialog} onOpenChange={(o) => !o && setCallbackDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Inbox className="h-4 w-4" /> Template callback n8n — {callbackDialog?.item.title}
              </DialogTitle>
            </DialogHeader>
            <Textarea
              rows={16}
              className="font-mono text-xs"
              value={callbackDialog?.json ?? ""}
              onChange={(e) => callbackDialog && setCallbackDialog({ ...callbackDialog, json: e.target.value })}
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setCallbackDialog(null)}>Chiudi</Button>
              <Button variant="outline" onClick={copyCallback}><Copy className="mr-1 h-3 w-3" /> Copia</Button>
              <Button onClick={sendCallbackToInbox}><Inbox className="mr-1 h-3 w-3" /> Invia a Callback Inbox</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
